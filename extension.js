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

// Auto-continue state - track when accept commands last succeeded
let lastAcceptSuccess = 0;

// User activity tracking - don't retry while user is actively working
let lastUserActivity = Date.now();

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
 * Calculate exponential backoff delay with optional jitter
 * @param {number} attempt - Current retry attempt (0-indexed)
 * @param {number} baseDelay - Base delay in ms (default 1000)
 * @param {number} maxDelay - Maximum delay cap in ms (default 60000)
 * @param {boolean} jitterEnabled - Add ±25% randomization
 * @returns {number} Calculated delay in ms
 */
function calculateBackoff(attempt, baseDelay = 1000, maxDelay = 60000, jitterEnabled = true) {
    // Exponential: baseDelay * 2^attempt
    let delay = baseDelay * Math.pow(2, attempt);

    // Cap at maximum
    delay = Math.min(delay, maxDelay);

    // Add jitter (±25%) to prevent thundering herd
    if (jitterEnabled) {
        const jitterFactor = 0.75 + Math.random() * 0.5; // 0.75 to 1.25
        delay = delay * jitterFactor;
    }

    return Math.round(delay);
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
        vscode.commands.registerCommand('auto-accept.resetBannedCommands', () => resetBannedCommands()),
        vscode.commands.registerCommand('auto-accept.discoverCommands', () => discoverAntigravityCommands()),
        vscode.commands.registerCommand('auto-accept.openQuickSettings', () => openQuickSettings())
    );

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('auto-accept')) {
                handleConfigChange();
            }
        })
    );

    // User activity tracking removed - was causing focus issues in multi-window scenarios

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

    // Reset all timers to prevent immediate retry on toggle
    const now = Date.now();
    lastAcceptSuccess = now;
    lastUserActivity = now;
    lastRetryTime = now;
    consecutiveRetries = 0;

    const pollingInterval = getConfig('pollingInterval') || 500;

    autoAcceptInterval = setInterval(async () => {
        if (!enabled) return;

        // Accept commands - these should not steal focus
        const commandGroups = [];

        // Run commands FIRST — must fire before acceptTerminalCommands
        // which can consume dialog state via antigravity.terminalCommand.accept
        if (getConfig('acceptRunCommands')) {
            commandGroups.push([
                'antigravity.terminalCommand.run',
                'workbench.action.terminal.chat.runCommand',
                'workbench.action.terminal.chat.runFirstCommand',
                'notification.acceptPrimaryAction',
                'quickInput.accept'
            ]);
        }
        if (getConfig('acceptAgentSteps')) {
            commandGroups.push([
                'antigravity.agent.acceptAgentStep',
                'antigravity.prioritized.agentAcceptFocusedHunk',
                'workbench.action.chat.acceptTool'
            ]);
        }
        if (getConfig('acceptTerminalCommands')) {
            commandGroups.push([
                'antigravity.terminalCommand.accept',
                'antigravity.prioritized.terminalSuggestion.accept'
            ]);
        }
        if (getConfig('acceptSuggestions')) {
            commandGroups.push([
                'antigravity.acceptCompletion',
                'antigravity.prioritized.supercompleteAccept'
            ]);
        }
        if (getConfig('acceptEditBlocks')) {
            commandGroups.push([
                'antigravity.command.accept',
                'chatEditor.action.acceptHunk',
                'inlineChat.acceptChanges'
            ]);
        }
        if (getConfig('acceptAll')) {
            commandGroups.push([
                'antigravity.prioritized.agentAcceptAllInFile',
                'chatEditor.action.acceptAllEdits',
                'chatEditing.acceptAllFiles'
            ]);
        }

        // Execute accept commands — ALL in parallel
        // Commands fire simultaneously via Promise.allSettled to avoid
        // sequential await bottleneck (18 commands × 20-50ms = 360-900ms).
        // With 500ms polling, sequential execution caused timing gaps
        // where dialogs appeared but the loop was busy awaiting no-ops.
        const allCommands = commandGroups.flat();
        const results = await Promise.allSettled(
            allCommands.map(cmd => vscode.commands.executeCommand(cmd))
        );
        const anyAcceptSucceeded = results.some(r => r.status === 'fulfilled');

        if (anyAcceptSucceeded) {
            lastAcceptSuccess = Date.now();
        }

        // Auto-retry: ONLY use non-focus-stealing command
        if (getConfig('autoRetryOnError')) {
            const now = Date.now();
            const idleTime = now - lastAcceptSuccess;
            const timeSinceRetry = now - lastRetryTime;

            if (idleTime > 5000 && timeSinceRetry > 3000) {
                try {
                    await vscode.commands.executeCommand('workbench.action.chat.retry');
                    lastRetryTime = now;
                } catch (e) { }
            }
        }
    }, pollingInterval);

    log(`Auto-accept loop started (interval: ${pollingInterval}ms)`);
}

