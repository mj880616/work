// S69-98 NOTE-에버노트 ⑦ 관련 노트: 낱말·점수·고르기·자료 검색 낱말(app/note-related-model.mjs) + 화면 연결 정적 확인.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {words, keywords, relation, relatedNotes, docQuery, docRows, REL_MAX} from '../app/note-related-model.mjs';

const n = (id, title, raw_text, extra = {}) => ({id, title, raw_text, updated_at: '2026-11-0' + (id.length % 9) + 'T00:00:00Z', ...extra});
test('낱말: 조사 떼기·짧은 말·숫자·주소·흔한 말 제외', () => {
  assert.deepEqual(words('임금협상은 https://x.com/a 2026 그리고 교섭에서 a 임금협상을'), ['임금협상', '교섭', '임금협상']);
  const k = keywords(n('a', '임금 교섭', '교섭 일정 교섭 자료 교섭 교섭'));
  assert.equal([...k.keys()][0], '교섭'); // 제목 3 + 본문 최대 3
  assert.equal(k.get('교섭'), 6); assert.equal(k.get('임금'), 3);
});
test('관련: 태그·낱말이 겹쳐야 하고, 같은 폴더만으로는 아니다', () => {
  const tagsOf = x => x.tags || [], folderOf = x => x.folder || null;
  const a = n('a', '임금 교섭 준비', '사측 안 검토', {tags: ['교섭'], folder: 'f1'});
  assert.deepEqual(relation(a, n('b', '여행 계획', '바다', {folder: 'f1'}), {tagsOf, folderOf}), {score: 0, why: ''});
  const byTag = relation(a, n('c', '다른 글', '내용', {tags: ['교섭']}), {tagsOf, folderOf});
  assert.equal(byTag.why, '#교섭'); assert.ok(byTag.score >= 4);
  const byWord = relation(a, n('d', '임금 교섭 결과', '정리', {folder: 'f1'}), {tagsOf, folderOf});
  assert.ok(byWord.score >= 4); assert.match(byWord.why, /임금|교섭/);
});
test('relatedNotes: 자기·잠긴·가족 노트 제외, 점수 순, 최대 4개', () => {
  const tagsOf = x => x.tags || [], folderOf = () => null;
  const me = n('me', '현장 안전 점검', '안전 점검 결과 정리', {tags: ['안전']});
  const list = [me, n('locked', '안전 점검 비밀', '안전', {tags: ['안전'], lock: true}), n('fam', '안전 점검', '안전', {metadata: {family_list: true}}),
    ...Array.from({length: 6}, (_, i) => n('r' + i, '안전 점검 ' + i, '점검 '.repeat(i + 1), {tags: i % 2 ? ['안전'] : []})), n('x', '여행', '바다')];
  const got = relatedNotes(me, list, {tagsOf, folderOf, hidden: x => !!x.lock});
  assert.equal(got.length, REL_MAX);
  assert.ok(got.every(r => !['me', 'locked', 'fam', 'x'].includes(r.id)));
  assert.ok(got[0].score >= got.at(-1).score);
  assert.deepEqual(relatedNotes({...me, lock: true}, list, {tagsOf, folderOf, hidden: x => !!x.lock}), []); // 잠긴 노트를 열었을 때도 아무것도
});
test('자료: 대표 낱말 하나로 묻고, 자료 줄만 2개', () => {
  assert.equal(docQuery(n('a', '교섭 일정', '교섭 교섭')), '교섭');
  assert.equal(docQuery(n('a', '', '')), '');
  const groups = new Map([['document', {kind: 'document', items: [{source: 'document', id: 'd1', title: '교섭 자료'}, {source: 'document', id: 'd2', title: '둘'}, {source: 'document', id: 'd3', title: '셋'}]}], ['note', {items: [{source: 'note', id: 'n1'}]}]]);
  assert.deepEqual(docRows(groups, '교섭'), [{id: 'd1', title: '교섭 자료', why: '교섭'}, {id: 'd2', title: '둘', why: '교섭'}]);
  assert.deepEqual(docRows(null, 'x'), []);
});
test('화면 연결: 읽기 화면 칸 하나, 기존 검색 RPC(자료만)·AI 없음·기기 저장 없음', () => {
  const notes = readFileSync(new URL('../app/basket-notes.js', import.meta.url), 'utf8');
  assert.match(notes, /<section class="note-rel-box" data-note-related aria-label="관련 노트·자료" hidden><\/section>/);
  assert.match(notes, /hidden:note => pinLock\.noteHidden\(note\)/);
  const ui = readFileSync(new URL('../app/note-related.js', import.meta.url), 'utf8');
  assert.match(ui, /searchRecords\(word, \{kind: 'document', per: 2\}\)/);
  assert.doesNotMatch(ui, /ai-assist|(?:local|session)Storag[e]|indexedD[B]/);
});
