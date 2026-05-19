/**
 * CDP Auto-Accept — Connection Manager v3.0
 * 
 * Worker thread isolation: all WebSocket instances live in a worker_thread
 * (cdp-worker.js). The main extension thread has ZERO WebSocket instances,
 * preventing the "Cannot freeze array buffer views" crash.
 * 
 * Architecture (inspired by yazanbaker94/AntiGravity-AutoAccept):
 *   - HTTP-only target discovery (no WebSocket in main thread)
 *   - Worker thread manages all CDP WebSocket connections
 *   - MutationObserver injection (not polling) for button detection
 *   - 10s heartbeat for health checks and auto-re-injection
 *   - Retry circuit breaker (3 per 60s window)
 * 
 * @module cdp-auto-accept
 */

const http = require('http');
const path = require('path');
const { Worker } = require('worker_threads');
const { buildDOMObserverScript } = require('./dom-observer');

const DEFAULT_PORT = 9333;

class ConnectionManager {
    constructor({ log, debugLog, getPort, getConfig }) {
        this.log = log || console.log;
        this.debugLog = debugLog || (() => {});
        this.getPort = getPort || (() => DEFAULT_PORT);
        this.getConfig = getConfig || (() => ({}));

        // Sessions (metadata only — no sockets in main thread)
        this.sessions = new Map();          // targetId → { url, wsUrl }
        this.ignoredTargets = new Set();
        this._ignoredTTLs = new Map();      // targetId → expiryTimestamp
        this._sessionCursors = new Map();   // targetId → last click count
        this.activeCdpPort = null;

        // Config (cached)
        this.blockedCommands = [];
        this.allowedCommands = [];
        this.autoAcceptFileEdits = true;
        this.autoRetryEnabled = true;

        // Error detection callback (fired when agent error state detected)
        this.onErrorDetected = null;

        // Lifecycle
        this.isRunning = false;
        this.isPaused = false;
        this.isConnecting = false;
        this._connected = false;
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this._errorCheckTimer = null;
        this._sessionFailCounts = new Map();
        this._injectionFailCounts = new Map();
        this._heartbeatRunning = false;

        // Error detection state
        this._errorRetryCount = 0;
        this._lastErrorRetryTime = 0;

        // Worker thread
        this._worker = null;
        this._pendingIpc = new Map();
        this._ipcId = 0;

        // Script cache
        this._cachedScript = null;
        this._cachedScriptKey = null;
    }

    // ─── Script Cache ─────────────────────────────────────────────────

    _getScript() {
        const key = JSON.stringify({
            blocked: this.blockedCommands,
            allowed: this.allowedCommands,
            fileEdits: this.autoAcceptFileEdits,
            retry: this.autoRetryEnabled
        });
        if (this._cachedScriptKey === key && this._cachedScript) {
            return this._cachedScript;
        }
        this._cachedScript = buildDOMObserverScript({
            blockedCommands: this.blockedCommands,
            allowedCommands: this.allowedCommands,
            autoAcceptFileEdits: this.autoAcceptFileEdits,
            autoRetryEnabled: this.autoRetryEnabled
        });
        this._cachedScriptKey = key;
        if (this._worker) {
            this._worker.postMessage({ type: 'cache-script', id: 0, script: this._cachedScript });
        }
        this.debugLog('CDP: Script cached (config changed)');
        return this._cachedScript;
    }

    // ─── Worker Thread Management ─────────────────────────────────────

    _ensureWorker() {
        if (this._worker) return this._worker;

        const workerPath = path.join(__dirname, 'cdp-worker.js');
        this._worker = new Worker(workerPath);

        this._worker.on('message', (msg) => {
            if (msg.type === 'memory-report') {
                this.debugLog(`CDP: Worker memory: heap=${msg.heapUsed}MB rss=${msg.rss}MB`);
                return;
            }
            if (msg.id && this._pendingIpc.has(msg.id)) {
                const handler = this._pendingIpc.get(msg.id);
                this._pendingIpc.delete(msg.id);
                clearTimeout(handler.timer);
                if (msg.error) {
                    handler.reject(new Error(msg.error));
                } else {
                    handler.resolve(msg.result || msg);
                }
            }
        });

        this._worker.on('exit', (code) => {
            this.debugLog(`CDP: Worker exited (code ${code})`);
            this._worker = null;
            for (const [id, handler] of this._pendingIpc) {
                clearTimeout(handler.timer);
                handler.reject(new Error('worker exited'));
            }
            this._pendingIpc.clear();
        });

        this._worker.on('error', (e) => {
            this.debugLog(`CDP: Worker error: ${e.message}`);
        });

        if (this._cachedScript) {
            this._worker.postMessage({ type: 'cache-script', id: 0, script: this._cachedScript });
        }

        this.debugLog('CDP: Worker thread spawned');
        return this._worker;
    }