/**
 * Check for error state and auto-retry if enabled
 * Tries to click the Retry button on the "Agent terminated due to error" dialog
 * Uses exponential backoff with jitter for intelligent retry timing
 */
async function checkAndRetry() {
    const autoRetryEnabled = getConfig('autoRetryOnError');
    if (!autoRetryEnabled) return;

    const maxRetries = getConfig('maxRetryAttempts') || 5;
    const baseDelay = getConfig('retryBaseDelay') || 1000;
    const maxDelay = getConfig('retryMaxDelay') || 60000;
    const jitterEnabled = getConfig('jitterEnabled') !== false; // Default true

    const now = Date.now();

    // Only retry if agent has been idle for at least 5 seconds
    // This prevents focus stealing during normal work pauses
    const agentIdleTime = now - lastAcceptSuccess;
    if (agentIdleTime < 5000) {
        consecutiveRetries = 0; // Reset counter if agent is active
        return;
    }

    // Don't retry while user is actively working (typing, clicking)
    // Wait until user has been inactive for at least 3 seconds
    const userIdleTime = now - lastUserActivity;
    if (userIdleTime < 3000) {
        return; // User is active, don't steal focus
    }

    // Calculate dynamic delay based on retry count (exponential backoff)
    const currentBackoff = calculateBackoff(consecutiveRetries, baseDelay, maxDelay, jitterEnabled);
    const timeSinceLastRetry = now - lastRetryTime;

    // Don't retry too frequently - respect exponential backoff
    if (timeSinceLastRetry < currentBackoff) return;

    // Only use the non-focus-stealing retry command
    // Focus-based approaches were removed as they disrupt user work
    try {
        await vscode.commands.executeCommand('workbench.action.chat.retry');
    } catch (e) {
        // Retry command may fail silently if no error dialog present
    }

    lastRetryTime = now;
    consecutiveRetries++;

    // Calculate what the next backoff will be for user feedback
    const nextBackoff = calculateBackoff(consecutiveRetries, baseDelay, maxDelay, jitterEnabled);
    log(`Auto-retry attempt ${consecutiveRetries}/${maxRetries} after ${Math.round(agentIdleTime / 1000)}s idle. Next retry in ~${Math.round(nextBackoff / 1000)}s`);

    // Only show notification every 2nd attempt to reduce spam
    if (consecutiveRetries % 2 === 1 || consecutiveRetries === 1) {
        vscode.window.showInformationMessage(`🔄 Retry ${consecutiveRetries}/${maxRetries} - next in ~${Math.round(nextBackoff / 1000)}s`);
    }

    if (consecutiveRetries >= maxRetries) {
        vscode.window.showWarningMessage(`Auto-retry: Max attempts (${maxRetries}) reached, cooling down...`);
        log(`Max retry attempts (${maxRetries}) reached, entering cooldown`);
        consecutiveRetries = 0;
        lastRetryTime = now + maxDelay; // Use maxDelay as cooldown period
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
                    log(`BLOCKED by regex: ${pattern} `);
                    return true;
                }
            } else {
                // Plain text - literal substring match (case-insensitive)
                if (lowerText.includes(pattern.toLowerCase())) {
                    log(`BLOCKED by pattern: ${pattern} `);
                    return true;
                }
            }
        } catch (e) {
            // Invalid regex, try literal match
            if (lowerText.includes(pattern.toLowerCase())) {
                log(`BLOCKED by pattern(fallback): ${pattern} `);
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
 * Open Quick Settings menu to toggle all auto-accept options
 */
async function openQuickSettings() {
    const config = vscode.workspace.getConfiguration('auto-accept');

    // Define all settings with their current values
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

    // Build Quick Pick items
    const items = settings.map(s => {
        const currentValue = config.get(s.key);
        const icon = currentValue ? '$(check)' : '$(circle-slash)';
        const status = currentValue ? 'ON' : 'OFF';
        return {
            label: `${icon} ${s.label}: ${status} `,
            description: s.description,
            key: s.key,
            currentValue: currentValue
        };
    });

    // Add separator and bulk actions
    items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(check-all) Enable ALL', description: 'Turn on all auto-accept options', action: 'enableAll' },
        { label: '$(circle-slash) Disable ALL', description: 'Turn off all auto-accept options', action: 'disableAll' }
    );

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Toggle Auto-Accept Settings',
        title: 'Auto Accept Agent - Quick Settings'
    });

    if (!selected) return;

    if (selected.action === 'enableAll') {
        for (const s of settings) {
            await config.update(s.key, true, vscode.ConfigurationTarget.Global);
        }
        vscode.window.showInformationMessage('✅ All auto-accept options ENABLED');
        log('All settings enabled');
    } else if (selected.action === 'disableAll') {
        for (const s of settings) {
            await config.update(s.key, false, vscode.ConfigurationTarget.Global);
        }
        vscode.window.showInformationMessage('🛑 All auto-accept options DISABLED');
        log('All settings disabled');
    } else if (selected.key) {
        // Toggle the selected setting
        const newValue = !selected.currentValue;
        await config.update(selected.key, newValue, vscode.ConfigurationTarget.Global);
        const status = newValue ? 'ON' : 'OFF';
        vscode.window.showInformationMessage(`${selected.label.split(':')[0]}: ${status} `);
        log(`${selected.key} set to ${newValue} `);
    }
}

