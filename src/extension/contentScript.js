const ROOT_ID = "crpg-view-extension-root";
const SETTINGS_KEY = "settings";

(async function bootCrpgViewExtension() {
  if (window.__crpgViewExtension) return;
  window.__crpgViewExtension = { ready: false };

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = await fetch(chrome.runtime.getURL("styles/main.css")).then((response) => response.text());
  const app = document.createElement("main");
  app.id = "app";
  app.style.pointerEvents = "auto";
  shadow.append(style, app);

  const { settings } = await chrome.storage.local.get({ [SETTINGS_KEY]: {} });
  const storage = createExtensionStorage(settings);
  const { mountCrpgView } = await import(chrome.runtime.getURL("src/ui/overlayApp.js"));
  const api = mountCrpgView(app, {
    storage,
    initialSettings: settings,
    autoPlaySample: false
  });

  window.__crpgViewExtension = { ready: true, api, host };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    if (message.type === "crpg-view.toggle-settings") {
      api.toggleSettings();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "crpg-view.update-settings") {
      storage.mergeSettings(message.settings || {});
      api.updateSettings(message.settings || {});
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "crpg-view.destroy") {
      api.destroy();
      host.remove();
      delete window.__crpgViewExtension;
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();

function createExtensionStorage(initialSettings) {
  let settings = { ...initialSettings };
  return {
    getItem(key) {
      if (key !== "crpgView.settings") return null;
      return JSON.stringify(settings);
    },
    setItem(key, value) {
      if (key !== "crpgView.settings") return;
      settings = JSON.parse(value || "{}");
      chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    },
    mergeSettings(nextSettings) {
      settings = { ...settings, ...nextSettings };
      chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }
  };
}
