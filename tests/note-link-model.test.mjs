// S69-98 NOTE-에버노트 ⑧ 노트 연결 [[ ]]: 주소 만들기·알아보기·'[[' 찾기·고르기·가리키는 노트(app/note-link-model.mjs) + 연결 정적 확인.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {noteLinkHref, noteLinkId, linkTyping, pickNotes, docHrefs, linkedIds, backlinks, PICK_MAX} from '../app/note-link-model.mjs';
import {safeHref} from '../app/ed-schema.mjs';

const A = 'a6900000-0000-4000-8000-000000000001', B = 'a6900000-0000-4000-8000-000000000002', C = 'a6900000-0000-4000-8000-000000000003';
test('주소: 앱 주소 바탕의 보통 링크, 편집기 링크 규칙 통과, 노트 연결만 알아본다', () => {
  const href = noteLinkHref(A, 'https://work.bokdoong.com/app/?view=basket&kind=note#x');
  assert.equal(href, `https://work.bokdoong.com/app/?view=basket&note=${A}`);
  assert.equal(safeHref(href), href);
  assert.equal(noteLinkId(href), A);
  assert.equal(noteLinkId(`http://127.0.0.1:8123/app/?view=basket&note=${A.toUpperCase()}`), A);
  for (const bad of ['https://work.bokdoong.com/app/?view=basket&note=x', `https://work.bokdoong.com/other/?view=basket&note=${A}`, `https://work.bokdoong.com/app/?view=library&note=${A}`, 'javascript:alert(1)', '', null])
    assert.equal(noteLinkId(bad), '');
  assert.equal(noteLinkHref('x', 'https://a.b/app/'), '');
  assert.equal(noteLinkHref(A, 'file:///app/'), '');
});
test("'[[' 찾기: 커서 앞 [[찾는말(30자·줄바꿈·괄호 없이)", () => {
  assert.deepEqual(linkTyping('메모 [['), {query: '', length: 2});
  assert.deepEqual(linkTyping('메모 [[임금 교섭'), {query: '임금 교섭', length: 7});
  assert.equal(linkTyping('메모 [[a]] 뒤'), null);
  assert.equal(linkTyping('[[' + 'ㄱ'.repeat(31)), null);
  assert.equal(linkTyping('[한 개'), null);
});
test('고르기: 자기·잠긴 노트 제외, 제목으로 시작하는 것 먼저, 비면 최근 순, 최대 8', () => {
  const notes = [{id: A, title: '임금 교섭', updated_at: '2026-11-01'}, {id: B, title: '교섭 결과 임금', updated_at: '2026-11-03'}, {id: C, title: '비밀 임금', updated_at: '2026-11-04', lock: true},
    ...Array.from({length: 12}, (_, i) => ({id: 'n' + i, title: '노트 ' + i, updated_at: '2026-10-' + String(10 + i)}))];
  const hidden = n => !!n.lock;
  assert.deepEqual(pickNotes(notes, '임금', {self: 'zz', hidden}).map(x => x.id), [A, B]);
  assert.deepEqual(pickNotes(notes, '임 금', {self: A, hidden}).map(x => x.id), [B]);
  assert.equal(pickNotes(notes, '', {hidden}).length, PICK_MAX);
  assert.equal(pickNotes(notes, '', {hidden})[0].id, B);
});
test('가리키는 노트: doc 안 링크만 세고, 자기·잠긴 노트 제외', () => {
  const link = id => ({type: 'text', text: 't', marks: [{type: 'link', attrs: {href: noteLinkHref(id, 'https://x.y/app/')}}]});
  const doc = (...nodes) => ({v: 'ed1', doc: {type: 'doc', content: [{type: 'paragraph', content: nodes}]}});
  const notes = [
    {id: A, title: '가', doc: doc(link(B), link(B), {type: 'text', text: 'x', marks: [{type: 'link', attrs: {href: 'https://example.com'}}]}), updated_at: '2026-11-01'},
    {id: C, title: '다', doc: doc(link(B)), updated_at: '2026-11-05'},
    {id: 'locked', title: '잠김', doc: doc(link(B)), lock: true},
    {id: B, title: '나', doc: doc(link(B))},
  ];
  assert.equal(docHrefs(notes[0].doc).length, 3);
  assert.deepEqual(linkedIds(notes[0]), [B]);
  assert.deepEqual(backlinks(B, notes, {hidden: n => !!n.lock}), [{id: C, title: '다'}, {id: A, title: '가'}]);
  assert.deepEqual(backlinks(A, notes), []);
});
test('연결: 노트 편집기만 [[ 목록, 읽기 화면은 앱 안에서 열기, 가리키는 노트는 관련 칸 한 곳', () => {
  const ed = readFileSync(new URL('../app/ed-editor.js', import.meta.url), 'utf8');
  // 노트 연결 부품은 노트 편집기(noteLinks)만 부르고, 본문을 화면에 놓기 전에 함께 불러 둔다(본문이 보이면 편집기는 다 된 상태).
  assert.match(ed, /const \[pm, noteLinkLib\] = await Promise\.all\(\[loadEditorLib\(\), noteLinks \? import\('\.\/ed-note-link\.js'\) : null\]\);/);
  assert.match(ed, /if \(noteLinks\) \{\n    noteLinkPart = noteLinkLib\.mountNoteLink\(\{/);
  assert.ok(ed.indexOf("import('./ed-note-link.js')") < ed.indexOf('new pm.EditorView('), '노트 연결 부품은 본문(EditorView)보다 먼저 불러온다');
  const notes = readFileSync(new URL('../app/basket-notes.js', import.meta.url), 'utf8');
  assert.match(notes, /noteLinks:linksFor\(id\), tasks:noteTaskProvider\(id, \{rt\}\)\}\);/); // S69-97: 노트 칸은 구글 할 일(tasks)도 함께 넘긴다
  assert.match(notes, /const target = noteLinkId\(a\.getAttribute\('href'\)\); if \(!target\) return;/);
  assert.match(readFileSync(new URL('../app/note-related.js', import.meta.url), 'utf8'), /backlinks\(note\.id, notes, \{hidden, titleOf\}\)/);
  assert.doesNotMatch(readFileSync(new URL('../app/ed-note-link.js', import.meta.url), 'utf8'), /(?:local|session)Storag[e]|fetch\(/);
});
