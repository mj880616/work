import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitTaskNotes, joinTaskNotes, taskAttachments, noteFileLine } from '../app/task-note-files.mjs';
import { taskAttachHtml, fileLinksHtml } from '../app/task-files.js';

// TASK-첨부열기: one reader/writer for the "첨부: 이름 주소" lines of a Google task's notes (card + edit window + save).
const url = id => `https://drive.google.com/file/d/${id}/view`;
const line = (id, name) => `첨부: ${name} ${url(id)}`;

test('the line format is the one the Edge writes', () => {
  const edge = readFileSync(new URL('../supabase/functions/google-tasks/task-files.ts', import.meta.url), 'utf8');
  assert.ok(edge.includes('`첨부: ${lineName(f.file_name)} ${fileUrl(f.drive_file_id)}`'));
  assert.ok(edge.includes('`https://drive.google.com/file/d/${id}/view`'));
  assert.equal(noteFileLine({ drive_file_id: 'f1', file_name: '  회의록 \n최종.pdf ' }), line('f1', '회의록 최종.pdf'));
});

test('split: the memo has no attachment lines, attachments keep order, others are kept', () => {
  const notes = ['내 메모', line('f1', '회의록 최종.pdf'), '첨부: 주소 없는 줄', line('f2', 'a.png'), line('f1', '회의록 최종.pdf')].join('\n');
  const {memo, attachments} = splitTaskNotes(notes);
  assert.equal(memo, '내 메모\n첨부: 주소 없는 줄');
  assert.deepEqual(attachments, [{drive_file_id: 'f1', file_name: '회의록 최종.pdf'}, {drive_file_id: 'f2', file_name: 'a.png'}]);
});

test('split: notes without a line come back exactly as they are', () => {
  for (const text of ['', '메모\n', '  앞뒤 공백  \n\n', '첨부: x https://example.org/file/d/a/view']) {
    assert.deepEqual(splitTaskNotes(text), {memo: text, attachments: []});
  }
  assert.deepEqual(splitTaskNotes(null), {memo: '', attachments: []});
});

test('join: memo + lines; saving never loses or doubles an attachment', () => {
  const notes = ['내 메모', line('f1', 'a.pdf'), line('f2', 'b.png')].join('\n');
  const {memo, attachments} = splitTaskNotes(notes);
  assert.equal(joinTaskNotes(memo, attachments), notes, 'an untouched round trip is identical');
  const edited = joinTaskNotes('고친 메모\n', attachments);
  assert.equal(edited, ['고친 메모', line('f1', 'a.pdf'), line('f2', 'b.png')].join('\n'));
  // Saving again from what was saved gives the same notes (no second copy of a line).
  const again = splitTaskNotes(edited);
  assert.equal(joinTaskNotes(again.memo, again.attachments), edited);
  assert.equal((edited.match(/첨부: /g) || []).length, 2);
  // Duplicates in the input are written once; an empty memo leaves only the lines; no attachments leaves the memo untouched.
  assert.equal(joinTaskNotes('', [...attachments, attachments[0]]), [line('f1', 'a.pdf'), line('f2', 'b.png')].join('\n'));
  assert.equal(joinTaskNotes('메모 \n', []), '메모 \n');
  assert.equal(joinTaskNotes('메모', undefined), '메모');
});

test('taskAttachments: link-table files first (their names win), then lines only in the notes, no duplicates', () => {
  const notes = ['m', line('f1', '옛 이름.pdf'), line('f3', 'c.hwp')].join('\n');
  const merged = taskAttachments(notes, [{drive_file_id: 'f2', file_name: 'b.png', size_bytes: 4}, {drive_file_id: 'f1', file_name: '새 이름.pdf', size_bytes: 9}]);
  assert.deepEqual(merged.map(f => [f.drive_file_id, f.file_name]), [['f2', 'b.png'], ['f1', '새 이름.pdf'], ['f3', 'c.hwp']]);
  assert.deepEqual(taskAttachments('메모만', []), []);
});

test('edit-window rows: icon, one-line name, [열기] [내려받기] using the shared file buttons', () => {
  assert.equal(taskAttachHtml({base: []}), '');
  const html = taskAttachHtml({base: [{drive_file_id: 'f1', file_name: '<b>"x"</b>.pdf'}, {drive_file_id: 'f2', file_name: 'b.png'}]});
  assert.equal((html.match(/class="gt-att-row"/g) || []).length, 2);
  assert.equal((html.match(/data-fa-menu="open"/g) || []).length, 2);
  assert.equal((html.match(/data-fa-menu="download"/g) || []).length, 2);
  assert.match(html, /data-fa-id="f1"/);
  assert.ok(!html.includes('<b>"x"'), 'names are escaped');
  assert.match(html, />열기<\/button>/);
  assert.match(html, />내려받기<\/button>/);
  // Read-only (no link table yet): no 교체·빼기·붙이기.
  assert.doesNotMatch(html, /data-gt-att-(swap|remove|add)/);
});

test('card name stays a link that opens the file; long names end in an ellipsis on one line', () => {
  assert.match(fileLinksHtml([{drive_file_id: 'f1', file_name: 'a.pdf'}]), /data-fa-press/);
  const css = readFileSync(new URL('../app/google-tasks.css', import.meta.url), 'utf8');
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].split(',').some(s => s.trim() === '.gt-files .gt-file'))[2];
  assert.match(rule, /display:block/);
  assert.match(rule, /text-overflow:ellipsis/);
  assert.match(rule, /white-space:nowrap/);
  assert.match(rule, /overflow:hidden/);
});
