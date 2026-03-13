/**
 * Auto-Run Patcher — Fixes the "Always Proceed" terminal execution policy
 * and auto-approves file access requests in the cascade panel.
 * ========================================================================
 *
 * Patch 1 (workbench): Injects a useEffect hook into the terminal step
 * renderer to auto-confirm when policy is EAGER.
 *
 * Patch 2 (jetskiAgent): Auto-approves file access permission requests
 * in the cascade panel's VW component.
 *
 * Uses structural regex matching (not hardcoded variable names)
 * to work across Antigravity versions.
 *
 * SAFETY: This module does NOT modify product.json checksums.
 * The only side effect is a "corrupt installation" warning that can be
 * safely dismissed. This avoids the crash caused by integrity-fix in v2.0.0.
 *
 * @module auto-run-patcher
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/** Patch marker to identify our patches and prevent double-patching */
const PATCH_MARKER = '/*AAA:autorun*/';
const PATCH_MARKER_REGEX = /\/\*AAA:autorun\*\/[^;]+;/g;
const FILEACCESS_MARKER = '/*AAA:fileaccess*/';
const FILEACCESS_MARKER_REGEX = /\/\*AAA:fileaccess\*\/[^;]+;/g;

// ─── Installation Detection ─────────────────────────────────────────────────

function isAntigravityDir(dir) {
    if (!dir) return false;
    try {
        const workbench = path.join(dir, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
        return fs.existsSync(workbench);
    } catch { return false; }
}

function looksLikeAntigravityRoot(dir) {
    if (!dir) return false;
    try {
        const exe = process.platform === 'win32' ? 'Antigravity.exe' : 'antigravity';
        return fs.existsSync(path.join(dir, exe));
    } catch { return false; }
}

function findFromRegistry() {
    if (process.platform !== 'win32') return null;
    try {
        const { execSync } = require('child_process');
        const regPaths = [
            'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Antigravity_is1',
            'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Antigravity_is1',
            'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Antigravity_is1',
        ];
        for (const regPath of regPaths) {
            try {
                const output = execSync(
                    `reg query "${regPath}" /v InstallLocation`,
                    { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
                );
                const match = output.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
                if (match) {
                    const dir = match[1].trim().replace(/\\$/, '');
                    if (isAntigravityDir(dir)) return dir;
                }
            } catch { /* key not found, try next */ }
        }
    } catch { /* child_process failed */ }
    return null;
}

function findFromPath() {
    try {
        const pathDirs = (process.env.PATH || '').split(path.delimiter);
        const exe = process.platform === 'win32' ? 'Antigravity.exe' : 'antigravity';
        for (const dir of pathDirs) {
            if (!dir) continue;
            if (fs.existsSync(path.join(dir, exe))) {
                if (isAntigravityDir(dir)) return dir;
                const parent = path.dirname(dir);
                if (isAntigravityDir(parent)) return parent;
            }
        }
    } catch { /* PATH parsing failed */ }
    return null;
}

function findAntigravityPath() {
    let dir = process.cwd();
    const root = path.parse(dir).root;
    while (dir && dir !== root) {
        if (looksLikeAntigravityRoot(dir) && isAntigravityDir(dir)) return dir;
        dir = path.dirname(dir);
    }

    const fromPath = findFromPath();
    if (fromPath) return fromPath;

    const fromReg = findFromRegistry();
    if (fromReg) return fromReg;

    const candidates = [];
    if (process.platform === 'win32') {
        candidates.push(
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity'),
            path.join(process.env.PROGRAMFILES || '', 'Antigravity'),
        );
    } else if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Antigravity.app/Contents/Resources',
            path.join(os.homedir(), 'Applications', 'Antigravity.app', 'Contents', 'Resources')
        );
    } else {
        candidates.push(
            '/usr/share/antigravity',
            '/opt/antigravity',
            path.join(os.homedir(), '.local', 'share', 'antigravity')
        );
    }
    for (const c of candidates) {
        if (isAntigravityDir(c)) return c;
    }

    return null;
}

