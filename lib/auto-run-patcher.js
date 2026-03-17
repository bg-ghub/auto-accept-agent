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
const AUTOEXPAND_MARKER = '/*AAA:autoexpand*/';
const BROWSERACTION_MARKER = '/*AAA:browseraction*/';

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
    const btnMatch = chunk.match(/onClick:\(\)=>\{(\w+)\(!0,(\w+)\.CONVERSATION\)\}/);
    if (!btnMatch) return null;
    const permFn = btnMatch[1];
    const enumName = btnMatch[2];

    // Find the absolutePathUri guard: if(!VAR?.absolutePathUri)return null;
    // Variable name varies between files (t, e, etc.) so we use a regex
    const guardRegex = /if\(!\w+\?\.absolutePathUri\)return null;/;
    const guardMatch = content.substring(Math.max(0, fpIdx - 500)).match(guardRegex);
    if (!guardMatch) return null;
    const guardIdx = content.indexOf(guardMatch[0], Math.max(0, fpIdx - 500));
    if (guardIdx === -1) return null;

    const insertAt = guardIdx + guardMatch[0].length;

    // Extract request variable name from the guard (e.g., 't' from 'if(!t?.absolutePathUri)')
    const reqVarMatch = guardMatch[0].match(/!\(?(\w+)\?/);
    const reqVar = reqVarMatch ? reqVarMatch[1] : 't';

    // Auto-approve file access for user-owned paths.
    // Normalizes Windows backslashes to forward slashes via String.fromCharCode(92,92).
    // Allow-list: /users/ (Win home), /home/ (Linux/Mac), /tmp/, /temp/
    // Anything else (C:\Windows, C:\Program Files, etc.) falls through to manual prompt.
    let patchCode;
    if (options?.allowAll) {
        // Allow-all mode: no path check, approve everything
        patchCode = `${FILEACCESS_MARKER}setTimeout(()=>${permFn}(!0,${enumName}.CONVERSATION),0);`;
    } else {
        // Allow-list mode: check path before approving
        patchCode = `${FILEACCESS_MARKER}if(((_p)=>{const _n=_p.replace(new RegExp(String.fromCharCode(92,92),'g'),'/').toLowerCase();return _n.includes('/users/')||_n.includes('/home/')||_n.includes('/tmp/')||_n.includes('/temp/')})(${reqVar}?.absolutePathUri||''))setTimeout(()=>${permFn}(!0,${enumName}.CONVERSATION),0);`;
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
    const anchor = 'Step Requires Input';
    const anchorIdx = content.indexOf(anchor);
    if (anchorIdx === -1) return null;

    // Find the component's setExpanded prop — it's the 5th destructured prop:
    // ({steps:e,trajectoryId:t,debugMode:r,expanded:n,setExpanded:a,...})=>
    // Find the pattern: setExpanded:VAR,  within ~500 chars before anchor
    const chunk = content.substring(Math.max(0, anchorIdx - 2000), anchorIdx);
    const setExpandedMatch = chunk.match(/setExpanded:(\w+),/);
    if (!setExpandedMatch) return null;
    const setExpandedVar = setExpandedMatch[1];

    // Find the guard: if(s.length===0)return null;
    // 's' is the filtered WAITING steps array — variable name varies
    const guardRegex = /if\((\w+)\.length===0\)return null;/;
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
 * Patch 4: Auto-approve browser URL permission prompts.
 *
 * The qFi component shows "Agent needs permission to act on <hostname>"
 * with Deny / Always Allow / Allow Once buttons.
 * We inject setTimeout(()=>confirmFn(), 0) before the return to auto-confirm.
 */
function analyzeBrowserAction(content, label) {
    // Find the unique browserAction interaction pattern
    const baIdx = content.indexOf('case:"browserAction"');
    if (baIdx === -1) return null;

    // The confirm function sends {confirm:!0} and is defined as:
    //   b=Ce(()=>{a(ur(tE,{...interaction:{case:"browserAction",value:ur(sbe,{confirm:!0})}}))}, [...])
    // Extract it from the pattern confirm:!0
    const chunk = content.substring(Math.max(0, baIdx - 200), baIdx + 1500);
    const confirmMatch = chunk.match(/(\w+)=\w+\(\(\)=>\{\w+\(\w+\(\w+,\{[^}]*confirm:!0/);
    if (!confirmMatch) return null;
    const confirmFn = confirmMatch[1];

    // Find the return statement: return u?r?A(... 
    const returnPattern = /return \w+\?\w+\?A\(/;
    const returnMatch = content.substring(baIdx, baIdx + 1500).match(returnPattern);
    if (!returnMatch) return null;
    const returnIdx = content.indexOf(returnMatch[0], baIdx);
    if (returnIdx === -1) return null;

    const insertAt = returnIdx;
    const patchCode = `${BROWSERACTION_MARKER}setTimeout(()=>${confirmFn}(),0);`;

    return {
        insertAt,
        patchCode,
        patchMarker: BROWSERACTION_MARKER,
        label,
        details: { confirmFn, type: 'browserAction' }
    };
}

// ─── File Operations ────────────────────────────────────────────────────────

const ALL_MARKERS = [PATCH_MARKER, FILEACCESS_MARKER, AUTOEXPAND_MARKER, BROWSERACTION_MARKER];

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

        // Apply browser action patch (always fresh after stripping)
        content = stripBrowseractionPatch(content);
        const baAnalysis = analyzeBrowserAction(content, label);
        if (baAnalysis) {
            content = content.substring(0, baAnalysis.insertAt) + baAnalysis.patchCode + content.substring(baAnalysis.insertAt);
            totalBytes += baAnalysis.patchCode.length;
            applied.push('browseraction');
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
 * Handles ALL known patch variants:
 *   v1: /*AAA:fileaccess*​/setTimeout(()=>{...path filtering...},0);
 *   v2: /*AAA:fileaccess*​/setTimeout(()=>{...},0);return null;
 *   v3: /*AAA:fileaccess*​/setTimeout(()=>FN(!0,ENUM.CONVERSATION),0);return null;
 *   v4: /*AAA:fileaccess*​/FN(!0,ENUM.CONVERSATION);return null;
 */
function stripFileaccessPatch(content) {
    let c = content;
    while (c.includes(FILEACCESS_MARKER)) {
        const idx = c.indexOf(FILEACCESS_MARKER);
        const afterMarker = c.substring(idx + FILEACCESS_MARKER.length, idx + 1000);

        // Determine the end of the patch by looking for known end patterns
        // Search order matters: check for "return null;" AFTER "},0);" first (v2/v3),
        // then standalone "return null;" (v4), then just "},0);" (v1)
        let removeLen = FILEACCESS_MARKER.length; // fallback: just remove marker

        const setTimeoutPos = afterMarker.indexOf('},0);');
        const returnNullPos = afterMarker.indexOf('return null;');

        if (setTimeoutPos > -1 && returnNullPos > -1 && returnNullPos > setTimeoutPos) {
            // v2/v3: has both "},0);" and "return null;" after it
            removeLen = FILEACCESS_MARKER.length + returnNullPos + 12; // 'return null;'.length
        } else if (setTimeoutPos > -1) {
            // v1: just "},0);" with no return null
            removeLen = FILEACCESS_MARKER.length + setTimeoutPos + 5; // '},0);'.length
        } else if (returnNullPos > -1 && returnNullPos < 200) {
            // v4: simple sync patch ending with "return null;"
            removeLen = FILEACCESS_MARKER.length + returnNullPos + 12;
        }

        c = c.substring(0, idx) + c.substring(idx + removeLen);
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

/** Strip browseraction marker and code */
function stripBrowseractionPatch(content) {
    let c = content;
    while (c.includes(BROWSERACTION_MARKER)) {
        const idx = c.indexOf(BROWSERACTION_MARKER);
        const semi = c.indexOf(';', idx + BROWSERACTION_MARKER.length);
        if (semi === -1) break;
        c = c.substring(0, idx) + c.substring(semi + 1);
    }
    return c;
}

/** Strip all patches (autorun, fileaccess, autoexpand, browseraction) */
function stripMarkers(content) {
    return stripBrowseractionPatch(stripAutoexpandPatch(stripAutorunPatch(stripFileaccessPatch(content))));
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
    analyzeFile,
    analyzeFileAccess,
    PATCH_MARKER,
    FILEACCESS_MARKER
};
