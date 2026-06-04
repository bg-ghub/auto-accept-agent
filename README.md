# Auto Accept Agent

**Simple, safe, and private auto-accept for Antigravity Agent.**

Automatically accepts Antigravity agent steps without limits. No tracking, no network calls, no paid features.

## ✨ Features

- ✅ **Auto-accepts agent steps** — Hands-free automation via polling + CDP
- 🛡️ **Safety protection** — Blocks dangerous commands like `rm -rf /`
- 🔒 **100% Private** — Zero network calls, zero telemetry
- ⚡ **Lightweight** — Simple, fast, minimal dependencies
- 🎯 **Native integration** — Uses Antigravity's built-in commands
- 🔧 **Source patcher** — Auto-approves file access and terminal execution
- 🔄 **Auto-retry** — Automatically retries when agent errors occur
- 📡 **CDP injection** — Real-time DOM observation for instant acceptance
- ⚙️ **Quick Settings** — Configure everything from the command palette

## 🏗️ Architecture

The extension uses a **three-layer** approach for maximum reliability:

1. **Command Polling** (primary) — Fires VS Code/AG commands at regular intervals to accept agent steps, terminal commands, suggestions, and notifications
2. **CDP Auto-Accept** (enhanced) — Connects via Chrome DevTools Protocol to observe the agent panel DOM in real-time. Detects and clicks Accept/Retry/Continue buttons instantly
3. **Source Patcher** (optional) — Patches AG's source files to auto-confirm terminal execution policy and auto-approve file access requests

## 🔄 Compatibility

| AG IDE Version | Extension | Status |
|---------------|-----------|--------|
| 1.21.9 | v2.x | ✅ Fully supported |
| 2.0.1 | v3.5.0 | ✅ Path discovery fix |
| 2.0.2 | v3.6.0 | ✅ Command + regex fix |
| 2.0.3 | v3.6.0 | ✅ No changes needed |
| 2.0.4 | v3.6.0 | ✅ No changes needed |

**Standalone Antigravity 2.0** (non-IDE): Detected as `modern` architecture. Source patching is skipped; polling + CDP handle everything.

## 🚀 Installation

### Option 1: Install from VSIX
```bash
# Install the extension
antigravity-ide --install-extension auto-accept-agent-3.6.0.vsix --force

# Fix stripped ws module (required for CDP)
cp -r node_modules/ws ~/.antigravity-ide/extensions/bg-ghub.auto-accept-agent-3.6.0/node_modules/ws
```

### Option 2: Build from Source
```bash
git clone https://github.com/bg-ghub/auto-accept-agent.git
cd auto-accept-agent
npm install
npx @vscode/vsce package --no-dependencies
```
Then install the generated `.vsix` file as described above.

