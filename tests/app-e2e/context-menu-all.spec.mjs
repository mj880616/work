import { test, expect } from '@playwright/test';
import { answerAsk } from './helpers/small-notice.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { appOrigin } from './helpers/test-origin.mjs';

// UI-우클릭전수: 공용 우클릭 처리(app/context-menu.js)의 규칙을 화면과 상관없이 확인하고(표시 속성 data-ctx, 스타일로 ⋯ 아래에 붙은 메뉴 창),
// 달력 일정 우클릭 메뉴(app/calendar-context-menu.js)를 확인한다.
const BASE = appOrigin, SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({ timezoneId: 'Asia/Seoul' });

const probe = html => `<section id="ctxProbe" style="position:fixed;left:20px;top:20px;width:620px;z-index:99999;background:#fff;padding:10px">${html}</section>`;
async function mount(page, html) {
  await page.evaluate(h => {
    document.querySelector('#ctxProbe')?.remove(); document.body.insertAdjacentHTML('beforeend', h);
    window.__hit = []; window.__kept = [];
    for (const b of document.querySelectorAll('#ctxProbe button')) b.addEventListener('click', () => { window.__hit.push(b.id); const m = document.getElementById(b.getAttribute('aria-controls') || ''); if (m) m.hidden = !m.hidden; });
    if (!window.__keptOn) { window.__keptOn = true; window.addEventListener('contextmenu', e => window.__kept.push(!e.defaultPrevented)); }
  }, probe(html));
}
const rightClick = async (page, sel) => { const b = await page.locator(sel).boundingBox(), x = Math.round(b.x + 12), y = Math.round(b.y + b.height / 2); await page.mouse.move(x, y); await page.mouse.click(x, y, { button: 'right' }); return { x, y }; };
const hits = page => page.evaluate(() => window.__hit);

test('1280 shared rule: area ⋯ answers its whole area, a card with its own ⋯ answers itself, a toolbar ⋯ (off) answers nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHome(page);
  await mount(page, `<div><button id="pa" data-ctx="area" type="button">⋯</button></div><p id="pbody" style="height:40px;margin:0">본문</p>
    <div id="pcard" style="padding:20px"><button id="pc" type="button">⋯</button><span id="pcardtext" style="display:block;height:30px">카드 글</span></div>
    <div id="ptool"><button id="poff" data-ctx="off" type="button">⋯</button><p id="ptooltext" style="margin:0;height:30px">도구 줄</p></div>`);
  await rightClick(page, '#pbody'); expect(await hits(page)).toEqual(['pa']);
  await rightClick(page, '#pcardtext'); expect(await hits(page)).toEqual(['pa', 'pc']);
  await rightClick(page, '#pcard'); expect(await hits(page)).toEqual(['pa', 'pc', 'pc']);
  await rightClick(page, '#ptooltext'); expect(await hits(page)).toEqual(['pa', 'pc', 'pc', 'pa']);
  await mount(page, `<div id="only"><button id="poff" data-ctx="off" type="button">⋯</button><p id="ptooltext" style="margin:0;height:30px">도구 줄</p></div>`);
  await rightClick(page, '#ptooltext'); expect(await hits(page)).toEqual([]);
  expect(await page.evaluate(() => window.__kept)).toEqual([true]);
  // Two cards without an area ⋯: the gap between them keeps the browser menu.
  await mount(page, `<div><div style="padding:8px"><button id="p1" type="button">⋯</button>첫째</div><p id="gap" style="height:30px;margin:0">사이</p><div style="padding:8px"><button id="p2" type="button">⋯</button>둘째</div></div>`);
  await rightClick(page, '#gap'); expect(await hits(page)).toEqual([]);
});

