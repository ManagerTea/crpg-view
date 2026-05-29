chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ settings: {} }, ({ settings }) => {
    chrome.storage.local.set({
      settings: {
        enabled: true,
        typingSpeed: 50,
        fontSize: 24,
        endDelay: 4,
        backgroundColor: "#111824",
        textColor: "#f5f0ff",
        accentColor: "#ff3038",
        ...settings
      }
    });
  });
});