    _workerEval(wsUrl, expression, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            if (this._pendingIpc.size > 20) {
                reject(new Error('ipc backpressure'));
                return;
            }
            const worker = this._ensureWorker();
            const id = ++this._ipcId;
            const timer = setTimeout(() => {
                this._pendingIpc.delete(id);
                reject(new Error('ipc timeout'));
            }, timeoutMs);
            this._pendingIpc.set(id, { resolve, reject, timer });
            worker.postMessage({ type: 'eval', id, wsUrl, expression, timeoutMs });
        });
    }

    _workerBurstInject(wsUrl, targetId, isPaused) {
        return new Promise((resolve, reject) => {
            if (this._pendingIpc.size > 20) {
                reject(new Error('ipc backpressure'));
                return;
            }
            const worker = this._ensureWorker();
            const id = ++this._ipcId;
            const timer = setTimeout(() => {
                this._pendingIpc.delete(id);
                reject(new Error('ipc timeout'));
            }, 15000);
            this._pendingIpc.set(id, { resolve, reject, timer });
            worker.postMessage({ type: 'burst-inject', id, wsUrl, targetId, isPaused });
        });
    }

    _killWorker() {
        const w = this._worker;
        this._worker = null;
        if (w) {
            try { w.postMessage({ type: 'shutdown' }); } catch (e) {}
            setTimeout(() => { try { w.terminate(); } catch (e) {} }, 1000);
        }
    }

    // ─── Public API ───────────────────────────────────────────────────

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.isPaused = false;
        this.log('CDP: Connection manager starting (worker thread isolation)');
        this.connect();
    }

    stop() {
        this.isRunning = false;
        this.isPaused = false;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = null;
        clearInterval(this._errorCheckTimer);
        this._errorCheckTimer = null;

        for (const [targetId, info] of this.sessions) {
            this._workerEval(info.wsUrl, `
                window.__AA_PAUSED = true;
                if (window.__AA_OBSERVER) { window.__AA_OBSERVER.disconnect(); window.__AA_OBSERVER = null; }
                window.__AA_OBSERVER_ACTIVE = false;
                'killed';
            `).catch(() => {});
        }
        this.sessions.clear();
        this.ignoredTargets.clear();
        this._ignoredTTLs.clear();
        this._sessionCursors.clear();
        this._sessionFailCounts.clear();
        this._injectionFailCounts.clear();
        this._connected = false;
        this._errorRetryCount = 0;
        this._killWorker();
        this.log('CDP: Connection manager stopped');
    }

    getStatus() {
        return {
            connected: this._connected,
            sessionCount: this.sessions.size,
            port: this.activeCdpPort,
            workerAlive: !!this._worker
        };
    }

    // ─── Connection Lifecycle ─────────────────────────────────────────

    async connect() {
        if (!this.isRunning || this.isConnecting) return;
        this.isConnecting = true;

        try {
            const port = await this._findActivePort();
            if (!port) {
                this.debugLog('CDP: No active port found');
                this._scheduleReconnect();
                return;
            }

            const targets = await this._getTargetList(port);
            if (!targets || targets.length === 0) {
                this.debugLog('CDP: No targets found');
                this._scheduleReconnect();
                return;
            }

            this._connected = true;
            const candidates = targets.filter(t => this._isCandidate(t));
            this.log(`CDP: Found ${targets.length} targets, ${candidates.length} candidates`);

            // Pre-cache script
            this._getScript();

            // Inject into candidates (chunked to avoid backpressure)
            for (let i = 0; i < candidates.length; i += 5) {
                await Promise.allSettled(candidates.slice(i, i + 5).map(t => this._handleNewTarget(t)));
            }

            this.log(`CDP: ${this.sessions.size} sessions active`);
            this._scheduleHeartbeat();
            this._startErrorDetection();
        } catch (e) {
            this.debugLog(`CDP: Connection error: ${e.message}`);
            this._scheduleReconnect();
        } finally {
            this.isConnecting = false;
        }
    }

    // ─── Target Discovery ─────────────────────────────────────────────

    _isCandidate(targetInfo) {
        const type = targetInfo.type;
        const url = targetInfo.url || '';
        if (!url) return false;
        if (type === 'service_worker' || type === 'worker' || type === 'shared_worker') return false;
        if (url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank') return false;
        return type === 'page' || type === 'iframe' ||
            url.includes('vscode-webview') || url.includes('webview');
    }

    async _handleNewTarget(targetInfo) {
        const { id: targetId, webSocketDebuggerUrl, url } = targetInfo;
        if (!targetId || !webSocketDebuggerUrl) return;
        const shortId = targetId.substring(0, 6);
        if (this.sessions.has(targetId) || this.ignoredTargets.has(targetId)) return;

        // URL dedup
        if (url) {
            for (const [, info] of this.sessions) {
                if (info.url && info.url === url) {
                    this.ignoredTargets.add(targetId);
                    this._ignoredTTLs.set(targetId, Date.now() + 5 * 60 * 1000);
                    return;
                }
            }
        }

        try {
            this._getScript();
            const result = await this._workerBurstInject(webSocketDebuggerUrl, targetId, this.isPaused) || 'unknown';

            if (result !== 'observer-installed' && result !== 'already-active') {
                this.debugLog(`CDP: [${shortId}] Injection result: ${result}`);
                if (result === 'no-window') {
                    this.ignoredTargets.add(targetId);
                    this._ignoredTTLs.set(targetId, Date.now() + 5 * 60 * 1000);
                } else {
                    const count = (this._injectionFailCounts.get(targetId) || 0) + 1;
                    this._injectionFailCounts.set(targetId, count);
                    if (count >= 3) {
                        this.ignoredTargets.add(targetId);
                        this._ignoredTTLs.set(targetId, Date.now() + 5 * 60 * 1000);
                    }
                }
                return;
            }

            this.sessions.set(targetId, { url: url || '', wsUrl: webSocketDebuggerUrl });

            // Read initial click count as cursor baseline
            let initialCount = 0;
            try {
                const r = await this._workerEval(webSocketDebuggerUrl, '(() => window.__AA_CLICK_COUNT || 0)()', 1500);
                initialCount = r.result?.result?.value || 0;
            } catch (e) {}
            this._sessionCursors.set(targetId, initialCount);

            this.log(`CDP: ✓ Injected [${shortId}] → ${result} (${(url || '').substring(0, 60)})`);
        } catch (e) {
            this.debugLog(`CDP: [${shortId}] Inject error: ${e.message}`);
        }
    }

    // ─── Heartbeat ────────────────────────────────────────────────────

    _scheduleReconnect() {
        if (this.reconnectTimer || !this.isRunning) return;
        this.debugLog('CDP: Reconnecting in 5s...');
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.isRunning) this.connect();
        }, 5000);
    }

    _scheduleHeartbeat() {
        clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = setTimeout(async () => {
            await this._heartbeat();
            if (this.isRunning && (this.sessions.size > 0 || this._connected)) {
                this._scheduleHeartbeat();
            }
        }, 10000);
    }

    async _heartbeat() {
        if (this._heartbeatRunning) return;
        this._heartbeatRunning = true;
        try {
            const port = this.activeCdpPort;
            if (!port) return;

            const targets = await this._getTargetList(port);
            if (!targets) return;

            // Discover new targets
            const candidates = targets.filter(t =>
                this._isCandidate(t) && !this.sessions.has(t.id) && !this.ignoredTargets.has(t.id)
            );
            if (candidates.length > 0) {
                this.debugLog(`CDP: ${candidates.length} new targets, injecting...`);
                for (let i = 0; i < candidates.length; i += 5) {
                    await Promise.allSettled(candidates.slice(i, i + 5).map(t => this._handleNewTarget(t)));
                }
            }

            const activeIds = new Set(targets.map(t => t.id));

            // Prune gone targets
            const toPrune = [];
            for (const [tid] of this.sessions) {
                if (!activeIds.has(tid)) toPrune.push(tid);
            }
            for (const tid of toPrune) {
                this.sessions.delete(tid);
                this._sessionFailCounts.delete(tid);
                this._sessionCursors.delete(tid);
                this.debugLog(`CDP: Target [${tid.substring(0, 6)}] gone, pruned`);
            }

            // Expire ignored target TTLs
            const now = Date.now();
            for (const tid of this.ignoredTargets) {
                if (!activeIds.has(tid)) {
                    this.ignoredTargets.delete(tid);
                    this._ignoredTTLs.delete(tid);
                } else if (this._ignoredTTLs.has(tid) && now > this._ignoredTTLs.get(tid)) {
                    this.ignoredTargets.delete(tid);
                    this._ignoredTTLs.delete(tid);
                    this.debugLog(`CDP: TTL expired for [${tid.substring(0, 6)}], will retry`);
                }
            }

            // Health check active sessions
            if (this.sessions.size === 0) return;

            const entries = [...this.sessions.entries()];
            for (let i = 0; i < entries.length; i += 10) {
                const chunk = entries.slice(i, i + 10);
                const results = await Promise.allSettled(
                    chunk.map(async ([targetId, info]) => {
                        const check = await this._workerEval(info.wsUrl,
                            '(() => ({ alive: !!window.__AA_OBSERVER_ACTIVE && (Date.now() - (window.__AA_LAST_SCAN || 0) < 120000), clickCount: window.__AA_CLICK_COUNT || 0 }))()'
                        );
                        return check.result?.result?.value || { alive: false, clickCount: 0 };
                    })
                );

                const dead = [];
                for (let j = 0; j < results.length; j++) {
                    const [targetId, info] = chunk[j];
                    const shortId = targetId.substring(0, 6);

                    if (results[j].status === 'fulfilled') {
                        const val = results[j].value;

                        if (!val.alive) {
                            this.debugLog(`CDP: [${shortId}] observer dead, re-injecting...`);
                            try {
                                this._getScript();
                                const result = await this._workerBurstInject(info.wsUrl, targetId, this.isPaused) || 'unknown';
                                if (result === 'observer-installed' || result === 'already-active') {
                                    this._sessionFailCounts.delete(targetId);
                                    this.debugLog(`CDP: ✓ Re-injected [${shortId}]`);
                                } else {
                                    const fc = (this._sessionFailCounts.get(targetId) || 0) + 1;
                                    this._sessionFailCounts.set(targetId, fc);
                                    if (fc >= 3) dead.push(targetId);
                                }
                            } catch (e) {
                                const fc = (this._sessionFailCounts.get(targetId) || 0) + 1;
                                this._sessionFailCounts.set(targetId, fc);
                                if (fc >= 3) dead.push(targetId);
                            }
                        } else {
                            this._sessionFailCounts.delete(targetId);
                        }
                    } else {
                        const fc = (this._sessionFailCounts.get(targetId) || 0) + 1;
                        this._sessionFailCounts.set(targetId, fc);
                        if (fc >= 3) dead.push(targetId);
                    }
                }

                for (const tid of dead) {
                    this.sessions.delete(tid);
                    this._sessionFailCounts.delete(tid);
                    this._sessionCursors.delete(tid);
                    this.debugLog(`CDP: [${tid.substring(0, 6)}] unreachable 3x, pruned`);
                }
            }
        } catch (e) {
            this.debugLog(`CDP: Heartbeat error: ${e.message}`);
        } finally {
            this._heartbeatRunning = false;
        }
    }

    // ─── Error Detection (checks main workbench for agent errors) ─────

    _startErrorDetection() {
        if (this._errorCheckTimer) return;
        // Check every 5s (not 3s — reduce overhead)
        this._errorCheckTimer = setInterval(() => {
            if (this.isRunning && this._connected && !this.isPaused && this.autoRetryEnabled) {
                this._checkForAgentError();
            }
        }, 5000);
        this.debugLog('CDP: Error detection loop started (5s interval)');
    }

    async _checkForAgentError() {
        if (!this.onErrorDetected) return;
        if (this.sessions.size === 0) return;

        // Check ANY connected session for error text in the workbench body
        const errorCheckExpr = `(function() {
            var text = (document.body.innerText || '').toLowerCase();
            var last = text.substring(Math.max(0, text.length - 3000));
            var indicators = [
                'high traffic', 'something went wrong', 'rate limit',
                'bad gateway', 'service unavailable',
                'overloaded', 'server error', 'connection error',
                'internal error', 'agent terminated due to error'
            ];
            for (var i = 0; i < indicators.length; i++) {
                if (last.indexOf(indicators[i]) !== -1) return indicators[i];
            }
            return '';
        })()`;

        for (const [targetId, info] of this.sessions) {
            try {
                const result = await this._workerEval(info.wsUrl, errorCheckExpr, 2000);
                const errorFound = result?.result?.result?.value;
                if (errorFound && typeof errorFound === 'string' && errorFound.length > 0) {
                    this.log(`CDP: Error detected: "${errorFound}" — firing retry`);
                    try { this.onErrorDetected(errorFound); } catch (e) {}
                    return;
                }
            } catch (e) {}
        }
    }

    // Resets the error retry counter (call after successful agent output)
    resetErrorRetryCount() {
        this._errorRetryCount = 0;
    }

    // ─── Port & Target Discovery (HTTP only) ──────────────────────────

    _pingPort(port) {
        return new Promise((resolve) => {
            const req = http.get({
                hostname: '127.0.0.1', port, path: '/json/version',
                timeout: 800, agent: false
            }, (res) => {
                res.on('data', () => {});
                res.on('end', () => resolve(true));
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
    }

    _getTargetList(port) {
        return new Promise((resolve) => {
            const req = http.get({
                hostname: '127.0.0.1', port, path: '/json',
                timeout: 2000, agent: false
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
                });
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        });
    }

    async _findActivePort() {
        // Try cached port first
        if (this.activeCdpPort && await this._pingPort(this.activeCdpPort)) {
            return this.activeCdpPort;
        }
        // Try configured port (default 9333)
        const configPort = this.getPort();
        if (await this._pingPort(configPort)) {
            this.activeCdpPort = configPort;
            return configPort;
        }
        // Fallback: try legacy 9222
        if (configPort !== 9222 && await this._pingPort(9222)) {
            this.activeCdpPort = 9222;
            this.log('CDP: Using legacy port 9222 (consider switching to 9333)');
            return 9222;
        }
        return null;
    }
}

// ─── Legacy API shims (backward compat with extension.js) ─────────

let _instance = null;

function isAvailable(port) {
    return new Promise((resolve) => {
        const req = http.get({
            hostname: '127.0.0.1', port: port || DEFAULT_PORT,
            path: '/json', timeout: 2000, agent: false
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const targets = JSON.parse(data);
                    resolve({ available: true, targetCount: targets.length });
                } catch (e) {
                    resolve({ available: false, error: 'invalid response' });
                }
            });
        });
        req.on('error', (e) => resolve({ available: false, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ available: false, error: 'timeout' }); });
    });
}

function start(options = {}) {
    if (_instance) _instance.stop();
    _instance = new ConnectionManager({
        log: options.log || console.log,
        debugLog: options.debugLog || (() => {}),
        getPort: () => options.port || DEFAULT_PORT,
        getConfig: () => options
    });
    _instance.autoRetryEnabled = options.autoRetryEnabled !== false;
    _instance.autoAcceptFileEdits = options.acceptEdits !== false;
    _instance.start();
    return _instance;
}

function stop() {
    if (_instance) { _instance.stop(); _instance = null; }
}

function getStatus() {
    if (!_instance) return { enabled: false, connected: false, port: null, sessions: 0 };
    const s = _instance.getStatus();
    return {
        enabled: _instance.isRunning,
        connected: s.connected,
        port: s.port,
        sessions: s.sessionCount,
        workerAlive: s.workerAlive
    };
}

module.exports = {
    ConnectionManager,
    isAvailable,
    start,
    stop,
    getStatus,
    DEFAULT_PORT
};
