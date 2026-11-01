import test from 'node:test';
import assert from 'node:assert/strict';
// WEEKLY-환류전칸 ⑤(요청함 11/01 01:14·01:24·23:42): 모든 제안에 [넣기]·[고쳐서 넣기]·[빼기](이유 한 줄, 안 써도 됨) + 묶음 [+ 추가].
// 화면 없는 부분만: 동작 기록의 빼기 이유, 개선 제안 답(고쳐서 넣기·이유), 규칙 후보·개선 제안 단추 → 쓰기. 가짜 글만.
import {readPicks, withPick, WHY_MAX} from '../app/weekly-picks.mjs';
import {withAnswer, readFeedback} from '../app/weekly-feedback.mjs';
import {answerChange, handIdeas} from '../app/weekly-learn-panel.js';

const AT = '2026-10-06T01:00:00.000Z';
const fb = () => ({at:AT, week:'2026-10-05', counts:{kept:1, changed:0, dropped:0, added:0, proposed:1, final:1}, changed:[], dropped:[], added:[],
  review:{at:AT, candidates:[], suggestions:[{id:'s1', area:'flow', text:'가상 개선 제안'}, {id:'s2', text:'가상 둘째 제안'}]}});

test('빼기 이유: drop 에만 남고(WHY_MAX자로 자름), 다른 동작의 why 는 버린다', () => {
  const item = {kind:'material', from:'record', cell:'summary:가', text:'가상 제안'};
  const p = withPick(null, {...item, why:'가'.repeat(WHY_MAX + 20)}, 'drop', AT);
  assert.equal(p.items[0].why.length, WHY_MAX);
  assert.equal(withPick(null, {...item, why:'이유'}, 'take', AT).items[0].why, undefined);
  assert.equal(readPicks({items:[{key:'k', kind:'material', act:'cut', text:'x', why:'이유', at:AT}]}).items[0].why, undefined);
  assert.equal(withPick(null, item, 'drop', AT).items[0].why, undefined, '안 쓰면 칸 없음');
});

test('개선 제안 답: [고쳐서 넣기] = 고친 글 + 원래 글(before), [빼기] = 이유, 다시 답하면 앞 답의 덧칸은 정리', () => {
  let f = withAnswer(fb(), 's1', 'yes', {text:'가상 개선 제안(고침)'});
  assert.deepEqual(f.review.suggestions[0], {id:'s1', area:'flow', text:'가상 개선 제안(고침)', answer:'yes', before:'가상 개선 제안'});
  f = withAnswer(f, 's1', 'no', {why:'가상 이유'});
  assert.deepEqual(f.review.suggestions[0], {id:'s1', area:'flow', text:'가상 개선 제안(고침)', answer:'no', why:'가상 이유'});
  assert.deepEqual(withAnswer(fb(), 's2', 'yes').review.suggestions[1], {id:'s2', text:'가상 둘째 제안', answer:'yes'});
  assert.equal(readFeedback({...fb(), review:{...fb().review, suggestions:[{id:'s1', text:'x', answer:'yes', why:'버림', before:'원래'}]}}).review.suggestions[0].why, undefined);
});

test('answerChange: 동작 기록은 넣기 take · 고쳐서 넣기 edit(before) · 빼기 drop(why) — 같은 제안은 열쇠 하나', () => {
  const d0 = {v:1, rows:[], titles:[], feedback:fb()};
  const d1 = answerChange(d0, 's1', 'yes', AT, {text:'가상 개선 제안(고침)'});
  const it = d1.picks.items[0];
  assert.deepEqual([it.act, it.kind, it.cell, it.text, it.before], ['edit', 'review', '개선 제안', '가상 개선 제안(고침)', '가상 개선 제안']);
  const d2 = answerChange(d1, 's1', 'no', '2026-10-06T02:00:00.000Z', {why:'가상 이유'});
  assert.equal(d2.picks.items.length, 1);
  assert.deepEqual([d2.picks.items[0].act, d2.picks.items[0].why], ['drop', '가상 이유']);
  assert.equal(answerChange(d0, 's2', 'yes', AT).picks.items[0].act, 'take');
});

test('handIdeas: [+ 추가]로 더한 내 개선 생각만(손), 다른 동작은 아님', () => {
  const picks = withPick(withPick(null, {kind:'review', from:'hand', cell:'개선 제안', text:'가상 내 생각'}, 'add', AT), {kind:'review', from:'ai', cell:'개선 제안', text:'가상 AI 제안'}, 'take', AT);
  assert.deepEqual(handIdeas([{week_start:'2026-10-05', picks}]), [{week:'2026-10-05', text:'가상 내 생각', hand:true}]);
});
