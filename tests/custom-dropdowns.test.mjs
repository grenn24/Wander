import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    return entry.isDirectory() ? sourceFiles(path) : /\.[jt]sx?$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test('UI uses custom dropdowns, never native select elements', async () => {
  const files = (await Promise.all(['app/', 'components/'].map((path) => (
    sourceFiles(new URL(`../${path}`, import.meta.url))
  )))).flat();
  for (const file of files) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /<select(?:\s|>)/,
      `${file.pathname} must use components/Select.jsx`);
  }
});
