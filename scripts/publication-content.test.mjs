import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const pressRoot = join(root, 'press');
const archive = JSON.parse(readFileSync(join(pressRoot, 'archive.json'), 'utf8'));
const hub = readFileSync(join(pressRoot, 'index.html'), 'utf8');

test('archive entries resolve to local pages and the newest is listed on the press hub', () => {
  assert.equal(archive.version, 1);
  assert.equal(archive.base_path, '/work/press/');
  assert.ok(archive.items.length > 0);
  const seen = new Set();
  for (const item of archive.items) {
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['release', 'request', 'statement'].includes(item.type));
    assert.ok(item.title.trim());
    assert.match(item.href, /^(?:\.\/|\.\.\/)[a-zA-Z0-9/-]+\/$/);
    assert.ok(!seen.has(item.href), `duplicate archive href: ${item.href}`);
    seen.add(item.href);
    const page = resolve(pressRoot, item.href, 'index.html');
    assert.ok(page.startsWith(root + sep), `archive path escapes repository: ${item.href}`);
    assert.ok(existsSync(page), `missing archive page: ${item.href}`);
  }
  assert.ok(hub.includes(`href="${archive.items[0].href}"`), 'newest archive item is missing from press hub');
});

test('press pages have no Web1 upload input requiring the main-push dropzone workflow', () => {
  const pages = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.html')) pages.push(path);
    }
  };
  visit(pressRoot);
  for (const page of pages) {
    assert.doesNotMatch(readFileSync(page, 'utf8'), /\btype\s*=\s*\\?["']file\\?["']/i, `file upload input in ${page}`);
  }
});
