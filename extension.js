const vscode = require('vscode');

// Lazy load SettingsPanel to avoid blocking activation
let SettingsPanel = null;
function getSettingsPanel() {
    if (!SettingsPanel) {
        try {
            SettingsPanel = require('./settings-panel').SettingsPanel;
        } catch (e) {
            console.error('Failed to load SettingsPanel:', e);
        }
    }
    return SettingsPanel;
}

// states

const GLOBAL_STATE_KEY = 'auto-accept-enabled-global';
const PRO_STATE_KEY = 'auto-accept-isPro';
const FREQ_STATE_KEY = 'auto-accept-frequency';
// Locking
const LOCK_KEY = 'auto-accept-instance-lock';
const HEARTBEAT_KEY = 'auto-accept-instance-heartbeat';
const INSTANCE_ID = Math.random().toString(36).substring(7);

let isEnabled = false;
let isPro = false;
let isLockedOut = false; // Local tracking
let pollFrequency = 2000; // Default for Free

let pollTimer;
let statusBarItem;
let statusSettingsItem;
let outputChannel;
let currentIDE = 'unknown'; // 'cursor' | 'antigravity'
let globalContext;

// Handlers
let cursorCDP;
let cursorLauncher;

function log(message) {
    try {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const logLine = `[${timestamp}] ${message}`;
        console.log(logLine);
        if (outputChannel) {
            outputChannel.appendLine(logLine);
        }
    } catch (e) {
        console.error('Logging failed:', e);
    }
}

function detectIDE() {
    try {
        const appName = vscode.env.appName || '';
        if (appName.toLowerCase().includes('cursor')) {
            return 'cursor';
        }
    } catch (e) {
        console.error('Error detecting IDE:', e);
    }
    return 'antigravity'; // Default
}

async function activate(context) {
    globalContext = context;
    console.log('Auto Accept Extension: Activator called.');

    // CRITICAL: Create status bar items FIRST before anything else
    try {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.command = 'auto-accept.toggle';
        statusBarItem.text = '$(sync~spin) Auto Accept: Loading...';
        statusBarItem.tooltip = 'Auto Accept is initializing...';
        context.subscriptions.push(statusBarItem);
        statusBarItem.show();

        statusSettingsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        statusSettingsItem.command = 'auto-accept.openSettings';
        statusSettingsItem.text = '$(gear)';
        statusSettingsItem.tooltip = 'Auto Accept Settings & Pro Features';
        context.subscriptions.push(statusSettingsItem);
        statusSettingsItem.show();

        console.log('Auto Accept: Status bar items created and shown.');
    } catch (sbError) {
        console.error('CRITICAL: Failed to create status bar items:', sbError);
    }

    try {
        // 1. Initialize State
        isEnabled = context.globalState.get(GLOBAL_STATE_KEY, false);
        isPro = false; // context.globalState.get(PRO_STATE_KEY, false); // SIMULATION: Forced Free Plan

        // Load frequency
        if (isPro) {
            pollFrequency = context.globalState.get(FREQ_STATE_KEY, 1000);
        } else {
            pollFrequency = 300; // Enforce fast polling (0.3s) for free users
        }

        currentIDE = detectIDE();

        // 2. Create Output Channel
        outputChannel = vscode.window.createOutputChannel('Auto Accept');
        context.subscriptions.push(outputChannel);

        log(`Auto Accept: Activating...`);
        log(`Auto Accept: Detected environment: ${currentIDE.toUpperCase()}`);

        // 3. Initialize Handlers based on IDE (Lazy Load)
        if (currentIDE === 'cursor') {
            try {
                // Lazy load dependencies to prevent top-level crashes
                const { CursorCDPHandler } = require('./main_scripts/cursor-cdp');
                const { CursorLauncher, BASE_CDP_PORT } = require('./main_scripts/cursor-launcher');

                cursorCDP = new CursorCDPHandler(BASE_CDP_PORT, BASE_CDP_PORT + 10, log);
                // Set Pro status on CDP handler
                if (cursorCDP.setProStatus) {
                    cursorCDP.setProStatus(isPro);
                }
                cursorLauncher = new CursorLauncher(log);
                log('Cursor handlers initialized.');
            } catch (err) {
                log(`Failed to initialize Cursor handlers: ${err.message}`);
                vscode.window.showErrorMessage(`Auto Accept Error: Failed to load Cursor scripts. ${err.message}`);
            }
        }

        // 4. Update Status Bar (already created at start)
        updateStatusBar();
        log('Status bar updated with current state.');

        // 5. Register Commands
        context.subscriptions.push(
            vscode.commands.registerCommand('auto-accept.toggle', () => handleToggle(context)),
            vscode.commands.registerCommand('auto-accept.relaunch', () => handleRelaunch()),
            vscode.commands.registerCommand('auto-accept.updateFrequency', (freq) => handleFrequencyUpdate(context, freq)),
            vscode.commands.registerCommand('auto-accept.openSettings', () => {
                const panel = getSettingsPanel();
                if (panel) {
                    panel.createOrShow(context.extensionUri, context);
                } else {
                    vscode.window.showErrorMessage('Failed to load Settings Panel.');
                }
            })
        );

        // 6. Check environment and start if enabled
        try {
            await checkEnvironmentAndStart();
        } catch (err) {
            log(`Error in environment check: ${err.message}`);
        }

        log('Auto Accept: Activation complete');
    } catch (error) {
        console.error('ACTIVATION CRITICAL FAILURE:', error);
        log(`ACTIVATION CRITICAL FAILURE: ${error.message}`);
        vscode.window.showErrorMessage(`Auto Accept Extension failed to activate: ${error.message}`);
    }
}

