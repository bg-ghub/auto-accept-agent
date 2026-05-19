/**
 * Auto-Run Patcher — Fixes the "Always Proceed" terminal execution policy
 * and auto-approves file access requests in the cascade panel.
 * ========================================================================
 *
 * Supports TWO architectures:
 *   - Legacy (AG v1.x): VS Code fork with loose JS files under resources/app/out/
 *   - Modern (AG v2.0): Standalone Electron app with app.asar + Go language_server
 *
 * Patch 1 (workbench): Injects a useEffect hook into the terminal step
 * renderer to auto-confirm when policy is EAGER. (Legacy only)
 *
 * Patch 2 (jetskiAgent): Auto-approves file access permission requests
 * in the cascade panel's VW component. (Legacy only)
 *
 * For AG 2.0: Terminal policy is handled server-side by the Go binary.
 * The patcher detects 2.0 and reports the architecture. Source-level
 * patching is not applicable — the polling fallback handles it.
 *
 * Uses structural regex matching (not hardcoded variable names)
 * to work across Antigravity versions.
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
const AUTOEXPAND_MARKER = '/*AAA:autoexpand*/';
const AUTOSCROLL_MARKER = '/*AAA:autoscroll*/';

// ─── Architecture Detection ────────────────────────────────────────────────

/** Architecture types */
const ARCH_LEGACY = 'legacy';   // AG v1.x — VS Code fork, loose files
const ARCH_MODERN = 'modern';   // AG v2.0 — Standalone Electron + Go LS
const ARCH_UNKNOWN = 'unknown';

/**
 * Detect which architecture an Antigravity installation uses.
 * @param {string} dir - Candidate installation directory
 * @returns {string} ARCH_LEGACY, ARCH_MODERN, or ARCH_UNKNOWN
 */
function detectArchitecture(dir) {
    if (!dir) return ARCH_UNKNOWN;
    try {
        // Legacy: has resources/app/out/vs/workbench/workbench.desktop.main.js
        const workbench = path.join(dir, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
        if (fs.existsSync(workbench)) return ARCH_LEGACY;

        // Modern: has resources/app.asar + resources/bin/language_server.exe
        const asar = path.join(dir, 'resources', 'app.asar');
        const ls = path.join(dir, 'resources', 'bin',
            process.platform === 'win32' ? 'language_server.exe' : 'language_server');
        if (fs.existsSync(asar) && fs.existsSync(ls)) return ARCH_MODERN;

        // Modern fallback: has app.asar but no language_server (partial install)
        if (fs.existsSync(asar)) return ARCH_MODERN;

        return ARCH_UNKNOWN;
    } catch { return ARCH_UNKNOWN; }
}

/**
 * Check if a directory is a valid Antigravity installation (any architecture).
 */
function isAntigravityDir(dir) {
    return detectArchitecture(dir) !== ARCH_UNKNOWN;
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
                    { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
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

let _cachedAgPath = null;

function findAntigravityPath() {
    if (_cachedAgPath) return _cachedAgPath;
    
    let dir = process.cwd();
    const root = path.parse(dir).root;
    while (dir && dir !== root) {
        if (looksLikeAntigravityRoot(dir) && isAntigravityDir(dir)) { _cachedAgPath = dir; return dir; }
        dir = path.dirname(dir);
    }

    const fromPath = findFromPath();
    if (fromPath) { _cachedAgPath = fromPath; return fromPath; }

    const fromReg = findFromRegistry();
    if (fromReg) { _cachedAgPath = fromReg; return fromReg; }

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
        if (isAntigravityDir(c)) { _cachedAgPath = c; return c; }
    }

    return null;
}

function getTargetFiles(basePath) {
    const arch = detectArchitecture(basePath);

    if (arch === ARCH_MODERN) {
        // AG 2.0: No patchable loose JS files — terminal policy is in the Go binary.
        // Return empty array; the extension will use polling fallback.
        return [];
    }

    // Legacy: VS Code fork with loose files
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
        {
            path: path.join(basePath, 'resources', 'app', 'out', 'main.js'),
            label: 'mainRenderer',
            checksumKey: 'main.js'
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

/**
 * Get version info. Supports both architectures:
 * - Legacy: reads resources/app/package.json + product.json
 * - Modern: reads package.json from app.asar
 */
function getVersion(basePath) {
    const arch = detectArchitecture(basePath);

    if (arch === ARCH_MODERN) {
        try {
            // Read from ASAR without requiring @electron/asar
            // The Electron runtime can read ASAR files natively via require
            const asarPath = path.join(basePath, 'resources', 'app.asar');
            // Try native ASAR reading (works inside Electron)
            const pkgPath = path.join(asarPath, 'package.json');
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                return `${pkg.version} (standalone)`;
            }
        } catch { /* fall through */ }
        return '2.0+ (standalone)';
    }

    // Legacy
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'package.json'), 'utf8'));
        const product = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'product.json'), 'utf8'));
        return `${pkg.version} (IDE ${product.ideVersion || 'unknown'})`;
    } catch { return 'unknown'; }
}

