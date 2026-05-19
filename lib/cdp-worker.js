/**
 * CDP Worker Thread
 * 
 * Owns all WebSocket connections to AG's remote debugging port.
 * Communicates with main extension thread via postMessage IPC.
 * 
 * This isolation prevents the "Cannot freeze array buffer views"
 * crash that occurs when WebSocket instances live in the Electron
 * main thread.
 * 
 * @module cdp-worker
 */

const { parentPort } = require('worker_threads');
const WebSocket = require('ws');

// Cache the injection script (sent from main thread)
let cachedScript = null;

// Track active WebSocket connections
const connections = new Map(); // wsUrl → ws instance

parentPort.on('message', async (msg) => {
    try {
        switch (msg.type) {
            case 'cache-script':
                cachedScript = msg.script;
                break;

            case 'eval':
                await handleEval(msg);
                break;

            case 'burst-inject':
                await handleBurstInject(msg);
                break;

            case 'shutdown':
                for (const [url, ws] of connections) {
                    try { ws.close(); } catch (e) {}
                }
                connections.clear();
                process.exit(0);
                break;
        }
    } catch (e) {
        if (msg.id) {
            parentPort.postMessage({ id: msg.id, error: e.message });
        }
    }
});

// Report memory usage periodically
setInterval(() => {
    const mem = process.memoryUsage();
    parentPort.postMessage({
        type: 'memory-report',
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024)
    });
}, 30000);

/**
 * Get or create a WebSocket connection for a target.
 */
function getConnection(wsUrl, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const existing = connections.get(wsUrl);
        if (existing && existing.readyState === WebSocket.OPEN) {
            return resolve(existing);
        }
        // Clean up stale connection
        if (existing) {
            try { existing.close(); } catch (e) {}
            connections.delete(wsUrl);
        }

        const ws = new WebSocket(wsUrl, { handshakeTimeout: timeout });
        const timer = setTimeout(() => {
            try { ws.close(); } catch (e) {}
            reject(new Error('ws connect timeout'));
        }, timeout);

        ws.on('open', () => {
            clearTimeout(timer);
            connections.set(wsUrl, ws);
            resolve(ws);
        });

        ws.on('error', (e) => {
            clearTimeout(timer);
            connections.delete(wsUrl);
            reject(new Error('ws error: ' + e.message));
        });

        ws.on('close', () => {
            connections.delete(wsUrl);
        });
    });
}

/**
 * Evaluate an expression via CDP Runtime.evaluate
 */
async function handleEval(msg) {
    const ws = await getConnection(msg.wsUrl, msg.timeoutMs || 10000);
    const cdpId = Date.now() % 100000;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('eval timeout'));
        }, msg.timeoutMs || 10000);

        const handler = (data) => {
            try {
                const resp = JSON.parse(data.toString());
                if (resp.id === cdpId) {
                    clearTimeout(timer);
                    ws.removeListener('message', handler);
                    parentPort.postMessage({ id: msg.id, result: resp });
                    resolve();
                }
            } catch (e) {}
        };
        ws.on('message', handler);

        ws.send(JSON.stringify({
            id: cdpId,
            method: 'Runtime.evaluate',
            params: {
                expression: msg.expression,
                returnByValue: true,
                awaitPromise: false
            }
        }));
    });
}

/**
 * Inject the cached DOM observer script
 */
async function handleBurstInject(msg) {
    if (!cachedScript) {
        parentPort.postMessage({ id: msg.id, error: 'no cached script' });
        return;
    }

    const ws = await getConnection(msg.wsUrl, 15000);
    const cdpId = Date.now() % 100000;

    // Set pause state before injecting
    const pauseExpr = msg.isPaused ? 'window.__AA_PAUSED = true;' : 'window.__AA_PAUSED = false;';

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('inject timeout'));
        }, 15000);

        const handler = (data) => {
            try {
                const resp = JSON.parse(data.toString());
                if (resp.id === cdpId) {
                    clearTimeout(timer);
                    ws.removeListener('message', handler);
                    const result = resp.result?.result?.value || 'unknown';
                    parentPort.postMessage({ id: msg.id, result });
                    resolve();
                }
            } catch (e) {}
        };
        ws.on('message', handler);

        ws.send(JSON.stringify({
            id: cdpId,
            method: 'Runtime.evaluate',
            params: {
                expression: pauseExpr + cachedScript,
                returnByValue: true,
                awaitPromise: false
            }
        }));
    });
}
