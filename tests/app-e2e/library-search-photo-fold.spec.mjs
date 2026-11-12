import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { expandLibraryTree } from './helpers/library-tree.mjs';

// S61-12 (LIB-사진숨김나머지 남은 것, 커맨드센터 결정 11/13): 자료실 검색 결과도 [파일] 찾기와 같게 사진은 줄로 보이지 않고
// 그 묶음 맨 아래 [사진 n] 하나(개수 그대로, 누르면 작은 그림, 그림을 누르면 크게 보기). 모든 이름·번호는 지어낸 것이다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = () => new Date().toISOString();
const shotDir = process.env.S61_12_SHOTS || '';
const shot = (page, name) => page.screenshot({ path: shotDir ? `${shotDir}/${name}.png` : test.info().outputPath(name + '.png') });
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1);

function libState() {
  const doc = (n, title, file_name, extra = {}) => ({id: ID(n), workspace_id: 'workspace-1', project_id: null, title, file_name, category: '기타', tags: [], document_date: '2026-10-20', created_at: now(), file_id: 'drive-' + n, ...extra});
  return {
    user: {id: 'user-1', email: 'owner@example.org', user_metadata: {display_name: '자료실 관리자'}},
    workspace: {id: 'workspace-1', slug: 'team', name: '웹2'},
    photoCalls: [],
    docs: [doc(1, '가짜 현장 사진', 'field.jpg'), doc(2, '가짜 휴대폰 사진', 'phone.heic', {mime_type: 'image/heic'}), doc(3, '가짜 보고서', 'report.pdf'), doc(4, '가짜 계획안', 'plan.hwpx')]
  };
}
async function libMock(page, state) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ok = data => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: state.user});
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/auth/v1/logout') return ok({});
    if (path === '/functions/v1/library-files' && req.method() === 'GET') {
      const q = url.searchParams;
      state.photoCalls.push({id: q.get('document_id'), size: q.get('size')});
      return route.fulfill({status: 200, contentType: 'image/png', body: PNG});
    }
    if (path === '/functions/v1/google-calendar') return ok({connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {}});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'workspace-1', user_id: state.user.id, role: 'owner', workspace: state.workspace, created_at: now()}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id: state.user.id, display_name: '자료실 관리자'}]);
    if (path === '/rest/v1/app_workspaces') return ok([state.workspace]);
    if (path === '/rest/v1/app_documents' && req.method() === 'GET') return ok(state.docs);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

for (const width of [412, 1280]) test(`자료실 ${width}: 검색 결과의 사진도 줄 대신 [사진 2], 누르면 작은 그림·크게 보기`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const state = libState();
  await libMock(page, state);
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await expect(page.locator('[data-lu-document]').first()).toBeAttached({timeout: 10000});
  await expandLibraryTree(page);
  if (width < 761) await page.locator('#librarySearchOpen').click();
  await page.locator('#documentSearch').fill('가짜');
  const list = page.locator('#documentList');
  // 사진 아닌 자료 2개는 줄, 사진 2장은 줄 없이 맨 아래 [사진 2](접힘, 작은 그림도 아직 받지 않음).
  await expect(list.locator(`.lu-row[data-lu-document="${ID(3)}"]`)).toBeVisible();
  await expect(list.locator(`.lu-row[data-lu-document="${ID(4)}"]`)).toBeVisible();
  for (const n of [1, 2]) await expect(list.locator(`.lu-row[data-lu-document="${ID(n)}"]`)).toHaveCount(0);
  const toggle = list.locator('[data-lu-photos]');
  await expect(toggle).toHaveText('사진 2');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(state.photoCalls.length).toBe(0);
  // 찾은 개수는 그대로(사진 포함 4개).
  await expect(page.locator('#luSearchPickAll')).toHaveText('결과 4개 모두 선택');
  await shot(page, `library-search-${width}`);
  await toggle.click();
  await expect(list.locator('[data-lu-photos]')).toHaveAttribute('aria-expanded', 'true');
  await expect(list.locator('[data-photo-tile]')).toHaveCount(2);
  const tile = list.locator(`[data-photo-tile="${ID(1)}"]`);
  await expect(tile.locator('.lu-thumb img')).toBeVisible();
  await shot(page, `library-search-open-${width}`);
  expect(await noWideScroll(page)).toBe(true);
  // 그림 누르기 = 크게 보기.
  await tile.locator('.lu-thumb').click();
  const view = page.locator('[data-basket-photo-view]');
  await expect(view).toBeVisible();
  await expect.poll(() => state.photoCalls.some(c => c.id === ID(1) && c.size === 'large')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  // 사진만 찾아도 [사진 1] 하나.
  await page.locator('#documentSearch').fill('휴대폰');
  await expect(list.locator('.lu-row[data-lu-document]')).toHaveCount(0);
  await expect(list.locator('[data-lu-photos]')).toHaveText('사진 1');
});