async function ensureCDPOrPrompt(showPrompt = false) {
    if (currentIDE !== 'cursor' || !cursorCDP) return;

    const cdpAvailable = await cursorCDP.isCDPAvailable();
    log(`Environment check: CDP Available = ${cdpAvailable}`);

    if (cdpAvailable) {
        await cursorCDP.start();
    } else {
        log('CDP not available.');
        // Only show the relaunch dialog if explicitly requested (user action)
        if (showPrompt && cursorLauncher) {
            log('Prompting user for relaunch...');
            await cursorLauncher.showLaunchPrompt();
        } else {
            log('Skipping relaunch prompt (startup). User can click status bar to trigger.');
        }
    }
}

async function checkEnvironmentAndStart() {
    if (isEnabled) {
        if (currentIDE === 'cursor') {
            // Don't show prompt on activation - silent check only
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
            log('Auto Accept: Enabled');
            if (currentIDE === 'cursor') {
                // Show prompt when user explicitly enables
                await ensureCDPOrPrompt(true);
            }
            startPolling();
        } else {
            log('Auto Accept: Disabled');
            stopPolling();
            if (cursorCDP) await cursorCDP.stop();
        }

        updateStatusBar();
    } catch (e) {
        log(`Error toggling: ${e.message}`);
    }
}

async function handleRelaunch() {
    if (currentIDE !== 'cursor') {
        vscode.window.showInformationMessage('Relaunch is only available in Cursor.');
        return;
    }

    if (!cursorLauncher) {
        vscode.window.showErrorMessage('Cursor Launcher not initialized.');
        return;
    }

    log('Initiating Relaunch...');
    const result = await cursorLauncher.launchAndReplace();
    if (!result.success) {
        vscode.window.showErrorMessage(`Relaunch failed: ${result.error}`);
    }
}

