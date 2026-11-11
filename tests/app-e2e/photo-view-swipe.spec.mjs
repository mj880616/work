import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { expandLibraryTree } from './helpers/library-tree.mjs';

// PHOTO-크게보기밀기(S57-2): 사업 보고 사진 크게 보기(photo-view.js)에서 한 손가락으로 좌우로 밀면 앞뒤 사진, 아래로 밀면 닫기.
// 판정은 [사진] 메뉴(photo-viewer-model.mjs)와 같다. 두 손가락 중에는 넘기지 않고, 앞뒤 목록이 없는 한 장 보기는 좌우로 밀어도 제자리.
// 사진은 1×1 그림, 이름·번호는 모두 합성 값(네트워크 없음). 폰 412·PC 1280(터치 화면).
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M1 = ID(901);
const now = () => new Date().toISOString();

function makeState() {
  const doc = (n, title, file_name) => ({ id: ID(n), workspace_id: 'workspace-1', project_id: null, title, file_name, mime_type: 'image/jpeg', category: '투쟁', tags: [], document_date: '2026-10-20', created_at: now(), file_id: 'drive-' + n, drive_url: 'https://drive.google.com/file/d/drive-' + n + '/view', meeting_id: M1 });
  const docs = [];
  for (let k = 1; k <= 5; k++) docs.push(doc(10 + k, '현장 ' + k, `s${k}.jpg`));
  return {
    user: { id: 'user-1', email: 'owner@example.org', user_metadata: { display_name: '관리자' } },
    workspace: { id: 'workspace-1', slug: 'team', name: '웹2' },
    docs, errors: [],
    meeting: { id: M1, workspace_id: 'workspace-1', title: '○○ 결의대회', series_name: '○○ 결의대회', round_no: null, meeting_at: '2026-10-24T05:00:00Z', activity_kind: 'struggle', created_by: 'user-1', notes: '', decisions: '', transcript_text: '결과 원문', result_status: 'final' }
  };
}

async function mock(page, state) {
  page.on('pageerror', e => state.errors.push(e.message));
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });
    if (path === '/auth/v1/token') return ok({ access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: state.user });
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/auth/v1/logout') return ok({});
    if (path === '/functions/v1/library-files' && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (path === '/functions/v1/google-calendar') return ok({ connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {} });
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path === '/rest/v1/app_workspace_members') return ok([{ workspace_id: 'workspace-1', user_id: state.user.id, role: 'owner', workspace: state.workspace, created_at: now() }]);
    if (path === '/rest/v1/app_profiles') return ok([{ user_id: state.user.id, display_name: '관리자' }]);
    if (path === '/rest/v1/app_workspaces') return ok([state.workspace]);
    if (path === '/rest/v1/app_documents' && req.method() === 'GET') {
      const m = url.searchParams.get('meeting_id');
      return ok(m ? state.docs.filter(d => 'eq.' + d.meeting_id === m) : state.docs);
    }
    if (path === '/rest/v1/app_meetings' && req.method() === 'GET') {
      const id = url.searchParams.get('id') || '';
      if (id.startsWith('in.(') || !id) return ok([state.meeting]);
      return ok('eq.' + M1 === id ? [state.meeting] : []);
    }
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

async function openDetail(page, state, width) {
  await page.setViewportSize({ width, height: 900 });
  await mock(page, state);
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await expect(page.locator('[data-lu-photoset]').first()).toBeAttached({ timeout: 10000 });
  await expandLibraryTree(page);
  await page.locator(`[data-lu-photoset="${M1}"]`).click();
  await page.locator(`[data-rv-set="${M1}"] .rv-set-head`).click();
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#mrdPhotos .act-photo-thumb[data-state="shown"] img')).toHaveCount(5);
}

const view = page => page.locator('.basket-photo-view');
const countText = page => view(page).locator('.basket-photo-count');
const photoOf = page => view(page).locator('.basket-photo-stage .diary-photo');
const transformOf = loc => loc.evaluate(el => el.style.transform);
// 한 손가락 밀기(CDP 터치): 칸 가운데에서 dx·dy만큼. during()은 손가락을 떼기 전 확인, 아무것도 안 하면 떼고 끝.
async function swipe(page, dx, dy, { steps = 8, during = null, release = true } = {}) {
  const b = await view(page).locator('.basket-photo-stage').boundingBox();
  const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(x + dx * i / steps), y: Math.round(y + dy * i / steps), id: 0 }] });
  if (during) await during();
  if (release) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

