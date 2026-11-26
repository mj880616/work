// S70-28 UI-우클릭전수: 앱 모든 메뉴 화면(PC 1280)에서 사람이 우클릭할 만한 자리에 실제 마우스 우클릭을 보내
// 결과를 표로 모은다(docs/qa/context-menu-audit-20261125.md의 근거). 두 부분이다.
//  ① 전수 표(census): 화면마다 줄·카드·폴더 줄·빈 곳·글·머리 줄·입력 칸을 저절로 찾아 우클릭하고 [ctx] 줄로 적는다.
//     자리 이름·결과만 적고 실패시키지 않는다(자료 모양에 따라 자리가 늘고 준다).
//  ② 지키는 표(SPOTS): 이름 붙인 자리마다 기대(app = 앱 메뉴, browser = 브라우저 기본 메뉴)를 확인한다.
//     아직 못 고친 자리는 gap(맡은 작업 이름)으로 적어 지금 모양(브라우저 메뉴)을 확인한다 — 고치는 PR이 그 줄의 gap을 지우고
//     want를 app으로 바꾸면 고치기 전 실패·고친 뒤 통과가 된다.
// 앱 메뉴가 열리면 그 줄의 ⋯ 메뉴 항목과 같은지도 본다(공용 부품 app/context-menu.js는 그 ⋯를 그대로 누른다).
// 누가 우클릭을 받았는지(어느 파일의 contextmenu 처리가 기본 메뉴를 막았는지)는 addEventListener를 감싸 기록한다.
// Supabase·Google은 모두 모의 응답(운영 접속·실데이터 없음).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import { start as startFiles, openFiles } from './helpers/files-server.mjs';
import { start as startNews, openNews } from './helpers/news-server.mjs';
import { bootLibrary, libFolder } from './helpers/library-folder-server.mjs';
import { fixture as callFixture, openCalls } from './helpers/call-feed-server.mjs';

test.use({ timezoneId: 'Asia/Seoul' });
const W = 1280;

// 어느 파일의 contextmenu 처리가 기본 메뉴를 막았는지 적는다(앱 코드는 그대로, 등록만 감싼다).
async function instrument(page) {
  await page.addInitScript(() => {
    window.__ctxBy = [];
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    const wrapped = new WeakMap();
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (type !== 'contextmenu' || typeof fn !== 'function') return add.call(this, type, fn, opts);
      const src = (new Error().stack || '').split('\n').map(l => (l.match(/\/app\/([^?:\s)]+\.m?js)/) || [])[1]).find(Boolean) || '?';
      let w = wrapped.get(fn);
      if (!w) { w = function (e) { const before = e.defaultPrevented; const r = fn.call(this, e); if (!before && e.defaultPrevented) window.__ctxBy.push(src); return r; }; wrapped.set(fn, w); }
      return add.call(this, type, w, opts);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, opts) { return remove.call(this, type, (type === 'contextmenu' && wrapped.get(fn)) || fn, opts); };
    // 다른 window 처리보다 뒤에 읽는다(같은 단계의 처리는 등록 순서대로 돌므로, 다 돈 뒤 setTimeout으로 읽는다).
    add.call(window, 'contextmenu', e => { setTimeout(() => { window.__ctxPrevented = e.defaultPrevented; }, 0); });
  });
}

