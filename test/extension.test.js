/**
 * Auto-Accept Agent Extension Test Suite
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
 * Get formatted session duration
 * (Exact copy from extension.js)
 */
function getSessionDuration(startTime) {
    if (!startTime) return 'N/A';

    const duration = Date.now() - startTime;
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

// Default configuration values (from package.json)
const DEFAULT_CONFIG = {
    enabled: true,
    pollingInterval: 500,
    acceptAgentSteps: true,
    acceptTerminalCommands: true,
    acceptSuggestions: true,
    acceptEditBlocks: true,
    acceptFileAccess: true,
    autoContinue: false,
    autoRetryOnError: true,
    autoRetryDelay: 1000,
    maxRetryAttempts: 3,
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

// Antigravity commands used by the extension
const ANTIGRAVITY_COMMANDS = [
    'antigravity.agent.acceptAgentStep',
    'antigravity.terminal.accept',
    'antigravity.acceptSuggestion',
    'antigravity.agent.acceptEditBlock',
    'antigravity.allowThisConversation',
    'antigravity.agent.continueTask',
    'antigravity.agent.retryAgentStep'
];

// ============================================================
// Test Suites
// ============================================================

console.log('='.repeat(60));
console.log('AUTO-ACCEPT AGENT - TEST SUITE');
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
        // Invalid regex should fall back to literal match of the FULL pattern
        const bannedCommands = ['/[invalid/'];
        // The fallback matches the full pattern string "/[invalid/" as literal
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

describe('Session Duration Formatting', () => {
    test('should return "N/A" for null start time', () => {
        assert.strictEqual(getSessionDuration(null), 'N/A');
    });

    test('should return "N/A" for undefined start time', () => {
        assert.strictEqual(getSessionDuration(undefined), 'N/A');
    });

    test('should return "0m" for current time', () => {
        const result = getSessionDuration(Date.now());
        assert.strictEqual(result, '0m');
    });

    test('should format 5 minutes correctly', () => {
        const fiveMinsAgo = Date.now() - (5 * 60 * 1000);
        const result = getSessionDuration(fiveMinsAgo);
        assert.strictEqual(result, '5m');
    });

    test('should format 30 minutes correctly', () => {
        const thirtyMinsAgo = Date.now() - (30 * 60 * 1000);
        const result = getSessionDuration(thirtyMinsAgo);
        assert.strictEqual(result, '30m');
    });

    test('should format 1 hour correctly', () => {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const result = getSessionDuration(oneHourAgo);
        assert.strictEqual(result, '1h 0m');
    });

    test('should format hours and minutes correctly', () => {
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000 + 15 * 60 * 1000);
        const result = getSessionDuration(twoHoursAgo);
        assert.strictEqual(result, '2h 15m');
    });
});

describe('Configuration Defaults', () => {
    test('enabled should default to true', () => {
        assert.strictEqual(DEFAULT_CONFIG.enabled, true);
    });

    test('pollingInterval should default to 500', () => {
        assert.strictEqual(DEFAULT_CONFIG.pollingInterval, 500);
    });

    test('pollingInterval should be within valid range', () => {
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

    test('acceptFileAccess should default to true', () => {
        assert.strictEqual(DEFAULT_CONFIG.acceptFileAccess, true);
    });

    test('autoContinue should default to false', () => {
        assert.strictEqual(DEFAULT_CONFIG.autoContinue, false);
    });

    test('autoRetryOnError should default to true', () => {
        assert.strictEqual(DEFAULT_CONFIG.autoRetryOnError, true);
    });

    test('autoRetryDelay should default to 1000', () => {
        assert.strictEqual(DEFAULT_CONFIG.autoRetryDelay, 1000);
    });

    test('autoRetryDelay should be within valid range', () => {
        assert.ok(DEFAULT_CONFIG.autoRetryDelay >= 500, 'Should be at least 500ms');
        assert.ok(DEFAULT_CONFIG.autoRetryDelay <= 10000, 'Should be at most 10000ms');
    });

    test('maxRetryAttempts should default to 3', () => {
        assert.strictEqual(DEFAULT_CONFIG.maxRetryAttempts, 3);
    });

    test('maxRetryAttempts should be within valid range', () => {
        assert.ok(DEFAULT_CONFIG.maxRetryAttempts >= 1, 'Should be at least 1');
        assert.ok(DEFAULT_CONFIG.maxRetryAttempts <= 10, 'Should be at most 10');
    });

    test('bannedCommands should have default patterns', () => {
        assert.ok(DEFAULT_CONFIG.bannedCommands.length > 0);
        assert.ok(DEFAULT_CONFIG.bannedCommands.includes('rm -rf /'));
    });
});

describe('Antigravity Commands', () => {
    test('should have acceptAgentStep command', () => {
        assert.ok(ANTIGRAVITY_COMMANDS.includes('antigravity.agent.acceptAgentStep'));
    });

    test('should have terminal.accept command', () => {
        assert.ok(ANTIGRAVITY_COMMANDS.includes('antigravity.terminal.accept'));
    });

    test('should have acceptSuggestion command', () => {
        assert.ok(ANTIGRAVITY_COMMANDS.includes('antigravity.acceptSuggestion'));
    });

    test('should have acceptEditBlock command', () => {
        assert.ok(ANTIGRAVITY_COMMANDS.includes('antigravity.agent.acceptEditBlock'));
    });

    test('should have allowThisConversation command for file access', () => {
        assert.ok(ANTIGRAVITY_COMMANDS.includes('antigravity.allowThisConversation'));
    });

    test('should have continueTask command for auto-continue', () => {
        assert.ok(ANTIGRAVITY_COMMANDS.includes('antigravity.agent.continueTask'));
    });

    test('should have retryAgentStep command for auto-retry', () => {
        assert.ok(ANTIGRAVITY_COMMANDS.includes('antigravity.agent.retryAgentStep'));
    });

    test('all commands should have correct prefix', () => {
        ANTIGRAVITY_COMMANDS.forEach(cmd => {
            assert.ok(cmd.startsWith('antigravity.'), `Command ${cmd} should start with antigravity.`);
        });
    });

    test('should have at least 7 commands', () => {
        assert.ok(ANTIGRAVITY_COMMANDS.length >= 7);
    });
});

describe('Extension Commands (package.json)', () => {
    const extensionCommands = [
        'auto-accept.toggle',
        'auto-accept.editBannedCommands',
        'auto-accept.resetBannedCommands',
        'auto-accept.resetCounter',
        'auto-accept.showStats'
    ];

    test('should have toggle command', () => {
        assert.ok(extensionCommands.includes('auto-accept.toggle'));
    });

    test('should have editBannedCommands command', () => {
        assert.ok(extensionCommands.includes('auto-accept.editBannedCommands'));
    });

    test('should have resetBannedCommands command', () => {
        assert.ok(extensionCommands.includes('auto-accept.resetBannedCommands'));
    });

    test('should have resetCounter command', () => {
        assert.ok(extensionCommands.includes('auto-accept.resetCounter'));
    });

    test('should have showStats command', () => {
        assert.ok(extensionCommands.includes('auto-accept.showStats'));
    });

    test('all commands should have correct prefix', () => {
        extensionCommands.forEach(cmd => {
            assert.ok(cmd.startsWith('auto-accept.'), `Command ${cmd} should start with auto-accept.`);
        });
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
