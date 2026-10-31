import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S46-24 ④ 사진 화면 구글 드라이브 칸(지어낸 서버: app_my_features·gdrive-photos·onedrive-photos, 네트워크 없음, 그림은 1×1).
// - 운영자 기능(gdrive_photos)이 없는 작업공간: 구글 드라이브 칩이 없고 gdrive-photos를 부르지 않는다.
// - PC 1440: 칩 켜기(서버 view_prefs) → [폴더] '구글 드라이브' 묶음에서 폴더 스위치 켜기(folder-toggle) → [사진]에 찍은 날 순서로 섞임
//   (원드라이브와 같은 사진은 한 장, 출처 표시) → 사진 우클릭 ⋯ [지우기] → 확인 창(드라이브 휴지통 30일 안내) → 그때만 trash(confirm:true).
// - 폰 412: 권한 없음(scope:false)·연결 풀림(424 drive_auth_expired)이면 칩 빨간 점 + '권한 없음 · [Drive 다시 연결]' + 작은 이유 글.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const OD = [
  { id: 'O1', name: 'a.jpg', day: '2026-10-30', taken_at: '2026-10-30T03:00:00.000Z', size_bytes: 111 },
  { id: 'O2', name: 'b.jpg', day: '2026-10-28', taken_at: '2026-10-28T03:00:00.000Z', size_bytes: 222 },
  { id: 'O3', name: 'c.jpg', day: '2026-10-26', taken_at: '2026-10-26T03:00:00.000Z', size_bytes: 333 },
].map(m => ({ ...m, approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: m.taken_at }));
// 구글 드라이브 GF1 폴더: G1(10/31), G2(10/30, 원드라이브 O1과 같은 사진), G3(10/27).
const GD = [
  { id: 'G1', folder: 'GF1', name: 'IMG_1.jpg', day: '2026-10-31', taken_at: '2026-10-31T03:00:00+00:00', size_bytes: 10 },
  { id: 'G2', folder: 'GF1', name: 'a.jpg', day: '2026-10-30', taken_at: '2026-10-30T03:00:00+00:00', size_bytes: 111 },
  { id: 'G3', folder: 'GF1', name: 'IMG_3.jpg', day: '2026-10-27', taken_at: '2026-10-27T03:00:00+00:00', size_bytes: 30 },
].map(m => ({ ...m, video: false, approx: false }));

