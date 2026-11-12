import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { expandLibraryTree } from './helpers/library-tree.mjs';
import { start, openFiles } from './helpers/files-server.mjs';

// LIB-사진숨김나머지(S61-1, 명진 결정 11/13 "모두 숨김"): #2448이 남겨 둔 곳도 같은 규칙 — 사진은 줄에서 빼고 목록 맨 아래 [사진 n] 하나,
// 누르면 그 자리에 작은 그림, 그림을 누르면 크게 보기. 자료실 '최근 올린 파일', [파일] '최근' 상자·별표·큰 파일 묶음·찾기 결과.
// (사업 보고 사진 묶음 줄은 library-photoset.spec.mjs.) 모든 이름·번호는 지어낸 것이다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = () => new Date().toISOString();
const shotDir = process.env.S61_SHOTS || '';
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

for (const width of [412, 1280]) test(`자료실 ${width}: 최근 올린 파일의 사진은 맨 아래 [사진 2], 누르면 작은 그림·크게 보기`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const state = libState();
  await libMock(page, state);
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await expect(page.locator('[data-lu-document]').first()).toBeAttached({timeout: 10000});
  await expandLibraryTree(page);
  const recent = page.locator('#libraryRecent');
  // 사진 아닌 줄 2개만, 사진은 [사진 2] 하나(접힘, 작은 그림도 아직 받지 않음).
  await expect(recent.locator('[data-lu-recent]')).toHaveCount(2);
  for (const n of [1, 2]) await expect(recent.locator(`[data-lu-recent="${ID(n)}"]`)).toHaveCount(0);
  const toggle = recent.locator('[data-lu-recent-photos]');
  await expect(toggle).toHaveText('사진 2');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // [사진 n]은 목록 맨 아래.
  expect(await recent.locator('.lu-recent-list > li').last().evaluate(li => !!li.querySelector('[data-lu-recent-photos]'))).toBe(true);
  await shot(page, `library-recent-${width}`);
  await toggle.click();
  await expect(recent.locator('[data-lu-recent-photos]')).toHaveAttribute('aria-expanded', 'true');
  const tile = recent.locator(`[data-photo-tile="${ID(1)}"]`);
  await expect(tile.locator('.lu-thumb img')).toBeVisible();
  await expect(recent.locator('[data-photo-tile]')).toHaveCount(2);
  // 칸 안 ⋯는 오른쪽 위 24px(자료 줄과 같은 메뉴).
  expect(await tile.locator('[data-lu-menu]').evaluate(e => { const r = e.getBoundingClientRect(), p = e.closest('[data-photo-tile]').getBoundingClientRect(); return [r.width, r.height, Math.round(p.right - r.right), Math.round(r.top - p.top)]; })).toEqual([24, 24, 0, 0]);
  await shot(page, `library-recent-open-${width}`);
  expect(await noWideScroll(page)).toBe(true);
  await tile.locator('[data-lu-menu]').click();
  await expect(page.locator('#luMorePanel')).toBeVisible();
  await page.keyboard.press('Escape');
  // 그림 누르기 = 크게 보기.
  await tile.locator('.lu-thumb').click();
  const view = page.locator('[data-basket-photo-view]');
  await expect(view).toBeVisible();
  expect(state.photoCalls.some(c => c.id === ID(1) && c.size === 'large')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  // 아래 목록의 [사진 2]·자료 수는 그대로(#2448).
  await expect(page.locator('#documentList [data-lu-photos]')).toHaveText('사진 2');
});

// [파일]: 기본 가짜 파일 중 사진은 '가짜 현장.jpg'(OD!20, 가장 큰 파일) 하나. 하나 더 넣어 둘.
const addPhoto = server => {
  const base = server.items.find(i => i.item_id === 'OD!20');
  server.items.push({ ...base, item_id: 'OD!33', parent_id: 'OD!1', name: '가짜 회견.png', mime: 'image/png', size_bytes: 2048, modified_at: '2026-10-07T01:00:00Z', starred: true });
};

