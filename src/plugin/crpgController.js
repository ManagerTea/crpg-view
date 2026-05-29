const DEFAULT_SETTINGS = {
  enabled: true,
  sealChatUrl: "",
  showSealChatFrame: false,
  showPageControls: false,
  typingSpeed: 50,
  fontSize: 24,
  endDelay: 4,
  backgroundColor: "#111824",
  textColor: "#f5f0ff",
  accentColor: "#ff3038",
  panelWidth: 960,
  panelHeight: 320,
  portraitMaxHeight: 400,
  panelX: 64,
  panelY: 56,
  collapsed: false,
  avatarUrl: ""
};

export function createCrpgController({ bridge, storage = localStorage, clock = window } = {}) {
  const state = {
    settings: loadSettings(storage),
    roles: {},
    current: null,
    pending: [],
    latest: null,
    visibleText: "",
    pageIndex: 0,
    pageCount: 0,
    isTyping: false,
    isWaiting: false,
    isSkipped: false,
    status: "等待 SealChat 消息流",
    error: ""
  };
  const subscribers = new Set();
  let playbackTimer = null;
  let bridgeEventCleanup = null;
  let bridgeStatusCleanup = null;
  let bridgeErrorCleanup = null;

  const notify = () => subscribers.forEach((subscriber) => subscriber(snapshot(state)));

  const setError = (message) => {
    state.error = message;
    notify();
  };

  const setStatus = (status) => {
    if (status.kind === "handshake-ack") {
      state.status = status.channelId ? `SealChat 桥接已连接：${status.channelId}` : "SealChat 桥接已连接";
    } else if (status.kind === "handshake-sent") {
      state.status = "正在与 SealChat 建立桥接...";
    } else if (status.kind === "auth") {
      state.status = status.status === "authenticated" ? "SealChat 已登录" : "SealChat 未登录";
    } else if (status.kind === "unread") {
      state.status = `SealChat 未读消息：${status.count}`;
    }
    notify();
  };

  const handleEvent = (event) => {
    if (event.kind === "roles-snapshot") {
      state.roles = Object.fromEntries(event.roles.map((role) => [role.identityId, role]));
      if (state.current) state.current = applyRoleSnapshot(state.current, state.roles);
      state.pending = state.pending.map((message) => applyRoleSnapshot(message, state.roles));
      notify();
      return;
    }
    if (event.kind === "message-created") {
      enqueueMessage(state, event.message);
      startPlaybackIfIdle(clock, state, notify, setPlaybackTimer);
      return;
    }
    if (event.kind === "message-updated") {
      updateMessage(state, event.message);
      restartCurrentIfNeeded(clock, state, notify, setPlaybackTimer, playbackTimer, event.message.id);
      return;
    }
    if (event.kind === "message-deleted") {
      const deletingCurrent = state.current?.id === event.messageId;
      if (deletingCurrent) clearPlayback(clock, playbackTimer);
      deleteMessage(state, event.messageId);
      if (!state.current) startPlaybackIfIdle(clock, state, notify, setPlaybackTimer);
      else notify();
    }
  };

  const setPlaybackTimer = (timer) => {
    playbackTimer = timer;
  };

  if (bridge) {
    bridgeEventCleanup = bridge.onEvent(handleEvent);
    bridgeStatusCleanup = bridge.onStatus(setStatus);
    bridgeErrorCleanup = bridge.onError((error) => setError(error.message || String(error)));
  }

  return {
    subscribe(subscriber) {
      subscribers.add(subscriber);
      subscriber(snapshot(state));
      return () => subscribers.delete(subscriber);
    },
    updateSettings(nextSettings) {
      state.settings = sanitizeSettings({ ...state.settings, ...nextSettings });
      saveSettings(storage, state.settings);
      notify();
      if (state.isTyping) {
        clearPlayback(clock, playbackTimer);
        scheduleTyping(clock, state, notify, setPlaybackTimer);
      }
    },
    receiveDebugMessage(message) {
      handleEvent({ kind: "message-created", message });
    },
    receiveDebugEvent(event) {
      handleEvent(event);
    },
    skip() {
      if (!state.current) return;
      clearPlayback(clock, playbackTimer);
      playbackTimer = null;
      state.visibleText = currentPageText(state);
      state.isTyping = false;
      state.isWaiting = false;
      state.isSkipped = true;
      notify();
    },
    fastForwardLatest() {
      clearPlayback(clock, playbackTimer);
      playbackTimer = null;
      const latest = state.latest || state.pending.at(-1) || state.current;
      state.pending = [];
      state.current = latest ? prepareMessage(applyRoleSnapshot(latest, state.roles)) : null;
      state.pageIndex = state.current ? state.current.pages.length - 1 : 0;
      state.pageCount = state.current ? state.current.pages.length : 0;
      state.visibleText = state.current ? currentPageText(state) : "";
      state.isTyping = false;
      state.isWaiting = false;
      state.isSkipped = true;
      notify();
    },
    toggleCollapsed() {
      state.settings.collapsed = !state.settings.collapsed;
      saveSettings(storage, state.settings);
      notify();
    },
    dispose() {
      clearPlayback(clock, playbackTimer);
      if (bridgeEventCleanup) bridgeEventCleanup();
      if (bridgeStatusCleanup) bridgeStatusCleanup();
      if (bridgeErrorCleanup) bridgeErrorCleanup();
      subscribers.clear();
    }
  };
}

