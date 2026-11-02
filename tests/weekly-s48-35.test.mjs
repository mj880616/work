import test from 'node:test';
import assert from 'node:assert/strict';
// S48-35(WEEKLY-환류전칸): 2) 세부 내용 — 원래 기록에서 끌어온 줄의 고치기·빼기는 제안 답(edit·drop), 확정 때 그대로 둔 줄은 take.
// 칸 묶음 이름 '2. 세부 내용'은 앱(pickGroup)과 서버(weekly-learn.ts groupOf)가 같다. 가짜 글만.
import {detailPick, withDetailTakes, withLinePick} from '../app/weekly-draft-store.js';
import {cellKeptRates, pickGroup, readPicks, PICK_GROUPS} from '../app/weekly-picks.mjs';
import {readFileSync} from 'node:fs';

const AT = '2026-11-02T01:00:00.000Z';
const A = {text:'10:00 가상 회의 1차', ref:'meeting:m1'}, B = {text:'가상 결의대회(고침)', original:'가상 결의대회', edited:true, ref:'meeting:m2'};
const C = {text:'가상 선전전', ref:'meeting:m3'}, H = {text:'가상 손 줄', hand:'h1'};

test('detailPick: 열쇠 글은 늘 원래 기록 글, 고치기는 before 에 원래 글', () => {
  assert.deepEqual(detailPick('edit', B, '가상 결의대회(다시)'), {kind:'material', from:'record', act:'edit', text:'가상 결의대회(다시)', before:'가상 결의대회'});
  assert.deepEqual(detailPick('drop', B), {kind:'material', from:'record', act:'drop', text:'가상 결의대회'});
  assert.deepEqual(detailPick('none', A), {kind:'material', from:'record', act:'none', text:A.text});
});

test('withLinePick + detailPick: 고침·뺌·되돌림이 한 열쇠에 모이고 칸 묶음은 2. 세부 내용', () => {
  let d = withLinePick(null, {cell:'details', ...detailPick('edit', B, '가상 결의대회(다시)'), at:AT});
  d = withLinePick(d, {cell:'details', ...detailPick('drop', B), at:'2026-11-02T02:00:00.000Z'});
  const items = readPicks(d.picks).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].act, 'drop');
  assert.equal(pickGroup(items[0]), '2. 세부 내용');
  d = withLinePick(d, {cell:'details', ...detailPick('none', B), at:'2026-11-02T03:00:00.000Z'});
  assert.equal(readPicks(d.picks).items[0].act, 'none');
});

test('withDetailTakes: 고치지 않은 원래 기록 줄만 take, 손 줄·고친 줄·이미 답한 줄은 그대로', () => {
  let d = withLinePick(null, {cell:'details', ...detailPick('drop', C), at:AT});
  const picks = withDetailTakes(d.picks, [A, B, H, C], '2026-11-02T04:00:00.000Z');
  const items = readPicks(picks).items;
  assert.deepEqual(items.map(x => [x.act, x.text]).sort(), [['drop', '가상 선전전'], ['take', A.text]]);
  // 다시 확정해도 같은 열쇠 하나.
  assert.equal(readPicks(withDetailTakes(picks, [A])).items.length, 2);
  assert.equal(withDetailTakes(null, []), null);
  // 그대로 쓴 비율: 2. 세부 내용 = take 1 / (take 1 + drop 1).
  assert.deepEqual(cellKeptRates(picks).find(r => r.group === '2. 세부 내용'), {group:'2. 세부 내용', percent:50, answered:2});
});

test('묶음 이름: 앱 PICK_GROUPS 순서와 서버 groupOf 가 2. 세부 내용을 같이 안다', () => {
  assert.deepEqual(PICK_GROUPS.slice(0, 3), ['1. 요청사항', '2. 사업 요약', '2. 세부 내용']);
  const src = readFileSync(new URL('../supabase/functions/ai-assist/weekly-learn.ts', import.meta.url), 'utf8');
  assert.match(src, /p\.cell === "details" \? "2\. 세부 내용"/);
});

// WEEKLY-사업영역칸 2): 바탕에 줄이 없는 사업영역 칸 → 바로 앞 주 임시저장의 그 사업영역 줄(바탕 + 고친 칸)을 '지난주에서' 제안으로.
import {carriedAreaLines, readCarriedAreas, areaNameKey} from '../app/weekly-draft-store.js';
const prevDraft = {proposed:{at:AT, base:{from:'personal', document_id:'d0'}, cells:[
  {section:'summary', key:'가 영역›가-1', n:0, lines:['- 가상 바탕 줄']},
  {section:'summary', key:'2인 1조 법제화›', n:0, lines:['- 가상 옛 줄']},
  {section:'orgs', key:'A 지부', n:0, lines:['- 조직 줄']}]},
  rows:[{section:'summary', key:'2인 1조 법제화›', n:0, lines:['- 가상 고친 줄', '']}, {section:'summary', key:'2인 1조 법제화›입법', n:0, lines:['- 가상 입법 줄', '- 가상 고친 줄']}]};

test('carriedAreaLines: 사업영역마다 앞 주 칸 줄(고친 칸이 바탕 위), 빈 줄·같은 줄·다른 묶음은 빼고', () => {
  const a = carriedAreaLines(prevDraft);
  assert.deepEqual([...a.keys()], ['가영역', '2인1조법제화']);
  assert.deepEqual(a.get(areaNameKey('2인 1조  법제화')), ['- 가상 고친 줄', '- 가상 입법 줄']);
  assert.deepEqual(carriedAreaLines(null).size, 0);
});

test('readCarriedAreas: 이번 주 앞 주 한 행만 읽고(select 는 rows·proposed), 실패·없음은 null', async () => {
  const asked = [];
  const rt = {context:{read:() => ({workspace:{id:'w1'}})}, api:async url => { asked.push(url); return [{week_start:'2026-10-26', rows:prevDraft.rows, proposed:prevDraft.proposed}]; }};
  const r = await readCarriedAreas('2026-11-02', rt);
  assert.equal(r.week, '2026-10-26');
  assert.deepEqual(r.areas.get('2인1조법제화'), ['- 가상 고친 줄', '- 가상 입법 줄']);
  assert.match(asked[0], /week_start=lt\.2026-11-02/);
  assert.match(asked[0], /select=week_start,rows:draft->rows,proposed:draft->proposed/);
  assert.match(asked[0], /order=week_start\.desc&limit=1/);
  assert.equal(await readCarriedAreas('2026-11-02', {...rt, api:async () => { throw new Error('x'); }}), null);
  assert.equal(await readCarriedAreas('2026-11-02', {...rt, api:async () => []}), null);
  assert.equal(await readCarriedAreas('nope', rt), null);
});
