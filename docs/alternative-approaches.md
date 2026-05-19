# Auto-Accept Agent: Alternative Approaches Research

> Research date: 2026-04-01  
> AG version: 1.107.0 (IDE 1.21.9)

## Problem Statement

The cascade agent's file edit tool calls get stuck in the "Editing 1 file" state in secondary 
workspaces (e.g., WetWijzer). The VS Code command API cannot reach the cascade's internal 
approval flow because it runs inside an isolated jetskiAgent webview.

**Critical finding**: Even our own Gemini agent tools (`write_to_file`) hang when targeting a 
different workspace — proving this is a system-level file access/approval issue, not just a 
webview button problem.

---

## Approach 1: Chrome DevTools Protocol (CDP)

**How it works**: Community extensions connect directly to AG's internal browser runtime via CDP 
websockets to monitor and manipulate the DOM.

### Implementation
1. Launch AG with `--remote-debugging-port=9222`
2. Hit `http://127.0.0.1:9222/json/list` to discover debuggable targets
3. Connect via WebSocket to jetskiAgent webview targets
4. Inject a `MutationObserver` that watches for approval buttons
5. Auto-click "Accept", "Run", "Allow" buttons when detected

### Button Patterns
```javascript
const ACCEPT_PATTERNS = [
    { text: /^Accept$/i, context: 'accept-edit' },
    { text: /^Accept All$/i, context: 'accept-all' },
    { text: /^Run$/i, context: 'run-command' },
    { text: /^Allow$/i, context: 'allow-access' },
    { text: /^Always Allow$/i, context: 'always-allow' },
    { text: /^Continue$/i, context: 'continue' },
];
```

### Pros
- Works for ALL approval types (file edits, terminal, file access)
- Resilient to command registry changes between AG versions
- Community-proven approach
- Operates at the DOM level — same as a human clicking buttons

### Cons
- Requires AG restart with `--remote-debugging-port` flag
- Need to create custom launcher/shortcut
- Slightly more complex (WebSocket connection management, target discovery)
- Button text changes between AG versions could break matching

### Community Examples
- **"Antigravity Auto Accept"** by pesosz (Open VSX Registry)
- **"YoloMode"** extension
- **"Antigravity Greenlight"**

### Status: CDP module created at `lib/cdp-auto-accept.js`

---

## Approach 2: Source-Level Patch (AcceptCascadeStep)

**How it works**: Inject code directly into AG's bundled JavaScript to auto-dispatch the 
"AcceptCascadeStep" action when a step enters the WAITING state.

### Implementation
The cascade step acceptance flow in `jetskiAgent/main.js`:
```
AcceptCascadeStep → sendUserInteraction() → host processes → file written
```

The React component that renders the "Accept" button receives:
- `status === Da.WAITING` — step is waiting for user approval
- `sendUserInteraction` — function to dispatch accept/reject

A patch would auto-call `sendUserInteraction` with the accept action immediately 
when the component mounts with `status === WAITING`, similar to how our existing 
`filePermission` patch works:
```javascript
/*AAA:autostep*/setTimeout(()=>sendAccept(), 0); return null;
```

### Key Code Locations
| Identifier | Offset | Purpose |
|---|---|---|
| `AcceptCascadeStep` (jetskiAgent) | 7905911 | Enum value definition |
| `acceptCascadeStep` (jetskiAgent) | 8456998 | React component handling |
| `CASCADE_CHAT_CLIENT_ACCEPT_CASCADE_STEP` | 10935114 | Command ID mapping |
| `ACKNOWLEDGE_CASCADE_CODE_EDIT` | 7171259 | Telemetry event |

### Command ID Mapping (workbench)
```
acceptCascadeStep → "antigravity.agent.acceptAgentStep"
rejectCascadeStep → "antigravity.agent.rejectAgentStep"
```

Note: These IDs ARE in the workbench source but may not be registered as VS Code commands 
until the agent panel activates — explaining why they weren't found in the command scan.

### Pros
- No external dependencies or special launch flags
- Works immediately after patching
- Already have the patching infrastructure (`lib/auto-run-patcher.js`)

### Cons
- **Fragile**: Breaks on every AG update (code offsets change)
- **Risky**: Source patches can cause blank screen if corrupted
- Requires reverse-engineering minified React component tree
- Checksum mismatch triggers "corrupt installation" warning

---

## Approach 3: Native AG Settings

**How it works**: Use built-in AG settings to reduce/eliminate approval prompts.

### Available Settings

