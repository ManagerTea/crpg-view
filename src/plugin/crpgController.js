const DEFAULT_SETTINGS = {
  enabled: true,
  typingSpeed: 50,
  fontSize: 24,
  endDelay: 4,
  backgroundColor: "#111824",
  textColor: "#f5f0ff",
  accentColor: "#ff3038",
  panelWidth: 960,
  panelHeight: 320,
  panelX: 64,
  panelY: 56,
  collapsed: false,
  avatarUrl: ""
};

export function createCrpgController({ bridge, storage = localStorage, clock = window } = {}) {
  const state = {
    settings: loadSettings(storage),
    current: null,
    visibleText: "",
    isTyping: false,
    isSkipped: false,
    error: ""
  };
  const subscribers = new Set();
  let typingTimer = null;
  let bridgeCleanup = null;
  let bridgeErrorCleanup = null;

  const notify = () => subscribers.forEach((subscriber) => subscriber(snapshot(state)));

  const setError = (message) => {
    state.error = message;
    notify();
  };

  const startMessage = (message) => {
    if (!state.settings.enabled) return;
    clearTyping(clock, typingTimer);
    state.current = message;
    state.visibleText = "";
    state.isTyping = true;
    state.isSkipped = false;
    state.error = "";
    notify();
    typeNextCharacter(clock, state, notify, (timer) => {
      typingTimer = timer;
    });
  };

  if (bridge) {
    bridgeCleanup = bridge.onMessage(startMessage);
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
        clearTyping(clock, typingTimer);
        typeNextCharacter(clock, state, notify, (timer) => {
          typingTimer = timer;
        });
      }
    },
    receiveDebugMessage(message) {
      startMessage(message);
    },
    skip() {
      if (!state.current) return;
      clearTyping(clock, typingTimer);
      typingTimer = null;
      state.visibleText = state.current.text;
      state.isTyping = false;
      state.isSkipped = true;
      notify();
    },
    toggleCollapsed() {
      state.settings.collapsed = !state.settings.collapsed;
      saveSettings(storage, state.settings);
      notify();
    },
    dispose() {
      clearTyping(clock, typingTimer);
      if (bridgeCleanup) bridgeCleanup();
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

function typeNextCharacter(clock, state, notify, setTimer) {
  if (!state.current) return;
  if (state.visibleText.length >= state.current.text.length) {
    state.isTyping = false;
    notify();
    return;
  }
  const speed = Math.max(5, Number(state.settings.typingSpeed) || DEFAULT_SETTINGS.typingSpeed);
  setTimer(clock.setTimeout(() => {
    state.visibleText = state.current.text.slice(0, state.visibleText.length + 1);
    notify();
    typeNextCharacter(clock, state, notify, setTimer);
  }, speed));
}

function clearTyping(clock, timer) {
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
    typingSpeed: clamp(Number(settings.typingSpeed), 5, 500, DEFAULT_SETTINGS.typingSpeed),
    fontSize: clamp(Number(settings.fontSize), 12, 48, DEFAULT_SETTINGS.fontSize),
    endDelay: clamp(Number(settings.endDelay), 0, 60, DEFAULT_SETTINGS.endDelay),
    panelWidth: clamp(Number(settings.panelWidth), 360, 1400, DEFAULT_SETTINGS.panelWidth),
    panelHeight: clamp(Number(settings.panelHeight), 180, 900, DEFAULT_SETTINGS.panelHeight),
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
