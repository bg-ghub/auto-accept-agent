/**
 * DOM Observer Script Builder
 * 
 * Generates an injection script using MutationObserver to auto-click
 * approval buttons inside the AG cascade agent webview.
 * 
 * Based on community best practices from:
 *   - yazanbaker94/AntiGravity-AutoAccept (MutationObserver, circuit breaker)
 *   - james-hr/antigravity-retry (error context detection before retry)
 * 
 * Features:
 *   - Single-pass TreeWalker DOM scan (O(D) not O(N*D))
 *   - MutationObserver for instant reaction + 10s fallback interval
 *   - Error context detection before clicking retry/continue
 *   - Retry/Continue with circuit breaker (5 per 60s)
 *   - Command blocklist/allowlist with word-boundary matching
 *   - Per-element cooldowns to prevent click spam
 *   - Deferred isAgentPanel() check via .react-app-container
 * 
 * @module dom-observer
 */

/**
 * Build the injection script string.
 * @param {Object} opts
 * @param {string[]} opts.customTexts - Additional button texts to click
 * @param {string[]} opts.blockedCommands - Commands to block
 * @param {string[]} opts.allowedCommands - Commands to allow (whitelist mode)
 * @param {boolean} opts.autoAcceptFileEdits - Whether to accept file edits
 * @param {boolean} opts.autoRetryEnabled - Whether to auto-retry
 * @returns {string} JavaScript to inject via CDP Runtime.evaluate
 */
