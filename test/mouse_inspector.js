
(function () {
    console.clear();
    console.log('%c 🕵️ CLICK ON THE "..." MARKER ', 'background: #9b59b6; color: white; font-size: 16px; padding: 10px; border-radius: 4px;');
    console.log('%c Hold "Alt" and click the "..." to identify it.', 'color: #9b59b6; font-weight: bold;');
    console.log('%c If the "..." is inside a chat iframe, switch DevTools context first!', 'color: #e67e22;');
    console.log('');
    console.log('%c💡 To switch context: Look at the dropdown at TOP of console that says "top" - change it to the chat iframe', 'color: #3498db;');

    function handler(e) {
        if (!e.altKey) return;
        e.preventDefault();
        e.stopPropagation();

        const el = e.target;
        console.clear();
        console.log(`%c CLICKED ELEMENT @ ${new Date().toLocaleTimeString()}`, 'background: #333; color: #bada55; font-size: 14px; padding: 4px;');

        // --- 1. TARGET ---
        console.log('%c🎯 TARGET', 'font-size: 16px; color: #e74c3c; font-weight: bold;');

        const tagName = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const classes = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : '';

        console.log(`Selector: ${tagName}${id}${classes}`);
        console.log(`Text: "${el.innerText?.trim().slice(0, 50)}"`);
        console.log(`HTML:`, el.outerHTML);

        const attrs = {};
        for (let a of el.attributes) attrs[a.name] = a.value;
        console.log('Attributes:', attrs);

        // --- 2. PARENT TABLE ---
        console.log('%c⬆️ PARENTS', 'font-size: 14px; color: #3498db; font-weight: bold; margin-top: 10px;');

        let curr = el.parentElement;
        let depth = 1;
        const hierarchy = [];

        while (curr && depth <= 10) {
            hierarchy.push({
                'Lvl': depth,
                'Tag': curr.tagName.toLowerCase(),
                'ID': curr.id || '-',
                'Classes': (curr.className || '').slice(0, 50),
                'Role': curr.getAttribute('role') || '-'
            });
            curr = curr.parentElement;
            depth++;
        }
        console.table(hierarchy);

        // --- 3. SIBLINGS (important for checking what's "below") ---
        console.log('%c↔️ SIBLINGS', 'font-size: 14px; color: #27ae60; font-weight: bold; margin-top: 10px;');

        const parent = el.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children);
            const myIndex = siblings.indexOf(el);
            console.log(`Position: ${myIndex + 1} of ${siblings.length} children`);

            const siblingInfo = siblings.map((sib, i) => ({
                '#': i,
                'Current': i === myIndex ? '👉' : '',
                'Tag': sib.tagName.toLowerCase(),
                'Text': (sib.innerText || '').trim().slice(0, 30),
                'Classes': (sib.className || '').slice(0, 30)
            }));
            console.table(siblingInfo);
        }

        // --- 4. CSS Path ---
        console.log('%c🏁 CSS PATH', 'font-size: 14px; color: #9b59b6; font-weight: bold;');
        console.log(getCssPath(el));

        window._clickedEl = el;
        console.log('%c Stored as window._clickedEl', 'color: #888;');
    }

    function getCssPath(el) {
        if (!(el instanceof Element)) return '';
        var path = [];
        while (el.nodeType === Node.ELEMENT_NODE) {
            var selector = el.nodeName.toLowerCase();
            if (el.id) {
                selector += '#' + el.id;
                path.unshift(selector);
                break;
            } else {
                var sib = el, nth = 1;
                while (sib = sib.previousElementSibling) {
                    if (sib.nodeName.toLowerCase() == selector) nth++;
                }
                if (nth != 1) selector += `:nth-of-type(${nth})`;
            }
            path.unshift(selector);
            el = el.parentNode;
        }
        return path.join(" > ");
    }

    document.addEventListener('click', handler, true);
    document.addEventListener('mousedown', handler, true);

    console.log('✔ Ready. Alt+Click the "..." now.');
})();
