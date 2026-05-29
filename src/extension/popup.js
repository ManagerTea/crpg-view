chrome.storage.local.get({ settings: {} }, ({ settings }) => {
  document.querySelector('[data-setting="showPageControls"]').checked = Boolean(settings.showPageControls);
});

document.addEventListener("change", async (event) => {
  const input = event.target.closest('[data-setting="showPageControls"]');
  if (!input) return;
  const settings = await updateSettings({ showPageControls: input.checked });
  await sendToActiveTab({ type: "crpg-view.update-settings", settings });
  setStatus(input.checked ? "页面内设置入口已显示。" : "页面内设置入口已隐藏。");
});

document.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "options") {
    chrome.runtime.openOptionsPage();
    return;
  }
  const response = await sendToActiveTab({ type: "crpg-view.toggle-settings" });
  setStatus(response?.ok ? "已发送。" : "发送失败。");
});

async function updateSettings(patch) {
  const { settings } = await chrome.storage.local.get({ settings: {} });
  const nextSettings = { ...settings, ...patch };
  await chrome.storage.local.set({ settings: nextSettings });
  return nextSettings;
}

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("没有可用的活动标签页。");
    return null;
  }
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        setStatus("当前页面尚未注入内容脚本，请刷新页面后重试。");
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

function setStatus(message) {
  document.querySelector('[data-role="status"]').textContent = message;
}
