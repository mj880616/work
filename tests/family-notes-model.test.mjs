// FAMILY-잊지말기 4단계 + S51-26 FAMILY-노트로: 홈 '잊지 말기' 칸 규칙(app/family-notes-model.mjs)과 [노트로] 규칙(app/family-note-send.mjs). 글은 지어낸 값.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanNotes, suggestions, metaLine, draftOf, decisionBody, openedFromPush, shortDay, noteLine, FIRM_LABEL, NOTE_SELECT} from '../app/family-notes-model.mjs';
import {appendLines, defaultFolder, listNoteIn, newNoteTitle, nextTopOrder, isListNote, FAMILY_FOLDER} from '../app/family-note-send.mjs';
import {toPlain} from '../app/ed-text.mjs';
const id = n => `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rows = [
  {id: id(1), kind: 'plan', body: '토요일에 산책\n가자고 함', said_when: '토요일', firmness: 'planned', origin: 'telegram', origin_day: '2026-11-05', status: 'new'},
  {id: id(2), kind: 'like', body: '소금빵 좋아함', firmness: 'firm', origin: 'call', origin_day: '2026-11-06', status: 'kept'},
  {id: id(3), kind: 'ask', body: '우유 사 오기', firmness: 'firm', origin: 'telegram', origin_day: '2026-11-01', status: 'tasked'},
  {id: 'not-a-uuid', kind: 'plan', body: 'x', status: 'new'},
  {id: id(5), kind: 'feelings', body: 'x', status: 'new'},
  {id: id(6), kind: 'gift', body: '   ', status: 'new'},
];
test('줄 다듬기: 모양이 틀린 줄은 버리고, 제어문자는 빈칸', () => {
  const n = cleanNotes(rows);
  assert.deepEqual(n.map(x => x.id), [id(1), id(2), id(3)]);
  assert.equal(n[0].body, '토요일에 산책 가자고 함');
  assert.equal(cleanNotes(null).length, 0);
  assert.doesNotMatch(NOTE_SELECT, /raw|text|transcript/);
});
test('제안과 한 줄 정보: 확정은 꼬리표 없음, 예정·확인만', () => {
  const n = cleanNotes(rows);
  assert.deepEqual(suggestions(n).map(x => x.id), [id(1)]);
  assert.equal(metaLine(n[0]), '말한 때: 토요일 · 텔레그램 · 11/5');
  assert.equal(shortDay('bad'), '');
  assert.deepEqual(draftOf(n[0]), {title: '토요일에 산책 가자고 함', memo: '말한 때: 토요일'});
  assert.equal(FIRM_LABEL.firm, '');
  assert.equal(FIRM_LABEL.planned, '예정');
});
test('고치는 칸은 상태 칸뿐(제안으로 되돌리면 결정 시각을 비움)', () => {
  assert.deepEqual(Object.keys(decisionBody('kept', 't')).sort(), ['decided_at', 'status', 'updated_at']);
  assert.equal(decisionBody('new', 't').decided_at, null);
  assert.equal(decisionBody('deleted', 't'), null);
  assert.equal(openedFromPush('?view=home&family=1'), true);
  assert.equal(openedFromPush('?view=home'), false);
});
test('노트 한 줄 = 체크 목록 한 줄 ☐ 내용 (출처 날짜 · 말한 때)', () => {
  const n = cleanNotes(rows);
  assert.equal(noteLine(n[1]), '☐ 소금빵 좋아함 (통화 11/6)');
  assert.equal(noteLine(n[0]), '☐ 토요일에 산책 가자고 함 (텔레그램 11/5 · 말한 때: 토요일)');
  assert.equal(noteLine(n[2], true), '☑ 우유 사 오기 (텔레그램 11/1)');
  assert.equal([...noteLine({...n[1], body: '가'.repeat(400)})].length, 300);
});
test('노트 더하기: 끝에 한 문단씩, 끝 빈 문단은 걷어 냄, 글자는 한 줄씩', () => {
  const one = appendLines(null, ['☐ 가']);
  assert.equal(one.doc.content.length, 1);
  const two = appendLines({v: 'ed1', doc: {type: 'doc', content: [...one.doc.content, {type: 'paragraph', attrs: {style: 'body2'}}]}}, ['☐ 나']);
  assert.equal(two.doc.content.length, 2);
  assert.equal(toPlain(two), '☐ 가\n\n☐ 나');
  assert.equal(appendLines({bad: 1}, ['☐ 다']).doc.content.length, 1);
});
test('폴더: 마지막으로 더한 잊지 말기 노트의 폴더, 없으면 가족(없으면 만듦)', () => {
  const folders = [{id: 'a', parent_id: null, name: '업무', sort_order: 0}, {id: 'b', parent_id: null, name: FAMILY_FOLDER, sort_order: 3}, {id: 'c', parent_id: 'a', name: '하위', sort_order: 0}];
  const lists = [{id: 'n1', metadata: {family_list: true, folder_id: 'c', folder: '하위'}}, {id: 'n2', metadata: {family_list: true, folder_id: 'b'}}, {id: 'x', metadata: {}}];
  assert.equal(defaultFolder(lists, folders).folder.id, 'c');
  assert.equal(defaultFolder([], folders).folder.id, 'b');
  assert.deepEqual(defaultFolder([], folders.slice(0, 1)), {folder: null, create: true});
  assert.deepEqual(defaultFolder(lists, folders, false), {folder: null, create: false});
  assert.equal(listNoteIn(lists, 'b', folders).id, 'n2');
  assert.equal(listNoteIn(lists, 'a', folders), null);
  assert.equal(listNoteIn([{id: 'o', metadata: {family_list: true}}], null, folders).id, 'o');
  assert.equal(isListNote(lists[2]), false);
  assert.equal(nextTopOrder(folders), 4);
  assert.equal(nextTopOrder([]), 0);
  assert.equal(newNoteTitle('  소금빵   좋아함 '), '소금빵 좋아함');
});
