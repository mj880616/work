import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { expandLibraryTree } from './helpers/library-tree.mjs';

// ACT-사진 2단계: 자료실 그림 자료는 줄에 작은 그림(library-files photo small)이 붙고, 누르면 큰 그림(large)으로 크게 본다.
// 그림이 아닌 자료·Drive 파일이 없는 자료에는 붙지 않고, 서버가 못 주면 종류 표시만 남는다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = () => new Date().toISOString();

function makeState() {
  const doc = (n, title, file_name, extra = {}) => ({id: ID(n), workspace_id: 'workspace-1', project_id: null, title, file_name, category: '기타', tags: [], document_date: '2026-10-20', created_at: now(), file_id: 'drive-' + n, ...extra});
  return {
    user: {id: 'user-1', email: 'owner@example.org', user_metadata: {display_name: '자료실 관리자'}},
    workspace: {id: 'workspace-1', slug: 'team', name: '웹2'},
    photoCalls: [],
    docs: [
      doc(1, '현장 사진', 'field.jpg'),
      doc(2, '휴대폰 사진', 'phone.heic', {mime_type: 'image/heic'}),
      doc(3, '보고서', 'report.pdf'),
      doc(4, 'Drive 없는 그림', 'nofile.png', {file_id: null}),
      doc(5, '받기 실패 그림', 'broken.png')
    ]
  };
}

async function mock(page, state) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ok = data => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: state.user});
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/auth/v1/logout') return ok({});
    if (path === '/functions/v1/library-files' && req.method() === 'GET') {
      const q = url.searchParams;
      state.photoCalls.push({action: q.get('action'), id: q.get('document_id'), size: q.get('size'), auth: req.headers().authorization || ''});
      if (q.get('document_id') === ID(5)) return route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"photo_unavailable"}'});
      return route.fulfill({status: 200, contentType: 'image/png', body: PNG});
    }
    if (path === '/functions/v1/google-calendar') return ok({connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {}});
    if (path === '/functions/v1/workspace-drive') { state.tokenCalls = (state.tokenCalls || 0) + 1; return ok({url: `${appOrigin}/tests/app-e2e/library-open-fixture.html?download=1`}); }
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

for (const width of [390, 1440]) {
  test(`library photo rows show a small picture and open a large one ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    const state = makeState();
    await mock(page, state);
    await page.goto(`${appOrigin}/app/?view=library`);
    await enterLogin(page);
    await signInWithSession(page, 'owner@example.org');
    await expect(page.locator('[data-lu-document]').first()).toBeAttached({timeout: 10000});
    await expandLibraryTree(page);

    const row = n => page.locator(`[data-lu-document="${ID(n)}"]`);
    await expect(row(1).locator('.lu-thumb img')).toBeVisible();
    await expect(row(2).locator('.lu-thumb img')).toBeVisible();
    await expect(row(3).locator('.lu-thumb')).toHaveCount(0);
    await expect(row(4).locator('.lu-thumb')).toHaveCount(0);
    await expect(row(5).locator('.lu-thumb')).toHaveCount(0); // 서버가 못 주면 칸이 없어지고 종류 표시만 남는다
    await expect(row(5).locator('.lu-file-kind')).toHaveText('그림');
    const small = state.photoCalls.filter(c => c.size === 'small');
    expect(small.map(c => c.id).sort()).toEqual([ID(1), ID(2), ID(5)]);
    expect(small.every(c => c.action === 'photo' && c.auth === 'Bearer e2e-access')).toBe(true);

    // 줄이 화면 안에 들어가고 작은 그림이 제목을 밀어내지 않는다.
    const box = await row(1).boundingBox(), thumb = await row(1).locator('.lu-thumb').boundingBox(), vw = page.viewportSize().width;
    expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
    expect(thumb.width).toBeLessThanOrEqual(28.5);
    await expect(row(1).locator('.lu-row-title')).toBeVisible();

    // 누르면 큰 그림(large)으로 크게 보고, 닫으면 줄로 돌아온다.
    await row(1).click();
    const view = page.locator('[data-basket-photo-view]');
    await expect(view).toBeVisible();
    await expect(view.locator('img')).toBeVisible();
    expect(state.photoCalls.some(c => c.id === ID(1) && c.size === 'large')).toBe(true);
    expect(state.tokenCalls || 0).toBe(0);
    await page.keyboard.press('Escape');
    await expect(view).toHaveCount(0);

    // 큰 그림을 못 받으면 원본 내려받기 주소로 대신한다.
    await row(5).click();
    await expect(view).toBeVisible();
    await expect.poll(() => state.tokenCalls || 0).toBeGreaterThan(0);
  });
}
