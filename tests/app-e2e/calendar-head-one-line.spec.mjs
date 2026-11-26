// CAL-머리한줄(S71-24, 2026-11-26 사용자 요청: 구글 캘린더 줄을 맨 윗줄로 합쳐 한 줄로):
// 일정 화면 '› 구글 캘린더 …… 연결 계정' 접기 줄을 화면 이름 줄([W] 일정 …… 찾기)로 올려 [구글 캘린더 ▾] 단추 하나로.
//  - 첫 줄은 한 줄 높이 그대로, 단추는 그 줄 안(폰·폴드 앱 머리 줄, PC 맨 위 줄 — 공용 자리 screen-tools.js).
//  - 단추를 누르면 캘린더 고르기·연결 계정 칸이 일정 상자 맨 위에 펼쳐지고, 다시 누르면 접힌다(aria-expanded가 따라감).
//  - 일정 상자 안에는 구글 캘린더 줄이 없다(숨김이 아니라 없음) — 상자는 ‹ 11월 › 줄부터.
//  - 연결 계정 메일은 첫 줄에 없고 펼친 칸 안에서만 보인다.
//  - 다른 화면(할 일)으로 가면 단추는 이름 줄에서 빠진다.
import { appOrigin } from './helpers/test-origin.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const APP = `${appOrigin}/app/`;
const MAIL = 'e2e@example.org';
const CALS = [{id: 'primary', summary: '내 캘린더', primary: true, backgroundColor: '#1d4fae'}, {id: 'cal-b', summary: '둘째 캘린더', backgroundColor: '#f2452a'}];
const user = {id: 'user-1', email: MAIL, user_metadata: {display_name: 'E2E'}};

async function boot(page, size) {
  await page.setViewportSize(size);
  await installViewPrefsServer(page, {calendar_view: 'month'});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const body = (() => { try { return req.postDataJSON(); } catch { return null; } })();
    const ok = (d, s = 200) => route.fulfill({status: s, contentType: 'application/json', body: JSON.stringify(d ?? null)});
    if (path === '/auth/v1/token') return ok({access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user});
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/functions/v1/google-calendar') {
      const action = url.searchParams.get('action') || (method === 'POST' ? body?.action : 'status');
      if (action === 'status') return ok({connected: true, enabled: true, email: MAIL, selected: ['primary'], colors: {}, calendars: CALS.map(c => ({...c, accessRole: 'owner'}))});
      if (action === 'events') return ok({events: []});
      return ok({ok: true});
    }
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'ws-1', role: 'owner', user_id: user.id}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id: 'ws-1', slug: 'ws', name: '웹2'}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id: user.id, display_name: 'E2E'}]);
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
  await page.goto(`${APP}login/?return=${encodeURIComponent(APP + '?view=calendar')}`);
  await signInWithSession(page, MAIL);
  await expect(page.locator('#appView')).toBeVisible({timeout: 10000});
  await clickView(page, 'calendar');
  await expect(page.locator('#googleCalendarList [data-google-cal]')).toHaveCount(2, {timeout: 10000});
  return errors;
}
const headLine = (page, width) => page.locator(width >= 761 ? '#appView>.app-topline' : '#appView>.mobile-shell-header');

for (const [name, size] of [['폰', {width: 390, height: 844}], ['폴드', {width: 690, height: 900}], ['PC', {width: 1280, height: 900}]]) {
  test(`${name} ${size.width}: [구글 캘린더 ▾]는 화면 이름 줄 안 한 줄, 누르면 펼침·다시 누르면 접힘, 상자 안 구글 캘린더 줄 없음`, async ({page}) => {
    test.setTimeout(60000);
    const errors = await boot(page, size);
    const line = headLine(page, size.width), btn = page.locator('#googleCalendarHeadBtn'), panel = page.locator('#googleCalendarPanel');
    // 단추는 이름 줄 안(한 개), 상자 안에는 없다.
    await expect(line.locator('#googleCalendarHeadBtn')).toHaveCount(1);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(/구글 캘린더/);
    await expect(page.locator('#calendarCard #googleCalendarHeadBtn')).toHaveCount(0);
    // 이름 줄은 한 줄 높이: 단추가 줄 가운데에 있고 줄이 단추 두 개 높이를 넘지 않는다. 가로로 넘치지 않는다.
    const L = await line.boundingBox(), B = await btn.boundingBox();
    expect(Math.abs((B.y + B.height / 2) - (L.y + L.height / 2))).toBeLessThanOrEqual(3);
    expect(L.height).toBeLessThanOrEqual(size.width >= 761 ? 56 : 48);
    expect(B.x + B.width).toBeLessThanOrEqual(L.x + L.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 연결 계정 메일은 첫 줄에 없다.
    expect(await line.innerText()).not.toContain(MAIL);
    // 상자 안에 예전 '구글 캘린더' 접기 줄(summary)이 없다 — 숨김이 아니라 없음. 상자는 ‹ 11월 › 줄부터 보인다.
    await expect(page.locator('#calendarView summary, #calendarView details#googleCalendarPanel')).toHaveCount(0);
    await expect(panel).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    const card = await page.locator('#calendarCard').boundingBox(), bar = await page.locator('#calendarCard .calendar-toolbar').boundingBox();
    expect(bar.y - card.y).toBeLessThanOrEqual(24);
    // 누르면 펼침: 캘린더 고르기·연결 계정이 상자 맨 위(툴바 위)에.
    await btn.click();
    await expect(panel).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#googleCalendarList')).toBeVisible();
    await expect(page.locator('#googleAccountLabel')).toHaveText(MAIL);
    const P = await panel.boundingBox(), bar2 = await page.locator('#calendarCard .calendar-toolbar').boundingBox();
    expect(P.y + P.height).toBeLessThanOrEqual(bar2.y + 1);
    // 다시 누르면 접힘.
    await btn.click();
    await expect(panel).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    // 다른 화면(할 일)에서는 이름 줄에 단추가 없다.
    await clickView(page, 'tasks');
    await expect(line.locator('#googleCalendarHeadBtn')).toHaveCount(0);
    await expect(btn).toBeHidden();
    expect(errors).toEqual([]);
  });
}