// 지금 떠 있는 메뉴 판의 항목 이름들(⋯ 판·#rowMenu·role=menu·열린 details).
const MENU_LABELS = () => {
  const vis = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const isMore = el => /^[⋯⋮]$/.test((el.textContent || '').trim());
  const panels = new Set();
  for (const t of document.querySelectorAll('[aria-expanded="true"]')) {
    const p = document.getElementById(t.getAttribute('aria-controls') || '') || (t.nextElementSibling?.matches('[role="menu"],[role="group"]') ? t.nextElementSibling : null);
    if (p && vis(p) && (isMore(t) || p.matches('[role="menu"]'))) panels.add(p);
  }
  for (const m of document.querySelectorAll('[role="menu"],#rowMenu,[popover]:popover-open')) if (vis(m)) panels.add(m);
  for (const d of document.querySelectorAll('details[open]')) { const s = d.querySelector(':scope>summary'); if (s && isMore(s)) { const p = [...d.children].find(c => c !== s); if (vis(p)) panels.add(p); } }
  const out = [];
  for (const p of panels) for (const b of p.querySelectorAll('button,[role="menuitem"],a[href]')) { if (!vis(b)) continue; const t = (b.textContent || '').replace(/\s+/g, ' ').trim(); if (t && !/^[⋯⋮×✕‹›]$/.test(t)) out.push(t); }
  return out;
};

async function closeMenus(page) {
  for (let i = 0; i < 2; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(60); }
  await page.evaluate(() => { for (const d of document.querySelectorAll('details[open]')) { const s = d.querySelector(':scope>summary'); if (s && /^[⋯⋮]$/.test(s.textContent.trim())) d.open = false; } });
  // Esc로 안 닫히는 메뉴는 바깥 누르기(pointerdown)로 닫는다 — 앞 자리 메뉴가 남아 다음 자리 결과에 섞이지 않게.
  if ((await page.evaluate(MENU_LABELS)).length) {
    await page.evaluate(() => { for (const t of ['pointerdown', 'mousedown', 'pointerup', 'click']) document.documentElement.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: 1, clientY: 1 })); });
    await page.waitForTimeout(80);
  }
  return (await page.evaluate(MENU_LABELS)).length === 0;
}

// 한 자리를 우클릭하고 결과를 잰다: app(기본 메뉴 막고 앱 메뉴 뜸) / blocked(막았는데 메뉴 없음) / browser(기본 메뉴).
async function rightClickAt(page, x, y) {
  const clean = await closeMenus(page);
  await page.evaluate(() => { window.__ctxBy = []; window.__ctxPrevented = null; });
  await page.mouse.move(x, y);
  await page.mouse.click(x, y, { button: 'right' });
  await page.waitForTimeout(220);
  const r = await page.evaluate(MENU_LABELS).then(labels => page.evaluate(labels => ({ prevented: window.__ctxPrevented === true || window.__ctxBy.length > 0, by: [...new Set(window.__ctxBy)], labels }), labels));
  // window까지 안 올라오는 처리(stopPropagation)도 있어 '누가 막았나' 기록도 막은 것으로 본다.
  r.result = r.prevented ? (r.labels.length ? 'app' : 'blocked') : 'browser';
  if (!clean) r.result += '?'; // 앞 메뉴가 닫히지 않은 채 잼(믿지 않음)
  return r;
}

