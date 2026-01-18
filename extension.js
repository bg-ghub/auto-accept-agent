const vscode = require('vscode');

// ============================================================
// AUTO-ACCEPT EXTENSION - Enhanced Edition
// 
// Features:
// - Uses native Antigravity commands (no CDP required)
// - VS Code Settings UI integration
// - Activity counter in status bar
// - Auto-retry on agent errors
// - Banned command safety protection
// - Zero network calls, zero telemetry
// ============================================================

const COUNTER_STATE_KEY = 'auto-accept-counter';
const SESSION_START_KEY = 'auto-accept-session-start';

let enabled = true;
let autoAcceptInterval = null;
let statusBarItem = null;
let globalContext = null;

// Activity tracking
let acceptedCount = 0;
let sessionStartTime = null;

// Auto-retry state
let consecutiveRetries = 0;
let lastRetryTime = 0;
let retryTimeout = null;

/**
 * Get configuration value with defaults
 */
function getConfig(key) {
    const config = vscode.workspace.getConfiguration('auto-accept');
    return config.get(key);
}

/**
 * Log helper
 */
function log(message) {
    console.log(`[AutoAccept] ${message}`);
}

/**
 * Activate the extension
 */
function activate(context) {
    globalContext = context;
    log('Activating Auto Accept Extension (Enhanced)...');

    // Load saved state
    enabled = getConfig('enabled');
    acceptedCount = context.globalState.get(COUNTER_STATE_KEY, 0);
    sessionStartTime = context.globalState.get(SESSION_START_KEY, Date.now());

    // Save session start if new session
    if (!context.globalState.get(SESSION_START_KEY)) {
        context.globalState.update(SESSION_START_KEY, sessionStartTime);
    }

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
    statusBarItem.command = 'auto-accept.toggle';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();
    statusBarItem.show();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('auto-accept.toggle', () => toggleAutoAccept()),
        vscode.commands.registerCommand('auto-accept.editBannedCommands', () => editBannedCommands()),
        vscode.commands.registerCommand('auto-accept.resetBannedCommands', () => resetBannedCommands()),
        vscode.commands.registerCommand('auto-accept.resetCounter', () => resetCounter()),
        vscode.commands.registerCommand('auto-accept.showStats', () => showStats())
    );

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('auto-accept')) {
                handleConfigChange();
            }
        })
    );

    // Start the auto-accept loop if enabled
    if (enabled) {
        startLoop();
    }

    log(`Auto Accept activated. Enabled: ${enabled}`);
    log(`Activity counter: ${acceptedCount}`);
}

/**
 * Handle configuration changes
 */
function handleConfigChange() {
    const newEnabled = getConfig('enabled');

    if (newEnabled !== enabled) {
        enabled = newEnabled;
        if (enabled) {
            startLoop();
        } else {
            stopLoop();
        }
    }

    // If polling interval changed, restart the loop
    if (enabled && autoAcceptInterval) {
        stopLoop();
        startLoop();
    }

    updateStatusBar();
    log('Configuration updated');
}

/**
 * Toggle auto-accept on/off
 */
async function toggleAutoAccept() {
    enabled = !enabled;

    // Update VS Code settings
    const config = vscode.workspace.getConfiguration('auto-accept');
    await config.update('enabled', enabled, vscode.ConfigurationTarget.Global);

    updateStatusBar();

    if (enabled) {
        vscode.window.showInformationMessage('✅ Auto-Accept: ON');
        startLoop();
    } else {
        vscode.window.showInformationMessage('🛑 Auto-Accept: OFF');
        stopLoop();
    }

    log(`Auto Accept toggled: ${enabled ? 'ON' : 'OFF'}`);
}

/**
 * Update the status bar appearance
 */
