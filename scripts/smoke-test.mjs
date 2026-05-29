import assert from "node:assert/strict";
import { normalizeBridgeMessage } from "../src/adapter/sealchatBridge.js";
import { colorsAreSimilar, createCrpgController } from "../src/plugin/crpgController.js";

const normalized = normalizeBridgeMessage({
  type: "sealchat:crpg",
  payload: {
    messageId: "m1",
    characterName: "星尘",
    content: "测试消息",
    portrait: "avatar.png"
  }
});
assert.equal(normalized.id, "m1");
assert.equal(normalized.speaker, "星尘");
assert.equal(normalized.text, "测试消息");
assert.equal(normalized.avatar, "avatar.png");
assert.equal(colorsAreSimilar("#111111", "#151515"), true);
assert.equal(colorsAreSimilar("#000000", "#ffffff"), false);

const memory = new Map();
const storage = {
  getItem: (key) => memory.get(key) || null,
  setItem: (key, value) => memory.set(key, value)
};
const timers = [];
const clock = {
  setTimeout(callback) {
    timers.push(callback);
    return callback;
  },
  clearTimeout() {}
};
const controller = createCrpgController({ storage, clock });
let lastState;
controller.subscribe((state) => {
  lastState = state;
});
controller.receiveDebugMessage({ speaker: "A", text: "BC" });
assert.equal(lastState.isTyping, true);
timers.shift()();
assert.equal(lastState.visibleText, "B");
controller.skip();
assert.equal(lastState.visibleText, "BC");
controller.updateSettings({ panelWidth: 100 });
assert.equal(lastState.settings.panelWidth, 360);
controller.dispose();

console.log("smoke tests passed");
