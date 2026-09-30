import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missingDropzones } from './check-web1-file-dropzone.mjs';

test('flags Web1 upload pages without the shared helper', () => {
  const files = [
    ['public-policy/index.html', '<input type="file"><body></body>'],
    ['workforce/index.html', '<INPUT TYPE=\'FILE\'><script src="/work/assets/file-dropzone.js?v=20260913"></script>'],
    ['app/index.html', '<input type="file">'],
    ['press/index.html', '<a download href="file.pdf">PDF</a>'],
  ];
  assert.deepEqual(missingDropzones(files), ['public-policy/index.html']);
});

test('handles escaped quotes used in existing Web1 markup', () => {
  assert.deepEqual(missingDropzones([['p/index.html', String.raw`<input type=\"file\">`]]), ['p/index.html']);
});
