import test from 'node:test';
import assert from 'node:assert/strict';

// WEEKLY-한흐름확정 ① 자료(docs/design/weekly-one-flow.md 2·3절): 동작 종류 넓히기(take·edit·drop·fix·cut·add·none),
// 누름 1번 = 그 주 draft PATCH 1번(rows + picks), 한 벌 칸 글(proposed 위에 rows), 그 주 처음 한 번 바탕 → proposed, 환류 정리 시점 셈.
// 글은 모두 가짜.
const p = await import('../app/weekly-picks.mjs');
const store = await import('../app/weekly-draft-store.js');
const base = await import('../app/weekly-base.js');
const fb = await import('../app/weekly-feedback.mjs');

const START = '2026-10-26';
const T = n => `2026-10-${String(n).padStart(2, '0')}T09:00:00.000Z`;
const H = h => new Date(Date.parse('2026-10-27T00:00:00.000Z') + h * 3600000).toISOString();
const SUM = {section:'summary', key:'가상 영역›가상 과제', n:0};
const ORG = {section:'orgs', key:'A 지부', n:0};
const proposed = {at:T(26), base:{from:'personal', document_id:'d1'}, cells:[{...SUM, lines:['- 가상 교섭 1차', '- 가상 회의']}, {...ORG, lines:['- A 지부 소식']}]};
const D = (extra = {}) => ({v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], proposed, ...extra});

function fakeRt({rows = [], missing = 0} = {}) {
  const calls = [];
  const rt = {
    context:{read:() => ({workspace:{id:'w'}})},
    async api(path, {method = 'GET', body = null} = {}) {
      const q = new URL(path, 'https://x').searchParams;
      calls.push({method, query:Object.fromEntries(q), body});
      if (missing) throw Object.assign(new Error('column app_weekly_exec_requests.draft does not exist'), {status:missing});
      const hit = () => rows.filter(r => (!q.has('week_start') || q.get('week_start') === `eq.${r.week_start}`) &&
        (!q.has('draft_saved_at') || (q.get('draft_saved_at') === 'is.null' ? r.draft_saved_at == null : q.get('draft_saved_at') === `eq.${r.draft_saved_at}`)));
      if (method === 'GET') return hit().map(r => ({id:r.id, draft:r.draft, draft_saved_at:r.draft_saved_at}));
      if (method === 'POST') { if (rows.some(r => r.week_start === body.week_start)) throw Object.assign(new Error('dup'), {status:409}); const row = {id:`r${rows.length}`, ...body}; rows.push(row); return [row]; }
      if (method === 'PATCH') { const list = hit(); for (const r of list) Object.assign(r, body); return list; }
      throw new Error('method');
    },
  };
  return {rt, calls, rows, writes:() => calls.filter(c => c.method !== 'GET').length};
}

test('동작 종류: take·edit·drop·fix·cut·add·none 을 받고, before 는 edit·fix 에만, 모르는 동작은 버림', () => {
  assert.deepEqual([...p.PICK_ACTS].sort(), ['add', 'cut', 'drop', 'edit', 'fix', 'none', 'take']);
  const item = {kind:'material', from:'record', cell:'summary:가상 영역›가상 과제', text:'- 가상 집회'};
  const key = p.pickKey(item);
  const r = p.readPicks({items:[
    {...item, key, act:'edit', text:'- 가상 집회(고침)', before:'- 가상 집회', at:T(1)},
    {kind:'line', key:'l1', cell:'summary:x', act:'fix', text:'새 줄', before:'옛 줄', at:T(2)},
    {kind:'line', key:'l2', cell:'summary:x', act:'cut', text:'뺀 줄', before:'버려짐', at:T(3)},
    {kind:'line', key:'l3', cell:'summary:x', act:'add', from:'hand', text:'더한 줄', at:T(4)},
    {kind:'line', key:'l4', cell:'summary:x', act:'eat', text:'?', at:T(5)},
    {kind:'nope', key:'l5', act:'take', at:T(6)},
  ]});
  assert.deepEqual(r.items.map(x => x.act), ['edit', 'fix', 'cut', 'add']);
  assert.equal(r.items[0].before, '- 가상 집회');
  assert.equal(r.items[1].before, '옛 줄');
  assert.equal('before' in r.items[2], false);
  assert.equal(r.items[3].from, 'hand');
  // 받은 제안(edit 포함)은 이번 주에 다시 나오지 않게 kept, 줄 동작 열쇠는 kept 가 아님.
  assert.equal(p.keptOf(r).has(key), true);
  assert.equal(p.keptOf(r).has('l1'), false);
});