// 화면 안 자리 찾기: 줄 모양(줄·카드·칸·그림), 머리 줄, 글, 빈 곳, 입력 칸. 같은 모양(태그+앞 두 클래스+role)은 하나만.
function discover(rootSel) {
  const root = document.querySelector(rootSel);
  if (!root) return [];
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 10 && r.bottom > 40 && r.top < innerHeight - 10 && r.left < innerWidth && r.right > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const isMore = el => /^[⋯⋮]$/.test((el.textContent || '').trim());
  const BAD = 'input,textarea,select,[contenteditable="true"],[contenteditable=""],button,summary,a[href],label,.app-nav,.app-topline,.mobile-tabs,[role="menu"],.modal:not(.view-panel *)';
  const ROWISH = 'li,tr,article,[role="listitem"],[role="row"],[role="option"],[role="treeitem"],[role="gridcell"],[data-ctx-row],img,figure,[class*="-row"],[class*="row-"],[class*="-item"],[class*="-card"],[class*="-line"],[class*="-cell"],[class*="-day"],[class*="-chip"],[class*="-tile"]';
  // 누를 점으로는 입력 칸·링크·⋯ 단추·틀(메뉴·위 줄)만 피한다(줄 전체가 단추인 할 일 줄처럼 단추 위 우클릭도 사람이 하는 일).
  const BAD_PT = 'input,textarea,select,[contenteditable="true"],[contenteditable=""],a[href],.app-nav,.app-topline,.mobile-tabs,[role="menu"]';
  const badPoint = hit => hit.closest(BAD_PT) || [...hit.closest('button,summary') ? [hit.closest('button,summary')] : []].some(isMore);
  const sig = el => el.tagName.toLowerCase() + '.' + [...el.classList].filter(c => !/^(is-|on|active|picked|selected|open|hover|focus)/.test(c)).slice(0, 2).join('.') + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '');
  // 그 요소 위에서 버튼·링크·입력이 아닌 점 하나(요소 자신이나 그 안의 글자가 맞는 점).
  const pointIn = el => {
    const r = el.getBoundingClientRect();
    const xs = [r.left + Math.min(40, r.width / 2), r.left + r.width / 2, r.left + 10, r.right - 14], ys = [r.top + r.height / 2, r.top + Math.min(10, r.height / 2)];
    for (const y of ys) for (const x of xs) {
      if (x < 2 || y < 2 || x > innerWidth - 2 || y > innerHeight - 2) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit) && !badPoint(hit)) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  };
  const moreOf = el => [...el.querySelectorAll('button,summary')].filter(b => isMore(b) && b.getClientRects().length && !b.disabled);
  const text = el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  const out = [], seen = new Set();
  let n = 0;
  const push = (kind, el, extra = {}) => {
    const s = kind + ':' + sig(el);
    if (seen.has(s) || out.length >= 40) return;
    const pt = pointIn(el);
    if (!pt) return;
    seen.add(s);
    el.dataset.ctxAudit = String(++n);
    const mores = moreOf(el);
    out.push({ id: n, kind, sig: sig(el), label: text(el), ...pt, more: mores.length, ...extra });
  };
  for (const el of root.querySelectorAll(ROWISH)) { if (vis(el) && !el.closest(BAD) && el.getBoundingClientRect().height < 260) push(el.matches('img,figure') ? 'picture' : 'row', el); }
  for (const el of root.querySelectorAll('h1,h2,h3,[class*="head"],[class*="title"]')) if (vis(el) && !el.closest(BAD)) push('head', el);
  for (const el of root.querySelectorAll('p,[class*="body"],[class*="prose"],[class*="text"],pre,blockquote')) if (vis(el) && !el.closest(BAD) && text(el).length > 8) push('text', el);
  // 빈 곳: 화면 안 격자 점 중 글자 없는 큰 틀(줄 모양 아님)에 맞는 점.
  const R = root.getBoundingClientRect();
  outer: for (let fy = 0.95; fy > 0.3; fy -= 0.1) for (let fx = 0.2; fx < 0.95; fx += 0.25) {
    const x = Math.round(R.left + R.width * fx), y = Math.round(Math.min(innerHeight - 20, R.top + R.height * fy));
    if (y < 60) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !root.contains(hit) || hit.closest(BAD) || hit.closest(ROWISH)) continue;
    const own = [...hit.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
    if (own) continue;
    hit.dataset.ctxAudit = String(++n);
    out.push({ id: n, kind: 'blank', sig: sig(hit), label: '(빈 곳)', x, y, more: 0 });
    break outer;
  }
  const input = [...root.querySelectorAll('input[type="text"],input[type="search"],input:not([type]),textarea')].find(vis);
  if (input) { const r = input.getBoundingClientRect(); input.dataset.ctxAudit = String(++n); out.push({ id: n, kind: 'input', sig: sig(input), label: input.getAttribute('placeholder') || input.getAttribute('aria-label') || '(입력 칸)', x: Math.round(r.left + Math.min(30, r.width / 2)), y: Math.round(r.top + r.height / 2), more: 0 }); }
  return out;
}

