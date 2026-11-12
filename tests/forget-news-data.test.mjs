// FORGET-소식합치기: 잊지 말기 '소식' 줄의 순수 규칙과 구조(저장은 서버 표 app_journal_memorable뿐, 기기 저장 없음, 업무일지 묶음 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

globalThis.window ??= {KPTURuntime: null, addEventListener() {}};
const m = await import('../app/forget-news-data.js');
const read = rel => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

test('rows: malformed rows are dropped; a kept line shows the kept text; every status is kept for its view', () => {
  const rows = m.newsRows([
    {id:'1', day:'2026-10-06', source:'call', feed_item_id:'f1', org_name:' 가상지부 ', line:'일정 확정함.', status:'suggested', final_line:null, picked_at:'2026-10-06T01:00:00Z'},
    {id:'2', day:'2026-10-06', source:'telegram', feed_item_id:'f2', org_name:null, line:'원래 글', status:'kept', final_line:'고친 글', decided_at:'2026-10-06T02:00:00Z'},
    {id:'3', day:'2026-10-05', source:'call', feed_item_id:'f3', line:'뺀 줄', status:'dropped'},
    {id:'4', day:'2026-10-06', line:'', status:'suggested'}, {id:'5', day:'x', line:'a', status:'suggested'}, {id:'6', day:'2026-10-06', line:'a', status:'odd'}, null,
  ]);
  assert.deepEqual(rows.map(r => [r.id, r.org, r.line, r.status, r.source]), [['1', '가상지부', '일정 확정함.', 'suggested', 'call'], ['2', '', '고친 글', 'kept', 'telegram'], ['3', '', '뺀 줄', 'dropped', 'call']]);
  // 종류·이유를 못 읽으면(표 적용 전) 처리 전 줄 모두.
  assert.deepEqual(m.openNews(rows, false).map(r => r.id), ['1']);
  // FORGET-소식바로잡기 ⑤: 종류·이유를 읽으면 새 기준(종류 있는) 줄만 처리 전·빨간 숫자에.
  assert.deepEqual(m.openNews(rows).map(r => r.id), []);
  assert.equal(m.picksKnown([{id: '1'}]), false);
  const picked = m.newsRows([{id:'7', day:'2026-10-06', source:'call', line:'가상 줄', status:'suggested', app_journal_memorable_picks: {kind: 'org', reason: '조직보고 · 가상지부'}},
    {id:'8', day:'2026-10-06', source:'call', line:'옛 기준 줄', status:'suggested', app_journal_memorable_picks: null},
    {id:'9', day:'2026-10-06', source:'call', line:'다섯 밖', status:'suggested', app_journal_memorable_picks: [{kind: 'weekly', reason: 'x'}]}]);
  assert.equal(m.picksKnown([{id:'8', app_journal_memorable_picks: null}]), true);
  assert.deepEqual(picked.map(r => [r.id, r.kind, r.reason]), [['7', 'org', '조직보고 · 가상지부'], ['8', '', ''], ['9', '', '']]);
  assert.deepEqual(m.openNews(picked, true).map(r => r.id), ['7']);
  assert.deepEqual(m.newsRows(null), []);
  assert.equal(m.newsText(rows[0]), '가상지부 · 일정 확정함.');
  assert.equal(m.newsText(rows[1]), '고친 글');
  assert.deepEqual({...m.NEWS_SOURCE_TAG}, {telegram:'소식 · 텔레그램', call:'소식 · 통화'});
});
test('조직 이름 맞추기: 내 담당조직(활동 중)의 이름·다른 이름과 공백·대소문자만 무시하고 같을 때만', () => {
  const orgs = [{id:'a', name:'가상 지부', aliases:['가상노조A'], active:true}, {id:'b', name:'다른 지부', active:true}, {id:'c', name:'쉬는 지부', active:false}];
  const mine = new Set(['a', 'c']);
  assert.equal(m.matchOrg('가상지부', orgs, mine)?.id, 'a');
  assert.equal(m.matchOrg('가상노조a', orgs, mine)?.id, 'a');
  assert.equal(m.matchOrg('다른 지부', orgs, mine), null); // 내 담당이 아님
  assert.equal(m.matchOrg('쉬는 지부', orgs, mine), null); // 쉬는 조직
  assert.equal(m.matchOrg('가상', orgs, mine), null); // 비슷한 이름은 맞추지 않음
  assert.equal(m.matchOrg('', orgs, mine), null);
});
test('구조: 서버 표만 쓰고(쓰는 칸은 표가 허락한 것만), 기존 기록 길을 다시 쓰고, 업무일지 묶음은 없다', () => {
  const src = read('app/forget-news-data.js'), list = read('app/forget-list.js');
  for (const word of ['local', 'session'].map(k => k + 'Storage').concat(['indexed' + 'DB'])) { assert.ok(!src.includes(word), word); assert.ok(!list.includes(word), word); }
  assert.match(src, /kind: 'journal_memorable'/);
  assert.match(src, /body = \{status, final_line: status === 'kept' \? finalLine : null, drop_reason: null, decided_at:/);
  assert.match(list, /saveOrganizationUpdate\(\{organization_id: org\.id/);
  // BIZ-기록하나로 B-3: [사업]은 사업 기록(app_business_records) 한 줄 — 소식은 원래 소식 줄 번호를 함께(source_kind memorable).
  assert.match(list, /saveBusinessRecord\(\{space_id: project\.id/);
  assert.match(list, /source_kind: 'memorable', source_id: news\.id/);
  assert.doesNotMatch(list, /saveProjectProgress/);
  assert.ok(!existsSync(new URL('../app/journal-memorable.js', import.meta.url)));
  assert.doesNotMatch(read('app/journal.js'), /memorable/i);
  // 홈 칩·메뉴 '홈' 표시가 처리 전 소식을 센다.
  assert.match(read('app/home-summary.js'), /countOpenNews\(rt\)/);
  assert.match(list, /\(nOn \? openNews\(news, nPicks\)\.length : 0\)/);
  assert.match(src, /return r\.ok \? openNews\(r\.rows, r\.picks\)\.length : 0;/);
  assert.match(src, /const PICK = 'app_journal_memorable_picks';/); assert.match(src, /\$\{base\},\$\{PICK\}\(kind,reason,picked_at\)/);
});

// FORGET-소식바로잡기 ④: 옛 기준 줄 세기와 서버 다시 판정 부르기(화면은 mode만 보낸다 — 대상 줄·작업공간은 서버가 정함).
test('옛 소식 정리: 종류를 읽을 수 있을 때만 옛 줄을 세고, 서버에는 kind·mode만 보낸다', async () => {
  const rows = m.newsRows([{id:'1', day:'2026-10-06', source:'call', line:'새 줄', status:'suggested', app_journal_memorable_picks: {kind:'task', reason:'할 일'}},
    {id:'2', day:'2026-10-06', source:'call', line:'옛 줄', status:'suggested', app_journal_memorable_picks: null},
    {id:'3', day:'2026-10-06', source:'call', line:'뺀 옛 줄', status:'dropped', app_journal_memorable_picks: null}]);
  assert.deepEqual(m.oldNews(rows).map(r => r.id), ['2']);
  assert.deepEqual(m.oldNews(rows, false), [], 'picks table not readable → no cleanup line');
  const sent = [];
  const rt = {session: {ensure: async () => true, read: () => ({access_token: 't'})}, config: {url: 'https://x.test', key: 'k'}};
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); const b = JSON.parse(init.body);
    return new Response(JSON.stringify({ok: true, kind: b.kind, mode: b.mode, target: 2, keep: 1, drop: 1, left: 0}), {status: 200}); };
  assert.deepEqual(await m.recheckNews(rt, 'preview', {fetcher}), {ok: true, keep: 1, drop: 1, left: 0, promise: 0, target: 2});
  assert.deepEqual(sent, [{kind: 'journal_memorable_recheck', mode: 'preview'}]);
  assert.deepEqual(await m.recheckNews(rt, 'delete', {fetcher}), {ok: false});
  const bad = async () => new Response(JSON.stringify({ok: true, kind: 'journal_memorable_recheck', mode: 'run', keep: -1, drop: 1, left: 0}), {status: 200});
  assert.deepEqual(await m.recheckNews(rt, 'run', {fetcher: bad}), {ok: false});
});