test('학습 셈: edit 은 받음, fix·cut·add 는 제안 학습에 넣지 않음', () => {
  const item = {kind:'calendar', from:'calendar', cell:'orgref:o1', text:'11/2 가상 집회'};
  const rows = [
    {week_start:'2026-10-12', picks:p.withPick(null, item, 'edit', T(12))},
    {week_start:'2026-10-19', picks:p.withPick(null, {kind:'line', cell:'orgref:o1', text:'x'}, 'cut', T(19))},
  ];
  const l = p.learnPicks(rows);
  assert.equal(l.sigs.get(p.sigOf(item)).takes, 1);
  assert.equal(l.sigs.has('line||orgref:o1'), false);
});

test('상한 300개·크기: 넘치면 오래된 none 부터, 그다음 오래된 것부터 버림', () => {
  const items = [];
  for (let i = 0; i < 320; i++) items.push({kind:'line', key:`k${i}`, cell:'summary:x', act:i < 30 ? 'none' : 'add', text:'짧은 줄', at:new Date(Date.parse(T(1)) + i * 1000).toISOString()});
  // 맨 끝(가장 새것) 몇 개를 none 으로 — 오래된 none 이 먼저 빠져야 새 none 이 남는다.
  items[319].act = 'none';
  const r = p.readPicks({items});
  assert.equal(r.items.length, p.PICKS_MAX);
  assert.equal(r.items.some(x => x.key === 'k319'), true);
  assert.equal(r.items.filter(x => x.act === 'none').length, 30 - 20 + 1); // 넘친 20개는 오래된 none 에서
  // 긴 글이 많으면 크기 상한(60KB)이 먼저 걸린다.
  const big = Array.from({length:300}, (_, i) => ({kind:'line', key:`b${i}`, cell:'summary:x', act:'fix', text:'가'.repeat(100), before:'나'.repeat(100), at:new Date(Date.parse(T(1)) + i * 1000).toISOString()}));
  const rb = p.readPicks({items:big});
  assert.ok(new TextEncoder().encode(JSON.stringify(rb)).length <= p.PICKS_MAX_BYTES);
  assert.equal(rb.items.at(-1).key, 'b299');
});

test('한 벌 칸 글: proposed 위에 rows 를 덮는다', () => {
  const d = D({rows:[{...ORG, lines:['- A 지부 고친 소식']}]});
  const cells = store.weekCells(d);
  assert.deepEqual(cells.get(store.cellId('summary', SUM.key, 0)), ['- 가상 교섭 1차', '- 가상 회의']);
  assert.deepEqual(store.cellLinesOf(d, ORG), ['- A 지부 고친 소식']);
  assert.deepEqual(store.cellLinesOf(d, {section:'orgs', key:'없는 조직'}), []);
});