// 줄 안 ⋯를 직접 눌러 그 메뉴 항목을 읽는다(PC는 hover 줄에만 ⋯가 보이는 곳이 있어 줄 위에 먼저 마우스를 둔다).
async function moreLabels(page, id, x, y) {
  await closeMenus(page);
  await page.mouse.move(x, y);
  const more = page.locator(`[data-ctx-audit="${id}"]`).locator('button,summary').filter({ hasText: /^\s*[⋯⋮]\s*$/ }).first();
  if (!(await more.count()) || !(await more.isVisible())) return null;
  await more.click();
  await page.waitForTimeout(200);
  const labels = await page.evaluate(MENU_LABELS);
  await closeMenus(page);
  return labels;
}

const rows = [];
async function census(page, screen, rootSel, testInfo) {
  await page.waitForTimeout(400);
  const spots = await page.evaluate(discover, rootSel);
  for (const s of spots) {
    const r = await rightClickAt(page, s.x, s.y);
    let same = '';
    if (s.more === 1 && r.result === 'app') {
      const m = await moreLabels(page, s.id, s.x, s.y);
      same = m ? (JSON.stringify(m) === JSON.stringify(r.labels) ? '같음' : '다름') : '';
    } else if (s.more && r.result === 'browser') same = '⋯ 있음';
    const row = { screen, kind: s.kind, sig: s.sig, label: s.label, more: s.more, result: r.result, by: r.by.join('+'), same, items: r.labels.slice(0, 8).join('·') };
    rows.push(row);
    console.log('[ctx]', [row.screen, row.kind, row.sig, row.label, row.result, row.by, row.same, row.items].join(' | '));
  }
  await testInfo.attach('ctx-' + screen, { body: JSON.stringify(rows.filter(r => r.screen === screen), null, 1), contentType: 'application/json' });
  return spots;
}

// ② 지키는 표: 이름 붙인 자리. want = app | browser. gap = 아직 브라우저 메뉴가 뜨는 자리를 맡은 작업(고치는 PR이 지운다).
// sel은 화면 안 자리(첫 번째 보이는 것), at은 그 자리 안 누를 점(left 기준 px, 없으면 왼쪽 40px·가운데).
async function expectSpot(page, { name, sel, want, gap = null, at = null, labels = null }) {
  const loc = page.locator(sel).first();
  await expect(loc, name).toBeVisible();
  const b = await loc.boundingBox();
  const x = Math.round(b.x + (at ?? Math.min(40, b.width / 2))), y = Math.round(b.y + Math.min(b.height / 2, 14));
  const r = await rightClickAt(page, x, y);
  const now = r.result === 'app' ? 'app' : 'browser';
  const expected = gap ? 'browser' : want;
  expect(now, `${name}: ${gap ? '알려진 빈 곳(' + gap + ') — 고쳤으면 SPOTS에서 gap을 지운다' : '기대 ' + want}`).toBe(expected);
  if (labels && !gap) expect(r.labels, name + ' 메뉴 항목').toEqual(labels);
  await closeMenus(page);
  return r;
}

// Shift+F10(메뉴 키)도 마우스 우클릭과 같은 메뉴인지: 줄 안에서 초점을 잡을 수 있는 것에 초점을 두고 누른다.
async function keyboardMenu(page, sel) {
  await closeMenus(page);
  const loc = page.locator(sel).first();
  await loc.evaluate(el => { const f = el.matches('[tabindex],a[href],button') ? el : el.querySelector('[tabindex]:not([tabindex="-1"]),a[href],button:not([disabled])'); (f || el).focus(); });
  await page.evaluate(() => { window.__ctxBy = []; window.__ctxPrevented = null; });
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(220);
  const labels = await page.evaluate(MENU_LABELS);
  const prevented = await page.evaluate(() => window.__ctxPrevented === true || window.__ctxBy.length > 0);
  await closeMenus(page);
  return { prevented, labels };
}


