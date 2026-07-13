# Terminal Runner (Ulanzi Deck)

[![Available on Ulanzi Community Store](https://raw.githubusercontent.com/narlei/ulanzicommunitystore/main/docs/badges/ulanzi-community-store.svg)](https://ulanzicommunitystore.narlei.com)

Plugin to execute shell commands from Ulanzi Deck keys.

## Features

- Per-key command configuration.
- Multiline commands executed as a single script (preserves `cd` and shell vars between lines).
- Cross-platform command dispatch:
  - macOS: AppleScript wrapper, with iTerm2 -> Terminal.app fallback.
  - Windows: PowerShell wrapper, with `cmd.exe` fallback.
- Basic validation: non-empty command and max size guard.
- Visual feedback through action states and toast/log events.
- Optional macOS auto-close after execution (`sleep + exit`).

## Property Inspector Fields

- `Label`: text shown on the key (default: `Run`).
- `macOS Terminal`: `iTerm2` (with fallback) or `Terminal.app`.
- `Timeout (ms)`: launcher timeout from `1000` to `300000`.
- `Auto-Close (macOS)`: closes terminal after command finishes.
- `Close Delay (ms)`: wait before close, from `0` to `30000` (default: `1200`).
- `Command`: multiline script body.

## Bundle Layout

- `manifest.json`
- `index.js`
- `package.json`
- `plugin-common-node/`
- `property-inspector/terminal/inspector.html`
- `property-inspector/terminal/inspector.js`

## Install (Automatic)

From this repository root:

```bash
./install.sh
```

The script installs this plugin folder to:

`~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.ulanzideck.terminalrunner.ulanziPlugin`

It also runs `npm ci --omit=dev` to ensure `node_modules` (including `ws`) are bundled.

Then reload plugins or restart Ulanzi Deck.

## Install (Manual)

1. Copy this folder (`com.ulanzi.ulanzideck.terminalrunner.ulanziPlugin`) to:
  `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`
2. Ensure `node_modules` are present in the plugin bundle if your host runtime needs local dependencies.
3. Reload plugins or restart Ulanzi Deck.

## Notes

- `code` command on macOS resolves through native terminal wrapper.
- If iTerm2 is unavailable, plugin falls back to Terminal.app.
