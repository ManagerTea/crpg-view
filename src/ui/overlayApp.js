import { createSealChatBridge } from "../adapter/sealchatBridge.js";
import { colorsAreSimilar, createCrpgController } from "../plugin/crpgController.js";

export function mountCrpgView(app, options = {}) {
  const storage = options.storage || localStorage;
app.innerHTML = `
  <section class="toolbar" aria-label="CRPG 视图工具栏">
    <button class="toolbar__button" data-action="settings">设置</button>
    <span class="toolbar__status" data-role="status">等待 SealChat 消息流</span>
  </section>

  <aside class="settings" data-role="settings" aria-label="CRPG 对话框设置" hidden>
    <div class="settings__header">
      <h1>CRPG 对话框</h1>
      <button class="icon-button" data-action="settings" aria-label="关闭设置">×</button>
    </div>
    <label class="setting-row setting-row--inline">
      <span>
        <strong>启用 CRPG 对话框</strong>
        <small>根据 SealChat 当前频道 IC 消息播放剧情对话框。</small>
      </span>
      <input data-setting="enabled" type="checkbox" />
    </label>
    <label class="setting-row">
      <span><strong>SealChat 地址</strong><small>用于加载 {SealChat URL}?embed=obr，并进行 bridge handshake。</small></span>
      <input data-setting="sealChatUrl" type="url" placeholder="https://chat.example.com" />
    </label>
    <label class="setting-row setting-row--inline">
      <span>
        <strong>显示 SealChat iframe</strong>
        <small>关闭时 iframe 仍会加载以接收桥接消息，只隐藏聊天面板。</small>
      </span>
      <input data-setting="showSealChatFrame" type="checkbox" />
    </label>
    <label class="setting-row setting-row--inline">
      <span>
        <strong>显示页面内设置入口</strong>
        <small>开启后才在页面上显示设置按钮与桥接状态。</small>
      </span>
      <input data-setting="showPageControls" type="checkbox" />
    </label>
    <label class="setting-row">
      <span><strong>打字速度（毫秒/字）</strong><small>每个可见字符的播放间隔。</small></span>
      <input data-setting="typingSpeed" type="number" min="5" max="500" />
    </label>
    <label class="setting-row">
      <span><strong>对话字号</strong><small>CRPG 对话框正文像素字号。</small></span>
      <input data-setting="fontSize" type="number" min="12" max="48" />
    </label>
    <label class="setting-row">
      <span><strong>头像最大高度（px）</strong><small>立绘会按比例压缩，默认 400px。</small></span>
      <input data-setting="portraitMaxHeight" type="number" min="120" max="900" step="10" />
    </label>
    <label class="setting-row">
      <span><strong>句末等待时间（秒）</strong><small>保留给宿主扩展自动收起时使用。</small></span>
      <input data-setting="endDelay" type="number" min="0" max="60" />
    </label>
    <label class="setting-row">
      <span><strong>背景颜色</strong><small>对话框背景。</small></span>
      <input data-setting="backgroundColor" type="color" />
    </label>
    <label class="setting-row">
      <span><strong>字体颜色</strong><small>如果与背景过于接近会要求确认。</small></span>
      <input data-setting="textColor" type="color" />
    </label>
    <label class="setting-row">
      <span><strong>角色名颜色</strong><small>用于说话人名称。</small></span>
      <input data-setting="accentColor" type="color" />
    </label>
    <label class="setting-row">
      <span><strong>默认头像 URL</strong><small>消息没有头像时使用。</small></span>
      <input data-setting="avatarUrl" type="url" placeholder="https://.../portrait.png" />
    </label>
  </aside>

  <article class="dialogue" data-role="dialogue" aria-label="SealChat CRPG 实时对话框">
    <div class="dialogue__drag" data-role="drag-handle" title="拖动对话框"></div>
    <button class="dialogue__collapse" data-action="collapse" aria-label="折叠或展开">»</button>
    <button class="dialogue__minimize" data-action="collapse" aria-label="折叠或展开">—</button>
    <div class="dialogue__content">
      <figure class="dialogue__portrait"><img data-role="avatar" alt="当前发言角色头像" /></figure>
      <div class="dialogue__body">
        <h2 data-role="speaker">等待消息</h2>
        <p data-role="title"></p>
        <div class="dialogue__text" data-role="text"></div>
      </div>
    </div>
    <div class="dialogue__actions">
      <button class="dialogue__skip" data-action="skip">Skip</button>
      <button class="dialogue__skip" data-action="latest">最新</button>
    </div>
    <div class="dialogue__resize" data-role="resize-handle" title="拖动调整宽高"></div>
  </article>

  <iframe class="sealchat-frame" data-role="sealchat-frame" title="SealChat 嵌入桥接面板" hidden></iframe>
`;

const elements = {
  toolbar: app.querySelector(".toolbar"),
  dialogue: app.querySelector('[data-role="dialogue"]'),
  settings: app.querySelector('[data-role="settings"]'),
  status: app.querySelector('[data-role="status"]'),
  avatar: app.querySelector('[data-role="avatar"]'),
  speaker: app.querySelector('[data-role="speaker"]'),
  title: app.querySelector('[data-role="title"]'),
  text: app.querySelector('[data-role="text"]'),
  sealChatFrame: app.querySelector('[data-role="sealchat-frame"]')
};

const initialSettings = { ...readInitialSettings(storage), ...options.initialSettings };
const bridge = options.bridge || createSealChatBridge({
  frame: elements.sealChatFrame,
  sealChatUrl: initialSettings.sealChatUrl || new URLSearchParams(window.location.search).get("sealChatUrl") || ""
});
const controller = createCrpgController({ bridge, storage });
let latestState = null;
let textScroller = null;

controller.subscribe((state) => {
  latestState = state;
  render(state);
});

app.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "settings") toggleSettings();
  if (action === "collapse") controller.toggleCollapsed();
  if (action === "skip") controller.skip();
  if (action === "latest") controller.fastForwardLatest();
});

