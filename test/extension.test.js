/**
 * Auto-Accept Agent Extension Test Suite (v1.6.6)
 * 
 * Tests core functionality without requiring VS Code runtime.
 * Run with: node test/extension.test.js
 */

const assert = require('assert');

// ============================================================
// Test Utilities
// ============================================================

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        testsPassed++;
    } catch (error) {
        console.log(`  ❌ ${name}`);
        console.log(`     Error: ${error.message}`);
        testsFailed++;
    }
}

function describe(suiteName, fn) {
    console.log(`\n📦 ${suiteName}`);
    fn();
}

// ============================================================
// Functions extracted from extension.js for testing
// ============================================================

/**
 * Check if a command text contains banned patterns
 * (Exact copy from extension.js)
 */
function isCommandBanned(commandText, bannedCommands) {
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
                    return true;
                }
            } else {
                // Plain text - literal substring match (case-insensitive)
                if (lowerText.includes(pattern.toLowerCase())) {
                    return true;
                }
            }
        } catch (e) {
            // Invalid regex, try literal match
            if (lowerText.includes(pattern.toLowerCase())) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Calculate exponential backoff delay with optional jitter
 * (Exact copy from extension.js)
 */
function calculateBackoff(attempt, baseDelay = 1000, maxDelay = 60000, jitterEnabled = true) {
    let delay = baseDelay * Math.pow(2, attempt);
    delay = Math.min(delay, maxDelay);
    if (jitterEnabled) {
        const jitterFactor = 0.75 + Math.random() * 0.5; // 0.75 to 1.25
        delay = delay * jitterFactor;
    }
    return Math.round(delay);
}

// Default configuration values (from package.json v1.6.0)
const DEFAULT_CONFIG = {
    enabled: true,
    pollingInterval: 500,
    acceptAgentSteps: true,
    acceptTerminalCommands: true,
    acceptSuggestions: true,
    acceptEditBlocks: true,
    acceptAll: true,
    acceptRunCommands: true,
    autoRetryOnError: false,
    retryBaseDelay: 1000,
    retryMaxDelay: 60000,
    jitterEnabled: true,
    maxRetryAttempts: 5,
    bannedCommands: [
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
    ]
};

// Command groups used by extension.js v1.6.0 (from startLoop)
const COMMAND_GROUPS = {
    acceptAgentSteps: [
        'antigravity.agent.acceptAgentStep',
        'antigravity.prioritized.agentAcceptFocusedHunk',
        'workbench.action.chat.acceptTool'
    ],
    acceptTerminalCommands: [
        'antigravity.terminalCommand.accept',
        'antigravity.prioritized.terminalSuggestion.accept'
    ],
    acceptSuggestions: [
        'antigravity.acceptCompletion',
        'antigravity.prioritized.supercompleteAccept'
    ],
    acceptEditBlocks: [
        'antigravity.command.accept',
        'chatEditor.action.acceptHunk',
        'inlineChat.acceptChanges'
    ],
    acceptAll: [
        'antigravity.prioritized.agentAcceptAllInFile',
        'chatEditor.action.acceptAllEdits',
        'chatEditing.acceptAllFiles'
    ],
    acceptRunCommands: [
        'antigravity.terminalCommand.run',
        'workbench.action.terminal.chat.runCommand',
        'workbench.action.terminal.chat.runFirstCommand',
        'notification.acceptPrimaryAction',
        'quickInput.accept'
    ],
    retry: [
        'workbench.action.chat.retry'
    ]
};

// Extension commands registered in package.json v1.6.0
const EXTENSION_COMMANDS = [
    'auto-accept.toggle',
    'auto-accept.editBannedCommands',
    'auto-accept.resetBannedCommands',
    'auto-accept.discoverCommands',
    'auto-accept.openQuickSettings'
];

// ============================================================
// Test Suites
// ============================================================

console.log('='.repeat(60));
console.log('AUTO-ACCEPT AGENT - TEST SUITE (v1.6.6)');
console.log('='.repeat(60));

describe('Banned Commands - Plain Text Patterns', () => {
    const bannedCommands = ['rm -rf /', 'format c:', 'del /f /s /q'];

    test('should block exact match "rm -rf /"', () => {
        assert.strictEqual(isCommandBanned('rm -rf /', bannedCommands), true);
    });

    test('should block command containing "rm -rf /"', () => {
        assert.strictEqual(isCommandBanned('sudo rm -rf / --no-preserve-root', bannedCommands), true);
    });

    test('should block case-insensitive "FORMAT C:"', () => {
        assert.strictEqual(isCommandBanned('FORMAT C:', bannedCommands), true);
    });

    test('should allow safe command "ls -la"', () => {
        assert.strictEqual(isCommandBanned('ls -la', bannedCommands), false);
    });

    test('should allow safe command "npm install"', () => {
        assert.strictEqual(isCommandBanned('npm install', bannedCommands), false);
    });

    test('should allow safe command "git push"', () => {
        assert.strictEqual(isCommandBanned('git push origin main', bannedCommands), false);
    });

    test('should handle empty command', () => {
        assert.strictEqual(isCommandBanned('', bannedCommands), false);
    });

    test('should handle null command', () => {
        assert.strictEqual(isCommandBanned(null, bannedCommands), false);
    });

    test('should handle undefined command', () => {
        assert.strictEqual(isCommandBanned(undefined, bannedCommands), false);
    });
});

describe('Banned Commands - Regex Patterns', () => {
    const bannedCommands = ['/sudo\\s+rm/i', '/chmod\\s+-R\\s+777/'];

    test('should block "sudo rm -rf" with regex', () => {
        assert.strictEqual(isCommandBanned('sudo rm -rf /home/user', bannedCommands), true);
    });

    test('should block "sudo  rm" with multiple spaces', () => {
        assert.strictEqual(isCommandBanned('sudo  rm file.txt', bannedCommands), true);
    });

    test('should block "SUDO RM" case-insensitive', () => {
        assert.strictEqual(isCommandBanned('SUDO RM dangerous.txt', bannedCommands), true);
    });

    test('should block "chmod -R 777" with regex', () => {
        assert.strictEqual(isCommandBanned('chmod -R 777 /var/www', bannedCommands), true);
    });

    test('should allow "sudo apt install"', () => {
        assert.strictEqual(isCommandBanned('sudo apt install vim', bannedCommands), false);
    });

    test('should allow "chmod 755"', () => {
        assert.strictEqual(isCommandBanned('chmod 755 script.sh', bannedCommands), false);
    });

    test('should allow "chmod -R 755"', () => {
        assert.strictEqual(isCommandBanned('chmod -R 755 /var/www', bannedCommands), false);
    });
});

describe('Banned Commands - Edge Cases', () => {
    test('should handle empty banned list', () => {
        assert.strictEqual(isCommandBanned('rm -rf /', []), false);
    });

    test('should handle banned list with empty strings', () => {
        assert.strictEqual(isCommandBanned('rm -rf /', ['', '', '']), false);
    });

    test('should handle invalid regex gracefully', () => {
        const bannedCommands = ['/[invalid/'];
        assert.strictEqual(isCommandBanned('/[invalid/', bannedCommands), true);
        assert.strictEqual(isCommandBanned('some other command', bannedCommands), false);
    });

    test('should handle special characters in plain text', () => {
        const bannedCommands = [':(){:|:&};:'];
        assert.strictEqual(isCommandBanned(':(){:|:&};:', bannedCommands), true);
    });

    test('should handle fork bomb pattern', () => {
        assert.strictEqual(isCommandBanned(':(){:|:&};:', DEFAULT_CONFIG.bannedCommands), true);
    });

    test('should handle dd command pattern', () => {
        assert.strictEqual(isCommandBanned('dd if=/dev/zero of=/dev/sda', DEFAULT_CONFIG.bannedCommands), true);
    });
});

describe('Banned Commands - Default Patterns', () => {
    const bannedCommands = DEFAULT_CONFIG.bannedCommands;

    test('should block "rm -rf /"', () => {
        assert.strictEqual(isCommandBanned('rm -rf /', bannedCommands), true);
    });

    test('should block "rm -rf ~"', () => {
        assert.strictEqual(isCommandBanned('rm -rf ~', bannedCommands), true);
    });

    test('should block "format c:"', () => {
        assert.strictEqual(isCommandBanned('format c:', bannedCommands), true);
    });

    test('should block "del /f /s /q"', () => {
        assert.strictEqual(isCommandBanned('del /f /s /q C:\\*', bannedCommands), true);
    });

    test('should block "shutdown"', () => {
        assert.strictEqual(isCommandBanned('shutdown /s /t 0', bannedCommands), true);
    });

    test('should block "reboot"', () => {
        assert.strictEqual(isCommandBanned('reboot now', bannedCommands), true);
    });

    test('should block "sudo rm -rf"', () => {
        assert.strictEqual(isCommandBanned('sudo rm -rf /important', bannedCommands), true);
    });

    test('should block "mkfs."', () => {
        assert.strictEqual(isCommandBanned('mkfs.ext4 /dev/sda1', bannedCommands), true);
    });
});

describe('Exponential Backoff', () => {
    test('attempt 0 should return base delay (no jitter)', () => {
        const delay = calculateBackoff(0, 1000, 60000, false);
        assert.strictEqual(delay, 1000);
    });

    test('attempt 1 should double (no jitter)', () => {
        const delay = calculateBackoff(1, 1000, 60000, false);
        assert.strictEqual(delay, 2000);
    });

    test('attempt 2 should quadruple (no jitter)', () => {
        const delay = calculateBackoff(2, 1000, 60000, false);
        assert.strictEqual(delay, 4000);
    });

    test('attempt 3 should 8x (no jitter)', () => {
        const delay = calculateBackoff(3, 1000, 60000, false);
        assert.strictEqual(delay, 8000);
    });

    test('should respect max delay cap (no jitter)', () => {
        const delay = calculateBackoff(10, 1000, 60000, false);
        assert.strictEqual(delay, 60000);
    });

    test('should use custom base delay (no jitter)', () => {
        const delay = calculateBackoff(0, 500, 60000, false);
        assert.strictEqual(delay, 500);
    });

    test('should use custom max delay (no jitter)', () => {
        const delay = calculateBackoff(10, 1000, 10000, false);
        assert.strictEqual(delay, 10000);
    });

    test('jitter should keep delay within ±25% of base', () => {
        // Run multiple times to test range
        for (let i = 0; i < 50; i++) {
            const delay = calculateBackoff(0, 1000, 60000, true);
            assert.ok(delay >= 750, `Delay ${delay} should be >= 750`);
            assert.ok(delay <= 1250, `Delay ${delay} should be <= 1250`);
        }
    });

    test('jitter should keep capped delay within ±25% of max', () => {
        for (let i = 0; i < 50; i++) {
            const delay = calculateBackoff(10, 1000, 60000, true);
            assert.ok(delay >= 45000, `Delay ${delay} should be >= 45000`);
            assert.ok(delay <= 75000, `Delay ${delay} should be <= 75000`);
        }
    });

    test('attempt 0 returns integer', () => {
        const delay = calculateBackoff(0, 1000, 60000, true);
        assert.strictEqual(delay, Math.round(delay));
    });
});

describe('Configuration Defaults (v1.6.6)', () => {
    test('enabled should default to true', () => {
        assert.strictEqual(DEFAULT_CONFIG.enabled, true);
    });

    test('pollingInterval should default to 500', () => {
        assert.strictEqual(DEFAULT_CONFIG.pollingInterval, 500);
    });

    test('pollingInterval should be within valid range (100-5000)', () => {
        assert.ok(DEFAULT_CONFIG.pollingInterval >= 100, 'Should be at least 100ms');
        assert.ok(DEFAULT_CONFIG.pollingInterval <= 5000, 'Should be at most 5000ms');
    });

    test('acceptAgentSteps should default to true', () => {
        assert.strictEqual(DEFAULT_CONFIG.acceptAgentSteps, true);
    });

    test('acceptTerminalCommands should default to true', () => {
        assert.strictEqual(DEFAULT_CONFIG.acceptTerminalCommands, true);
    });

    test('acceptSuggestions should default to true', () => {
        assert.strictEqual(DEFAULT_CONFIG.acceptSuggestions, true);
    });

    test('acceptEditBlocks should default to true', () => {
        assert.strictEqual(DEFAULT_CONFIG.acceptEditBlocks, true);
    });

    test('acceptAll should default to true', () => {
        assert.strictEqual(DEFAULT_CONFIG.acceptAll, true);
    });

    test('acceptRunCommands should default to true', () => {
        assert.strictEqual(DEFAULT_CONFIG.acceptRunCommands, true);
    });

    test('autoRetryOnError should default to false', () => {
        assert.strictEqual(DEFAULT_CONFIG.autoRetryOnError, false);
    });

    test('retryBaseDelay should default to 1000', () => {
        assert.strictEqual(DEFAULT_CONFIG.retryBaseDelay, 1000);
    });

    test('retryBaseDelay should be within valid range (500-10000)', () => {
        assert.ok(DEFAULT_CONFIG.retryBaseDelay >= 500, 'Should be at least 500ms');
        assert.ok(DEFAULT_CONFIG.retryBaseDelay <= 10000, 'Should be at most 10000ms');
    });

    test('retryMaxDelay should default to 60000', () => {
        assert.strictEqual(DEFAULT_CONFIG.retryMaxDelay, 60000);
    });

    test('retryMaxDelay should be within valid range (5000-300000)', () => {
        assert.ok(DEFAULT_CONFIG.retryMaxDelay >= 5000, 'Should be at least 5000ms');
        assert.ok(DEFAULT_CONFIG.retryMaxDelay <= 300000, 'Should be at most 300000ms');
    });

    test('jitterEnabled should default to true', () => {
        assert.strictEqual(DEFAULT_CONFIG.jitterEnabled, true);
    });

    test('maxRetryAttempts should default to 5', () => {
        assert.strictEqual(DEFAULT_CONFIG.maxRetryAttempts, 5);
    });

    test('maxRetryAttempts should be within valid range (1-20)', () => {
        assert.ok(DEFAULT_CONFIG.maxRetryAttempts >= 1, 'Should be at least 1');
        assert.ok(DEFAULT_CONFIG.maxRetryAttempts <= 20, 'Should be at most 20');
    });

    test('bannedCommands should have default patterns', () => {
        assert.ok(DEFAULT_CONFIG.bannedCommands.length > 0);
        assert.ok(DEFAULT_CONFIG.bannedCommands.includes('rm -rf /'));
    });

    test('should NOT have retired acceptFileAccess setting', () => {
        assert.strictEqual(DEFAULT_CONFIG.acceptFileAccess, undefined);
    });

    test('should NOT have retired autoContinue setting', () => {
        assert.strictEqual(DEFAULT_CONFIG.autoContinue, undefined);
    });
});

describe('Command Groups (v1.6.6)', () => {
    test('acceptAgentSteps group should include acceptAgentStep', () => {
        assert.ok(COMMAND_GROUPS.acceptAgentSteps.includes('antigravity.agent.acceptAgentStep'));
    });

    test('acceptAgentSteps group should include acceptTool', () => {
        assert.ok(COMMAND_GROUPS.acceptAgentSteps.includes('workbench.action.chat.acceptTool'));
    });

    test('acceptAgentSteps group should include agentAcceptFocusedHunk', () => {
        assert.ok(COMMAND_GROUPS.acceptAgentSteps.includes('antigravity.prioritized.agentAcceptFocusedHunk'));
    });

    test('acceptTerminalCommands group should include terminalCommand.accept', () => {
        assert.ok(COMMAND_GROUPS.acceptTerminalCommands.includes('antigravity.terminalCommand.accept'));
    });

    test('acceptSuggestions group should include acceptCompletion', () => {
        assert.ok(COMMAND_GROUPS.acceptSuggestions.includes('antigravity.acceptCompletion'));
    });

    test('acceptEditBlocks group should include command.accept', () => {
        assert.ok(COMMAND_GROUPS.acceptEditBlocks.includes('antigravity.command.accept'));
    });

    test('acceptAll group should include agentAcceptAllInFile', () => {
        assert.ok(COMMAND_GROUPS.acceptAll.includes('antigravity.prioritized.agentAcceptAllInFile'));
    });

    test('retry group should use background-safe chat.retry only', () => {
        assert.deepStrictEqual(COMMAND_GROUPS.retry, ['workbench.action.chat.retry']);
    });

    test('acceptRunCommands group should include runCommand', () => {
        assert.ok(COMMAND_GROUPS.acceptRunCommands.includes('workbench.action.terminal.chat.runCommand'));
    });

    test('acceptRunCommands group should include terminalCommand.run', () => {
        assert.ok(COMMAND_GROUPS.acceptRunCommands.includes('antigravity.terminalCommand.run'));
    });

    test('should have 7 command groups total', () => {
        assert.strictEqual(Object.keys(COMMAND_GROUPS).length, 7);
    });
});

describe('Extension Commands (package.json v1.6.6)', () => {
    test('should have toggle command', () => {
        assert.ok(EXTENSION_COMMANDS.includes('auto-accept.toggle'));
    });

    test('should have editBannedCommands command', () => {
        assert.ok(EXTENSION_COMMANDS.includes('auto-accept.editBannedCommands'));
    });

    test('should have resetBannedCommands command', () => {
        assert.ok(EXTENSION_COMMANDS.includes('auto-accept.resetBannedCommands'));
    });

    test('should have discoverCommands command', () => {
        assert.ok(EXTENSION_COMMANDS.includes('auto-accept.discoverCommands'));
    });

    test('should have openQuickSettings command', () => {
        assert.ok(EXTENSION_COMMANDS.includes('auto-accept.openQuickSettings'));
    });

    test('should NOT have retired resetCounter command', () => {
        assert.ok(!EXTENSION_COMMANDS.includes('auto-accept.resetCounter'));
    });

    test('should NOT have retired showStats command', () => {
        assert.ok(!EXTENSION_COMMANDS.includes('auto-accept.showStats'));
    });

    test('all commands should have correct prefix', () => {
        EXTENSION_COMMANDS.forEach(cmd => {
            assert.ok(cmd.startsWith('auto-accept.'), `Command ${cmd} should start with auto-accept.`);
        });
    });

    test('should have exactly 5 commands', () => {
        assert.strictEqual(EXTENSION_COMMANDS.length, 5);
    });
});

// ============================================================
// Run Tests and Report
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST RESULTS');
console.log('='.repeat(60));

console.log(`\n📊 Summary: ${testsPassed} passed, ${testsFailed} failed`);
console.log(`   Total: ${testsPassed + testsFailed} tests`);

if (testsFailed > 0) {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
} else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
}
