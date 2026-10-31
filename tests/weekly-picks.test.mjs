import test from 'node:test';
import assert from 'node:assert/strict';

// S46-22 주간보고 제안 [×] + 받은·거절한 제안 학습: 모양 검사·합치기·학습 셈·거르기, 같은 경고·후보 한 번만. 가짜 이름만.
const p = await import('../app/weekly-picks.mjs');
const f = await import('../app/weekly-feedback.mjs');
const store = await import('../app/weekly-draft-store.js');
const s = await import('../app/weekly-hwpx/schedule.mjs');
const w = await import('../app/journal-weekly.js');
const d = await import('../app/weekly-hwpx/draft.mjs');
const panel = await import('../app/weekly-learn-panel.js');

const T = n => `2026-10-${String(n).padStart(2, '0')}T09:00:00.000Z`;
const cal = {kind:'calendar', from:'calendar', cell:'orgref:o1', org:'가상지부', text:'11/2 가상 집회'};

test('열쇠: 띄어쓰기·글머리가 달라도 같은 제안, 칸이 다르면 다른 제안', () => {
  assert.equal(p.pickKey({...cal, text:'- 11/2  가상 집회.'}), p.pickKey(cal));
  assert.notEqual(p.pickKey({...cal, cell:'orgref:o2'}), p.pickKey(cal));
  assert.equal(p.sigOf(cal), 'calendar|calendar|orgref:o1');
  assert.match(p.sigLabel('material|record|summary:가상 영역›가상 과제'), /칸 후보 · 기록 · 가상 영역 › 가상 과제/);
});

test('읽기: 모르는 종류·틀린 값은 버리고, 같은 열쇠는 더 나중 것 하나, 글은 잘림', () => {
  const key = p.pickKey(cal);
  const r = p.readPicks({items:[{...cal, key, act:'drop', at:T(1)}, {...cal, key, act:'none', at:T(2)}, {kind:'nope', key:'x', act:'drop', at:T(1)}, {...cal, key:'y', act:'eat', at:T(1)},
    {...cal, key:'z', act:'drop', at:T(3), text:'가'.repeat(500)}], released:[{sig:'a', at:'bad'}]});
  assert.equal(r.items.length, 2);
  assert.equal(r.items.find(x => x.key === key).act, 'none');
  assert.equal([...r.items.find(x => x.key === 'z').text].length, p.PICK_TEXT);
  assert.deepEqual(r.released, []);
  assert.equal(p.readPicks({items:[]}), null);
  assert.equal(p.readPicks('x'), null);
});

test('빼기·되돌리기·합치기: 두 기기가 서로 다른 것을 빼도 둘 다 남고, 되돌린 쪽이 나중이면 되돌림', () => {
  const a = p.withPick(null, cal, 'drop', T(1));
  assert.equal(p.droppedOf(a).size, 1);
  const b = p.withPick(null, {...cal, text:'11/3 가상 선전전'}, 'drop', T(2));
  const m = p.mergePicks(a, b);
  assert.equal(p.droppedOf(m).size, 2);
  const undone = p.withPick(m, cal, 'none', T(3));
  assert.equal(p.droppedOf(undone).size, 1);
  assert.ok(p.keptOf(undone).has(p.pickKey(cal)));
  // 옛 판(빼기)과 합쳐도 나중의 되돌림이 이긴다.
  assert.equal(p.droppedOf(p.mergePicks(a, undone)).size, 1);
  // 임시저장 칸 합치기(mergeExtras)도 picks 는 열쇠마다.
  const merged = f.mergeExtras({picks:a}, {picks:b});
  assert.equal(p.droppedOf(merged.picks).size, 2);
  // draft 를 읽고 다시 만들어도 picks 가 남는다(다른 기기·새로고침).
  const draft = store.makeDraft({extras:{picks:m}});
  assert.equal(p.droppedOf(store.readDraft(JSON.parse(JSON.stringify(draft))).picks).size, 2);
  assert.ok(store.keepDocsOnly(draft)?.picks, '[처음부터]도 제안 기록은 남김');
});

