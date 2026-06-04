# Source-Level Patcher

> Updated: June 2026 — AG IDE 2.0.4

## Overview

The Auto-Accept Agent includes source-level patches that modify Antigravity's bundled
JavaScript files to auto-approve user interactions:

1. **Terminal Auto-Run** (workbench + mainRenderer) — Auto-confirms EAGER terminal execution policy
2. **File Access Auto-Approve** (workbench + jetskiAgent) — Auto-approves file access for user-owned paths
3. **Auto-Scroll** (workbench) — Forces auto-scroll in chat panels
4. **Auto-Expand** (jetskiAgent) — Auto-expands collapsed "Step Requires Input" banners

## Target Files

AG uses **three renderer bundles** with duplicated UI components:

| File | Label | Patches Applied |
|------|-------|-----------------| 
| `out/vs/workbench/workbench.desktop.main.js` | workbench | fileaccess, autoscroll |
| `out/jetskiAgent/main.js` | jetskiAgent | fileaccess, autoexpand |
| `out/main.js` | mainRenderer | (none currently matching in 2.0.x) |

## AG 2.0.x Compatibility

### Terminal Auto-Run — Pattern Changed

In AG IDE 2.0.2+, the terminal step renderer architecture changed significantly:

**Old (AG ≤2.0.1):**
```javascript
// onChange handler called setTerminalAutoExecutionPolicy AND a confirm function
B=useCallback(Q=>{
    l?.setTerminalAutoExecutionPolicy?.(Q),
    Q===Qx.EAGER&&L(!0)  // ← confirm function
},[...])
```

**New (AG ≥2.0.2):**
```javascript
// onChange calls n?.(F) directly, no separate confirm function
v=Ze(F=>{
    if(F!==LE.EAGER||u!=="Cider"||!d||!h?.rendererRpcService){
        n?.(F); return  // ← policy setter only, no confirm
    }
    // Internet warning flow...
},[n,d,h,u])
```

The confirm function was removed — terminal acceptance is now handled natively by the 
`antigravity.acceptAgentStep` VS Code command (restored in 2.0.2). **No source patch needed.**

### File Access Auto-Approve — Regex Updated

**Old (AG ≤2.0.1):**
```javascript
onClick:()=>{PERM_FN(!0,ENUM.CONVERSATION)}  // curly braces
```

**New (AG ≥2.0.2):**
```javascript
onClick:()=>PERM_FN(!0,ENUM.CONVERSATION)  // zon dropdown component, no braces
```

The regex was updated in v3.6.0 to match both patterns:
```javascript
/onClick:\(\)=>\{?([\w$]+)\(!0,([\w$]+)\.CONVERSATION\)\}?/
```

## Patch Details

### File Access Auto-Approve

Injects code after the file permission component's `absolutePathUri` guard check:

```javascript
/*AAA:fileaccess*/if(((_p)=>{
  const _n = _p.replace(new RegExp(String.fromCharCode(92,92),'g'),'/').toLowerCase();
  return _n.includes('/users/') || _n.includes('/home/')
      || _n.includes('/tmp/')   || _n.includes('/temp/');
})(t?.absolutePathUri||'')){
  setTimeout(()=>s(!0, ENUM.CONVERSATION), 0);
  return null;
}
```

**Design decisions:**
- `setTimeout(..., 0)` — Defers approval after React render (avoids forbidden side effects)
- `return null` — Immediately hides the prompt UI
- `String.fromCharCode(92,92)` — Creates `\\` regex for backslash normalization without escape hell

**Allow-list (path scoping):**

| Path Pattern | What It Covers |
|-------------|----------------|
| `/users/` | Windows home dirs (`C:\Users\X\...`) |
| `/home/` | Linux/Mac home dirs |
| `/tmp/` | Unix/WSL temp |
| `/temp/` | Cross-platform temp |

Everything else falls through to the manual approval prompt.

### Auto-Scroll

Replaces `autoScroll:n=>n!==ENUM.Ask` with `autoScroll:()=>!0` to force auto-scroll always on.
Preserves original code in the marker comment for clean revert.

### Auto-Expand

Injects `setTimeout(()=>setExpanded(!0),0)` after the filtered WAITING steps length guard
to auto-expand collapsed "Step Requires Input" banners.

## Marker System

| Marker | Patch | Strip Regex |
|--------|-------|-------------|
| `/*AAA:autorun*/` | Terminal auto-execution | `/\/\*AAA:autorun\*\/[^;]+;/g` |
| `/*AAA:fileaccess*/` | File access auto-approve | `/\/\*AAA:fileaccess\*\/[^;]+;/g` |
| `/*AAA:autoexpand*/` | Step banner auto-expand | Marker-based strip |
| `/*AAA:autoscroll*/` | Chat auto-scroll | Marker-based revert to original |

## Integrity Checks

AG validates SHA-256 checksums in `product.json` on startup. The patcher:
- Backs up `product.json` before first patch
- Computes new checksums using `base64` encoding with padding stripped
- Uses string replacement on raw JSON to preserve exact formatting

> **Note**: A cosmetic "corrupt installation" warning may appear. This is harmless.

## Usage

```
Ctrl+Shift+P → "Auto Accept: Apply Auto-Run Fix"    # Apply patches
Ctrl+Shift+P → "Auto Accept: Revert Auto-Run Fix"   # Remove all patches
Ctrl+Shift+P → "Auto Accept: Run Diagnostics"       # Check patch status
```

Reload the window after applying/reverting (`Ctrl+Shift+P → Reload Window`).

## Patch Lifecycle

The patcher uses a **strip-and-reapply** strategy:
1. Read the file
2. Strip any existing markers (handles all historical variants)
3. Analyze the clean code for injection points
4. Inject the latest patch code
5. Update checksums in `product.json`
6. Write the file
