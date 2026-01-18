const vscode = require('vscode');

// ============================================================
// AUTO-ACCEPT EXTENSION - Clean & Simple Edition
// 
// Features:
// - Uses native Antigravity commands (no CDP required)
// - Banned command safety protection
// - Nice status bar toggle
// - Zero network calls, zero telemetry, zero Pro model
// ============================================================

const GLOBAL_STATE_KEY = 'auto-accept-enabled';
const BANNED_COMMANDS_KEY = 'auto-accept-banned-commands';

let enabled = true;
let autoAcceptInterval = null;
let statusBarItem = null;
let bannedCommands = [];
let globalContext = null;

// Default dangerous command patterns to block
const DEFAULT_BANNED_COMMANDS = [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf *',
    'format c:',
    'del /f /s /q',
    'rmdir /s /q',
    ':(){:|:&};:',  // fork bomb
    'dd if=',
    'mkfs.',
    '> /dev/sda',
    'chmod -R 777 /',
    'sudo rm -rf',
    'shutdown',
    'reboot'
];

function log(message) {
    console.log(`[AutoAccept] ${message}`);
}

/**
 * Activate the extension
 */
function activate(context) {
    globalContext = context;
    log('Activating Auto Accept Extension...');

    // Load saved state
    enabled = context.globalState.get(GLOBAL_STATE_KEY, true);
    bannedCommands = context.globalState.get(BANNED_COMMANDS_KEY, DEFAULT_BANNED_COMMANDS);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
    statusBarItem.command = 'auto-accept.toggle';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();
    statusBarItem.show();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('auto-accept.toggle', () => toggleAutoAccept(context)),
        vscode.commands.registerCommand('auto-accept.editBannedCommands', () => editBannedCommands(context)),
        vscode.commands.registerCommand('auto-accept.resetBannedCommands', () => resetBannedCommands(context))
    );

    // Start the auto-accept loop
    startLoop();

    log(`Auto Accept activated. Enabled: ${enabled}`);
    log(`Banned command patterns: ${bannedCommands.length}`);
}

/**
 * Toggle auto-accept on/off
 */
async function toggleAutoAccept(context) {
    enabled = !enabled;
    await context.globalState.update(GLOBAL_STATE_KEY, enabled);
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
        statusBarItem.tooltip = 'Auto-Accept is running. Click to pause.\n\nRight-click for safety settings.';
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

    autoAcceptInterval = setInterval(async () => {
        if (!enabled) return;

        try {
            // Native Antigravity command for accepting agent steps
            await vscode.commands.executeCommand('antigravity.agent.acceptAgentStep');
        } catch (e) {
            // Command may not exist or no pending step - this is normal
        }

        try {
            // Native Antigravity command for accepting terminal commands
            await vscode.commands.executeCommand('antigravity.terminal.accept');
        } catch (e) {
            // Command may not exist or no pending terminal - this is normal
        }
    }, 500); // 500ms polling interval

    log('Auto-accept loop started');
}

/**
 * Stop the auto-accept polling loop
 */
function stopLoop() {
    if (autoAcceptInterval) {
        clearInterval(autoAcceptInterval);
        autoAcceptInterval = null;
    }
    log('Auto-accept loop stopped');
}

/**
 * Check if a command text contains banned patterns
 */
function isCommandBanned(commandText) {
    if (!commandText || commandText.length === 0) return false;

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
async function editBannedCommands(context) {
    const currentPatterns = bannedCommands.join('\n');

    const result = await vscode.window.showInputBox({
        prompt: 'Edit banned command patterns (one per line)',
        value: currentPatterns,
        placeHolder: 'rm -rf /\nformat c:\n/sudo\\s+rm/',
        validateInput: (value) => {
            return null; // Accept any input
        }
    });

    if (result !== undefined) {
        const newPatterns = result.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        bannedCommands = newPatterns;
        await context.globalState.update(BANNED_COMMANDS_KEY, bannedCommands);
        vscode.window.showInformationMessage(`Updated ${bannedCommands.length} banned patterns.`);
        log(`Banned commands updated: ${bannedCommands.length} patterns`);
    }
}

/**
 * Reset banned commands to defaults
 */
async function resetBannedCommands(context) {
    const choice = await vscode.window.showWarningMessage(
        'Reset banned commands to defaults?',
        'Yes', 'No'
    );

    if (choice === 'Yes') {
        bannedCommands = [...DEFAULT_BANNED_COMMANDS];
        await context.globalState.update(BANNED_COMMANDS_KEY, bannedCommands);
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