test('파일 412: 폰 나무 \'최근\' 상자의 사진은 맨 아래 [사진 1], 누르면 그 자리에 작은 그림', async ({page}) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  addPhoto(server);
  await openFiles(page, 412);
  const box = page.locator('#filesRoot [data-fx-tree] [data-fx-box="recent"]');
  await expect(box.locator('[data-fx-tfile]').first()).toBeVisible();
  await expect(box.locator('[data-fx-tfile="od:OD!33"]')).toHaveCount(0);
  // 최근 5개 안의 사진만 센다('가짜 현장.jpg'는 6번째라 상자에 없음).
  await expect(box.locator('[data-fx-tfile="od:OD!20"]')).toHaveCount(0);
  await expect(box.locator('[data-fx-tfile]')).toHaveCount(4);
  const toggle = box.locator('[data-fx-photos]');
  await expect(toggle).toHaveText('사진 1');
  await shot(page, 'files-recent-412');
  await toggle.click();
  const tile = box.locator('[data-photo-tile="od:OD!33"]');
  await expect(tile.locator('img')).toBeVisible();
  await shot(page, 'files-recent-open-412');
  // 그림 누르기 = 미리보기.
  await tile.locator('[data-fx-tfile]').click();
  await expect(page.locator('#filesRoot [data-fx-prev] .fx-pv-imgbox')).toHaveAttribute('data-img-state', 'shown');
  expect(await noWideScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('파일 1280: 별표·큰 파일 묶음과 찾기 결과의 사진도 맨 아래 [사진 n], 찾기 종류 \'사진\'이면 줄로', async ({page}) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1280);
  addPhoto(server);
  await openFiles(page, 1280);
  const tree = page.locator('#filesRoot [data-fx-tree]');
  const list = page.locator('#filesRoot [data-fx-pane-i="0"] [data-fx-list]');
  // 큰 파일: 가장 큰 '가짜 현장.jpg'도 줄에서 빠지고 맨 아래 [사진 2].
  await tree.locator('[data-fx-shelf="big"]').click();
  await expect(list.locator('[data-fx-row="od:OD!11"]')).toBeVisible();
  await expect(list.locator('[data-fx-row="od:OD!20"]')).toHaveCount(0);
  await expect(list.locator('[data-fx-photos]')).toHaveText('사진 2');
  await shot(page, 'files-big-1280');
  await list.locator('[data-fx-photos]').click();
  await expect(list.locator('.fx-photo-grid [data-fx-row="od:OD!20"] .fx-cell-pic img')).toBeVisible();
  await shot(page, 'files-big-open-1280');
  // 별표: 사진(별표 붙인 가짜 회견.png)은 [사진 1].
  await tree.locator('[data-fx-shelf="starred"]').click();
  await expect(list.locator('[data-fx-row="od:OD!12"]')).toBeVisible();
  await expect(list.locator('[data-fx-row="od:OD!33"]')).toHaveCount(0);
  await expect(list.locator('[data-fx-photos]')).toHaveText('사진 1');
  // 찾기: '가짜'로 찾으면 사진 2장은 [사진 2](개수 줄은 찾은 것 전체 그대로).
  await page.locator('#filesRoot [data-fx-search]').fill('가짜');
  await expect(list.locator('[data-fx-row="od:OD!11"]')).toBeVisible();
  await expect(list.locator('[data-fx-row="od:OD!20"]')).toHaveCount(0);
  await expect(list.locator('[data-fx-photos]')).toHaveText('사진 2');
  const total = server.items.filter(i => !i.trashed && i.name.includes('가짜')).length;
  await expect(page.locator('#filesRoot :is(.fx-crumb-now, .ft-focus-name)')).toContainText(`찾은 것 ${total}`);
  await shot(page, 'files-find-1280');
  await list.locator('[data-fx-photos]').click();
  await expect(list.locator('.fx-photo-grid [data-fx-row="od:OD!33"]')).toBeVisible();
  // 종류 거르기 '사진'을 고르면 사진만 보려는 것이라 줄로 보인다.
  await list.locator('[data-fx-fdim="kind"]').click();
  await page.locator('#rowMenu').getByRole('button', { name: '사진' }).click();
  await expect(list.locator('.fx-rows:not(.fx-grid) > [data-fx-row="od:OD!20"]')).toBeVisible();
  await expect(list.locator('[data-fx-photos]')).toHaveCount(0);
  expect(await noWideScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});
