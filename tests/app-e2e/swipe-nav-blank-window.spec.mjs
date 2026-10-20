import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

// UI-밀기전환: the phone tab swipe (mobile-swipe-navigation.js) works on empty space, ignores open windows, and leaves
// text fields, text selection and sideways-scrolling rows alone. Real touch handlers; only the network is mocked.
const ORIGIN = process.env.KPTU_E2E_ORIGIN || 'http://127.0.0.1:8123';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';

async function mockApp(page) {
  const user = { id: 'swipe-user', email: 'swipe@example.org', user_metadata: { display_name: '밀기 QA' } };
  const workspace = { id: 'swipe-workspace', name: '웹2' };
  await page.route(`${SB}/**`, async route => {
    const p = new URL(route.request().url()).pathname;
    const ok = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x ?? null) });
    if (p === '/auth/v1/token') return ok({ access_token: 'swipe-access', refresh_token: 'swipe-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    if (p === '/auth/v1/user') return ok(user);
    if (p === '/auth/v1/logout') return ok({});
    if (p === '/rest/v1/app_workspace_members') return ok([{ workspace_id: workspace.id, user_id: user.id, role: 'owner' }]);
    if (p === '/rest/v1/app_workspaces') return ok([workspace]);
    if (p === '/rest/v1/app_profiles') return ok([{ user_id: user.id, display_name: '밀기 QA' }]);
    if (p === '/functions/v1/google-calendar') return ok({ connected: false, enabled: false, selected: [], calendars: [], events: [] });
    if (p === '/functions/v1/push-notifications') return ok({ enabled: false, web_enabled: false, native_enabled: false, public_key: 'qa' });
    if (p.startsWith('/rest/v1/') || p.startsWith('/functions/v1/')) return ok([]);
    return ok({});
  });
}

const current = page => page.evaluate(() => window.KPTURouter.current);

async function openApp(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await mockApp(page);
  await page.goto(loginEntry(`${ORIGIN}/app/?view=projects`));
  await signInWithSession(page,'swipe@example.org');
  await expect(page.locator('#appView')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => page.evaluate(() => !!window.__KPTU_MOBILE_SWIPE_NAV__), { timeout: 10000 }).toBe(true);
  // Startup marks kptu-ui-ready only after the requested view's module has loaded (loader-v2.js). Going to a view that
  // is still loading queues a deferred go() that fires when the module arrives; if a test moves on to another view
  // first, that late go() takes the screen back. So wait until the projects module is in before any navigation.
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 15000 });
  await expect.poll(() => page.evaluate(() => window.KPTUViewLoader.isLoaded('projects'))).toBe(true);
  await page.evaluate(() => window.KPTURouter.go('projects', { source: 'test' }));
  await expect(page.locator('#projectsView')).toBeVisible();
  expect(await current(page)).toBe('projects');
}

// Touch sequence that starts on whatever element is at (x, y), like a finger would.
async function swipeAtPoint(page, { x, y, dx = -170 }) {
  return page.evaluate(({ x, y, dx }) => {
    const el = document.elementFromPoint(x, y);
    const fire = (type, px) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      const pts = [{ clientX: px, clientY: y }];
      Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : pts });
      Object.defineProperty(ev, 'changedTouches', { value: pts });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    fire('touchstart', x);
    const prevented = fire('touchmove', x + dx * 0.55);
    fire('touchend', x + dx);
    return { prevented, tag: el.tagName, inPanel: !!el.closest('.view-panel') };
  }, { x, y, dx });
}

async function swipeOn(page, selector, dx = -170) {
  const box = await page.locator(selector).first().boundingBox();
  return swipeAtPoint(page, { x: Math.round(Math.min(388, Math.max(24, box.x + box.width / 2))), y: Math.round(box.y + box.height / 2), dx });
}

// A point below the end of the (short) projects list: not inside any panel.
async function blankPoint(page) {
  const bottom = await page.locator('#projectsView').evaluate(el => Math.ceil(el.getBoundingClientRect().bottom));
  const y = Math.min(bottom + 40, 700);
  expect(y).toBeGreaterThan(bottom);
  return { x: 260, y };
}

