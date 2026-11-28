import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S67-64 UI-윗줄한줄(2026-11-21 명진 08:12·08:25, 시안 D3 + D2 제목 글씨) + 기본 색 먹(08:15).
// 폰(~760px) 다섯 화면(홈·사업 관리·조직 관리·일정·노트)의 윗줄 = [WORK ON 아이콘 20px] [화면 이름 15px·500] [걸러보기 칩(있을 때만)] … [+]·[⋯] 한 줄.
// 칩이 넘치면 그 줄 안에서 가로로 밀린다(줄 높이 그대로). 아이콘을 누르면 홈. PC 틀(761px~)에는 아이콘이 없다(사이드바 맨 위 아이콘).
// 기본 강조색은 먹 #22262b(위 글자 #f3f1ea, 연한 고른 바탕 #e7e5df), 어두운 화면은 뒤집은 #f3f1ea.

test.use({ timezoneId: 'Asia/Seoul' });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const user = { id: 'topbar-user', email: 'topbar@example.org', user_metadata: { display_name: '윗줄 QA' } };
const workspace = { id: 'topbar-workspace', slug: 'topbar', name: '웹2' };

async function mockApp(page) {
  await page.route(`${SB}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });
    if (path === '/auth/v1/token') return ok({ access_token: 'topbar-access', refresh_token: 'topbar-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/functions/v1/google-calendar') return ok({ connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {} });
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{ workspace_id: workspace.id, user_id: user.id, role: 'owner', email: user.email }]);
    if (path === '/rest/v1/app_workspaces') return ok([workspace]);
    if (path === '/rest/v1/app_profiles') return ok([{ user_id: user.id, display_name: '윗줄 QA' }]);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

async function open(page, query, { width = 390, dark = false, theme = null } = {}) {
  await page.setViewportSize({ width, height: 800 });
  if (dark) await page.emulateMedia({ colorScheme: 'dark' });
  await installViewPrefsServer(page, theme ? { theme } : null);
  await mockApp(page);
  await page.goto(`${appOrigin}/app/?${query}`);
  await enterLogin(page);
  await expect(page.locator('#googleLoginBtn')).toBeVisible({ timeout: 10000 });
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 15000 });
}

// 화면마다: 주소, 윗줄 이름 칸, 보이는 이름, 그 줄의 아이콘.
const SCREENS = [
  { key: 'home', query: 'view=home', panel: '#homeView', name: '#journalRoot [data-journal-title]', mark: '#journalRoot .journal-head > .head-mark' },
  // S70-57: 사업 관리도 앱 머리 줄(아이콘·이름·찾기 돋보기 — 맨 위 칸 하나로)을 쓴다. 화면 첫 줄은 고르기·[+]·[⋯].
  { key: 'meetings', query: 'view=meetings', panel: '#meetingsView', name: '#appView > .mobile-shell-header [data-mobile-view-name]', text: '조직·사업', mark: '#appView > .mobile-shell-header > .head-mark' },
  // NAV-조직사업합침(2026-11-28): 사업 관리·조직 관리·주간 보고는 [조직·사업] 한 메뉴의 큰 탭 — 머리 줄 이름은 메뉴 이름, 탭 이름은 바로 아래 큰 탭 줄.
  { key: 'team', query: 'view=team', panel: '#teamView', name: '#appView > .mobile-shell-header [data-mobile-view-name]', text: '조직·사업', mark: '#appView > .mobile-shell-header > .head-mark' },
  { key: 'weekly', query: 'view=weekly', panel: '#homeView', name: '#appView > .mobile-shell-header [data-mobile-view-name]', text: '조직·사업', mark: '#appView > .mobile-shell-header > .head-mark' },
  { key: 'calendar', query: 'view=calendar', panel: '#calendarView', name: '#appView > .mobile-shell-header [data-mobile-view-name]', text: '일정', mark: '#appView > .mobile-shell-header > .head-mark' },
  { key: 'note', query: 'view=basket&pane=note', panel: '#basketView', name: '#appView > .mobile-shell-header [data-mobile-view-name]', text: '노트', mark: '#appView > .mobile-shell-header > .head-mark' },
];
const box = locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, mid: r.top + r.height / 2 }; });
const noPageScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [390, 700]) {
  for (const s of SCREENS) {
    test(`phone ${width}: ${s.key} top line is one line — icon, name (15px/500), then the screen's own controls`, async ({ page }) => {
      await open(page, s.query, { width });
      await expect(page.locator(s.panel)).toBeVisible();
      const mark = page.locator(s.mark), name = page.locator(s.name);
      await expect(mark).toBeVisible();
      await expect(mark).toHaveAttribute('aria-label', '홈');
      await expect(mark.locator('img')).toHaveAttribute('src', /app-icon\.svg/);
      if (s.text) await expect(name).toHaveText(s.text);
      else await expect(name).toHaveText(/\d+월 \d+일 .요일/);
      const m = await box(mark), n = await box(name);
      expect(Math.round(m.width)).toBe(20);
      expect(Math.round(m.height)).toBe(20);
      expect(m.left).toBeLessThan(20);
      expect(n.left).toBeGreaterThan(m.right);
      expect(n.left - m.right).toBeLessThanOrEqual(12);
      expect(Math.abs(n.mid - m.mid)).toBeLessThanOrEqual(3);
      // D2 글씨: 15px · 500, 테두리·바탕 없는 글자.
      const font = await name.evaluate(el => { const c = getComputedStyle(el); return { size: c.fontSize, weight: c.fontWeight, border: c.borderTopWidth, bg: c.backgroundColor }; });
      expect(font).toEqual({ size: '15px', weight: '500', border: '0px', bg: 'rgba(0, 0, 0, 0)' });
      // 아이콘은 이 화면에 하나뿐(다른 줄에 두 번 나오지 않음).
      await expect(page.locator('.head-mark:visible')).toHaveCount(1);
      if (s.key === 'meetings') {
        // BIZ-머리한줄(S71-23): 고르기(칩 [전체 ▾] 또는 상자들) · n건 · [+]가 이 앱 머리 줄 안 — 이름 뒤, 찾기 앞. 둘째 줄 없음.
        const chip = page.locator('#reportFilterChip'), inChip = await chip.isVisible();
        const kind = await box(inChip ? chip : page.locator('#reportFilterBar')), add = await box(page.locator('#newMeetingBtn'));
        for (const b of [kind, add]) expect(Math.abs(b.mid - n.mid)).toBeLessThanOrEqual(4);
        expect(kind.left).toBeGreaterThanOrEqual(n.right);
        expect(add.left).toBeGreaterThanOrEqual(kind.right);
        // 건수는 보고가 있을 때만(이 계정은 보고가 없을 수 있음) — 있으면 고르기와 [+] 사이 같은 줄.
        if (await page.locator('#reportCount').isVisible()) { const count = await box(page.locator('#reportCount')); expect(Math.abs(count.mid - n.mid)).toBeLessThanOrEqual(4); expect(count.left).toBeGreaterThanOrEqual(kind.right); expect(add.left).toBeGreaterThanOrEqual(count.right); }
        await expect(page.locator('#reportMore')).toHaveCount(0);
      }
      if (s.key === 'home') {
        // 홈: 날짜 · 찾기(돋보기)가 같은 줄, 돋보기가 오른쪽 끝(S71-41 HOME-머리한줄). NAV-조직사업합침: [하루|주간 보고] 전환은 없다.
        await expect(page.locator('#journalRoot .journal-mode-switch, #journalRoot [data-journal-mode]')).toHaveCount(0);
        const find = await box(page.locator('#journalRoot [data-journal-find]'));
        expect(Math.abs(find.mid - n.mid)).toBeLessThanOrEqual(4);
        expect(n.right).toBeLessThanOrEqual(find.left + 1);
        expect(find.right).toBeGreaterThan(width - 30);
      }
      if (['team', 'meetings', 'weekly'].includes(s.key)) {
        // NAV-조직사업합침: 머리 줄 바로 아래 큰 탭 줄 [조직 관리][사업 관리][주간 보고] 한 줄, 이 화면 탭이 켜짐. 주간 보고 날짜 머리줄에는 아이콘·찾기가 없다.
        const tabs = page.locator(`${s.panel} [data-orgbiz-tabs]`);
        await expect(tabs).toBeVisible();
        await expect(tabs.locator('button')).toHaveText(['조직 관리', '사업 관리', '주간 보고']);
        await expect(tabs.locator(`[data-view="${s.key}"]`)).toHaveAttribute('aria-pressed', 'true');
        const t = await box(tabs);
        expect(t.top).toBeGreaterThanOrEqual(n.bottom - 1);
        expect(t.height).toBeLessThanOrEqual(46);
        if (s.key === 'weekly') for (const sel of ['.head-mark', '[data-journal-find]']) await expect(page.locator(`#journalRoot .journal-head ${sel}`)).toBeHidden();
      }
      if (s.key === 'team' && width < 600) {
        // 조직 관리: [⋯]는 같은 줄 오른쪽(S71-35: [+ 담당조직]은 ⋯ 안 '새 담당조직').
        const more = await box(page.locator('#soTeamMore'));
        expect(Math.abs(more.mid - n.mid)).toBeLessThanOrEqual(6);
      }
      expect(await noPageScroll(page)).toBe(true);
    });
  }
}

