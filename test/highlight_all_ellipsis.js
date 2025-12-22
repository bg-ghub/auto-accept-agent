
(function () {
    console.clear();
    console.log('%c 🌈 ELLIPSIS HIGHLIGHTER + SELECTORS ', 'background: #27ae60; color: white; font-size: 16px; padding: 10px;');

    var COLORS = ['#e74c3c', '#3498db', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c', '#e91e63'];
    var iconButtons = document.querySelectorAll('.anysphere-icon-button');

    console.log('Found ' + iconButtons.length + ' icon buttons');

    var results = [];

    // Helper to generate a unique-ish selector
    function getSelector(el) {
        var path = [];
        var current = el;
        // Go up 5 levels or until body
        for (var i = 0; i < 6 && current && current !== document.body; i++) {
            var signature = current.tagName.toLowerCase();
            if (current.id) {
                signature += '#' + current.id;
            } else if (current.className && typeof current.className === 'string') {
                // Take specific meaningful classes
                var classes = current.className.split(/\s+/).filter(c =>
                    c.includes('pair') || c.includes('composer') || c.includes('feedback') || c.includes('icon')
                );
                if (classes.length > 0) signature += '.' + classes.join('.');
            }
            path.unshift(signature);
            current = current.parentElement;
        }
        return path.join(' > ');
    }

    iconButtons.forEach(function (btn, i) {
        var color = COLORS[i % COLORS.length];
        var rect = btn.getBoundingClientRect();
        var messagePair = btn.closest('.composer-human-ai-pair-container');

        btn.style.outline = '4px solid ' + color;
        btn.style.backgroundColor = color + '33';

        var selector = getSelector(btn);

        var info = {
            'Index': i,
            'Color': color,
            'InMsg': !!messagePair,
            'Selector': selector
        };
        results.push(info);

        console.log('%c[' + i + '] ' + color, 'color: ' + color + '; font-weight: bold;');
        console.log('   Selector: ' + selector);
        console.log('   Classes: ' + btn.className);
    });

    console.table(results);
    return 'Check the console logs for full selectors';
})();