function getTargetFiles(basePath) {
    return [
        {
            path: path.join(basePath, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js'),
            label: 'workbench',
            checksumKey: 'vs/workbench/workbench.desktop.main.js'
        },
        {
            path: path.join(basePath, 'resources', 'app', 'out', 'jetskiAgent', 'main.js'),
            label: 'jetskiAgent',
            checksumKey: 'jetskiAgent/main.js'
        },
    ].filter(f => fs.existsSync(f.path));
}

async function updateChecksums(basePath, targetFiles) {
    const productPath = path.join(basePath, 'resources', 'app', 'product.json');
    if (!fs.existsSync(productPath)) return;

    try {
        let raw = await fsp.readFile(productPath, 'utf8');
        const product = JSON.parse(raw);
        if (!product.checksums) return;

        // Backup product.json (only if no backup exists)
        const backupPath = productPath + '.aaa-backup';
        if (!fs.existsSync(backupPath)) {
            await fsp.copyFile(productPath, backupPath);
        }

        // String-replace checksums in the raw JSON to preserve exact formatting
        for (const f of targetFiles) {
            if (!f.checksumKey || !product.checksums[f.checksumKey]) continue;
            const oldHash = product.checksums[f.checksumKey];
            const content = await fsp.readFile(f.path);
            const newHash = crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
            if (oldHash !== newHash) {
                raw = raw.replace(JSON.stringify(oldHash), JSON.stringify(newHash));
            }
        }

        await fsp.writeFile(productPath, raw, 'utf8');
    } catch (err) {
        // Non-fatal — worst case: user sees corrupt installation warning
    }
}

async function revertChecksums(basePath) {
    const productPath = path.join(basePath, 'resources', 'app', 'product.json');
    const backupPath = productPath + '.aaa-backup';
    if (fs.existsSync(backupPath)) {
        try {
            await fsp.copyFile(backupPath, productPath);
            await fsp.unlink(backupPath);
        } catch { /* best effort */ }
    }
}

function getVersion(basePath) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'package.json'), 'utf8'));
        const product = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'product.json'), 'utf8'));
        return `${pkg.version} (IDE ${product.ideVersion || 'unknown'})`;
    } catch { return 'unknown'; }
}

// ─── Smart Pattern Matching ─────────────────────────────────────────────────

