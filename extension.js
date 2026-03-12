const vscode = require('vscode');
const patcher = require('./lib/auto-run-patcher');

// ============================================================
// AUTO-ACCEPT AGENT v2.1.0 — Polling Edition
//
// Architecture:
//   Lightweight command polling loop that auto-accepts agent
//   steps, terminal commands, suggestions, and edit blocks.
//   No source-level patching — safe and stable.
// ============================================================

let enabled = true;
let autoAcceptInterval = null;
let notificationInterval = null;
let statusBarItem = null;
let globalContext = null;
let loopTickCount = 0;

// Auto-retry state
let consecutiveRetries = 0;
let lastRetryTime = 0;
let retryTimeout = null;

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
 */
function safeExecute(cmd) {
    try {
        return vscode.commands.executeCommand(cmd).catch(() => { });
    } catch (e) {
        return Promise.resolve();
    }
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
    globalContext = context;
    outputChannel = vscode.window.createOutputChannel('Auto Accept Agent');
    context.subscriptions.push(outputChannel);

    log('Activating Auto Accept Agent v2.1.0 (Polling Edition)...');

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
        vscode.commands.registerCommand('auto-accept.openQuickSettings', () => openQuickSettings()),
        vscode.commands.registerCommand('auto-accept.diagnostics', () => runDiagnostics()),
        vscode.commands.registerCommand('auto-accept.applyPatch', () => applyPatchManual()),
        vscode.commands.registerCommand('auto-accept.revertPatch', () => revertPatchManual()),
        vscode.commands.registerCommand('auto-accept.showStatus', () => showPatchStatus())
    );

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('auto-accept')) {
                handleConfigChange();
            }
        })
    );

    // Source patch disabled on startup — use "Auto Accept: Apply Auto-Run Fix" manually
    // applyPatchSilent();

    // Start the polling loop if enabled
    if (enabled) {
        startLoop();
    }

    log(`Activated. Enabled: ${enabled}`);
}

// ============================================================
// POLLING LOOP
// ============================================================

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

async function toggleAutoAccept() {
    enabled = !enabled;
    const config = vscode.workspace.getConfiguration('auto-accept');
    await config.update('enabled', enabled, vscode.ConfigurationTarget.Global);
    updateStatusBar();

    if (enabled) {
        vscode.window.showInformationMessage('Auto-Accept: ON');
        startLoop();
    } else {
        vscode.window.showInformationMessage('Auto-Accept: OFF');
        stopLoop();
    }

    log(`Auto Accept toggled: ${enabled ? 'ON' : 'OFF'}`);
}

