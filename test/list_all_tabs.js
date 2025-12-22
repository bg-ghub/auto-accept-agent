
(function () {
    console.clear();
    console.log('%c 📑 CUSTOM TAB FINDER ', 'background: #27ae60; color: white; font-size: 16px; padding: 10px; border-radius: 4px;');

    // We filter out standard VS Code panels to find the custom/chat ones
    const SYSTEM_TABS = new Set([
        'Terminal', 'Output', 'Ports', 'Playwright',
        'Problems', 'Debug Console', 'GitLens', 'Timeline', 'Comments'
    ]);

    const selector = 'ul[role="tablist"] li[role="tab"]';
    const allTabs = document.querySelectorAll(selector);
    const matches = [];

    allTabs.forEach((tab) => {
        const labelEl = tab.querySelector('.composite-bar-action-tab-label');
        const text = (labelEl ? labelEl.innerText : tab.innerText).trim();

        // 1. Skip empty
        if (!text) return;

        // 2. Skip System Tabs (Tightening the script)
        if (SYSTEM_TABS.has(text)) return;

        // 3. We kept it!
        const isActive = tab.classList.contains('checked') || tab.getAttribute('aria-selected') === 'true';

        matches.push({
            'Label': text,
            'Is Active': isActive ? '✅' : '',
            'Element': tab
        });
    });

    if (matches.length > 0) {
        console.log(`%cFound ${matches.length} relevant tabs (excluding system panels):`, 'color: #27ae60; font-weight: bold;');
        console.table(matches, ['Label', 'Is Active']);

        // Store for easy access
        window._foundChatTabs = matches.map(m => m.Element);
        console.log(`%cAccess the DOM elements via: %cwindow._foundChatTabs`, 'color: #888;', 'color: #3498db; font-weight: bold;');
    } else {
        console.error('No custom/chat tabs found. (Only system tabs were seen)');
    }

})();
