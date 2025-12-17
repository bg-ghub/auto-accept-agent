/**
 * Cursor CDP Handler
 * Manages CDP connections and TRIGGERED (not auto-running) script injection.
 * Pro feature: Background operation (continues when unfocused)
 */

let WebSocket;
try {
    WebSocket = require('ws');
} catch (e) {
    console.error(`[CursorCDP] Failed to require 'ws'. Current dir: ${__dirname}`);
    try {
        console.error(`[CursorCDP] node_modules exists? ${require('fs').existsSync(require('path').join(__dirname, '../node_modules'))}`);
        console.error(`[CursorCDP] ws exists? ${require('fs').existsSync(require('path').join(__dirname, '../node_modules/ws'))}`);
    } catch (fsErr) { /* ignore */ }
    throw e;
}
const http = require('http');

const CDP_PORT_START = 9222;
const CDP_PORT_END = 9232;

// PASSIVE script - Based on proven @ivalsaraj approach with background mode flag
// COMPREHENSIVE LOGGING VERSION
const CLICKER_SCRIPT = `
(function() {
    'use strict';
    
    // --- Configuration & Constants ---
    const DEBUG = true; 
    function log(...args) { if (DEBUG) console.log('[AutoAcceptCDP]', ...args); }
    
    // Config default values
    const config = {
        enableAcceptAll: true,
        enableAccept: true,
        enableRun: true,
        enableRunCommand: true,
        enableApply: true,
        enableExecute: true,
        enableResume: true,
        enableTryAgain: true,
        stuckThresholdMs: 3000, 
        inactivityThresholdMs: 10000,
        buttonDecayMs: 30000
    };

    // --- State Tracking ---
    // Persist state across injections if needed, but usually this script persists in the context if not reloaded.
    // However, if we re-inject, we might reset state. To avoid this, we attach to window.
    if (!window.__autoAcceptState) {
        window.__autoAcceptState = {
            clickCount: 0,
            lastActionTime: Date.now(),
            pendingButtons: new Map(), // Element unique ID -> timestamp
            sessionHasAccepted: false, // Tracks if we HAVE accepted anything this session
            inputBoxVisible: false
        };
    }
    const state = window.__autoAcceptState;
    let backgroundMode = false;
    
    // Mutation Observer to Refresh Activity
    let observer;
    function setupObserver() {
        if (observer) observer.disconnect();
        observer = new MutationObserver((mutations) => {
            // Check if mutations are significant enough to count as "activity"
            // For now, any DOM change in the relevant areas could reset inactivity?
            // Actually, we want to detect if *agent* is doing something. 
            // If the UI is changing (text streaming), that's activity.
            const importantChange = mutations.some(m => {
                // If text is being added to an editor or terminal
                return m.type === 'characterData' || m.type === 'childList';
            });
            
            if (importantChange) {
                // We don't fully reset lastActionTime on ANY change, because we might be stuck *waiting* for user
                // But if the agent is streaming text, we definitely aren't stuck.
                // For simplicity, we'll let the extension manage "activity" via clicks, but
                // we'll track "lastUiChange" here to help heuristics.
                state.lastUiChange = Date.now();
            }
        });
        
        // Observe the body or specific containers
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    // Initialize observer once
    if (!window.__autoAcceptObserverSet) {
        setupObserver();
        window.__autoAcceptObserverSet = true;
    }

    // --- Helper Functions ---

    function getElementUniqueId(el) {
        // Try to generate a somewhat unique ID for the element to track it across checks
        // Ideally we use something stable.
        if (el.dataset.aaId) return el.dataset.aaId;
        const id = 'aa-' + Math.random().toString(36).substr(2, 9);
        el.dataset.aaId = id;
        return id;
    }

    function isElementVisible(el) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        
        // In background mode, simple check
        if (backgroundMode) {
            return style.display !== 'none' && style.visibility !== 'hidden';
        }
        
        return style.display !== 'none' && 
               style.visibility !== 'hidden' && 
               parseFloat(style.opacity) > 0.1 && 
               rect.width > 0 && 
               rect.height > 0;
    }
    
    function isElementClickable(el) {
        const disabled = el.disabled;
        const hasDisabledAttr = el.hasAttribute('disabled');
        if (backgroundMode) return !disabled && !hasDisabledAttr;
        
        const style = window.getComputedStyle(el);
        return style.pointerEvents !== 'none' && !disabled && !hasDisabledAttr;
    }
    
    function isAcceptButton(el) {
        if (!el || !el.textContent) return false;
        const text = el.textContent.toLowerCase().trim();
        if (text.length === 0 || text.length > 50) return false;
        
        const patterns = [
            { pattern: 'accept all', enabled: config.enableAcceptAll },
            { pattern: 'accept', enabled: config.enableAccept },
            { pattern: 'run command', enabled: config.enableRunCommand },
            { pattern: 'run', enabled: config.enableRun },
            { pattern: 'apply', enabled: config.enableApply },
            { pattern: 'execute', enabled: config.enableExecute },
            { pattern: 'resume', enabled: config.enableResume },
            { pattern: 'try again', enabled: config.enableTryAgain }
        ];
        
        const matched = patterns.some(p => p.enabled && text.includes(p.pattern));
        if (!matched) return false;
        
        const excluded = ['skip', 'reject', 'cancel', 'discard', 'deny', 'close'];
        if (excluded.some(p => text.includes(p))) return false;
        
        return isElementVisible(el) && isElementClickable(el);
    }
    
    function findAcceptButtons() {
        const buttons = [];
        // Scope to input box if possible
        const inputBox = document.querySelector('div.full-input-box');
        state.inputBoxVisible = !!inputBox; // Update state
        
        if (inputBox) {
            let sibling = inputBox.previousElementSibling;
            let count = 0;
            while (sibling && count < 5) {
                const selectors = ['div[class*="button"]', 'button', '[class*="anysphere"]'];
                selectors.forEach(s => {
                    sibling.querySelectorAll(s).forEach(el => {
                        if (isAcceptButton(el)) buttons.push(el);
                    });
                });
                sibling = sibling.previousElementSibling;
                count++;
            }
        }
        
        // Fallback global search
        if (buttons.length === 0) {
            document.querySelectorAll('button, [class*="button"]').forEach(el => {
                if (el.textContent && el.textContent.length < 30 && isAcceptButton(el)) {
                    buttons.push(el);
                }
            });
        }
        return buttons;
    }
    
    // --- Stuck Detection Logic ---

    function getStuckState(autoAcceptEnabled) {
        // Garbage collect pending buttons
        const now = Date.now();
        for (const [id, timestamp] of state.pendingButtons) {
            const el = document.querySelector(\`[data-aa-id="\${id}"]\`);
            // Remove if element gone or decayed (30s)
            if (!el || !document.contains(el) || (now - timestamp > config.buttonDecayMs)) {
                state.pendingButtons.delete(id);
            }
        }

        // 1. Check Pre-conditions
        if (!autoAcceptEnabled) return { state: 'running', reason: 'auto_accept_disabled' };

        // 2. Find Candidates for "Stuck"
        const currentButtons = findAcceptButtons();
        const awaitingApproval = document.body.innerText.includes('waiting for approval') || 
                                 document.body.innerText.includes('awaiting approval'); // Weak check, but helpful

        // 3. Condition: (Pending element OR Awaiting Text OR Prior Accept)
        const hasPendingContext = (currentButtons.length > 0) || 
                                  awaitingApproval || 
                                  state.sessionHasAccepted;

        if (!hasPendingContext) {
            // Nothing to be stuck ON
            return { state: 'running', reason: 'no_pending_action' };
        }

        // 4. Update Pending Map for current buttons
        let maxDuration = 0;
        currentButtons.forEach(btn => {
            const id = getElementUniqueId(btn);
            if (!state.pendingButtons.has(id)) {
                state.pendingButtons.set(id, now);
            }
            const duration = now - state.pendingButtons.get(id);
            if (duration > maxDuration) maxDuration = duration;
        });

        // 5. Calculate Inactivity
        // Time since last successful CLICK or last significant UI change
        const timeSinceLastAction = now - state.lastActionTime;
        const timeSinceLastUi = now - (state.lastUiChange || 0);
        
        // If UI is moving, we are unlikely to be stuck (streaming response)
        // But if button is persistent for > 3s, that overrides UI activity (user must click)
        
        // Triggers:
        // A. Button visible > 3s (Immediate trigger)
        if (maxDuration > config.stuckThresholdMs) {
            return { state: 'stalled', reason: 'button_timeout', duration: maxDuration };
        }

        // B. Inactivity > 10s AND we think we should be doing something
        if (timeSinceLastAction > config.inactivityThresholdMs && timeSinceLastUi > config.inactivityThresholdMs) {
             // Only if we definitely have a button waiting or strict text
             if (currentButtons.length > 0) {
                 return { state: 'stalled', reason: 'inactivity_with_button' };
             }
        }

        return { state: 'running', reason: 'nominal' };
    }

    function clickButton(el) {
        try {
            const rect = el.getBoundingClientRect();
            const centerX = rect.width > 0 ? rect.left + rect.width / 2 : 0;
            const centerY = rect.height > 0 ? rect.top + rect.height / 2 : 0;
            
            // Mouse events
            ['mousedown', 'mouseup', 'click'].forEach(type => {
                el.dispatchEvent(new MouseEvent(type, {
                    bubbles: true, cancelable: true, view: window,
                    clientX: centerX, clientY: centerY
                }));
            });
            
            // Native
            if (typeof el.click === 'function') el.click();
            
            // Background mode extra
            if (backgroundMode) {
                if (el.focus) el.focus();
                el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            }
            
            return true;
        } catch (e) {
            return false;
        }
    }

    // --- Main Interface ---

    window.__autoAcceptCDP = {
        forceClick: function(bgMode) { 
            backgroundMode = bgMode || false;
            const buttons = findAcceptButtons();
            
            if (buttons.length > 0) {
                const btn = buttons[0];
                if (clickButton(btn)) {
                    state.clickCount++;
                    state.lastActionTime = Date.now();
                    state.sessionHasAccepted = true;
                    // Clear this button from pending map immediately
                    const id = getElementUniqueId(btn);
                    state.pendingButtons.delete(id);
                    
                    return { clicked: true, text: btn.textContent, total: state.clickCount };
                }
            }
            return { clicked: false, found: buttons.length };
        },
        getStats: function() {
            return { clicks: state.clickCount };
        },
        findButtons: function(bgMode) {
            backgroundMode = bgMode || false;
            return findAcceptButtons().map(b => b.textContent.trim());
        },
        getDiagnostics: function() {
            return {
                ...state,
                pendingCount: state.pendingButtons.size
            };
        },
        getStuckState: getStuckState
    };
    
    return { status: 'loaded' };
})();

`;

