import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// 노트 큰 편집창의 [폴더 ▾]: 어디서 열든(노트 화면 [크게], PC [+ 추가] → [노트], [큰 창에서 수정]) 보인다.
import {folderFromView, folderLabel, folderChoices, folderChanged} from '../app/note-folder-pick.mjs';

test('the default folder of a new note is the last viewed folder from the server view setting; all, none or unseen is 폴더 없음', () => {
  assert.equal(folderFromView('f:회의'), '회의');
  assert.equal(folderFromView('all'), null);
  assert.equal(folderFromView('none'), null);
  assert.equal(folderFromView(undefined), null);
  assert.equal(folderFromView(null), null);
  assert.equal(folderFromView('f:'), null);
  assert.equal(folderFromView(3), null);
});

test('a last viewed folder that no longer exists falls back to 폴더 없음 once the folder list is known', () => {
  assert.equal(folderFromView('f:회의', ['회의', '일기']), '회의');
  assert.equal(folderFromView('f:지워진', ['회의', '일기']), null);
  assert.equal(folderFromView('f:회의', []), null);
});

test('the button text and the sheet rows', () => {
  assert.equal(folderLabel('회의'), '회의');
  assert.equal(folderLabel(null), '폴더 없음');
  assert.equal(folderLabel(''), '폴더 없음');
  assert.deepEqual(folderChoices(['가', '나'], '가'), {names: ['가', '나'], none: false});
  assert.deepEqual(folderChoices(['가', '나'], null), {names: ['가', '나'], none: true});
  assert.deepEqual(folderChoices(['가'], '다'), {names: ['가', '다'], none: false});
});

test('an existing note writes its folder only when the chosen one differs', () => {
  assert.equal(folderChanged('가', '가'), false);
  assert.equal(folderChanged(null, undefined), false);
  assert.equal(folderChanged('', null), false);
  assert.equal(folderChanged('가', null), true);
  assert.equal(folderChanged(null, '가'), true);
});

test('all three big-window entrances pass a folder; the source wires the shared pick, the server view setting and the existing folder write', () => {
  const win = readFileSync('app/note-window.js', 'utf8');
  assert.match(win, /export function openNoteEditWindow\(\{value, photos, save, title = '', folder = null/);
  assert.match(win, /setNoteFolder\(\{id: note\.id\}, noteFolder\.get\(\), rt\)/);
  const top = readFileSync('app/topbar-actions.js', 'utf8');
  assert.match(top, /createNoteFolderPick\(\{initial:lastViewedFolder\(\)/);
  assert.match(top, /noteFolder:\{[^}]*write:true\}/);
  const notes = readFileSync('app/basket-notes.js', 'utf8');
  assert.match(notes, /noteFolder:\{label:\(\) => addTarget\(\)/);
  assert.match(notes, /openNoteEditWindow\(\{[^]*folder,/);
  assert.match(notes, /setNoteFolder\(note, name, rt\)/);
  const pick = readFileSync('app/note-folder-pick.js', 'utf8');
  assert.match(pick, /viewPrefs\.get\('note_folder'\)/);
  assert.match(pick, /createChoiceSheet/);
});
