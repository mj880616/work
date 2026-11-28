import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

// NAV-조직사업합침(2026-11-28 사용자 결정 10:22~10:55, CC 시안을 보고):
// - 왼쪽 메뉴·하단바의 [사업 관리]·[조직 관리]는 메뉴 하나 [조직·사업]. 안은 큰 탭 [조직 관리][사업 관리][주간 보고](공용 ⑤ 보기 바꾸기).
// - 큰 탭은 누르기·좌우 밀기로 옮기고, 뒤로가기는 이전 탭. 메뉴로 들어가면 늘 맨 앞 [조직 관리](마지막 탭 기억 없음).
// - [주간 보고]는 홈 [하루 | 주간 보고]의 주간 쪽을 그대로 옮긴 것(홈은 하루만). 탭 안 화면 내용은 그대로.
// - 옛 주소·저장된 메뉴 구성(옛 두 칸)·고친 이름은 그대로 이어진다. 가짜 서버·합성 자료만 쓴다(openHome).

const SHEET = '#mobileMenu .mobile-menu-panel nav[aria-label="더 보기"]';
const tabs = (page, panel) => page.locator(`${panel} [data-orgbiz-tabs]`);
const NAMES = ['조직 관리', '사업 관리', '주간 보고'];
const PANEL = { team: '#teamView', meetings: '#meetingsView', weekly: '#homeView' };
const view = page => page.evaluate(() => window.KPTURouter?.current);

async function expectTab(page, id) {
  const strip = tabs(page, PANEL[id]);
  await expect(page.locator(PANEL[id])).toBeVisible();
  await expect(strip).toBeVisible();
  await expect(strip.locator('button')).toHaveText(NAMES);
  for (const [i, other] of ['team', 'meetings', 'weekly'].entries()) await expect(strip.locator('button').nth(i)).toHaveAttribute('aria-pressed', String(other === id));
  expect(await view(page)).toBe(id);
  if (id === 'weekly') {
    await expect(page.locator('#journalRoot')).toHaveAttribute('data-journal-mode', 'week');
    await expect(page.locator('#journalRoot [data-journal-weekly-root]')).toBeVisible();
    await expect(page.locator('#journalRoot [data-journal-day]')).toBeHidden();
  }
}
async function openOrgBizMenu(page, width) {
  if (width > 760) { await page.locator('#appView > .app-nav .nav-btn[data-view="team"]').click(); return; }
  await page.locator('#mobileMenuTab').click();
  await page.locator(`${SHEET} button[data-view="team"]`).click();
}
// 한 손가락 좌우 밀기(손 떼기까지). 줄 밖 빈 곳(탭 줄 아래 여백)에서 시작한다.
async function swipe(page, panel, dx) {
  await page.evaluate(({ panel, dx }) => {
    const box = document.querySelector(`${panel} [data-orgbiz-tabs]`).getBoundingClientRect();
    const x = Math.round(innerWidth / 2), y = Math.round(box.bottom + 2), target = document.elementFromPoint(x, y) || document.querySelector(panel);
    const touch = (cx) => new Touch({ identifier: 7, target, clientX: cx, clientY: y });
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch(x)], changedTouches: [touch(x)] }));
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [touch(x + dx)] }));
  }, { panel, dx });
}

