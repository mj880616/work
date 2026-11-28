import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TABS, TAB_VIEWS, tabOfView, visibleTabs, stepTab, swipeStep, SWIPE_MIN, EDGE_SKIP} from '../app/org-biz-tabs.mjs';
import {itemOf} from '../app/menu-model.mjs';

// NAV-조직사업합침(2026-11-28 사용자 결정 10:22~10:55): [조직·사업] 메뉴 하나 안의 큰 탭 [조직 관리][사업 관리][주간 보고].
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('큰 탭 셋: 순서·화면 이름·기본 이름, 메뉴 [조직·사업] 묶음과 같은 화면들', () => {
  assert.deepEqual(TABS.map(t => [t.id, t.view, t.text]), [['team', 'team', '조직 관리'], ['meetings', 'meetings', '사업 관리'], ['weekly', 'weekly', '주간 보고']]);
  assert.deepEqual(itemOf('team').group, [...TAB_VIEWS], '메뉴 묶음 = 큰 탭 화면 + 사업영역 관리 창');
  assert.equal(itemOf('team').view, 'team', '메뉴로 들어가면 맨 앞 [조직 관리](마지막 탭 기억 없음)');
  for (const [view, tab] of [['team', 'team'], ['meetings', 'meetings'], ['projects', 'meetings'], ['reports', 'meetings'], ['weekly', 'weekly'], ['home', null], ['', null]]) assert.equal(tabOfView(view), tab, view);
});

