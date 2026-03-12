# Source-Level Auto-Run Patcher

## Overview

The Auto-Accept Agent includes a source-level patcher that fixes Antigravity's broken "Always Proceed" terminal execution policy. When the policy is set to `EAGER`, commands should auto-execute — but AG is missing a `useEffect` hook that triggers the confirmation. The patcher injects this missing hook.

## How It Works

### The Bug

AG's terminal component has an `onChange` handler that sets the policy and calls `confirm(!0)` when the user selects EAGER — but only on **change**. There's no hook that checks the policy on **mount**, so commands don't auto-execute when the component first renders.

### The Fix

The patcher injects a `useEffect` hook after the component's variable declarations:

```javascript
// Before (simplified):
const onChange = useCallback(arg => {
    setPolicy(arg);
    arg === ENUM.EAGER && confirm(true);
}, [deps]);
// ... more hooks ...
return <Component />;

// After:
const onChange = useCallback(arg => { ... }, [deps]);
// ... more hooks ...
/*AAA:autorun*/oiu(()=>{u===uF.EAGER&&!d&&b(!0)},[]);  // ← injected
return <Component />;
```

The `useEffect` runs once on mount (`[]` deps), checks if policy is EAGER and secure mode is off, then auto-confirms.

## Technical Challenges

### 1. Minified Variable Names

All variables are minified (e.g., `oiu` = `useEffect`, `uF` = policy enum). The patcher uses regex to match **code structure** rather than variable names:

```
CALLBACK_ALIAS(ARG=>{HANDLER?.setTerminalAutoExecutionPolicy?.(ARG),ARG===ENUM.EAGER&&CONFIRM(!0)},[deps])
```

### 2. Multiple useEffect Aliases (Module Scopes)

The 24MB workbench has multiple `useEffect` aliases in different module scopes:

| Alias | Offset | `define()` Boundaries | Correct? |
|-------|--------|-----------------------|----------|
| `fn`  | 26K    | 40                    | ❌ (global scope) |
| `oiu` | 12.6M  | 0                     | ✅ (local scope) |

**Detection uses a dual strategy:**

1. **Scope-match**: Find `useEffect` imported alongside the known `useCallback` alias (±500 chars)
2. **Nearest-backward**: Last `useEffect:ALIAS` within 200K chars before the match
3. **Tiebreaker**: Count `define()` AMD module boundaries between each alias definition and the match. Fewer boundaries = same module scope.

### 3. Insertion Point

Inserts as a **standalone statement at a semicolon boundary**, NOT inside a `const` declaration (which would cause a syntax error). The patcher walks forward from the match, tracking bracket depth, to find the terminating `;`.

### 4. Integrity Checks

AG validates SHA-256 checksums in `product.json` on startup. The patcher:
- Creates a backup of `product.json` before modifying
- Computes new checksums using `base64` encoding with padding stripped
- Uses **string replacement** on raw JSON to preserve exact formatting (not `JSON.stringify`)

> **Note**: A cosmetic "corrupt installation" warning may appear despite correct checksums. AG validates integrity at a deeper level than just `product.json`. This warning is harmless.

### 5. JetskiAgent Excluded

`jetskiAgent/main.js` has a different bundler scope chain where neither the global nor local `useEffect` alias is reliably accessible from the component. The workbench-only patch is sufficient for auto-run functionality.

## Usage

### Apply the Patch

```
Ctrl+Shift+P → "Auto Accept: Apply Auto-Run Fix"
```

Then **fully close and reopen** Antigravity (not just Reload Window).

### Revert the Patch

```
Ctrl+Shift+P → "Auto Accept: Revert Auto-Run Fix"
```

Then restart Antigravity. Original files are restored from `.aaa-backup` files.

### Check Status

```
Ctrl+Shift+P → "Auto Accept: Show Patch Status"
```

### Re-Applying

Running "Apply" when already patched will automatically revert from backup and re-apply fresh — no need to manually revert first.

## Status Bar

The status bar shows three states:

| State | Icon | Meaning |
|-------|------|---------|
| `Auto Accept: ON` | ✅ | Polling + source patch active |
| `Auto Accept: ON (no patch)` | ⚠️ | Polling only — apply source patch for background support |
| `Auto Accept: OFF` | 🚫 | Paused |

## Files

- `lib/auto-run-patcher.js` — Patcher module (path detection, analysis, patching, checksums)
- `extension.js` — Commands and status bar integration

## Safety

- **Automatic backups**: Original files saved as `.aaa-backup` before patching
- **One-command revert**: Restores from backup and deletes backup files
- **Non-destructive**: Only adds code, never removes existing logic
- **Re-apply safe**: Reverts cleanly before re-patching
- **No auto-apply**: Patch is manual-only — you control when it runs