for (const width of [412, 690, 1280]) test(`${width}: 메뉴 [조직·사업] 하나 → 큰 탭 셋(누르기·뒤로가기), 홈에는 주간 보고 전환이 없다`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: width > 760 ? 900 : 860 });
  await openHome(page, { menuLayout: null });
  // 홈 = 하루뿐: 머리 줄 [하루|주간 보고] 전환 없음, 큰 탭 줄 없음.
  await expect(page.locator('#journalRoot .journal-head :is(.journal-mode-switch,[data-journal-mode])')).toHaveCount(0);
  await expect(tabs(page, '#homeView')).toBeHidden();
  await expect(page.locator('#journalRoot')).toHaveAttribute('data-journal-mode', 'day');
  // 메뉴에는 [조직·사업] 한 칸(옛 두 칸 없음).
  const nav = width > 760 ? page.locator('#appView > .app-nav .nav-btn') : page.locator(`${SHEET} button`);
  if (width <= 760) await page.locator('#mobileMenuTab').click();
  const names = (await nav.allTextContents()).map(t => t.trim());
  expect(names.filter(t => t === '조직·사업')).toHaveLength(1);
  expect(names.some(t => /^(사업 관리|조직 관리)$/.test(t))).toBe(false);
  if (width <= 760) { await page.keyboard.press('Escape'); await expect(page.locator('#mobileMenu')).toBeHidden(); }
  // 메뉴로 들어가면 맨 앞 [조직 관리].
  await openOrgBizMenu(page, width);
  await expectTab(page, 'team');
  await expect(page).toHaveURL(/[?&]view=team(?:&|$)/);
  if (width > 760) await expect(page.locator('#appView > .app-nav .nav-btn[data-view="team"]')).toHaveClass(/active/);
  // 작은 탭은 그대로([목록 | 전체 표] — 담당조직이 있을 때).
  const small = page.locator('#soTeamTabs');
  if (await small.count()) await expect(small.locator('button')).toHaveText(['목록', '전체 표']);
  // 누르기: 사업 관리 → 주간 보고.
  await tabs(page, '#teamView').locator('[data-view="meetings"]').click();
  await expectTab(page, 'meetings');
  await expect(page).toHaveURL(/[?&]view=reports(?:&|$)/);
  await tabs(page, '#meetingsView').locator('[data-view="weekly"]').click();
  await expectTab(page, 'weekly');
  await expect(page).toHaveURL(/[?&]view=weekly(?:&|$)/);
  await expect(page).not.toHaveURL(/[?&]mode=/);
  // 주간 보고에서도 메뉴는 [조직·사업]이 켜진다(홈이 아님).
  if (width > 760) {
    await expect(page.locator('#appView > .app-nav .nav-btn[data-view="team"]')).toHaveClass(/active/);
    await expect(page.locator('#appView > .app-nav .sidebar-brand')).not.toHaveClass(/active/);
    await expect(page.locator('[data-topline-where]')).toHaveText(/조직·사업\s*주간 보고/);
  } else {
    await expect(page.locator('#appView > .mobile-shell-header [data-mobile-view-name]')).toHaveText('조직·사업');
    // 날짜 머리 줄의 아이콘·찾기는 홈에만(앱 머리 줄과 겹치지 않게).
    await expect(page.locator('#appView .head-mark:visible')).toHaveCount(1);
  }
  // 뒤로가기 = 이전 탭.
  await page.goBack();
  await expectTab(page, 'meetings');
  await page.goBack();
  await expectTab(page, 'team');
  // 홈으로 가면 다시 하루(탭 줄 없음).
  await page.evaluate(() => window.KPTURouter.go('home', { source: 'delegated' }));
  await expect(page.locator('#journalRoot')).toHaveAttribute('data-journal-mode', 'day');
  await expect(page.locator('#journalRoot [data-journal-day]')).toBeVisible();
  await expect(tabs(page, '#homeView')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('폰 412: 큰 탭은 좌우로 밀어 옮기고(왼쪽 = 다음), 끝에서는 돌지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 860 });
  await openHome(page, { menuLayout: null, query: '?view=team' });
  await expectTab(page, 'team');
  await swipe(page, '#teamView', 140);
  await page.waitForTimeout(300);
  await expectTab(page, 'team'); // 맨 앞에서 오른쪽 밀기 = 그대로
  await swipe(page, '#teamView', -140);
  await expectTab(page, 'meetings');
  await swipe(page, '#meetingsView', -140);
  await expectTab(page, 'weekly');
  await swipe(page, '#homeView', -140);
  await page.waitForTimeout(300);
  await expectTab(page, 'weekly'); // 맨 끝에서 왼쪽 밀기 = 그대로
  await swipe(page, '#homeView', 140);
  await expectTab(page, 'meetings');
  // 짧은 밀기·세로 굴리기는 넘기지 않는다.
  await swipe(page, '#meetingsView', -30);
  await page.waitForTimeout(300);
  await expectTab(page, 'meetings');
  // 뒤로가기 = 직전 탭(밀기도 누르기와 같은 기록 칸).
  await page.goBack();
  await expectTab(page, 'weekly');
});

