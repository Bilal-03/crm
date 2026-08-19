import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['api', 'server', 'src/lib', 'scripts', 'tests'];
const files = roots.flatMap(root => collectJavaScriptFiles(path.resolve(root)));
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || `Failed to parse ${file}\n`);
  }
}

if (failed) process.exitCode = 1;
else console.log(`Lint parse check passed for ${files.length} JavaScript files.`);

function collectJavaScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(entryPath);
    return /\.(?:js|mjs)$/.test(entry.name) ? [entryPath] : [];
  });
}