// UI-우클릭빈곳전수: 화면 머리줄 ⋯(data-ctx="screen")는 카드 메뉴가 아니고, 그 화면(.view-panel)의 빈 자리 우클릭이 연다.
// 카드 ⋯·상세(area) ⋯가 있는 자리는 그쪽이 먼저, 화면 밖(작은 창)·입력칸·글자 고름은 브라우저 메뉴 그대로.
test('1280 shared rule: a screen head ⋯ (screen) answers the blank spots of its screen only', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHome(page);
  await mount(page, `<div class="view-panel"><div><button id="ps" data-ctx="screen" type="button">⋯</button></div><p id="blank" style="height:40px;margin:0">빈 자리</p>
    <div style="padding:10px"><button id="c1" type="button">⋯</button><span id="c1t">카드 하나</span></div><p id="between" style="height:30px;margin:0">사이</p><div style="padding:10px"><button id="c2" type="button">⋯</button>카드 둘</div>
    <input id="pin" style="width:200px"><div role="dialog"><p id="inmodal" style="height:30px;margin:0">작은 창</p></div></div>`);
  await rightClick(page, '#blank'); expect(await hits(page)).toEqual(['ps']);
  await rightClick(page, '#c1t'); expect(await hits(page)).toEqual(['ps', 'c1']);
  await rightClick(page, '#between'); expect(await hits(page)).toEqual(['ps', 'c1', 'ps']);
  await page.evaluate(() => { window.__kept = []; });
  await rightClick(page, '#pin'); await rightClick(page, '#inmodal');
  expect(await hits(page)).toEqual(['ps', 'c1', 'ps']);
  expect(await page.evaluate(() => window.__kept)).toEqual([true, true]);
  // The screen ⋯ is never a card's own menu: a block that holds only it keeps the old rule (area ⋯ elsewhere wins).
  await mount(page, `<div class="view-panel"><div><button id="pa" data-ctx="area" type="button">⋯</button><button id="ps" data-ctx="screen" type="button">⋯</button></div><p id="body" style="height:40px;margin:0">상세</p></div>`);
  await rightClick(page, '#body'); expect(await hits(page)).toEqual(['pa']);
});

// UI-PC손맛묶음 ①: 화면 안에 붙은 작은 창(사업 보고 오른쪽 칸 = 보고 창 #meetingRoundDetailModal)의 상세 ⋯는 그 창 안에서만 연다.
// 창 밖(주 줄 [‹][›]·주간보고 표)은 그 창 ⋯를 누르지 않고, 화면 머리줄 ⋯(screen)가 있으면 그것을 연다.
test('1280 shared rule: an area ⋯ inside a docked dialog answers presses inside that dialog only', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHome(page);
  await mount(page, `<div class="view-panel"><div><button id="ps" data-ctx="screen" type="button">⋯</button></div><p id="week" style="height:30px;margin:0">주 줄 › </p>
    <div class="modal" role="dialog" style="position:static;inset:auto;display:block;background:none"><div><button id="pa" data-ctx="area" type="button">⋯</button></div><p id="result" style="height:40px;margin:0">회의 결과</p></div></div>`);
  await rightClick(page, '#result'); expect(await hits(page)).toEqual(['pa']);
  await rightClick(page, '#week'); expect(await hits(page)).toEqual(['pa', 'ps']);
  await mount(page, `<div class="view-panel"><p id="week" style="height:30px;margin:0">주 줄 › </p>
    <div class="modal" role="dialog" style="position:static;inset:auto;display:block;background:none"><div><button id="pa" data-ctx="area" type="button">⋯</button></div><p id="result" style="height:40px;margin:0">회의 결과</p></div></div>`);
  await page.evaluate(() => { window.__kept = []; });
  await rightClick(page, '#week'); expect(await hits(page)).toEqual([]);
  expect(await page.evaluate(() => window.__kept)).toEqual([true]);
});

