
(function () {
    console.clear();
    console.log('%c 🎯 FINAL VERIFICATION: COMPLETION MARKER ', 'background: #27ae60; color: white; font-size: 16px; padding: 10px; border-radius: 4px;');

    // The robust selector derived from your data:
    // It targets the icon button SPECIFICALLY inside the feedback/controls area 
    // of a message pair.
    const TARGET_SELECTOR = '.composer-human-ai-pair-container .composer-pane-controls-feedback .anysphere-icon-button';

    const markers = document.querySelectorAll(TARGET_SELECTOR);
    console.log(`%c Found ${markers.length} completion markers with selector:`, 'color: #3498db; font-weight: bold;');
    console.log(`"${TARGET_SELECTOR}"`);

    if (markers.length === 0) {
        console.error('❌ Failed to find the marker. Check context.');
        return;
    }

    // Usually we care about the LAST one (most recent message)
    const lastMarker = markers[markers.length - 1];

    // Highlight ALL found matches to show accuracy
    markers.forEach((el, i) => {
        const isLast = i === markers.length - 1;
        const color = isLast ? '#00ff00' : '#27ae60'; // Bright green for last, darker for others

        el.style.outline = `3px solid ${color}`;
        el.style.boxShadow = `0 0 10px ${color}`;
        el.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';

        // Add a visual tag
        const tag = document.createElement('div');
        tag.textContent = isLast ? '🎯 LAST MARKER' : `Marker ${i}`;
        tag.style.position = 'absolute';
        tag.style.background = color;
        tag.style.color = 'black';
        tag.style.fontSize = '10px';
        tag.style.padding = '2px 4px';
        tag.style.borderRadius = '2px';
        tag.style.top = '-20px';
        tag.style.right = '0';
        tag.style.zIndex = '9999';
        tag.style.whiteSpace = 'nowrap';

        // Ensure relative positioning on parent so absolute tag works
        if (el.parentElement) el.parentElement.style.position = 'relative';
        el.parentElement.appendChild(tag);

        console.log(`%c [Match ${i}]`, `color: ${color}; font-weight: bold;`, el);
    });

    console.log('');
    console.log('%c ✅ VERIFICATION SUCCESSFUL', 'font-size: 14px; font-weight: bold; color: #27ae60;');
    console.log('You should see the "..." button attached to the user/AI message pair highlighted in GREEN.');
    console.log('The most recent one behaves as the "Conversation Completed" signal.');

})();
