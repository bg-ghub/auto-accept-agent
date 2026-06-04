# CDP Auto-Accept Module — v3.0.0 → v3.6.0

> Current version: v3.6.0 (June 2026)
> Compatibility: AG IDE 2.0.1 – 2.0.4

## Architecture

The CDP module provides **real-time DOM observation** for instant auto-acceptance,
complementing the command-polling loop.

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

### Port Configuration

| Port | Purpose | Notes |
|------|---------|-------|
| 9333 | Default CDP port | AG Electron shell (our extension) |
| 9222 | Legacy fallback | Tried if 9333 fails |
| `browserCdpPort` | AG's built-in browser tool | Completely separate, auto-assigned |

> **No conflict**: Our CDP port connects to AG's Electron process. The browser tool's
> CDP port controls a separate Chrome instance. They do not interfere with each other.

## Key Design Decisions

| Decision | Old (v2.x) | New (v3.x) | Why |
|---|---|---|---|
| WebSocket location | Main thread (native) | Worker thread (`ws` npm) | Prevents "Cannot freeze array buffer views" crash |
| Button detection | 5s CDP polling | MutationObserver + 10s fallback | Instant reaction, near-zero CPU |
| Port | 9222 | 9333 (9222 fallback) | Avoids AG Browser Control conflict |
| Retry/Continue | Not handled | Auto-click with circuit breaker | Handles "High Traffic" and model errors |
| Target filter | All pages | `vscode-webview://` + iframe only | Prevents injection into wrong targets |

## DOM Observer (`lib/dom-observer.js`)

Features:
- **Single-pass TreeWalker** — walks DOM once, checks all keywords per node (O(D) not O(N×D))
- **Button keywords** (priority order): `run`, `accept`, `accept all`, `always allow`, `allow this conversation`, `allow`, `retry`, `try again`, `continue`
- **Error context detection**: before clicking retry/continue, verifies error text ("something went wrong", "rate limit", "timed out", etc.) is actually visible
- **Retry circuit breaker**: max 5 retries per 60-second window
- **Command blocklist/allowlist**: inspects `<pre>/<code>` blocks near Run buttons
- **Per-element cooldowns**: 5s cooldown per DOM path to prevent spam

## Worker Thread (`lib/cdp-worker.js`)

- Uses `ws` npm package (not Electron's broken native WebSocket)
- Handles `eval` and `burst-inject` commands
- Reports memory usage every 30s
- Clean shutdown via `parentPort.postMessage`

## Connection Manager (`lib/cdp-auto-accept.js`)

- HTTP-only target discovery (no WebSocket in main thread)
- Worker IPC with backpressure limit (max 20 pending calls)
- Script caching (eliminates 28KB IPC churn per heartbeat)
- 10s heartbeat: discovers new targets, prunes dead ones, re-injects dead observers
- Ignored target TTL (5-min expiry for self-healing)

## Setup

### 1. Launch AG with CDP
```bash
# Windows (shortcut target)
"Antigravity IDE.exe" --remote-debugging-port=9333

# macOS
open -a "Antigravity IDE" --args --remote-debugging-port=9333
```

### 2. Verify
Check status bar for `CDP ✓`. If not:
- Visit `http://127.0.0.1:9333/json/list` in browser — if refused, AG wasn't launched with the flag
- Check Output panel → Auto Accept Agent for CDP log lines

## Settings

| Setting | Default | Description |
|---|---|---|
| `auto-accept.cdpPort` | `9333` | CDP port |
| `auto-accept.autoRetryEnabled` | `true` | Auto-click Retry/Continue buttons |
| `auto-accept.blockedCdpCommands` | `[]` | Commands to block via CDP |
| `auto-accept.allowedCdpCommands` | `[]` | Whitelist mode for CDP commands |

## `ws` Dependency Note

Antigravity's `--install-extension` CLI strips `node_modules` during VSIX extraction.
After installing, you must manually copy the `ws` module:

```bash
cp -r node_modules/ws ~/.antigravity-ide/extensions/bg-ghub.auto-accept-agent-3.6.0/node_modules/ws
```

Without this, CDP will fail to connect (WebSocket unavailable) but the extension
will still function via command polling alone.
