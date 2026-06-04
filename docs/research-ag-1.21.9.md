# AG 1.21.9 → 2.0.x Architecture Research

> Original research: April 2026 (AG 1.21.9)
> Updated: June 2026 (AG 2.0.4)

## Background

This document captures the research into how Antigravity handles agent step approval
and file access, which informed the design of the Auto-Accept Agent extension.

## The Core Problem (AG 1.21.9)

Agent edits and file access requests require manual approval through React UI components
inside the jetskiAgent webview. VS Code commands cannot reach these internal approval flows
because they run in an isolated webview context.

## Two Edit Pipelines

### Pipeline 1: Extension Host Tools (direct)
When tools like `write_to_file` are used via the extension host, they write **directly
to the filesystem** — no approval needed.

### Pipeline 2: Cascade Panel Tools (approval required)
The cascade agent stages edits as pending diffs in the jetskiAgent webview React app.
The webview waits for user approval via button click, then dispatches via `postMessage`.

## Command Registry Evolution

| Command | AG 1.21.9 | AG 2.0.1 | AG 2.0.2+ |
|---------|-----------|----------|-----------|
| `antigravity.agent.acceptAgentStep` | ❌ Removed | ❌ | ✅ **Restored** |
| `antigravity.terminalCommand.run` | ❌ Removed | ❌ | ❌ |
| `antigravity.terminalCommand.accept` | ❌ Removed | ❌ | ❌ |
| `antigravity.command.accept` | ❌ Removed | ❌ | ❌ |
| `workbench.action.chat.acceptTool` | ❌ | ✅ | ❌ Removed |
| `workbench.action.chat.acceptToolPostExecution` | ❌ | ✅ | ❌ Removed |
| `antigravity.prioritized.agentAcceptFocusedHunk` | ✅ | ✅ | ✅ |
| `antigravity.prioritized.agentAcceptAllInFile` | ✅ | ✅ | ✅ |
| `antigravity.acceptCompletion` | ✅ | ✅ | ✅ |
| `chatEditing.acceptFile` | ✅ | ✅ | ✅ |
| `chatEditing.acceptAllFiles` | ✅ | ✅ | ✅ |

**Key insight**: Google keeps changing the command registry between versions. The
extension must be validated against each AG update.

## JetskiAgent Internal Architecture

The cascade panel uses internal message types, not VS Code commands:

```
Extension Host (our extension)
    ↓ vscode.commands.executeCommand(...)
VS Code Command Registry  ← Some commands NOT registered here
    ✗ (command not found or no-op for webview-internal actions)

Actual flow for webview approval:
jetskiAgent webview (React) 
    → onClick handler on Accept button
    → dispatch({type: "AcceptCascadeStep", ...})
    → postMessage to host
    → Host writes file to disk
```

This is why CDP (DOM observation) is needed as a complement to command polling.

## AG 2.0.x Architecture Changes

### Terminal Execution (2.0.2+)
- The `onChange` handler no longer has a separate confirm function
- Terminal acceptance is handled via `antigravity.acceptAgentStep` command
- The autorun source patch is no longer needed

### File Access (2.0.2+)
- Allow button changed from plain `<button>` to dropdown component (`zon`)
- Permission function and enum naming changed with minification
- Guard pattern (`absolutePathUri`) still works
- Regex updated to handle both old and new patterns

### Feature Flags
- Browser tool controlled by `CASCADE_ANTIGRAVITY_BROWSER_TOOLS_ENABLED` (server-side Unleash)
- Browser tool requires: `unleashState.isEnabled(flag) && browserToolsEnabled !== DISABLED`

## Solution Stack

| Layer | Purpose | Handles |
|-------|---------|---------|
| Command Polling | Fire VS Code/AG commands every 500ms | Agent steps, terminal commands, suggestions, notifications |
| CDP Auto-Accept | MutationObserver in webview DOM | Accept/Run/Allow/Retry buttons in cascade panel |
| Source Patcher | Modify AG's bundled JS | File access auto-approve, auto-scroll, auto-expand |
| Native Settings | AG's built-in config | `allowAgentAccessNonWorkspaceFiles`, terminal allow/deny lists |
