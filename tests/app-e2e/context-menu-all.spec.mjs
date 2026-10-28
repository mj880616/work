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
const eventMenu = page => page.locator('#calendarEventMenu');
const labels = menu => menu.locator('button').allTextContents().then(a => a.map(s => s.trim()));

test('1280 calendar: right-click on an event opens the small menu at the pointer; [수정] opens the edit window', async ({ page }) => {
  const { chip } = await openCalendar(page);
  const b = await chip.boundingBox(), x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
  await page.mouse.move(x, y); await page.mouse.click(x, y, { button: 'right' });
  const menu = eventMenu(page);
  await expect(menu).toBeVisible();
  expect(await labels(menu)).toEqual(['수정', '담당조직 연결', '결과 남기기', '일정 삭제']);
  const m = await menu.boundingBox();
  expect(Math.abs(m.x - x)).toBeLessThanOrEqual(12);
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  await page.mouse.click(x, y, { button: 'right' }); await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: '수정' }).click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await expect(page.locator('#ciGoogleSave')).toBeEnabled();
});

test('1280 calendar: [일정 삭제] asks first; cancel keeps the event, OK sends the same delete the window sends', async ({ page }) => {
  const { state, chip } = await openCalendar(page);
  const menu = eventMenu(page);
  await chip.click({ button: 'right' }); await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: '일정 삭제' }).click();
  expect(await answerAsk(page, false)).toContain('Google 일정을 삭제할까요?');
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  expect(state.writes).toEqual([]);
  await chip.click({ button: 'right' }); await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: '일정 삭제' }).click();
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
