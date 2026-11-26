// UPDATE-운영자전용기록업데이트소식 PR3: 업데이트 소식 계산(app/update-news-model.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {draftLines, linesFromText, draftProblem, sentVersions, shortDay, looseNews} from '../app/update-news-model.mjs';

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

test('보냄 표시·날짜 모양(서울)', () => {
  const items = [
    {sent_at: '2026-11-21T01:00:00Z', sources: ['11/15-3']},
    {sent_at: '2026-11-19T15:00:00Z', sources: ['11/15-2'], withdrawn_at: '2026-11-21T00:00:00Z'},
    {sent_at: '2026-11-19T14:59:59Z', sources: ['11/14-1']}
  ];
  assert.deepEqual([...sentVersions(items)].sort(), ['11/14-1', '11/15-3']);
  assert.equal(shortDay('2026-11-20'), '11/20');
  assert.equal(shortDay('2026-11-19T15:30:00Z'), '11/20');
});

test('S71-31: 기록 줄에 없는 소식(직접 쓴 것)만 남긴다 — 파일 이름·버전명 둘 다로 맞춤', () => {
  const notes = [{v: '11/23-2', file: '20261123-1300-new'}, {v: '11/15-3'}];
  const items = [
    {id: 'auto', sources: ['11/23-2'], source_files: ['20261123-1300-new']},
    {id: 'byv', sources: ['11/15-3']},
    {id: 'free', sources: []},
    {id: 'gone', sources: ['10/01-1']},
    {id: 'otherfile', sources: ['11/23-2'], source_files: ['20261123-0900-x']}
  ];
  assert.deepEqual(looseNews(items, notes).map(i => i.id), ['free', 'gone', 'otherfile']);
  assert.deepEqual(looseNews(null, notes), []);
  assert.deepEqual(looseNews(items, []).length, 5);
});

test('S68-14: 기록 줄 [보냄] → 거둘 소식 찾기·같이 묶인 기록 개수', async () => {
  const {withdrawPlan, withdrawNote, WITHDRAW_TEXT} = await import('../app/update-news-model.mjs');
  const items = [
    {id: 'n3', sources: ['11/15-3', '11/15-2', '11/15-1'], withdrawn_at: null},
    {id: 'n2', sources: ['11/15-3'], withdrawn_at: null},
    {id: 'n1', sources: ['11/14-9'], withdrawn_at: '2026-11-20T00:00:00Z'},
    {id: 'n0', sources: ['11/15-2'], withdrawn_at: null}
  ];
  assert.deepEqual(withdrawPlan(items, '11/15-3'), {ids: ['n3', 'n2'], others: 2});
  assert.deepEqual(withdrawPlan(items, '11/15-2'), {ids: ['n3', 'n0'], others: 2});
  assert.deepEqual(withdrawPlan(items, '11/14-9'), {ids: [], others: 0});
  assert.deepEqual(withdrawPlan([{id: 'x', sources: ['a']}], 'a'), {ids: ['x'], others: 0});
  assert.deepEqual(withdrawPlan(null, 'a'), {ids: [], others: 0});
  assert.equal(withdrawNote(0), '');
  assert.equal(withdrawNote(2), '같이 보낸 기록 2개도 함께 거둬져요');
  assert.equal(WITHDRAW_TEXT, '이 소식을 거둘까요? 이용자 화면에서 사라져요.');
});

// S68-46 UPDATE-소식자동(사용자 11/23 12:37): 자동 소식은 기록 파일 이름(source_files)으로 맞추고, 기록 줄 버튼은 보내기·보냄·다시 보내기 셋.
test('자동 소식: 파일 이름으로 맞추고(순번이 밀려도), 손으로 보낸 소식은 버전명으로', async () => {
  const {newsHasNote, noteState, withdrawPlan, resendPlan, resendNote, RESEND_TEXT} = await import('../app/update-news-model.mjs');
  const auto = {id: 'a1', auto: true, sources: ['11/23-4'], source_files: ['20261123-1300-d'], withdrawn_at: null};
  const hand = {id: 'h1', sources: ['11/23-1', '11/23-2'], source_files: [], withdrawn_at: null};
  // 늦게 들어온 기록 때문에 d의 순번이 11/23-5로 밀려도 d로 맞고, 새로 11/23-4가 된 다른 기록과는 안 맞는다.
  assert.equal(newsHasNote(auto, {v: '11/23-5', file: '20261123-1300-d'}), true);
  assert.equal(newsHasNote(auto, {v: '11/23-4', file: '20261123-1230-late'}), false);
  assert.equal(newsHasNote(auto, '11/23-4'), false, '파일 이름이 있는 소식은 버전명만으로 맞추지 않는다');
  assert.equal(newsHasNote(hand, {v: '11/23-2', file: '20261123-1100-b'}), true);
  assert.equal(newsHasNote(hand, '11/23-1'), true);
  assert.equal(newsHasNote(null, '11/23-1'), false);
  const items = [auto, hand];
  assert.equal(noteState(items, {v: '11/23-5', file: '20261123-1300-d'}), 'sent');
  assert.equal(noteState(items, {v: '11/23-9', file: '20261123-2300-z'}), '');
  assert.deepEqual(withdrawPlan(items, {v: '11/23-5', file: '20261123-1300-d'}), {ids: ['a1'], others: 0});
  assert.deepEqual(withdrawPlan(items, {v: '11/23-2', file: '20261123-1100-b'}), {ids: ['h1'], others: 1});
  const pulled = [{...auto, withdrawn_at: '2026-11-23T05:00:00Z'}, {...auto, id: 'a0', withdrawn_at: '2026-11-23T04:00:00Z'}, hand];
  assert.equal(noteState(pulled, {v: '11/23-5', file: '20261123-1300-d'}), 'withdrawn');
  assert.deepEqual(resendPlan(pulled, {v: '11/23-5', file: '20261123-1300-d'}), {ids: ['a1'], others: 0}, '가장 최근에 거둔 것 하나만');
  assert.deepEqual(resendPlan(pulled, {v: '11/23-2', file: '20261123-1100-b'}), {ids: [], others: 0}, '거두지 않은 것은 다시 보내기 대상 아님');
  assert.deepEqual(resendPlan(null, '11/23-1'), {ids: [], others: 0});
  assert.equal(resendNote(0), '');
  assert.equal(resendNote(1), '같이 보낸 기록 1개도 함께 다시 보여요');
  assert.match(RESEND_TEXT, /다시 보낼까요/);
});
