
(function () {
    console.clear();
    console.log('%c 🔍 CURSOR COMPLETION DETECTOR ', 'background: #27ae60; color: white; font-size: 16px; padding: 10px; border-radius: 4px;');

    // Key selectors based on investigation
    const MESSAGE_PAIR_SELECTOR = '.composer-human-ai-pair-container';
    const ELLIPSIS_BUTTON_SELECTOR = '.anysphere-icon-button';
    const CONTROLS_SELECTOR = '.composer-pane-controls-feedback';

    // Find all message pairs
    const messagePairs = document.querySelectorAll(MESSAGE_PAIR_SELECTOR);
    console.log(`%c Found ${messagePairs.length} message pairs`, 'color: #3498db; font-weight: bold;');

    if (messagePairs.length === 0) {
        console.log('%c ⚠️ No message pairs found. Are you in the correct iframe context?', 'color: orange;');
        return { isCompleted: false, reason: 'no_messages' };
    }

    // Get the LAST message pair (most recent)
    const lastPair = messagePairs[messagePairs.length - 1];
    console.log('%c Last message pair:', 'font-weight: bold;', lastPair);

    // Check if this pair has the controls section with the "..." button
    const controls = lastPair.querySelector(CONTROLS_SELECTOR);
    const ellipsisButton = lastPair.querySelector(ELLIPSIS_BUTTON_SELECTOR);

    console.log('%c Controls found:', 'font-weight: bold;', !!controls);
    console.log('%c Ellipsis button found:', 'font-weight: bold;', !!ellipsisButton);

    // Check visibility - the ellipsis button should be visible (has dimensions)
    let ellipsisVisible = false;
    if (ellipsisButton) {
        const rect = ellipsisButton.getBoundingClientRect();
        ellipsisVisible = rect.width > 0 && rect.height > 0;
        console.log('%c Ellipsis visible:', 'font-weight: bold;', ellipsisVisible, `(${rect.width}x${rect.height})`);
    }

    // Check if there's any "loading" indicator or streaming text
    // Common patterns: spinners, "Thinking...", streaming dots
    const loadingIndicators = [
        lastPair.querySelector('.loading'),
        lastPair.querySelector('.spinner'),
        lastPair.querySelector('[class*="loading"]'),
        lastPair.querySelector('[class*="spinner"]'),
        lastPair.querySelector('[class*="streaming"]')
    ].filter(Boolean);

    const hasLoading = loadingIndicators.length > 0;
    console.log('%c Loading indicators:', 'font-weight: bold;', hasLoading, loadingIndicators);

    // Determine completion:
    // Complete if: ellipsis is visible AND no loading indicators
    const isCompleted = ellipsisVisible && !hasLoading;

    console.log('');
    if (isCompleted) {
        console.log('%c ✅ CONVERSATION COMPLETED', 'background: #27ae60; color: white; padding: 8px; font-size: 14px; font-weight: bold;');
    } else {
        console.log('%c ❌ CONVERSATION IN PROGRESS', 'background: #e74c3c; color: white; padding: 8px; font-size: 14px; font-weight: bold;');
        if (!ellipsisVisible) console.log('   Reason: Ellipsis button not visible yet');
        if (hasLoading) console.log('   Reason: Loading indicator present');
    }

    // Highlight the last pair
    lastPair.style.outline = '2px solid #27ae60';

    return {
        isCompleted,
        ellipsisVisible,
        hasLoading,
        messagePairCount: messagePairs.length,
        lastPair
    };
})();
