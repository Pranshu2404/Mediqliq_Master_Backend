const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['node_modules']);
let failures = 0;

function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(item.name)) continue;
    const current = path.join(directory, item.name);
    if (item.isDirectory()) {
      walk(current);
    } else if (item.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', current], {
        encoding: 'utf8'
      });
      if (result.status !== 0) {
        failures += 1;
        console.error(result.stderr);
      }
    }
  }
}

walk(root);
if (failures) process.exit(1);
console.log('All JavaScript files passed node --check');