test('withCellLine: 동작마다 칸 줄과 기록(picks)을 한 draft 로, 바탕과 같아지면 고친 칸에서 뺌', () => {
  let tick = 0;
  const stamp = () => H(++tick); // 동작마다 더 나중 시각(기록은 시각 순)
  // [+ 추가]
  let d = store.withCellLine(D(), {...SUM, act:'add', text:'  - 가상 선전전  ', at:stamp()});
  assert.deepEqual(store.cellLinesOf(d, SUM), ['- 가상 교섭 1차', '- 가상 회의', '- 가상 선전전']);
  assert.equal(d.picks.items.at(-1).act, 'add');
  assert.equal(d.picks.items.at(-1).kind, 'line');
  const addKey = d.picks.items.at(-1).key;
  // 되돌리기: 앞 기록 항목과 앞 줄들 → 칸은 바탕과 같아져 rows 에서 빠지고, 기록은 none.
  d = store.withCellLine(d, {...SUM, act:'none', item:store.lineDone(d, addKey), lines:['- 가상 교섭 1차', '- 가상 회의'], at:stamp()});
  assert.deepEqual(d.rows, []);
  assert.equal(d.picks.items.find(x => x.key === addKey).act, 'none');
  // ⋯ [고치기]
  d = store.withCellLine(d, {...SUM, act:'fix', index:1, text:'- 가상 회의 결과', at:stamp()});
  assert.deepEqual(store.cellLinesOf(d, SUM), ['- 가상 교섭 1차', '- 가상 회의 결과']);
  assert.equal(d.picks.items.at(-1).before, '- 가상 회의');
  // ⋯ [빼기]
  d = store.withCellLine(d, {...SUM, act:'cut', index:0, at:stamp()});
  assert.deepEqual(store.cellLinesOf(d, SUM), ['- 가상 회의 결과']);
  assert.equal(d.picks.items.at(-1).text, '- 가상 교섭 1차');
  // 제안 [수용]·[고쳐서 수용]·[빼기]
  const sug = {kind:'org_ai', from:'ai', cell:'orgs:A 지부', org:'A 지부', text:'- A 지부 AI 요약'};
  d = store.withCellLine(d, {...ORG, act:'take', text:sug.text, item:sug, at:stamp()});
  assert.deepEqual(store.cellLinesOf(d, ORG), ['- A 지부 소식', '- A 지부 AI 요약']);
  const sug2 = {kind:'material', from:'record', cell:'orgs:A 지부', org:'A 지부', text:'- 기록 줄'};
  d = store.withCellLine(d, {...ORG, act:'edit', text:'- 기록 줄(고침)', item:sug2, at:stamp()});
  const e = d.picks.items.find(x => x.key === p.pickKey(sug2));
  assert.equal(e.act, 'edit'); assert.equal(e.text, '- 기록 줄(고침)'); assert.equal(e.before, '- 기록 줄');
  const sug3 = {kind:'calendar', from:'calendar', cell:'orgs:A 지부', org:'A 지부', text:'11/3 가상 일정'};
  const before = store.cellLinesOf(d, ORG);
  d = store.withCellLine(d, {...ORG, act:'drop', item:sug3, at:stamp()});
  assert.deepEqual(store.cellLinesOf(d, ORG), before);
  assert.equal(p.droppedOf(d.picks).has(p.pickKey(sug3)), true);
  // 서버 모양 검사를 그대로 지난다(readDraft 로 다시 읽어도 같음).
  const again = store.readDraft(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(store.weekCells(again), store.weekCells(d));
  assert.equal(again.picks.items.length, d.picks.items.length);
});

test('withCellLine: 틀린 입력은 거절(빈 줄·너무 긴 줄·없는 줄 번호·제안 없는 수용)', () => {
  const bad = (op, code) => assert.throws(() => store.withCellLine(D(), {...SUM, at:T(27), ...op}), e => e.code === code);
  bad({act:'add', text:'  '}, 'empty');
  bad({act:'add', text:'가'.repeat(store.CELL_LINE_MAX + 1)}, 'too_long');
  bad({act:'fix', index:5, text:'x'}, 'index');
  bad({act:'cut', index:-1}, 'index');
  bad({act:'take', text:'x'}, 'item');
  bad({act:'jump'}, 'act');
  assert.throws(() => store.withCellLine(D(), {section:'nope', key:'x', act:'add', text:'x'}), e => e.code === 'cell');
});

test('바탕을 모르는 옛 주(proposed 없음): 빈 칸이 되어도 rows 에 남긴다(상자가 바탕 글로 되살리지 않게)', () => {
  const old = {v:1, base:null, me:'', me_from:'', date:'', rows:[{...SUM, lines:['- 하나']}], titles:[]};
  const d = store.withCellLine(old, {...SUM, act:'cut', index:0, at:T(27)});
  assert.deepEqual(d.rows, [{...SUM, lines:[]}]);
});

test('누름 1번 = PATCH 1번(rows + picks 함께), 다른 칸은 서버 것 그대로', async () => {
  const f = fakeRt({rows:[{id:'r0', week_start:START, items:[], draft:D({hq:[]}), draft_saved_at:T(26)}]});
  const r = await store.changeWeekCell({start:START, ...SUM, act:'add', text:'- 가상 선전전', at:T(27)}, f.rt);
  assert.equal(r.ok, true);
  assert.equal(f.writes(), 1);
  const body = f.calls.find(c => c.method === 'PATCH').body;
  assert.deepEqual(store.cellLinesOf(body.draft, SUM).at(-1), '- 가상 선전전');
  assert.equal(body.draft.picks.items.length, 1);
  assert.deepEqual(body.draft.proposed.cells.length, 2);
  // 아는 행을 주면 읽기 없이 PATCH 한 번.
  const g = fakeRt({rows:[{id:'r0', week_start:START, items:[], draft:D(), draft_saved_at:T(26)}]});
  const known = (await store.readWeekDraft(START, g.rt)).row;
  g.calls.length = 0;
  await store.changeWeekCell({start:START, known, ...ORG, act:'cut', index:0, at:T(27)}, g.rt);
  assert.deepEqual(g.calls.map(c => c.method), ['PATCH']);
});

test('proposed: 그 주 처음 한 번만 바탕을 연다 — 있으면 열지 않고, 없으면 열어 저장, 그사이 다른 기기가 썼으면 그것', async () => {
  let opened = 0;
  const open = async () => { opened++; return {status:'ok', from:'personal', info:{from:'library', document_id:'d9'}, cells:new Map([[store.cellId('summary', SUM.key, 0), ['- 바탕 줄']]])}; };
  // 처음: 행 없음 → 열고 저장(POST).
  const f = fakeRt();
  const r1 = await base.ensureWeekProposed({start:START, open, now:() => T(27)}, f.rt);
  assert.equal(r1.status, 'saved'); assert.equal(opened, 1);
  assert.deepEqual(f.rows[0].draft.proposed, {at:T(27), cells:[{...SUM, lines:['- 바탕 줄']}], base:{from:'personal', document_id:'d9'}});
  // 다음(어느 기기서든): 있음 → 열지 않음, 쓰지 않음.
  const w = f.writes();
  const r2 = await base.ensureWeekProposed({start:START, open, now:() => T(28)}, f.rt);
  assert.equal(r2.status, 'ready'); assert.equal(r2.opened, false); assert.equal(opened, 1); assert.equal(f.writes(), w);
  // 다른 판의 칸(요청 줄·자료 고침)은 그대로 두고 proposed 만 더한다.
  const g = fakeRt({rows:[{id:'r0', week_start:START, items:[], draft:{v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], docs:[{id:'x1', drop:true}]}, draft_saved_at:T(20)}]});
  await base.ensureWeekProposed({start:START, open, now:() => T(27)}, g.rt);
  assert.deepEqual(g.rows[0].draft.docs, [{id:'x1', drop:true}]);
  assert.ok(g.rows[0].draft.proposed);
  // 바탕이 없으면 저장 없음.
  const h = fakeRt();
  assert.equal((await base.ensureWeekProposed({start:START, open:async () => ({status:'none'})}, h.rt)).status, 'none');
  assert.equal(h.writes(), 0);
  // 칸 준비 전.
  assert.equal((await base.ensureWeekProposed({start:START, open}, fakeRt({missing:400}).rt)).status, 'missing');
  // 여는 사이 다른 기기가 먼저 썼다: 내 쓰기는 충돌 → 다시 읽으면 proposed 가 있으니 그것을 씀(덮지 않음).
  const k = fakeRt({rows:[{id:'r0', week_start:START, items:[], draft:null, draft_saved_at:null}]});
  const slow = async () => { k.rows[0].draft = D(); k.rows[0].draft_saved_at = T(26); return open(); };
  const r3 = await base.ensureWeekProposed({start:START, open:slow, now:() => T(27)}, k.rt);
  assert.equal(r3.status, 'ready');
  assert.deepEqual(k.rows[0].draft.proposed, proposed);
});

