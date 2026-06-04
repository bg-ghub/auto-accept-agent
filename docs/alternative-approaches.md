# Alternative Approaches — Auto-Accept Implementation

> Original research: April 2026 (AG 1.21.9)
> Updated: June 2026 (AG 2.0.4)

## Problem Statement

Antigravity agent requires manual approval for file edits, terminal commands, and
file access. Multiple approaches were investigated and several are now combined
in the production extension.

---

## ✅ Approach 1: Command Polling (Primary)

**Status: ACTIVE — Core of the extension**

Fires VS Code commands at regular intervals to accept agent steps, terminal commands,
suggestions, and notifications.

### Commands Used (AG IDE 2.0.2+)

| Command | Category | Purpose |
|---------|----------|---------|
| `antigravity.acceptAgentStep` | Agent Steps | Accept cascade step (restored in 2.0.2) |
| `antigravity.prioritized.agentAcceptFocusedHunk` | Agent Steps | Accept focused diff hunk |
| `antigravity.prioritized.agentAcceptAllInFile` | Agent Steps | Accept all hunks in file |
| `chatEditing.acceptFile` | File Edits | Accept single file edit |
| `chatEditing.acceptAllFiles` | File Edits | Accept all pending file edits |
| `workbench.action.terminal.chat.runCommand` | Terminal | Run terminal chat command |
| `antigravity.acceptCompletion` | Suggestions | Accept code completion |
| `antigravity.prioritized.supercompleteAccept` | Suggestions | Accept supercomplete |
| `notification.acceptPrimaryAction` | Notifications | Accept notification (backstop) |

### Pros
- No special launch flags needed
- Works when window is minimized
- Zero external dependencies
- Resilient to DOM changes

### Cons
- Polling delay (500ms default)
- Some commands may be no-ops for webview-internal actions
- Command registry changes between AG versions

---

## ✅ Approach 2: CDP Auto-Accept (Enhanced)

**Status: ACTIVE — Complements command polling**

Connects via Chrome DevTools Protocol to observe the agent panel DOM in real-time.

### How It Works
1. AG launched with `--remote-debugging-port=9333`
2. Worker thread connects via `ws` WebSocket to webview targets
3. Injects MutationObserver that watches for approval buttons
4. Auto-clicks Accept/Run/Allow/Retry buttons when detected

### Pros
- Instant reaction (no polling delay)
- Works for ALL button-based approvals
- Error context detection prevents false retries
- Circuit breaker prevents infinite retry loops

### Cons
- Requires AG restart with CDP flag
- `ws` module must be manually copied after VSIX install
- Button text changes could break matching

---

## ✅ Approach 3: Source Patching (Supplementary)

**Status: ACTIVE — File access + auto-scroll + auto-expand**

Modifies AG's bundled JavaScript to auto-approve specific interactions.

### Active Patches
| Patch | Target | Purpose |
|-------|--------|---------|
| File Access | workbench, jetskiAgent | Auto-approve file access for user-owned paths |
| Auto-Scroll | workbench | Force auto-scroll in chat panels |
| Auto-Expand | jetskiAgent | Auto-expand "Step Requires Input" banners |

### Retired Patches
| Patch | Reason |
|-------|--------|
| Terminal Auto-Run | AG 2.0.2+ handles via `antigravity.acceptAgentStep` command |

### Pros
- No CDP or launch flags needed for file access
- Instant (runs in the React component lifecycle)

### Cons
- Breaks on AG updates (regex must be re-verified)
- Checksum mismatch warning
- Requires IDE reload after applying

---

## ✅ Approach 4: Native AG Settings

**Status: ACTIVE — Recommended first step**

Use built-in AG settings to reduce approval prompts.

### Key Settings

| Setting | Effect |
|---------|--------|
| `allowAgentAccessNonWorkspaceFiles` = `true` | Allow agent to access files outside workspace |
| Terminal Allow List | Auto-execute matching terminal commands |
| Artifact Review Policy = "Always Proceed" | Skip plan review |
| `chat.tools.terminal.blockDetectedFileWrites` = `"never"` | Don't block file writes |

### Pros
- Native, survives AG updates
- Easy to configure
- No extension needed

### Cons
- Doesn't cover all approval types (no setting for cascade step approval)

---

## ❌ Approach 5: Webview Message Injection

**Status: REJECTED**

VS Code extensions can't access other extensions' webview panels.
The jetskiAgent webview is owned by AG's built-in extension — inaccessible from 3rd party.

---

## ❌ Approach 6: Keyboard Shortcut Simulation

**Status: REJECTED**

Simulating keystrokes from an extension is unreliable and requires focus on the cascade panel.

---

## Production Architecture (v3.6.0)

The extension combines approaches 1–4 in a layered architecture:

```
Layer 1: Native Settings (baseline)
    └── Reduces approval prompts natively

Layer 2: Command Polling (500ms MAIN + 1500ms SLOW)
    └── Fires VS Code commands to accept steps/edits/suggestions

Layer 3: CDP DOM Observer (real-time)
    └── Watches webview DOM for buttons, auto-clicks

Layer 4: Source Patches (one-time)
    └── Auto-approves file access, forces auto-scroll
```

Each layer compensates for gaps in the others, providing near-100% automation coverage.