// S67-75 UI-걸러보기칩하나(명진 11/21 18:33 A안): 좁은 폰에서 고르기 상자 네 개가 줄에 다 안 들어가면 가로로 밀지 않고 칩 하나로 묶는다(PR 2847의 밀기·끝 흐림은 걷어냄).
// BIZ-머리한줄(S71-23): 고르기·건수·[+]는 앱 머리 줄 안(이름 뒤) — 320에서도 줄이 늘지 않고 찾기·[+]가 줄 안에 있다.
test('narrow phone: the 사업 관리 boxes stay on one line (or fold into one chip), the line does not grow', async ({ page }) => {
  await open(page, 'view=meetings', { width: 320 });
  await expect(page.locator('#newMeetingBtn')).toBeVisible();
  await page.waitForTimeout(150);
  const chip = page.locator('#reportFilterChip'), inChip = await chip.isVisible();
  await expect(page.locator('#reportFilterBar'))[inChip ? 'toBeHidden' : 'toBeVisible']();
  const title = await box(page.locator('#appView > .mobile-shell-header [data-mobile-view-name]'));
  const c = await box(inChip ? chip : page.locator('#reportFilterBar'));
  expect(Math.abs(c.mid - title.mid)).toBeLessThanOrEqual(4);
  expect(Math.round(c.height)).toBeLessThanOrEqual(34);
  if (inChip) expect(await chip.evaluate(el => { const t = el.querySelector('.report-filter-chip-text'); return t.scrollWidth <= t.clientWidth + 1; })).toBe(true);
  else expect(await page.locator('#reportFilterBar').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  // 찾기·[+]는 줄 밖으로 나가지 않는다. 순서는 … 찾기 · [+](SAVED-머리한줄, S71-43 — [+]가 맨 오른쪽).
  const add = await box(page.locator('#newMeetingBtn')), find = await box(page.locator('#appView > .mobile-shell-header .mobile-shell-find'));
  expect(c.right).toBeLessThanOrEqual(find.left + 0.5);
  expect(add.left).toBeGreaterThanOrEqual(find.right - 0.5);
  expect(add.right).toBeLessThanOrEqual(320);
  expect(Math.abs(add.mid - title.mid)).toBeLessThanOrEqual(4);
  expect(await noPageScroll(page)).toBe(true);
});

test('pressing the icon goes home', async ({ page }) => {
  await open(page, 'view=meetings');
  await page.locator('#appView > .mobile-shell-header > .head-mark').click();
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#meetingsView')).toBeHidden();
  await expect(page).toHaveURL(/view=home|\/app\/(\?|$)/);
  await page.locator('.mobile-tabs [data-view="calendar"]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.locator('#appView > .mobile-shell-header > .head-mark').click();
  await expect(page.locator('#homeView')).toBeVisible();
});

test('PC frame has no top-line icon (the sidebar top carries it)', async ({ page }) => {
  await open(page, 'view=meetings', { width: 1280 });
  await expect(page.locator('#meetingsView')).toBeVisible();
  await expect(page.locator('.head-mark:visible')).toHaveCount(0);
  await expect(page.locator('#appView > .app-nav .sidebar-brand img')).toBeVisible();
});

const cssVar = (page, name) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
test('default accent is ink: filled buttons, the picked bottom tab and the picked day use #22262b', async ({ page }) => {
  await open(page, 'view=home');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('ink');
  expect(await cssVar(page, '--kptu-primary')).toBe('#22262b');
  expect(await cssVar(page, '--kptu-on-primary')).toBe('#f3f1ea');
  expect(await cssVar(page, '--kptu-primary-soft')).toBe('#e7e5df');
  expect(await cssVar(page, '--kptu-bg')).toBe('#f3f1ea');
  await expect(page.locator('.mobile-tabs [data-view="home"]')).toHaveCSS('color', 'rgb(34, 38, 43)');
  await expect(page.locator('#journalRoot .journal-head .ds-day-sel .ds-day-num').first()).toHaveCSS('background-color', 'rgb(34, 38, 43)');
  // 화면 색 고르는 창의 '(기본)'은 먹.
  await expect(page.locator('#themeModal [data-theme-choice="ink"]')).toHaveAttribute('aria-label', '먹(기본)');
});

test('dark screen: ink turns over — accent #f3f1ea with #22262b on it', async ({ page }) => {
  await open(page, 'view=home', { dark: true });
  expect(await cssVar(page, '--kptu-primary')).toBe('#f3f1ea');
  expect(await cssVar(page, '--kptu-on-primary')).toBe('#22262b');
  await expect(page.locator('.mobile-tabs [data-view="home"]')).toHaveCSS('color', 'rgb(243, 241, 234)');
});

test('a color the person picked stays (only the default changed)', async ({ page }) => {
  await open(page, 'view=home', { theme: 'sky' });
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('sky');
  expect(await cssVar(page, '--kptu-primary')).toBe('#2c77c4');
});
