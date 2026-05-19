const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const patcher = require('./lib/auto-run-patcher');
const cdp = require('./lib/cdp-auto-accept');

// ============================================================
// AUTO-ACCEPT AGENT v3.5.0 — CDP Auto-Accept Integration
//
// Architecture:
//   Lightweight command polling loop that auto-accepts agent
//   steps, terminal commands, suggestions, and edit blocks.
//   All commands verified against AG's actual command registry.
// ============================================================

// Debug helper — writes to disk with 10MB rotation to prevent disk fill
const DEBUG_TO_FILE = true;
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
let _logSizeChecked = 0;
function debugLog(msg) {
    if (!DEBUG_TO_FILE) return;
    const fs = require('fs'), path = require('path');
    const logPath = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.antigravity', 'auto-accept-debug.log');
    try {
        // Rotate log every 60s check if over 10MB
        const now = Date.now();
        if (now - _logSizeChecked > 60000) {
            _logSizeChecked = now;
            try {
                const stat = fs.statSync(logPath);
                if (stat.size > MAX_LOG_SIZE) {
                    // Keep last 1MB
                    const buf = Buffer.alloc(1024 * 1024);
                    const fd = fs.openSync(logPath, 'r');
                    fs.readSync(fd, buf, 0, buf.length, stat.size - buf.length);
                    fs.closeSync(fd);
                    fs.writeFileSync(logPath, '[rotated at ' + new Date().toISOString() + ']\n' + buf.toString());
                }
            } catch(e) {}
        }
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
    } catch(e) {}
}

let enabled = true;
let autoAcceptInterval = null;
let notificationInterval = null;
let fileAcceptInterval = null;
let statusBarItem = null;
let globalContext = null;
let loopTickCount = 0;

// Verbose logging state
let verboseLogging = true;  // set false to quiet down after debugging
let lastVerboseLog = 0;
const VERBOSE_LOG_INTERVAL = 5000; // log details every 5s max

// Auto-retry state
let consecutiveRetries = 0;
let lastRetryTime = 0;
let retryTimeout = null;

// Error cooldown — suppresses notification clicks when server is erroring
let errorCooldownUntil = 0;      // timestamp: don't click notifications until this time
let errorCooldownCount = 0;      // consecutive error detections
let lastErrorDetectedAt = 0;     // when we last saw an error
const ERROR_COOLDOWN_MS = 5000;  // 5s fixed cooldown between retries (prevents 200ms spam)

// Track accept activity
let lastAcceptSuccess = 0;
let lastUserActivity = Date.now();

/**
 * Get configuration value with defaults
 */
function getConfig(key) {
    const config = vscode.workspace.getConfiguration('auto-accept');
    return config.get(key);
}

/**
 * Log helper — writes to console and output channel
 */
let outputChannel = null;
function log(message) {
    const ts = new Date().toISOString().substring(11, 19);
    const line = `[${ts}] ${message}`;
    console.log(`[AutoAccept] ${message}`);
    outputChannel?.appendLine(line);
}

/**
 * Safely execute a VS Code command — catches both sync throws and async rejections.
 * Returns { cmd, ok: boolean, result? } for logging.
 */
function safeExecute(cmd) {
    try {
        return vscode.commands.executeCommand(cmd).then(
            (result) => ({ cmd, ok: true, result }),
            (err) => ({ cmd, ok: false, error: err?.message })
        );
    } catch (e) {
        return Promise.resolve({ cmd, ok: false, error: e?.message });
    }
}

/**
 * Log which commands actually succeeded (non-trivially).
 * Throttled to avoid output channel spam.
 */
function logCommandResults(loopName, results) {
    if (!verboseLogging) return;
    const now = Date.now();
    if (now - lastVerboseLog < VERBOSE_LOG_INTERVAL) return;
    lastVerboseLog = now;

    const succeeded = results.filter(r => {
        const v = r.status === 'fulfilled' ? r.value : null;
        return v && v.ok && v.result !== undefined;
    });
    const failed = results.filter(r => {
        const v = r.status === 'fulfilled' ? r.value : null;
        return v && !v.ok;
    });

    const succCmds = succeeded.map(r => r.value.cmd);
    const failCmds = failed.map(r => `${r.value.cmd}(${r.value.error || '?'})`);

    log(`[${loopName}] tick=${loopTickCount} | OK=[${succCmds.join(', ')}] | FAIL=[${failCmds.join(', ')}]`);
}

/**
 * Calculate exponential backoff delay with optional jitter
 */
function calculateBackoff(attempt, baseDelay = 1000, maxDelay = 60000, jitterEnabled = true) {
    let delay = baseDelay * Math.pow(2, attempt);
    delay = Math.min(delay, maxDelay);
    if (jitterEnabled) {
        const jitterFactor = 0.75 + Math.random() * 0.5;
        delay = delay * jitterFactor;
    }
    return Math.round(delay);
}

// ============================================================
// ACTIVATION
// ============================================================