test.describe('phone width 412', () => {
  test.beforeEach(async ({ page }) => { await openApp(page, 412); });

  test('a swipe that starts on empty space switches the tab, in both directions', async ({ page }) => {
    const pt = await blankPoint(page);
    const res = await swipeAtPoint(page, pt);
    expect(res.inPanel).toBe(false);
    expect(res.prevented).toBe(true);
    await expect.poll(() => current(page)).toBe('team');
    await expect(page.locator('#teamView')).toBeVisible();
    const pt2 = { x: 160, y: 700 };
    await expect.poll(async () => (await swipeAtPoint(page, { ...pt2, dx: 170 }), await current(page)), { timeout: 5000 }).toBe('projects');
  });

  test('an open .modal ignores swipes, also on the empty space behind it', async ({ page }) => {
    await page.evaluate(() => document.querySelector('#eventModal').classList.remove('hidden'));
    const pt = await blankPoint(page);
    const behind = await swipeAtPoint(page, pt);
    expect(behind.prevented).toBe(false);
    const inside = await swipeOn(page, '#eventModal .modal-card');
    expect(inside.prevented).toBe(false);
    await page.waitForTimeout(400);
    expect(await current(page)).toBe('projects');
    await page.evaluate(() => document.querySelector('#eventModal').classList.add('hidden'));
    await swipeAtPoint(page, pt);
    await expect.poll(() => current(page)).toBe('team');
  });

  test('the in-screen sheet (분류 결과 입력) and an open <dialog> also stop the swipe', async ({ page }) => {
    await page.evaluate(() => window.KPTURouter.go('basket', { source: 'test' }));
    // The basket view is lazy-loaded: go() returns at once and switches when the module is in.
    await expect.poll(() => page.evaluate(() => window.KPTUViewLoader.isLoaded('basket')), { timeout: 30000 }).toBe(true);
    await expect.poll(() => current(page)).toBe('basket');
    await expect(page.locator('#basketView')).toBeVisible();
    await expect(page.locator('[data-classification-panel]')).toHaveAttribute('role', 'dialog');
    await page.evaluate(() => { document.querySelector('[data-classification-panel]').hidden = false; });
    await expect(page.locator('[data-classification-panel]')).toBeVisible();
    await page.waitForTimeout(500); // the sheet slides up (ds-sheet-up)
    const sheet = await swipeOn(page, '[data-classification-panel] label');
    expect(sheet.prevented).toBe(false);
    const behind = await swipeAtPoint(page, { x: 260, y: 120 });
    expect(behind.prevented).toBe(false);
    await page.waitForTimeout(400);
    expect(await current(page)).toBe('basket');
    await page.evaluate(() => { document.querySelector('[data-classification-panel]').hidden = true; });
    await page.evaluate(() => {
      const d = document.createElement('dialog'); d.id = 'swipeQaDialog'; d.textContent = '시트'; document.body.append(d); d.show();
    });
    expect((await swipeAtPoint(page, { x: 260, y: 120 })).prevented).toBe(false);
    await page.waitForTimeout(400);
    expect(await current(page)).toBe('basket');
    await page.evaluate(() => document.querySelector('#swipeQaDialog').remove());
    expect((await swipeAtPoint(page, { x: 260, y: 120 })).prevented).toBe(true);
  });

  test('text fields, text selection and sideways-scrolling rows keep their own drag', async ({ page }) => {
    await page.evaluate(() => {
      const panel = document.querySelector('#projectsView');
      panel.insertAdjacentHTML('afterbegin',
        '<div id="swipeQa"><textarea id="swipeQaText" rows="3" style="width:90%;display:block">쓰는 글</textarea>' +
        '<input id="swipeQaInput" style="width:90%;display:block" value="입력">' +
        '<p id="swipeQaPara" style="margin:12px">드래그로 고르는 글</p>' +
        '<div id="swipeQaRow" style="overflow-x:auto;white-space:nowrap;width:360px"><span style="display:inline-block;width:900px;height:40px">긴 줄</span></div>' +
        '<div id="swipeQaPlain" style="height:40px">그냥 칸</div></div>');
    });
    for (const sel of ['#swipeQaText', '#swipeQaInput', '#swipeQaRow']) {
      const res = await swipeOn(page, sel);
      expect(res.prevented, sel).toBe(false);
      await page.waitForTimeout(400);
      expect(await current(page), sel).toBe('projects');
    }
    await page.evaluate(() => {
      const r = document.createRange(); r.selectNodeContents(document.querySelector('#swipeQaPara'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    expect((await swipeOn(page, '#swipeQaPara')).prevented).toBe(false);
    await page.waitForTimeout(400);
    expect(await current(page)).toBe('projects');
    await page.evaluate(() => getSelection().removeAllRanges());
    // Control: the same gesture on a plain row still switches the tab.
    expect((await swipeOn(page, '#swipeQaPlain')).prevented).toBe(true);
    await expect.poll(() => current(page)).toBe('team');
  });
});

test.describe('width 870 (no phone swipe)', () => {
  test('empty-space swipes do nothing above 760px', async ({ page }) => {
    await openApp(page, 870);
    const res = await swipeAtPoint(page, { x: 600, y: 700 });
    expect(res.prevented).toBe(false);
    await page.waitForTimeout(400);
    expect(await current(page)).toBe('projects');
    await expect(page.locator('.kptu-swipe-panel')).toHaveCount(0);
  });
});