// 지키는 표(화면별). gap이 있는 줄 = 지금 브라우저 메뉴가 뜨는 알려진 빈 곳(맡은 PR 이름). 고치는 PR이 gap을 지운다.
// '⋯ 없음' = 그 자리에 ⋯ 메뉴 자체가 없어 우클릭이 열 메뉴가 없다(문서 3절 B).
const SCREEN_GAP = 'S70-28 빈 곳 메뉴(화면 머리 ⋯ 없음)';
const SPOTS = {
  '홈': [
    { name: '홈 할 일 줄', sel: '#homeView li.journal-task-item', want: 'app' },
    { name: '홈 일정 줄', sel: '#homeView li.journal-event', want: 'app', gap: 'S70-28 ⋯ 없음 줄(홈 일정)' },
    { name: '홈 조직 소식 줄', sel: '#homeView li.journal-item:not(.journal-task-item)', want: 'app', gap: 'S70-28 ⋯ 없음 줄(홈 조직 소식)' },
    { name: '홈 날짜 머리', sel: '#homeView .journal-day-title', want: 'app', gap: SCREEN_GAP },
  ],
  '할 일': [
    { name: '할 일 줄', sel: '#tasksView li.gt-row.gt-card', want: 'app' },
    { name: '할 일 머리 줄', sel: '#tasksView .gt-head-left', want: 'app', gap: SCREEN_GAP },
  ],
  // A(S70-28): 머리 줄 '새로 만들기' 단추(data-ctx-screen-item)를 빈 곳 우클릭 메뉴로.
  '하루 기록': [{ name: '하루 기록 머리 줄', sel: '#diaryView .diary-week-head', want: 'app', labels: ['하루 기록 쓰기'] }],
  // S70-57: 사진 화면 첫 줄 제목 묶음(.photos-head)은 없앴다(이름·찾기·출처는 맨 위 줄) — 머리 줄 = 도구 줄의 빈 곳.
  '사진': [{ name: '사진 머리 줄', sel: '#photosView .photos-bar', want: 'app', gap: SCREEN_GAP, at: 600 }],
  '잊지 말기': [{ name: '잊지 말기 머리 줄', sel: '#basketView .forget-head', want: 'app', gap: SCREEN_GAP, at: 200 }],
  // S70-40b ④: PC 틀은 목록 머리 줄 제목이 없다(위 줄에 화면 이름). S71-26: ＋가 맨 위 줄로 가 목록 머리 줄(.rd-head)도 없다 — 목록 첫 줄(보기 탭) 오른쪽 빈 곳.
  // S70-28: 그 우클릭 메뉴에 '글 추가'(＋는 맨 위 줄 단추 상자 — data-screen-tools-for로 찾는다).
  '저장한 글': [{ name: '저장한 글 첫 줄', sel: '#readingView [data-rd-list]', want: 'app', labels: ['글 추가'], at: 300 }, { name: '저장한 글 빈 곳', sel: '#readingView .wait-empty', want: 'app', labels: ['글 추가'] }],
  '조직 관리': [
    { name: '조직 카드', sel: '#teamView article.so-card', want: 'app' },
    { name: '조직 기록 줄', sel: '#teamView .wd-log-row', want: 'app' },
    { name: '조직 기록 입력 칸', sel: '#teamView textarea', want: 'browser' },
  ],
  // BIZ-머리한줄(S71-23): 첫 줄(PC 화면 안 #reportTop)은 ⋯ 대신 [+](data-ctx-screen-item '추가') — 빈 곳 우클릭은 그 단추 메뉴.
  '사업 관리': [{ name: '사업 관리 머리 줄', sel: '#reportTop', want: 'app', labels: ['추가'], at: 300 }],
  '브리핑 룸': [{ name: '브리핑 룸 제목', sel: '#briefView .br-title', want: 'app', gap: 'S70-27 브리핑 룸' }],
  '텔레그램 소식': [{ name: '텔레그램 머리 줄', sel: '#telegramView .feed-head-sub', want: 'app' }],
  '아스날': [{ name: '아스날 경기 글', sel: '#arsenalView .ars-verdict', want: 'app', gap: 'S70-16 고른 글 메뉴(읽기 글) + 화면 머리 ⋯ 없음' }],
};

