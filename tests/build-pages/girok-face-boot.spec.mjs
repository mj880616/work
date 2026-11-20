import { test, expect } from '@playwright/test';
import { signInWithSession } from '../app-e2e/helpers/session-login.mjs';

// APP-올인원다이어리 단계 2: `node scripts/build-pages.mjs <입력> <출력> --face=girok`로 만든 기록+ 빌드가 따로 뜨는지 본다.
// 이름·manifest·아이콘·메뉴 이름은 기록+, 같은 흉내 서버로 켜진다. 메뉴·경로를 실제로 빼는 일은 단계 3이라 여기서는 이름만 본다.
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

test('기록+ 빌드: 이름·manifest·아이콘·메뉴 이름이 기록+로 뜬다', async ({ page }) => {
  const errors = [], failed = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.url().startsWith(origin) && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);
  await expect(page.locator('.topbar .brand span')).toHaveText('기록+');
  await expect(page).toHaveTitle('홈 · 기록+');
  await expect(page.locator('#appNav .nav-btn[data-view="meetings"]')).toContainText('프로젝트·거래처');
  await expect(page.locator('#appNav .nav-btn[data-view="team"]')).toContainText('사람 수첩');
  await page.evaluate(() => window.KPTURouter.go('meetings'));
  await expect(page).toHaveTitle('프로젝트·거래처 · 기록+');
  await expect(page.locator('[data-topline-where] li').first()).toHaveText('프로젝트·거래처');
  const manifest = await (await page.request.get(origin + '/app/windows-manifest.json')).json();
  expect(manifest).toMatchObject({ name: '기록+', short_name: '기록+' });
  const icon = await (await page.request.get(origin + '/app/app-icon.svg')).text();
  expect(icon).toContain('aria-label="기록+"');
  const body = await page.locator('body').innerText();
  for (const word of ['노동조합+', '사업 관리', '조직 관리']) expect(body, word).not.toContain(word);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});