/**
 * Discover and display all available Antigravity commands
 * Useful for finding the correct retry command name
 */
async function discoverAntigravityCommands() {
    try {
        const allCommands = await vscode.commands.getCommands(true);

        // Filter for Antigravity commands
        const antigravityCommands = allCommands.filter(cmd =>
            cmd.toLowerCase().includes('antigravity') ||
            cmd.toLowerCase().includes('gemini') ||
            cmd.toLowerCase().includes('agent')
        );

        // Find retry-related commands
        const retryCommands = allCommands.filter(cmd =>
            cmd.toLowerCase().includes('retry')
        );

        // Find accept-related commands
        const acceptCommands = allCommands.filter(cmd =>
            cmd.toLowerCase().includes('accept')
        );

        // Find continue-related commands
        const continueCommands = allCommands.filter(cmd =>
            cmd.toLowerCase().includes('continue')
        );

        // Find chat-related commands (workbench.action.chat.*)
        const chatCommands = allCommands.filter(cmd =>
            cmd.toLowerCase().includes('chat')
        );

        // Find terminal-related commands
        const terminalCommands = allCommands.filter(cmd =>
            cmd.toLowerCase().includes('terminal')
        );

        // Create output
        const output = [
            '=== ANTIGRAVITY COMMAND DISCOVERY ===',
            '',
            '--- RETRY COMMANDS ---',
            ...retryCommands.sort(),
            '',
            '--- ACCEPT COMMANDS ---',
            ...acceptCommands.sort(),
            '',
            '--- CONTINUE COMMANDS ---',
            ...continueCommands.sort(),
            '',
            '--- CHAT COMMANDS (workbench.action.chat.*) ---',
            ...chatCommands.sort(),
            '',
            '--- TERMINAL COMMANDS ---',
            ...terminalCommands.sort(),
            '',
            '--- ALL ANTIGRAVITY/AGENT/GEMINI COMMANDS ---',
            ...antigravityCommands.sort()
        ].join('\n');

        // Show in output channel
        const outputChannel = vscode.window.createOutputChannel('Auto Accept - Command Discovery');
        outputChannel.clear();
        outputChannel.appendLine(output);
        outputChannel.show();

        // Copy FULL output to clipboard
        await vscode.env.clipboard.writeText(output);
        vscode.window.showInformationMessage(
            `Found ${retryCommands.length} retry, ${acceptCommands.length} accept, ${continueCommands.length} continue, ${chatCommands.length} chat commands.FULL LIST copied to clipboard!`
        );

        log(`Discovered commands - copied full list to clipboard`);
    } catch (e) {
        vscode.window.showErrorMessage(`Error discovering commands: ${e.message} `);
        log(`Error discovering commands: ${e.message} `);
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