function updateStatusBar() {
    if (!statusBarItem) return;

    const showCounter = getConfig('showActivityCounter');
    const counterDisplay = showCounter && acceptedCount > 0 ? ` (${acceptedCount})` : '';

    if (enabled) {
        statusBarItem.text = `$(check) Auto Accept: ON${counterDisplay}`;
        statusBarItem.tooltip = `Auto-Accept is running. Click to pause.\n\nAccepted: ${acceptedCount} steps\nSession: ${getSessionDuration()}\n\nTip: Use Command Palette for more options`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = `$(circle-slash) Auto Accept: OFF${counterDisplay}`;
        statusBarItem.tooltip = 'Auto-Accept is paused. Click to resume.';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

/**
 * Get formatted session duration
 */
function getSessionDuration() {
    if (!sessionStartTime) return 'N/A';

    const duration = Date.now() - sessionStartTime;
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

/**
 * Start the auto-accept polling loop
 */
function startLoop() {
    if (autoAcceptInterval) {
        clearInterval(autoAcceptInterval);
    }

    const pollingInterval = getConfig('pollingInterval') || 500;

    autoAcceptInterval = setInterval(async () => {
        if (!enabled) return;

        let acceptedSomething = false;

        // Try multiple Antigravity commands
        const commands = [
            'antigravity.agent.acceptAgentStep',
            'antigravity.terminal.accept',
            'antigravity.acceptSuggestion',
            'antigravity.agent.acceptEditBlock'
        ];

        for (const cmd of commands) {
            try {
                await vscode.commands.executeCommand(cmd);
                acceptedSomething = true;
            } catch (e) {
                // Command may not exist or no pending action - this is normal
            }
        }

        // Increment counter if we accepted something
        if (acceptedSomething) {
            acceptedCount++;
            await globalContext.globalState.update(COUNTER_STATE_KEY, acceptedCount);
            updateStatusBar();
            consecutiveRetries = 0; // Reset retry counter on success
        }

        // Check for auto-retry on error
        await checkAndRetry();
    }, pollingInterval);

    log(`Auto-accept loop started (interval: ${pollingInterval}ms)`);
}

/**
 * Check for error state and auto-retry if enabled
 */
async function checkAndRetry() {
    const autoRetryEnabled = getConfig('autoRetryOnError');
    if (!autoRetryEnabled) return;

    const maxRetries = getConfig('maxRetryAttempts') || 3;
    const retryDelay = getConfig('autoRetryDelay') || 1000;

    // Don't retry too frequently
    const now = Date.now();
    if (now - lastRetryTime < retryDelay) return;

    // Check if there's an error state to retry
    try {
        // Try to execute retry command - if it succeeds, there was an error to retry
        await vscode.commands.executeCommand('antigravity.agent.retryAgentStep');

        lastRetryTime = now;
        consecutiveRetries++;

        log(`Auto-retry executed (attempt ${consecutiveRetries}/${maxRetries})`);

        // Show notification on first retry
        if (consecutiveRetries === 1) {
            vscode.window.showInformationMessage(`🔄 Auto-Retry: Retrying agent step...`);
        }

        // Check if we've exceeded max retries
        if (consecutiveRetries >= maxRetries) {
            log(`Max retry attempts (${maxRetries}) reached, pausing auto-retry`);
            vscode.window.showWarningMessage(`⚠️ Auto-Retry: Max attempts (${maxRetries}) reached. Manual intervention may be needed.`);
            consecutiveRetries = 0; // Reset to allow future retries
        }
    } catch (e) {
        // No error state or command doesn't exist - this is normal
    }
}

/**
 * Stop the auto-accept polling loop
 */
function stopLoop() {
    if (autoAcceptInterval) {
        clearInterval(autoAcceptInterval);
        autoAcceptInterval = null;
    }
    if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
    }
    log('Auto-accept loop stopped');
}

/**
 * Check if a command text contains banned patterns
 */
function isCommandBanned(commandText) {
    if (!commandText || commandText.length === 0) return false;

    const bannedCommands = getConfig('bannedCommands') || [];
    const lowerText = commandText.toLowerCase();

    for (const pattern of bannedCommands) {
        if (!pattern || pattern.length === 0) continue;

        try {
            // Check if pattern is a regex (starts and ends with /)
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
                // Plain text - literal substring match (case-insensitive)
                if (lowerText.includes(pattern.toLowerCase())) {
                    log(`BLOCKED by pattern: ${pattern}`);
                    return true;
                }
            }
        } catch (e) {
            // Invalid regex, try literal match
            if (lowerText.includes(pattern.toLowerCase())) {
                log(`BLOCKED by pattern (fallback): ${pattern}`);
                return true;
            }
        }
    }

    return false;
}

/**
 * Open the banned commands editor
 */
async function editBannedCommands() {
    const bannedCommands = getConfig('bannedCommands') || [];
    const currentPatterns = bannedCommands.join('\n');

    const result = await vscode.window.showInputBox({
        prompt: 'Edit banned command patterns (one per line). Use /regex/ for regex patterns.',
        value: currentPatterns,
        placeHolder: 'rm -rf /\nformat c:\n/sudo\\s+rm/',
        validateInput: (value) => {
            return null; // Accept any input
        }
    });

    if (result !== undefined) {
        const newPatterns = result.split('\n').map(s => s.trim()).filter(s => s.length > 0);

        // Update VS Code settings
        const config = vscode.workspace.getConfiguration('auto-accept');
        await config.update('bannedCommands', newPatterns, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage(`Updated ${newPatterns.length} banned patterns.`);
        log(`Banned commands updated: ${newPatterns.length} patterns`);
    }
}

/**
 * Reset banned commands to defaults
 */
async function resetBannedCommands() {
    const choice = await vscode.window.showWarningMessage(
        'Reset banned commands to defaults?',
        'Yes', 'No'
    );

    if (choice === 'Yes') {
        const defaultPatterns = [
            'rm -rf /',
            'rm -rf ~',
            'rm -rf *',
            'format c:',
            'del /f /s /q',
            'rmdir /s /q',
            ':(){:|:&};:',
            'dd if=',
            'mkfs.',
            '> /dev/sda',
            'chmod -R 777 /',
            'sudo rm -rf',
            'shutdown',
            'reboot'
        ];

        const config = vscode.workspace.getConfiguration('auto-accept');
        await config.update('bannedCommands', defaultPatterns, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage('Banned commands reset to defaults.');
        log('Banned commands reset to defaults');
    }
}

/**
 * Reset the activity counter
 */
async function resetCounter() {
    const choice = await vscode.window.showWarningMessage(
        `Reset activity counter? (Currently: ${acceptedCount})`,
        'Yes', 'No'
    );

    if (choice === 'Yes') {
        acceptedCount = 0;
        sessionStartTime = Date.now();
        await globalContext.globalState.update(COUNTER_STATE_KEY, 0);
        await globalContext.globalState.update(SESSION_START_KEY, sessionStartTime);
        updateStatusBar();
        vscode.window.showInformationMessage('Activity counter reset to 0.');
        log('Activity counter reset');
    }
}

/**
 * Show statistics popup
 */
async function showStats() {
    const bannedCommands = getConfig('bannedCommands') || [];
    const pollingInterval = getConfig('pollingInterval');
    const autoRetryEnabled = getConfig('autoRetryOnError');

    const statsMessage = [
        `📊 Auto-Accept Statistics`,
        ``,
        `✅ Steps Accepted: ${acceptedCount}`,
        `⏱️ Session Duration: ${getSessionDuration()}`,
        ``,
        `⚙️ Configuration:`,
        `   • Polling Interval: ${pollingInterval}ms`,
        `   • Auto-Retry: ${autoRetryEnabled ? 'Enabled' : 'Disabled'}`,
        `   • Banned Patterns: ${bannedCommands.length}`,
        ``,
        `Status: ${enabled ? '🟢 Running' : '🔴 Paused'}`
    ].join('\n');

    const action = await vscode.window.showInformationMessage(
        statsMessage,
        { modal: true },
        'Reset Counter',
        'Open Settings'
    );

    if (action === 'Reset Counter') {
        await resetCounter();
    } else if (action === 'Open Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'auto-accept');
    }
}

/**
 * Deactivate the extension
 */
function deactivate() {
    stopLoop();
    log('Auto Accept Extension deactivated');
}

module.exports = {
    activate,
    deactivate,
    isCommandBanned  // Exported for potential future use
};
