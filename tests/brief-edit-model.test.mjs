// S70-27 BRIEF-손수정: 브리핑 손으로 고치기 순수 계산(app/brief-edit-model.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, editFields, fitsServer, isEdited, lineMenuItems, shownBrief } from '../app/brief-edit-model.mjs';
import { archiveNote, rowState } from '../app/brief-room-model.mjs';

const v3 = { v: 3, lead: '요지 하나', gist: ['요지 하나', '요지 둘'], partial: 'preview',
  sections: [{ title: '소제목 가', items: [{ text: '줄 1', page: 3, ours: true }, { text: '줄 2', page: null }] }, { title: '소제목 나', items: [{ text: '줄 3', page: 9 }] }],
  quotes: [{ text: '원문 그대로', speaker: '예시', heading: '가', page: 3 }] };

test('보일 한 장: 고친 것이 있으면 그것, 없으면 AI 원문', () => {
  assert.equal(shownBrief({ brief: v3, edited: null }), v3);
  const e = { v: 3, lead: 'x', gist: ['x'], sections: [], quotes: [] };
  assert.equal(shownBrief({ brief: v3, edited: e }), e);
  assert.equal(isEdited({ edited: e }), true);
  assert.equal(isEdited({ edited: null }), false);
  assert.equal(isEdited({ edited: [] }), false);
});

test('고치는 칸: 요지 줄 → 소제목 → 줄, 원문 인용은 칸 없음', () => {
  assert.deepEqual(editFields(v3).map(f => f.key), ['g:0', 'g:1', 't:0', 'i:0:0', 'i:0:1', 't:1', 'i:1:0']);
});

test('고친 값 → 새 한 장: 쪽·우리 관련·인용·앞부분 표시 그대로, 비운 줄은 빠짐, 첫 요지가 lead', () => {
  const out = applyEdits(v3, new Map([['g:0', ''], ['i:0:0', '  줄 1 고침\n'], ['i:0:1', ''], ['t:1', '']]));
  assert.deepEqual(out, { v: 3, lead: '요지 둘', gist: ['요지 둘'], partial: 'preview',
    sections: [{ title: '소제목 가', items: [{ text: '줄 1 고침', page: 3, ours: true }] }, { title: '', items: [{ text: '줄 3', page: 9, ours: false }] }],
    quotes: v3.quotes });
  assert.equal(applyEdits(v3, new Map([['i:0:0', '줄 1']])), null, '바뀐 것 없으면 null');
  assert.equal(applyEdits(v3, {}), null);
});

test('옛 형식 브리핑도 고치면 새 모양(v3)으로', () => {
  const legacy = { lead: '옛 요지', touches: ['옛 줄'], todos: [], conflicts: [] };
  const out = applyEdits(legacy, { 'i:0:0': '옛 줄 고침' });
  assert.equal(out.v, 3);
  assert.equal(out.sections[0].items[0].text, '옛 줄 고침');
  assert.equal(out.lead, '옛 요지');
});

test('목록 한 줄·노트로 보관은 고친 한 장을 쓴다', () => {
  const edited = applyEdits(v3, { 'g:0': '고친 요지', 'i:1:0': '고친 줄 3' });
  const row = { status: 'done', brief: v3, edited, finished_at: '2026-11-25T00:00:00Z' };
  assert.equal(rowState(row).text, '고친 요지');
  const n = archiveNote({ doc: { id: 'd1', title: '자료' }, row });
  assert.match(n.raw_text, /고친 줄 3/);
  assert.doesNotMatch(n.raw_text, /- 줄 3/);
});

test('서버 크기 검사·우클릭 메뉴 항목([고치기] + 막대 항목 그대로)', () => {
  assert.equal(fitsServer(v3), true);
  assert.equal(fitsServer({ v: 3, gist: ['가'.repeat(30000)], sections: [] }), false);
  const bar = [{ id: 'save', label: '밑줄 저장' }, { id: 'copy', label: '복사' }];
  assert.deepEqual(lineMenuItems(bar, true).map(i => i.label), ['수정', '밑줄 저장', '복사']);
  assert.deepEqual(lineMenuItems(bar, false).map(i => i.id), ['save', 'copy']);
});
