const DEFAULT_CHANNEL = "sealchat-obr";
const HANDSHAKE_TYPE = "sealchat.bridge.handshake";
const HANDSHAKE_ACK_TYPE = "sealchat.bridge.handshake.ack";
const ROLES_SNAPSHOT_TYPE = "sealchat.bridge.roles.snapshot";
const MESSAGE_TYPE = "sealchat.bridge.message";
const AUTH_TYPE = "sealchat.auth";
const UNREAD_TYPE = "sealchat.unread";

/**
 * SealChat bridge adapter.
 *
 * This implements the protocol described by the SealChat/Owlbear reproduction
 * notes: an embed host repeatedly sends `sealchat.bridge.handshake` to the
 * SealChat iframe, accepts `handshake.ack`, `roles.snapshot` and
 * `bridge.message`, then forwards normalized dialogue queue events to the UI.
 * It also keeps the previous BroadcastChannel/EventSource/WebSocket fallbacks
 * for standalone testing and non-iframe deployments.
 */
export function createSealChatBridge(options = {}) {
  const eventListeners = new Set();
  const statusListeners = new Set();
  const errors = new Set();
  const channelName = options.channelName || readSetting("bridgeChannel", DEFAULT_CHANNEL);
  const sourceUrl = options.sourceUrl || readSetting("bridgeUrl", "");
  const sealChatUrl = normalizeBaseUrl(options.sealChatUrl || readSetting("sealChatUrl", ""));
  const allowedOrigin = sealChatUrl ? new URL(sealChatUrl).origin : "";
  const frame = options.frame || null;
  const handshakeIntervalMs = options.handshakeIntervalMs || 800;
  let broadcastChannel = null;
  let eventSource = null;
  let webSocket = null;
  let handshakeTimer = null;
  let handshakeAcked = false;
  let closed = false;
  const nonce = options.nonce || createNonce();

  const emitEvent = (event) => {
    if (!event) return;
    eventListeners.forEach((listener) => listener(event));
    if (broadcastChannel && event.source !== "broadcast") {
      broadcastChannel.postMessage({ type: "crpg-view.dialogue-event", event });
    }
  };

  const emitStatus = (status) => {
    statusListeners.forEach((listener) => listener(status));
  };

  const fail = (error) => {
    errors.forEach((listener) => listener(error));
  };

  const receive = (raw, meta = {}) => {
    const parsed = normalizeBridgeEvent(raw);
    if (!parsed) return;
    if (parsed.kind === "handshake-ack") {
      if (parsed.nonce && parsed.nonce !== nonce) return;
      handshakeAcked = parsed.ok !== false;
      stopHandshake();
      emitStatus(parsed);
      return;
    }
    if (parsed.kind === "auth" || parsed.kind === "unread") {
      emitStatus(parsed);
      return;
    }
    emitEvent({ ...parsed, source: meta.source || parsed.source });
  };

  const onWindowMessage = (event) => {
    if (allowedOrigin && event.origin !== allowedOrigin) return;
    receive(event.data, { source: "postMessage" });
  };
  window.addEventListener("message", onWindowMessage);

  if ("BroadcastChannel" in window) {
    broadcastChannel = new BroadcastChannel(channelName);
    broadcastChannel.addEventListener("message", (event) => {
      const data = parseMaybeJson(event.data);
      receive(data?.event || data, { source: "broadcast" });
    });
  }

  if (sourceUrl) {
    if (sourceUrl.startsWith("ws://") || sourceUrl.startsWith("wss://")) {
      webSocket = new WebSocket(sourceUrl);
      webSocket.addEventListener("message", (event) => receive(parseMaybeJson(event.data), { source: "websocket" }));
      webSocket.addEventListener("error", () => fail(new Error("SealChat WebSocket 连接失败。")));
    } else {
      eventSource = new EventSource(sourceUrl);
      eventSource.addEventListener("message", (event) => receive(parseMaybeJson(event.data), { source: "eventsource" }));
      eventSource.addEventListener("error", () => fail(new Error("SealChat EventSource 连接失败。")));
    }
  }

  function postHandshake() {
    if (!frame?.contentWindow || !allowedOrigin || handshakeAcked || closed) return;
    frame.contentWindow.postMessage(createHandshakeMessage(nonce), allowedOrigin);
    emitStatus({ kind: "handshake-sent", nonce, origin: allowedOrigin });
  }

  function startHandshake() {
    if (!frame || !allowedOrigin || handshakeTimer || handshakeAcked) return;
    postHandshake();
    handshakeTimer = window.setInterval(postHandshake, handshakeIntervalMs);
  }

  function stopHandshake() {
    if (!handshakeTimer) return;
    window.clearInterval(handshakeTimer);
    handshakeTimer = null;
  }

  if (frame && allowedOrigin) {
    frame.addEventListener("load", startHandshake);
    startHandshake();
  }

  return {
    channelName,
    sourceUrl,
    sealChatUrl,
    embedUrl: sealChatUrl ? createEmbedUrl(sealChatUrl) : "",
    nonce,
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onMessage(listener) {
      return this.onEvent((event) => {
        if (event.kind === "message-created") listener(event.message);
      });
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    onError(listener) {
      errors.add(listener);
      return () => errors.delete(listener);
    },
    sendDebugMessage(message) {
      receive(message, { source: "debug" });
    },
    retryHandshake() {
      handshakeAcked = false;
      startHandshake();
    },
    close() {
      if (closed) return;
      closed = true;
      stopHandshake();
      window.removeEventListener("message", onWindowMessage);
      if (frame) frame.removeEventListener("load", startHandshake);
      if (broadcastChannel) broadcastChannel.close();
      if (eventSource) eventSource.close();
      if (webSocket) webSocket.close();
      eventListeners.clear();
      statusListeners.clear();
      errors.clear();
    }
  };
}

export function createHandshakeMessage(nonce) {
  return {
    type: HANDSHAKE_TYPE,
    version: 1,
    nonce,
    want: ["roles", "messages"],
    currentChannelOnly: true
  };
}

export function normalizeBridgeEvent(raw) {
  const data = parseMaybeJson(raw);
  if (!data || typeof data !== "object") return null;
  const type = String(data.type || data.kind || "");

  if (type === HANDSHAKE_ACK_TYPE) {
    return {
      kind: "handshake-ack",
      version: toNumber(data.version),
      nonce: stringOrEmpty(data.nonce),
      ok: data.ok !== false,
      worldId: stringOrEmpty(data.worldId),
      channelId: stringOrEmpty(data.channelId)
    };
  }

  if (type === ROLES_SNAPSHOT_TYPE) {
    return {
      kind: "roles-snapshot",
      roles: Array.isArray(data.roles) ? data.roles.map(normalizeRole).filter(Boolean) : []
    };
  }

  if (type === MESSAGE_TYPE) {
    return normalizeDialogueMessageEvent(data);
  }

  if (type === AUTH_TYPE) {
    return { kind: "auth", status: data.status === "authenticated" ? "authenticated" : "unauthenticated" };
  }

  if (type === UNREAD_TYPE) {
    return { kind: "unread", count: Math.max(0, toNumber(data.count) || 0) };
  }

  const legacy = normalizeLegacyMessage(data);
  return legacy ? { kind: "message-created", message: legacy } : null;
}

export function normalizeLegacyMessage(raw) {
  const data = parseMaybeJson(raw);
  if (!data || typeof data !== "object") return null;
  const envelopeType = String(data.type || data.kind || "");
  const payload = envelopeType.includes("crpg") || data.payload ? data.payload || data.data : data;
  if (!payload || typeof payload !== "object") return null;

  const text = coalesce(payload.text, payload.contentText, payload.content, payload.message, payload.body, "");
  const speaker = coalesce(payload.speaker, payload.displayName, payload.name, payload.characterName, payload.actorName, "旁白");
  const avatar = coalesce(payload.avatar, payload.avatarUrl, payload.portrait, payload.portraitUrl, payload.image, payload.imageUrl, payload.icon, "");
  const title = coalesce(payload.title, payload.sceneTitle, payload.subtitle, "");
  const id = coalesce(payload.id, payload.messageId, `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  if (!text && !speaker && !avatar) return null;

  return {
    id: String(id),
    identityId: stringOrEmpty(payload.identityId),
    speaker: cleanText(speaker) || "旁白",
    title: cleanText(title),
    text: cleanText(text),
    color: stringOrEmpty(payload.color),
    avatar: cleanText(avatar),
    createdAt: toNumber(payload.createdAt) || Date.now(),
    raw: payload
  };
}

export const normalizeBridgeMessage = normalizeLegacyMessage;

export function createEmbedUrl(baseUrl) {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.searchParams.set("embed", "obr");
  return url.toString();
}

export function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeDialogueMessageEvent(data) {
  const event = String(data.event || "message-created");
  const id = stringOrEmpty(data.messageId || data.id);
  if (!id) return null;
  if (data.icMode !== "ic" || data.isWhisper === true) return null;
  if (event === "message-deleted" || event === "message-removed") {
    return { kind: "message-deleted", messageId: id };
  }
  const message = normalizeLegacyMessage({ ...data, id, text: data.contentText ?? data.text ?? data.content });
  if (!message) return null;
  return {
    kind: event === "message-updated" ? "message-updated" : "message-created",
    message
  };
}

function normalizeRole(role) {
  if (!role || typeof role !== "object" || !role.identityId) return null;
  return {
    identityId: String(role.identityId),
    displayName: stringOrEmpty(role.displayName),
    color: safeCssColor(role.color) ? String(role.color) : "",
    avatarUrl: stringOrEmpty(role.avatarUrl || role.avatar || role.portrait || role.portraitUrl || role.image || role.imageUrl)
  };
}

function safeCssColor(value) {
  if (!value) return true;
  if (typeof CSS !== "undefined" && CSS.supports) return CSS.supports("color", value);
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(value));
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function coalesce(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function stringOrEmpty(value) {
  return cleanText(value);
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (text === "undefined" || text === "null") return "";
  return decodeHtmlEntities(text);
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function createNonce() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readSetting(key, fallback) {
  const params = new URLSearchParams(window.location.search);
  return params.get(key) || localStorage.getItem(`crpgView.${key}`) || fallback;
}