function activate(context) {
    debugLog('=== ACTIVATE START ===');
    try {
        globalContext = context;
        debugLog('Phase 1: Creating output channel');
        outputChannel = vscode.window.createOutputChannel('Auto Accept Agent');
        context.subscriptions.push(outputChannel);

        log('Activating Auto Accept Agent v3.5.0...');
        debugLog('Phase 2: Reading config');

        // Load saved state — default to true if unset
        const savedEnabled = getConfig('enabled');
        enabled = savedEnabled !== undefined ? savedEnabled : true;
        debugLog(`Phase 2 done: enabled=${enabled}`);

        // Create status bar item — show basic state immediately, defer patch check
        debugLog('Phase 3: Creating status bar');
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
        statusBarItem.command = 'auto-accept.toggle';
        context.subscriptions.push(statusBarItem);
        // Set a quick initial label without calling patcher.checkAll() (avoids heavy I/O during startup)
        if (enabled) {
            statusBarItem.text = '$(check) Auto Accept: ON';
            statusBarItem.tooltip = 'Auto-Accept is running. Click to pause.';
            statusBarItem.backgroundColor = undefined;
        } else {
            statusBarItem.text = '$(circle-slash) Auto Accept: OFF';
            statusBarItem.tooltip = 'Auto-Accept is paused. Click to resume.';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        statusBarItem.show();
        debugLog('Phase 3 done: status bar shown');

        // Register commands
        debugLog('Phase 4: Registering commands');
        context.subscriptions.push(
            vscode.commands.registerCommand('auto-accept.toggle', () => toggleAutoAccept()),
            vscode.commands.registerCommand('auto-accept.editBannedCommands', () => editBannedCommands()),
            vscode.commands.registerCommand('auto-accept.resetBannedCommands', () => resetBannedCommands()),
            vscode.commands.registerCommand('auto-accept.discoverCommands', () => discoverAntigravityCommands()),
            vscode.commands.registerCommand('auto-accept.openQuickSettings', () => openQuickSettings()),
            vscode.commands.registerCommand('auto-accept.diagnostics', () => runDiagnostics()),
            vscode.commands.registerCommand('auto-accept.applyPatch', () => applyPatchManual()),
            vscode.commands.registerCommand('auto-accept.revertPatch', () => revertPatchManual()),
            vscode.commands.registerCommand('auto-accept.showStatus', () => showPatchStatus()),
            vscode.commands.registerCommand('auto-accept.cdpStatus', () => showCdpStatus())
        );
        debugLog('Phase 4 done: commands registered');

        // Listen for configuration changes
        debugLog('Phase 5: Config listener');
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('auto-accept')) {
                    handleConfigChange();
                }
            })
        );
        debugLog('Phase 5 done');

        // Source patch disabled on startup — can crash AG. Use manual apply:
        // Ctrl+Shift+P → "Auto Accept: Apply Auto-Run Fix"
        // applyPatchSilent();

        // Start the polling loop if enabled — DELAYED to let AG fully initialize
        if (enabled) {
            debugLog('Phase 6: Scheduling polling loop start (3s delay)');
            setTimeout(() => {
                debugLog('Phase 6 FIRING: Starting polling loop now');
                startLoop();
                // Start CDP auto-accept after polling loops
                startCdpService();
            }, 3000);
        } else {
            debugLog('Phase 6: Skipped (disabled)');
        }

        // Deferred status bar update — runs the heavy patcher.checkAll() after a delay,
        // giving AG time to fully initialize before we read its bundle files.
        debugLog('Phase 7: Scheduling deferred status bar update (8s)');
        setTimeout(() => {
            debugLog('Phase 7 FIRING: updateStatusBar');
            updateStatusBar();
        }, 8000);

        // Phase 8: Auto-enable "Agent Non-Workspace File Access" default
        // This setting resets on AG updates; flip the default so it stays enabled
        debugLog('Phase 8: Scheduling nonWorkspace default fix (10s)');
        setTimeout(() => {
            ensureWorkbenchDefaults();
        }, 10000);

        debugLog('=== ACTIVATE END (success) ===');
        log(`Activated. Enabled: ${enabled}`);
    } catch (e) {
        debugLog(`=== ACTIVATE CRASHED: ${e.message} ===`);
        debugLog(`Stack: ${e.stack}`);
        log(`FATAL: Activation crashed: ${e.message}`);
    }
}

// ============================================================
// POLLING LOOP
// ============================================================

function handleConfigChange() {
    const newEnabled = getConfig('enabled');
    const enabledChanged = newEnabled !== enabled;

    if (enabledChanged) {
        enabled = newEnabled;
        if (enabled) {
            startLoop();
        } else {
            stopLoop();
        }
    } else if (enabled && autoAcceptInterval) {
        // Only restart for polling interval change if enabled state didn't change
        // (avoids double stop+start when toggling enabled)
        stopLoop();
        startLoop();
    }

    updateStatusBar();
    log('Configuration updated');
}

async function toggleAutoAccept() {
    enabled = !enabled;
    updateStatusBar();

    if (enabled) {
        vscode.window.showInformationMessage('Auto-Accept: ON');
        startLoop();
    } else {
        vscode.window.showInformationMessage('Auto-Accept: OFF');
        stopLoop();
    }

    // Persist to settings — may fail if settings.json has unsaved changes in editor
    try {
        const config = vscode.workspace.getConfiguration('auto-accept');
        await config.update('enabled', enabled, vscode.ConfigurationTarget.Global);
    } catch (e) {
        log(`Warning: Could not persist enabled state to settings: ${e.message}`);
    }

    log(`Auto Accept toggled: ${enabled ? 'ON' : 'OFF'}`);
}