app.addEventListener("input", (event) => {
  const input = event.target.closest("[data-setting]");
  if (!input || !latestState) return;
  const key = input.dataset.setting;
  if (key === "sealChatUrl") {
    const value = input.value.trim();
    controller.updateSettings({ [key]: value });
    elements.status.textContent = "SealChat 地址已保存，刷新页面后将重新建立 iframe 桥接。";
    return;
  }
  if (input.type === "number" && input.value === "") return;
  const value = input.type === "checkbox" ? input.checked : input.value;
  if ((key === "backgroundColor" || key === "textColor") && willCreateLowContrast(key, value)) {
    const accepted = window.confirm("背景色与字体色过于接近，可能导致文字不可读。仍要使用吗？");
    if (!accepted) {
      hydrateSettings(latestState.settings);
      return;
    }
  }
  controller.updateSettings({ [key]: value });
});

makeDraggable(app.querySelector('[data-role="drag-handle"]'));
makeResizable(app.querySelector('[data-role="resize-handle"]'));
if (options.showSettingsOnMount) toggleSettings();

function render(state) {
  const { settings, current } = state;
  elements.toolbar.hidden = !settings.showPageControls;
  elements.dialogue.hidden = !settings.enabled || !current;
  elements.dialogue.style.setProperty("--dialogue-bg", settings.backgroundColor);
  elements.dialogue.style.setProperty("--dialogue-text", settings.textColor);
  elements.dialogue.style.setProperty("--dialogue-accent", settings.accentColor);
  elements.dialogue.style.setProperty("--dialogue-font-size", `${settings.fontSize}px`);
  elements.dialogue.style.setProperty("--portrait-max-height", `${settings.portraitMaxHeight}px`);
  elements.dialogue.style.width = `${settings.panelWidth}px`;
  elements.dialogue.style.height = settings.collapsed ? "58px" : `${settings.panelHeight}px`;
  elements.dialogue.style.transform = `translate(${settings.panelX}px, ${settings.panelY}px)`;
  elements.dialogue.classList.toggle("is-collapsed", settings.collapsed);
  elements.dialogue.classList.toggle("is-disabled", !settings.enabled);
  elements.dialogue.classList.toggle("has-portrait", Boolean(current?.avatar || settings.avatarUrl));
  renderSealChatFrame(settings);

  elements.speaker.textContent = current?.speaker || "等待消息";
  elements.title.textContent = current ? pageIndicator(state) : "";
  elements.title.hidden = !elements.title.textContent;
  elements.text.textContent = state.visibleText || "连接 SealChat iframe 桥接后，这里会显示公开 IC 消息。消息可用 :: 分页。";
  elements.avatar.src = current?.avatar || settings.avatarUrl || createPlaceholderAvatar(settings.accentColor);
  elements.speaker.style.color = current?.color || settings.accentColor;
  elements.status.textContent = state.error || (current ? `正在显示：${current.speaker} · 队列 ${state.pending.length}` : state.status);
  hydrateSettings(settings);
  requestAnimationFrame(() => autoScrollText());
}

