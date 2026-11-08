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
  assert.deepEqual(m.openNews(rows).map(r => r.id), ['1']);
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
  assert.match(list, /saveProjectProgress\(\{project_id: project\.id/);
  assert.ok(!existsSync(new URL('../app/journal-memorable.js', import.meta.url)));
  assert.doesNotMatch(read('app/journal.js'), /memorable/i);
  // 홈 칩·메뉴 '홈' 표시가 처리 전 소식을 센다.
  assert.match(read('app/home-summary.js'), /countOpenNews\(rt\)/);
  assert.match(list, /\(nOn \? openNews\(news\)\.length : 0\)/);
});
