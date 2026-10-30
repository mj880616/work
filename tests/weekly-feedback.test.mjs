// WEEKLY-환류학습: 바탕 고르기·줄 비교·학습 재료·학습 시험·환류 보고 숫자·규칙 목록(app/weekly-feedback.mjs). 가짜 글만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pickBase, teamIsNewer, teamChanges, diffLines, diffCells, feedbackRecord, feedbackTrend, keptRate, compareTest, learnInput,
  readExtras, mergeExtras, readRules, withRule, withRuleText, withoutRule, withAnswer, readFeedback, cellIdOf, RULES_MAX, similarity} from '../app/weekly-feedback.mjs';
import {makeDraft, readDraft, merge3, keepDocsOnly, hasContent} from '../app/weekly-draft-store.js';

const id = (key, section = 'summary', n = 0) => cellIdOf(section, key, n);

test('바탕: 보고일 앞의 최신 개인본이 먼저, 이번 주 개인본은 바탕이 아님, 없으면 팀 확정본', () => {
  const personal = [
    {id:'p1', document_date:'2026-10-19', created_at:'2026-10-16T08:00:00Z'},
    {id:'p2', document_date:'2026-10-26', created_at:'2026-10-23T08:00:00Z'},
    {id:'p3', document_date:'2026-11-02', created_at:'2026-10-30T05:00:00Z'}, // 이번 주(보고일 11/2) 개인본
  ];
  const confirmed = [{id:'t1', created_at:'2026-10-26T09:00:00Z'}];
  const pick = pickBase({personal, confirmed}, '2026-11-02');
  assert.equal(pick.from, 'personal');
  assert.equal(pick.doc.id, 'p2');
  assert.equal(pick.team.id, 't1');
  assert.equal(pickBase({personal:[], confirmed}, '2026-11-02').from, 'confirmed');
  assert.equal(pickBase({personal:[personal[2]], confirmed}, '2026-11-02').doc.id, 't1');
  assert.equal(pickBase({personal:[], confirmed:[]}, '2026-11-02'), null);
  // 날짜 칸이 없으면 올린 날로 본다.
  assert.equal(pickBase({personal:[{id:'p4', created_at:'2026-10-24T01:00:00Z'}], confirmed}, '2026-11-02').doc.id, 'p4');
});

test('확정본에서 바뀜: 개인본보다 나중 확정본에서 글이 다른 칸만', () => {
  assert.equal(teamIsNewer({document_date:'2026-10-26', created_at:'2026-10-23T08:00:00Z'}, {created_at:'2026-10-26T09:00:00Z'}), true);
  assert.equal(teamIsNewer({document_date:'2026-10-26', created_at:'2026-10-23T08:00:00Z'}, {created_at:'2026-10-20T09:00:00Z'}), false);
  const mine = new Map([[id('가›가-1'), ['- 가상 교섭 3차']], [id('나›나-1'), ['- 가상 행사 준비']], [id('가상 노조', 'orgs'), ['- 소식']]]);
  const team = new Map([[id('가›가-1'), ['- 가상 교섭 3차(결렬)']], [id('나›나-1'), ['-  가상 행사 준비 ']], [id('다른 칸'), ['- 남의 줄']]]);
  const diff = teamChanges(mine, team);
  assert.deepEqual([...diff.keys()], [id('가›가-1')]);
  assert.deepEqual(diff.get(id('가›가-1')), ['- 가상 교섭 3차(결렬)']);
});

test('줄 비교: 남김·고침(전→후)·뺌·더함', () => {
  const d = diffLines(['- 가상 교섭 3차 진행', '- 가상 행사 준비', '- 지난 일 정리', ''], ['- 가상 교섭 3차 진행', '- 가상 행사 준비 마침(10/28)', '- 새로 생긴 가상 회의']);
  assert.deepEqual(d.kept, ['- 가상 교섭 3차 진행']);
  assert.deepEqual(d.changed.map(c => [c.before, c.after]), [['- 가상 행사 준비', '- 가상 행사 준비 마침(10/28)']]);
  assert.deepEqual(d.dropped, ['- 지난 일 정리']);
  assert.deepEqual(d.added, ['- 새로 생긴 가상 회의']);
  // 공백·문장부호만 다르면 남김.
  assert.equal(diffLines(['- 가상, 회의'], ['가상 회의']).kept.length, 1);
  assert.ok(similarity('가상 행사 준비', '가상 행사 준비 마침') > 0.6);
});

test('칸 비교 → 고침 기록: 숫자와 칸 이름', () => {
  const proposed = [{section:'summary', key:'가›가-1', n:0, lines:['- A 진행', '- B 예정']}, {section:'orgs', key:'가상 노조', n:0, lines:['- 조직 소식']}];
  const final = new Map([[id('가›가-1'), ['- A 진행', '- B 예정대로 마침']], [id('가상 노조', 'orgs'), []], [id('나›나-1'), ['- 새 일']]]);
  const f = feedbackRecord({week:'2026-10-26', at:'2026-10-30T05:00:00.000Z', proposed, final});
  assert.deepEqual(f.counts, {kept:1, changed:1, dropped:1, added:1, proposed:3, final:3});
  assert.equal(f.changed[0].where, '요약 · 가 › 가-1');
  assert.equal(f.dropped[0].where, '산하조직 · 가상 노조');
  assert.equal(keptRate(f.counts), 33);
  assert.deepEqual(readFeedback(f), f);
  assert.equal(diffCells(proposed, proposed).kept, 3);
});