// ─── Smart Pattern Matching ─────────────────────────────────────────────────

function analyzeFile(content, label) {
    // Strategy 1 (AG ≤1.21): Simple onChange handler
    //   B=Zt(Q=>{l?.setTerminalAutoExecutionPolicy?.(Q),Q===Qx.EAGER&&L(!0)},[...])
    const onChangeReV1 = /([\w$]+)=([\w$]+)\(([\w$]+)=>\{[\w$]+\?\.setTerminalAutoExecutionPolicy\?\.\(\3\),\3===([\w$]+)\.EAGER&&([\w$]+)\(!0\)\},\[([\w$,]*)\]\)/;

    // Strategy 2 (AG ≥1.22): Conditional with Cider/internet warning
    //   B=et(Q=>{if(Q!==Qx.EAGER||f!=="Cider"||...){l?.setTerminalAutoExecutionPolicy?.(Q),Q===Qx.EAGER&&L(!0);return}...},[...])
    const onChangeReV2 = /([\w$]+)=([\w$]+)\(([\w$]+)=>\{if\(\3!==([\w$]+)\.EAGER[^)]*\)\{[\w$]+\?\.setTerminalAutoExecutionPolicy\?\.\(\3\),\3===\4\.EAGER&&([\w$]+)\(!0\);return\}/;

    let onChangeMatch = content.match(onChangeReV1);
    let version = 'v1';
    if (!onChangeMatch) {
        onChangeMatch = content.match(onChangeReV2);
        version = 'v2';
    }
    if (!onChangeMatch) return null;

    const fullMatch = onChangeMatch[0];
    const callbackAlias = onChangeMatch[2];
    const enumAlias = onChangeMatch[4];
    const confirmFn = onChangeMatch[5];
    const matchIndex = content.indexOf(fullMatch);

    const policyRe = new RegExp(`([\\w$]+)=[^;]*\\.terminalAutoExecutionPolicy(?:\\?\\?|\\|\\|)${enumAlias.replace(/\$/g, '\\$')}\\.OFF`);
    const contextBefore = content.substring(Math.max(0, matchIndex - 3000), matchIndex);
    const policyMatch = contextBefore.match(policyRe);

    if (!policyMatch) return null;
    const policyVar = policyMatch[1];

    const secureRe = /([\w$]+)=[\w$]+\?\.secureModeEnabled\?\?!1/;
    const secureMatch = contextBefore.match(secureRe);

    if (!secureMatch) return null;
    const secureVar = secureMatch[1];

    // Find useEffect alias — three strategies:
    const fullBefore = content.substring(0, matchIndex);
    let useEffectAlias = null;
    let m;

    // Strategy 1: useEffect:ALIAS in same import block as useCallback
    const cbRe = new RegExp(`useCallback\\s*:\\s*${callbackAlias}`, 'g');
    let scopeMatchAlias = null;
    while ((m = cbRe.exec(fullBefore)) !== null) {
        const start = Math.max(0, m.index - 500);
        const end = Math.min(fullBefore.length, m.index + 500);
        const nearby = fullBefore.substring(start, end);
        const ueMatch = nearby.match(/useEffect\s*:\s*(\w+)/);
        if (ueMatch) { scopeMatchAlias = ueMatch[1]; }
    }

    // Strategy 2: nearest-backward search (last useEffect:ALIAS within 200K chars)
    const searchWindow = content.substring(Math.max(0, matchIndex - 200000), matchIndex);
    let nearestAlias = null;
    const ueRe = /useEffect\s*:\s*(\w+)/g;
    while ((m = ueRe.exec(searchWindow)) !== null) {
        nearestAlias = m[1];
    }

    // Strategy 3 (AG ≥1.22): useEffect not in import maps. Detect from usage:
    // After the match, find hook calls ALIAS(()=>{...},[deps]) that are NOT
    // the useCallback alias (et) or useMemo-like (returns values).
    if (!scopeMatchAlias && !nearestAlias) {
        const afterMatch = content.substring(matchIndex, Math.min(content.length, matchIndex + 5000));
        const hookCallRe = /\b(\w{1,4})\(\(\)=>\{[^}]*\},\[/g;
        const hookNames = new Set();
        while ((m = hookCallRe.exec(afterMatch)) !== null) {
            if (m[1] !== callbackAlias) hookNames.add(m[1]);
        }
        // Filter out useMemo candidates (kt-like: return values in callback)
        for (const name of hookNames) {
            const usages = afterMatch.match(new RegExp(`\\b${name}\\(\\(\\)=>[^)]{0,500}`, 'g')) || [];
            const looksLikeMemo = usages.some(u => /return[\s{[\[]/.test(u));
            if (!looksLikeMemo) {
                nearestAlias = name;
                break;
            }
        }
        // Fallback: just take the first non-callback hook
        if (!nearestAlias && hookNames.size > 0) {
            nearestAlias = hookNames.values().next().value;
        }
    }

    // Decide between scope-match vs nearest using module boundary counting
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

    // Build the patch code
    const patchCode = `${PATCH_MARKER}${useEffectAlias}(()=>{${policyVar}===${enumAlias}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[]);`;

    // Find insertion point
    const matchEnd = matchIndex + fullMatch.length;
    let depth = 0;
    let insertAt = -1;
    for (let i = matchEnd; i < content.length && i < matchEnd + 2000; i++) {
        const ch = content[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === ';' && depth === 0) {
            insertAt = i + 1;
            break;
        }
    }

    if (insertAt === -1) return null;

    return {
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
            matchOffset: matchIndex,
            version
        }
    };
}

/**
 * Analyze file access permission component in jetskiAgent.
 *
 * The VW component renders "Allow file access to X?" with Deny/Allow buttons.
 * No VS Code command exists for this — it's a React component inside the
 * jetskiAgent webview, so source-level patching is required.
 *
 * Patch strategy (synchronous):
 *   After the component's guard check, we inject a synchronous IIFE that:
 *   1. Normalizes backslashes to forward slashes (Windows paths)
 *   2. Checks against the allow-list
 *   3. If approved: calls the permission function and returns null (no UI)
 *   4. If not approved: falls through to the normal approval prompt
 *
 * Debug output visible via: Ctrl+Shift+P → "toggleManagerDevTools" → Console
 */
function analyzeFileAccess(content, label, options) {
    // Find the unique filePermission interaction pattern
    const fpIdx = content.indexOf('case:"filePermission"');
    if (fpIdx === -1) return null;

    // Get context: the VW component is ~500 chars before and ~4500 chars after
    const searchStart = Math.max(0, fpIdx - 500);
    const searchEnd = Math.min(content.length, fpIdx + 4500);
    const chunk = content.substring(searchStart, searchEnd);

    // Extract the permission function name and enum from the "Allow This Conversation" button:
    // onClick:()=>{PERM_FN(!0,ENUM.CONVERSATION)}
    const btnMatch = chunk.match(/onClick:\(\)=>\{([\w$]+)\(!0,([\w$]+)\.CONVERSATION\)\}/);
    if (!btnMatch) return null;
    const permFn = btnMatch[1];
    const enumName = btnMatch[2];

    // Find the absolutePathUri guard: if(!VAR?.absolutePathUri)return null;
    // Variable name varies between files (t, e, etc.) so we use a regex
    const guardRegex = /if\(![\w$]+\?\.absolutePathUri\)return null;/;
    const guardMatch = content.substring(Math.max(0, fpIdx - 500)).match(guardRegex);
    if (!guardMatch) return null;
    const guardIdx = content.indexOf(guardMatch[0], Math.max(0, fpIdx - 500));
    if (guardIdx === -1) return null;

    const insertAt = guardIdx + guardMatch[0].length;

    // Extract request variable name from the guard (e.g., 't' from 'if(!t?.absolutePathUri)')
    const reqVarMatch = guardMatch[0].match(/!\(?([\w$]+)\?/);
    const reqVar = reqVarMatch ? reqVarMatch[1] : 't';

    // Auto-approve file access for user-owned paths.
    // Normalizes Windows backslashes to forward slashes via String.fromCharCode(92,92).
    // Allow-list: /users/ (Win home), /home/ (Linux/Mac), /tmp/, /temp/
    // Anything else (C:\Windows, C:\Program Files, etc.) falls through to manual prompt.
    let patchCode;
    if (options?.allowAll) {
        // Allow-all mode: no path check, approve everything
        patchCode = `${FILEACCESS_MARKER}setTimeout(()=>${permFn}(!0,${enumName}.CONVERSATION),0);return null;`;
    } else {
        // Allow-list mode: check path before approving, return null to hide prompt UI
        patchCode = `${FILEACCESS_MARKER}if(((_p)=>{const _n=_p.replace(new RegExp(String.fromCharCode(92,92),'g'),'/').toLowerCase();return _n.includes('/users/')||_n.includes('/home/')||_n.includes('/tmp/')||_n.includes('/temp/')})(${reqVar}?.absolutePathUri||'')){setTimeout(()=>${permFn}(!0,${enumName}.CONVERSATION),0);return null;}`;
    }

    return {
        insertAt,
        patchCode,
        patchMarker: FILEACCESS_MARKER,
        label,
        details: { permFn, enumName, type: 'fileAccess' }
    };
}

/**
 * Patch 3: Auto-expand collapsed "Step Requires Input" banners.
 *
 * The XFi component shows a collapsed banner when steps are WAITING.
 * We inject setTimeout(()=>setExpanded(true), 0) after the length guard
 * so the steps are always visible without manual "Expand" clicks.
 */
function analyzeAutoExpand(content, label) {
    // Find the unique "Step Requires Input" text
    const anchor = 'Requires Input';
    const anchorIdx = content.indexOf(anchor);
    if (anchorIdx === -1) return null;

    // Find the component's setExpanded prop — it's the 5th destructured prop:
    // ({steps:e,trajectoryId:t,debugMode:r,expanded:n,setExpanded:a,...})=>
    // Find the pattern: setExpanded:VAR,  within ~500 chars before anchor
    const chunk = content.substring(Math.max(0, anchorIdx - 2000), anchorIdx);
    const setExpandedMatch = chunk.match(/setExpanded:([\w$]+),/);
    if (!setExpandedMatch) return null;
    const setExpandedVar = setExpandedMatch[1];

    // Find the guard: if(s.length===0)return null;
    // 's' is the filtered WAITING steps array — variable name varies
    const guardRegex = /if\(([\w$]+)\.length===0\)return null;/;
    const guardMatch = content.substring(Math.max(0, anchorIdx - 500), anchorIdx).match(guardRegex);
    if (!guardMatch) return null;
    const guardIdx = content.indexOf(guardMatch[0], Math.max(0, anchorIdx - 500));
    if (guardIdx === -1) return null;

    const insertAt = guardIdx + guardMatch[0].length;
    const patchCode = `${AUTOEXPAND_MARKER}setTimeout(()=>${setExpandedVar}(!0),0);`;

    return {
        insertAt,
        patchCode,
        patchMarker: AUTOEXPAND_MARKER,
        label,
        details: { setExpandedVar, type: 'autoExpand' }
    };
}

/**
 * Patch 5: Force auto-scroll in chat panels.
 *
 * The chat widget uses `autoScroll:n=>n!==ia.Ask` which disables
 * auto-scrolling in Ask mode. This causes the chat to appear
 * stuck (requiring manual scroll to see new content).
 * We replace these with `autoScroll:!0` to force auto-scroll always on.
 */
function analyzeAutoScroll(content, label) {
    // Match the full pattern: autoScroll:VARNAME=>VARNAME!==IDENTIFIER.IDENTIFIER
    // e.g. autoScroll:n=>n!==ia.Ask
    // We must match the entire arrow function expression to avoid leaving
    // dangling tokens (which would cause a syntax error)
    const pattern = /autoScroll:([\w$])=>\1!==[\w$]+\.[\w$]+/g;
    let match;
    const replacements = [];
    while ((match = pattern.exec(content)) !== null) {
        replacements.push({
            start: match.index,
            end: match.index + match[0].length,
            original: match[0]
        });
    }
    if (replacements.length === 0) return null;

    // Apply replacements in reverse order to preserve indices
    let patched = content;
    for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        // Replace with: autoScroll:/*AAA:autoscroll:ORIGINAL*/()=>!0
        // The `:ORIGINAL` suffix preserves the original code for clean revert
        patched = patched.substring(0, r.start) +
            `autoScroll:${AUTOSCROLL_MARKER.slice(0, -2)}:${r.original.substring('autoScroll:'.length)}*/()=>!0` +
            patched.substring(r.end);
    }

    return {
        patchedContent: patched,
        count: replacements.length,
        label,
        details: { count: replacements.length, type: 'autoScroll' }
    };
}

// ─── File Operations ────────────────────────────────────────────────────────

const ALL_MARKERS = [PATCH_MARKER, FILEACCESS_MARKER, AUTOEXPAND_MARKER, AUTOSCROLL_MARKER];

async function isPatched(filePath) {
    try {
        const content = await fsp.readFile(filePath, 'utf8');
        return ALL_MARKERS.some(m => content.includes(m));
    } catch {
        return false;
    }
}

async function patchFile(filePath, label, options) {
    try {
        if (!fs.existsSync(filePath)) {
            return { success: false, label, status: 'not-found' };
        }

        let content = await fsp.readFile(filePath, 'utf8');

        // ALWAYS strip existing patches first, then re-apply fresh.
        // This ensures we always have the latest patch code, even after
        // the patch logic changes between versions.
        content = stripFileaccessPatch(content);

        let totalBytes = 0;
        const applied = [];

        // Apply autorun patch if applicable and not already present
        if (label !== 'jetskiAgent' && !content.includes(PATCH_MARKER)) {
            const analysis = analyzeFile(content, label);
            if (analysis) {
                content = content.substring(0, analysis.insertAt) + analysis.patchCode + content.substring(analysis.insertAt);
                totalBytes += analysis.patchCode.length;
                applied.push('autorun');
            }
        }

        // Apply fileaccess patch (always fresh after stripping above)
        const faAnalysis = analyzeFileAccess(content, label, options);
        if (faAnalysis) {
            content = content.substring(0, faAnalysis.insertAt) + faAnalysis.patchCode + content.substring(faAnalysis.insertAt);
            totalBytes += faAnalysis.patchCode.length;
            applied.push('fileaccess');
        }

        // Apply auto-expand patch (always fresh after stripping above)
        content = stripAutoexpandPatch(content);
        const aeAnalysis = analyzeAutoExpand(content, label);
        if (aeAnalysis) {
            content = content.substring(0, aeAnalysis.insertAt) + aeAnalysis.patchCode + content.substring(aeAnalysis.insertAt);
            totalBytes += aeAnalysis.patchCode.length;
            applied.push('autoexpand');
        }

        // Apply auto-scroll patch (force auto-scroll in chat panels)
        content = stripAutoscrollPatch(content);
        const asAnalysis = analyzeAutoScroll(content, label);
        if (asAnalysis) {
            content = asAnalysis.patchedContent;
            totalBytes += asAnalysis.count * AUTOSCROLL_MARKER.length;
            applied.push('autoscroll');
        }

        if (applied.length === 0) {
            return { success: true, label, status: 'pattern-not-found' };
        }

        await fsp.writeFile(filePath, content, 'utf8');

        return {
            success: true,
            label,
            status: 'patched',
            bytesAdded: totalBytes,
            details: applied.join('+')
        };
    } catch (err) {
        return { success: false, label, status: 'error', error: err.message };
    }
}

/**
 * Strip the fileaccess patch from content.
 * Uses the CONVERSATION terminator as the reliable end-of-patch anchor,
 * handling all format variants (with/without braces, with/without return null).
 *
 * Also strips orphaned stale patches (code left behind when the old strip
 * function only removed the marker but not the code).
 */
function stripFileaccessPatch(content) {
    let c = content;

    // Phase 1: Strip marker + associated code using CONVERSATION anchor
    while (c.includes(FILEACCESS_MARKER)) {
        const idx = c.indexOf(FILEACCESS_MARKER);
        const afterIdx = idx + FILEACCESS_MARKER.length;
        const afterMarker = c.substring(afterIdx, afterIdx + 1000);

        // Find the CONVERSATION),0); terminator — this is present in ALL patch variants
        // that use setTimeout. It's unique enough not to match original code.
        const convMatch = afterMarker.match(/CONVERSATION\),0\);(return null;[}]?)?/);
        if (convMatch) {
            const removeEnd = afterIdx + convMatch.index + convMatch[0].length;
            c = c.substring(0, idx) + c.substring(removeEnd);
            continue;
        }

        // Fallback: try CONVERSATION); for non-setTimeout variants (v4)
        const convSync = afterMarker.match(/CONVERSATION\);(return null;)?/);
        if (convSync) {
            const removeEnd = afterIdx + convSync.index + convSync[0].length;
            c = c.substring(0, idx) + c.substring(removeEnd);
            continue;
        }

        // Last resort: just remove the marker to prevent infinite loop
        c = c.substring(0, idx) + c.substring(afterIdx);
    }

    // Phase 2: Clean up orphaned stale patches (code without marker).
    // These are left when the old broken strip removed only the marker.
    // Orphans are identified by the unique 'String.fromCharCode(92,92)' fingerprint
    // immediately following the 'absolutePathUri)return null;' guard.
    const guardPattern = 'absolutePathUri)return null;';
    let guardSearchPos = 0;
    while (true) {
        const guardIdx = c.indexOf(guardPattern, guardSearchPos);
        if (guardIdx === -1) break;
        const afterGuard = guardIdx + guardPattern.length;

        // Check if what follows the guard is an orphaned patch (starts with 'if(((')
        // and contains our fingerprint
        let orphanEnd = afterGuard;
        let orphansFound = 0;
        while (true) {
            const remaining = c.substring(orphanEnd, orphanEnd + 500);
            if (!remaining.startsWith('if(((') || !remaining.includes('String.fromCharCode(92,92)')) break;

            // Find the end of this orphan: CONVERSATION),0);
            const convEnd = remaining.indexOf('CONVERSATION),0);');
            if (convEnd === -1) break;

            orphanEnd += convEnd + 'CONVERSATION),0);'.length;
            orphansFound++;
        }

        if (orphansFound > 0) {
            c = c.substring(0, afterGuard) + c.substring(orphanEnd);
        }
        guardSearchPos = afterGuard + 1;
    }

    return c;
}