test('보일 탭은 목록 하나(visibleTabs): 지금은 모두에게 셋, feature가 붙은 탭은 서버 기능 답에 그 키가 있을 때만', () => {
  for (const features of [null, undefined, [], ['calls']]) assert.deepEqual(visibleTabs(features).map(t => t.id), ['team', 'meetings', 'weekly'], String(features));
  assert.ok(TABS.every(t => Object.isFrozen(t)) && Object.isFrozen(TABS));
  // 다음 작업(WEEKLY-운영자전용)이 탭에 feature 키를 붙였을 때의 규칙: 답 전(null)은 빼지 않고, 키가 없으면 목록에서 뺀다(화면 숨김 아님).
  const withKey = TABS.map(t => (t.id === 'weekly' ? {...t, feature: 'weekly_x'} : t));
  const pick = features => withKey.filter(tab => !tab.feature || (!Array.isArray(features) || features.includes(tab.feature)));
  assert.deepEqual(pick(null).map(t => t.id), ['team', 'meetings', 'weekly']);
  assert.deepEqual(pick([]).map(t => t.id), ['team', 'meetings']);
  assert.match(read('app/org-biz-tabs.mjs'), /return TABS\.filter\(tab => !tab\.feature \|\| have\.has\(tab\.feature\)\);/);
  // 그리는 곳은 이 목록만 쓴다(탭을 화면에서 숨기는 길 없음).
  const dom = read('app/org-biz-tabs.js');
  assert.match(dom, /export function tabsHtml\(current, list = visibleTabs\(features\)\)/);
  assert.doesNotMatch(dom, /display\s*=\s*['"]none|style\.display/);
});

test('좌우 밀기: 왼쪽으로 밀면 다음 탭, 오른쪽이면 앞 탭, 끝에서는 돌지 않는다', () => {
  assert.equal(stepTab('team', 1), 'meetings'); assert.equal(stepTab('meetings', 1), 'weekly'); assert.equal(stepTab('weekly', 1), null);
  assert.equal(stepTab('weekly', -1), 'meetings'); assert.equal(stepTab('team', -1), null);
  assert.equal(stepTab('projects', 1), 'weekly', '사업영역 관리 창(사업 관리 위)에서도 사업 관리 기준');
  assert.equal(stepTab('home', 1), null); assert.equal(stepTab('team', 0), null);
  const at = {x0: 200, y0: 300};
  assert.equal(swipeStep({...at, x1: 200 - SWIPE_MIN, y1: 300}), 1, '왼쪽으로 60px = 다음 탭');
  assert.equal(swipeStep({...at, x1: 200 + SWIPE_MIN, y1: 310}), -1, '오른쪽 = 앞 탭');
  assert.equal(swipeStep({...at, x1: 200 - SWIPE_MIN + 1, y1: 300}), 0, '짧은 밀기는 아님');
  assert.equal(swipeStep({...at, x1: 100, y1: 360}), 0, '세로가 가로의 반을 넘으면 굴리기');
  assert.equal(swipeStep({x0: EDGE_SKIP, y0: 300, x1: EDGE_SKIP + 120, y1: 300}), 0, '왼쪽 끝 24px 안 시작은 폰 뒤로가기 밀기 몫');
  assert.equal(swipeStep({x0: NaN, y0: 0, x1: 0, y1: 0}), 0);
});

test('자리·주인: 세 칸 맨 위 자리는 index.html에, 그리는 주인은 org-biz-tabs.js 하나, 첫 화면 전에 불러온다', () => {
  const html = read('app/index.html');
  assert.match(html, /<section id="teamView" class="view-panel hidden"><div data-orgbiz-tabs="team"><\/div><\/section>/);
  assert.match(html, /<section id="meetingsView" class="view-panel hidden">\s*<div data-orgbiz-tabs="meetings"><\/div>/);
  assert.match(html, /<div data-orgbiz-tabs="weekly" hidden><\/div>\s*<div id="journalRoot" class="journal"><\/div>/, '주간 보고는 업무일지 칸의 주간 쪽');
  assert.match(read('app/loader-v2.js'), /import\('\.\/team\.js'\),[\s\S]{0,200}import\('\.\/org-biz-tabs\.js'\)\n  \]\);/);
  const dom = read('app/org-biz-tabs.js');
  assert.match(dom, /if \(slot\) slot\.hidden = view !== 'weekly';/, '업무일지 칸의 탭 줄은 [주간 보고]일 때만');
  assert.match(dom, /window\.addEventListener\('kptu:view-changed', event => placeHome\(event\.detail\?\.view\)\);/);
  // 탭 단추는 data-view: 누르기·처음 받기·주소·뒤로가기는 라우터·loader-v2.js 공용 길(새 이동 길 없음).
  assert.doesNotMatch(dom, /addEventListener\('click'/);
});

test('라우터: 주간 보고(weekly)는 업무일지 칸을 쓰는 화면, 옛 홈 주간 주소는 weekly로, 홈 주소 칸에 mode 없음', () => {
  const router = read('app/app-router.js');
  assert.match(router, /const PANEL_OF=\{weekly:'home'\};/);
  assert.match(router, /if\(\(!requested\|\|requested==='home'\)&&params\.get\('mode'\)==='week'&&!params\.get\('project'\)&&viewExists\('weekly'\)\)return 'weekly';/);
  assert.match(router, /home:\['day'\],weekly:\['day'\]/);
  assert.match(router, /const RETIRED_PLACE_KEYS=\['mode'\];/);
  const loader = read('app/loader-v2.js');
  assert.match(loader, /const oldWeekly=viewLoader\.normalize\(rawRequested\)==='home'&&params\.get\('mode'\)==='week'&&!params\.get\('project'\);/);
  assert.match(loader, /const staticShellViews=new Set\(\['home','weekly',/);
  const views = read('app/view-loader.js');
  assert.match(views, /const weekly=home;/);
  assert.match(views, /routeStyles\.weekly=routeStyles\.home;/);
  // 업무일지: 머리 줄 [하루|주간 보고] 전환 없음, 들어온 화면이 쪽을 정한다.
  const journal = read('app/journal.js');
  assert.doesNotMatch(journal, /data-journal-mode=|journal-mode-switch|setMode\(/);
  assert.match(journal, /window\.KPTURouter\?\.on\?\.\('weekly', detail => enter\(detail, 'week'\)\);/);
  assert.match(journal, /window\.KPTURouter\?\.setPlace\?\.\(viewOfMode\(\), \{day\}\);/);
});