let agentState = 'running'; // 'running' | 'stalled' | 'recovering' | 'recovered'
let retryCount = 0;
let hasSeenUpgradeModal = false;
const MAX_RETRIES = 3;

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    log('Auto Accept: Polling started');

    pollTimer = setInterval(async () => {
        if (!isEnabled) return;

        // Locking Check for Antigravity (Non-Cursor)
        if (currentIDE !== 'cursor') {
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

        // --- Core Loop with State Machine ---

        let stuckInfo = { state: 'running' };

        if (currentIDE === 'cursor' && cursorCDP) {
            stuckInfo = await cursorCDP.getStuckState(isEnabled);
        }

        // If CDP says we are running, or we are not in Cursor, we are 'running'
        // (Unless we successfully recovered recently, then we stay 'recovered' for a bit visually?)
        // For simplicity, if CDP says running, we reset to running unless we are mid-recovery.

        if (stuckInfo.state === 'running') {
            if (agentState !== 'running' && agentState !== 'recovered') {
                log('State transition: ' + agentState + ' -> running');
                agentState = 'running';
                retryCount = 0;
                updateStatusBar();
            }
            // Standard execution
            await executeAccept();
        }
        else if (stuckInfo.state === 'stalled') {
            if (agentState === 'running' || agentState === 'recovered') {
                log(`State transition: ${agentState} -> stalled (Reason: ${stuckInfo.reason})`);
                agentState = 'stalled';
                updateStatusBar();
            }

            // Handle Stalled State
            if (!isPro) {
                // Free Tier: Do nothing automatically.
                // Status bar already updated to "Waiting..."
                log('Stalled (Free Tier) - Checking trigger conditions...');

                // Smart Trigger Logic for Upgrade Prompt
                if (!hasSeenUpgradeModal) {
                    const lastDismissedAt = globalContext.globalState.get('auto-accept-lastDismissedAt', 0);
                    const now = Date.now();
                    const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

                    if (now - lastDismissedAt > COOLDOWN_MS) {
                        log('Triggering Upgrade Prompt (Eligible: Session=First, Cooldown=Passed)');
                        hasSeenUpgradeModal = true;

                        const panelClass = getSettingsPanel();
                        if (panelClass) {
                            panelClass.showUpgradePrompt(globalContext);
                        }
                    } else {
                        log(`Upgrade Prompt suppressed (Cooldown active - ${(COOLDOWN_MS - (now - lastDismissedAt)) / 1000}s remaining)`);
                        // Mark as seen so we don't log this every poll? 
                        // No, we might want to log it sparingly, but polling is slow (3s?).
                        // Let's set hasSeenUpgradeModal = true to avoid checking global state constantly this session?
                        // "Current session has NOT shown modal" - technically we haven't shown it.
                        // But if we are in cooldown, we effectively "skipping" this session's chance.
                        // Let's set it to true to stop checking.
                        hasSeenUpgradeModal = true;
                    }
                }
            } else {
                // Pro Tier: Recovery Logic
                if (retryCount < MAX_RETRIES) {
                    agentState = 'recovering';
                    retryCount++;
                    log(`State transition: stalled -> recovering (Attempt ${retryCount}/${MAX_RETRIES})`);
                    updateStatusBar();

                    await handleRecovery(retryCount);
                } else {
                    // Exhausted retries
                    if (agentState !== 'stalled') {
                        agentState = 'stalled'; // Permanent stall until user interaction
                        log('Recovery failed. Max retries reached.');
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
            // Strategy 1: Standard click, but maybe force = true?
            // The default executeAccept(true) is already "force" in a way (background allowed).
            // We just try again immediately.
            await cursorCDP.executeAccept(true);
        } else if (attempt === 2) {
            // Strategy 2: Re-query / Force fresh selectors
            // In our CDP script, findAcceptButtons re-runs every time, so it IS fresh.
            // But maybe we can restart the observer?
            // For now, we just try executeAccept again, CDP script handles dynamic DOM.
            await cursorCDP.executeAccept(true);
        } else if (attempt === 3) {
            // Strategy 3: Focus refresh simulation?
            // This is harder via CDP without bringing window to front.
            // We'll trust the script's "Enter key" logic which is part of clickButton.
            await cursorCDP.executeAccept(true);
        }

        // Check if we succeeded? 
        // We will know on the NEXT poll cycle if getStuckState returns 'running'.
        // But we can optimistically set 'recovered' if we want, OR just wait.
        // Let's wait for next poll to confirm success.
    } catch (e) {
        log(`Recovery attempt ${attempt} failed: ${e.message}`);
    }
}

async function executeAccept() {
    if (currentIDE === 'cursor') {
        // Cursor Logic: CDP
        if (cursorCDP && cursorCDP.isEnabled) {
            try {
                // Pass 'true' for allowHidden only if Pro? 
                // Actually existing logic allowed background if connected.
                // We'll keep it consistent: Pro checks are done in cursor-cdp.js connection gating usually?
                // Actually extension.js didn't gate background exec before, only connection count.
                // Let's allow it.
                const res = await cursorCDP.executeAccept(true);

                // If we clicked something, and we were recovering, we are now recovered!
                if (res.executed > 0 && agentState === 'recovering') {
                    agentState = 'recovered';
                    log('State transition: recovering -> recovered');
                    updateStatusBar();
                }
            } catch (e) {
                log(`Cursor CDP execution error: ${e.message}`);
            }
        }
    } else {
        // Antigravity Logic
        try {
            await vscode.commands.executeCommand('antigravity.agent.acceptAgentStep').then(
                () => { },
                (err) => { }
            );
        } catch (e) { }
    }
}

function updateStatusBar() {
    if (!statusBarItem) return;

    if (isEnabled) {
        let statusText = 'ON';
        let tooltip = `Auto Accept is running (${currentIDE} mode).`;
        let bgColor = undefined;

        if (currentIDE === 'cursor') {
            if (agentState === 'running') {
                statusText = 'ON';
                if (cursorCDP && cursorCDP.getConnectionCount() > 0) statusText += ' (Background)';
            } else if (agentState === 'stalled') {
                statusText = 'WAITING';
                tooltip = isPro ? 'Agent stalled. Max retries reached.' : 'Agent waiting — built-in rules failed';
                bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            } else if (agentState === 'recovering') {
                statusText = 'RECOVERING...';
                tooltip = `Attempting recovery (${retryCount}/${MAX_RETRIES})`;
                bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            } else if (agentState === 'recovered') {
                statusText = `RECOVERED (${retryCount})`;
                tooltip = `Auto-recovered after ${retryCount} retries.`;
                bgColor = new vscode.ThemeColor('statusBarItem.errorBackground'); // Make it pop? Or Success color if possible? VS Code only has error/warning.
            }
        }

        if (isLockedOut) {
            statusText = 'PAUSED (Multi-window)';
            bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }

        statusBarItem.text = `$(check) Auto Accept: ${statusText}`;
        statusBarItem.tooltip = tooltip;
        statusBarItem.backgroundColor = bgColor;

    } else {
        statusBarItem.text = '$(circle-slash) Auto Accept: OFF';
        statusBarItem.tooltip = 'Click to enable Auto Accept.';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

// Re-implement checkInstanceLock correctly with context
async function checkInstanceLock() {
    if (isPro) return true;
    if (!globalContext) return true; // Should not happen

    const lockId = globalContext.globalState.get(LOCK_KEY);
    const lastHeartbeat = globalContext.globalState.get(HEARTBEAT_KEY, 0);
    const now = Date.now();

    // 1. If no lock or lock is stale (>10s), claim it
    if (!lockId || (now - lastHeartbeat > 10000)) {
        await globalContext.globalState.update(LOCK_KEY, INSTANCE_ID);
        await globalContext.globalState.update(HEARTBEAT_KEY, now);
        return true;
    }

    // 2. If we own the lock, update heartbeat
    if (lockId === INSTANCE_ID) {
        await globalContext.globalState.update(HEARTBEAT_KEY, now);
        return true;
    }

    // 3. Someone else owns the lock and it's fresh
    return false;
}

function deactivate() {
    stopPolling();
    if (cursorCDP) {
        cursorCDP.stop();
    }
}

module.exports = { activate, deactivate };