/** Strip autorun marker and code */
function stripAutorunPatch(content) {
    let c = content;
    while (c.includes(PATCH_MARKER)) {
        const idx = c.indexOf(PATCH_MARKER);
        const semi = c.indexOf(';', idx + PATCH_MARKER.length);
        if (semi === -1) break;
        c = c.substring(0, idx) + c.substring(semi + 1);
    }
    return c;
}

/** Strip autoexpand marker and code */
function stripAutoexpandPatch(content) {
    let c = content;
    while (c.includes(AUTOEXPAND_MARKER)) {
        const idx = c.indexOf(AUTOEXPAND_MARKER);
        const semi = c.indexOf(';', idx + AUTOEXPAND_MARKER.length);
        if (semi === -1) break;
        c = c.substring(0, idx) + c.substring(semi + 1);
    }
    return c;
}

/** Strip autoscroll marker and restore original function */
function stripAutoscrollPatch(content) {
    let c = content;
    // New format: autoScroll:/*AAA:autoscroll:ORIGINAL_FN*/()=>!0
    // Restore to: autoScroll:ORIGINAL_FN
    const newPattern = /autoScroll:\/\*AAA:autoscroll:([^*]+)\*\/\(\)=>[!]0/g;
    c = c.replace(newPattern, (match, originalFn) => `autoScroll:${originalFn}`);
    // Legacy format: autoScroll:/*AAA:autoscroll*/()=>!0 (no original preserved)
    // Just remove marker, leaving ()=>!0 (still a valid function)
    while (c.includes(AUTOSCROLL_MARKER)) {
        c = c.replace(AUTOSCROLL_MARKER, '');
    }
    return c;
}