for (const [query, id, url] of [
  ['?view=team', 'team', /[?&]view=team(?:&|$)/],
  ['?view=meetings', 'meetings', /[?&]view=reports(?:&|$)/],
  ['?view=reports', 'meetings', /[?&]view=reports(?:&|$)/],
  ['?view=weekly', 'weekly', /[?&]view=weekly(?:&|$)/],
  ['?mode=week', 'weekly', /[?&]view=weekly(?:&|$)/],
  ['?view=home&mode=week', 'weekly', /[?&]view=weekly(?:&|$)/],
  ['?view=journal&mode=week', 'weekly', /[?&]view=weekly(?:&|$)/],
]) test(`옛 주소 ${query} → [조직·사업] › ${NAMES[['team', 'meetings', 'weekly'].indexOf(id)]}`, async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 860 });
  await openHome(page, { menuLayout: null, query });
  await expectTab(page, id);
  await expect(page).toHaveURL(url);
  await expect(page).not.toHaveURL(/[?&]mode=/);
  // 새로고침해도 같은 탭.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await expectTab(page, id);
});

test('옛 주소 ?view=projects(사업영역 관리) → [사업 관리] 탭 위 사업영역 관리 창', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page, { menuLayout: null, query: '?view=projects' });
  await expect(page.locator('#areaWindow')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#areaWindow')).toBeHidden();
  await expectTab(page, 'meetings');
});

test('저장된 메뉴 구성의 옛 두 칸(사업 관리·조직 관리)은 [조직·사업] 한 칸으로 합쳐 먼저 나온 자리를 지킨다', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 860 });
  await openHome(page, { menuLayout: { bar: ['home', 'meetings', 'calendar', 'team'], rest: ['note', 'basket', 'library', 'files', 'photos', 'bottom', 'calls', 'telegram', 'arsenal'] } });
  const bar = page.locator('#appView .mobile-tabs button');
  await expect(bar).toHaveText(['홈', '조직·사업', '일정', '메뉴']);
  await bar.nth(1).click();
  await expectTab(page, 'team');
  await expect(bar.nth(1)).toHaveAttribute('aria-current', 'page');
  // 사업 관리·주간 보고 탭에서도 같은 하단바 칸이 켜진다.
  await tabs(page, '#teamView').locator('[data-view="weekly"]').click();
  await expectTab(page, 'weekly');
  await expect(bar.nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(bar.nth(0)).not.toHaveAttribute('aria-current', 'page');
});

test('PC 1280: 운영자 저장 구성(하단바에 사업 관리·조직 관리)도 왼쪽 메뉴에 [조직·사업] 한 줄', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page);
  const rows = (await page.locator('#appView > .app-nav .nav-btn').allTextContents()).map(t => t.trim());
  expect(rows.filter(t => t === '조직·사업')).toHaveLength(1);
  expect(rows.some(t => /^(사업 관리|조직 관리)$/.test(t))).toBe(false);
});

test('고친 이름은 큰 탭 이름으로 이어진다(옛 메뉴 이름 칸 menu_org·menu_biz)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
  await openHome(page, {
    menuLayout: null, query: '?view=meetings',
    beforeLoad: () => page.route(`${SB}/rest/v1/app_profiles**`, route => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'GET' && (url.searchParams.get('select') || '').includes('custom_words')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ custom_words: { menu_org: '가상 거래처', menu_biz: '가상 활동' } }]) });
      return route.fallback();
    }),
  });
  const strip = tabs(page, '#meetingsView');
  await expect(strip.locator('button')).toHaveText(['가상 거래처', '가상 활동', '주간 보고']);
  await expect(strip.locator('[data-view="meetings"]')).toHaveAttribute('aria-pressed', 'true');
  // 메뉴 이름은 모든 사람 같은 '조직·사업'.
  await expect(page.locator('#appView > .app-nav .nav-btn[data-view="team"]')).toHaveText(/조직·사업/);
});

test('처음 열 때 한 번에 최종 모양: 주간 보고 주소로 열어도 큰 탭 줄이 칸과 함께 나타나고 그 뒤 바뀌지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 860 });
  await page.addInitScript(() => {
    const seen = window.__orgbizSeen = [];
    const note = () => {
      const panel = document.querySelector('#homeView'), slot = panel?.querySelector('[data-orgbiz-tabs]');
      if (!panel || panel.classList.contains('hidden')) return;
      seen.push(`${slot?.hidden ? 'hidden' : 'shown'}:${slot?.querySelectorAll('button').length || 0}`);
    };
    new MutationObserver(note).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  });
  await openHome(page, { menuLayout: null, query: '?view=weekly' });
  await expectTab(page, 'weekly');
  const seen = await page.evaluate(() => [...new Set(window.__orgbizSeen)]);
  expect(seen).toEqual(['shown:3']);
});