| Setting Key | Values | Default | Effect |
|---|---|---|---|
| Terminal Allow List | Command prefixes | Empty | Auto-execute matching commands |
| Terminal Deny List | Command prefixes | Empty | Block matching commands |
| Artifact Review Policy | "Always Proceed" / "Request Review" | "Request Review" | Skip plan review |
| `chat.tools.terminal.blockDetectedFileWrites` | `"never"`, `"outsideWorkspace"`, `"all"` | `"outsideWorkspace"` | Blocks file writes outside workspace |
| `chat.editing.confirmEditRequestRemoval` | boolean | `true` | Confirm before removing edits |

### Critical Discovery: `blockDetectedFileWrites`
The setting `chat.tools.terminal.blockDetectedFileWrites` defaults to `"outsideWorkspace"`. 
This may be intercepting and blocking file writes to paths outside the current workspace.

### How to Apply
In `settings.json` or via Settings UI:
```json
{
    "chat.tools.terminal.blockDetectedFileWrites": "never",
    "chat.editing.confirmEditRequestRemoval": false
}
```

### Pros
- Native AG feature, no hacking required
- Survives AG updates
- Easy to configure

### Cons
- May not cover all approval types
- Some settings may not exist in all AG versions
- The cascade step approval is NOT controlled by any known setting

---

## Approach 4: Webview Message Injection

**How it works**: Use VS Code's webview API to postMessage directly to the jetskiAgent panel.

### Implementation Concept
```javascript
// From extension context:
const panels = vscode.window.tabGroups.all.flatMap(g => g.tabs);
// Find the agent panel and access its webview
// Send: { type: "AcceptCascadeStep" } 
```

### Pros
- Uses VS Code's official extension API
- No CDP port needed
- Lighter than source patches

### Cons
- VS Code extensions can't access other extensions' webview panels
- The jetskiAgent webview is owned by AG's built-in extension — inaccessible from 3rd party
- Would require patching the webview host to expose a message channel

---

## Approach 5: Keyboard Shortcut Simulation

**How it works**: The cascade has a keybinding for `acceptCascadeStep`. Simulate that 
keystroke programmatically.

### Implementation
The jetskiAgent source shows:
```
i?.getKeybindingLabel("acceptCascadeStep")
```
This means there IS a keybinding. The workbench maps it to `antigravity.agent.acceptAgentStep`.
If we could find the default keybinding and simulate it, it might work.

### Pros
- Simple concept

### Cons
- Keybinding might not be assigned by default
- Simulating keystrokes from an extension is hacky and unreliable
- May require focus on the cascade panel

## ✅ SOLUTION FOUND: Native AG Setting

The root cause was the **"Agent Non-Workspace File Access"** setting, which defaults to `false`.

### Setting Details

| Setting | Internal Key | Default | Fix |
|---|---|---|---|
| **Agent Non-Workspace File Access** | `allowAgentAccessNonWorkspaceFiles` | `false` | Set to `true` |
| Cached key | `cached.allowAgentAccessNonWorkspaceFiles` | `false` | Auto-set |

### How to Enable
**Settings UI**: Antigravity Settings → File Access → "Agent Non-Workspace File Access" → Toggle ON

### What It Does
When disabled (default), the cascade agent cannot view or edit files outside the current 
workspace folder. This caused the "Editing 1 file +0 -0" stuck state when:
- The agent conversation was in workspace A but tried to edit files in workspace B
- Cross-workspace file edits from Gemini tools hung indefinitely
- The cascade's diff engine couldn't compute changes for restricted files

### Other Useful Settings (from the AG Settings UI)

| Setting | Effect |
|---|---|
| Agent Gitignore Access | Allow agent to view/edit .gitignore files |
| Auto-Open Edited Files | Open files in background when agent edits them |
| Agent Auto-Fix Lints | Agent auto-fixes lint errors from its own edits |

---

## Recommendation (Updated)

**Primary fix**: Enable `allowAgentAccessNonWorkspaceFiles` in AG Settings UI ← **THIS SOLVED IT**  
**Complementary**: CDP module for auto-clicking approval buttons (terminal, file access prompts)  
**Complementary**: Source patch for auto-run terminal commands  
**Avoid**: `blockDetectedFileWrites` setting alone was insufficient

### Immediate Action Items
1. ✅ Enable "Agent Non-Workspace File Access" in AG Settings
2. ✅ Launch AG with `--remote-debugging-port=9222` for CDP support
3. ✅ Install auto-accept extension v2.9.5 with CDP integration
