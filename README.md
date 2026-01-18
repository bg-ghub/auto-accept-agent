# Auto Accept Agent

**Simple, safe, and private auto-accept for Antigravity Agent.**

Automatically accepts Antigravity agent steps without limits. No tracking, no network calls, no paid features.

## ✨ Features

- ✅ **Auto-accepts agent steps** - Hands-free automation
- 🛡️ **Safety protection** - Blocks dangerous commands like `rm -rf /`
- 🔒 **100% Private** - Zero network calls, zero telemetry
- ⚡ **Lightweight** - Simple, fast, no dependencies
- 🎯 **Native integration** - Uses Antigravity's built-in commands

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
- `✅ Auto Accept: ON` - All agent steps are being auto-accepted
- `🛑 Auto Accept: OFF` - Manual approval required

## 🛡️ Safety Features

The extension blocks dangerous commands by default:
- `rm -rf /`, `rm -rf ~`, `rm -rf *`
- `format c:`, `del /f /s /q`
- Fork bombs and disk operations
- And more...

### Edit Banned Commands
Use the Command Palette (`Ctrl+Shift+P`) and run:
- `Auto Accept: Edit Banned Commands` - Customize blocked patterns
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

## ⭐ Support

If you find this useful, consider giving it a star on GitHub!