export function loadSettings(storage = localStorage) {
  try {
    return sanitizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(storage.getItem("crpgView.settings") || "{}") });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function colorsAreSimilar(first, second) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  if (!a || !b) return false;
  const distance = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  return distance < 85;
}

function enqueueMessage(state, message) {
  const prepared = prepareMessage(applyRoleSnapshot(message, state.roles));
  state.latest = prepared;
  if (!state.current && !state.isTyping && !state.isWaiting) {
    state.pending.unshift(prepared);
  } else {
    const index = state.pending.findIndex((item) => item.id === prepared.id);
    if (index >= 0) state.pending[index] = prepared;
    else state.pending.push(prepared);
  }
}

function updateMessage(state, message) {
  const prepared = prepareMessage(applyRoleSnapshot(message, state.roles));
  state.latest = prepared;
  if (state.current?.id === prepared.id) {
    state.current = prepared;
    return;
  }
  const index = state.pending.findIndex((item) => item.id === prepared.id);
  if (index >= 0) state.pending[index] = prepared;
  else state.pending.push(prepared);
}

function deleteMessage(state, messageId) {
  state.pending = state.pending.filter((message) => message.id !== messageId);
  if (state.current?.id === messageId) {
    state.current = null;
    state.visibleText = "";
    state.pageIndex = 0;
    state.pageCount = 0;
    state.isTyping = false;
    state.isWaiting = false;
  }
}

function restartCurrentIfNeeded(clock, state, notify, setTimer, timer, messageId) {
  if (state.current?.id !== messageId) {
    notify();
    return;
  }
  clearPlayback(clock, timer);
  state.visibleText = "";
  state.pageIndex = 0;
  state.pageCount = state.current.pages.length;
  state.isTyping = true;
  state.isWaiting = false;
  notify();
  scheduleTyping(clock, state, notify, setTimer);
}

function startPlaybackIfIdle(clock, state, notify, setTimer) {
  if (state.current || state.isTyping || state.isWaiting || !state.settings.enabled) {
    notify();
    return;
  }
  const next = state.pending.shift();
  if (!next) {
    notify();
    return;
  }
  state.current = prepareMessage(applyRoleSnapshot(next, state.roles));
  state.visibleText = "";
  state.pageIndex = 0;
  state.pageCount = state.current.pages.length;
  state.isTyping = true;
  state.isWaiting = false;
  state.isSkipped = false;
  state.error = "";
  notify();
  scheduleTyping(clock, state, notify, setTimer);
}

