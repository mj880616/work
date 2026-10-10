import { readFileSync, writeFileSync } from 'node:fs';

// Percent-encoding keeps the original code byte-for-byte reviewable without
// minifier/dependency differences. Newlines and comments survive decoding.
const source = readFileSync(new URL('./library-upload-diag.js', import.meta.url), 'utf8').trim();
const bookmark = 'javascript:' + encodeURIComponent(source) + '\n';
const target = new URL('./library-upload-diag.bookmarklet.txt', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== bookmark) throw new Error('Bookmark differs; run this generator.');
} else {
  writeFileSync(target, bookmark);
}
