const fs = require('fs');
const p = require('./lib/auto-run-patcher');
const bp = p.findAntigravityPath();
const files = p.getTargetFiles(bp);

const f = files.find(x => x.label === 'jetskiAgent');
const c = fs.readFileSync(f.path, 'utf8');

// Look for write_to_file step renderer 
const writeIdx = c.indexOf('"write_to_file"');
if (writeIdx >= 0) {
    console.log('=== write_to_file references ===');
    // Show context around each reference
    let si = 0;
    let count = 0;
    while (count < 5) {
        const idx = c.indexOf('"write_to_file"', si);
        if (idx === -1) break;
        console.log('At ' + idx + ': ' + c.substring(Math.max(0, idx - 100), idx + 200));
        console.log();
        si = idx + 1;
        count++;
    }
} else {
    console.log('No "write_to_file" string found');
}

// Also look for Xui, qci, edi components (which reference filePermissionRequest)
// to understand what tool types they render
for (const compName of ['Xui', 'qci', 'edi', 'zci']) {
    const compDef = c.indexOf(',' + compName + '=({');
    if (compDef >= 0) {
        const ctx = c.substring(compDef, compDef + 800);
        // Try to find what step type this renders
        console.log('=== ' + compName + ' component ===');
        console.log(ctx.substring(0, 600));
        console.log();
    }
}

// Also check for the "fullFile" case which might be for write_to_file
console.log('\n=== fullFile case context ===');
const ffIdx = c.indexOf('case:"fullFile"');
if (ffIdx >= 0) {
    console.log(c.substring(Math.max(0, ffIdx - 200), ffIdx + 500));
}
