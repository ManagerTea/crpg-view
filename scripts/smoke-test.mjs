import assert from "node:assert/strict";
import {
  createEmbedUrl,
  createHandshakeMessage,
  normalizeBridgeEvent,
  normalizeBridgeMessage
} from "../src/adapter/sealchatBridge.js";
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
const decoded = normalizeBridgeMessage({ id: "m2", text: "&lt;遥名玖玖里&gt;掷出了 d5=3", title: "undefined" });
assert.equal(decoded.title, "");
assert.equal(decoded.text, "<遥名玖玖里>掷出了 d5=3");
assert.equal(colorsAreSimilar("#111111", "#151515"), true);
assert.equal(colorsAreSimilar("#000000", "#ffffff"), false);

const nonce = "n1";
assert.deepEqual(createHandshakeMessage(nonce), {
  type: "sealchat.bridge.handshake",
  version: 1,
  nonce,
  want: ["roles", "messages"],
  currentChannelOnly: true
});
assert.equal(createEmbedUrl("https://chat.example.test/root/"), "https://chat.example.test/root?embed=obr");
assert.deepEqual(normalizeBridgeEvent({
  type: "sealchat.bridge.handshake.ack",
  version: 1,
  nonce,
  ok: true,
  channelId: "c1"
}), {
  kind: "handshake-ack",
  version: 1,
  nonce,
  ok: true,
  worldId: "",
  channelId: "c1"
});
const bridgeMessage = normalizeBridgeEvent({
  type: "sealchat.bridge.message",
  event: "message-created",
  messageId: "bm1",
  identityId: "r1",
  contentText: "公开 IC",
  icMode: "ic",
  isWhisper: false
});
assert.equal(bridgeMessage.kind, "message-created");
assert.equal(bridgeMessage.message.id, "bm1");
assert.equal(bridgeMessage.message.identityId, "r1");
assert.equal(normalizeBridgeEvent({
  type: "sealchat.bridge.message",
  event: "message-created",
  messageId: "hidden",
  contentText: "悄悄话",
  icMode: "ic",
  isWhisper: true
}), null);

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
controller.receiveDebugEvent({
  kind: "roles-snapshot",
  roles: [{ identityId: "r1", displayName: "星尘", color: "#ff3038", avatarUrl: "avatar.png" }]
});
controller.receiveDebugEvent({
  kind: "message-created",
  message: { id: "queued", identityId: "r1", text: "BC::DE" }
});
assert.equal(lastState.isTyping, true);
assert.equal(lastState.current.speaker, "星尘");
assert.equal(lastState.current.avatar, "avatar.png");
controller.receiveDebugEvent({
  kind: "roles-snapshot",
  roles: [{ identityId: "r1", displayName: "星尘", color: "#ff3038", avatarUrl: "new-avatar.png" }]
});
assert.equal(lastState.current.avatar, "new-avatar.png");
timers.shift()();
assert.equal(lastState.visibleText, "B");
controller.skip();
assert.equal(lastState.visibleText, "BC");
assert.equal(lastState.pageCount, 2);
controller.receiveDebugEvent({ kind: "message-updated", message: { id: "queued", text: "FG" } });
assert.equal(lastState.visibleText, "");
controller.receiveDebugEvent({ kind: "message-deleted", messageId: "queued" });
assert.equal(lastState.current, null);
controller.receiveDebugEvent({ kind: "message-created", message: { id: "stay", text: "Z" } });
timers.shift()();
assert.equal(lastState.visibleText, "Z");
assert.equal(lastState.current.id, "stay");
assert.equal(lastState.isWaiting, false);
controller.updateSettings({ panelWidth: 100 });
assert.equal(lastState.settings.panelWidth, 360);
controller.dispose();

console.log("smoke tests passed");
