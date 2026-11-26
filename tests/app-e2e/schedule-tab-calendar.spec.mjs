// UI-일정탭달력기본(11/20 사용자 "일정 탭 클릭하면 달력을 기본으로"): 하단 [일정]·[메뉴] 창 [일정]·PC 왼쪽 [일정](머리 줄)은 늘 달력을 연다.
// 하위 화면(할 일·하루 기록)은 위 [달력|할 일|하루 기록] 줄(폰)이나 왼쪽 하위 줄(PC)을 직접 눌러야 열린다.
// 하루 기록이 잠겨 있어도 [일정]은 잠금 화면 없이 달력, [하루 기록]을 직접 누를 때만 숫자 판. 잠금 서버(app_lock_*)는 흉내(값은 모두 합성).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
async function lockServer(page, { pin = null, features = [] } = {}) {
  await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    if (name === 'app_lock_read') return json({ has_pin: !!pin, features, relock: '5m', left: 5, blocked_until: null });
    if (name === 'app_lock_note_folders') return json({ folders: [], covered: [], top_names: [] });
    if (name === 'app_lock_check') return json(route.request().postDataJSON()?.p_pin === pin ? { ok: true, left: 5, blocked_until: null } : { ok: false, left: 4, blocked_until: null });
    return route.fulfill({ status: 404, body: '' });
  });
}
const current = page => page.evaluate(() => window.KPTURouter.current);
const shown = async (page, view) => { await expect(page.locator(`#${view}View`)).toBeVisible(); expect(await current(page)).toBe(view); };
const pad = page => page.locator('#lockView .lk-pad');

test.describe('폰 412', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 412, height: 860 }); });
  const tab = page => page.locator('.mobile-tabs [data-mobile-schedule-tab]');
  const home = async page => { await page.locator('.mobile-tabs [data-view="home"]').click(); await shown(page, 'home'); };
  const sub = (page, from, view) => page.locator(`#${from}View .schedule-switch [data-view="${view}"]`).click();

  test('하루 기록·할 일을 보다 나가도 [일정]은 달력, 위 줄 [하루 기록]은 하루 기록', async ({ page }) => {
    await openHome(page, { beforeLoad: () => lockServer(page) });
    await tab(page).click(); await shown(page, 'calendar');
    await sub(page, 'calendar', 'diary'); await shown(page, 'diary');
    await expect(tab(page)).toHaveAttribute('aria-current', 'page');
    await home(page);
    await tab(page).click(); await shown(page, 'calendar'); await expect(page).toHaveURL(/view=calendar/);
    await sub(page, 'calendar', 'tasks'); await shown(page, 'tasks');
    await home(page);
    await tab(page).click(); await shown(page, 'calendar');
    await expect(tab(page)).toHaveAttribute('data-view', 'calendar');
    // [메뉴] 창에 [일정]이 있으면(메뉴 편집으로 옮긴 경우) 그것도 달력 — 지금 칸 구성 그대로 data-view만 본다.
    await expect(page.locator('#mobileMenu [data-view="tasks"], #mobileMenu [data-view="diary"]')).toHaveCount(0);
  });

  test('하루 기록 잠금: [일정] → 달력(잠금 화면 없음) → [하루 기록] → 숫자 판', async ({ page }) => {
    await openHome(page, { beforeLoad: () => lockServer(page, { pin: '1234', features: ['diary'] }) });
    await tab(page).click(); await shown(page, 'calendar');
    await expect(page.locator('#lockView')).toBeHidden();
    await sub(page, 'calendar', 'diary');
    await expect(pad(page).locator('.lk-title')).toHaveText('하루 기록 잠김');
    expect(await current(page)).toBe('lock');
    // S67-76: 숫자 판은 하단바까지 덮는다(하단바는 눌리지 않음) — 왼쪽 위 [✕]로 이전 화면(달력).
    await page.locator('#lockView [data-lk-close]').click(); await shown(page, 'calendar');
    await expect(page.locator('#lockView')).toBeHidden();
    await home(page);
    await tab(page).click(); await shown(page, 'calendar');
    // 풀고 하루 기록을 본 뒤 나갔다 와도 [일정]은 달력.
    await sub(page, 'calendar', 'diary');
    for (const d of '1234') await page.locator(`#lockView [data-lk-key="${d}"]`).click();
    await shown(page, 'diary');
    await home(page);
    await tab(page).click(); await shown(page, 'calendar');
  });
});

test.describe('PC 1280', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 860 }); });
  const head = page => page.locator('.app-nav .nav-btn[data-view="calendar"]');
  const subBtn = (page, view) => page.locator(`.app-nav .nav-sub[aria-label="일정"] [data-view="${view}"]`);
  const home = async page => { await page.locator('.app-nav .sidebar-brand').first().click(); await shown(page, 'home'); };

  test('왼쪽 [일정]은 늘 달력, 하위 [하루 기록]·[할 일]은 그 화면', async ({ page }) => {
    await openHome(page, { beforeLoad: () => lockServer(page) });
    await subBtn(page, 'diary').click(); await shown(page, 'diary');
    await home(page);
    await head(page).click(); await shown(page, 'calendar');
    await subBtn(page, 'tasks').click(); await shown(page, 'tasks');
    await home(page);
    await head(page).click(); await shown(page, 'calendar');
  });

  test('하루 기록 잠금: [일정] → 달력 → [하루 기록] → 숫자 판', async ({ page }) => {
    await openHome(page, { beforeLoad: () => lockServer(page, { pin: '1234', features: ['diary'] }) });
    await head(page).click(); await shown(page, 'calendar');
    await expect(page.locator('#lockView')).toBeHidden();
    await subBtn(page, 'diary').click();
    await expect(pad(page).locator('.lk-title')).toHaveText('하루 기록 잠김');
    // S67-76: 숫자 판은 왼쪽 메뉴까지 덮는다 — 왼쪽 위 [✕]로 이전 화면(달력).
    await page.locator('#lockView [data-lk-close]').click(); await shown(page, 'calendar');
    await home(page);
    await head(page).click(); await shown(page, 'calendar');
    await expect(page.locator('#lockView')).toBeHidden();
  });
});