// 메뉴 화면 표: 기본 계정(운영자 기능 켬) 한 번에 돌 수 있는 화면. 자료가 따로 필요한 화면은 아래 따로 시험.
const HOME_VIEWS = [
  ['홈', 'home', '#homeView'],
  ['달력', 'calendar', '#calendarView'],
  ['할 일', 'tasks', '#tasksView'],
  ['하루 기록', 'diary', '#diaryView'],
  ['사진', 'photos', '#photosView'],
  ['잊지 말기', 'basket', '#basketView'],
  ['저장한 글', 'reading', '#readingView'],
  ['조직 관리', 'team', '#teamView'],
  ['사업 관리', 'meetings', '#meetingsView'],
  ['브리핑 룸', 'brief', '#briefView'],
  ['텔레그램 소식', 'telegram', '#telegramView'],
  ['아스날', 'arsenal', '#arsenalView'],
];

// 화면마다 새로 연다(앞 화면에서 연 창·메뉴가 다음 화면 결과에 섞이지 않게).
for (const [screen, view, root] of HOME_VIEWS) test('S70-28 전수 1280: ' + screen, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: W, height: 900 });
  await instrument(page);
  await openHome(page);
  if (view !== 'home') await clickView(page, view);
  await expect(page.locator(root)).toBeVisible({ timeout: 10000 });
  await census(page, screen, root, testInfo);
  for (const spot of SPOTS[screen] || []) await expectSpot(page, spot);
});

test('S70-28 1280: 입력 칸은 브라우저 기본 메뉴', async ({ page }) => {
  await page.setViewportSize({ width: W, height: 900 });
  await instrument(page);
  await openHome(page);
  const box = page.locator('#homeView textarea:visible, #homeView input[type="text"]:visible').first();
  if (await box.count()) {
    const b = await box.boundingBox();
    expect((await rightClickAt(page, Math.round(b.x + 20), Math.round(b.y + b.height / 2))).result, '홈 입력 칸 = 브라우저 기본 메뉴').toBe('browser');
  }
});

test('S70-28 전수 1280: 파일 화면', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await instrument(page);
  await startFiles(page, W);
  await openFiles(page, W);
  await expect(page.locator('#filesRoot [data-fx-list] [data-fx-row="od:OD!1"]')).toBeVisible();
  await census(page, '파일', '#filesView', testInfo);
  const r = await expectSpot(page, { name: '파일 목록 폴더 줄', sel: '#filesRoot [data-fx-list] [data-fx-row="od:OD!1"]', want: 'app' });
  expect(r.labels[0]).toBe('이 폴더로 들어가기');
  await expectSpot(page, { name: '파일 목록 빈 곳', sel: '#filesRoot .fx-cols', want: 'app', gap: 'N6 [파일] 빈 곳', at: 600 });
  await expectSpot(page, { name: '파일 나무 [휴지통] 줄', sel: '#filesRoot .ft-row.ft-trash', want: 'app', gap: 'S70-28 ⋯ 없음 줄(파일 나무 별표·휴지통)' });
  // S70-57: 화면 안 찾기 칸은 없고 맨 위 칸이 '파일에서 찾기'를 겸한다(글 칸이라 브라우저 메뉴 그대로).
  await expectSpot(page, { name: '파일 찾기 칸(맨 위 칸)', sel: '#gsTopInput[data-screen-find="files"]', want: 'browser' });
  const k = await keyboardMenu(page, '#filesRoot [data-fx-list] [data-fx-row="od:OD!1"]');
  console.log('[ctx-key] 파일 줄 Shift+F10 |', k.prevented, '|', k.labels.join('·'));
});

