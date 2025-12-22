
(function () {
    const TARGET_TEXT = "ascii cat in terminal"; // Case insensitive search

    function log(msg, style = '') {
        console.log(msg, style);
    }

    function getElementInfo(el) {
        const rect = el.getBoundingClientRect();
        return {
            tagName: el.tagName,
            id: el.id || '(none)',
            className: typeof el.className === 'string' ? el.className.trim() : '[svg/obj]',
            text: el.textContent?.trim().slice(0, 100) || '(none)',
            visible: (rect.width > 0 && rect.height > 0),
            dimensions: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            attributes: Array.from(el.attributes).reduce((acc, attr) => {
                acc[attr.name] = attr.value;
                return acc;
            }, {})
        };
    }

    function generateSelector(el) {
        if (!el) return '';
        let selector = el.tagName.toLowerCase();
        if (el.id) return selector + '#' + el.id;

        if (typeof el.className === 'string' && el.className.trim()) {
            const classes = el.className.split(/\s+/).filter(c => c && !c.match(/^[a-z0-9]{10,}$/));
            if (classes.length) selector += '.' + classes.join('.');
        }

        // Attributes
        ['data-testid', 'aria-label', 'name', 'role', 'title'].forEach(attr => {
            if (el.hasAttribute(attr)) {
                selector += `[${attr}="${el.getAttribute(attr)}"]`;
            }
        });

        return selector;
    }

    function getFullPath(el) {
        let path = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            path.unshift(generateSelector(current));
            current = current.parentElement || current.getRootNode()?.host; // Handle Shadow DOM host
        }
        return path.join(' > ');
    }

    /**
     * Recursively traverse nodes, including Shadow DOMs and Iframes
     */
    function deepSearch(root, pathPrefix) {
        let matchCount = 0;

        // Helper to check a single node
        function checkNode(node) {
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            // 1. Check current node content
            const textContent = node.textContent || '';
            const val = node.value || '';
            const label = node.getAttribute('aria-label') || '';
            const title = node.getAttribute('title') || '';

            const isMatch = [textContent, val, label, title].some(s =>
                s.toLowerCase().includes(TARGET_TEXT.toLowerCase())
            );

            // Optimization: If a node's entire text content doesn't have it, children won't either
            // EXCEPT for shadow roots which are separate.
            // But we need to be careful about "leaf" matching.

            // Allow broad match here, refine log later
            if (isMatch) {
                // To avoid logging every parent, check if it's a "direct" enough match
                // i.e., direct text node child, or input value, or specific attribute
                const hasDirectTextMatch = Array.from(node.childNodes).some(n =>
                    n.nodeType === Node.TEXT_NODE &&
                    n.nodeValue.toLowerCase().includes(TARGET_TEXT.toLowerCase())
                );

                const isAttrMatch = (val && val.toLowerCase().includes(TARGET_TEXT.toLowerCase())) ||
                    (label && label.toLowerCase().includes(TARGET_TEXT.toLowerCase())) ||
                    (title && title.toLowerCase().includes(TARGET_TEXT.toLowerCase()));

                if (hasDirectTextMatch || isAttrMatch) {
                    matchCount++;
                    log(`%c[MATCH #${matchCount}] Found in ${pathPrefix}`, 'color: #00ff00; font-weight: bold; font-size: 14px;');
                    log('CSS Selector:', generateSelector(node));
                    log('Element Info:', getElementInfo(node));
                    log('Full Path:', getFullPath(node));

                    const parent = node.closest('button, [role="button"], a, .clickable, .monaco-list-row');
                    if (parent && parent !== node) {
                        log('%c   ↳ Closest Interactive Parent', 'color: #ffaa00;');
                        log('     Parent Selector:', generateSelector(parent));
                    }
                    log('--------------------------------------------------');
                }
            }

            // 2. Traverse Shadow DOM
            if (node.shadowRoot) {
                // log(`Entering Shadow DOM of ${node.tagName}`);
                matchCount += deepSearch(node.shadowRoot, pathPrefix + ' > #shadow-root');
            }

            // 3. Traverse Iframes
            if (node.tagName === 'IFRAME' || node.tagName === 'FRAME' || node.tagName === 'WEBVIEW') {
                try {
                    const doc = node.contentDocument || node.contentWindow?.document;
                    if (doc) {
                        matchCount += deepSearch(doc.body || doc.documentElement, pathPrefix + ` > ${node.tagName}`);
                    }
                } catch (e) {
                    // Cross-origin blocked
                }
            }
        }

        // Standard DOM traversal
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT,
            null,
            false
        );

        let currentNode = walker.currentNode;
        // The walker starts at root. Check root first.
        checkNode(currentNode);

        while (walker.nextNode()) {
            checkNode(walker.currentNode);
        }

        return matchCount;
    }

    // --- Execution ---
    console.clear();
    log(`%c STARTED SEARCH FOR: "${TARGET_TEXT}"`, 'background: #333; color: #fff; padding: 4px; font-weight: bold;');

    // Start from document body
    const totalFound = deepSearch(document.body, 'Main');

    if (totalFound === 0) {
        log(`%c ❌ No matches found for "${TARGET_TEXT}".`, 'color: red; font-weight: bold;');
        log('Tip: The text might be inside a cross-origin iframe (like a Webview) that this script cannot access from the main console.');
        log('Action: Try switching the "Console Context" dropdown in DevTools to the specific iframe/target.');
    } else {
        log(`%c ✅ Search Complete. Found ${totalFound} matches.`, 'color: #00ff00; font-weight: bold;');
    }

    // Return a string so "undefined" isn't the only thing the user sees
    return `Search finished. Check console logs above.`;

})();