class CursorCDPHandler {
    constructor(startPort = CDP_PORT_START, endPort = CDP_PORT_END, logger = null) {
        this.name = 'CursorCDP';
        this.connections = new Map();
        this.messageId = 1;
        this.pendingMessages = new Map();
        this.reconnectTimer = null;
        this.isEnabled = false;
        this.startPort = startPort;
        this.endPort = endPort;
        this.logger = logger || console.log;
        this.isPro = false;
    }

    setProStatus(isPro) {
        this.isPro = isPro;
        this.log(`CursorCDP: Pro status set to ${isPro}`);
    }

    log(...args) {
        if (this.logger) {
            // If the logger expects a single string vs multiple args
            // We assume our custom logger in extension.js (msg, data)
            if (args.length > 1 && typeof args[1] === 'object') {
                this.logger(args[0], args[1]);
            } else {
                this.logger(args.join(' '));
            }
        }
    }

    async scanForInstances() {
        const instances = [];

        for (let port = this.startPort; port <= this.endPort; port++) {
            try {
                const pages = await this.getPages(port);
                if (pages && pages.length > 0) {
                    this.log(`CursorCDP: Found ${pages.length} pages on port ${port}:`);
                    pages.forEach((p, i) => {
                        this.log(`  [${i}] ${p.title || 'No title'} - ${p.url || 'No URL'} (${p.type || 'unknown type'})`);
                    });
                    instances.push({ port, pages });
                } else {
                    this.log(`CursorCDP: Port ${port} open but no pages found.`);
                }
            } catch (e) {
                // connection refused is expected for closed ports, so we ignore it to reduce noise
                if (!e.message.includes('ECONNREFUSED')) {
                    this.log(`CursorCDP: Scan port ${port} failed: ${e.message}`);
                }
            }
        }

        return instances;
    }

