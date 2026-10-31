import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { expandLibraryTree } from './helpers/library-tree.mjs';

// S46-20 사진 정리 ⑥(명진 11/01 01:04 추천대로): 사업 보고 사진 줄 안 '그 시각 사진 [골라 붙이기]'.
// - 폰 앱 412: 그 보고 시각 앞뒤 3시간 폰 사진만 보이고(앱 다리 흉내 + __phone 가로채기 흉내), 고른 사진만 기존 사진 올리기 길(library-files POST)로 올라간다.
// - PC 1280: 폰 앱이 아니면 원드라이브 사진(연결·폴더 있음)만, 고른 한 장만 올라간다. 고르지 않으면 아무것도 올리지 않는다.
// 모든 이름·번호는 합성 값, 사진은 1×1 그림, 네트워크 없음.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-media.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.2';
const KEY = 'PhoneKeyForTest_0123456789';
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M1 = ID(901);
const now = () => new Date().toISOString();
// 보고 시각 2026-10-24 14:00(서울) = 05:00Z. 폰: 1·2는 앞뒤 3시간 안, 3은 전날.
const PHONE = [
  { id: '1', name: 'IMG_1.jpg', day: '2026-10-24', taken_at: '2026-10-24T05:30:00.000Z', size_bytes: 10 },
  { id: '2', name: 'IMG_2.jpg', day: '2026-10-24', taken_at: '2026-10-24T03:10:00.000Z', size_bytes: 20 },
  { id: '3', name: 'IMG_3.jpg', day: '2026-10-23', taken_at: '2026-10-23T05:00:00.000Z', size_bytes: 30 },
].map(m => ({ ...m, approx: false, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: m.taken_at }));
// 원드라이브: A는 앞뒤 3시간 안, B는 이틀 뒤.
const OD_DAYS = { '2026-10-24': [{ id: 'A', name: 'od_a.jpg', taken_at: '2026-10-24T06:00:00Z', approx: false }], '2026-10-26': [{ id: 'B', name: 'od_b.jpg', taken_at: '2026-10-26T05:00:00Z', approx: false }] };

function makeState() {
  const docs = [{ id: ID(11), workspace_id: 'workspace-1', project_id: null, title: '현장 1', file_name: 's1.jpg', mime_type: 'image/jpeg', category: '투쟁', tags: [], document_date: '2026-10-24', created_at: now(), file_id: 'drive-11', drive_url: 'https://drive.google.com/file/d/drive-11/view', meeting_id: M1 }];
  return {
    user: { id: 'user-1', email: 'owner@example.org', user_metadata: { display_name: '관리자' } },
    workspace: { id: 'workspace-1', slug: 'team', name: '웹2' },
    uploads: [], docs, phoneReads: [], od: [], errors: [],
    meeting: { id: M1, workspace_id: 'workspace-1', title: '○○ 결의대회', series_name: '○○ 결의대회', round_no: null, meeting_at: '2026-10-24T05:00:00+00:00', activity_kind: 'struggle', created_by: 'user-1', notes: '', decisions: '', transcript_text: '결과 원문', result_status: 'final' },
  };
}

async function mock(page, state, { onedrive = false } = {}) {
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });
    if (path === '/auth/v1/token') return ok({ access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: state.user });
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/auth/v1/logout') return ok({});
    if (path === '/functions/v1/library-files' && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (path === '/functions/v1/library-files' && req.method() === 'POST') {
      state.uploads.push((req.postDataBuffer() || Buffer.alloc(0)).toString('latin1'));
      const n = 100 + state.uploads.length;
      const added = { id: ID(n), workspace_id: 'workspace-1', meeting_id: M1, title: 'new', file_name: 'new.png', mime_type: 'image/png', category: '투쟁', file_id: 'drive-' + n, created_at: now() };
      state.docs.push(added);
      return ok({ ok: true, document: added });
    }
    if (path === '/functions/v1/onedrive-photos') {
      const body = req.postDataJSON();
      state.od.push(body.action);
      if (!onedrive) return ok({ configured: false, connected: false });
      if (body.action === 'status') return ok({ configured: true, connected: true, folder: { name: '카메라' }, whole: true, can_delete: true });
      if (body.action === 'photos') return ok({ days: body.month === '2026-10' ? OD_DAYS : {} });
      if (body.action === 'photo-urls') return ok({ urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} });
      if (body.action === 'media-url') return ok({ url: `${CDN}/orig/${body.id}.png`, kind: 'photo', name: 'od_a.jpg', expires_in: 3000 });
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'action_invalid' }) });
    }
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
      if (!id || id.startsWith('in.(')) return ok([state.meeting]);
      return ok('eq.' + M1 === id ? [state.meeting] : []);
    }
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
  await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
  await page.route('**/__phone/**', r => {
    const u = new URL(r.request().url());
    state.phoneReads.push(u.pathname.replace(/^.*__phone\//, '') + u.search);
    if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({ status: 404, body: '' });
    if (u.pathname.endsWith('/page')) {
      const before = Number(u.searchParams.get('before')) || Infinity;
      const list = PHONE.filter(m => Date.parse(m.taken_at) < before).sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at));
      return r.fulfill({ json: { items: list, next: null, total: list.length } });
    }
    if (u.pathname.includes('/thumb/') || u.pathname.includes('/media/')) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    return r.fulfill({ status: 404, body: '' });
  });
}