test('환류 보고 숫자: 이번 주 남김 비율과 지난 주들 평균', () => {
  const mk = (week, kept, proposed) => ({at:`${week}T09:00:00Z`, week, counts:{kept, changed:0, dropped:proposed - kept, added:0, proposed, final:kept}});
  const t = feedbackTrend(mk('2026-10-26', 8, 10), [mk('2026-10-12', 4, 10), mk('2026-10-19', 6, 10), mk('2026-10-26', 1, 10), mk('2026-11-02', 9, 10)]);
  assert.equal(t.rate, 80);
  assert.deepEqual(t.prev.map(p => p.week), ['2026-10-12', '2026-10-19']); // 같은 주·뒤 주는 빼고
  assert.equal(t.avg, 50);
  assert.equal(t.better, 30);
  assert.equal(feedbackTrend(null), null);
});

test('학습 재료: 보고 주 앞의 고침 기록·규칙만(이번 주 행은 안 씀)', () => {
  const fb = week => ({at:`${week}T09:00:00Z`, week, counts:{kept:1, changed:0, dropped:0, added:0, proposed:1, final:1}});
  const rows = [
    {week_start:'2026-10-26', draft:{feedback:fb('2026-10-26'), rules:{at:'2026-10-30T05:00:00Z', lines:[{text:'이번 주에 생긴 규칙'}]}}},
    {week_start:'2026-10-19', draft:{feedback:fb('2026-10-19'), rules:{at:'2026-10-23T05:00:00Z', lines:[{text:'지난주 규칙'}]}}},
    {week_start:'2026-10-12', draft:{feedback:fb('2026-10-12')}},
  ];
  const input = learnInput(rows, '2026-10-26');
  assert.deepEqual(input.feedback.map(f => f.week), ['2026-10-19', '2026-10-12']);
  assert.deepEqual(input.rules.lines.map(l => l.text), ['지난주 규칙']);
  assert.equal(input.weeks, 2);
  assert.deepEqual(learnInput([], '2026-10-26'), {feedback:[], rules:null, weeks:0});
});

test('학습 시험: 줄마다 같음·비슷·다름·빠짐·AI만, 그대로 쓸 수 있는 줄 n/m', () => {
  const ai = new Map([[id('가›가-1'), ['- 가상 교섭 3차 진행', '- 가상 행사 준비 중', '- AI가 지어낸 줄 하나']], [id('나›나-1'), ['- 가상 회의 열림']]]);
  const mine = new Map([[id('가›가-1'), ['- 가상 교섭 3차 진행', '- 가상 행사 준비 중(10/28)', '- 명진만 쓴 줄']], [id('나›나-1'), ['- 가상 회의 열렸고 다음 일정 정함']]]);
  const r = compareTest(ai, mine);
  const by = s => r.rows.filter(x => x.status === s).map(x => x.mine || x.ai);
  assert.deepEqual(by('same'), ['- 가상 교섭 3차 진행']);
  assert.deepEqual(by('similar'), ['- 가상 행사 준비 중(10/28)']);
  assert.deepEqual(by('differ'), ['- 가상 회의 열렸고 다음 일정 정함']);
  assert.deepEqual(by('missing'), ['- 명진만 쓴 줄']);
  assert.deepEqual(by('ai_only'), ['- AI가 지어낸 줄 하나']);
  assert.equal(r.usable, 2);
  assert.equal(r.total, 4);
  assert.equal(r.pct, 50);
});

test('규칙 목록: 고치기·지우기·더하기, 중복·길이·20줄 상한', () => {
  let r = readRules({at:'a', lines:[{text:'날짜는 10/28(화)처럼 쓴다'}, {text:'날짜는 10/28(화)처럼 쓴다'}, 'x'.repeat(500)]});
  assert.equal(r.lines.length, 2);
  assert.equal([...r.lines[1].text].length, 120);
  r = withRuleText(r, 0, '날짜는 10.28.(화)처럼 쓴다', 'b');
  assert.deepEqual(r.lines[0], {text:'날짜는 10.28.(화)처럼 쓴다', from:'edited'});
  r = withoutRule(r, 1, 'c');
  assert.equal(r.lines.length, 1);
  r = withRule(r, '끝난 일은 결과부터 쓴다', 'd');
  assert.deepEqual(r.lines.map(l => l.from), ['edited', 'added']);
  let full = {at:'e', lines:Array.from({length:RULES_MAX}, (_, i) => ({text:`규칙 ${i}`}))};
  assert.throws(() => withRule(full, '하나 더', 'f'), {code:'too_many'});
  assert.equal(readRules({at:'g', lines:Array.from({length:30}, (_, i) => `규칙 ${i}`)}).lines.length, RULES_MAX);
});

