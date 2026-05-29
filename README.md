# crpg-view

`crpg-view` is a standalone browser overlay for SealChat CRPG-style live dialogue. It is intended for sessions that do not have an external VTT platform such as Owlbear or FVTT, while still consuming SealChat's external embed bridge message stream.

## Run locally

```bash
npm run dev
```

Then open <http://localhost:5173>. The page plays a built-in sample message on load so the overlay can be tested before SealChat is connected.

## Bridge inputs

The adapter listens for all of the following:

1. `window.postMessage(...)` payloads.
2. `BroadcastChannel("sealchat:crpg-bridge")` payloads.
3. Optional EventSource or WebSocket URL configured with `?bridgeUrl=...` or in the settings drawer.

Accepted payload examples:

```js
window.postMessage({
  type: "sealchat:crpg",
  payload: {
    speaker: "星尘",
    text: "1111",
    avatar: "https://example.test/avatar.png"
  }
});
```

```js
new BroadcastChannel("sealchat:crpg-bridge").postMessage({
  characterName: "星尘",
  content: "一条 SealChat IC 消息。",
  portrait: "https://example.test/avatar.png"
});
```

## Features

- CRPG-style floating dialogue panel with portrait, speaker name, title, and body text.
- Typewriter playback with an always-available `Skip` action.
- Automatic text scrolling for long dialogue.
- Collapsible, draggable, and resizable panel.
- Settings for enabled state, bridge URL, typing speed, font size, colors, end delay, and fallback avatar.
- Confirmation warning when text and background colors are too similar.