async function phoneBridge(page) {
  await page.addInitScript(key => {
    const listeners = [];
    const prev = window.KPTUAppShell;
    window.KPTUAppShell = {
      postMessage(m) {
        if (m === 'photos:hello' || m === 'photos:ask') setTimeout(() => listeners.forEach(fn => fn({ data: `photos:state:{"access":"full","key":"${key}","trash":true,"hide":true}` })), 0);
        prev?.postMessage?.(m);
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); prev?.addEventListener?.(type, fn); },
    };
  }, KEY);
}

async function openDetail(page) {
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);
  await signInWithSession(page, 'owner@example.org');
  await expect(page.locator('[data-lu-photoset]').first()).toBeAttached({ timeout: 10000 });
  await expandLibraryTree(page);
  await page.locator(`[data-lu-photoset="${M1}"]`).click();
  await page.locator(`[data-rv-set="${M1}"] .rv-set-head`).click();
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible({ timeout: 10000 });
}
const strip = page => page.locator('#mrdTimePhotos [data-tp-item]');
const itemIds = page => strip(page).evaluateAll(els => els.map(e => e.dataset.tpItem));

test.describe('폰 앱 412', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });
  test('그 시각 폰 사진: 앞뒤 3시간 것만 보이고, 고른 한 장만 기존 사진 올리기 길로 올라간다', async ({ page }) => {
    const state = makeState();
    await mock(page, state);
    await phoneBridge(page);
    await openDetail(page);
    const line = page.locator('#mrdTimePhotos');
    await expect(line).toBeVisible();
    await expect(line.locator('[data-tp-open]')).toHaveText('골라 붙이기');
    // 열기 전에는 폰 사진 목록을 읽지 않는다.
    expect(state.phoneReads.filter(p => p.includes('/page?'))).toEqual([]);
    await line.locator('[data-tp-open]').click();
    await expect.poll(() => itemIds(page)).toEqual(['ph:2', 'ph:1']);
    await expect(line.locator('[data-tp-head]')).toHaveText('그 시각 사진 2장');
    const attach = line.locator('[data-tp-attach]');
    await expect(attach).toBeDisabled();
    // 한 장 고르기 → [붙이기 1].
    await strip(page).nth(1).click();
    await expect(strip(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(attach).toHaveText('붙이기 1');
    // 작은 칸은 가로로 넘치지 않는다(화면 전체 기준).
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1)).toBe(true);
    await attach.click();
    await expect(page.locator('#mrdPhotoStatus')).toContainText('1장을 올렸어요', { timeout: 10000 });
    expect(state.uploads.length).toBe(1);
    expect(state.uploads[0]).toContain('IMG_1.jpg');
    expect(state.uploads[0]).toContain(M1);
    expect(state.phoneReads.some(p => p.endsWith('media/1'))).toBe(true);
    expect(state.phoneReads.some(p => /media\/2$/.test(p))).toBe(false);
    // 붙인 뒤 접힌다.
    await expect(line.locator('[data-tp-pick]')).toBeHidden();
    await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 2', { timeout: 10000 });
    expect(state.errors).toEqual([]);
  });
});

