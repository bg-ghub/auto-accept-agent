var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// config.js
var require_config = __commonJS({
  "config.js"(exports2, module2) {
    module2.exports = {
      STRIPE_LINKS: {
        MONTHLY: "https://buy.stripe.com/4gM4gz7v37dRajd5989MY0t",
        YEARLY: "https://buy.stripe.com/3cI3cv5mVaq3crlfNM9MY0u"
      }
    };
  }
});

// settings-panel.js
var require_settings_panel = __commonJS({
  "settings-panel.js"(exports2, module2) {
    var vscode2 = require("vscode");
    var { STRIPE_LINKS } = require_config();
    var LICENSE_API = "https://auto-accept-backend.onrender.com/api";
    var SettingsPanel2 = class _SettingsPanel {
      static currentPanel = void 0;
      static viewType = "autoAcceptSettings";
      static createOrShow(extensionUri, context, mode = "settings") {
        const column = vscode2.window.activeTextEditor ? vscode2.window.activeTextEditor.viewColumn : void 0;
        if (_SettingsPanel.currentPanel) {
          _SettingsPanel.currentPanel.panel.reveal(column);
          _SettingsPanel.currentPanel.updateMode(mode);
          return;
        }
        const panel = vscode2.window.createWebviewPanel(
          _SettingsPanel.viewType,
          mode === "prompt" ? "Auto Accept Agent" : "Auto Accept Settings",
          column || vscode2.ViewColumn.One,
          {
            enableScripts: true,
            localResourceRoots: [vscode2.Uri.joinPath(extensionUri, "media")],
            retainContextWhenHidden: true
          }
        );
        _SettingsPanel.currentPanel = new _SettingsPanel(panel, extensionUri, context, mode);
      }
      static showUpgradePrompt(context) {
        _SettingsPanel.createOrShow(context.extensionUri, context, "prompt");
      }
      constructor(panel, extensionUri, context, mode) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.context = context;
        this.mode = mode;
        this.disposables = [];
        this.update();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
          async (message) => {
            switch (message.command) {
              case "setFrequency":
                if (this.isPro()) {
                  await this.context.globalState.update("auto-accept-frequency", message.value);
                  vscode2.commands.executeCommand("auto-accept.updateFrequency", message.value);
                }
                break;
              case "getStats":
                this.sendStats();
                break;
              case "resetStats":
                if (this.isPro()) {
                  await this.context.globalState.update("auto-accept-stats", {
                    clicks: 0,
                    sessions: 0,
                    lastSession: null
                  });
                  this.sendStats();
                }
                break;
              case "upgrade":
                this.openUpgrade(message.promoCode);
                this.startPolling(this.getUserId());
                break;
              case "checkPro":
                this.handleCheckPro();
                break;
              case "dismissPrompt":
                await this.handleDismiss();
                break;
            }
          },
          null,
          this.disposables
        );
      }
      async handleDismiss() {
        const now = Date.now();
        await this.context.globalState.update("auto-accept-lastDismissedAt", now);
        this.dispose();
      }
      async handleCheckPro() {
        const isPro2 = await this.checkProStatus(this.getUserId());
        if (isPro2) {
          await this.context.globalState.update("auto-accept-isPro", true);
          vscode2.window.showInformationMessage("Auto Accept: Pro status verified!");
          this.update();
        } else {
          vscode2.window.showWarningMessage("Pro license not found yet. It usually takes 1-2 minutes to sync.");
        }
      }
      isPro() {
        return this.context.globalState.get("auto-accept-isPro", false);
      }
      getUserId() {
        let userId = this.context.globalState.get("auto-accept-userId");
        if (!userId) {
          userId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === "x" ? r : r & 3 | 8;
            return v.toString(16);
          });
          this.context.globalState.update("auto-accept-userId", userId);
        }
        return userId;
      }
      openUpgrade(promoCode) {
      }
      updateMode(mode) {
        this.mode = mode;
        this.panel.title = mode === "prompt" ? "Auto Accept Agent" : "Auto Accept Settings";
        this.update();
      }
      sendStats() {
        const stats = this.context.globalState.get("auto-accept-stats", {
          clicks: 0,
          sessions: 0,
          lastSession: null
        });
        const isPro2 = this.isPro();
        const frequency = isPro2 ? this.context.globalState.get("auto-accept-frequency", 1e3) : 300;
        this.panel.webview.postMessage({
          command: "updateStats",
          stats,
          frequency,
          isPro: isPro2
        });
      }
      update() {
        this.panel.webview.html = this.getHtmlContent();
        setTimeout(() => this.sendStats(), 100);
      }
      getHtmlContent() {
        const isPro2 = this.isPro();
        const isPrompt = this.mode === "prompt";
        const stripeLinks = STRIPE_LINKS;
        const css = `
            :root {
                --bg-color: var(--vscode-editor-background);
                --fg-color: var(--vscode-editor-foreground);
                --accent: #9333ea;
                --border: var(--vscode-widget-border);
            }
            body {
                font-family: var(--vscode-font-family);
                background: var(--bg-color);
                color: var(--fg-color);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                padding: 20px;
            }
            .container {
                max-width: ${isPrompt ? "500px" : "600px"};
                width: 100%;
            }
            .btn-primary {
                background: var(--accent);
                color: white;
                border: none;
                padding: 12px;
                width: 100%;
                border-radius: 6px;
                font-weight: 600;
                cursor: pointer;
                text-decoration: none;
                display: block;
                text-align: center;
                box-sizing: border-box;
                margin-top: 10px;
            }
            .btn-primary:hover {
                opacity: 0.9;
            }
            .link-secondary {
                color: var(--vscode-textLink-foreground);
                cursor: pointer;
                text-decoration: none;
                font-size: 13px;
                display: block;
                text-align: center;
                margin-top: 16px;
            }
            .link-secondary:hover { text-decoration: underline; }
            
            /* Prompt Specific */
            .prompt-card {
                background: var(--vscode-sideBar-background);
                border: 1px solid var(--border);
                border-radius: 8px;
                padding: 32px;
                text-align: center;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            }
            .prompt-title { font-size: 18px; font-weight: 600; margin-bottom: 12px; }
            .prompt-text { font-size: 14px; opacity: 0.8; line-height: 1.5; margin-bottom: 24px; }

            /* Settings Specific */
            .settings-card { /* ... existing styles condensed ... */ }
        `;
        if (isPrompt) {
          return `<!DOCTYPE html>
            <html>
            <head><style>${css}</style></head>
            <body>
                <div class="container">
                    <div class="prompt-card">
                        <div class="prompt-title">Agent appears stuck</div>
                        <div class="prompt-text">
                            Cursor's auto-accept rules failed to continue execution.<br/><br/>
                            Auto Accept Pro can automatically recover stalled agents so you don't have to babysit them.
                        </div>
                        <a href="${stripeLinks.MONTHLY}" class="btn-primary">
                            \u{1F513} Enable Resilient Mode (Pro) - $5/mo
                        </a>
                        <a href="${stripeLinks.YEARLY}" class="btn-primary" style="background: transparent; border: 1px solid var(--border); margin-top: 8px;">
                            Or $29/year (Save 50%)
                        </a>

                        <a class="link-secondary" onclick="dismiss()">
                            Keep waiting (agent remains paused)
                        </a>
                    </div>
                    <div style="font-size: 11px; opacity: 0.5; margin-top: 20px; text-align: center;">
                        User ID: ${this.getUserId()}
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    function dismiss() {
                        vscode.postMessage({ command: 'dismissPrompt' });
                    }
                </script>
            </body>
            </html>`;
        }
        return `<!DOCTYPE html>
        <html>
        <head>
            <style>${css}</style>
            <style>
                .settings-header { text-align: center; margin-bottom: 30px; }
                .settings-section { background: rgba(255,255,255,0.03); padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 600; opacity: 0.7; }
                input[type=range] { width: 100%; }
                .val-display { float: right; font-family: monospace; }
                .pro-badge { background: var(--accent); color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; }
                .locked { opacity: 0.5; pointer-events: none; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="settings-header">
                    <h1>Auto Accept ${isPro2 ? '<span class="pro-badge">PRO</span>' : ""}</h1>
                    <div style="opacity: 0.7">Automate your AI workflow</div>
                </div>

                ${!isPro2 ? `
                <div class="settings-section" style="border: 1px solid var(--accent);">
                    <div style="font-weight: 600; margin-bottom: 8px;">Upgrade to Pro</div>
                    <div style="font-size: 13px; margin-bottom: 16px; opacity: 0.8;">
                        \u2022 Background operation<br/>
                        \u2022 Multiple instances<br/>
                        \u2022 Adjustable speed<br/>
                        \u2022 Auto-recovery logic
                    </div>
                    <a href="${stripeLinks.MONTHLY}" class="btn-primary">Subscribe Monthly ($5/mo)</a>
                    <a href="${stripeLinks.YEARLY}" class="btn-primary" style="background: transparent; border: 1px solid var(--border);">Subscribe Yearly ($29/yr)</a>
                    <div class="link-secondary" id="checkStatusBtn">Already paid? Check status</div>
                </div>
                ` : ""}

                <div class="settings-section">
                    <label>POLLING FREQUENCY <span class="val-display" id="freqVal">...</span></label>
                    <div class="${!isPro2 ? "locked" : ""}">
                        <input type="range" id="freqSlider" min="200" max="3000" step="100" value="1000">
                    </div>
                    ${!isPro2 ? '<div style="font-size: 11px; margin-top: 4px; color: var(--accent);">\u26A0 Upgrade to adjust speed</div>' : ""}
                </div>

                 <div class="settings-section">
                    <label>ANALYTICS</label>
                    <div style="display: flex; justify-content: space-between; margin-top: 10px;">
                        <div>
                            <div style="font-size: 24px" id="clickCount">0</div>
                            <div style="font-size: 11px; opacity: 0.6">Clicks</div>
                        </div>
                        <div>
                            <div style="font-size: 24px" id="sessionCount">0</div>
                            <div style="font-size: 11px; opacity: 0.6">Sessions</div>
                        </div>
                    </div>
                </div>

                <div style="text-align: center; font-size: 11px; opacity: 0.4; margin-top: 40px;">
                    ID: ${this.getUserId()}
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                // ... Simple event listeners for slider, check status ...
                document.getElementById('checkStatusBtn')?.addEventListener('click', () => {
                    const el = document.getElementById('checkStatusBtn');
                    el.innerText = 'Checking...';
                    vscode.postMessage({ command: 'checkPro' });
                });

                const slider = document.getElementById('freqSlider');
                const valDisplay = document.getElementById('freqVal');
                
                if (slider) {
                    slider.addEventListener('input', (e) => {
                         valDisplay.innerText = (e.target.value/1000) + 's';
                         vscode.postMessage({ command: 'setFrequency', value: e.target.value });
                    });
                }
                
                window.addEventListener('message', e => {
                    const msg = e.data;
                    if (msg.command === 'updateStats') {
                        document.getElementById('clickCount').innerText = msg.stats.clicks;
                        document.getElementById('sessionCount').innerText = msg.stats.sessions;
                        if (slider && !${!isPro2}) { // Only update slider if Pro (enabled)
                            slider.value = msg.frequency;
                            valDisplay.innerText = (msg.frequency/1000) + 's';
                        }
                        if (${!isPro2}) {
                            valDisplay.innerText = '0.3s (Fixed)';
                        }
                    }
                });

                vscode.postMessage({ command: 'getStats' });
            </script>
        </body>
        </html>`;
      }
      dispose() {
        _SettingsPanel.currentPanel = void 0;
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.panel.dispose();
        while (this.disposables.length) {
          const d = this.disposables.pop();
          if (d) d.dispose();
        }
      }
      async checkProStatus(userId) {
        return new Promise((resolve) => {
          const https = require("https");
          https.get(`${LICENSE_API}/verify?userId=${userId}`, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
              try {
                const json = JSON.parse(data);
                resolve(json.isPro === true);
              } catch (e) {
                resolve(false);
              }
            });
          }).on("error", () => resolve(false));
        });
      }
      startPolling(userId) {
        let attempts = 0;
        const maxAttempts = 60;
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(async () => {
          attempts++;
          if (attempts > maxAttempts) {
            clearInterval(this.pollTimer);
            return;
          }
          const isPro2 = await this.checkProStatus(userId);
          if (isPro2) {
            clearInterval(this.pollTimer);
            await this.context.globalState.update("auto-accept-isPro", true);
            vscode2.window.showInformationMessage("Auto Accept: Pro status verified! Thank you for your support.");
            this.update();
            vscode2.commands.executeCommand("auto-accept.updateFrequency", 1e3);
          }
        }, 5e3);
      }
    };
    module2.exports = { SettingsPanel: SettingsPanel2 };
  }
});

