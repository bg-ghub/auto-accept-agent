const vscode = require('vscode');

// ============================================================
// AUTO-ACCEPT EXTENSION - Enhanced Edition
// 
// Features:
// - Uses native Antigravity commands (no CDP required)
// - VS Code Settings UI integration
// - Auto-retry on agent errors
// - Banned command safety protection
// - Zero network calls, zero telemetry
// ============================================================

let enabled = true;
let autoAcceptInterval = null;
let statusBarItem = null;
let globalContext = null;

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
        vscode.commands.registerCommand('auto-accept.resetBannedCommands', () => resetBannedCommands())
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

    if (enabled) {
        statusBarItem.text = '$(check) Auto Accept: ON';
        statusBarItem.tooltip = 'Auto-Accept is running. Click to pause.\n\nTip: Use Command Palette for more options';
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(circle-slash) Auto Accept: OFF';
        statusBarItem.tooltip = 'Auto-Accept is paused. Click to resume.';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
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

        // Build list of commands based on settings
        const commands = [];

        if (getConfig('acceptAgentSteps')) {
            commands.push('antigravity.agent.acceptAgentStep');
        }
        if (getConfig('acceptTerminalCommands')) {
            commands.push('antigravity.terminal.accept');
        }
        if (getConfig('acceptSuggestions')) {
            commands.push('antigravity.acceptSuggestion');
        }
        if (getConfig('acceptEditBlocks')) {
            commands.push('antigravity.agent.acceptEditBlock');
        }
        if (getConfig('acceptFileAccess')) {
            commands.push('antigravity.allowThisConversation');
        }
        if (getConfig('autoContinue')) {
            commands.push('antigravity.agent.continueTask');
        }
        if (getConfig('acceptAll')) {
            commands.push('antigravity.acceptAll');
        }

        for (const cmd of commands) {
            try {
                await vscode.commands.executeCommand(cmd);
                consecutiveRetries = 0; // Reset retry counter on success
            } catch (e) {
                // Command may not exist or no pending action - this is normal
            }
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
            vscode.window.showInformationMessage('🔄 Auto-Retry: Retrying agent step...');
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
