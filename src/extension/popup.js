document.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "options") {
    chrome.runtime.openOptionsPage();
    return;
  }
  const type = "crpg-view.toggle-settings";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return setStatus("没有可用的活动标签页。");
  chrome.tabs.sendMessage(tab.id, { type }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus("当前页面尚未注入内容脚本，请刷新页面后重试。");
      return;
    }
    setStatus(response?.ok ? "已发送。" : "发送失败。");
  });
});

function setStatus(message) {
  document.querySelector('[data-role="status"]').textContent = message;
}
