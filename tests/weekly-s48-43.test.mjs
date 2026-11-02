import test from 'node:test';
import assert from 'node:assert/strict';
// S48-43: WEEKLY-환류전칸 — 1) 임원 배정 요청에서 손대지 않고 남은 '지난주에서' 줄은 확정 때 'carried' take.
//         WEEKLY-개발후보CC — [만들기]로 보낸 제안에 PR 번호(made)가 있으면 '만듦 #PR' 표시. 가짜 글만.
import {withRequestTakes, requestPickText, withLinePick} from '../app/weekly-draft-store.js';
import {cellKeptRates, readPicks, pickKey} from '../app/weekly-picks.mjs';
import {requestLine} from '../app/weekly-exec-requests.js';
import {readFeedback, withAnswer, answerState, madeOf} from '../app/weekly-feedback.mjs';

const AT = '2026-11-02T01:00:00.000Z';
const R1 = {id:'r1', day:'2026-11-05', time:'10:00', what:'가상 집회', place:'', who:'', carried:true};
const R2 = {id:'r2', day:'2026-11-06', time:'', what:'가상 간담회', place:'', who:'', carried:true};
const R3 = {id:'r3', day:'2026-11-07', time:'', what:'가상 내 줄', place:'', who:''};

test('requestPickText: journal.js 동작 기록과 같은 줄 글(앞 - 뺌)', () => {
  assert.equal(requestPickText(R1), requestLine(R1).replace(/^-\s*/, ''));
  assert.doesNotMatch(requestPickText(R1), /^-/);
});

test('withRequestTakes: 지난주에서 남은 줄만 take, 내 줄·이미 뺀 줄은 그대로, 되돌린 줄은 take', () => {
  let d = withLinePick(null, {cell:'requests:ask', kind:'carried', act:'drop', text:requestPickText(R2), at:AT});
  const picks = withRequestTakes(d.picks, [R1, R2, R3], '2026-11-02T02:00:00.000Z');
  const items = readPicks(picks).items;
  assert.deepEqual(items.map(x => [x.kind, x.act, x.text]).sort(), [['carried', 'drop', requestPickText(R2)], ['carried', 'take', requestPickText(R1)]]);
  assert.equal(items.find(x => x.act === 'take').key, pickKey({kind:'carried', cell:'requests:ask', text:requestPickText(R1)}));
  // 다시 확정해도 열쇠 하나.
  assert.equal(readPicks(withRequestTakes(picks, [R1, R2])).items.length, 2);
  // 1. 요청사항 그대로 쓴 비율 = take 1 / (take 1 + drop 1).
  assert.deepEqual(cellKeptRates(picks).find(r => r.group === '1. 요청사항'), {group:'1. 요청사항', percent:50, answered:2});
  // 되돌림('none')은 take 로 덮어씀.
  const back = withLinePick({picks:d.picks}, {cell:'requests:ask', kind:'carried', act:'none', text:requestPickText(R2), at:'2026-11-02T03:00:00.000Z'});
  const again = readPicks(withRequestTakes(back.picks, [R2], '2026-11-02T04:00:00.000Z')).items;
  assert.equal(again.find(x => x.text === requestPickText(R2)).act, 'take');
  assert.equal(withRequestTakes(null, [R3]), null);
  assert.equal(withRequestTakes(null, null), null);
});

const FB = {at:AT, week:'2026-10-26', review:{at:AT, suggestions:[{id:'s1', text:'가상 좋아지는 점', how:'가상 방법', answer:'yes', made:1790}, {id:'s2', text:'가상 둘', answer:'no', made:12}, {id:'s3', text:'가상 셋', answer:'yes', made:-1}]}};

test('readFeedback: made 는 yes 답의 양의 정수만', () => {
  const f = readFeedback(FB);
  const [a, b, c] = f.review.suggestions;
  assert.equal(a.made, 1790);
  assert.equal(b.made, undefined);
  assert.equal(c.made, undefined);
});

test('answerState·madeOf: 만들기로 보냄 · 만듦 #PR', () => {
  assert.equal(answerState({answer:'yes', made:1790}), '만들기로 보냄 · 만듦 #1790');
  assert.equal(answerState({answer:'yes', before:'옛 글'}), '고쳐서 만들기로 보냄');
  assert.equal(answerState({answer:'no', why:'가상 이유'}), '뺌 — 가상 이유');
  assert.equal(answerState({}), '');
  assert.equal(madeOf(0), null);
  assert.equal(madeOf('12'), null);
  assert.equal(madeOf(12), 12);
});

test('withAnswer: [빼기]로 바꾸면 made 를 지우고, 다시 만들기로 고쳐도 made 는 남는다', () => {
  const f = readFeedback(FB);
  const no = withAnswer(f, 's1', 'no', {why:'가상'});
  assert.equal(no.review.suggestions[0].made, undefined);
  const fixed = withAnswer(f, 's1', 'yes', {text:'가상 고친 글'});
  assert.equal(fixed.review.suggestions[0].made, 1790);
  assert.equal(answerState(fixed.review.suggestions[0]), '고쳐서 만들기로 보냄 · 만듦 #1790');
});
