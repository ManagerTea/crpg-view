# Browser extension usage

This project now includes a Manifest V3 browser extension build. Load the repository root as an unpacked extension in Chrome/Edge-compatible browsers.

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose **Load unpacked**.
4. Select the repository root directory containing `manifest.json`.

## Use

- The content script injects the CRPG floating overlay into normal web pages.
- Click the extension action popup to play a sample dialogue or open the overlay settings.
- Open the extension options page to configure the SealChat URL, colors, type speed, font size, and iframe visibility.
- The overlay loads the configured SealChat URL as `{SealChat URL}?embed=obr` and starts the bridge handshake from the injected page.

## Notes

- Some browser internal pages, web stores, and restricted pages do not allow extension content scripts.
- After changing the SealChat URL, refresh already-open pages so the iframe bridge can be recreated cleanly.
