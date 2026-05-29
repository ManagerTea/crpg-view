import { createSealChatBridge } from "../adapter/sealchatBridge.js";
import { colorsAreSimilar, createCrpgController } from "../plugin/crpgController.js";

const bridge = createSealChatBridge();
const controller = createCrpgController({ bridge });
const app = document.querySelector("#app");
let latestState = null;
let textScroller = null;

app.innerHTML = `
  <section class="toolbar" aria-label="CRPG 视图工具栏">
    <button class="toolbar__button" data-action="sample">播放示例</button>
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
      <span><strong>桥接地址</strong><small>可选。支持 EventSource 或 WebSocket；也可用 postMessage / BroadcastChannel。</small></span>
      <input data-setting="bridgeUrl" type="url" placeholder="https://.../stream 或 wss://..." />
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
    <button class="dialogue__skip" data-action="skip">Skip</button>
    <div class="dialogue__resize" data-role="resize-handle" title="拖动调整宽高"></div>
  </article>
`;

const elements = {
  dialogue: app.querySelector('[data-role="dialogue"]'),
  settings: app.querySelector('[data-role="settings"]'),
  status: app.querySelector('[data-role="status"]'),
  avatar: app.querySelector('[data-role="avatar"]'),
  speaker: app.querySelector('[data-role="speaker"]'),
  title: app.querySelector('[data-role="title"]'),
  text: app.querySelector('[data-role="text"]')
};

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
  if (action === "sample") playSample();
});

app.addEventListener("input", (event) => {
  const input = event.target.closest("[data-setting]");
  if (!input || !latestState) return;
  const key = input.dataset.setting;
  if (key === "bridgeUrl") {
    localStorage.setItem("crpgView.bridgeUrl", input.value.trim());
    elements.status.textContent = "桥接地址已保存，刷新页面后生效。";
    return;
  }
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
playSample();

function render(state) {
  const { settings, current } = state;
  elements.dialogue.style.setProperty("--dialogue-bg", settings.backgroundColor);
  elements.dialogue.style.setProperty("--dialogue-text", settings.textColor);
  elements.dialogue.style.setProperty("--dialogue-accent", settings.accentColor);
  elements.dialogue.style.setProperty("--dialogue-font-size", `${settings.fontSize}px`);
  elements.dialogue.style.width = `${settings.panelWidth}px`;
  elements.dialogue.style.height = settings.collapsed ? "58px" : `${settings.panelHeight}px`;
  elements.dialogue.style.transform = `translate(${settings.panelX}px, ${settings.panelY}px)`;
  elements.dialogue.classList.toggle("is-collapsed", settings.collapsed);
  elements.dialogue.classList.toggle("is-disabled", !settings.enabled);

  elements.speaker.textContent = current?.speaker || "等待消息";
  elements.title.textContent = current?.title || "";
  elements.text.textContent = state.visibleText || "连接 SealChat 桥接消息流后，这里会显示 CRPG 样式的实时对话。";
  elements.avatar.src = current?.avatar || settings.avatarUrl || createPlaceholderAvatar(settings.accentColor);
  elements.status.textContent = state.error || (current ? `正在显示：${current.speaker}` : "等待 SealChat 消息流");
  hydrateSettings(settings);
  requestAnimationFrame(() => autoScrollText());
}

function hydrateSettings(settings) {
  app.querySelectorAll("[data-setting]").forEach((input) => {
    const key = input.dataset.setting;
    if (key === "bridgeUrl") {
      input.value = localStorage.getItem("crpgView.bridgeUrl") || "";
      return;
    }
    if (!(key in settings)) return;
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

function playSample() {
  controller.receiveDebugMessage({
    speaker: "星尘",
    title: "SealChat CRPG View",
    avatar: latestState?.settings.avatarUrl || "",
    text: "1111——这是一条来自 CRPG View 的示例消息。长文字会随着打字机效果逐字出现，并在内容超过高度时自动滚动。点击 Skip 可以立即加载全部文本；拖动面板顶部可移动，拖动右下角可调整长宽高。"
  });
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
