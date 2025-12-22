
(function () {
    try {
        console.clear();
        console.log('=== CURSOR POLLING TEST ===');

        // 1. TAB DETECTION
        console.log('');
        console.log('--- TABS ---');
        var tabEls = document.querySelectorAll('ul[role="tablist"] li[role="tab"]');
        console.log('Raw tabs found: ' + tabEls.length);

        var chatTabs = [];
        var systemTabs = ['Terminal', 'Output', 'Ports', 'Playwright', 'Problems', 'Debug Console', 'GitLens', 'Timeline', 'Comments', 'Extensions', 'Search', 'Source Control', 'Run and Debug'];

        for (var i = 0; i < tabEls.length; i++) {
            var tab = tabEls[i];
            var labelEl = tab.querySelector('.composite-bar-action-tab-label');
            var text = labelEl ? labelEl.innerText : tab.innerText;
            text = text ? text.trim() : '';

            if (text && systemTabs.indexOf(text) === -1) {
                chatTabs.push(text);
                console.log('  Chat tab: ' + text);
            }
        }
        console.log('Chat tabs: ' + chatTabs.length);

        // 2. COMPLETION DETECTION
        console.log('');
        console.log('--- COMPLETION ---');
        var selector = '.composer-human-ai-pair-container .composer-pane-controls-feedback .anysphere-icon-button';
        var markers = document.querySelectorAll(selector);
        console.log('Completion markers found: ' + markers.length);

        var isComplete = false;
        if (markers.length > 0) {
            var last = markers[markers.length - 1];
            var rect = last.getBoundingClientRect();
            isComplete = rect.width > 0 && rect.height > 0;
            console.log('Last marker visible: ' + isComplete);
            if (isComplete) {
                last.style.outline = '3px solid lime';
                last.style.boxShadow = '0 0 10px lime';
            }
        }
        console.log('COMPLETE: ' + (isComplete ? 'YES' : 'NO'));

        // 3. ACCEPT BUTTONS
        console.log('');
        console.log('--- ACCEPT BUTTONS ---');
        var allBtns = document.querySelectorAll('button');
        var acceptBtns = [];
        for (var j = 0; j < allBtns.length; j++) {
            var btn = allBtns[j];
            var btnText = btn.textContent || '';
            if (btnText.toLowerCase().indexOf('accept') !== -1 || btnText.toLowerCase().indexOf('run') !== -1) {
                if (btn.getBoundingClientRect().height > 0) {
                    acceptBtns.push(btnText.trim().substring(0, 30));
                    btn.style.outline = '2px solid red';
                }
            }
        }
        console.log('Accept/Run buttons: ' + acceptBtns.length);
        for (var k = 0; k < acceptBtns.length; k++) {
            console.log('  ' + acceptBtns[k]);
        }

        console.log('');
        console.log('=== TEST DONE ===');
        return 'Test completed - check logs above';

    } catch (err) {
        console.error('ERROR: ' + err.message);
        console.error(err.stack);
        return 'Error: ' + err.message;
    }
})();
