// FORGET-노트고르기(요청함 11/09 13:34, 시안 docs/design/mockups/forget-note-pick.html): 잊지 말기 [노트] 창의 노트 고르기·끝에 더하기 규칙.
// 화면·서버 없이 순수 부분과 소스 계약을 본다. 글·이름은 모두 지어낸 것('가족'·가짜 이름만).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pickSections, tailLines, folderNameOf} from '../app/note-pick.mjs';
import {appendDoc} from '../app/family-note-send.mjs';

const src = p => readFileSync(new URL(`../app/${p}`, import.meta.url), 'utf8');
const F1 = 'a0000000-0000-4000-8000-000000000001', F2 = 'a0000000-0000-4000-8000-000000000002';
const folders = [{id: F1, parent_id: null, name: '01. 업무메모', sort_order: 0}, {id: F2, parent_id: null, name: '가족', sort_order: 1}];
const note = (n, over = {}) => ({id: `n${n}`, title: `가짜 노트 ${n}`, raw_text: `첫 줄\n둘째 줄\n셋째 줄 ${n}`, updated_at: `2026-11-0${n}T00:00:00Z`, ai_export_allowed: true, metadata: {}, ...over});
const notes = [note(1, {metadata: {folder_id: F1, folder: '01. 업무메모'}}), note(2, {ai_export_allowed: false, metadata: {folder_id: F2, folder: '가족'}}), note(3)];

test('최근 노트는 고친 때 최근 순 5개, 폴더 나무는 접힌 폴더 + 폴더 없음 묶음', () => {
  const {recent, tree} = pickSections({notes, folders});
  assert.deepEqual(recent.map(r => r.id), ['n3', 'n2', 'n1']);
  assert.equal(recent.find(r => r.id === 'n1').path, '01. 업무메모');
  assert.deepEqual(tree.map(r => r.type), ['folder', 'folder', 'outside']);
  const opened = pickSections({notes, folders, open: new Set([F1])}).tree;
  assert.deepEqual(opened.filter(r => r.type === 'note').map(r => r.id), ['n1']);
});

test('찾기: 최근 노트는 숨기고 맞는 노트가 든 폴더만 펼친다', () => {
  const {recent, tree} = pickSections({notes, folders, query: '가짜 노트 1'});
  assert.deepEqual(recent, []);
  assert.deepEqual(tree.filter(r => r.type === 'note').map(r => r.id), ['n1']);
});

test('가족 줄: AI가 읽지 않는 노트(ai_export_allowed=false)만 보인다', () => {
  const {recent, tree} = pickSections({notes, folders, family: true, open: new Set([F1, F2])});
  assert.deepEqual(recent.map(r => r.id), ['n2']);
  assert.deepEqual(tree.filter(r => r.type === 'note').map(r => r.id), ['n2']);
});

test('마지막 두 줄(앞에 더 있으면 more), 비밀 모양 노트도 가리지 않는다(NOTE-AI제외정리)', () => {
  assert.deepEqual(tailLines(note(1)), {lines: ['둘째 줄', '셋째 줄 1'], more: true});
  assert.deepEqual(tailLines({raw_text: '한 줄'}), {lines: ['한 줄'], more: false});
  assert.deepEqual(tailLines({raw_text: 'password: abcdefgh1234\n다음'}).lines, ['password: abcdefgh1234', '다음']);
  assert.equal(folderNameOf(notes[0], folders), '01. 업무메모');
  assert.equal(folderNameOf(notes[2], folders), '');
});

test('끝에 더하기: 노트 다른 내용 그대로, 끝·더할 글의 빈 문단은 걷어 내고 문단으로 붙인다. 빈 글이면 null', () => {
  const p = text => ({type: 'paragraph', attrs: {style: 'body2'}, content: text ? [{type: 'text', text}] : []});
  const base = {v: 'ed1', doc: {type: 'doc', content: [p('예전 줄'), p('')]}};
  const add = {v: 'ed1', doc: {type: 'doc', content: [p(''), p('더할 줄'), p(''), p('소식 · 11/9')]}};
  const out = appendDoc(base, add);
  assert.deepEqual(out.doc.content.map(n => n.content?.[0]?.text ?? ''), ['예전 줄', '더할 줄', '소식 · 11/9']);
  assert.equal(appendDoc(base, {v: 'ed1', doc: {type: 'doc', content: [p('')]}}), null);
  assert.deepEqual(appendDoc(null, add).doc.content.map(n => n.content?.[0]?.text), ['더할 줄', '소식 · 11/9']);
});

test('가족 노트 경계: 저장 함수가 읽은 행을 다시 보고, PATCH도 ai_export_allowed=false 행에만 쓴다', () => {
  const fam = src('family-note-send.js'), append = src('note-append.js'), data = src('basket-data.js');
  assert.match(append, /if \(familyOnly && row\.ai_export_allowed !== false\) throw/);
  assert.match(append, /aiExcluded: familyOnly/);
  assert.match(data, /\$\{aiExcluded \? '&ai_export_allowed=is\.false' : ''\}/);
  // 고르기 창 읽기도 가족 줄은 가족 노트만(서버 조건).
  assert.match(src('note-pick.js'), /\$\{family \? '&ai_export_allowed=is\.false' : ''\}/);
  // 새 가족 노트·잊지 말기 노트는 늘 AI 재료에서 뺀다.
  assert.match(fam, /createNoteDoc\(\{title: where === 'list' \? LIST_TITLE : [^\n]*ai_export_allowed: false,/);
  // 옛 작은 '노트로 보내기' 창은 없앴다(같은 노트 창 하나).
  assert.doesNotMatch(fam, /familyNoteSend|data-fs-/);
});

test('업무 줄 기본값: 새 노트 · 폴더 01. 업무메모(없으면 폴더 없음), 기존 노트는 미리 고르지 않는다', () => {
  const list = src('forget-list.js');
  assert.match(list, /export const WORK_NOTE_FOLDER = '01\. 업무메모';/);
  assert.match(list, /createNoteFolderPick\(\{rt, initial: WORK_NOTE_FOLDER/);
  assert.match(list, /target: createNoteTarget\(\{rt\}\)/);
});

test('노트 보드 노트 고르기와 잊지 말기 노트 고르기가 같은 줄 부품(note-tree-row.js)을 쓴다', () => {
  assert.match(src('note-boards.js'), /noteTreeRowHtml\(r, \{esc, folderAttr:'nbb-pf', noteAttr:'nbb-pn', check:true/);
  assert.match(src('note-pick.js'), /noteTreeRowHtml\(r, \{folderAttr: 'np-folder', noteAttr: 'np-note'/);
});
