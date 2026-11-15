// UPDATE-운영자전용기록업데이트소식 PR3: 업데이트 소식 계산(app/update-news-model.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {draftLines, linesFromText, draftProblem, sentVersions, afterStart, cutIndex, shortDay} from '../app/update-news-model.mjs';

const a = {v: '11/15-3', changes: ['사진 칸이 생겼어요', '메뉴에 파일'], checks: ['사진 열어 보기']};
const b = {v: '11/15-2', changes: ['메뉴에 파일', '이름이 바뀌었어요'], checks: []};

test('묶은 기록 → 보낼 줄: 폰에서 볼 것은 기본으로 빼고, 같은 줄은 한 번', () => {
  assert.deepEqual(draftLines([a, b]), ['사진 칸이 생겼어요', '메뉴에 파일', '이름이 바뀌었어요']);
  assert.deepEqual(draftLines([a], {withChecks: true}), ['사진 칸이 생겼어요', '메뉴에 파일', '사진 열어 보기']);
  assert.equal(draftLines(Array.from({length: 20}, (_, i) => ({changes: ['줄 ' + i]}))).length, 12);
});

test('글 칸 → 줄: 빈 줄 버리고 머리 기호 떼기, 검사 문구', () => {
  assert.deepEqual(linesFromText('· 첫 줄\n\n- 둘째\n  셋째  '), ['첫 줄', '둘째', '셋째']);
  assert.equal(draftProblem({lines: []}), '보낼 글을 한 줄 이상 써 주세요');
  assert.equal(draftProblem({lines: ['가'.repeat(201)]}), '한 줄은 200자까지예요');
  assert.equal(draftProblem({title: '가'.repeat(81), lines: ['a']}), '제목은 80자까지예요');
  assert.equal(draftProblem({title: '제목', lines: ['a']}), '');
});

test('보냄 표시·시작 날짜 자르기(서울 0시)', () => {
  const items = [
    {sent_at: '2026-11-21T01:00:00Z', sources: ['11/15-3']},
    {sent_at: '2026-11-19T15:00:00Z', sources: ['11/15-2'], withdrawn_at: '2026-11-21T00:00:00Z'},
    {sent_at: '2026-11-19T14:59:59Z', sources: ['11/14-1']}
  ];
  assert.deepEqual([...sentVersions(items)].sort(), ['11/14-1', '11/15-3']);
  assert.equal(afterStart('2026-11-19T15:00:00Z', '2026-11-20'), true);
  assert.equal(afterStart('2026-11-19T14:59:59Z', '2026-11-20'), false);
  assert.equal(afterStart('2026-11-19T15:00:00Z', null), false);
  assert.equal(cutIndex(items, '2026-11-20'), 2);
  assert.equal(cutIndex(items, null), 0);
  assert.equal(shortDay('2026-11-20'), '11/20');
  assert.equal(shortDay('2026-11-19T15:30:00Z'), '11/20');
});