> **Note:** Antigravity's `--install-extension` CLI strips `node_modules` during extraction. You must manually copy the `ws` module after every install for CDP to work.

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+Shift+U` | Toggle Auto-Accept ON/OFF |
| `Cmd+Alt+Shift+U` (Mac) | Toggle Auto-Accept ON/OFF |

## 📖 Usage

1. Install the extension
2. Reload/restart Antigravity IDE
3. The extension activates automatically (✅ Auto-Accept: ON)
4. Launch an Agent task and sit back!

The status bar shows the current state:
- `✅ Auto Accept: ON (AG 2.0) | CDP ✓` — Running with CDP connected on AG 2.0
- `✅ Auto Accept: ON (patched) | CDP ✓` — Running with source patch + CDP
- `⚠️ Auto Accept: ON (not patched)` — Polling only, no CDP
- `🚫 Auto Accept: OFF` — Paused

### Commands Available

Use the Command Palette (`Ctrl+Shift+P`) and type "Auto Accept":

| Command | Description |
|---------|-------------|
| `Toggle ON/OFF` | Enable/disable auto-accept |
| `Quick Settings` | Open settings panel |
| `Apply Auto-Run Fix` | Apply source patches (legacy AG only) |
| `Revert Auto-Run Fix` | Remove source patches |
| `CDP Status` | Show CDP connection details |
| `Run Diagnostics` | Full diagnostic report |
| `Discover Antigravity Commands` | Scan AG command registry |
| `Edit Banned Commands` | Customize blocked patterns |
| `Reset Banned Commands` | Restore defaults |

## ⚙️ Settings

Configure via **Settings > Extensions > Auto Accept Agent** or search `auto-accept` in settings.

| Setting | Default | Description |
|---------|---------|-------------|
| `auto-accept.enabled` | `true` | Enable/disable auto-accept |
| `auto-accept.pollingInterval` | `500` | Polling interval in ms (100-5000) |
| `auto-accept.acceptAgentSteps` | `true` | Auto-accept agent steps and hunks |
| `auto-accept.acceptRunCommands` | `true` | Auto-run terminal commands |
| `auto-accept.acceptTerminalCommands` | `true` | Auto-accept terminal suggestions |
| `auto-accept.acceptSuggestions` | `true` | Auto-accept inline completions |
| `auto-accept.acceptEditBlocks` | `true` | Auto-accept inline chat edits |
| `auto-accept.acceptAll` | `true` | Accept all pending file edits |
| `auto-accept.autoRetryOnError` | `true` | Auto-retry on agent errors |
| `auto-accept.bannedCommands` | [...] | Dangerous patterns to block |
| `auto-accept.cdpEnabled` | `true` | Enable CDP auto-accept |
| `auto-accept.debugLogging` | `false` | Verbose debug output |

## 📡 CDP Auto-Accept

For enhanced performance, launch AG IDE with remote debugging enabled:

```bash
# Windows
"Antigravity IDE.exe" --remote-debugging-port=9333

# macOS
open -a "Antigravity IDE" --args --remote-debugging-port=9333
```

CDP provides:
- **Instant** button detection (no polling delay)
- **Retry/Continue** button auto-clicking
- **Error state** detection and recovery
- **DOM observation** via MutationObserver injection

## 🔧 Source Patcher

The patcher modifies AG's bundled JS files to:

1. **Auto-confirm terminal execution** — When "Always Proceed" is set, auto-confirms without manual click
2. **Auto-approve file access** — Automatically approves file access requests for user-owned paths
3. **Force auto-scroll** — Keeps chat panels scrolled to bottom

Patches are applied via `Ctrl+Shift+P → Auto Accept: Apply Auto-Run Fix` and can be reverted at any time.

> **AG IDE 2.0.2+:** The autorun patch is no longer applicable — `antigravity.acceptAgentStep` command handles terminal acceptance natively. File access patching still works.

## 🛡️ Safety Features

The extension blocks dangerous commands by default:
- `rm -rf /`, `rm -rf ~`, `rm -rf *`
- `format c:`, `del /f /s /q`
- Fork bombs and disk operations

Patterns support:
- **Plain text**: `rm -rf /` (case-insensitive substring match)
- **Regex**: `/sudo\s+rm/i` (regular expression)

## ❓ FAQ

**Q: Is this safe to use?**
A: The extension only accepts steps that Antigravity Agent proposes. It blocks dangerous commands automatically. Review agent behavior periodically.

**Q: Can I pause it temporarily?**
A: Yes! Click the status bar item or press `Ctrl+Alt+Shift+U`.

**Q: Does it work when the window is minimized?**
A: Yes! Command polling works in the background. CDP requires the window to be running.

**Q: Does it phone home or track me?**
A: No! Zero network calls, zero telemetry. Everything stays local.

**Q: Does it work with AG standalone 2.0?**
A: Yes. The patcher detects the standalone architecture and skips source patching. Polling and CDP work normally.

## ⭐ Support

If you find this useful, consider giving it a star on [GitHub](https://github.com/bg-ghub/auto-accept-agent)!