# Auto Accept Agent

**Simple, safe, and private auto-accept for Antigravity Agent.**

Automatically accepts Antigravity agent steps without limits. No tracking, no network calls, no paid features.

## ✨ Features

- ✅ **Auto-accepts agent steps** - Hands-free automation
- 🛡️ **Safety protection** - Blocks dangerous commands like `rm -rf /`
- 🔒 **100% Private** - Zero network calls, zero telemetry
- ⚡ **Lightweight** - Simple, fast, no dependencies
- 🎯 **Native integration** - Uses Antigravity's built-in commands
- 📊 **Activity counter** - Track how many steps have been accepted
- ⚙️ **Settings UI** - Configure everything from VS Code settings
- 🔄 **Auto-retry** - Automatically retry when agent errors occur

## 🚀 Installation

### Option 1: Install from VSIX
1. Download the latest `.vsix` file from [Releases](https://github.com/bg-ghub/auto-accept-agent/releases)
2. Open Antigravity IDE
3. Go to Extensions → Click `...` menu → Install from VSIX...
4. Select the downloaded `.vsix` file
5. Restart the IDE

### Option 2: Build from Source
```bash
git clone https://github.com/bg-ghub/auto-accept-agent.git
cd auto-accept-agent
npm install -g @vscode/vsce
vsce package
```
Then install the generated `.vsix` file as described above.

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+Shift+U` | Toggle Auto-Accept ON/OFF |
| `Cmd+Alt+Shift+U` (Mac) | Toggle Auto-Accept ON/OFF |

## 📖 Usage

1. Install the extension
2. Restart Antigravity IDE  
3. The extension activates automatically (✅ Auto-Accept: ON)
4. Launch an Agent task and sit back!

The status bar shows the current state:
- `✅ Auto Accept: ON (42)` - Running with activity counter
- `🛑 Auto Accept: OFF` - Manual approval required

### Commands Available

Use the Command Palette (`Ctrl+Shift+P`) and type "Auto Accept":

| Command | Description |
|---------|-------------|
| `Auto Accept: Toggle ON/OFF` | Enable/disable auto-accept |
| `Auto Accept: Edit Banned Commands` | Customize blocked patterns |
| `Auto Accept: Reset Banned Commands` | Restore defaults |
| `Auto Accept: Reset Activity Counter` | Reset the step counter to 0 |
| `Auto Accept: Show Statistics` | View detailed stats and settings |

## ⚙️ Settings

Configure the extension from **Settings > Extensions > Auto Accept Agent** or search "auto-accept" in settings.

| Setting | Default | Description |
|---------|---------|-------------|
| `auto-accept.enabled` | `true` | Enable/disable auto-accept |
| `auto-accept.pollingInterval` | `500` | Polling interval in ms (100-5000) |
| `auto-accept.showActivityCounter` | `true` | Show counter in status bar |
| `auto-accept.autoRetryOnError` | `true` | Auto-retry on agent errors |
| `auto-accept.autoRetryDelay` | `1000` | Delay before retry in ms |
| `auto-accept.maxRetryAttempts` | `3` | Max consecutive retry attempts |
| `auto-accept.bannedCommands` | [...] | List of dangerous patterns to block |

## 🔄 Auto-Retry Feature

When enabled, the extension automatically detects when an agent execution terminates with an error and retries:

1. Detects error state in agent execution
2. Waits the configured delay (default: 1 second)
3. Automatically triggers retry
4. Stops after max attempts (default: 3) to prevent infinite loops
5. Shows notification on first retry and when max attempts reached

This is perfect for transient errors that resolve themselves on retry.

## 🛡️ Safety Features

The extension blocks dangerous commands by default:
- `rm -rf /`, `rm -rf ~`, `rm -rf *`
- `format c:`, `del /f /s /q`
- Fork bombs and disk operations
- And more...

### Customize Blocked Commands

**Option 1: Via Settings UI**
1. Open Settings (`Ctrl+,`)
2. Search for "auto-accept.bannedCommands"
3. Edit the JSON array

**Option 2: Via Command Palette**
- `Auto Accept: Edit Banned Commands` - Quick edit
- `Auto Accept: Reset Banned Commands` - Restore defaults

Patterns support:
- **Plain text**: `rm -rf /` (case-insensitive substring match)
- **Regex**: `/sudo\s+rm/i` (regular expression)

## 🔧 Requirements

- Antigravity IDE (VS Code based)

## ❓ FAQ

**Q: Is this safe to use?**  
A: The extension only accepts steps that Antigravity Agent proposes. It blocks dangerous commands automatically. Review agent behavior periodically.

**Q: Can I pause it temporarily?**  
A: Yes! Click the status bar item or press `Ctrl+Alt+Shift+U`.

**Q: Does it work when the window is minimized?**  
A: Yes! It uses native Antigravity commands that work in the background.

**Q: Does it phone home or track me?**  
A: No! Zero network calls, zero telemetry. Everything stays local.

**Q: What happens when the agent errors out?**  
A: If auto-retry is enabled (default), the extension will automatically retry up to 3 times with a 1-second delay between attempts.

**Q: How do I see how many steps were accepted?**  
A: The counter shows in the status bar (e.g., "Auto Accept: ON (42)"). Use the "Show Statistics" command for detailed info.

## ⭐ Support

If you find this useful, consider giving it a star on GitHub!