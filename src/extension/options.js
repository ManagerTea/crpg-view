const DEFAULTS = {
  enabled: true,
  showSealChatFrame: false,
  showPageControls: false,
  sealChatUrl: "",
  typingSpeed: 50,
  fontSize: 24,
  portraitMaxHeight: 400,
  endDelay: 4,
  backgroundColor: "#111824",
  textColor: "#f5f0ff",
  accentColor: "#ff3038",
  avatarUrl: ""
};

chrome.storage.local.get({ settings: DEFAULTS }, ({ settings }) => hydrate({ ...DEFAULTS, ...settings }));

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-action]")?.dataset.action !== "save") return;
  const settings = readSettings();
  await chrome.storage.local.set({ settings });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "crpg-view.update-settings", settings });
  setStatus("已保存。已打开的页面可能需要刷新后重新建立 iframe handshake。");
});

function hydrate(settings) {
  document.querySelectorAll("[data-setting]").forEach((input) => {
    const value = settings[input.dataset.setting];
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value ?? "";
  });
}

function readSettings() {
  const settings = {};
  document.querySelectorAll("[data-setting]").forEach((input) => {
    settings[input.dataset.setting] = input.type === "checkbox" ? input.checked : input.value;
  });
  return settings;
}

function setStatus(message) {
  document.querySelector('[data-role="status"]').textContent = message;
}