test.describe('PC 1280', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test('그 시각 원드라이브 사진: 폰 사진 없이 원드라이브 것만, 고르지 않으면 올리지 않고 고른 한 장만 올린다', async ({ page }) => {
    const state = makeState();
    await mock(page, state, { onedrive: true });
    await openDetail(page);
    const line = page.locator('#mrdTimePhotos');
    await expect(line).toBeVisible();
    await line.locator('[data-tp-open]').click();
    await expect.poll(() => itemIds(page)).toEqual(['A']);
    expect(state.phoneReads).toEqual([]);
    // 고르지 않고 [닫기] → 아무것도 올리지 않는다.
    await line.locator('[data-tp-close]').click();
    await expect(line.locator('[data-tp-pick]')).toBeHidden();
    expect(state.uploads.length).toBe(0);
    // 다시 열어 고르고 붙이기.
    await line.locator('[data-tp-open]').click();
    await expect.poll(() => itemIds(page)).toEqual(['A']);
    await strip(page).first().click();
    await line.locator('[data-tp-attach]').click();
    await expect(page.locator('#mrdPhotoStatus')).toContainText('1장을 올렸어요', { timeout: 10000 });
    expect(state.uploads.length).toBe(1);
    expect(state.uploads[0]).toContain('od_a.jpg');
    expect(state.od).toContain('media-url');
    expect(state.errors).toEqual([]);
  });
});

// 일기: 그날 폰 사진도 같은 격자에 보이기만(서버 저장 없음). 원드라이브에 같은 사진이 있으면 원드라이브 것 한 장.
test.describe('폰 앱 412 · 일기', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });
  test('일기 그날 폰 사진: 원드라이브 사진과 함께 보이고, 같은 사진은 한 장, 다른 날 폰 사진은 없음, 아무것도 올리지 않음', async ({ page }) => {
    const { openHome } = await import('./helpers/home-entry.mjs');
    const state = { phoneReads: [], writes: [], errors: [] };
    page.on('pageerror', e => state.errors.push(e.message));
    await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
    await phoneBridge(page);
    const DAY = '2026-10-05';
    const phone = [
      { id: '7', name: 'IMG_7.jpg', day: DAY, taken_at: `${DAY}T02:30:00.000Z`, size_bytes: 70 },
      { id: '8', name: 'A1.jpg', day: DAY, taken_at: `${DAY}T01:00:01.000Z`, size_bytes: 80 },
      { id: '9', name: 'IMG_9.jpg', day: '2026-10-04', taken_at: '2026-10-04T02:00:00.000Z', size_bytes: 90 },
    ].map(m => ({ ...m, approx: false, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: m.taken_at }));
    await openHome(page);
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname.startsWith('/functions/v1/basket-files'), r => { state.writes.push(r.request().url()); return r.fulfill({ json: {} }); });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, whole: true, can_delete: true } });
      if (body.action === 'photos') return r.fulfill({ json: { month: body.month, days: { [DAY]: [{ id: 'A1', name: 'A1.jpg', taken_at: `${DAY}T01:00:00Z`, approx: false }] }, truncated: false } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route('**/__phone/**', r => {
      const u = new URL(r.request().url());
      state.phoneReads.push(u.pathname.replace(/^.*__phone\//, '') + u.search);
      if (u.pathname.endsWith('/page')) {
        const before = Number(u.searchParams.get('before')) || Infinity;
        const list = phone.filter(m => Date.parse(m.taken_at) < before).sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at));
        return r.fulfill({ json: { items: list, next: null, total: list.length } });
      }
      if (u.pathname.includes('/thumb/')) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      return r.fulfill({ status: 404, body: '' });
    });
    await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
    await expect(page.locator('#calendarView')).toBeVisible();
    await page.locator('#calendarView .schedule-switch [data-view="diary"]').click();
    await expect(page.locator('#diaryView')).toBeVisible();
    await page.locator(`#diaryRoot [data-diary-day="${DAY}"]`).click();
    const grid = page.locator('#diaryRoot [data-diary-grid]');
    await expect.poll(() => grid.locator('.diary-photo').evaluateAll(els => els.map(e => e.dataset.diaryPhoto))).toEqual(['od:A1', 'ph:7']);
    // 그날 끝(서울) 앞에서 읽는다.
    expect(state.phoneReads.some(p => p.includes('/page?') && p.includes(`before=${Date.parse('2026-10-05T15:00:00Z')}`))).toBe(true);
    // 크게 보기: 폰 사진 출처는 '폰', 지우기는 없음(사진 메뉴에서).
    await grid.locator('[data-diary-open="1"]').click();
    await expect(page.locator('[data-diary-viewer]')).toBeVisible();
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
});