async function fixture(page, { features = ['calls', 'gdrive_photos'], status = { ok: true, scope: true, folders_on: 0, synced_at: null }, statusCode = 200, prefs = null } = {}) {
  const state = { errors: [], gd: [], od: [], folders: { root: [{ id: 'GF1', name: '카메라 백업', enabled: false }, { id: 'GF2', name: '업무', enabled: false }], GF1: [{ id: 'GF11', name: '2026', enabled: false }] }, photos: GD.slice() };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  const server = await installViewPrefsServer(page, prefs);
  const on = () => new Set(Object.values(state.folders).flat().filter(f => f.enabled).map(f => f.id));
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_my_features', r => r.fulfill({ json: features }));
    await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      state.od.push(body.action);
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true, whole: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'library') return r.fulfill({ json: { items: body.folder_id ? [] : OD, next_cursor: null, indexing: false } });
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': OD.length }, total: OD.length } });
      if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: OD.length, total: OD.length, enabled: true }, folders: [], indexing: false, whole: true } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/gdrive-photos', async r => {
      const body = r.request().postDataJSON();
      state.gd.push(body);
      if (body.action === 'status') return r.fulfill({ status: statusCode, json: status });
      if (body.action === 'thumb') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'sync') return r.fulfill({ json: { ok: true, photos: 0, partial: 0 } });
      if (body.action === 'folders') {
        const parent = body.parent || 'root';
        return r.fulfill({ json: { ok: true, parent, name: parent === 'root' ? '' : '카메라 백업', up: null, folders: state.folders[parent] || [], complete: true } });
      }
      if (body.action === 'folder-toggle') {
        for (const f of Object.values(state.folders).flat()) if (f.id === body.id) f.enabled = body.enabled;
        return r.fulfill({ json: { ok: true, id: body.id, enabled: body.enabled, indexed: state.photos.filter(p => p.folder === body.id).length, complete: true } });
      }
      if (body.action === 'list') {
        const ids = on();
        const list = state.photos.filter(p => ids.has(p.folder)).sort((a, b) => b.taken_at.localeCompare(a.taken_at));
        return r.fulfill({ json: { ok: true, items: list.slice(0, body.limit || 120), more: false } });
      }
      if (body.action === 'trash') {
        if (body.confirm !== true) return r.fulfill({ status: 400, json: { ok: false, error: 'confirm_required' } });
        state.photos = state.photos.filter(p => !body.ids.includes(p.id));
        return r.fulfill({ json: { ok: true, trashed: body.ids, failed: [], note: '드라이브 휴지통에서 30일 안에 되살릴 수 있어요' } });
      }
      return r.fulfill({ status: 400, json: { ok: false, error: 'action_invalid' } });
    });
  } });
  return { state, server };
}
async function openPhotos(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const ids = page => page.locator('#photosRoot [data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));
const gdBtn = page => page.locator('#photosRoot [data-photos-src="gdrive"]');

test.describe('PC 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('운영자 기능이 없는 작업공간: 구글 드라이브 칩 없음, gdrive-photos를 부르지 않음', async ({ page }) => {
    const { state } = await fixture(page, { features: ['calls'] });
    await openPhotos(page, 1440);
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'O3']);
    await expect(gdBtn(page)).toBeHidden();
    expect(state.gd).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('칩 켜기 → 폴더 스위치 켜기 → 사진에 섞임(같은 사진 한 장) → ⋯ 지우기는 확인 창 뒤에만 드라이브 휴지통으로', async ({ page }) => {
    const { state, server } = await fixture(page);
    await openPhotos(page, 1440);
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'O3']);
    await expect(gdBtn(page)).toBeVisible();
    await expect(gdBtn(page)).toHaveAttribute('aria-pressed', 'false');
    await gdBtn(page).click();
    await expect(gdBtn(page)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => server.patches.at(-1)?.photo_sources?.gdrive).toBe(true);
    // [폴더]: '구글 드라이브' 묶음, 맨 위 층 폴더(처음엔 꺼짐) → 스위치 켜기.
    await page.locator('#photosRoot [data-photos-tab="folders"]').click();
    const bodyEl = page.locator('#photosRoot [data-photos-body]');
    await expect(bodyEl.locator('[data-photos-fx-group="gdrive"]')).toHaveText('구글 드라이브');
    await expect(bodyEl.locator('[data-photos-gf-open]')).toHaveText(['📁카메라 백업', '📁업무']);
    const sw = bodyEl.locator('[data-photos-gf-sw="GF1"]');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(bodyEl.locator('[data-photos-gf-sw="GF1"]')).toHaveAttribute('aria-checked', 'true');
    expect(state.gd.find(b => b.action === 'folder-toggle')).toEqual({ action: 'folder-toggle', id: 'GF1', enabled: true });
    // 폴더 안으로: 하위 폴더 줄과 그 폴더 사진.
    await bodyEl.locator('[data-photos-gf-open="GF1"]').click();
    await expect(bodyEl.locator('[data-photos-gd-folder] .photos-fx-here')).toContainText('카메라 백업');
    await expect(bodyEl.locator('[data-photos-gf-open="GF11"]')).toBeVisible();
    await expect.poll(() => bodyEl.locator('[data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId))).toEqual(['gd:G1', 'gd:G2', 'gd:G3']);
    // [사진]: 찍은 날 순서로 섞이고 G2(원드라이브 O1과 같은 사진)는 빠짐, 출처 표시.
    await page.locator('#photosRoot [data-photos-tab="all"]').click();
    await expect.poll(() => ids(page)).toEqual(['gd:G1', 'O1', 'O2', 'gd:G3', 'O3']);
    await expect(page.locator('#photosRoot [data-photos-id="gd:G1"] .photos-src-mark')).toHaveAttribute('data-src', 'gdrive');
    await expect(page.locator('#photosRoot [data-photos-id="gd:G1"] .diary-photo')).toHaveAttribute('data-img-state', 'shown');
    expect(state.gd.some(b => b.action === 'thumb' && b.id === 'G1' && b.size === 'small')).toBe(true);
    // 사진 우클릭 ⋯: 이름 바꾸기·옮기기·지우기(앨범 없음).
    await page.locator('#photosRoot [data-photos-id="gd:G1"]').click({ button: 'right' });
    const menu = page.locator('#photosPhotoMenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('button')).toHaveText(['선택', '이름 바꾸기…', '폴더로 옮기기…', '지우기']);
    await menu.getByRole('button', { name: '지우기' }).click();
    const ask = page.locator('.kptu-ask');
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('구글 드라이브 사진 1장을 지울까요?');
    await expect(ask).toContainText('드라이브 휴지통에서 30일 안에 되살릴 수 있어요');
    expect(state.gd.some(b => b.action === 'trash')).toBe(false);
    await ask.getByRole('button', { name: '드라이브 휴지통으로' }).click();
    await expect.poll(() => state.gd.find(b => b.action === 'trash')).toEqual({ action: 'trash', ids: ['G1'], confirm: true });
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'gd:G3', 'O3']);
    expect(state.errors).toEqual([]);
  });
});

test.describe('폰 412', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  for (const c of [
    { name: '권한 없음(scope:false)', status: { ok: true, scope: false, folders_on: 0, synced_at: null }, statusCode: 200, code: 'scope_missing' },
    { name: '연결 풀림(424)', status: { ok: false, error: 'drive_auth_expired' }, statusCode: 424, code: 'drive_auth_expired' },
  ]) {
    test(`구글 드라이브 ${c.name}: 칩 빨간 점 + '권한 없음 · [Drive 다시 연결]' + 이유 글, 사진 목록은 부르지 않음`, async ({ page }) => {
      const { state } = await fixture(page, { status: c.status, statusCode: c.statusCode, prefs: { photo_sources: { onedrive: true, gdrive: true, phone: true } } });
      await openPhotos(page, 412);
      await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'O3']);
      await expect(gdBtn(page)).toBeVisible();
      await expect(gdBtn(page)).toHaveAttribute('data-problem', c.code);
      await expect(gdBtn(page)).toHaveAttribute('aria-label', '구글 드라이브 · 권한 없음');
      const noteEl = page.locator('#photosRoot [data-photos-gd-note]');
      await expect(noteEl).toContainText('권한 없음');
      await expect(noteEl.getByRole('button', { name: 'Drive 다시 연결' })).toBeVisible();
      await expect(noteEl.locator('.photos-gd-why')).toContainText(`(${c.code})`);
      // 칩을 누르면 이유 + [Drive 다시 연결] 작은 메뉴.
      await gdBtn(page).click();
      const menu = page.locator('#photosGdMenu');
      await expect(menu).toBeVisible();
      await expect(menu).toContainText(`(${c.code})`);
      await expect(menu.getByRole('button', { name: 'Drive 다시 연결' })).toBeVisible();
      expect(state.gd.map(b => b.action)).toEqual(['status']);
      expect(state.errors).toEqual([]);
    });
  }
});
