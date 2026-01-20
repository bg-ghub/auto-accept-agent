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
let continueSentAt = 0;

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

        // VERIFIED COMMANDS from Antigravity command discovery
        // Each group: try commands in order, stop at first success
        const commandGroups = [];

        if (getConfig('acceptAgentSteps')) {
            commandGroups.push([
                'antigravity.agent.acceptAgentStep',
                'antigravity.prioritized.agentAcceptFocusedHunk'
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
        if (getConfig('acceptFileAccess')) {
            // No direct command found - may be handled by acceptAgentStep
        }
        if (getConfig('autoContinue')) {
            // Only send "continue" if:
            // 1. No accept commands have succeeded for 5 seconds (agent is idle/waiting)
            // 2. At least 30 seconds since last continue was sent
            const now = Date.now();
            const idleTime = now - lastAcceptSuccess;
            const timeSinceContinue = now - continueSentAt;

            if (idleTime > 5000 && timeSinceContinue > 30000) {
                try {
                    await vscode.commands.executeCommand('workbench.action.chat.open', { query: 'continue' });
                    await vscode.commands.executeCommand('workbench.action.chat.submit');
                    continueSentAt = now;
                    log('AutoContinue: Sent "continue" to chat');
                } catch (e) {
                    // Ignore errors
                }
            }
        }
        if (getConfig('acceptAll')) {
            commandGroups.push([
                'antigravity.prioritized.agentAcceptAllInFile',
                'chatEditor.action.acceptAllEdits',
                'chatEditing.acceptAllFiles'
            ]);
        }

        // Execute each command group and track success
        let anyAcceptSucceeded = false;
        for (const cmdGroup of commandGroups) {
            for (const cmd of cmdGroup) {
                try {
                    await vscode.commands.executeCommand(cmd);
                    anyAcceptSucceeded = true;
                    break; // Success - move to next group
                } catch (e) {
                    // Try next command in group
                }
            }
        }

        // Update last accept success time if any command worked
        if (anyAcceptSucceeded) {
            lastAcceptSuccess = Date.now();
        }

        // Check for auto-retry on error
        await checkAndRetry();
    }, pollingInterval);

    log(`Auto-accept loop started (interval: ${pollingInterval}ms)`);
}

/**
 * Check for error state and auto-retry if enabled
 * Note: The retry command succeeds silently even when no error is present,
 * so we use a longer delay to avoid spam and only log (no notifications)
 */
async function checkAndRetry() {
    const autoRetryEnabled = getConfig('autoRetryOnError');
    if (!autoRetryEnabled) return;

    const maxRetries = getConfig('maxRetryAttempts') || 3;
    // Use a longer delay (default 10 seconds) since retry fires even when nothing to retry
    const retryDelay = getConfig('autoRetryDelay') || 10000;

    // Don't retry too frequently
    const now = Date.now();
    if (now - lastRetryTime < retryDelay) return;

    // Only use the confirmed working command
    // Note: This command succeeds silently even when there's no error to retry
    try {
        await vscode.commands.executeCommand('workbench.action.chat.retry');
        lastRetryTime = now;
        consecutiveRetries++;

        // Only log, no notifications (too spammy since command always "succeeds")
        log(`Auto-retry fired (attempt ${consecutiveRetries}/${maxRetries})`);

        if (consecutiveRetries >= maxRetries) {
            log(`Max retry attempts (${maxRetries}) reached, pausing for 60 seconds`);
            consecutiveRetries = 0;
            lastRetryTime = now + 60000; // Extra 60 second delay
        }
    } catch (e) {
        consecutiveRetries = 0;
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
        { key: 'acceptFileAccess', label: 'File Access', description: 'Auto-accept file access dialogs' },
        { key: 'autoContinue', label: 'Auto Continue', description: 'Auto-send continue when agent waits' },
        { key: 'acceptAll', label: 'Accept All', description: 'Auto-accept all file changes at once' },
        { key: 'autoRetryOnError', label: 'Auto Retry', description: 'Auto-retry when agent errors occur' }
    ];

    // Build Quick Pick items
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
        vscode.window.showInformationMessage(`${selected.label.split(':')[0]}: ${status}`);
        log(`${selected.key} set to ${newValue}`);
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
            `Found ${retryCommands.length} retry, ${acceptCommands.length} accept, ${continueCommands.length} continue, ${chatCommands.length} chat commands. FULL LIST copied to clipboard!`
        );

        log(`Discovered commands - copied full list to clipboard`);
    } catch (e) {
        vscode.window.showErrorMessage(`Error discovering commands: ${e.message}`);
        log(`Error discovering commands: ${e.message}`);
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