// UI-PC손맛묶음 ③: 줄 글자를 마우스로 긁어 고르면(복사하려고) 그 줄이 열리지 않는다. 그냥 누르기는 그대로 열린다.
test('1280 shared rule: a mouse drag that selects a line\'s text does not open the line; a plain click does', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHome(page);
  await page.evaluate(() => {
    document.querySelector('#ctxProbe')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<section id="ctxProbe" style="position:fixed;left:20px;top:20px;width:620px;z-index:99999;background:#fff;padding:10px"><article id="row" role="button" tabindex="0" style="padding:8px;user-select:text"><span id="rowtext">가나다라마바사아자차카타파하 담당조직 한 줄 글자</span></article></section>`);
    window.__open = 0; document.querySelector('#row').addEventListener('click', () => { window.__open++; });
  });
  const b = await page.locator('#rowtext').boundingBox(), y = b.y + b.height / 2;
  await page.mouse.move(b.x + 2, y); await page.mouse.down(); await page.mouse.move(b.x + 80, y, { steps: 4 }); await page.mouse.move(b.x + 160, y, { steps: 4 }); await page.mouse.up();
  expect(await page.evaluate(() => getSelection().toString().length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__open)).toBe(0);
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.locator('#rowtext').click();
  expect(await page.evaluate(() => window.__open)).toBe(1);
});

// UI-PC손맛묶음 ④: 그림·기호만 있는 단추는 PC에서 마우스를 올리면 이름(aria-label)이 말풍선(title)으로 뜬다. 글자 단추·자기 말풍선은 그대로.
test('1280 shared rule: icon-only buttons get their name as a hover tip', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHome(page);
  await mount(page, `<button id="i1" type="button" aria-label="다음 주">›</button> <button id="i2" type="button" aria-label="메뉴"><svg width="12" height="12"></svg></button> <button id="w1" type="button" aria-label="저장하기">저장</button> <button id="t1" type="button" aria-label="닫기" title="창 닫기">×</button>`);
  for (const id of ['i1', 'i2', 'w1', 't1']) await page.hover('#' + id);
  expect(await page.evaluate(() => ['i1', 'i2', 'w1', 't1'].map(id => document.getElementById(id).getAttribute('title')))).toEqual(['다음 주', '메뉴', null, '창 닫기']);
});

test('1280 shared rule: a menu panel a stylesheet pins under the ⋯ opens at the pointer and goes back when closed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHome(page);
  await mount(page, `<div id="pwrap" style="position:relative;padding:20px;height:80px"><span id="ptext" style="display:block;height:40px">카드 글</span><button id="pm" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="pmenu" style="position:absolute;right:4px;top:4px">⋯</button><style>#pmenu{position:absolute;top:100%;right:0;width:150px;background:#fff;border:1px solid #888}#pmenu[hidden]{display:none}</style><div id="pmenu" role="group" hidden><button id="pitem" type="button">항목</button></div></div>`);
  const at = await rightClick(page, '#ptext');
  const menu = page.locator('#pmenu');
  await expect(menu).toBeVisible();
  const b = await menu.boundingBox();
  expect(Math.abs(b.x - at.x)).toBeLessThanOrEqual(12);
  expect(Math.min(Math.abs(b.y - at.y), Math.abs(b.y + b.height - at.y))).toBeLessThanOrEqual(12);
  await page.evaluate(() => { document.getElementById('pmenu').hidden = true; });
  await expect.poll(() => menu.evaluate(el => el.style.position + '|' + getComputedStyle(el).position)).toBe('|absolute');
});

// ---- calendar event menu ----
const calendars = [{ id: 'source', summary: '기존 캘린더', accessRole: 'owner', backgroundColor: '#336699' }, { id: 'read-only', summary: '읽기 전용', accessRole: 'reader' }];
async function openCalendar(page, { calendarId = 'source', view = 'week' } = {}) {
  const state = { writes: [], event: { id: 'ctx-event', title: '합성 우클릭 일정', calendarId, start: '2026-10-20T01:00:00.000Z', end: '2026-10-20T02:00:00.000Z', allDay: false, color: null, colorId: null, organizationIds: [], recurring: false, source: 'google' } };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.setFixedTime(new Date('2026-10-20T03:00:00Z'));
  await installViewPrefsServer(page, { calendar_view: view });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === BASE) return route.continue();
    if (url.origin !== SB) return route.abort();
    const ok = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const user = { id: 'ctx-user', email: 'qa@example.org', user_metadata: { display_name: 'QA' } };
    if (url.pathname === '/auth/v1/token') return ok({ access_token: 'synthetic', refresh_token: 'synthetic', expires_at: 4102444800, user });
    if (url.pathname === '/auth/v1/user') return ok(user);
    if (url.pathname === '/rest/v1/app_workspace_members') return ok([{ workspace_id: 'ctx-ws', user_id: user.id, role: 'owner' }]);
    if (url.pathname === '/rest/v1/app_workspaces') return ok([{ id: 'ctx-ws', name: 'QA' }]);
    if (url.pathname === '/rest/v1/app_profiles') return ok([{ user_id: user.id, display_name: 'QA' }]);
    if (url.pathname === '/functions/v1/google-calendar') {
      const action = url.searchParams.get('action');
      if (req.method() === 'POST') { const body = req.postDataJSON(); state.writes.push(body); return ok({ ok: true }); }
      if (action === 'event') return ok({ event: state.event, eventColors: {} });
      const status = { connected: true, enabled: true, selected: ['source', 'read-only'], calendars, colors: {}, eventColors: {} };
      return ok(action === 'events' ? { ...status, events: [state.event] } : status);
    }
    if (url.pathname === '/functions/v1/google-tasks') return ok({ connected: true, authorized: true, tasks: [], links: [], meeting_links: [] });
    return ok([]);
  });
  await page.goto(loginEntry(BASE + '/app/?view=calendar'));
  await signInWithSession(page, 'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  const chip = page.locator('#calendarWeek [data-google-event="ctx-event"]').first();
  await expect(chip).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__KPTU_CALENDAR_CONTEXT_MENU__ && !!window.KPTUCalendarEvents?.act)).toBe(true);
  return { state, chip };
}
const eventMenu = page => page.locator('#rowMenu');
const labels = menu => menu.locator('button').allTextContents().then(a => a.map(s => s.trim()));

