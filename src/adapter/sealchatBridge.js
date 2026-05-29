const DEFAULT_CHANNEL = "sealchat:crpg-bridge";

/**
 * Creates a tolerant adapter for SealChat's external embed bridge stream.
 *
 * Assumptions for the host API, because the SealChat repository is not present
 * in this environment:
 * - Browser embeds receive CRPG payloads through postMessage or BroadcastChannel.
 * - Standalone browser windows may also connect to an EventSource or WebSocket
 *   URL supplied by query string/localStorage.
 * - Message payloads contain either { type: "sealchat:crpg", payload: {...} }
 *   or the payload object directly.
 */
export function createSealChatBridge(options = {}) {
  const listeners = new Set();
  const errors = new Set();
  const channelName = options.channelName || readSetting("bridgeChannel", DEFAULT_CHANNEL);
  const sourceUrl = options.sourceUrl || readSetting("bridgeUrl", "");
  let broadcastChannel = null;
  let eventSource = null;
  let webSocket = null;
  let closed = false;

  const emit = (raw) => {
    const message = normalizeBridgeMessage(raw);
    if (!message) return;
    listeners.forEach((listener) => listener(message));
  };

  const fail = (error) => {
    errors.forEach((listener) => listener(error));
  };

  const onWindowMessage = (event) => emit(event.data);
  window.addEventListener("message", onWindowMessage);

  if ("BroadcastChannel" in window) {
    broadcastChannel = new BroadcastChannel(channelName);
    broadcastChannel.addEventListener("message", (event) => emit(event.data));
  }

  if (sourceUrl) {
    if (sourceUrl.startsWith("ws://") || sourceUrl.startsWith("wss://")) {
      webSocket = new WebSocket(sourceUrl);
      webSocket.addEventListener("message", (event) => emit(parseMaybeJson(event.data)));
      webSocket.addEventListener("error", () => fail(new Error("SealChat WebSocket 连接失败。")));
    } else {
      eventSource = new EventSource(sourceUrl);
      eventSource.addEventListener("message", (event) => emit(parseMaybeJson(event.data)));
      eventSource.addEventListener("error", () => fail(new Error("SealChat EventSource 连接失败。")));
    }
  }

  return {
    channelName,
    sourceUrl,
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onError(listener) {
      errors.add(listener);
      return () => errors.delete(listener);
    },
    sendDebugMessage(message) {
      emit(message);
      if (broadcastChannel) broadcastChannel.postMessage({ type: "sealchat:crpg", payload: message });
    },
    close() {
      if (closed) return;
      closed = true;
      window.removeEventListener("message", onWindowMessage);
      if (broadcastChannel) broadcastChannel.close();
      if (eventSource) eventSource.close();
      if (webSocket) webSocket.close();
      listeners.clear();
      errors.clear();
    }
  };
}

export function normalizeBridgeMessage(raw) {
  const data = parseMaybeJson(raw);
  if (!data || typeof data !== "object") return null;
  const envelopeType = String(data.type || data.kind || "");
  const payload = envelopeType.includes("crpg") || data.payload ? data.payload || data.data : data;
  if (!payload || typeof payload !== "object") return null;

  const text = coalesce(payload.text, payload.content, payload.message, payload.body, "");
  const speaker = coalesce(payload.speaker, payload.name, payload.characterName, payload.actorName, "旁白");
  const avatar = coalesce(payload.avatar, payload.portrait, payload.image, payload.icon, "");
  const title = coalesce(payload.title, payload.sceneTitle, payload.subtitle, "");
  const id = coalesce(payload.id, payload.messageId, `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  if (!text && !speaker && !avatar) return null;

  return {
    id: String(id),
    speaker: String(speaker),
    title: String(title),
    text: String(text),
    avatar: String(avatar),
    raw: payload
  };
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

function readSetting(key, fallback) {
  const params = new URLSearchParams(window.location.search);
  return params.get(key) || localStorage.getItem(`crpgView.${key}`) || fallback;
}
