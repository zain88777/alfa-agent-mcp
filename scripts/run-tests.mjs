import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function getTestFiles(dir, pattern = /\.test\.ts$/) {
  const files = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getTestFiles(fullPath, pattern));
      } else if (entry.isFile() && pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    // Directory might not exist, skip it
  }
  return files;
}

const testDirs = ['test'];
const files = [];

for (const dir of testDirs) {
  files.push(...getTestFiles(dir));
}

if (files.length === 0) {
  console.error('No test files found in test/**/*.test.ts');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  stdio: 'inherit',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}
process.exit(1);