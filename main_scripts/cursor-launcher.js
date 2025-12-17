/**
 * Cursor Launcher
 * Cross-platform launcher for Cursor with CDP enabled.
 * Includes one-time setup to modify shortcuts.
 */

const vscode = require('vscode');
const { spawn, execSync } = require('child_process');
const os = require('os');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_CDP_PORT = 9222;
const CDP_FLAG = `--remote-debugging-port=${BASE_CDP_PORT}`;

class CursorLauncher {
    constructor(logger = null) {
        this.platform = os.platform();
        this.nextPort = BASE_CDP_PORT;
        this.logger = logger || console.log;
        this.logFile = path.join(os.tmpdir(), 'auto_accept_launch.log');
    }

    log(msg) {
        try {
            const timestamp = new Date().toISOString();
            const formattedMsg = `[CursorLauncher ${timestamp}] ${msg}`;
            if (this.logger && typeof this.logger === 'function') {
                this.logger(formattedMsg);
            }
            console.log(formattedMsg);
        } catch (e) {
            console.error('CursorLauncher log error:', e);
        }
    }

    logToFile(msg) {
        const line = `[${new Date().toISOString()}] ${msg}\n`;
        try {
            fs.appendFileSync(this.logFile, line);
        } catch (e) { /* ignore */ }
        this.log(msg);
    }

