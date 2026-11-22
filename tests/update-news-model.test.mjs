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

test('UPDATE-소식안보임: 시작 날짜 안내 줄·보내기 창 시작 날짜 칸', async () => {
  const {seoulToday, startGapText, sendStartHint} = await import('../app/update-news-model.mjs');
  assert.equal(seoulToday(Date.parse('2026-11-16T15:00:00Z')), '2026-11-17');
  assert.equal(seoulToday(Date.parse('2026-11-16T14:59:59Z')), '2026-11-16');
  const items = [
    {sent_at: '2026-11-16T01:00:00Z'},
    {sent_at: '2026-11-10T01:00:00Z'},
    {sent_at: '2026-11-09T01:00:00Z', withdrawn_at: '2026-11-11T00:00:00Z'}
  ];
  assert.equal(startGapText(items, null), '시작 날짜가 없어 이용자에게 아직 안 보여요');
  assert.equal(startGapText([], ''), '시작 날짜가 없어 이용자에게 아직 안 보여요');
  assert.equal(startGapText(items, '2026-11-16'), '보낸 소식 1개는 시작 날짜 앞이라 이용자에게 안 보여요');
  assert.equal(startGapText(items, '2026-11-01'), '');
  assert.deepEqual(sendStartHint(null, '2026-11-16'), {text: '시작 날짜가 없어 이용자에게 아직 안 보여요', option: '오늘(11/16)부터 보이게 시작 날짜도 정하기', checked: true});
  assert.deepEqual(sendStartHint('2026-11-20', '2026-11-16'), {text: '시작 날짜(11/20) 앞이라 이 소식은 이용자에게 아직 안 보여요', option: '시작 날짜를 오늘(11/16)로 당기기', checked: false});
  assert.equal(sendStartHint('2026-11-16', '2026-11-16'), null);
  assert.equal(sendStartHint('2026-11-01', '2026-11-16'), null);
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