function hydrateSettings(settings) {
  app.querySelectorAll("[data-setting]").forEach((input) => {
    const key = input.dataset.setting;
    if (key === "bridgeUrl") return;
    if (!(key in settings)) return;
    if (input === document.activeElement) return;
    if (input.type === "checkbox") input.checked = Boolean(settings[key]);
    else input.value = settings[key];
  });
}

function toggleSettings() {
  elements.settings.hidden = !elements.settings.hidden;
}

function willCreateLowContrast(key, value) {
  const next = { ...latestState.settings, [key]: value };
  return colorsAreSimilar(next.backgroundColor, next.textColor);
}

function pageIndicator(state) {
  if (!state.pageCount || state.pageCount <= 1) return state.current?.title || "";
  const page = `${state.pageIndex + 1}/${state.pageCount}`;
  return state.current?.title ? `${state.current.title} · ${page}` : page;
}

function renderSealChatFrame(settings) {
  if (!settings.sealChatUrl) {
    elements.sealChatFrame.hidden = true;
    elements.sealChatFrame.removeAttribute("src");
    return;
  }
  try {
    const url = new URL(settings.sealChatUrl);
    url.searchParams.set("embed", "obr");
    const src = url.toString();
    if (elements.sealChatFrame.src !== src) elements.sealChatFrame.src = src;
    elements.sealChatFrame.hidden = !settings.showSealChatFrame;
  } catch {
    elements.sealChatFrame.hidden = true;
  }
}

function autoScrollText() {
  if (textScroller) cancelAnimationFrame(textScroller);
  textScroller = requestAnimationFrame(() => {
    elements.text.scrollTop = elements.text.scrollHeight;
  });
}

function makeDraggable(handle) {
  handle.addEventListener("pointerdown", (event) => {
    if (!latestState) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = latestState.settings.panelX;
    const originY = latestState.settings.panelY;
    const move = (moveEvent) => {
      controller.updateSettings({
        panelX: originX + moveEvent.clientX - startX,
        panelY: originY + moveEvent.clientY - startY
      });
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
  });
}

function makeResizable(handle) {
  handle.addEventListener("pointerdown", (event) => {
    if (!latestState) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const originWidth = latestState.settings.panelWidth;
    const originHeight = latestState.settings.panelHeight;
    const move = (moveEvent) => {
      controller.updateSettings({
        panelWidth: originWidth + moveEvent.clientX - startX,
        panelHeight: originHeight + moveEvent.clientY - startY
      });
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
  });
}

function createPlaceholderAvatar(accentColor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" rx="32" fill="#242331"/><circle cx="120" cy="86" r="42" fill="${accentColor}"/><path d="M47 206c14-48 44-72 73-72s59 24 73 72" fill="#d8e5ef" opacity=".85"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function readInitialSettings(storage) {
  try {
    return JSON.parse(storage.getItem("crpgView.settings") || "{}");
  } catch {
    return {};
  }
}


  return {
    controller,
    bridge,
    destroy() {
      controller.dispose();
      bridge.close?.();
      app.replaceChildren();
    },
    toggleSettings,
    updateSettings(settings) {
      controller.updateSettings(settings);
    },
    skip() {
      controller.skip();
    },
    fastForwardLatest() {
      controller.fastForwardLatest();
    }
  };
}
