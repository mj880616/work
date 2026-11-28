import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { inkCenterY } from './helpers/ink-center.mjs';

// S71-70 UI-머리아이콘높이(사용자 11/26 폰 화면 "사업관리 돋보기랑 + 높이가 다르다"):
// 머리 줄 오른쪽 아이콘 단추(돋보기·[+] 등)는 칸 가운데뿐 아니라 '그려진 그림'의 세로 가운데가 같다.
// 원인: 사업 관리 [+]는 글자(font-size:0)가 grid의 둘째 줄을 만들어 그림이 칸 가운데보다 4px 위로 올라가 있었다.
// 칸 가운데는 같아서 칸만 재던 시험(biz-head-oneline)은 못 잡았다 — 여기서는 그림 자체를 잰다. 모든 이름은 합성 값.
test.use({timezoneId: 'Asia/Seoul'});
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const user = {id: 'user-1', email: 'owner@example.org', user_metadata: {display_name: '관리자'}};
const workspace = {id: 'workspace-1', slug: 'team', name: '웹2'};

async function open(page, view, width) {
  await page.setViewportSize({width, height: 860});
  await installViewPrefsServer(page, null, {});
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const ok = data => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user});
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/functions/v1/google-calendar') return ok({connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {}});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'workspace-1', user_id: user.id, role: 'owner', workspace, created_at: new Date().toISOString()}]);
    if (path === '/rest/v1/app_workspaces') return ok([workspace]);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
  await page.goto(`${appOrigin}/app/?view=${view}`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await page.waitForFunction(v => window.KPTUViewLoader?.isLoaded(v), view);
  // 사업영역 관리는 사업 관리 위에 뜨는 창이다(?view=projects) — 머리 줄은 사업 관리 것이 그대로, 창 머리의 [+]가 더해진다.
  if (view === 'projects') await expect(page.locator('#areaWindow .area-window-head #newProjectBtn')).toBeVisible();
  else await expect(page.locator('html')).toHaveAttribute('data-screen-find', view);
}

// 머리 줄·화면 첫 줄에 보이는 작은 아이콘 단추(돋보기·[+]·⋯ 등)의 칸 좌표.
const ICONS_HEAD = '.mobile-shell-header .sf-open, .mobile-shell-header .screen-tools-slot button, .mobile-shell-header .sf-tools button, #reportTop .report-head-actions button';
// 사업영역 관리 창이 떠 있으면 뒤 화면은 어둡게 덮이므로 창 머리의 [+]만 잰다.
const WINDOW_ICONS = '#areaWindow .area-window-head #newProjectBtn';
async function iconBoxes(page, ICONS = ICONS_HEAD) {
  return page.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(e => {
    const r = e.getBoundingClientRect();
    return {name: e.id || e.getAttribute('aria-label') || e.className, x: r.x, y: r.y, width: r.width, height: r.height};
  }).filter(b => b.width > 0 && b.width <= 40 && b.height <= 40), ICONS);
}

// 폰(412)·폴드 접힘(344)에서 머리 줄의 돋보기와 [+]: 그림 가운데 높이가 같다. PC(1280)에서 [+]: 그림이 자기 칸 가운데. 사업영역 관리 창 머리 [+]는 폰 폭만(PC는 글자 단추).
for (const [view, width] of [['meetings', 412], ['meetings', 344], ['meetings', 1280], ['projects', 412]]) {
  test(`${view} ${width}: 머리 줄 아이콘 단추 그림의 세로 가운데가 같다`, async ({page}) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await open(page, view, width);
    await expect.poll(async () => (await iconBoxes(page, view === 'projects' ? WINDOW_ICONS : ICONS_HEAD)).length).toBeGreaterThanOrEqual(view === 'projects' || width > 760 ? 1 : 2);
    const boxes = await iconBoxes(page, view === 'projects' ? WINDOW_ICONS : ICONS_HEAD);
    const centers = [];
    for (const b of boxes) {
      const ink = await inkCenterY(page, b);
      expect(ink, `${b.name}: 그림이 보여야 한다`).not.toBeNull();
      // 그림 가운데 = 자기 칸 가운데(1px 안쪽).
      expect(Math.abs(ink - (b.y + b.height / 2)), `${b.name}: 그림이 칸 가운데에서 벗어남`).toBeLessThanOrEqual(1);
      centers.push(ink);
    }
    // 같은 줄의 아이콘끼리 그림 가운데 높이가 같다(1px 안쪽).
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