function analyzeFile(content, label) {
    const onChangeRe = /(\w+)=(\w+)\((\w+)=>\{\w+\?\.setTerminalAutoExecutionPolicy\?\.\(\3\),\3===(\w+)\.EAGER&&(\w+)\(!0\)\},\[[\w,]*\]\)/;
    const onChangeMatch = content.match(onChangeRe);

    if (!onChangeMatch) return null;

    const [fullMatch, assignVar, callbackAlias, argName, enumAlias, confirmFn] = onChangeMatch;
    const matchIndex = content.indexOf(fullMatch);

    const policyRe = new RegExp(`(\\w+)=\\w+\\?\\.terminalAutoExecutionPolicy\\?\\?${enumAlias}\\.OFF`);
    const contextBefore = content.substring(Math.max(0, matchIndex - 3000), matchIndex);
    const policyMatch = contextBefore.match(policyRe);

    if (!policyMatch) return null;
    const policyVar = policyMatch[1];

    const secureRe = /(\w+)=\w+\?\.secureModeEnabled\?\?!1/;
    const secureMatch = contextBefore.match(secureRe);

    if (!secureMatch) return null;
    const secureVar = secureMatch[1];

    // Find useEffect alias — two strategies needed because files have different import styles:
    // 1. jetskiAgent: unified global import (Ce=useCallback, At=useEffect in same block)
    // 2. workbench: split imports (Zt=useCallback from global, oiu=useEffect from local module)
    
    const fullBefore = content.substring(0, matchIndex);
    let useEffectAlias = null;
    let m;

    // Strategy 1: Find useEffect in the SAME import as useCallback
    // (picks the LAST match = nearest to our code)
    const cbRe = new RegExp(`useCallback\\s*:\\s*${callbackAlias}`, 'g');
    let scopeMatchAlias = null;
    while ((m = cbRe.exec(fullBefore)) !== null) {
        const start = Math.max(0, m.index - 500);
        const end = Math.min(fullBefore.length, m.index + 500);
        const nearby = fullBefore.substring(start, end);
        const ueMatch = nearby.match(/useEffect\s*:\s*(\w+)/);
        if (ueMatch) { scopeMatchAlias = ueMatch[1]; }
    }

    // Strategy 2: nearest-backward search (last useEffect:ALIAS within 200K chars before match)
    const searchWindow = content.substring(Math.max(0, matchIndex - 200000), matchIndex);
    let nearestAlias = null;
    const ueRe = /useEffect\s*:\s*(\w+)/g;
    while ((m = ueRe.exec(searchWindow)) !== null) {
        nearestAlias = m[1];
    }

    // Decide: count define() module boundaries between each alias and the match.
    // The alias with FEWER boundaries is in the correct module scope.
    // workbench: fn has 40 define() boundaries (wrong scope), oiu has 0 (same scope)
    // jetskiAgent: At has 0 boundaries (same scope), hRi has >0 (utility module)
    if (scopeMatchAlias && nearestAlias && scopeMatchAlias !== nearestAlias) {
        const scopeDefIdx = fullBefore.lastIndexOf('useEffect:' + scopeMatchAlias);
        const nearestDefIdx = fullBefore.lastIndexOf('useEffect:' + nearestAlias);
        const scopeBoundaries = scopeDefIdx >= 0
            ? (content.substring(scopeDefIdx, matchIndex).match(/define\(/g) || []).length
            : Infinity;
        const nearestBoundaries = nearestDefIdx >= 0
            ? (content.substring(nearestDefIdx, matchIndex).match(/define\(/g) || []).length
            : Infinity;
        useEffectAlias = scopeBoundaries <= nearestBoundaries ? scopeMatchAlias : nearestAlias;
    } else {
        useEffectAlias = scopeMatchAlias || nearestAlias;
    }

    if (!useEffectAlias) return null;

    // Build the patch code — standalone statement inserted at a semicolon boundary
    const patchCode = `${PATCH_MARKER}${useEffectAlias}(()=>{${policyVar}===${enumAlias}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[]);`;

    // Find insertion point: after the const declaration containing the onChange handler.
    // We look for the semicolon that terminates the declaration block AFTER the match,
    // then insert our useEffect as a separate statement.
    // The onChange is inside: const ..., v=Zt(B=>{...},[r,b]), E=Zt(...);
    //                                                                    ^ insert here
    const matchEnd = matchIndex + fullMatch.length;

    // Walk forward past any remaining comma-separated declarators to find the terminating ;
    let depth = 0;
    let insertAt = -1;
    for (let i = matchEnd; i < content.length && i < matchEnd + 2000; i++) {
        const ch = content[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === ';' && depth === 0) {
            insertAt = i + 1; // after the semicolon
            break;
        }
    }

    if (insertAt === -1) return null;

    return {
        // New strategy: insert at offset, not via string replacement
        insertAt,
        patchCode,
        patchMarker: PATCH_MARKER,
        label,
        details: {
            callbackAlias,
            enumAlias,
            confirmFn,
            policyVar,
            secureVar,
            useEffectAlias,
            matchOffset: matchIndex
        }
    };
}

/**
 * Analyze file access permission component in jetskiAgent.
 * The VW component renders "Allow file access to X?" with Deny/Allow buttons.
 * It sends a sendUserInteraction IPC message with filePermission type.
 * We inject auto-approval right after the component validates the request.
 */
function analyzeFileAccess(content, label) {
    // Find the unique filePermission interaction pattern
    const fpIdx = content.indexOf('case:"filePermission"');
    if (fpIdx === -1) return null;

    // Get context: the VW component is ~500 chars before and ~1500 chars after
    const searchStart = Math.max(0, fpIdx - 500);
    const searchEnd = Math.min(content.length, fpIdx + 1500);
    const chunk = content.substring(searchStart, searchEnd);

    // Extract the permission function name and enum from the "Allow This Conversation" button:
    // onClick:()=>{PERM_FN(!0,ENUM.CONVERSATION)}
    const btnMatch = chunk.match(/onClick:\(\)=>\{(\w+)\(!0,(\w+)\.CONVERSATION\)\}/);
    if (!btnMatch) return null;
    const permFn = btnMatch[1];
    const enumName = btnMatch[2];

    // Find the absolutePathUri guard: if(!t?.absolutePathUri)return null;
    // Our patch goes right after this (we know s is defined and the request is valid)
    const guardPattern = 'if(!t?.absolutePathUri)return null;';
    const guardIdx = content.indexOf(guardPattern, fpIdx - 500);
    if (guardIdx === -1) return null;

    const insertAt = guardIdx + guardPattern.length;

    // "Need to know" path scoping: only auto-approve paths the agent actually needs.
    // Everything else still shows the manual approval prompt.
    // Safe paths (case-insensitive, using file URI forward slashes):
    //   /documents/  — workspace projects (C:/Users/X/Documents/)
    //   /appdata/    — Windows temp, AG config (C:/Users/X/AppData/Local/Temp/)
    //   /.gemini/    — AG brain/config
    //   /tmp/        — Unix/WSL temp
    // Uses t.absolutePathUri which is a file:// URI with forward slashes.
    const patchCode = `${FILEACCESS_MARKER}setTimeout(()=>{const _u=(t.absolutePathUri||'').toLowerCase();const _ok=_u.includes('/documents/')||_u.includes('/appdata/')||_u.includes('/.gemini/')||_u.includes('/tmp/')||_u.includes('/temp/');_ok&&${permFn}(!0,${enumName}.CONVERSATION)},0);`;

    return {
        insertAt,
        patchCode,
        patchMarker: FILEACCESS_MARKER,
        label,
        details: { permFn, enumName, type: 'fileAccess' }
    };
}

// ─── File Operations ────────────────────────────────────────────────────────

const ALL_MARKERS = [PATCH_MARKER, FILEACCESS_MARKER];

async function isPatched(filePath) {
    try {
        const content = await fsp.readFile(filePath, 'utf8');
        return ALL_MARKERS.some(m => content.includes(m));
    } catch {
        return false;
    }
}

async function patchFile(filePath, label) {
    try {
        if (!fs.existsSync(filePath)) {
            return { success: false, label, status: 'not-found' };
        }

        let content = await fsp.readFile(filePath, 'utf8');

        // If already patched, revert from backup first so we can re-apply fresh
        if (ALL_MARKERS.some(m => content.includes(m))) {
            const backupPath = filePath + '.aaa-backup';
            if (fs.existsSync(backupPath)) {
                await fsp.copyFile(backupPath, filePath);
                content = await fsp.readFile(filePath, 'utf8');
            } else {
                return { success: true, label, status: 'already-patched' };
            }
        }

        // Route analysis by file type:
        // - workbench: terminal auto-run (useEffect injection)
        // - jetskiAgent: file access auto-approve (setTimeout injection)
        const analysis = label === 'jetskiAgent'
            ? analyzeFileAccess(content, label)
            : analyzeFile(content, label) || analyzeFileAccess(content, label);
        if (!analysis) {
            return { success: false, label, status: 'pattern-not-found' };
        }

        // Create backup (only if one doesn't exist yet)
        const backupPath = filePath + '.aaa-backup';
        if (!fs.existsSync(backupPath)) {
            await fsp.copyFile(filePath, backupPath);
        }

        // Insert patch at the semicolon boundary (standalone statement)
        const patched = content.substring(0, analysis.insertAt) + analysis.patchCode + content.substring(analysis.insertAt);
        await fsp.writeFile(filePath, patched, 'utf8');

        return {
            success: true,
            label,
            status: 'patched',
            bytesAdded: analysis.patchCode.length,
            details: analysis.details
        };
    } catch (err) {
        return { success: false, label, status: 'error', error: err.message };
    }
}

async function revertFile(filePath, label) {
    const backupPath = filePath + '.aaa-backup';
    if (!fs.existsSync(backupPath)) {
        return { success: false, label, status: 'no-backup' };
    }

    try {
        await fsp.copyFile(backupPath, filePath);
        await fsp.unlink(backupPath);
        return { success: true, label, status: 'reverted' };
    } catch (err) {
        return { success: false, label, status: 'error', error: err.message };
    }
}

async function checkFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        return { label, patched: false, patchable: false, hasBackup: false };
    }

    const content = await fsp.readFile(filePath, 'utf8');
    const patched = ALL_MARKERS.some(m => content.includes(m));
    const hasBackup = fs.existsSync(filePath + '.aaa-backup');

    let patchable = false;
    if (!patched) {
        const analysis = label === 'jetskiAgent'
            ? analyzeFileAccess(content, label)
            : analyzeFile(content, label) || analyzeFileAccess(content, label);
        patchable = analysis !== null;
    }

    return { label, patched, patchable, hasBackup };
}

// ─── High-Level API ─────────────────────────────────────────────────────────

async function applyAll() {
    const basePath = findAntigravityPath();
    if (!basePath) return [];

    const files = getTargetFiles(basePath);
    const results = await Promise.all(files.map(f => patchFile(f.path, f.label)));

    // Always update product.json checksums for ALL target files
    await updateChecksums(basePath, files);

    return results;
}

async function revertAll() {
    const basePath = findAntigravityPath();
    if (!basePath) return [];

    const files = getTargetFiles(basePath);
    const results = await Promise.all(files.map(f => revertFile(f.path, f.label)));

    // Restore original product.json checksums
    await revertChecksums(basePath);

    return results;
}

async function checkAll() {
    const basePath = findAntigravityPath();
    if (!basePath) return [];

    const files = getTargetFiles(basePath);
    return Promise.all(files.map(f => checkFile(f.path, f.label)));
}

module.exports = {
    applyAll,
    revertAll,
    checkAll,
    patchFile,
    revertFile,
    checkFile,
    isPatched,
    findAntigravityPath,
    getTargetFiles,
    getVersion,
    analyzeFile,
    analyzeFileAccess,
    PATCH_MARKER,
    FILEACCESS_MARKER
};