test('개선 제안 승인/아니 답', () => {
  const f = readFeedback({at:'2026-10-30T05:00:00Z', week:'2026-10-26', counts:{}, review:{at:'2026-10-30T05:01:00Z', candidates:['규칙 후보'], suggestions:[{id:'s1', text:'제안 하나'}, {id:'s2', text:'제안 둘'}]}});
  const y = withAnswer(f, 's2', 'yes');
  assert.deepEqual(y.review.suggestions.map(s => s.answer ?? ''), ['', 'yes']);
});

test('임시저장: proposed·feedback·rules 는 읽은 그대로 다시 실리고, 합칠 때 칸마다 더 나중 것', () => {
  const proposed = {at:'2026-10-30T01:00:00Z', base:{from:'personal', document_id:'doc-1'}, cells:[{section:'summary', key:'가›가-1', n:0, lines:['- A']}]};
  const rulesOld = {at:'2026-10-23T01:00:00Z', lines:[{text:'옛 규칙'}]}, rulesNew = {at:'2026-10-30T02:00:00Z', lines:[{text:'새 규칙'}]};
  const d = makeDraft({extras:{proposed, rules:rulesOld}});
  assert.deepEqual(readExtras(readDraft(JSON.parse(JSON.stringify(d)))), {proposed, rules:readRules(rulesOld)});
  assert.equal(hasContent(d), false); // 사본 기록이라 '이어서 고치기'를 묻지 않는다
  const theirs = makeDraft({extras:{rules:rulesNew}});
  const merged = merge3(null, d, theirs).draft;
  assert.equal(merged.rules.lines[0].text, '새 규칙');
  assert.equal(merged.proposed.at, proposed.at);
  assert.deepEqual(mergeExtras({rules:readRules(rulesNew)}, {rules:readRules(rulesOld)}).rules.lines[0].text, '새 규칙');
  // [처음부터]도 남긴다.
  assert.equal(keepDocsOnly(d).proposed.at, proposed.at);
  // 모르는 칸·틀린 모양은 버린다.
  assert.deepEqual(readExtras({proposed:{cells:[]}, feedback:{at:'x', week:'nope'}, rules:'x'}), {});
});

// WEEKLY-환류입력창 ①: 고침 기록에 칸마다 숫자(글 없음)를 남겨 '매번 비워 두는 칸·늘 손으로 다시 쓰는 칸·늘 지우는 줄'을 셀 수 있게 하고,
// 환류 보고 개선 제안은 분류(입력창·재료·흐름)를 지킨다.
test('고침 기록 칸별 숫자 + 개선 제안 분류(입력창)', () => {
  const proposed = new Map([[id('가'), ['- 가상 줄 하나', '- 가상 줄 둘']], [id('A 지부', 'orgs'), ['- 가상 조직 줄']], [id('나'), ['- 그대로 둔 줄']]]);
  const final = new Map([[id('가'), ['- 손으로 다시 쓴 가상 내용']], [id('A 지부', 'orgs'), []], [id('나'), ['- 그대로 둔 줄']]]);
  const f = feedbackRecord({week:'2026-10-26', at:'2026-10-30T09:00:00Z', proposed, final});
  const by = Object.fromEntries(f.cells.map(c => [c.where, c]));
  assert.deepEqual(by['산하조직 · A 지부'], {where:'산하조직 · A 지부', proposed:1, final:0, kept:0, changed:0, dropped:1, added:0});
  assert.equal(by['요약 · 가'].kept, 0); assert.equal(by['요약 · 가'].final, 1);
  assert.deepEqual(by['요약 · 나'], {where:'요약 · 나', proposed:1, final:1, kept:1, changed:0, dropped:0, added:0});
  assert.ok(!JSON.stringify(f.cells).includes('가상'), '칸별 숫자에는 줄 글이 없다');
  // 다시 읽어도 남는다(임시저장이 draft 를 통째로 다시 실어 보냄).
  assert.deepEqual(readFeedback(JSON.parse(JSON.stringify(f))).cells, f.cells);
  const withReview = readFeedback({...f, review:{at:'2026-10-30T09:01:00Z', candidates:[], suggestions:[
    {id:'s1', area:'input', text:'산하조직 칸을 처음부터 비워 두면'}, {id:'s2', area:'flow', text:'가상 흐름 제안'}, {id:'s3', area:'모름', text:'분류 없는 제안'}, {id:'s4', text:'옛 제안'}]}});
  assert.deepEqual(withReview.review.suggestions.map(s => [s.id, s.area ?? '']), [['s1', 'input'], ['s2', 'flow'], ['s3', ''], ['s4', '']]);
  assert.equal(withAnswer(withReview, 's4', 'yes').review.suggestions[3].answer, 'yes');
});
