/**
 * Antigravity Handler
 * Handles auto-accept for Antigravity (VS Code with Antigravity extension)
 */

const vscode = require('vscode');

const ANTIGRAVITY_COMMANDS = [
    'antigravity.agent.acceptAgentStep'
];

class AntigravityHandler {
    constructor() {
        this.name = 'Antigravity';
        // activeCommands is removed in favor of direct execution to handle late registration
    }

    async refreshCommands() {
        // No-op: we invoke directly now
    }

    getActiveCommands() {
        return ANTIGRAVITY_COMMANDS;
    }

    async executeAccept(skipFocus = false) {
        let executed = 0;

        for (const cmd of ANTIGRAVITY_COMMANDS) {
            try {
                await vscode.commands.executeCommand(cmd);
                executed++;
            } catch (e) {
                // Command might not be registered yet or failed
            }
        }

        return {
            executed,
            docChanged: false
        };
    }
}

module.exports = { AntigravityHandler };