function scheduleTyping(clock, state, notify, setTimer) {
  if (!state.current) return;
  const page = currentPageText(state);
  if (visibleLength(state.visibleText) >= visibleLength(page)) {
    state.visibleText = page;
    state.isTyping = false;
    notify();
    scheduleNextPageOrMessage(clock, state, notify, setTimer);
    return;
  }
  const speed = Math.max(5, Number(state.settings.typingSpeed) || DEFAULT_SETTINGS.typingSpeed);
  setTimer(clock.setTimeout(() => {
    state.visibleText = sliceVisible(page, visibleLength(state.visibleText) + 1);
    notify();
    scheduleTyping(clock, state, notify, setTimer);
  }, speed));
}

function scheduleNextPageOrMessage(clock, state, notify, setTimer) {
  if (state.current && state.pageIndex >= state.current.pages.length - 1 && state.pending.length === 0) {
    state.isWaiting = false;
    state.visibleText = currentPageText(state);
    notify();
    return;
  }

  const waitMs = Math.max(0, Number(state.settings.endDelay) || 0) * 1000;
  state.isWaiting = true;
  setTimer(clock.setTimeout(() => {
    state.isWaiting = false;
    if (state.current && state.pageIndex < state.current.pages.length - 1) {
      state.pageIndex += 1;
      state.visibleText = "";
      state.isTyping = true;
      notify();
      scheduleTyping(clock, state, notify, setTimer);
      return;
    }
    if (state.pending.length > 0) {
      state.current = null;
      state.visibleText = "";
      state.pageIndex = 0;
      state.pageCount = 0;
      notify();
      startPlaybackIfIdle(clock, state, notify, setTimer);
      return;
    }
    state.visibleText = currentPageText(state);
    notify();
  }, waitMs));
}

function currentPageText(state) {
  return state.current?.pages[state.pageIndex] || "";
}

function prepareMessage(message) {
  const text = String(message.text || "");
  const pages = text.split(/\s*::\s*/).map((page) => page.trim()).filter(Boolean);
  return {
    ...message,
    speaker: message.speaker || "旁白",
    pages: pages.length ? pages : [text]
  };
}

function applyRoleSnapshot(message, roles) {
  const role = message.identityId ? roles[message.identityId] : null;
  if (!role) return message;
  return {
    ...message,
    speaker: message.speaker || role.displayName,
    color: message.color || role.color,
    avatar: role.avatarUrl || message.avatar
  };
}

function visibleLength(text) {
  return Array.from(text || "").length;
}

function sliceVisible(text, count) {
  return Array.from(text || "").slice(0, count).join("");
}

function clearPlayback(clock, timer) {
  if (timer) clock.clearTimeout(timer);
}

function saveSettings(storage, settings) {
  storage.setItem("crpgView.settings", JSON.stringify(settings));
}

function sanitizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    enabled: Boolean(settings.enabled),
    showSealChatFrame: Boolean(settings.showSealChatFrame),
    showPageControls: Boolean(settings.showPageControls),
    sealChatUrl: String(settings.sealChatUrl || ""),
    typingSpeed: clamp(Number(settings.typingSpeed), 5, 500, DEFAULT_SETTINGS.typingSpeed),
    fontSize: clamp(Number(settings.fontSize), 12, 48, DEFAULT_SETTINGS.fontSize),
    endDelay: clamp(Number(settings.endDelay), 0, 60, DEFAULT_SETTINGS.endDelay),
    panelWidth: clamp(Number(settings.panelWidth), 360, 1400, DEFAULT_SETTINGS.panelWidth),
    panelHeight: clamp(Number(settings.panelHeight), 180, 900, DEFAULT_SETTINGS.panelHeight),
    portraitMaxHeight: clamp(Number(settings.portraitMaxHeight), 120, 900, DEFAULT_SETTINGS.portraitMaxHeight),
    panelX: clamp(Number(settings.panelX), 0, 5000, DEFAULT_SETTINGS.panelX),
    panelY: clamp(Number(settings.panelY), 0, 5000, DEFAULT_SETTINGS.panelY)
  };
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function snapshot(state) {
  return JSON.parse(JSON.stringify(state));
}

function hexToRgb(hex) {
  const normalized = String(hex).replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  const value = Number.parseInt(normalized, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}
