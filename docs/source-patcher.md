# Source-Level Patcher

## Overview

The Auto-Accept Agent includes two source-level patches that fix Antigravity's broken approval mechanisms:

1. **Terminal Auto-Run** (workbench + mainRenderer) — Fixes the broken "Always Proceed" policy by injecting a `useEffect` hook
2. **File Access Auto-Approve** (all 3 renderers) — Auto-approves file access requests for user-owned paths

## Target Files

AG uses **three renderer bundles** that each contain duplicated UI components:

| File | Label | Patches Applied |
|------|-------|-----------------|
| `out/vs/workbench/workbench.desktop.main.js` | workbench | autorun + fileaccess |
| `out/jetskiAgent/main.js` | jetskiAgent | fileaccess only |
| `out/main.js` | mainRenderer | autorun + fileaccess |

The jetskiAgent webview renders the chat panel where file access prompts appear. The workbench and mainRenderer contain the terminal step component for auto-run.

## Patch 1: Terminal Auto-Run

### The Bug

AG's terminal component has an `onChange` handler that sets the policy and calls `confirm(!0)` when the user selects EAGER — but only on **change**. There's no hook that checks the policy on **mount**, so commands don't auto-execute when the component first renders.

### The Fix

Injects a `useEffect` hook after the component's variable declarations:

```javascript
/*AAA:autorun*/oiu(()=>{u===uF.EAGER&&!d&&b(!0)},[]);
```

Runs once on mount, checks if policy is EAGER and secure mode is off, then auto-confirms.

### Technical Details

- **Minified variable detection**: Regex matches code structure, not names
- **Module scope resolution**: Dual strategy (scope-match + nearest-backward) with `define()` boundary counting as tiebreaker
- **Insertion at semicolon boundary**: Walks forward tracking bracket depth to avoid breaking `const` declarations
- **Targets**: `workbench.desktop.main.js` and `out/main.js`

## Patch 2: File Access Auto-Approve

### The Problem

When the agent needs to access files outside the workspace, AG shows an "Allow file access to X?" prompt requiring manual approval. No VS Code command or setting exists for this — it's inside the renderer as a React component.

### The Fix

Injects code after the file permission component's `absolutePathUri` guard check:

```javascript
/*AAA:fileaccess*/if(((_p)=>{
  const _n = _p.replace(new RegExp(String.fromCharCode(92,92),'g'),'/').toLowerCase();
  return _n.includes('/users/') || _n.includes('/home/')
      || _n.includes('/tmp/')   || _n.includes('/temp/');
})(t?.absolutePathUri||'')) {
  setTimeout(() => s(!0, Vee.CONVERSATION), 0);
  return null;
}
```

### Key Design Decisions

- **`setTimeout(..., 0)`** — Schedules the approval call AFTER React render completes. Calling `s()` synchronously during render is a forbidden side effect that causes errors.
- **`return null`** — Immediately hides the prompt UI (React renders nothing for null).
- **`String.fromCharCode(92,92)`** — Creates `\\` regex pattern for backslash normalization. Avoids the multi-layer escape chain (patcher template → written file → JS engine).
- **Dynamic variable detection** — The request variable (`t`, `e`, etc.) and permission function (`s`, `o`, `l`, etc.) are extracted from the minified code via regex, not hardcoded.
- **Always strip + re-apply** — The patcher strips any existing fileaccess patch before injecting the current version. This prevents stale old patches from persisting across versions.

### Allow-List (Path Scoping)

Only auto-approves file access for user-owned paths:

| Path Pattern | What It Covers |
|-------------|----------------|
| `/users/` | Windows home dirs (`C:\Users\X\...`) |
| `/home/` | Linux/Mac home dirs (`/home/X/...`) |
| `/tmp/` | Unix/WSL temp |
| `/temp/` | Cross-platform temp |

**Everything else** (C:\Windows, C:\Program Files, etc.) still shows the manual approval prompt.

### Technical Details

- **Guard pattern**: `if(!VAR?.absolutePathUri)return null;` — regex-matched to handle different minified variable names
- **Permission function**: Extracted from the "Allow This Conversation" button's `onClick` handler
- **Scope**: `CONVERSATION` — permission resets when session ends
- **Targets**: All 3 renderer bundles

## Patch Lifecycle

### Idempotent Application

The patcher uses a **strip-and-reapply** strategy:

1. Read the file
2. Strip any existing `/*AAA:fileaccess*/` patch (handles all known variants)
3. Analyze the clean code for injection points
4. Inject the latest patch code
5. Write the file

This ensures the patch is always up-to-date, even after the patch logic changes between versions.

### Strip Variants

The stripper handles all historical patch formats:

| Version | Pattern |
|---------|---------|
| v1 | `/*AAA:fileaccess*/setTimeout(()=>{...path filtering...},0);` |
| v2 | `/*AAA:fileaccess*/setTimeout(()=>{...},0);return null;` |
| v3 | `/*AAA:fileaccess*/setTimeout(()=>FN(!0,ENUM),0);return null;` |
| v4 | `/*AAA:fileaccess*/FN(!0,ENUM);return null;` |

## Integrity Checks

AG validates SHA-256 checksums in `product.json` on startup. The patcher:
- Computes new checksums using `base64` encoding with padding stripped
- Uses **string replacement** on raw JSON to preserve exact formatting

> **Note**: A cosmetic "corrupt installation" warning may appear. This warning is harmless and can be dismissed.

## Usage

### Apply

```
Ctrl+Shift+P → "Auto Accept: Apply Auto-Run Fix"
```

Then **reload** (`Ctrl+Shift+P → Developer: Reload Window`).

### Revert

```
Ctrl+Shift+P → "Auto Accept: Revert Auto-Run Fix"
```

### Check Status

```
Ctrl+Shift+P → "Auto Accept: Show Patch Status"
```

## Dual Marker System

| Marker | Patch |
|--------|-------|
| `/*AAA:autorun*/` | Terminal auto-execution |
| `/*AAA:fileaccess*/` | File access auto-approve |

Both markers are checked for patch detection and clean reversion.

## Safety

- **Path-scoped**: File access only auto-approves user-owned paths
- **Conversation-scoped**: File access permissions reset per session
- **Always fresh**: Patches are stripped and re-applied to prevent stale code
- **One-command revert**: Restores original files
- **Status bar indicator**: Shows `(patched)` or `(not patched)` at all times