function updateStatusBar() {
    if (!statusBarItem) return;

    if (enabled) {
        const cdpStatus = cdp.getStatus();
        const cdpLabel = cdpStatus.connected ? ' | CDP ✓' : ' | CDP OFF';

        // Detect AG architecture to avoid misleading "not patched" on AG 2.0
        const agPath = patcher.findAntigravityPath();
        const arch = agPath ? patcher.detectArchitecture(agPath) : null;
        const isModern = arch === patcher.ARCH_MODERN;

        if (isModern) {
            // AG 2.0: source patching doesn't apply — show clean status
            statusBarItem.text = `$(check) Auto Accept: ON (AG 2.0)${cdpLabel}`;
            statusBarItem.tooltip = cdpStatus.connected 
                ? `Auto-Accept running with CDP on AG 2.0. Click to pause.`
                : 'Auto-Accept running via polling on AG 2.0. Launch with --remote-debugging-port=9333 for CDP.';
            statusBarItem.backgroundColor = undefined;
        } else {
            // Legacy AG: check patch status
            patcher.checkAll().then(results => {
                const anyPatched = results.some(r => r.patched);
                const suffix = anyPatched ? ' (patched)' : ' (not patched)';
                if (anyPatched || cdpStatus.connected) {
                    statusBarItem.text = `$(check) Auto Accept: ON${suffix}${cdpLabel}`;
                    statusBarItem.tooltip = cdpStatus.connected 
                        ? `Auto-Accept running with CDP. Click to pause.`
                        : 'Auto-Accept is running with source patch. Click to pause.';
                    statusBarItem.backgroundColor = undefined;
                } else {
                    statusBarItem.text = `$(warning) Auto Accept: ON${suffix}`;
                    statusBarItem.tooltip = 'Running via polling only — launch AG with --remote-debugging-port=9333 for CDP.\nCtrl+Shift+P → "Auto Accept: Apply Auto-Run Fix"';
                    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                }
            }).catch(() => {
                statusBarItem.text = `$(check) Auto Accept: ON${cdpLabel}`;
                statusBarItem.tooltip = cdpStatus.connected 
                    ? `Auto-Accept running with CDP. Click to pause.`
                    : 'Auto-Accept is running. Click to pause.';
                statusBarItem.backgroundColor = undefined;
            });
        }
    } else {
        statusBarItem.text = '$(circle-slash) Auto Accept: OFF';
        statusBarItem.tooltip = 'Auto-Accept is paused. Click to resume.';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

function startLoop() {
    debugLog('startLoop() called');
    if (autoAcceptInterval) clearInterval(autoAcceptInterval);
    if (notificationInterval) clearInterval(notificationInterval);
    if (fileAcceptInterval) clearInterval(fileAcceptInterval);

    // Reset timers
    const now = Date.now();
    lastAcceptSuccess = now;
    lastUserActivity = now;
    lastRetryTime = now;
    consecutiveRetries = 0;

    const pollingInterval = getConfig('pollingInterval') || 500;
    debugLog(`startLoop config: pollingInterval=${pollingInterval}`);

    // FAST LOOP (200ms) — Notifications only
    // These are lightweight UI dismissals, safe to fire frequently.
    // DO NOT put agent/cascade/terminal accept commands here — they
    // can prematurely accept incomplete steps while edits are generating.
    const approvalCommands = [
        'notification.acceptPrimaryAction',
        'notification.acceptSecondaryAction',
    ];
    let fastTickCount = 0;
    notificationInterval = setInterval(async () => {
        try {
            if (!enabled) return;
            fastTickCount++;
            
            // ERROR COOLDOWN: Skip notification clicks while server is erroring
            // This prevents the rapid retry cascade (Continue → error → Continue → error)
            if (Date.now() < errorCooldownUntil) {
                if (fastTickCount % 500 === 0) {
                    const secsLeft = Math.round((errorCooldownUntil - Date.now()) / 1000);
                    debugLog(`FAST tick #${fastTickCount} COOLDOWN: ${secsLeft}s remaining (${errorCooldownCount} consecutive errors)`);
                }
                return; // Don't click anything during cooldown
            }
            
            const logThis = fastTickCount <= 3 || fastTickCount % 1500 === 0; // ~every 5min
            if (logThis) debugLog(`FAST tick #${fastTickCount}`);
            const results = await Promise.allSettled(approvalCommands.map(safeExecute));
            // Don't log notification accepts — they fire constantly as no-ops
            logCommandResults('FAST', results);
        } catch (e) {
            debugLog(`FAST loop EXCEPTION: ${e.message}`);
        }
    }, 200);

    // MAIN LOOP (500ms) — Step/command acceptance
    // Commands verified against AG IDE 2.0.1 (VS Code engine 1.107.0).
    // Commands removed in 1.21.9+: antigravity.agent.acceptAgentStep,
    // antigravity.terminalCommand.run/accept, antigravity.command.accept
    let mainTickCount = 0;
    autoAcceptInterval = setInterval(async () => {
        try {
            if (!enabled) return;
            loopTickCount++;
            mainTickCount++;
            const logMain = mainTickCount <= 3 || mainTickCount % 600 === 0; // ~every 5min
            if (logMain) debugLog(`MAIN tick #${mainTickCount}`);

            const allCommands = [];

            // Terminal run commands (auto-run terminal commands the agent wants to execute)
            if (getConfig('acceptRunCommands')) {
                allCommands.push(
                    'workbench.action.terminal.chat.runCommand',         // VS Code: run terminal chat command
                    'workbench.action.terminal.chat.runFirstCommand'     // VS Code: run first terminal chat command
                );
            }

            // Agent step acceptance (hunk-level + file-level)
            if (getConfig('acceptAgentSteps')) {
                allCommands.push(
                    'antigravity.prioritized.agentAcceptFocusedHunk',    // AG-native: accept focused diff hunk
                    'chatEditing.acceptFile',                            // VS Code: accept single file edit
                    'chatEditing.acceptAllFiles',                        // VS Code: accept all pending file edits
                    'workbench.files.action.acceptLocalChanges',         // VS Code: accept local file changes (creates!)
                    'antigravity.prioritized.agentAcceptAllInFile',      // AG-native: accept all hunks in file
                    'workbench.action.chat.acceptTool',                  // AG: approve tool call BEFORE execution
                    'workbench.action.chat.acceptToolPostExecution'      // AG: approve tool result AFTER execution
                );
            }

            // Terminal command acceptance (accept/confirm terminal suggestions)
            if (getConfig('acceptTerminalCommands')) {
                allCommands.push(
                    'workbench.action.terminal.acceptSelectedSuggestion' // VS Code: accept terminal suggestion
                );
            }

            // Inline code suggestions (autocomplete, supercomplete, tab)
            if (getConfig('acceptSuggestions')) {
                allCommands.push(
                    'antigravity.acceptCompletion',                             // AG-native: accept completion
                    'antigravity.prioritized.supercompleteAccept',              // AG-native: supercomplete
                    'editor.action.inlineSuggest.acceptNextLine',               // VS Code: accept next inline suggestion line
                    'editor.action.accessibleViewAcceptInlineCompletion'        // VS Code: accessible accept
                );
            }

            // Edit block acceptance (inline chat, interactive edits)
            if (getConfig('acceptEditBlocks')) {
                allCommands.push(
                    'inlineChat.acceptChanges',     // VS Code: accept inline chat changes
                    'interactive.acceptChanges'     // VS Code: accept interactive changes
                );
            }

            // Always include notification accept as backstop
            allCommands.push('notification.acceptPrimaryAction');

            const results = await Promise.allSettled(allCommands.map(safeExecute));
            logCommandResults('MAIN', results);
        } catch (e) {
            debugLog(`MAIN loop EXCEPTION: ${e.message}\n${e.stack}`);
            log(`Loop error (non-fatal): ${e.message}`);
        }
    }, pollingInterval);

    // SLOW LOOP (1500ms) — File-level acceptance
    // These commands operate on whole files and need the diff UI to fully materialize
    // before firing. The 1500ms delay prevents the race condition where the accept
    // fires before the diff content is rendered.
    let slowTickCount = 0;
    fileAcceptInterval = setInterval(async () => {
        try {
            if (!enabled) return;
            slowTickCount++;
            const logSlow = slowTickCount <= 3 || slowTickCount % 200 === 0; // ~every 5min
            if (logSlow) debugLog(`SLOW tick #${slowTickCount}`);
            const slowCommands = [];

            if (getConfig('acceptAgentSteps')) {
                slowCommands.push(
                    'antigravity.prioritized.agentAcceptAllInFile'      // AG-native: accept all hunks in focused file
                );
            }
            if (getConfig('acceptAll')) {
                slowCommands.push(
                    'chatEditing.acceptAllFiles'                        // VS Code: accept all file edits
                );
            }

            const results = await Promise.allSettled(slowCommands.map(safeExecute));
            if (logSlow) {
                const slowSucceeded = results.filter(r => r.status === 'fulfilled' && r.value && r.value.ok);
                if (slowSucceeded.length > 0) debugLog(`SLOW tick #${slowTickCount} ACCEPTED: ${slowSucceeded.map(r => r.value.cmd).join(', ')}`);
                const failed = results.filter(r => r.status === 'fulfilled' && r.value && !r.value.ok);
                if (failed.length > 0) debugLog(`SLOW tick #${slowTickCount} failures: ${failed.map(r => `${r.value.cmd}(${r.value.error})`).join(', ')}`);
            }
            logCommandResults('SLOW', results);
        } catch (e) {
            debugLog(`SLOW loop EXCEPTION: ${e.message}`);
        }
    }, 1500);

    // RETRY LOOP — CDP-based error detection and Retry button clicking (5s polling)
    // Always starts. Detects errors via DOM text, clicks Retry button via CDP.
    // No focus stealing. No cooldowns.
    {
        const cdpPort = getConfig('cdpPort') || 9333;
        debugLog(`RETRY: Starting CDP retry loop on port ${cdpPort}`);
        
        retryTimeout = setInterval(async () => {
            try {
                if (!enabled) return;
                
                // Step 1: Fetch targets from CDP
                const http = require('http');
                const targets = await new Promise((resolve, reject) => {
                    const req = http.get(`http://127.0.0.1:${cdpPort}/json/list`, { timeout: 2000 }, (res) => {
                        let data = '';
                        res.on('data', c => data += c);
                        res.on('end', () => {
                            try { resolve(JSON.parse(data)); }
                            catch (e) { reject(e); }
                        });
                    });
                    req.on('error', reject);
                    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
                });
                
                debugLog(`RETRY-DBG: Got ${targets.length} targets from CDP`);
                
                // Step 2: Check each page target for error text
                const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
                const WebSocket = require('ws');
                
                debugLog(`RETRY-DBG: ${pages.length} page targets with WS URLs`);
                
                let errorCount = 0;
                let errorText = '';
                
                for (const target of pages) {
                    try {
                        const result = await new Promise((resolve, reject) => {
                            const ws = new WebSocket(target.webSocketDebuggerUrl);
                            const timer = setTimeout(() => { ws.close(); reject(new Error('ws timeout')); }, 3000);
                            ws.on('open', () => {
                                ws.send(JSON.stringify({
                                    id: 1, method: 'Runtime.evaluate',
                                    params: { expression: `(function(){var t=(document.body.innerText||'').toLowerCase(),l=t.substring(Math.max(0,t.length-3000)),i=['high traffic','something went wrong','rate limit','bad gateway','service unavailable','overloaded','server error','agent terminated due to error'];for(var j=0;j<i.length;j++)if(l.indexOf(i[j])!==-1)return i[j];return''})()`, returnByValue: true }
                                }));
                            });
                            ws.on('message', (m) => {
                                const p = JSON.parse(m.toString());
                                if (p.id === 1) {
                                    clearTimeout(timer);
                                    ws.close();
                                    const val = p.result?.result?.value || '';
                                    if (val) debugLog(`RETRY-DBG: Target "${target.title?.substring(0,40)}" matched: "${val}"`);
                                    resolve(val);
                                }
                            });
                            ws.on('error', (e) => { clearTimeout(timer); debugLog(`RETRY-DBG: WS error for "${target.title?.substring(0,40)}": ${e.message}`); reject(e); });
                        });
                        
                        if (result && result.length > 0) {
                            errorCount++;
                            errorText = result;
                        }
                    } catch (e) {
                        debugLog(`RETRY-DBG: Target "${target.title?.substring(0,40)}" failed: ${e.message}`);
                    }
                }
                // Step 3: If error found, click Retry button via CDP DOM
                if (errorCount > 0) {
                    debugLog(`RETRY: Detected "${errorText}" — clicking Retry via CDP`);
                    for (const target of pages) {
                        try {
                            const clickResult = await new Promise((resolve, reject) => {
                                const ws2 = new WebSocket(target.webSocketDebuggerUrl);
                                const timer2 = setTimeout(() => { ws2.close(); reject(new Error('timeout')); }, 3000);
                                ws2.on('open', () => {
                                    ws2.send(JSON.stringify({
                                        id: 1, method: 'Runtime.evaluate',
                                        params: { expression: `(function(){var btns=document.querySelectorAll('button,a,[role="button"],.monaco-button');for(var i=0;i<btns.length;i++){var t=(btns[i].textContent||'').trim();if(t==='Retry'||t==='Continue'){btns[i].click();return 'clicked:'+t}}return''})()`, returnByValue: true }
                                    }));
                                });
                                ws2.on('message', (m) => {
                                    const p = JSON.parse(m.toString());
                                    if (p.id === 1) {
                                        clearTimeout(timer2);
                                        ws2.close();
                                        resolve(p.result?.result?.value || '');
                                    }
                                });
                                ws2.on('error', () => { clearTimeout(timer2); reject(); });
                            });
                            if (clickResult && clickResult.startsWith('clicked:')) {
                                debugLog(`RETRY: ${clickResult} via CDP DOM`);
                                break;
                            }
                        } catch (e) {}
                    }
                }
                
            } catch (e) {
                // CDP not available - expected when AG not launched with --remote-debugging-port
            }
        }, 5000);
    }

    debugLog(`Polling loops started: main=${pollingInterval}ms, fast=200ms, slow=1500ms, retry=5s(CDP)`);
    log(`Polling loop started (main: ${pollingInterval}ms, fast: 200ms, slow: 1500ms, retry: CDP, verbose: ${verboseLogging})`);
}


function stopLoop() {
    if (autoAcceptInterval) {
        clearInterval(autoAcceptInterval);
        autoAcceptInterval = null;
    }
    if (notificationInterval) {
        clearInterval(notificationInterval);
        notificationInterval = null;
    }
    if (fileAcceptInterval) {
        clearInterval(fileAcceptInterval);
        fileAcceptInterval = null;
    }
    if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
    }
    log('Polling loop stopped');
}

// ============================================================
// SAFETY — Banned Commands
// ============================================================

function isCommandBanned(commandText) {
    if (!commandText || commandText.length === 0) return false;

    const bannedCommands = getConfig('bannedCommands') || [];
    const lowerText = commandText.toLowerCase();

    for (const pattern of bannedCommands) {
        if (!pattern || pattern.length === 0) continue;

        try {
            if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
                const lastSlash = pattern.lastIndexOf('/');
                const regexPattern = pattern.substring(1, lastSlash);
                const flags = pattern.substring(lastSlash + 1) || 'i';
                const regex = new RegExp(regexPattern, flags);

                if (regex.test(commandText)) {
                    log(`BLOCKED by regex: ${pattern}`);
                    return true;
                }
            } else {
                if (lowerText.includes(pattern.toLowerCase())) {
                    log(`BLOCKED by pattern: ${pattern}`);
                    return true;
                }
            }
        } catch (e) {
            if (lowerText.includes(pattern.toLowerCase())) {
                log(`BLOCKED by pattern(fallback): ${pattern}`);
                return true;
            }
        }
    }

    return false;
}