/** Strip all patches (autorun, fileaccess, autoexpand, autoscroll) */
function stripMarkers(content) {
    return stripAutoscrollPatch(stripAutoexpandPatch(stripAutorunPatch(stripFileaccessPatch(content))));
}

async function revertFile(filePath, label) {
    const backupPath = filePath + '.aaa-backup';

    // Strategy 1: Restore from backup if available
    if (fs.existsSync(backupPath)) {
        try {
            await fsp.copyFile(backupPath, filePath);
            await fsp.unlink(backupPath);
            return { success: true, label, status: 'reverted', method: 'backup' };
        } catch (err) {
            // Fall through to in-place strip
        }
    }

    // Strategy 2: Strip patches in-place (always works, no backup needed)
    try {
        if (!fs.existsSync(filePath)) {
            return { success: false, label, status: 'not-found' };
        }
        let content = await fsp.readFile(filePath, 'utf8');
        const hadPatches = ALL_MARKERS.some(m => content.includes(m));
        if (!hadPatches) {
            return { success: true, label, status: 'already-clean' };
        }
        content = stripMarkers(content);
        await fsp.writeFile(filePath, content, 'utf8');
        return { success: true, label, status: 'reverted', method: 'strip' };
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

async function applyAll(options) {
    const basePath = findAntigravityPath();
    if (!basePath) return [];

    const files = getTargetFiles(basePath);
    const results = await Promise.all(files.map(f => patchFile(f.path, f.label, options)));

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
    detectArchitecture,
    analyzeFile,
    analyzeFileAccess,
    PATCH_MARKER,
    FILEACCESS_MARKER,
    ARCH_LEGACY,
    ARCH_MODERN,
    ARCH_UNKNOWN
};