// main_scripts/cursor-cdp.js
var require_cursor_cdp = __commonJS({
  "main_scripts/cursor-cdp.js"(exports2, module2) {
    var WebSocket;
    try {
      WebSocket = require("ws");
    } catch (e) {
      console.error(`[CursorCDP] Failed to require 'ws'. Current dir: ${__dirname}`);
      try {
        console.error(`[CursorCDP] node_modules exists? ${require("fs").existsSync(require("path").join(__dirname, "../node_modules"))}`);
        console.error(`[CursorCDP] ws exists? ${require("fs").existsSync(require("path").join(__dirname, "../node_modules/ws"))}`);
      } catch (fsErr) {
      }
      throw e;
    }
    var http = require("http");
    var CDP_PORT_START = 9222;
    var CDP_PORT_END = 9232;
    var CLICKER_SCRIPT = `
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
    var CursorCDPHandler = class {
      constructor(startPort = CDP_PORT_START, endPort = CDP_PORT_END, logger = null) {
        this.name = "CursorCDP";
        this.connections = /* @__PURE__ */ new Map();
        this.messageId = 1;
        this.pendingMessages = /* @__PURE__ */ new Map();
        this.reconnectTimer = null;
        this.isEnabled = false;
        this.startPort = startPort;
        this.endPort = endPort;
        this.logger = logger || console.log;
        this.isPro = false;
      }
      setProStatus(isPro2) {
        this.isPro = isPro2;
        this.log(`CursorCDP: Pro status set to ${isPro2}`);
      }
      log(...args) {
        if (this.logger) {
          if (args.length > 1 && typeof args[1] === "object") {
            this.logger(args[0], args[1]);
          } else {
            this.logger(args.join(" "));
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
                this.log(`  [${i}] ${p.title || "No title"} - ${p.url || "No URL"} (${p.type || "unknown type"})`);
              });
              instances.push({ port, pages });
            } else {
              this.log(`CursorCDP: Port ${port} open but no pages found.`);
            }
          } catch (e) {
            if (!e.message.includes("ECONNREFUSED")) {
              this.log(`CursorCDP: Scan port ${port} failed: ${e.message}`);
            }
          }
        }
        return instances;
      }
      async getPages(port) {
        return new Promise((resolve, reject) => {
          const req = http.get({
            hostname: "127.0.0.1",
            port,
            path: "/json/list",
            timeout: 1e3
          }, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
              try {
                const pages = JSON.parse(data);
                resolve(pages.filter((p) => p.webSocketDebuggerUrl));
              } catch (e) {
                reject(e);
              }
            });
          });
          req.on("error", reject);
          req.on("timeout", () => {
            req.destroy();
            reject(new Error("Timeout"));
          });
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
              this.discoverAndConnect().catch(() => {
              });
            }
          }, 1e4);
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
          if (!this.isPro && this.connections.size >= 1) {
            this.log("CursorCDP: Non-Pro limit reached (1 instance). skipping others.");
            break;
          }
          for (const page of instance.pages) {
            if (!this.connections.has(page.id)) {
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
            ws.on("open", async () => {
              this.log(`CursorCDP: Connected to ${page.id}`);
              this.connections.set(page.id, { ws, injected: false });
              try {
                await this.injectScript(page.id);
              } catch (e) {
              }
              if (!resolved) {
                resolved = true;
                resolve(true);
              }
            });
            ws.on("message", (data) => {
              try {
                const msg = JSON.parse(data.toString());
                if (msg.id && this.pendingMessages.has(msg.id)) {
                  const { resolve: resolve2, reject } = this.pendingMessages.get(msg.id);
                  this.pendingMessages.delete(msg.id);
                  msg.error ? reject(new Error(msg.error.message)) : resolve2(msg.result);
                }
              } catch (e) {
              }
            });
            ws.on("error", () => {
              this.connections.delete(page.id);
              if (!resolved) {
                resolved = true;
                resolve(false);
              }
            });
            ws.on("close", () => {
              this.connections.delete(page.id);
              if (!resolved) {
                resolved = true;
                resolve(false);
              }
            });
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                resolve(false);
              }
            }, 5e3);
          } catch (e) {
            resolve(false);
          }
        });
      }
      async sendCommand(pageId, method, params = {}) {
        const conn = this.connections.get(pageId);
        if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
          throw new Error("Not connected");
        }
        const id = this.messageId++;
        return new Promise((resolve, reject) => {
          this.pendingMessages.set(id, { resolve, reject });
          conn.ws.send(JSON.stringify({ id, method, params }));
          setTimeout(() => {
            if (this.pendingMessages.has(id)) {
              this.pendingMessages.delete(id);
              reject(new Error("Timeout"));
            }
          }, 5e3);
        });
      }
      async injectScript(pageId) {
        await this.sendCommand(pageId, "Runtime.evaluate", {
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
        this.log(`
========================================`);
        this.log(`CursorCDP: executeAccept START`);
        this.log(`  backgroundMode=${allowHidden}`);
        this.log(`  connections=${this.connections.size}`);
        this.log(`========================================`);
        for (const [pageId, conn] of this.connections) {
          this.log(`
CursorCDP: Processing page ${pageId}`);
          this.log(`  WebSocket readyState: ${conn.ws.readyState} (1=OPEN)`);
          this.log(`  Script injected: ${conn.injected}`);
          if (conn.ws.readyState !== WebSocket.OPEN) {
            this.log(`  SKIP: WebSocket not open`);
            continue;
          }
          try {
            if (!conn.injected) {
              this.log(`  Injecting script...`);
              await this.injectScript(pageId);
              this.log(`  Script injection complete`);
            }
            this.log(`  Fetching diagnostics...`);
            const diagResult = await this.sendCommand(pageId, "Runtime.evaluate", {
              expression: `window.__autoAcceptCDP ? window.__autoAcceptCDP.getDiagnostics() : { error: 'not loaded' }`,
              returnByValue: true
            });
            const diagnostics = diagResult?.result?.value || {};
            this.log(`  Diagnostics:`, JSON.stringify(diagnostics, null, 2));
            this.log(`  Finding buttons with backgroundMode=${allowHidden}...`);
            const findResult = await this.sendCommand(pageId, "Runtime.evaluate", {
              expression: `window.__autoAcceptCDP ? window.__autoAcceptCDP.findButtons(${allowHidden}) : []`,
              returnByValue: true
            });
            const foundButtons = findResult?.result?.value || [];
            this.log(`  Found ${foundButtons.length} buttons:`, foundButtons);
            this.log(`  Calling forceClick(${allowHidden})...`);
            const result = await this.sendCommand(pageId, "Runtime.evaluate", {
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
        this.log(`
========================================`);
        this.log(`CursorCDP: executeAccept COMPLETE`);
        this.log(`  totalClicked=${totalClicked}`);
        this.log(`========================================
`);
        return { executed: totalClicked };
      }
      async getStuckState(autoAcceptEnabled) {
        for (const [pageId, conn] of this.connections) {
          if (conn.ws.readyState !== WebSocket.OPEN) continue;
          try {
            if (!conn.injected) await this.injectScript(pageId);
            const result = await this.sendCommand(pageId, "Runtime.evaluate", {
              expression: `window.__autoAcceptCDP ? window.__autoAcceptCDP.getStuckState(${autoAcceptEnabled}) : { state: 'unknown' }`,
              returnByValue: true
            });
            const data = result?.result?.value;
            if (data && data.state === "stalled") {
              return data;
            }
          } catch (e) {
          }
        }
        return { state: "running" };
      }
      getConnectionCount() {
        return this.connections.size;
      }
      disconnectAll() {
        for (const [, conn] of this.connections) {
          try {
            conn.ws.close();
          } catch (e) {
          }
        }
        this.connections.clear();
      }
    };
    module2.exports = { CursorCDPHandler };
  }
});

// main_scripts/cursor-launcher.js
var require_cursor_launcher = __commonJS({
  "main_scripts/cursor-launcher.js"(exports2, module2) {
    var vscode2 = require("vscode");
    var { spawn, execSync } = require("child_process");
    var os = require("os");
    var http = require("http");
    var fs = require("fs");
    var path = require("path");
    var BASE_CDP_PORT = 9222;
    var CDP_FLAG = `--remote-debugging-port=${BASE_CDP_PORT}`;
    var CursorLauncher = class {
      constructor(logger = null) {
        this.platform = os.platform();
        this.nextPort = BASE_CDP_PORT;
        this.logger = logger || console.log;
        this.logFile = path.join(os.tmpdir(), "auto_accept_launch.log");
      }
      log(msg) {
        try {
          const timestamp = (/* @__PURE__ */ new Date()).toISOString();
          const formattedMsg = `[CursorLauncher ${timestamp}] ${msg}`;
          if (this.logger && typeof this.logger === "function") {
            this.logger(formattedMsg);
          }
          console.log(formattedMsg);
        } catch (e) {
          console.error("CursorLauncher log error:", e);
        }
      }
      logToFile(msg) {
        const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}
`;
        try {
          fs.appendFileSync(this.logFile, line);
        } catch (e) {
        }
        this.log(msg);
      }
      /**
       * Check if CDP is available on a port
       */
      async isCDPAvailable(port = BASE_CDP_PORT) {
        return new Promise((resolve) => {
          const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
            resolve(res.statusCode === 200);
          });
          req.on("error", () => resolve(false));
          req.setTimeout(2e3, () => {
            req.destroy();
            resolve(false);
          });
        });
      }
      /**
       * Get current workspace folders as command line arguments
       */
      getWorkspaceFolders() {
        const folders = vscode2.workspace.workspaceFolders;
        if (!folders || folders.length === 0) return [];
        return folders.map((f) => f.uri.fsPath);
      }
      /**
       * Main entry point: launch new Cursor with CDP and close current
       */
      async launchAndReplace() {
        const port = this.nextPort;
        const exePath = process.execPath;
        const workspaceFolders = this.getWorkspaceFolders();
        try {
          fs.writeFileSync(this.logFile, `=== Relaunch started at ${(/* @__PURE__ */ new Date()).toISOString()} ===
`);
        } catch (e) {
        }
        this.logToFile(`Starting relaunch`);
        this.logToFile(`  Platform: ${this.platform}`);
        this.logToFile(`  Executable: ${exePath}`);
        this.logToFile(`  CDP Port: ${port}`);
        this.logToFile(`  Workspace folders: ${workspaceFolders.join(", ") || "(none)"}`);
        if (!exePath || !fs.existsSync(exePath)) {
          this.logToFile(`ERROR: Invalid executable path`);
          return { success: false, error: "Invalid executable path" };
        }
        try {
          if (this.platform === "win32") {
            return await this.launchWindows(exePath, port, workspaceFolders);
          } else {
            return await this.launchUnix(exePath, port, workspaceFolders);
          }
        } catch (error) {
          this.logToFile(`ERROR: ${error.message}`);
          return { success: false, error: error.message };
        }
      }
      /**
       * Windows: Use batch file for reliable detached launch
       */
      async launchWindows(exePath, port, workspaceFolders) {
        this.logToFile(`launchWindows: Using batch file approach`);
        const batchPath = path.join(os.tmpdir(), "relaunch_cursor.bat");
        const folderArgs = workspaceFolders.map((f) => `"${f}"`).join(" ");
        const batchContent = `@echo off
REM Auto Accept Agent - Cursor Relaunch Script
REM Generated: ${(/* @__PURE__ */ new Date()).toISOString()}

set LOGFILE=%TEMP%\\auto_accept_launch.log

echo [%date% %time%] === Batch script started === >> "%LOGFILE%"
echo [%date% %time%] Waiting 3 seconds for parent to close... >> "%LOGFILE%"
timeout /t 3 /nobreak >nul

echo [%date% %time%] Launching Cursor with CDP on port ${port}... >> "%LOGFILE%"
echo [%date% %time%] Exe: "${exePath}" >> "%LOGFILE%"
echo [%date% %time%] Folders: ${folderArgs || "(none)"} >> "%LOGFILE%"

start "" "${exePath}" --remote-debugging-port=${port} ${folderArgs}

if %ERRORLEVEL% EQU 0 (
    echo [%date% %time%] SUCCESS: Cursor launched >> "%LOGFILE%"
) else (
    echo [%date% %time%] ERROR: Launch failed with code %ERRORLEVEL% >> "%LOGFILE%"
)

echo [%date% %time%] === Batch script complete === >> "%LOGFILE%"
`;
        try {
          fs.writeFileSync(batchPath, batchContent, "utf8");
          this.logToFile(`launchWindows: Batch file written to ${batchPath}`);
        } catch (e) {
          this.logToFile(`launchWindows: Failed to write batch file: ${e.message}`);
          return { success: false, error: `Failed to write batch file: ${e.message}` };
        }
        try {
          this.logToFile(`launchWindows: Spawning batch file...`);
          const child = spawn("cmd.exe", ["/c", batchPath], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            cwd: os.tmpdir()
          });
          child.on("error", (err) => {
            this.logToFile(`launchWindows: Spawn error: ${err.message}`);
          });
          child.unref();
          this.logToFile(`launchWindows: Batch file spawned successfully`);
        } catch (e) {
          this.logToFile(`launchWindows: Failed to spawn: ${e.message}`);
          return { success: false, error: `Failed to spawn: ${e.message}` };
        }
        this.logToFile(`launchWindows: Scheduling quit in 1500ms...`);
        setTimeout(() => {
          this.logToFile(`launchWindows: Executing quit command`);
          vscode2.commands.executeCommand("workbench.action.quit");
        }, 1500);
        return { success: true, port };
      }
      /**
       * macOS/Linux: Use shell script
       */
      async launchUnix(exePath, port, workspaceFolders) {
        this.logToFile(`launchUnix: Using shell script approach`);
        const scriptPath = path.join(os.tmpdir(), "relaunch_cursor.sh");
        const folderArgs = workspaceFolders.map((f) => `"${f}"`).join(" ");
        const scriptContent = `#!/bin/bash
# Auto Accept Agent - Cursor Relaunch Script
LOG_FILE="/tmp/auto_accept_launch.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"; }

log "=== Shell script started ==="
log "Waiting 3 seconds..."
sleep 3

log "Launching Cursor with CDP on port ${port}..."
log "Exe: ${exePath}"
log "Folders: ${folderArgs || "(none)"}"

"${exePath}" --remote-debugging-port=${port} ${folderArgs} >> "$LOG_FILE" 2>&1 &
PID=$!

log "Cursor launched with PID: $PID"
log "=== Shell script complete ==="
`;
        try {
          fs.writeFileSync(scriptPath, scriptContent, { mode: 493 });
          this.logToFile(`launchUnix: Script written to ${scriptPath}`);
        } catch (e) {
          return { success: false, error: `Failed to write script: ${e.message}` };
        }
        try {
          const child = spawn("/bin/bash", [scriptPath], {
            detached: true,
            stdio: "ignore"
          });
          child.unref();
          this.logToFile(`launchUnix: Script spawned`);
        } catch (e) {
          return { success: false, error: `Failed to spawn: ${e.message}` };
        }
        setTimeout(() => {
          vscode2.commands.executeCommand("workbench.action.quit");
        }, 1500);
        return { success: true, port };
      }
      /**
       * One-time setup: Modify Windows shortcuts to include CDP flag
       */
      async setupCDPShortcuts() {
        if (this.platform !== "win32") {
          this.log("setupCDPShortcuts: Only Windows supported for automatic setup");
          return { success: false, error: "Manual setup required on macOS/Linux" };
        }
        this.log("setupCDPShortcuts: Starting Windows shortcut modification");
        const shortcuts = [
          // Start Menu shortcut
          path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Cursor", "Cursor.lnk"),
          // Desktop shortcut (if exists)
          path.join(process.env.USERPROFILE || "", "Desktop", "Cursor.lnk")
        ];
        let modified = 0;
        const results = [];
        for (const shortcutPath of shortcuts) {
          if (!fs.existsSync(shortcutPath)) {
            this.log(`setupCDPShortcuts: Shortcut not found: ${shortcutPath}`);
            continue;
          }
          try {
            const psCommand = `
                    $shell = New-Object -ComObject WScript.Shell
                    $shortcut = $shell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
                    if ($shortcut.Arguments -notlike '*--remote-debugging-port*') {
                        $shortcut.Arguments = '${CDP_FLAG} ' + $shortcut.Arguments
                        $shortcut.Save()
                        Write-Output 'MODIFIED'
                    } else {
                        Write-Output 'ALREADY_SET'
                    }
                `.trim();
            const result = execSync(`powershell -Command "${psCommand}"`, { encoding: "utf8" }).trim();
            if (result === "MODIFIED") {
              this.log(`setupCDPShortcuts: Modified ${shortcutPath}`);
              modified++;
              results.push({ path: shortcutPath, status: "modified" });
            } else {
              this.log(`setupCDPShortcuts: Already configured: ${shortcutPath}`);
              results.push({ path: shortcutPath, status: "already_set" });
            }
          } catch (e) {
            this.log(`setupCDPShortcuts: Error modifying ${shortcutPath}: ${e.message}`);
            results.push({ path: shortcutPath, status: "error", error: e.message });
          }
        }
        return { success: true, modified, results };
      }
      /**
       * Show setup prompt to user (one-time configuration)
       */
      async showSetupPrompt() {
        this.log("showSetupPrompt: Displaying setup dialog");
        const choice = await vscode2.window.showInformationMessage(
          "Auto Accept needs a quick one-time setup to enable background mode. This only takes a few seconds.",
          { modal: true },
          "Setup Now",
          "Not Now"
        );
        this.log(`showSetupPrompt: User chose: ${choice}`);
        if (choice === "Setup Now") {
          const result = await this.setupCDPShortcuts();
          if (result.success && result.modified > 0) {
            vscode2.window.showInformationMessage(
              "\u2705 Setup complete! Please close Cursor and reopen it from the Start Menu to activate background mode."
            );
            return "setup_complete";
          } else if (result.success && result.modified === 0) {
            vscode2.window.showInformationMessage(
              "Already set up! Just close and reopen Cursor from the Start Menu."
            );
            return "already_configured";
          } else {
            vscode2.window.showErrorMessage(`Setup failed: ${result.error}`);
            return "failed";
          }
        }
        return "cancelled";
      }
      /**
       * Legacy relaunch prompt (kept for compatibility)
       */
      async showLaunchPrompt() {
        return await this.showSetupPrompt();
      }
      getLogFilePath() {
        return this.logFile;
      }
    };
    module2.exports = { CursorLauncher, BASE_CDP_PORT };
  }
});