test('withProposed: 이미 있으면 처음 것을 둔다, 모양이 틀리면 거절', () => {
  const d = store.withProposed(D(), {...proposed, at:T(30), cells:[]});
  assert.equal(d.proposed.at, T(26));
  const e = store.withProposed(null, proposed);
  assert.deepEqual(fb.readExtras(e).proposed, fb.readProposed(proposed));
  assert.throws(() => store.withProposed(null, {cells:[]}), e2 => e2.code === 'proposed');
});

test('바탕 칸 세기·proposed 모양: 상자와 같은 칸 열쇠(같은 이름 두 번이면 n)', () => {
  const cells = base.listCells({summary:[{area:'가상 영역', task:'가상 과제', lines:['- a']}, {area:'가상 영역', task:'가상 과제', lines:['- b']}], orgs:[{org:'A 지부', lines:[]}], sites:[]});
  assert.deepEqual([...cells.keys()], [store.cellId('summary', SUM.key, 0), store.cellId('summary', SUM.key, 1), store.cellId('orgs', 'A 지부', 0)]);
  const pr = base.proposedOf({at:T(27), baseKind:'confirmed', baseInfo:{from:'file'}, cells});
  assert.equal(pr.base.from, 'file');
  assert.equal(pr.cells.length, 3);
  assert.equal(base.proposedOf({at:T(27), baseKind:'personal', baseInfo:{from:'library', document_id:'d1'}, cells, ai:true}).ai, true);
});

