import { test, expect } from '@playwright/test';
import { signInWithSession } from '../app-e2e/helpers/session-login.mjs';
import { chooseBasketKind } from '../app-e2e/helpers/basket-kind.mjs';
import { FORBIDDEN } from '../../scripts/girok-words-allow.mjs';

// APP-올인원다이어리 단계 2: `node scripts/build-pages.mjs <입력> <출력> --face=girok`로 만든 기록+ 빌드가 따로 뜨는지 본다.
// 이름·manifest·아이콘·메뉴 이름은 기록+, 같은 흉내 서버로 켜진다. 메뉴·경로를 실제로 빼는 일은 단계 3 다음 PR이라 여기서는 글자만 본다.
// S67-43: 홈·활동 기록·거래처·부서·직원·노트·일정·쓰는 법 화면 글자에 노조 색 글자(FORBIDDEN)가 없는지 PC·폰에서 본다.
// Served at PAGES_GIROK_ORIGIN (pages-build-check.yml).
const origin = process.env.PAGES_GIROK_ORIGIN || 'http://127.0.0.1:8126';

async function boot(page) {
  const user = { id: 'girok-user', email: 'girok@example.org' }, workspace = { id: 'girok-workspace', name: 'QA', slug: 'qa' };
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**', route => {
    const path = new URL(route.request().url()).pathname;
    let data = [];
    if (path === '/auth/v1/token') data = { access_token: 'qa', refresh_token: 'qa-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user };
    else if (path === '/auth/v1/user') data = user;
    else if (path === '/rest/v1/app_workspace_members') data = [{ workspace_id: workspace.id, user_id: user.id, role: 'owner' }];
    else if (path === '/rest/v1/app_workspaces') data = [workspace];
    else if (path === '/rest/v1/app_profiles') data = [{ user_id: user.id, display_name: 'QA' }];
    else if (path.startsWith('/functions/')) data = { connected: false, enabled: false, tasks: [], events: [], calendars: [] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(origin + '/app/login/?return=' + encodeURIComponent(origin + '/app/?view=home'));
  await expect(page).toHaveTitle('로그인 · 기록+');
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
}

// 화면이 그려질 때까지: 그 화면 칸이 보이고, '불러오는 중' 같은 기다림 글이 사라질 때까지.
async function settle(page, view) {
  const panel = { home: '#homeView', meetings: '#meetingsView', team: '#teamView', calendar: '#calendarView', help: '#helpView', note: '#basketView[data-kind="note"]' }[view];
  if (panel) await expect(page.locator(panel)).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
}
async function noUnionWords(page, where) {
  const text = await page.evaluate(() => {
    const seen = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('script,style,template,[hidden]')) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      for (const node of el.childNodes) if (node.nodeType === 3 && node.textContent.trim()) seen.push(node.textContent.trim());
      for (const name of ['aria-label', 'title', 'placeholder']) if (el.getAttribute(name)) seen.push(el.getAttribute(name));
    }
    return seen;
  });
  const bad = text.filter(t => FORBIDDEN.test(t));
  expect(bad, `${where}: 기록+ 화면에 노조 색 글자`).toEqual([]);
}

test('기록+ 빌드: 이름·manifest·아이콘·메뉴 이름이 기록+로 뜬다', async ({ page }) => {
  const errors = [], failed = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.url().startsWith(origin) && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);
  await expect(page.locator('.topbar .brand span')).toHaveText('기록+');
  await expect(page).toHaveTitle('홈 · 기록+');
  await expect(page.locator('#appNav .nav-btn[data-view="meetings"]')).toContainText('활동 기록');
  await expect(page.locator('#appNav .nav-btn[data-view="team"]')).toContainText('거래처·직원');
  await page.evaluate(() => window.KPTURouter.go('meetings'));
  await expect(page).toHaveTitle('활동 기록 · 기록+');
  await expect(page.locator('[data-topline-where] li').first()).toHaveText('활동 기록');
  await page.evaluate(() => window.KPTURouter.go('team'));
  await expect(page).toHaveTitle('거래처·부서·직원 · 기록+');
  const manifest = await (await page.request.get(origin + '/app/windows-manifest.json')).json();
  expect(manifest).toMatchObject({ name: '기록+', short_name: '기록+' });
  const icon = await (await page.request.get(origin + '/app/app-icon.svg')).text();
  expect(icon).toContain('aria-label="기록+"');
  const body = await page.locator('body').innerText();
  for (const word of ['노동조합+', '사업 관리', '조직 관리']) expect(body, word).not.toContain(word);
  for (const view of ['home', 'meetings', 'team', 'calendar', 'help']) {
    await page.evaluate(v => window.KPTURouter.go(v), view);
    await settle(page, view);
    await noUnionWords(page, `PC ${view}`);
  }
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});

test('기록+ 폰 화면: 홈·활동 기록·거래처·부서·직원·노트에 노조 색 글자가 없다(화면 캡처)', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page);
  const shots = [['home', '홈'], ['meetings', '활동 기록'], ['team', '거래처·부서·직원'], ['note', '노트']];
  for (const [view, name] of shots) {
    if (view === 'note') await chooseBasketKind(page, 'note');
    else await page.evaluate(v => window.KPTURouter.go(v), view);
    await settle(page, view);
    await noUnionWords(page, `폰 ${name}`);
    await page.screenshot({ path: testInfo.outputPath(`girok-phone-${view}.png`) });
  }
  expect(errors).toEqual([]);
  await context.close();
});
