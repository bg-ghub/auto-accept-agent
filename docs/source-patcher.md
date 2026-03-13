# Source-Level Patcher

## Overview

The Auto-Accept Agent includes two source-level patches that fix Antigravity's broken approval mechanisms:

1. **Terminal Auto-Run** (workbench) — Fixes the broken "Always Proceed" policy by injecting a `useEffect` hook
2. **File Access Auto-Approve** (jetskiAgent) — Auto-approves file access requests for workspace-relevant paths

## Patch 1: Terminal Auto-Run

### The Bug

AG's terminal component has an `onChange` handler that sets the policy and calls `confirm(!0)` when the user selects EAGER — but only on **change**. There's no hook that checks the policy on **mount**, so commands don't auto-execute when the component first renders.

### The Fix

Injects a `useEffect` hook after the component's variable declarations:

```javascript
// Injected statement:
/*AAA:autorun*/oiu(()=>{u===uF.EAGER&&!d&&b(!0)},[]);
```

Runs once on mount, checks if policy is EAGER and secure mode is off, then auto-confirms.

### Technical Details

- **Minified variable detection**: Regex matches code structure, not names
- **Module scope resolution**: Dual strategy (scope-match + nearest-backward) with `define()` boundary counting as tiebreaker
- **Insertion at semicolon boundary**: Walks forward tracking bracket depth to avoid breaking `const` declarations
- **Target**: `workbench.desktop.main.js` only

## Patch 2: File Access Auto-Approve

### The Problem

When the agent needs to access files outside the workspace, AG shows an "Expand" toolbar with "Allow file access to X?" requiring manual approval. No VS Code command or setting exists for this — it's entirely inside the jetskiAgent webview as a React component.

### The Fix

Injects a `setTimeout` callback after the file permission component's guard check:

```javascript
// Injected statement:
/*AAA:fileaccess*/setTimeout(()=>{
  const _u = (t.absolutePathUri || '').toLowerCase();
  const _ok = _u.includes('/documents/') ||
              _u.includes('/appdata/') ||
              _u.includes('/.gemini/') ||
              _u.includes('/tmp/') ||
              _u.includes('/temp/');
  _ok && s(!0, Vee.CONVERSATION);
}, 0);
```

### Path Scoping ("Need to Know")

Only auto-approves file access for workspace-relevant paths:

| Path Pattern | What It Covers |
|-------------|----------------|
| `/documents/` | Workspace projects (`C:/Users/X/Documents/`) |
| `/appdata/` | Windows temp, AG config (`AppData/Local/Temp/`) |
| `/.gemini/` | AG brain/config directories |
| `/tmp/` | Unix/WSL temp |
| `/temp/` | Cross-platform temp |

**Everything else** (Desktop, system dirs, etc.) still shows the manual approval prompt.

### Technical Details

- **`t.absolutePathUri`** is a file URI (forward slashes), available in the component scope
- **Scope**: `CONVERSATION` — permission resets when session ends
- **Target**: `jetskiAgent/main.js` only

## Label-Based Routing

The patcher routes analysis by file type:

| File | Patch Type | Why |
|------|-----------|-----|
| `workbench.desktop.main.js` | Terminal auto-run | Has the terminal policy component |
| `jetskiAgent/main.js` | File access auto-approve | Has the file permission component |

This prevents false matches (jetskiAgent has a `useEffect` alias that's unreliable for terminal auto-run).

## Integrity Checks

AG validates SHA-256 checksums in `product.json` on startup. The patcher:
- Creates backups before modifying (`.aaa-backup`)
- Computes new checksums using `base64` encoding with padding stripped
- Uses **string replacement** on raw JSON to preserve exact formatting

> **Note**: A cosmetic "corrupt installation" warning may appear. AG validates integrity beyond just `product.json`. This warning is harmless.

## Usage

### Apply

```
Ctrl+Shift+P → "Auto Accept: Apply Auto-Run Fix"
```

Then **restart** Antigravity.

### Revert

```
Ctrl+Shift+P → "Auto Accept: Revert Auto-Run Fix"
```

### Check Status

```
Ctrl+Shift+P → "Auto Accept: Show Patch Status"
```

### Re-Applying

Running "Apply" when already patched will revert from backup and re-apply fresh.

## Dual Marker System

| Marker | Patch |
|--------|-------|
| `/*AAA:autorun*/` | Terminal auto-execution |
| `/*AAA:fileaccess*/` | File access auto-approve |

Both markers are checked for patch detection and clean reversion.

## Safety

- **Automatic backups**: Original files saved as `.aaa-backup`
- **One-command revert**: Restores from backup and deletes backup files
- **Path-scoped**: File access only auto-approves workspace-relevant paths
- **Conversation-scoped**: File access permissions reset per session
- **Re-apply safe**: Reverts cleanly before re-patching