function buildDOMObserverScript(opts = {}) {
    const {
        customTexts = [],
        blockedCommands = [],
        allowedCommands = [],
        autoAcceptFileEdits = true,
        autoRetryEnabled = true
    } = opts;

    // Button keywords in priority order (highest priority first)
    const buttonTexts = ['run', 'accept'];
    if (autoAcceptFileEdits) {
        buttonTexts.push('accept all');
    }
    buttonTexts.push('always allow', 'allow this conversation', 'allow');
    if (autoRetryEnabled) {
        buttonTexts.push('retry', 'try again', 'continue');
    }
    // Custom texts from config
    for (const t of customTexts) {
        if (t && typeof t === 'string') buttonTexts.push(t.toLowerCase().trim());
    }

    // Recovery keywords — these require error context before clicking
    const recoveryKeywords = ['retry', 'try again', 'continue'];

    const blockedJson = JSON.stringify(blockedCommands);
    const allowedJson = JSON.stringify(allowedCommands);
    const hasFiltersVal = blockedCommands.length > 0 || allowedCommands.length > 0;

    return `(function() {
    // === GUARD: Prevent double-injection ===
    if (window.__AA_OBSERVER_ACTIVE) return 'already-active';

    var COOLDOWN_MS = 5000;
    var clickCooldowns = {};
    var BUTTON_TEXTS = ${JSON.stringify(buttonTexts)};
    var RECOVERY_KEYWORDS = ${JSON.stringify(recoveryKeywords)};
    var BLOCKED_COMMANDS = ${blockedJson};
    var ALLOWED_COMMANDS = ${allowedJson};
    var HAS_FILTERS = ${hasFiltersVal};
    var AUTO_RETRY = ${autoRetryEnabled};

    // Circuit breaker: max retries per window
    var CB_MAX_RETRIES = 5;
    var CB_WINDOW_MS = 60000;

    window.__AA_CLICK_COUNT = window.__AA_CLICK_COUNT || 0;
    window.__AA_RETRY_COUNT = window.__AA_RETRY_COUNT || 0;
    window.__AA_OBSERVER_ACTIVE = true;
    window.__AA_LAST_SCAN = Date.now();

    function _log() {
        var args = ['[AAA-CDP]'];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    // === DOM PATH for cooldown keys ===
    function _domPath(el) {
        var p = '';
        var n = el;
        for (var i = 0; i < 5 && n && n !== document.body; i++) {
            p = (n.tagName || '?') + (n.className ? '.' + (n.className + '').substring(0, 20) : '') + '>' + p;
            n = n.parentElement;
        }
        return p;
    }

    function pruneCooldowns() {
        var now = Date.now();
        for (var k in clickCooldowns) {
            if (now - clickCooldowns[k] > COOLDOWN_MS) delete clickCooldowns[k];
        }
    }

    // === AGENT PANEL CHECK ===
    function isAgentPanel() {
        return !!document.querySelector('.react-app-container') ||
               !!document.querySelector('[class*="cascade"]') ||
               !!document.querySelector('[class*="agent"]');
    }

    // === ERROR CONTEXT DETECTION (from james-hr/antigravity-retry) ===
    // Before clicking retry, verify there is actually an error visible.
    // Prevents false positives when "retry" appears in conversation text.
    var ERROR_INDICATORS = [
        'something went wrong', 'error occurred', 'failed to',
        'request failed', 'network error', 'unable to',
        'an error', 'try again', 'generation failed',
        'rate limit', 'too many requests', 'high traffic',
        'overloaded', 'capacity', 'temporarily unavailable',
        'timed out', 'timeout', 'connection error',
        'internal server error', 'bad gateway', 'service unavailable'
    ];

    function hasErrorContext() {
        try {
            // 1. Check recent visible text (last 2000 chars to avoid old chat)
            var bodyText = (document.body.innerText || '').toLowerCase();
            var recentText = bodyText.substring(Math.max(0, bodyText.length - 2000));
            for (var i = 0; i < ERROR_INDICATORS.length; i++) {
                if (recentText.indexOf(ERROR_INDICATORS[i]) !== -1) return true;
            }
            // 2. Check for error CSS classes (AG uses these for error states)
            var errorEls = document.querySelectorAll(
                '.error, .error-message, [class*="error"], [class*="failed"], ' +
                '[class*="failure"], .notification-error, [class*="warning"]'
            );
            for (var j = 0; j < errorEls.length; j++) {
                if (errorEls[j].offsetParent !== null) return true;
            }
        } catch (e) {}
        return false;
    }

    // === SINGLE-PASS BUTTON FINDER ===
    function findButton(root, texts) {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        var node;
        while ((node = walker.nextNode())) {
            var tag = (node.tagName || '').toLowerCase();
            if (tag !== 'button' && tag !== 'a' && tag !== 'div' && tag !== 'span') continue;
            if (!node.offsetParent && tag !== 'button') continue;

            // Get button text: try direct text nodes first, then textContent for buttons/links
            var text = '';
            for (var c = 0; c < node.childNodes.length; c++) {
                if (node.childNodes[c].nodeType === 3) text += node.childNodes[c].textContent;
            }
            text = text.trim().toLowerCase();
            // Fallback: AG v1.22+ wraps button labels in <span>, so direct text is empty.
            // For actual button/a elements, use textContent (safe — they're leaf-ish nodes)
            if (!text && (tag === 'button' || tag === 'a')) {
                text = (node.textContent || '').trim().toLowerCase();
            }
            if (!text || text.length > 80) continue;

            for (var i = 0; i < texts.length; i++) {
                var keyword = texts[i];
                if (text === keyword || (text.indexOf(keyword) === 0 && (text.length === keyword.length || /[^a-z0-9]/.test(text.charAt(keyword.length))))) {
                    var cdKey = _domPath(node) + ':' + text.substring(0, 30);
                    if (clickCooldowns[cdKey] && Date.now() - clickCooldowns[cdKey] < COOLDOWN_MS) continue;
                    if (node.disabled) continue;
                    if (node.getAttribute('data-aa-blocked') === 'true') continue;
                    return { node: node, matchedText: keyword };
                }
            }
        }
        return null;
    }

    // === COMMAND TEXT EXTRACTION ===
    function extractCommandText(btn) {
        try {
            var el = btn;
            for (var i = 0; i < 8 && el && el !== document.body; i++) {
                el = el.parentElement;
                if (!el) break;
                var codes = el.querySelectorAll('pre, code');
                if (codes.length > 0) {
                    var allText = '';
                    for (var j = 0; j < codes.length; j++) {
                        allText += ' ' + (codes[j].textContent || '').trim();
                    }
                    allText = allText.trim();
                    if (allText.length > 0) return allText;
                }
            }
        } catch (e) {}
        return null;
    }

    // === COMMAND FILTER ===
    function isCommandAllowed(commandText) {
        var blockedList = window.__AA_BLOCKED || BLOCKED_COMMANDS;
        var allowedList = window.__AA_ALLOWED || ALLOWED_COMMANDS;
        var hf = window.__AA_HAS_FILTERS !== undefined ? window.__AA_HAS_FILTERS : HAS_FILTERS;
        if (!hf) return true;
        if (!commandText) return false;
        var cmdLower = commandText.toLowerCase();

        function matchesPattern(cmd, pattern) {
            var patLower = pattern.toLowerCase();
            var idx = cmd.indexOf(patLower);
            while (idx !== -1) {
                var before = idx === 0 ? ' ' : cmd.charAt(idx - 1);
                var after = idx + patLower.length >= cmd.length ? ' ' : cmd.charAt(idx + patLower.length);
                var delims = ' \\t\\r\\n|;&/()[]{}\\"\\'\\x60$=<>,\\\\:';
                if ((idx === 0 || delims.indexOf(before) !== -1) &&
                    (idx + patLower.length >= cmd.length || delims.indexOf(after) !== -1)) {
                    return true;
                }
                idx = cmd.indexOf(patLower, idx + 1);
            }
            return false;
        }

        for (var b = 0; b < blockedList.length; b++) {
            if (matchesPattern(cmdLower, blockedList[b])) return false;
        }
        if (allowedList.length > 0) {
            var allowed = false;
            for (var a = 0; a < allowedList.length; a++) {
                if (matchesPattern(cmdLower, allowedList[a])) { allowed = true; break; }
            }
            if (!allowed) return false;
        }
        return true;
    }

    // === MAIN SCAN & CLICK ===
    function scanAndClick() {
        window.__AA_LAST_SCAN = Date.now();
        if (window.__AA_PAUSED) return null;
        pruneCooldowns();
        if (!isAgentPanel()) return null;

        var hf = window.__AA_HAS_FILTERS !== undefined ? window.__AA_HAS_FILTERS : HAS_FILTERS;

        var MAX_SCANS = 5;
        for (var scan = 0; scan < MAX_SCANS; scan++) {
            var match = findButton(document.body, BUTTON_TEXTS);
            if (!match) return null;

            var btn = match.node;
            var matchedText = match.matchedText;

            // Command filtering for terminal buttons
            if (hf) {
                var cmdText = extractCommandText(btn);
                if (cmdText !== null && !isCommandAllowed(cmdText)) {
                    btn.setAttribute('data-aa-blocked', 'true');
                    var blockKey = _domPath(btn) + ':blocked:' + matchedText;
                    clickCooldowns[blockKey] = Date.now() + 10000;
                    continue;
                }
            }

            // === RETRY/CONTINUE: ERROR CONTEXT + CIRCUIT BREAKER ===
            var isRecovery = false;
            for (var ri = 0; ri < RECOVERY_KEYWORDS.length; ri++) {
                if (matchedText === RECOVERY_KEYWORDS[ri]) { isRecovery = true; break; }
            }
            if (isRecovery) {
                if (!AUTO_RETRY) continue;

                // Error context gate (from james-hr): only retry if there
                // is actually an error visible in the panel
                if (!hasErrorContext()) {
                    _log('retry skipped: no error context for', matchedText);
                    var skipKey = _domPath(btn) + ':skip:' + matchedText;
                    clickCooldowns[skipKey] = Date.now() - COOLDOWN_MS + 2000;
                    continue;
                }

                // Circuit breaker: max CB_MAX_RETRIES per CB_WINDOW_MS
                window.__AA_RECOVERY_TS = window.__AA_RECOVERY_TS || [];
                var now = Date.now();
                window.__AA_RECOVERY_TS = window.__AA_RECOVERY_TS.filter(function(ts) {
                    return now - ts < CB_WINDOW_MS;
                });
                if (window.__AA_RECOVERY_TS.length >= CB_MAX_RETRIES) {
                    _log('Circuit breaker: ' + CB_MAX_RETRIES + ' retries in 60s, stopping');
                    return 'blocked:circuit_breaker';
                }
                window.__AA_RECOVERY_TS.push(now);
                window.__AA_RETRY_COUNT = (window.__AA_RETRY_COUNT || 0) + 1;
                _log('auto-retry #' + window.__AA_RETRY_COUNT + ' (' + matchedText + ')');
            } else {
                // Non-recovery click resolves the error state
                window.__AA_RECOVERY_TS = [];
            }

            // Record cooldown and click
            var key = _domPath(btn) + ':' + (btn.textContent || '').trim().toLowerCase().substring(0, 30);
            clickCooldowns[key] = Date.now();

            _log('clicking:', matchedText, '| text:', (btn.textContent || '').trim().substring(0, 40));
            btn.click();
            window.__AA_CLICK_COUNT = (window.__AA_CLICK_COUNT || 0) + 1;
            return 'clicked:' + matchedText;
        }
        return null;
    }

    // === INITIAL SCAN ===
    try { scanAndClick(); } catch(e) { _log('initial scan error:', e.message); }

    // === MUTATION OBSERVER ===
    var __AA_SCAN_QUEUED = false;
    var observer = new MutationObserver(function() {
        if (__AA_SCAN_QUEUED || window.__AA_PAUSED) return;
        __AA_SCAN_QUEUED = true;
        setTimeout(function() {
            try { scanAndClick(); } catch(e) { _log('scan error:', e.message); }
            finally { __AA_SCAN_QUEUED = false; }
        }, 50);
    });
    observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-expanded', 'data-state']
    });

    // === FALLBACK PERIODIC SCAN ===
    if (window.__AA_FALLBACK_INTERVAL) clearInterval(window.__AA_FALLBACK_INTERVAL);
    window.__AA_FALLBACK_INTERVAL = setInterval(function() {
        if (window.__AA_PAUSED) return;
        window.__AA_LAST_SCAN = Date.now();
        setTimeout(function() {
            try { scanAndClick(); } catch(e) {}
        }, 0);
    }, 10000);

    // Kill switch
    window.__AA_OBSERVER = observer;
    return 'observer-installed';
})()`;
}

module.exports = { buildDOMObserverScript };