    /**
     * Check if CDP is available on a port
     */
    async isCDPAvailable(port = BASE_CDP_PORT) {
        return new Promise((resolve) => {
            const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.setTimeout(2000, () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    /**
     * Get current workspace folders as command line arguments
     */
    getWorkspaceFolders() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) return [];
        return folders.map(f => f.uri.fsPath);
    }

    /**
     * Main entry point: launch new Cursor with CDP and close current
     */
    async launchAndReplace() {
        const port = this.nextPort;
        const exePath = process.execPath;
        const workspaceFolders = this.getWorkspaceFolders();

        // Clear log file
        try {
            fs.writeFileSync(this.logFile, `=== Relaunch started at ${new Date().toISOString()} ===\n`);
        } catch (e) { /* ignore */ }

        this.logToFile(`Starting relaunch`);
        this.logToFile(`  Platform: ${this.platform}`);
        this.logToFile(`  Executable: ${exePath}`);
        this.logToFile(`  CDP Port: ${port}`);
        this.logToFile(`  Workspace folders: ${workspaceFolders.join(', ') || '(none)'}`);

        // Validate exe path
        if (!exePath || !fs.existsSync(exePath)) {
            this.logToFile(`ERROR: Invalid executable path`);
            return { success: false, error: 'Invalid executable path' };
        }

        try {
            if (this.platform === 'win32') {
                return await this.launchWindows(exePath, port, workspaceFolders);
            } else {
                return await this.launchUnix(exePath, port, workspaceFolders);
            }
        } catch (error) {
            this.logToFile(`ERROR: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Windows: Use batch file for reliable detached launch
     */
    async launchWindows(exePath, port, workspaceFolders) {
        this.logToFile(`launchWindows: Using batch file approach`);

        const batchPath = path.join(os.tmpdir(), 'relaunch_cursor.bat');

        // Build folder arguments - each folder in quotes
        const folderArgs = workspaceFolders.map(f => `"${f}"`).join(' ');

        // Create batch content - simple and reliable
        const batchContent = `@echo off
REM Auto Accept Agent - Cursor Relaunch Script
REM Generated: ${new Date().toISOString()}

set LOGFILE=%TEMP%\\auto_accept_launch.log

echo [%date% %time%] === Batch script started === >> "%LOGFILE%"
echo [%date% %time%] Waiting 3 seconds for parent to close... >> "%LOGFILE%"
timeout /t 3 /nobreak >nul

echo [%date% %time%] Launching Cursor with CDP on port ${port}... >> "%LOGFILE%"
echo [%date% %time%] Exe: "${exePath}" >> "%LOGFILE%"
echo [%date% %time%] Folders: ${folderArgs || '(none)'} >> "%LOGFILE%"

start "" "${exePath}" --remote-debugging-port=${port} ${folderArgs}

if %ERRORLEVEL% EQU 0 (
    echo [%date% %time%] SUCCESS: Cursor launched >> "%LOGFILE%"
) else (
    echo [%date% %time%] ERROR: Launch failed with code %ERRORLEVEL% >> "%LOGFILE%"
)

echo [%date% %time%] === Batch script complete === >> "%LOGFILE%"
`;

        // Write batch file
        try {
            fs.writeFileSync(batchPath, batchContent, 'utf8');
            this.logToFile(`launchWindows: Batch file written to ${batchPath}`);
        } catch (e) {
            this.logToFile(`launchWindows: Failed to write batch file: ${e.message}`);
            return { success: false, error: `Failed to write batch file: ${e.message}` };
        }

        // Spawn batch file detached
        try {
            this.logToFile(`launchWindows: Spawning batch file...`);

            // Simply run cmd /c batchPath - the batch file handles everything
            const child = spawn('cmd.exe', ['/c', batchPath], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
                cwd: os.tmpdir()
            });

            child.on('error', (err) => {
                this.logToFile(`launchWindows: Spawn error: ${err.message}`);
            });

            child.unref();
            this.logToFile(`launchWindows: Batch file spawned successfully`);
        } catch (e) {
            this.logToFile(`launchWindows: Failed to spawn: ${e.message}`);
            return { success: false, error: `Failed to spawn: ${e.message}` };
        }

        // Schedule quit after short delay
        this.logToFile(`launchWindows: Scheduling quit in 1500ms...`);
        setTimeout(() => {
            this.logToFile(`launchWindows: Executing quit command`);
            vscode.commands.executeCommand('workbench.action.quit');
        }, 1500);

        return { success: true, port };
    }

    /**
     * macOS/Linux: Use shell script
     */
    async launchUnix(exePath, port, workspaceFolders) {
        this.logToFile(`launchUnix: Using shell script approach`);

        const scriptPath = path.join(os.tmpdir(), 'relaunch_cursor.sh');
        const folderArgs = workspaceFolders.map(f => `"${f}"`).join(' ');

        const scriptContent = `#!/bin/bash
# Auto Accept Agent - Cursor Relaunch Script
LOG_FILE="/tmp/auto_accept_launch.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"; }

log "=== Shell script started ==="
log "Waiting 3 seconds..."
sleep 3

log "Launching Cursor with CDP on port ${port}..."
log "Exe: ${exePath}"
log "Folders: ${folderArgs || '(none)'}"

"${exePath}" --remote-debugging-port=${port} ${folderArgs} >> "$LOG_FILE" 2>&1 &
PID=$!

log "Cursor launched with PID: $PID"
log "=== Shell script complete ==="
`;

        try {
            fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
            this.logToFile(`launchUnix: Script written to ${scriptPath}`);
        } catch (e) {
            return { success: false, error: `Failed to write script: ${e.message}` };
        }

        try {
            const child = spawn('/bin/bash', [scriptPath], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            this.logToFile(`launchUnix: Script spawned`);
        } catch (e) {
            return { success: false, error: `Failed to spawn: ${e.message}` };
        }

        setTimeout(() => {
            vscode.commands.executeCommand('workbench.action.quit');
        }, 1500);

        return { success: true, port };
    }

    /**
     * One-time setup: Modify Windows shortcuts to include CDP flag
     */
    async setupCDPShortcuts() {
        if (this.platform !== 'win32') {
            this.log('setupCDPShortcuts: Only Windows supported for automatic setup');
            return { success: false, error: 'Manual setup required on macOS/Linux' };
        }

        this.log('setupCDPShortcuts: Starting Windows shortcut modification');

        const shortcuts = [
            // Start Menu shortcut
            path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Cursor', 'Cursor.lnk'),
            // Desktop shortcut (if exists)
            path.join(process.env.USERPROFILE || '', 'Desktop', 'Cursor.lnk')
        ];

        let modified = 0;
        const results = [];

        for (const shortcutPath of shortcuts) {
            if (!fs.existsSync(shortcutPath)) {
                this.log(`setupCDPShortcuts: Shortcut not found: ${shortcutPath}`);
                continue;
            }

            try {
                // PowerShell command to modify shortcut
                const psCommand = `
                    $shell = New-Object -ComObject WScript.Shell
                    $shortcut = $shell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
                    if ($shortcut.Arguments -notlike '*--remote-debugging-port*') {
                        $shortcut.Arguments = '${CDP_FLAG} ' + $shortcut.Arguments
                        $shortcut.Save()
                        Write-Output 'MODIFIED'
                    } else {
                        Write-Output 'ALREADY_SET'
                    }
                `.trim();

                const result = execSync(`powershell -Command "${psCommand}"`, { encoding: 'utf8' }).trim();

                if (result === 'MODIFIED') {
                    this.log(`setupCDPShortcuts: Modified ${shortcutPath}`);
                    modified++;
                    results.push({ path: shortcutPath, status: 'modified' });
                } else {
                    this.log(`setupCDPShortcuts: Already configured: ${shortcutPath}`);
                    results.push({ path: shortcutPath, status: 'already_set' });
                }
            } catch (e) {
                this.log(`setupCDPShortcuts: Error modifying ${shortcutPath}: ${e.message}`);
                results.push({ path: shortcutPath, status: 'error', error: e.message });
            }
        }

        return { success: true, modified, results };
    }

    /**
     * Show setup prompt to user (one-time configuration)
     */
    async showSetupPrompt() {
        this.log('showSetupPrompt: Displaying setup dialog');

        const choice = await vscode.window.showInformationMessage(
            'Auto Accept needs a quick one-time setup to enable background mode. This only takes a few seconds.',
            { modal: true },
            'Setup Now',
            'Not Now'
        );

        this.log(`showSetupPrompt: User chose: ${choice}`);

        if (choice === 'Setup Now') {
            const result = await this.setupCDPShortcuts();

            if (result.success && result.modified > 0) {
                vscode.window.showInformationMessage(
                    '✅ Setup complete! Please close Cursor and reopen it from the Start Menu to activate background mode.'
                );
                return 'setup_complete';
            } else if (result.success && result.modified === 0) {
                vscode.window.showInformationMessage(
                    'Already set up! Just close and reopen Cursor from the Start Menu.'
                );
                return 'already_configured';
            } else {
                vscode.window.showErrorMessage(`Setup failed: ${result.error}`);
                return 'failed';
            }
        }

        return 'cancelled';
    }


    /**
     * Legacy relaunch prompt (kept for compatibility)
     */
    async showLaunchPrompt() {
        // Now redirects to setup prompt
        return await this.showSetupPrompt();
    }

    getLogFilePath() {
        return this.logFile;
    }
}

module.exports = { CursorLauncher, BASE_CDP_PORT };