// ============================================================
// SETTINGS & UTILITY COMMANDS
// ============================================================

async function editBannedCommands() {
    const bannedCommands = getConfig('bannedCommands') || [];
    const currentPatterns = bannedCommands.join('\n');

    const result = await vscode.window.showInputBox({
        prompt: 'Edit banned command patterns (one per line). Use /regex/ for regex patterns.',
        value: currentPatterns,
        placeHolder: 'rm -rf /\nformat c:\n/sudo\\s+rm/',
        validateInput: () => null
    });

    if (result !== undefined) {
        const newPatterns = result.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        const config = vscode.workspace.getConfiguration('auto-accept');
        await config.update('bannedCommands', newPatterns, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Updated ${newPatterns.length} banned patterns.`);
        log(`Banned commands updated: ${newPatterns.length} patterns`);
    }
}

async function resetBannedCommands() {
    const choice = await vscode.window.showWarningMessage(
        'Reset banned commands to defaults?',
        'Yes', 'No'
    );

    if (choice === 'Yes') {
        const defaultPatterns = [
            'rm -rf /', 'rm -rf ~', 'rm -rf *', 'format c:',
            'del /f /s /q', 'rmdir /s /q', ':(){:|:&};:',
            'dd if=', 'mkfs.', '> /dev/sda', 'chmod -R 777 /',
            'sudo rm -rf', 'shutdown', 'reboot'
        ];
        const config = vscode.workspace.getConfiguration('auto-accept');
        await config.update('bannedCommands', defaultPatterns, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('Banned commands reset to defaults.');
        log('Banned commands reset to defaults');
    }
}

async function openQuickSettings() {
    const config = vscode.workspace.getConfiguration('auto-accept');

    const settings = [
        { key: 'enabled', label: 'Master Toggle', description: 'Enable/disable all auto-accept' },
        { key: 'acceptAgentSteps', label: 'Agent Steps', description: 'Auto-accept agent tool calls and file edits' },
        { key: 'acceptTerminalCommands', label: 'Terminal Commands', description: 'Auto-accept terminal/shell commands' },
        { key: 'acceptSuggestions', label: 'Code Suggestions', description: 'Auto-accept inline code suggestions' },
        { key: 'acceptEditBlocks', label: 'Edit Blocks', description: 'Auto-accept code edit blocks' },
        { key: 'acceptAll', label: 'Accept All', description: 'Auto-accept all file changes at once' },
        { key: 'acceptRunCommands', label: 'Run Commands', description: 'Auto-accept "Run command?" dialogs' },
        { key: 'autoRetryOnError', label: 'Auto Retry', description: 'Auto-retry with exponential backoff' },
        { key: 'jitterEnabled', label: 'Retry Jitter', description: 'Add randomization to retry timing' }
    ];

    const items = settings.map(s => {
        const currentValue = config.get(s.key);
        const icon = currentValue ? '$(check)' : '$(circle-slash)';
        const status = currentValue ? 'ON' : 'OFF';
        return {
            label: `${icon} ${s.label}: ${status}`,
            description: s.description,
            key: s.key,
            currentValue: currentValue
        };
    });

    items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(check-all) Enable ALL', description: 'Turn on all auto-accept options', action: 'enableAll' },
        { label: '$(circle-slash) Disable ALL', description: 'Turn off all auto-accept options', action: 'disableAll' }
    );

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Toggle Auto-Accept Settings',
        title: 'Auto Accept Agent — Quick Settings'
    });

    if (!selected) return;

    if (selected.action === 'enableAll') {
        for (const s of settings) {
            await config.update(s.key, true, vscode.ConfigurationTarget.Global);
        }
        vscode.window.showInformationMessage('All auto-accept options ENABLED');
        log('All settings enabled');
    } else if (selected.action === 'disableAll') {
        for (const s of settings) {
            await config.update(s.key, false, vscode.ConfigurationTarget.Global);
        }
        vscode.window.showInformationMessage('All auto-accept options DISABLED');
        log('All settings disabled');
    } else if (selected.key) {
        const newValue = !selected.currentValue;
        await config.update(selected.key, newValue, vscode.ConfigurationTarget.Global);
        const status = newValue ? 'ON' : 'OFF';
        vscode.window.showInformationMessage(`${selected.label.split(':')[0]}: ${status}`);
        log(`${selected.key} set to ${newValue}`);
    }
}

async function discoverAntigravityCommands() {
    try {
        const allCommands = await vscode.commands.getCommands(true);

        const antigravityCommands = allCommands.filter(cmd =>
            cmd.toLowerCase().includes('antigravity') ||
            cmd.toLowerCase().includes('gemini') ||
            cmd.toLowerCase().includes('agent')
        );
        const retryCommands = allCommands.filter(cmd => cmd.toLowerCase().includes('retry'));
        const acceptCommands = allCommands.filter(cmd => cmd.toLowerCase().includes('accept'));
        const continueCommands = allCommands.filter(cmd => cmd.toLowerCase().includes('continue'));
        const chatCommands = allCommands.filter(cmd => cmd.toLowerCase().includes('chat'));
        const terminalCommands = allCommands.filter(cmd => cmd.toLowerCase().includes('terminal'));

        const output = [
            '=== ANTIGRAVITY COMMAND DISCOVERY ===', '',
            '--- RETRY COMMANDS ---', ...retryCommands.sort(), '',
            '--- ACCEPT COMMANDS ---', ...acceptCommands.sort(), '',
            '--- CONTINUE COMMANDS ---', ...continueCommands.sort(), '',
            '--- CHAT COMMANDS ---', ...chatCommands.sort(), '',
            '--- TERMINAL COMMANDS ---', ...terminalCommands.sort(), '',
            '--- ALL ANTIGRAVITY/AGENT/GEMINI COMMANDS ---', ...antigravityCommands.sort()
        ].join('\n');

        const discoveryChannel = vscode.window.createOutputChannel('Auto Accept - Command Discovery');
        discoveryChannel.clear();
        discoveryChannel.appendLine(output);
        discoveryChannel.show();

        await vscode.env.clipboard.writeText(output);
        vscode.window.showInformationMessage(
            `Found ${retryCommands.length} retry, ${acceptCommands.length} accept, ${continueCommands.length} continue, ${chatCommands.length} chat commands. FULL LIST copied to clipboard!`
        );
        log('Discovered commands — copied full list to clipboard');
    } catch (e) {
        vscode.window.showErrorMessage(`Error discovering commands: ${e.message}`);
        log(`Error discovering commands: ${e.message}`);
    }
}

async function runDiagnostics() {
    const config = vscode.workspace.getConfiguration('auto-accept');
    const lines = [
        '=== AUTO-ACCEPT AGENT DIAGNOSTICS (v3.5.0) ===',
        `Time: ${new Date().toISOString()}`,
        '',
        '--- EXTENSION STATE ---',
        `Enabled: ${enabled}`,
        `Fast loop active: ${notificationInterval !== null}`,
        `Main loop active: ${autoAcceptInterval !== null}`,
        `Loop tick count: ${loopTickCount}`,
        `Last accept: ${lastAcceptSuccess ? new Date(lastAcceptSuccess).toISOString() : 'never'}`,
        '',
        '--- SETTINGS ---',
        `acceptRunCommands: ${config.get('acceptRunCommands')}`,
        `acceptAgentSteps: ${config.get('acceptAgentSteps')}`,
        `acceptTerminalCommands: ${config.get('acceptTerminalCommands')}`,
        `acceptSuggestions: ${config.get('acceptSuggestions')}`,
        `acceptEditBlocks: ${config.get('acceptEditBlocks')}`,
        `acceptAll: ${config.get('acceptAll')}`,
        `pollingInterval: ${config.get('pollingInterval')}`,
        '',
        '--- COMMAND TESTS ---'
    ];

    const testCommands = [
        // Only VERIFIED commands from AG command registry
        'notification.acceptPrimaryAction',
        'antigravity.prioritized.agentAcceptFocusedHunk',
        'antigravity.acceptCompletion',
        'antigravity.prioritized.supercompleteAccept',
        'workbench.action.terminal.acceptSelectedSuggestion',
        'chatEditing.acceptFile',
        'chatEditing.acceptAllFiles',
        'antigravity.prioritized.agentAcceptAllInFile',
        'inlineChat.acceptChanges',
        'interactive.acceptChanges',
        'editor.action.inlineSuggest.acceptNextLine',
        'editor.action.accessibleViewAcceptInlineCompletion',
        'workbench.action.focusAgentManager.continueConversation'
    ];

    for (const cmd of testCommands) {
        try {
            await vscode.commands.executeCommand(cmd);
            lines.push(`  OK ${cmd}`);
        } catch (e) {
            lines.push(`  FAIL ${cmd} — ${e.message}`);
        }
    }

    const output = lines.join('\n');
    const diagChannel = vscode.window.createOutputChannel('Auto Accept - Diagnostics');
    diagChannel.clear();
    diagChannel.appendLine(output);
    diagChannel.show();

    await vscode.env.clipboard.writeText(output);
    vscode.window.showInformationMessage(`Diagnostics complete. Tick count: ${loopTickCount}. Copied to clipboard!`);
}

// ============================================================
// SOURCE-LEVEL PATCH
// ============================================================

/**
 * Silently auto-apply the auto-run fix on startup.
 * Fire-and-forget: never blocks activation, never modifies product.json.
 */
async function applyPatchSilent() {
    try {
        const basePath = patcher.findAntigravityPath();
        if (basePath) {
            const arch = patcher.detectArchitecture(basePath);
            log(`[auto-patch] Detected AG: ${arch} at ${basePath}`);
            if (arch === patcher.ARCH_MODERN) {
                log('[auto-patch] AG 2.0 standalone detected — source patching not applicable, using polling/CDP fallback');
                return;
            }
        }

        const results = await patcher.applyAll();
        for (const r of results) {
            if (r.status === 'patched') {
                log(`[auto-patch] ${r.label}: applied (+${r.bytesAdded}b)`);
            } else if (r.status === 'already-patched') {
                log(`[auto-patch] ${r.label}: already patched, skipped`);
            } else if (r.status === 'pattern-not-found') {
                log(`[auto-patch] ${r.label}: pattern not found (AG may have updated)`);
            } else {
                log(`[auto-patch] ${r.label}: ${r.status}${r.error ? ' — ' + r.error : ''}`);
            }
        }
    } catch (e) {
        log(`[auto-patch] Error (non-fatal): ${e.message}`);
    }
}
// ============================================================

async function applyPatchManual() {
    const basePath = patcher.findAntigravityPath();
    if (!basePath) {
        vscode.window.showErrorMessage('Auto Accept: Antigravity installation not found.');
        return;
    }

    const arch = patcher.detectArchitecture(basePath);
    if (arch === patcher.ARCH_MODERN) {
        vscode.window.showInformationMessage(
            'Antigravity 2.0 (standalone) detected. Source patching is not needed — ' +
            'terminal policy is handled server-side. The polling/CDP fallback is active.'
        );
        return;
    }

    const version = patcher.getVersion(basePath);
    vscode.window.showInformationMessage(`Applying auto-run fix to Antigravity ${version}...`);

    const results = await patcher.applyAll();
    const patched = results.filter(r => r.status === 'patched').length;
    const alreadyPatched = results.filter(r => r.status === 'already-patched').length;
    const failed = results.filter(r => !r.success && r.status !== 'already-patched');

    for (const r of results) {
        log(`[patch] ${r.label}: ${r.status}${r.bytesAdded ? ` (+${r.bytesAdded}b)` : ''}${r.error ? ` — ${r.error}` : ''}`);
    }

    if (patched > 0) {
        const action = await vscode.window.showInformationMessage(
            `Auto-run fix applied to ${patched} file(s). You may see a "corrupt installation" warning — this is safe to dismiss. Restart to activate.`,
            'Reload Now'
        );
        if (action === 'Reload Now') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } else if (alreadyPatched > 0) {
        vscode.window.showInformationMessage('Auto-run fix is already applied.');
    } else {
        const msg = failed.length > 0
            ? `Pattern not found — Antigravity ${version} may be incompatible.`
            : 'No target files found.';
        vscode.window.showWarningMessage(msg);
    }
}

async function revertPatchManual() {
    const basePath = patcher.findAntigravityPath();
    if (!basePath) {
        vscode.window.showErrorMessage('Auto Accept: Antigravity installation not found.');
        return;
    }

    const results = await patcher.revertAll();
    const reverted = results.filter(r => r.status === 'reverted').length;
    const clean = results.filter(r => r.status === 'already-clean').length;

    for (const r of results) {
        log(`[revert] ${r.label}: ${r.status}${r.method ? ` (${r.method})` : ''}${r.error ? ` — ${r.error}` : ''}`);
    }

    if (reverted > 0) {
        const action = await vscode.window.showInformationMessage(
            `Auto-run fix reverted (${reverted} file(s)). Restart to apply.`,
            'Reload Now'
        );
        if (action === 'Reload Now') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } else if (clean > 0) {
        vscode.window.showInformationMessage('Files are already clean — no patches to revert.');
    } else {
        vscode.window.showInformationMessage('No patched files found — nothing to revert.');
    }
}

async function showPatchStatus() {
    const basePath = patcher.findAntigravityPath();
    const lines = ['=== AUTO-RUN PATCH STATUS ===', ''];

    if (basePath) {
        const arch = patcher.detectArchitecture(basePath);
        lines.push(`Installation: ${basePath}`);
        lines.push(`Version: ${patcher.getVersion(basePath)}`);
        lines.push(`Architecture: ${arch}`);
        lines.push('');

        if (arch === patcher.ARCH_MODERN) {
            lines.push('ℹ️  AG 2.0 standalone detected');
            lines.push('   Terminal policy is handled server-side by the Go language server.');
            lines.push('   Source-level patching is not applicable.');
            lines.push('   The extension uses polling + CDP as the auto-accept mechanism.');
        } else {
            const statuses = await patcher.checkAll();
            for (const s of statuses) {
                const icon = s.patched ? '✅' : (s.patchable ? '⬜' : '⚠️');
                const state = s.patched ? 'PATCHED' : (s.patchable ? 'NOT PATCHED (patchable)' : 'NOT PATCHED (incompatible)');
                const backup = s.hasBackup ? ' (backup exists)' : '';
                lines.push(`  ${icon} ${s.label}: ${state}${backup}`);
            }
        }
    } else {
        lines.push('Installation: NOT FOUND');
    }

    const output = lines.join('\n');
    outputChannel.clear();
    outputChannel.appendLine(output);
    outputChannel.show(true);

    await vscode.env.clipboard.writeText(output);
    vscode.window.showInformationMessage('Patch status copied to clipboard.');
}

// ============================================================
// AG WORKBENCH DEFAULTS PATCHER
// ============================================================

/**
 * Patches AG workbench defaults that get reset on every update.
 * 
 * Settings patched:
 *   - allowAgentAccessNonWorkspaceFiles: !1 → !0 (allow file access outside workspace)
 *   - allowCascadeAccessGitignoreFiles: !1 → !0 (allow access to gitignored files)
 * 
 * These are source-level default flips — they change what the toggle
 * defaults to, not the user's stored preference. After patching,
 * AG must be restarted to pick up the new defaults.
 */
function ensureWorkbenchDefaults() {
    try {
        const agPath = patcher.findAntigravityPath();
        if (!agPath) {
            debugLog('Phase 8: AG path not found, skipping workbench defaults');
            return;
        }

        // Only applicable to legacy (VS Code fork) architecture
        const arch = patcher.detectArchitecture(agPath);
        if (arch === patcher.ARCH_MODERN) {
            debugLog('Phase 8: AG 2.0 standalone — workbench defaults not applicable');
            return;
        }
        
        const wbPath = path.join(agPath, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
        if (!fs.existsSync(wbPath)) return;
        
        let content = fs.readFileSync(wbPath, 'utf8');
        let changed = false;
        
        // All settings to flip from !1 (false) to !0 (true)
        const patches = [
            {
                target: 'allowAgentAccessNonWorkspaceFiles:!1',
                replacement: 'allowAgentAccessNonWorkspaceFiles:!0',
                label: 'nonWorkspaceFiles'
            },
            {
                target: 'allowCascadeAccessGitignoreFiles:!1',
                replacement: 'allowCascadeAccessGitignoreFiles:!0',
                label: 'gitignoreFiles'
            }
        ];
        
        for (const patch of patches) {
            if (content.includes(patch.replacement)) {
                debugLog(`Phase 8: ${patch.label} already enabled`);
                continue;
            }
            if (!content.includes(patch.target)) {
                debugLog(`Phase 8: ${patch.label} pattern not found`);
                continue;
            }
            content = content.replace(patch.target, patch.replacement);
            changed = true;
            debugLog(`Phase 8: Flipped ${patch.label} default to enabled`);
        }
        
        if (changed) {
            fs.writeFileSync(wbPath, content, 'utf8');
            log('AG defaults patched (restart AG to apply): nonWorkspaceFiles + gitignoreFiles');
        } else {
            debugLog('Phase 8: All workbench defaults already correct');
        }
    } catch (e) {
        debugLog(`Phase 8: workbench defaults error: ${e.message}`);
    }
}

// ============================================================
// CDP AUTO-ACCEPT SERVICE
// ============================================================

function startCdpService() {
    const port = getConfig('cdpPort') || 9333;
    
    // Error handler — fires notification accept to click Retry button.
    // NOTE: continueConversation creates NEW conversations, do NOT use it.
    const handleAgentError = (errorType) => {
        debugLog(`RETRY(cdp): detected "${errorType}" — firing acceptPrimaryAction`);
        safeExecute('notification.acceptPrimaryAction');
    };
    
    // Check if CDP is available (AG running with --remote-debugging-port)
    cdp.isAvailable(port).then(({ available, targetCount, error }) => {
        if (available) {
            const instance = cdp.start({
                port,
                log: (msg) => log(msg),
                debugLog: (msg) => debugLog(msg),
                acceptEdits: getConfig('acceptAgentSteps') !== false,
                acceptTerminal: getConfig('acceptRunCommands') !== false,
                autoRetryEnabled: getConfig('autoRetryEnabled') !== false,
            });
            instance.onErrorDetected = handleAgentError;
            log(`CDP auto-accept started on port ${port} (${targetCount} targets found)`);
        } else {
            // Fallback: try legacy port 9222
            cdp.isAvailable(9222).then(({ available: legacyAvailable }) => {
                if (legacyAvailable && port !== 9222) {
                    const instance = cdp.start({
                        port: 9222,
                        log: (msg) => log(msg),
                        debugLog: (msg) => debugLog(msg),
                        acceptEdits: getConfig('acceptAgentSteps') !== false,
                        acceptTerminal: getConfig('acceptRunCommands') !== false,
                        autoRetryEnabled: getConfig('autoRetryEnabled') !== false,
                    });
                    instance.onErrorDetected = handleAgentError;
                    log(`CDP auto-accept started on legacy port 9222`);
                } else {
                    debugLog(`CDP: Not available on port ${port} (${error}). Launch AG with: --remote-debugging-port=${port}`);
                }
            });
        }
        // Update status bar to show CDP state
        setTimeout(() => updateStatusBar(), 2000);
    });
}

function stopCdpService() {
    cdp.stop();
}

async function showCdpStatus() {
    const status = cdp.getStatus();
    const port = getConfig('cdpPort') || 9333;
    const availability = await cdp.isAvailable(port);
    
    const lines = [
        `CDP Auto-Accept Status`,
        `  Enabled: ${status.enabled}`,
        `  Connected: ${status.connected}`,
        `  Port: ${status.port}`,
        `  Sessions: ${status.sessions}`,
        `  Worker alive: ${status.workerAlive}`,
        `  CDP available: ${availability.available}`,
    ];
    
    if (!availability.available) {
        lines.push(`  Error: ${availability.error}`);
        lines.push(`  Fix: Launch AG with --remote-debugging-port=${port}`);
    }
    
    const msg = lines.join('\n');
    log(msg);
    vscode.window.showInformationMessage(
        status.connected 
            ? `CDP: Connected (${status.sessions} sessions, worker ${status.workerAlive ? 'alive' : 'dead'})` 
            : `CDP: Not connected. Launch AG with --remote-debugging-port=${port}`
    );
}

// ============================================================
// DEACTIVATION
// ============================================================

function deactivate() {
    stopLoop();
    stopCdpService();
    log('Auto Accept Agent deactivated');
}

module.exports = {
    activate,
    deactivate,
    isCommandBanned
};