test('1280 calendar: right-click on an event opens the small menu at the pointer; [수정] opens the edit window', async ({ page }) => {
  const { chip } = await openCalendar(page);
  const b = await chip.boundingBox(), x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
  await page.mouse.move(x, y); await page.mouse.click(x, y, { button: 'right' });
  const menu = eventMenu(page);
  await expect(menu).toBeVisible();
  expect(await labels(menu)).toEqual(['수정', '담당조직 연결', '결과 남기기', '삭제']);
  const m = await menu.boundingBox();
  expect(Math.abs(m.x - x)).toBeLessThanOrEqual(12);
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  await page.mouse.click(x, y, { button: 'right' }); await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: '수정' }).click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await expect(page.locator('#ciGoogleSave')).toBeEnabled();
});

test('1280 calendar: [삭제] (맨 아래) asks first; cancel keeps the event, OK sends the same delete the window sends', async ({ page }) => {
  const { state, chip } = await openCalendar(page);
  const menu = eventMenu(page);
  await chip.click({ button: 'right' }); await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: '삭제', exact: true }).click();
  expect(await answerAsk(page, false)).toContain('Google 일정을 삭제할까요?');
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  expect(state.writes).toEqual([]);
  await chip.click({ button: 'right' }); await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: '삭제', exact: true }).click();
  await answerAsk(page, true);
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({ action: 'delete-event', calendar_id: 'source', event_id: 'ctx-event' });
});

test('1280 calendar: a read-only calendar offers [열기] only', async ({ page }) => {
  const { chip } = await openCalendar(page, { calendarId: 'read-only' });
  await chip.click({ button: 'right' });
  expect(await labels(eventMenu(page))).toEqual(['열기']);
});

test('390 calendar: right-click changes nothing (no event menu)', async ({ page }) => {
  const { chip } = await openCalendar(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.__kept = []; window.addEventListener('contextmenu', e => window.__kept.push(!e.defaultPrevented)); });
  const target = page.locator('[data-google-event="ctx-event"]:visible').first();
  await target.dispatchEvent('contextmenu', { bubbles: true, cancelable: true });
  await expect(eventMenu(page)).toBeHidden();
  expect(await page.evaluate(() => window.__kept)).toEqual([true]);
  void chip;
});