test('S70-28 전수 1280: News(읽을 거리) 화면', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await instrument(page);
  await startNews(page, W);
  await openNews(page, W);
  await expect(page.locator('#newsRoot [data-nc-item="c1"]')).toBeVisible();
  await census(page, '읽을 거리', '#outsideView', testInfo);
  await expectSpot(page, { name: 'News 글 줄 제목', sel: '#newsRoot [data-nc-item="c1"] .nw-title', want: 'app' });
  // S70-54 UI-검색창하나로: 화면 안 찾기 칸은 없고 맨 위 칸이 '읽을 거리에서 찾기'를 겸한다(글 칸이라 브라우저 메뉴 그대로).
  await expectSpot(page, { name: 'News 찾기 칸(맨 위 칸)', sel: '#gsTopInput[data-screen-find="outside"]', want: 'browser' });
});

test('S70-28 전수 1280: 자료실 화면', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await instrument(page);
  await bootLibrary(page, W, { folders: [libFolder('fa', 'top-a', { name: '가상 폴더' })], items: [{ document_id: 'a-1', folder_id: 'fa' }], group: '폴더' });
  await census(page, '자료실', '#libraryView', testInfo);
  await expectSpot(page, { name: '자료실 자료 줄', sel: '#libraryView article.lu-row', want: 'app' });
  await expectSpot(page, { name: '자료실 검색 칸(맨 위 칸)', sel: '#gsTopInput[data-screen-find="library"]', want: 'browser' });
});

test('S70-28 전수 1280: 통화 화면', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await instrument(page);
  await callFixture(page, { width: W });
  await openCalls(page, W);
  await census(page, '통화', '#callsView', testInfo);
  await expectSpot(page, { name: '통화 줄', sel: '#callsView .feed-rows', want: 'app' });
});

// A(S70-28): 빈 곳 메뉴 항목을 고르면 그 머리 줄 단추를 그대로 누른 것과 같다(같은 단추에서 만든 목록).
test('S70-28 A 1280: 저장한 글 빈 곳 우클릭 [글 추가] = 맨 위 줄 ＋', async ({ page }) => {
  await page.setViewportSize({ width: W, height: 900 });
  await instrument(page);
  await openHome(page);
  await clickView(page, 'reading');
  const add = page.locator('#appView>.app-topline [data-rd-add]'); // S71-26: ＋는 맨 위 줄 검색 칸 오른쪽
  await expect(add).toHaveAttribute('aria-expanded', 'false');
  const empty = page.locator('#readingView .wait-empty');
  await expect(empty).toBeVisible(); // 목록 읽기가 끝나 빈 안내가 그려진 뒤
  // 밑줄·메모 개수가 늦게 오면 목록(drawList)이 통째로 다시 그려져 빈 안내도 새 것으로 바뀐다 — 그 사이에 잰 자리는 비므로 새 것의 자리를 다시 잰다.
  let b = null;
  await expect(async () => { b = await empty.boundingBox(); expect(b).not.toBeNull(); }).toPass({ timeout: 5000 });
  const r = await rightClickAt(page, Math.round(b.x + 30), Math.round(b.y + b.height / 2));
  expect(r.result).toBe('app');
  await page.locator('#rowMenu').getByRole('button', { name: '글 추가', exact: true }).click();
  await expect(add).toHaveAttribute('aria-expanded', 'true');
  // 입력 칸은 브라우저 메뉴 그대로.
  const input = page.locator('#readingView input:visible').first();
  await expect(input).toBeVisible();
  const ib = await input.boundingBox();
  expect((await rightClickAt(page, Math.round(ib.x + 20), Math.round(ib.y + ib.height / 2))).result).toBe('browser');
  // Shift+F10(메뉴 키)도 같은 메뉴.
  // S70-40b ④ 뒤: PC 틀은 머리 줄 제목(.rd-title)을 그리지 않는다. S71-26: 목록 머리 줄도 없어 목록 칸 자체에 초점.
  await page.locator('#readingView [data-rd-list]').evaluate(el => { el.tabIndex = -1; el.focus(); });
  await page.evaluate(() => { window.__ctxBy = []; });
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('#rowMenu')).toBeVisible();
  expect(await page.evaluate(MENU_LABELS)).toEqual(['글 추가']);
});
