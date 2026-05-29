chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ settings: {} }, ({ settings }) => {
    chrome.storage.local.set({
      settings: {
        enabled: true,
        showSealChatFrame: false,
        showPageControls: false,
        typingSpeed: 50,
        fontSize: 24,
        portraitMaxHeight: 400,
        endDelay: 4,
        backgroundColor: "#111824",
        textColor: "#f5f0ff",
        accentColor: "#ff3038",
        ...settings
      }
    });
  });
});
