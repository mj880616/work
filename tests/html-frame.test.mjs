import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// BUG-노트HTML표시: memo and note read views draw .html attachments through one shared painter (html-frame.js).
import {htmlAttachments} from '../app/html-frame.js';

test('only .html/.htm attachments with a Drive file id are shown as frames, in order', () => {
  const files = [
    {drive_file_id: 'a', file_name: 'chatgpt-20261018-0900.html'},
    {drive_file_id: 'b', file_name: '회의록.hwp'},
    {drive_file_id: 'c', file_name: 'OLD.HTM'},
    {drive_file_id: '', file_name: 'empty.html'},
    {file_name: 'missing-id.html'},
    null,
    {drive_file_id: 'd', file_name: 'page.html.txt'},
  ];
  assert.deepEqual(htmlAttachments(files).map(file => file.drive_file_id), ['a', 'c']);
  assert.deepEqual(htmlAttachments(undefined), []);
  assert.deepEqual(htmlAttachments('x'), []);
});

test('memo and note read views share the painter instead of copying it', () => {
  const read = name => readFileSync(new URL(`../app/${name}`, import.meta.url), 'utf8');
  for (const name of ['basket.js', 'basket-notes.js']) {
    const source = read(name);
    assert.match(source, /import \{[^}]*\bpaintHtmlAttachments\b[^}]*\} from '\.\/html-frame\.js';/, name);
    assert.doesNotMatch(source, /openBasketHtml|mountHtmlFrame|frameDocument/, `${name} must not build frames itself`);
  }
  const frame = read('html-frame.js');
  assert.match(frame, /setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.match(frame, /action: 'html-view'/);
});