test('바탕 고르기(findBase): 보고일 앞 최신 개인본, 없으면 팀 확정본', async () => {
  const rt = {context:{read:() => ({workspace:{id:'w'}})}, async api(path) {
    const personal = /%EA%B0%9C%EC%9D%B8%EB%B3%B8|개인본/.test(decodeURIComponent(path));
    return personal ? [{id:'p2', document_date:'2026-11-02'}, {id:'p1', document_date:'2026-10-26'}] : [{id:'c1', document_date:'2026-10-20'}];
  }};
  const got = await base.findBase(rt, '2026-11-02');
  assert.equal(got.doc.id, 'p1'); assert.equal(got.from, 'personal');
});

test('환류 정리 시점: 확정 때 1회 + 확정 전 30건·6시간, 다시 확정은 10건, 주 3회 상한', () => {
  const add = (picks, n, from) => { let x = picks; for (let i = 0; i < n; i++) x = p.withPick(x, {kind:'line', cell:'summary:x', text:`줄 ${from}-${i}`}, 'add', H(from + i / 100)); return x; };
  let k = add(null, 29, 0);
  assert.deepEqual(p.reviewDue(k, {when:'open', now:H(1)}), {due:false, why:'few', actions:29, last:'', used:0});
  k = add(k, 1, 1);
  assert.equal(p.reviewDue(k, {when:'open', now:H(1)}).due, true);
  // 정리 한 번 → 새 동작이 0, 30건이 다시 쌓여도 6시간 전이면 아직.
  k = p.withReview(k, H(2));
  assert.equal(p.actionsSince(k, H(2)), 0);
  k = add(k, 30, 3);
  assert.equal(p.reviewDue(k, {when:'open', now:H(5)}).why, 'soon');
  assert.equal(p.reviewDue(k, {when:'open', now:H(8.1)}).why, 'actions');
  // 확정: 처음이면 동작 수와 상관없이 1회.
  assert.equal(p.reviewDue(null, {when:'confirm'}).why, 'confirm');
  // 다시 확정: 지난 정리 뒤 10건 이상일 때만.
  let c = p.withReview(add(null, 3, 0), H(1));
  assert.equal(p.reviewDue(add(c, 9, 2), {when:'confirm', confirmed:true}).why, 'few');
  assert.equal(p.reviewDue(add(c, 10, 2), {when:'confirm', confirmed:true}).why, 'reconfirm');
  // 주 3회 상한(정리 시각 기록은 두 기기 판을 합쳐도 남는다).
  c = p.mergePicks(p.withReview(c, H(3)), p.withReview(c, H(4)));
  assert.equal(c.reviews.length, 3);
  assert.equal(p.reviewDue(c, {when:'confirm'}).why, 'cap');
  assert.equal(p.reviewDue(add(c, 40, 20), {when:'open', now:H(60)}).why, 'cap');
  // 정리 시각만 있는 picks 도 사라지지 않는다.
  assert.deepEqual(p.readPicks({reviews:[H(1)]}).reviews, [H(1)]);
});