for (const width of [412, 1280]) {
  test(`사업 보고 사진 5장: 좌우로 밀어 넘기고, 모자라면 제자리, 끝에서는 안 넘어가고, 아래로 밀어 닫는다 ${width}`, async ({ page }) => {
    const state = makeState();
    await openDetail(page, state, width);
    await page.locator('#mrdPhotos .act-photo-thumb').first().click();
    await expect(view(page)).toBeVisible();
    await expect(countText(page)).toHaveText('1/5');
    // 처음 사진에서 오른쪽으로 밀어도(앞 사진 없음) 넘어가지 않고 제자리로 돌아온다.
    await swipe(page, 140, 6);
    await expect(countText(page)).toHaveText('1/5');
    await expect.poll(() => transformOf(photoOf(page))).toBe('');
    // 끄는 동안 사진이 손가락을 따라간다.
    await swipe(page, -60, 4, { release: false, during: async () => { expect(await transformOf(photoOf(page))).toMatch(/^translate\(-\d+px, 0px\)$/); } });
    // (손가락을 떼지 않은 채 끝났으니 이어서 떼는 대신 새 손동작으로 정리)
    await page.evaluate(() => document.querySelector('.basket-photo-stage').dispatchEvent(new TouchEvent('touchcancel', { bubbles: true })));
    // 거리가 모자란 밀기(60px)는 넘기지 않는다.
    await swipe(page, -60, 4);
    await expect(countText(page)).toHaveText('1/5');
    // 왼쪽으로 밀면 다음 사진 — 5장을 끝까지.
    for (const n of [2, 3, 4, 5]) {
      await swipe(page, -150, 8);
      await expect(countText(page)).toHaveText(`${n}/5`);
      await expect.poll(() => transformOf(photoOf(page))).toBe('');
    }
    // 마지막 사진에서 왼쪽으로 밀어도(다음 사진 없음) 그대로.
    await swipe(page, -150, 8);
    await expect(countText(page)).toHaveText('5/5');
    await expect.poll(() => transformOf(photoOf(page))).toBe('');
    // 오른쪽으로 밀면 이전 사진.
    await swipe(page, 150, -8);
    await expect(countText(page)).toHaveText('4/5');
    // 단추·키는 그대로 동작한다.
    await view(page).locator('.basket-photo-step[data-dir="1"]').click();
    await expect(countText(page)).toHaveText('5/5');
    await page.keyboard.press('ArrowLeft');
    await expect(countText(page)).toHaveText('4/5');
    // 위로 밀면 아무 일도 없다(별표 없음, 사진도 안 따라감).
    await swipe(page, 4, -200, { release: false, during: async () => { expect(await transformOf(photoOf(page))).toBe(''); } });
    await page.evaluate(() => document.querySelector('.basket-photo-stage').dispatchEvent(new TouchEvent('touchcancel', { bubbles: true })));
    await expect(view(page)).toBeVisible();
    // 아래로 모자라게(60px) 밀면 제자리, 넘게 밀면 따라 내려가 닫힌다.
    await swipe(page, 2, 60);
    await expect(view(page)).toBeVisible();
    await expect.poll(() => transformOf(photoOf(page))).toBe('');
    await swipe(page, 3, 220);
    await expect(view(page)).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
}

test('두 손가락 손동작과 단추 위에서 시작한 손가락은 사진을 넘기지 않는다 412', async ({ page }) => {
  const state = makeState();
  await openDetail(page, state, 412);
  await page.locator('#mrdPhotos .act-photo-thumb').nth(1).click();
  await expect(countText(page)).toHaveText('2/5');
  const b = await view(page).locator('.basket-photo-stage').boundingBox();
  const cx = Math.round(b.x + b.width / 2), cy = Math.round(b.y + b.height / 2);
  const cdp = await page.context().newCDPSession(page);
  const two = d => [{ x: cx - d, y: cy, id: 0 }, { x: cx + d, y: cy, id: 1 }];
  // 벌리기(확대 손동작)와, 두 손가락이 같이 옆으로 움직이는 손동작.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: two(20) });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: two(20 + i * 12) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: two(30) });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 30 - i * 25, y: cy, id: 0 }, { x: cx + 30 - i * 25, y: cy, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(countText(page)).toHaveText('2/5');
  await expect(view(page)).toBeVisible();
  // 단추(›) 위에서 시작한 밀기는 사진 밀기가 아니다.
  const nb = await view(page).locator('.basket-photo-step[data-dir="1"]').boundingBox();
  const bx = Math.round(nb.x + nb.width / 2), by = Math.round(nb.y + nb.height / 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bx, y: by, id: 0 }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bx - i * 25, y: by, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect(countText(page)).toHaveText('2/5');
  expect(state.errors).toEqual([]);
});

test('앞뒤 목록이 없는 한 장 보기는 좌우로 밀어도 제자리, 아래로 밀면 닫힌다 412', async ({ page }) => {
  const state = makeState();
  await openDetail(page, state, 412);
  // 자료 줄·자료실이 쓰는 한 장 보기(file-actions viewDocumentPhoto).
  await page.evaluate(async id => {
    const m = await import('/app/file-actions.js');
    void m.viewDocumentPhoto({ name: 's1.jpg', mime: 'image/jpeg', documentId: id });
  }, ID(11));
  await expect(view(page)).toBeVisible();
  await expect(view(page).locator('.basket-photo-step')).toHaveCount(0);
  await expect(photoOf(page).locator('img')).toHaveCount(1);
  await swipe(page, -150, 6);
  await swipe(page, 150, -6);
  await expect(view(page)).toBeVisible();
  await expect.poll(() => transformOf(photoOf(page))).toBe('');
  await swipe(page, 2, 220);
  await expect(view(page)).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