test('학습: 여러 주 계속 거절한 종류는 안 냄, 받은 종류는 앞, [풀기]는 지난 셈을 지움', () => {
  const week = (day, picks) => ({week_start:day, picks});
  const drop = (n, text, at) => p.withPick(n, {...cal, text}, 'drop', at);
  let w1 = drop(null, '10/12 가상 집회', T(12)); w1 = drop(w1, '10/13 가상 농성', T(13));
  const w2 = drop(null, '10/19 가상 집회', T(19));
  // 한 주에 셋을 빼도 한 주뿐이면 아직 안 막음.
  const one = p.learnPicks([week('2026-10-12', drop(w1, '10/14 가상 회의', T(14)))]);
  assert.equal(one.blocks(cal), false);
  const l = p.learnPicks([week('2026-10-12', w1), week('2026-10-19', w2)]);
  assert.equal(l.blocks(cal), true);
  assert.equal(l.blocked.length, 1);
  assert.equal(l.blocked[0].drops, 3);
  assert.equal(l.blocks({...cal, cell:'orgref:o2'}), false, '다른 칸은 그대로');
  // 받은 종류가 앞으로.
  const took = p.withPick(null, {kind:'material', from:'doc', cell:'summary:가', text:'가상 자료'}, 'take', T(20));
  const lt = p.learnPicks([week('2026-10-19', took)]);
  const sorted = p.sortPicks([{t:'기록'}, {t:'자료'}], x => ({kind:'material', from:x.t === '자료' ? 'doc' : 'record', cell:'summary:가', text:x.t}), {learn:lt});
  assert.deepEqual(sorted.shown.map(x => x.raw.t), ['자료', '기록']);
  // [풀기]: 이번 주 picks 의 released — 그 전 거절은 셈하지 않는다.
  const freed = p.learnPicks([week('2026-10-12', w1), week('2026-10-19', w2), week('2026-10-26', p.withRelease(null, p.sigOf(cal), T(25)))]);
  assert.equal(freed.blocks(cal), false);
  assert.equal(freed.blocked.length, 0);
});

test('거르기: 뺀 것·안 내는 종류는 gone(다시 넣기), 이번 주 다시 넣은 것은 보임, 같은 제안은 한 번만', () => {
  const describe = x => ({...cal, text:x});
  const dropped = p.droppedOf(p.withPick(null, describe('가'), 'drop', T(1)));
  const r = p.sortPicks(['가', '나', '나 ', '다'], describe, {dropped});
  assert.deepEqual(r.shown.map(x => x.raw), ['나', '다']);
  assert.deepEqual(r.gone.map(x => [x.raw, x.why]), [['가', 'drop']]);
  const learn = {blocks:x => x.text === '다', score:() => 0};
  const r2 = p.sortPicks(['나', '다'], describe, {learn});
  assert.deepEqual(r2.gone.map(x => [x.raw, x.why]), [['다', 'learn']]);
  const r3 = p.sortPicks(['나', '다'], describe, {learn, kept:new Set([p.pickKey(describe('다'))])});
  assert.deepEqual(r3.shown.map(x => x.raw), ['나', '다']);
});

test('같은 경고 한 번만: 같은 줄이 두 칸(투쟁 사업장·산하조직)에 있어도 경고 하나, 칸 이름은 이어 붙임', () => {
  const cal_ = Object.assign([{id:'a', calendarId:'k', calendarName:'공공운수노조', title:'가상 회의', start:'2026-11-02T10:00:00+09:00', end:'2026-11-02T11:00:00+09:00'}], {calendarNames:['공공운수노조']});
  const c = w.upcomingSchedule(cal_, '2026-10-26');
  const line = '- 11월 2일(월) 14:00 가상지부 제40차 집행국 회의';
  const found = s.scheduleMismatches({sections:[{where:'가상지부', lines:[line]}, {where:'가상지부', lines:[line]}, {where:'가상 영역 › 가상 과제', lines:[line, line]}], calendar:c, overrides:new Map(), orgs:[]});
  assert.equal(found.length, 1);
  assert.equal(found[0].where, '가상지부·가상 영역 › 가상 과제');
});

test('같은 후보 한 번만: 같은 날·같은 글 기록 후보는 칸마다 하나', () => {
  const list = [{day:'2026-10-27', text:'- 가상 회의', from:'가'}, {day:'2026-10-27', text:'-  가상 회의', from:'가'}, {day:'2026-10-28', text:'- 가상 회의', from:'가'}];
  assert.equal(d.dedupeLines(list).length, 2);
});

test('환류 답·규칙 후보 [×]도 학습 기록에', () => {
  const draft = {v:1, feedback:{week:'2026-10-26', at:T(26), counts:{proposed:1, kept:1, changed:0, dropped:0, added:0}, review:{at:T(26), candidates:['가상 규칙'], suggestions:[{id:'s1', text:'가상 개선', area:'input'}]}}};
  const out = panel.answerChange(draft, 's1', 'no', T(27));
  assert.equal(out.picks.items[0].act, 'drop');
  assert.equal(out.picks.items[0].kind, 'review');
  const yes = panel.answerChange(draft, 's1', 'yes', T(28));
  assert.equal(yes.picks.items[0].act, 'take');
});