// extension.js
var vscode = require("vscode");
var SettingsPanel = null;
function getSettingsPanel() {
  if (!SettingsPanel) {
    try {
      SettingsPanel = require_settings_panel().SettingsPanel;
    } catch (e) {
      console.error("Failed to load SettingsPanel:", e);
    }
  }
  return SettingsPanel;
}
var GLOBAL_STATE_KEY = "auto-accept-enabled-global";
var FREQ_STATE_KEY = "auto-accept-frequency";
var LOCK_KEY = "auto-accept-instance-lock";
var HEARTBEAT_KEY = "auto-accept-instance-heartbeat";
var INSTANCE_ID = Math.random().toString(36).substring(7);
var isEnabled = false;
var isPro = false;
var isLockedOut = false;
var pollFrequency = 2e3;
var pollTimer;
var statusBarItem;
var statusSettingsItem;
var outputChannel;
var currentIDE = "unknown";
var globalContext;
var cursorCDP;
var cursorLauncher;
function log(message) {
  try {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().split("T")[1].split(".")[0];
    const logLine = `[${timestamp}] ${message}`;
    console.log(logLine);
    if (outputChannel) {
      outputChannel.appendLine(logLine);
    }
  } catch (e) {
    console.error("Logging failed:", e);
  }
}
function detectIDE() {
  try {
    const appName = vscode.env.appName || "";
    if (appName.toLowerCase().includes("cursor")) {
      return "cursor";
    }
  } catch (e) {
    console.error("Error detecting IDE:", e);
  }
  return "antigravity";
}
async function activate(context) {
  globalContext = context;
  console.log("Auto Accept Extension: Activator called.");
  try {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = "auto-accept.toggle";
    statusBarItem.text = "$(sync~spin) Auto Accept: Loading...";
    statusBarItem.tooltip = "Auto Accept is initializing...";
    context.subscriptions.push(statusBarItem);
    statusBarItem.show();
    statusSettingsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    statusSettingsItem.command = "auto-accept.openSettings";
    statusSettingsItem.text = "$(gear)";
    statusSettingsItem.tooltip = "Auto Accept Settings & Pro Features";
    context.subscriptions.push(statusSettingsItem);
    statusSettingsItem.show();
    console.log("Auto Accept: Status bar items created and shown.");
  } catch (sbError) {
    console.error("CRITICAL: Failed to create status bar items:", sbError);
  }
  try {
    isEnabled = context.globalState.get(GLOBAL_STATE_KEY, false);
    isPro = false;
    if (isPro) {
      pollFrequency = context.globalState.get(FREQ_STATE_KEY, 1e3);
    } else {
      pollFrequency = 300;
    }
    currentIDE = detectIDE();
    outputChannel = vscode.window.createOutputChannel("Auto Accept");
    context.subscriptions.push(outputChannel);
    log(`Auto Accept: Activating...`);
    log(`Auto Accept: Detected environment: ${currentIDE.toUpperCase()}`);
    if (currentIDE === "cursor") {
      try {
        const { CursorCDPHandler } = require_cursor_cdp();
        const { CursorLauncher, BASE_CDP_PORT } = require_cursor_launcher();
        cursorCDP = new CursorCDPHandler(BASE_CDP_PORT, BASE_CDP_PORT + 10, log);
        if (cursorCDP.setProStatus) {
          cursorCDP.setProStatus(isPro);
        }
        cursorLauncher = new CursorLauncher(log);
        log("Cursor handlers initialized.");
      } catch (err) {
        log(`Failed to initialize Cursor handlers: ${err.message}`);
        vscode.window.showErrorMessage(`Auto Accept Error: Failed to load Cursor scripts. ${err.message}`);
      }
    }
    updateStatusBar();
    log("Status bar updated with current state.");
    context.subscriptions.push(
      vscode.commands.registerCommand("auto-accept.toggle", () => handleToggle(context)),
      vscode.commands.registerCommand("auto-accept.relaunch", () => handleRelaunch()),
      vscode.commands.registerCommand("auto-accept.updateFrequency", (freq) => handleFrequencyUpdate(context, freq)),
      vscode.commands.registerCommand("auto-accept.openSettings", () => {
        const panel = getSettingsPanel();
        if (panel) {
          panel.createOrShow(context.extensionUri, context);
        } else {
          vscode.window.showErrorMessage("Failed to load Settings Panel.");
        }
      })
    );
    try {
      await checkEnvironmentAndStart();
    } catch (err) {
      log(`Error in environment check: ${err.message}`);
    }
    log("Auto Accept: Activation complete");
  } catch (error) {
    console.error("ACTIVATION CRITICAL FAILURE:", error);
    log(`ACTIVATION CRITICAL FAILURE: ${error.message}`);
    vscode.window.showErrorMessage(`Auto Accept Extension failed to activate: ${error.message}`);
  }
}
async function ensureCDPOrPrompt(showPrompt = false) {
  if (currentIDE !== "cursor" || !cursorCDP) return;
  const cdpAvailable = await cursorCDP.isCDPAvailable();
  log(`Environment check: CDP Available = ${cdpAvailable}`);
  if (cdpAvailable) {
    await cursorCDP.start();
  } else {
    log("CDP not available.");
    if (showPrompt && cursorLauncher) {
      log("Prompting user for relaunch...");
      await cursorLauncher.showLaunchPrompt();
    } else {
      log("Skipping relaunch prompt (startup). User can click status bar to trigger.");
    }
  }
}
async function checkEnvironmentAndStart() {
  if (isEnabled) {
    if (currentIDE === "cursor") {
      await ensureCDPOrPrompt(false);
    }
    startPolling();
  }
  updateStatusBar();
}
async function handleToggle(context) {
  try {
    isEnabled = !isEnabled;
    await context.globalState.update(GLOBAL_STATE_KEY, isEnabled);
    if (isEnabled) {
      log("Auto Accept: Enabled");
      if (currentIDE === "cursor") {
        await ensureCDPOrPrompt(true);
      }
      startPolling();
    } else {
      log("Auto Accept: Disabled");
      stopPolling();
      if (cursorCDP) await cursorCDP.stop();
    }
    updateStatusBar();
  } catch (e) {
    log(`Error toggling: ${e.message}`);
  }
}
async function handleRelaunch() {
  if (currentIDE !== "cursor") {
    vscode.window.showInformationMessage("Relaunch is only available in Cursor.");
    return;
  }
  if (!cursorLauncher) {
    vscode.window.showErrorMessage("Cursor Launcher not initialized.");
    return;
  }
  log("Initiating Relaunch...");
  const result = await cursorLauncher.launchAndReplace();
  if (!result.success) {
    vscode.window.showErrorMessage(`Relaunch failed: ${result.error}`);
  }
}
var agentState = "running";
var retryCount = 0;
var hasSeenUpgradeModal = false;
var MAX_RETRIES = 3;
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  log("Auto Accept: Polling started");
  pollTimer = setInterval(async () => {
    if (!isEnabled) return;
    if (currentIDE !== "cursor") {
      const allowed = await checkInstanceLock();
      if (!allowed) {
        if (!isLockedOut) {
          isLockedOut = true;
          log(`Instance Locked: Another VS Code window has the lock.`);
          updateStatusBar();
        }
        return;
      } else {
        if (isLockedOut) {
          isLockedOut = false;
          log(`Instance Unlocked: Acquired lock.`);
          updateStatusBar();
        }
      }
    }
    let stuckInfo = { state: "running" };
    if (currentIDE === "cursor" && cursorCDP) {
      stuckInfo = await cursorCDP.getStuckState(isEnabled);
    }
    if (stuckInfo.state === "running") {
      if (agentState !== "running" && agentState !== "recovered") {
        log("State transition: " + agentState + " -> running");
        agentState = "running";
        retryCount = 0;
        updateStatusBar();
      }
      await executeAccept();
    } else if (stuckInfo.state === "stalled") {
      if (agentState === "running" || agentState === "recovered") {
        log(`State transition: ${agentState} -> stalled (Reason: ${stuckInfo.reason})`);
        agentState = "stalled";
        updateStatusBar();
      }
      if (!isPro) {
        log("Stalled (Free Tier) - Checking trigger conditions...");
        if (!hasSeenUpgradeModal) {
          const lastDismissedAt = globalContext.globalState.get("auto-accept-lastDismissedAt", 0);
          const now = Date.now();
          const COOLDOWN_MS = 24 * 60 * 60 * 1e3;
          if (now - lastDismissedAt > COOLDOWN_MS) {
            log("Triggering Upgrade Prompt (Eligible: Session=First, Cooldown=Passed)");
            hasSeenUpgradeModal = true;
            const panelClass = getSettingsPanel();
            if (panelClass) {
              panelClass.showUpgradePrompt(globalContext);
            }
          } else {
            log(`Upgrade Prompt suppressed (Cooldown active - ${(COOLDOWN_MS - (now - lastDismissedAt)) / 1e3}s remaining)`);
            hasSeenUpgradeModal = true;
          }
        }
      } else {
        if (retryCount < MAX_RETRIES) {
          agentState = "recovering";
          retryCount++;
          log(`State transition: stalled -> recovering (Attempt ${retryCount}/${MAX_RETRIES})`);
          updateStatusBar();
          await handleRecovery(retryCount);
        } else {
          if (agentState !== "stalled") {
            agentState = "stalled";
            log("Recovery failed. Max retries reached.");
            updateStatusBar();
          }
        }
      }
    }
  }, pollFrequency);
}
async function handleRecovery(attempt) {
  if (!cursorCDP) return;
  log(`Executing Recovery Strategy #${attempt}`);
  try {
    if (attempt === 1) {
      await cursorCDP.executeAccept(true);
    } else if (attempt === 2) {
      await cursorCDP.executeAccept(true);
    } else if (attempt === 3) {
      await cursorCDP.executeAccept(true);
    }
  } catch (e) {
    log(`Recovery attempt ${attempt} failed: ${e.message}`);
  }
}
async function executeAccept() {
  if (currentIDE === "cursor") {
    if (cursorCDP && cursorCDP.isEnabled) {
      try {
        const res = await cursorCDP.executeAccept(true);
        if (res.executed > 0 && agentState === "recovering") {
          agentState = "recovered";
          log("State transition: recovering -> recovered");
          updateStatusBar();
        }
      } catch (e) {
        log(`Cursor CDP execution error: ${e.message}`);
      }
    }
  } else {
    try {
      await vscode.commands.executeCommand("antigravity.agent.acceptAgentStep").then(
        () => {
        },
        (err) => {
        }
      );
    } catch (e) {
    }
  }
}
function updateStatusBar() {
  if (!statusBarItem) return;
  if (isEnabled) {
    let statusText = "ON";
    let tooltip = `Auto Accept is running (${currentIDE} mode).`;
    let bgColor = void 0;
    if (currentIDE === "cursor") {
      if (agentState === "running") {
        statusText = "ON";
        if (cursorCDP && cursorCDP.getConnectionCount() > 0) statusText += " (Background)";
      } else if (agentState === "stalled") {
        statusText = "WAITING";
        tooltip = isPro ? "Agent stalled. Max retries reached." : "Agent waiting \u2014 built-in rules failed";
        bgColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      } else if (agentState === "recovering") {
        statusText = "RECOVERING...";
        tooltip = `Attempting recovery (${retryCount}/${MAX_RETRIES})`;
        bgColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      } else if (agentState === "recovered") {
        statusText = `RECOVERED (${retryCount})`;
        tooltip = `Auto-recovered after ${retryCount} retries.`;
        bgColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      }
    }
    if (isLockedOut) {
      statusText = "PAUSED (Multi-window)";
      bgColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
    statusBarItem.text = `$(check) Auto Accept: ${statusText}`;
    statusBarItem.tooltip = tooltip;
    statusBarItem.backgroundColor = bgColor;
  } else {
    statusBarItem.text = "$(circle-slash) Auto Accept: OFF";
    statusBarItem.tooltip = "Click to enable Auto Accept.";
    statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  }
}
async function checkInstanceLock() {
  if (isPro) return true;
  if (!globalContext) return true;
  const lockId = globalContext.globalState.get(LOCK_KEY);
  const lastHeartbeat = globalContext.globalState.get(HEARTBEAT_KEY, 0);
  const now = Date.now();
  if (!lockId || now - lastHeartbeat > 1e4) {
    await globalContext.globalState.update(LOCK_KEY, INSTANCE_ID);
    await globalContext.globalState.update(HEARTBEAT_KEY, now);
    return true;
  }
  if (lockId === INSTANCE_ID) {
    await globalContext.globalState.update(HEARTBEAT_KEY, now);
    return true;
  }
  return false;
}
function deactivate() {
  stopPolling();
  if (cursorCDP) {
    cursorCDP.stop();
  }
}
module.exports = { activate, deactivate };
