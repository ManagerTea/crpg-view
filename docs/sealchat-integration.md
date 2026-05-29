# SealChat bridge integration notes

The SealChat and `owlbear-sealchat-embed` repositories were not available in this container, so this plugin keeps the adapter small and tolerant instead of copying host code.

## Current assumptions

- SealChat can publish external embed CRPG messages as `postMessage` events or a `BroadcastChannel` named `sealchat:crpg-bridge`.
- A standalone browser page may optionally connect to a Server-Sent Events or WebSocket URL configured by `?bridgeUrl=...` or the settings drawer.
- Messages may be wrapped as `{ "type": "sealchat:crpg", "payload": { ... } }` or sent as the payload directly.
- Payload fields are normalized from common names: `text/content/message/body`, `speaker/name/characterName/actorName`, and `avatar/portrait/image/icon`.

If SealChat uses different field names, update `src/adapter/sealchatBridge.js`; UI and plugin logic should not need to change.
