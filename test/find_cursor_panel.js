
(function () {
    console.clear();
    console.log('%c 🕵️ CURSOR AI PANEL FINDER ', 'background: #8e44ad; color: white; font-size: 16px; padding: 10px; border-radius: 4px;');

    const COLORS = ['#e74c3c', '#3498db', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c', '#e91e63'];

    // STRICTER SELECTORS
    // We are looking for the CONTAINER of the AI chat.
    // In VS Code/Cursor, this is usually the Secondary Sidebar (Auxiliary Bar) or the Primary Sidebar.
    const CANDIDATE_SELECTORS = [
        // Top-level containers
        '#workbench\\.parts\\.auxiliarybar', // Often the "Right" sidebar where AI lives
        '#workbench\\.parts\\.sidebar',      // The "Left" sidebar
        '.part.sidebar',
        '.part.auxiliarybar',

        // The actual content host
        'webview',
        'iframe',

        // Specific Cursor/AI markers (if present in top level)
        '.composer-pane',
        '.aichat-container'
    ];

    const candidates = [];
    const seen = new Set();

    // Helper to get a unique selector
    function getSelector(el) {
        if (el.id) return '#' + el.id;
        if (el.className && typeof el.className === 'string') {
            return '.' + el.className.trim().split(/\s+/).join('.');
        }
        return el.tagName.toLowerCase();
    }

    const IGNORE_CLASSES = ['sash', 'scrollbar', 'slider', 'shadow', 'monaco-scrollable-element', 'split-view-view'];

    // Collect candidates
    CANDIDATE_SELECTORS.forEach(sel => {
        try {
            document.querySelectorAll(sel).forEach(el => {
                if (seen.has(el)) return;

                // 1. Size Filter: Must be substantial (e.g. > 200x200)
                const rect = el.getBoundingClientRect();
                if (rect.width < 200 || rect.height < 200) return;

                // 2. Visibility Filter
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return;

                // 3. Noise Filter
                if (IGNORE_CLASSES.some(cls => el.className.includes && el.className.includes(cls))) return;

                seen.add(el);
                candidates.push(el);
            });
        } catch (e) {
            console.error('Invalid selector:', sel);
        }
    });

    // Highlight and log
    const results = [];

    candidates.forEach((el, i) => {
        const color = COLORS[i % COLORS.length];
        const rect = el.getBoundingClientRect();

        // Highlight
        el.style.outline = `5px solid ${color}`;
        el.style.outlineOffset = '-5px';
        el.dataset.candidateId = i;

        // Add label
        const label = document.createElement('div');
        label.textContent = `Candidate ${i}`;
        label.style.position = 'absolute';
        label.style.top = '0';
        label.style.left = '0';
        label.style.background = color;
        label.style.color = 'white';
        label.style.padding = '5px';
        label.style.zIndex = '10000';
        label.style.pointerEvents = 'none';

        if (getComputedStyle(el).position === 'static') {
            el.style.position = 'relative';
        }
        el.appendChild(label);

        results.push({
            'ID': i,
            'Color': color,
            'Tag': el.tagName.toLowerCase(),
            'Selector': getSelector(el),
            'Dimensions': `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            'Classes': (el.className || '').slice(0, 50)
        });

        console.log(`%c[${i}] ${color}`, `color: ${color}; font-weight: bold;`, el);
    });

    console.table(results);
    console.log('%c Look for the box that strictly encloses the entire AI Chat interface.', 'font-weight: bold;');
})();
