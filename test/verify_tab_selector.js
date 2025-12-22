
(function () {
    console.clear();
    console.log('%c 🕵️ VERIFYING TAB SELECTOR ', 'background: #2c3e50; color: #ecf0f1; font-size: 16px; padding: 10px; border-radius: 4px;');

    const TARGET_TEXT = "ascii cat in terminal"; // The text we are hunting for

    // Constructing selector based on user provided hierarchy:
    // Level 3: ul.actions-container[role="tablist"]
    //   -> Level 2: li.action-item.composite-bar-action-tab[role="tab"]
    //      -> Level 1: div.composite-bar-action-tab-label

    const selector = 'ul.actions-container[role="tablist"] li.action-item[role="tab"] .composite-bar-action-tab-label';

    console.log(`%c Testing Selector: "${selector}"`, 'color: #3498db; font-weight: bold;');

    const candidates = document.querySelectorAll(selector);
    console.log(`%c Found ${candidates.length} candidate tabs in total.`, 'color: #3498db;');

    let found = null;

    candidates.forEach((el, index) => {
        const text = el.innerText || el.textContent;
        const cleanText = text.trim().toLowerCase();

        console.groupCollapsed(`Candidate #${index + 1}: "${text.trim()}"`);
        console.log('Element:', el);
        console.log('Classes:', el.className);
        console.groupEnd();

        if (cleanText.includes(TARGET_TEXT.toLowerCase()) ||
            TARGET_TEXT.toLowerCase().includes(cleanText) && cleanText.length > 3) {
            found = el;
        }
    });

    if (found) {
        console.log('%c ✅ TARGET FOUND!', 'background: #27ae60; color: white; font-size: 16px; padding: 5px; margin-top: 10px;');
        console.log('Element:', found);

        // Find the clickable parent (the li[role="tab"])
        const tabParent = found.closest('li[role="tab"]');
        console.log('%c Clickable Parent (Tab):', 'color: #e67e22; font-weight: bold;', tabParent);

        // Highlight it
        found.style.outline = "3px solid red";
        found.style.backgroundColor = "rgba(255, 255, 0, 0.3)";
        if (tabParent) tabParent.style.outline = "3px solid orange";

        console.log('✨ I have highlighted the element in VS Code for you to see.');
    } else {
        console.log('%c ❌ Target text not matched in any tab.', 'color: #c0392b; font-weight: bold;');
        console.log('Here are all the tab labels I found:');
        Array.from(candidates).forEach(c => console.log(` - "${c.innerText.trim()}"`));
    }

})();
