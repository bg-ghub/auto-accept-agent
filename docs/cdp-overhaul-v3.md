# Auto Accept Agent v3.0.1 — CDP Overhaul + Smart Retry

## What Changed

v3.0.1 is a complete rewrite of the CDP (Chrome DevTools Protocol) auto-accept module, based on architecture from the community's [yazanbaker94/AntiGravity-AutoAccept](https://github.com/yazanbaker94/AntiGravity-AutoAccept) (308★, 40K+ installs) and smart retry logic from [james-hr/antigravity-retry](https://github.com/james-hr/antigravity-retry).

### Why the Rewrite?

The v2.x CDP module had three fatal issues:

1. **WebSocket crash**: Electron blocks self-connections to `localhost:9222` via native `WebSocket`. The raw HTTP upgrade workaround was fragile.
2. **Port conflict**: AG's built-in Browser Control uses port 9222 by default → `EADDRINUSE` on macOS/Linux.
3. **Polling-based**: CDP scanned targets every 5s. Buttons could appear and disappear between polls.

---

## Architecture (v3.0.0)

```
┌─────────────────────────┐     IPC      ┌──────────────────┐
│   Extension (main)      │◄────────────►│  cdp-worker.js   │
│                         │  postMessage  │  (worker_thread) │
│  - HTTP target scan     │              │                  │
│  - Heartbeat (10s)      │              │  - WebSocket(ws) │
│  - Config management    │              │  - CDP commands   │
│  - Status bar           │              │  - Script inject  │
└─────────────────────────┘              └──────────────────┘
         │
         ▼ CDP Runtime.evaluate
┌─────────────────────────┐
│  AG Webview (injected)  │
│                         │
│  - MutationObserver     │
│  - TreeWalker scan      │
│  - Button click         │
│  - Circuit breaker      │
└─────────────────────────┘
```

### Key Design Decisions

| Decision | Old (v2.x) | New (v3.0.0) | Why |
|---|---|---|---|
| WebSocket location | Main thread (native) | Worker thread (`ws` npm) | Prevents "Cannot freeze array buffer views" crash |
| Button detection | 5s CDP polling | MutationObserver + 10s fallback | Instant reaction, near-zero CPU |
| Port | 9222 | 9333 (9222 fallback) | Avoids AG Browser Control conflict |
| Retry/Continue | Not handled | Auto-click with circuit breaker | Handles "High Traffic" and model errors |
| Target filter | All pages | `vscode-webview://` + iframe only | Prevents injection into wrong targets |

---

## New Files

### `lib/dom-observer.js`
Builds the JavaScript injection script. Features:
- **Single-pass TreeWalker** — walks DOM once, checks all keywords per node (O(D) not O(N×D))
- **Button keywords** (priority order): `run`, `accept`, `accept all`, `always allow`, `allow this conversation`, `allow`, `retry`, `try again`, `continue`
- **Error context detection** (from james-hr): before clicking retry/continue, verifies that error text ("something went wrong", "rate limit", "timed out", etc.) or error CSS classes are actually visible in the panel. Prevents false positive retries when "retry" appears in conversation text.
- **Retry circuit breaker**: max **5** retries per 60-second window, then stops (bumped from 3 for resilience)
- **Command blocklist/allowlist**: inspects `<pre>/<code>` blocks near Run buttons
- **Per-element cooldowns**: 5s cooldown per DOM path to prevent spam
- **Deferred `isAgentPanel()`**: checks `.react-app-container` on every scan, not at injection time

### `lib/cdp-worker.js`
Worker thread that owns all WebSocket connections:
- Uses `ws` npm package (not Electron's broken native WebSocket)
- Handles `eval` (arbitrary expression) and `burst-inject` (script injection) commands
- Reports memory usage every 30s
- Clean shutdown via `parentPort.postMessage`

### `lib/cdp-auto-accept.js` (rewritten)
ConnectionManager class:
- HTTP-only target discovery (no WebSocket in main thread)
- Worker IPC with backpressure limit (max 20 pending calls)
- Script caching (eliminates 28KB IPC churn per heartbeat)
- 10s heartbeat: discovers new targets, prunes dead ones, re-injects dead observers
- Ignored target TTL (5-min expiry for self-healing)
- Legacy API shims for backward compatibility with extension.js

---

## New Settings

| Setting | Default | Description |
|---|---|---|
| `auto-accept.cdpPort` | `9333` | CDP port (was 9222) |
| `auto-accept.autoRetryEnabled` | `true` | Auto-click Retry/Continue buttons |
| `auto-accept.blockedCdpCommands` | `[]` | Commands to block via CDP |
| `auto-accept.allowedCdpCommands` | `[]` | Whitelist mode for CDP commands |

---

## Setup

### 1. Desktop Shortcut
The "Antigravity CDP" desktop shortcut has been updated to port 9333:
```
--remote-debugging-port=9333
```

### 2. Extension
v3.0.1 is installed. Reload the window to activate:
```
Ctrl+Shift+P → Reload Window
```

### 3. Verify
Check status bar for `CDP ✓`. If not:
- Visit `http://127.0.0.1:9333/json/list` in browser — if refused, AG wasn't launched with the flag
- Check Output panel → Auto Accept Agent for CDP log lines

---

## Retry Behavior (v3.0.1)

When the cascade agent hits an error (model overload, context limit, network error), AG shows a **Retry** button. v3.0.1 auto-clicks it with two safety layers:

### Layer 1: Error Context Detection (from james-hr/antigravity-retry)
Before clicking retry, the observer **verifies an error actually exists**:
- Scans the last 2000 characters of visible text for error indicators:
  `"something went wrong"`, `"rate limit"`, `"timed out"`, `"high traffic"`, `"service unavailable"`, etc.
- Checks for visible error CSS classes (`[class*="error"]`, `[class*="failed"]`, etc.)
- If no error context is found, the retry button is **skipped** (with a 2s re-check)

### Layer 2: Circuit Breaker
- **Max 5 retries per 60-second window** (bumped from 3 for resilience)
- After 5 retries, the extension stops and hands control to you
- Counter **resets** when a non-recovery click succeeds (Run/Accept = error resolved)
- Disable via setting: `auto-accept.autoRetryEnabled: false`

---

## AG Update Resilience

After an AG update, these patches are **automatically re-applied** on extension activation:
- `ensureNonWorkspaceAccess()` — re-patches the workbench default if the update overwrote it
- Start Menu shortcut — survives AG updates (it modifies the shortcut, not AG itself)
- CDP port 9333 — AG doesn't touch the shortcut args

---

## Dependency Changes

- **Added**: `ws` (^8.18.0) — WebSocket implementation for the worker thread
- **Removed**: native WebSocket dependency (was unreliable in Electron)

---

## Migration from v2.x

1. Shortcut: change `9222` → `9333` in your AG launch shortcut (auto-done for desktop)
2. Settings: `cdpPort` default changed from 9222 to 9333
3. The legacy port 9222 is tried as fallback if 9333 fails
