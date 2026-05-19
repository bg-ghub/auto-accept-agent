# Auto-Accept Agent: AG 1.21.9 Research & Architecture Analysis

> Research date: 2026-04-01  
> AG version: 1.107.0 (IDE 1.21.9)

## The Core Problem

File edits initiated by the cascade agent get stuck ("Editing 1 file" spinner + "+0" changes) in secondary workspaces. Edits work fine in the primary workspace where the Gemini conversation runs, but hang in other AG windows (e.g., WetWijzer).

## Root Cause: Two Different Edit Pipelines

### Pipeline 1: Gemini Agent Tools (works)
When `write_to_file` / `replace_file_content` are used by the Gemini agent (this conversation), they write **directly to the filesystem** via the extension host. No approval is needed — the file is created/modified immediately. This is why edits always work in the current workspace.

### Pipeline 2: Cascade Panel Tools (broken)
When the cascade panel's AI agent uses edit tools, the flow is:
1. Agent decides to edit/create a file
2. AG stages the edit as a pending diff in the **jetskiAgent webview** (React app)
3. The webview shows "Editing 1 file" with a spinner
4. The webview waits for **user approval** (click "Accept" button inside the webview)
5. Only after approval does AG write the file to disk

**The approval happens inside the jetskiAgent webview's React UI, NOT through VS Code commands.**

## What We Tried (and Why It Failed)

### VS Code Commands — All No-Op on Cascade Edits

| Command | Exists? | Effect on Cascade Edits |
|---|---|---|
| `antigravity.agent.acceptAgentStep` | ❌ Removed in 1.21.9 | N/A |
| `antigravity.terminalCommand.run` | ❌ Removed in 1.21.9 | N/A |
| `antigravity.terminalCommand.accept` | ❌ Removed in 1.21.9 | N/A |
| `antigravity.command.accept` | ❌ Removed in 1.21.9 | N/A |
| `chatEditing.acceptFile` | ✅ | **No effect** — targets VS Code's native chat editing, not jetskiAgent |
| `chatEditing.acceptAllFiles` | ✅ | **No effect** — same reason |
| `antigravity.prioritized.agentAcceptFocusedHunk` | ✅ | **No effect** — targets diff hunks in the editor, not webview |
| `antigravity.prioritized.agentAcceptAllInFile` | ✅ | **No effect** — same |
| `workbench.files.action.acceptLocalChanges` | ✅ | **No effect** — wrong context |
| `workbench.action.chat.acceptTool` | ❌ Not registered as VS Code command | N/A |
| `quickInput.accept` | ✅ | **Auto-clicks command palette** — destructive side effect! |

All commands return `ok: true` (no error) but have **zero effect** on the cascade's pending edit because the cascade runs in an isolated webview.

### Source Patches — Partial (filePermission only)

The source patches inject code into `jetskiAgent/main.js` at the `filePermission` case handler. This auto-approves the file access permission prompt. However:

- In AG 1.21.9, the **file edit tool approval** goes through a DIFFERENT code path than `filePermission`
- The `filePermission` handler is for "Allow access to /path/to/file?" — NOT for "Accept this file edit?"
- The edit approval is a React component with an "Accept" button that we cannot click from outside the webview

## How It Actually Works (Internal Architecture)

### JetskiAgent Command Map (inside webview)
```
ACCEPT_STEP: {id: "antigravity.agent.acceptAgentStep"}
COMMAND_ACCEPT: {id: "antigravity.command.accept"}  
COMMAND_REJECT: {id: "antigravity.command.reject"}
TERMINAL_COMMAND_*: {id: "antigravity.terminalCommand.*"}
```

These commands exist as **webview-internal message types**, not VS Code commands. They're registered inside the jetskiAgent React app and dispatched via `postMessage()` between the webview and the host. When we call `vscode.commands.executeCommand("antigravity.agent.acceptAgentStep")` from our extension, VS Code doesn't find it because it's not in the main command registry — it lives inside the webview's isolated context.

### Message Flow
```
Extension Host (our extension)
    ↓ vscode.commands.executeCommand(...)
VS Code Command Registry  ← Commands NOT registered here
    ✗ (command not found or no-op)

Actual flow for accepting cascade edits:
jetskiAgent webview (React) 
    → onClick handler on Accept button
    → dispatch({type: "AcceptCascadeStep", ...})
    → postMessage to host
    → Host writes file to disk
```

## Community Approach: CDP (Chrome DevTools Protocol)

Community extensions (e.g., "Antigravity Auto Accept", "YoloMode") solve this by:

1. Launching AG with `--remote-debugging-port=9333`
2. Connecting to the webview via CDP websocket
3. Using `MutationObserver` to detect when approval buttons appear
4. Programmatically clicking the "Accept" / "Run" buttons via CDP

This works because CDP can interact directly with the webview's DOM, reaching the React components that VS Code commands cannot.

## AG Native Settings

| Setting | Purpose | Controls cascade edits? |
|---|---|---|
| Terminal Allow/Deny List | Auto-execute specific terminal commands | ❌ No |
| Artifact Review Policy | Skip plan review ("Always Proceed") | ❌ No |
| `cascadeAutoExecutionPolicy` | Not a real AG setting key | ❌ No |
| File access restriction | Workspace-only file access | Partially via source patch |

**There is NO native AG setting to auto-approve cascade file edit tool calls.**

## Options Going Forward

### Option A: CDP Integration (Best)
Add CDP support to the auto-accept extension:
- Launch AG with `--remote-debugging-port=9333`
- Connect via websocket to the jetskiAgent webview
- Monitor DOM for "Accept" buttons using MutationObserver
- Auto-click when detected
- **Pros**: Works for ALL approval types, resilient to command registry changes
- **Cons**: Requires AG restart with flag, more complex implementation

### Option B: Source Patch the Accept Flow
Extend the source patcher to patch the cascade step acceptance flow directly:
- Find the React component that renders the "Accept" button
- Inject code that auto-dispatches the accept action on mount
- **Pros**: No CDP needed, works without special launch flags
- **Cons**: Fragile (breaks on AG updates), requires reverse engineering the React component tree

### Option C: Webview Message Injection
Use the VS Code webview API to send postMessage directly to the jetskiAgent webview:
- Get a reference to the webview panel
- Send `{type: "AcceptCascadeStep"}` messages
- **Pros**: Lighter than CDP, uses official VS Code APIs
- **Cons**: May not have access to the jetskiAgent webview from extension context

## Files Modified in v2.9.4

- `extension.js`: Updated command registry for AG 1.21.9, removed dead commands, added tool approval commands (which turned out to be no-ops), removed destructive `quickInput.accept`
- Source patches: Applied with `allowAll: true` for filePermission auto-approval
- Settings: Cleaned (removed fake cascade settings)