    async getPages(port) {
        return new Promise((resolve, reject) => {
            const req = http.get({
                hostname: '127.0.0.1',
                port,
                path: '/json/list',
                timeout: 1000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const pages = JSON.parse(data);
                        resolve(pages.filter(p => p.webSocketDebuggerUrl));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        });
    }

    async isCDPAvailable() {
        const instances = await this.scanForInstances();
        return instances.length > 0;
    }

    async start() {
        this.isEnabled = true;
        const connected = await this.discoverAndConnect();

        if (!this.reconnectTimer) {
            this.reconnectTimer = setInterval(() => {
                if (this.isEnabled) {
                    this.discoverAndConnect().catch(() => { });
                }
            }, 10000);
        }

        return connected;
    }

    async stop() {
        this.isEnabled = false;
        if (this.reconnectTimer) {
            clearInterval(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.disconnectAll();
    }

    async discoverAndConnect() {
        const instances = await this.scanForInstances();
        let connected = 0;

        for (const instance of instances) {
            // Gating: If not Pro, and we already have 1 connection, stop.
            if (!this.isPro && this.connections.size >= 1) {
                this.log('CursorCDP: Non-Pro limit reached (1 instance). skipping others.');
                break;
            }

            for (const page of instance.pages) {
                if (!this.connections.has(page.id)) {
                    // Double check gating inside loop just in case
                    if (!this.isPro && this.connections.size >= 1) break;

                    const success = await this.connectToPage(page);
                    if (success) connected++;
                }
            }
        }

        return connected > 0 || this.connections.size > 0;
    }

    async connectToPage(page) {
        return new Promise((resolve) => {
            try {
                const ws = new WebSocket(page.webSocketDebuggerUrl);
                let resolved = false;

                ws.on('open', async () => {
                    this.log(`CursorCDP: Connected to ${page.id}`);
                    this.connections.set(page.id, { ws, injected: false });

                    try {
                        await this.injectScript(page.id);
                    } catch (e) { }

                    if (!resolved) { resolved = true; resolve(true); }
                });

                ws.on('message', (data) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        if (msg.id && this.pendingMessages.has(msg.id)) {
                            const { resolve, reject } = this.pendingMessages.get(msg.id);
                            this.pendingMessages.delete(msg.id);
                            msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
                        }
                    } catch (e) { }
                });

                ws.on('error', () => {
                    this.connections.delete(page.id);
                    if (!resolved) { resolved = true; resolve(false); }
                });

                ws.on('close', () => {
                    this.connections.delete(page.id);
                    if (!resolved) { resolved = true; resolve(false); }
                });

                setTimeout(() => {
                    if (!resolved) { resolved = true; resolve(false); }
                }, 5000);

            } catch (e) {
                resolve(false);
            }
        });
    }

    async sendCommand(pageId, method, params = {}) {
        const conn = this.connections.get(pageId);
        if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected');
        }

        const id = this.messageId++;

        return new Promise((resolve, reject) => {
            this.pendingMessages.set(id, { resolve, reject });
            conn.ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (this.pendingMessages.has(id)) {
                    this.pendingMessages.delete(id);
                    reject(new Error('Timeout'));
                }
            }, 5000);
        });
    }

    async injectScript(pageId) {
        await this.sendCommand(pageId, 'Runtime.evaluate', {
            expression: CLICKER_SCRIPT,
            returnByValue: true
        });
        const conn = this.connections.get(pageId);
        if (conn) conn.injected = true;
    }

    /**
     * Trigger click on all connected pages
     * Called by extension - extension decides when to call based on Pro/focus status
     */
    async executeAccept(allowHidden = false) {
        let totalClicked = 0;
        this.log(`\n========================================`);
        this.log(`CursorCDP: executeAccept START`);
        this.log(`  backgroundMode=${allowHidden}`);
        this.log(`  connections=${this.connections.size}`);
        this.log(`========================================`);

        for (const [pageId, conn] of this.connections) {
            this.log(`\nCursorCDP: Processing page ${pageId}`);
            this.log(`  WebSocket readyState: ${conn.ws.readyState} (1=OPEN)`);
            this.log(`  Script injected: ${conn.injected}`);

            if (conn.ws.readyState !== WebSocket.OPEN) {
                this.log(`  SKIP: WebSocket not open`);
                continue;
            }

            try {
                // Ensure script is injected
                if (!conn.injected) {
                    this.log(`  Injecting script...`);
                    await this.injectScript(pageId);
                    this.log(`  Script injection complete`);
                }

                // Get diagnostics first
                this.log(`  Fetching diagnostics...`);
                const diagResult = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: `window.__autoAcceptCDP ? window.__autoAcceptCDP.getDiagnostics() : { error: 'not loaded' }`,
                    returnByValue: true
                });
                const diagnostics = diagResult?.result?.value || {};
                this.log(`  Diagnostics:`, JSON.stringify(diagnostics, null, 2));

                // Find buttons
                this.log(`  Finding buttons with backgroundMode=${allowHidden}...`);
                const findResult = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: `window.__autoAcceptCDP ? window.__autoAcceptCDP.findButtons(${allowHidden}) : []`,
                    returnByValue: true
                });
                const foundButtons = findResult?.result?.value || [];
                this.log(`  Found ${foundButtons.length} buttons:`, foundButtons);

                // Trigger forceClick
                this.log(`  Calling forceClick(${allowHidden})...`);
                const result = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: `window.__autoAcceptCDP ? window.__autoAcceptCDP.forceClick(${allowHidden}) : { clicked: false }`,
                    returnByValue: true
                });

                const clickResult = result?.result?.value || {};
                this.log(`  forceClick result:`, JSON.stringify(clickResult));

                if (clickResult.clicked) {
                    this.log(`  SUCCESS: Clicked "${clickResult.text}"`);
                    totalClicked++;
                } else {
                    this.log(`  No click: found=${clickResult.found}`);
                }
            } catch (e) {
                this.log(`  ERROR:`, e.message);
            }
        }

        this.log(`\n========================================`);
        this.log(`CursorCDP: executeAccept COMPLETE`);
        this.log(`  totalClicked=${totalClicked}`);
        this.log(`========================================\n`);
        return { executed: totalClicked };
    }

    async getStuckState(autoAcceptEnabled) {
        // Collect states from all connections (usually just one matters, but we check all)
        // If ANY page is stuck, we are stuck.
        for (const [pageId, conn] of this.connections) {
            if (conn.ws.readyState !== WebSocket.OPEN) continue;

            try {
                // Ensure injection? Maybe not needed if we assume executeAccept ran, but let's be safe
                if (!conn.injected) await this.injectScript(pageId);

                const result = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: `window.__autoAcceptCDP ? window.__autoAcceptCDP.getStuckState(${autoAcceptEnabled}) : { state: 'unknown' }`,
                    returnByValue: true
                });

                const data = result?.result?.value;
                if (data && data.state === 'stalled') {
                    return data; // Return the first stalled state found
                }
            } catch (e) {
                // Ignore errors
            }
        }
        return { state: 'running' }; // Default
    }

    getConnectionCount() {
        return this.connections.size;
    }

    disconnectAll() {
        for (const [, conn] of this.connections) {
            try { conn.ws.close(); } catch (e) { }
        }
        this.connections.clear();
    }
}

module.exports = { CursorCDPHandler };