function updateStatusBar() {
    if (!statusBarItem) return;

    if (enabled) {
        // Check if source patch is applied
        patcher.checkAll().then(results => {
            const anyPatched = results.some(r => r.patched);
            if (anyPatched) {
                statusBarItem.text = '$(check) Auto Accept: ON';
                statusBarItem.tooltip = 'Auto-Accept is running with source patch. Click to pause.';
                statusBarItem.backgroundColor = undefined;
            } else {
                statusBarItem.text = '$(warning) Auto Accept: ON (no patch)';
                statusBarItem.tooltip = 'Running via polling only — apply source patch for background support.\nCtrl+Shift+P → "Auto Accept: Apply Auto-Run Fix"';
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            }
        }).catch(() => {
            statusBarItem.text = '$(check) Auto Accept: ON';
            statusBarItem.tooltip = 'Auto-Accept is running. Click to pause.';
            statusBarItem.backgroundColor = undefined;
        });
    } else {
        statusBarItem.text = '$(circle-slash) Auto Accept: OFF';
        statusBarItem.tooltip = 'Auto-Accept is paused. Click to resume.';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

function startLoop() {
    if (autoAcceptInterval) clearInterval(autoAcceptInterval);
    if (notificationInterval) clearInterval(notificationInterval);

    // Reset timers
    const now = Date.now();
    lastAcceptSuccess = now;
    lastUserActivity = now;
    lastRetryTime = now;
    consecutiveRetries = 0;

    const pollingInterval = getConfig('pollingInterval') || 500;

    // HIGH-FREQUENCY approval acceptor (200ms)
    const approvalCommands = [
        'notification.acceptPrimaryAction',
        'antigravity.agent.acceptAgentStep',
        'antigravity.terminalCommand.run',
        'antigravity.terminalCommand.accept',
        'antigravity.executeCascadeAction',
        'workbench.action.terminal.chat.runCommand',
        'workbench.action.terminal.chat.runFirstCommand',
        'chatEditing.acceptFile',
        'chatEditing.acceptAllFiles'
    ];
    notificationInterval = setInterval(async () => {
        try {
            if (!enabled) return;
            await Promise.allSettled(approvalCommands.map(safeExecute));
        } catch (e) {
            // Never let the loop die
        }
    }, 200);

    autoAcceptInterval = setInterval(async () => {
        try {
            if (!enabled) return;
            loopTickCount++;

            const allCommands = [];

            if (getConfig('acceptRunCommands')) {
                allCommands.push(
                    'antigravity.terminalCommand.run',
                    'workbench.action.terminal.chat.runCommand',
                    'workbench.action.terminal.chat.runFirstCommand'
                );
            }
            if (getConfig('acceptAgentSteps')) {
                allCommands.push(
                    'antigravity.agent.acceptAgentStep',
                    'antigravity.prioritized.agentAcceptFocusedHunk',
                    'chatEditing.acceptFile',
                    'workbench.action.chat.acceptTool'
                );
            }
            if (getConfig('acceptTerminalCommands')) {
                allCommands.push(
                    'antigravity.terminalCommand.accept',
                    'antigravity.prioritized.terminalSuggestion.accept',
                    'workbench.action.terminal.acceptSelectedSuggestion'
                );
            }
            if (getConfig('acceptSuggestions')) {
                allCommands.push(
                    'antigravity.acceptCompletion',
                    'antigravity.prioritized.supercompleteAccept',
                    'editor.action.inlineSuggest.acceptNextLine',
                    'editor.action.accessibleViewAcceptInlineCompletion'
                );
            }
            if (getConfig('acceptEditBlocks')) {
                allCommands.push(
                    'antigravity.command.accept',
                    'inlineChat.acceptChanges',
                    'interactive.acceptChanges'
                );
            }
            if (getConfig('acceptAll')) {
                allCommands.push(
                    'antigravity.prioritized.agentAcceptAllInFile',
                    'chatEditing.acceptAllFiles'
                );
            }

            // Always try notification + cascade
            allCommands.push(
                'notification.acceptPrimaryAction',
                'antigravity.executeCascadeAction'
            );

            // Auto-retry check BEFORE updating lastAcceptSuccess
            // (otherwise idleTime is always ~0ms)
            if (getConfig('autoRetryOnError')) {
                const idleNow = Date.now();
                const idleTime = idleNow - lastAcceptSuccess;
                const timeSinceRetry = idleNow - lastRetryTime;

                if (idleTime > 5000 && timeSinceRetry > 3000) {
                    safeExecute('workbench.action.focusAgentManager.continueConversation');
                    lastRetryTime = idleNow;
                }
            }

            await Promise.allSettled(allCommands.map(safeExecute));
            lastAcceptSuccess = Date.now();
        } catch (e) {
            log(`Loop error (non-fatal): ${e.message}`);
        }
    }, pollingInterval);

    log(`Polling loop started (interval: ${pollingInterval}ms)`);
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
        '=== AUTO-ACCEPT AGENT DIAGNOSTICS (v2.1.0) ===',
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
        'notification.acceptPrimaryAction',
        'antigravity.agent.acceptAgentStep',
        'antigravity.terminalCommand.run',
        'antigravity.terminalCommand.accept',
        'antigravity.executeCascadeAction',
        'antigravity.prioritized.agentAcceptFocusedHunk',
        'antigravity.prioritized.terminalSuggestion.accept',
        'antigravity.acceptCompletion',
        'antigravity.prioritized.supercompleteAccept',
        'antigravity.command.accept',
        'workbench.action.terminal.chat.runCommand',
        'workbench.action.terminal.chat.runFirstCommand',
        'workbench.action.terminal.acceptSelectedSuggestion',
        'workbench.action.chat.acceptTool',
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

    for (const r of results) {
        log(`[revert] ${r.label}: ${r.status}${r.error ? ` — ${r.error}` : ''}`);
    }

    if (reverted > 0) {
        const action = await vscode.window.showInformationMessage(
            `Auto-run fix reverted (${reverted} file(s)). Restart to apply.`,
            'Reload Now'
        );
        if (action === 'Reload Now') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } else {
        vscode.window.showInformationMessage('No backups found — nothing to revert.');
    }
}

async function showPatchStatus() {
    const basePath = patcher.findAntigravityPath();
    const lines = ['=== AUTO-RUN PATCH STATUS ===', ''];

    if (basePath) {
        lines.push(`Installation: ${basePath}`);
        lines.push(`Version: ${patcher.getVersion(basePath)}`);
        lines.push('');

        const statuses = await patcher.checkAll();
        for (const s of statuses) {
            const icon = s.patched ? '✅' : (s.patchable ? '⬜' : '⚠️');
            const state = s.patched ? 'PATCHED' : (s.patchable ? 'NOT PATCHED (patchable)' : 'NOT PATCHED (incompatible)');
            const backup = s.hasBackup ? ' (backup exists)' : '';
            lines.push(`  ${icon} ${s.label}: ${state}${backup}`);
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
// DEACTIVATION
// ============================================================

function deactivate() {
    stopLoop();
    log('Auto Accept Agent deactivated');
}

module.exports = {
    activate,
    deactivate,
    isCommandBanned
};
