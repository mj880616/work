import { test, expect } from '@playwright/test';
import { srcPick, srcRow, openSrcMenu, pickSource } from './helpers/photo-head.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { treeEnter } from './helpers/tree-enter.mjs';
import { screenFind } from './helpers/screen-find.mjs';
// S46-24 ④ 사진 화면 구글 드라이브 칸(지어낸 서버: app_my_features·gdrive-photos·onedrive-photos, 네트워크 없음, 그림은 1×1).
// - S62-11: 운영자 기능(gdrive_photos)이 없는 작업공간도 칩이 보이고, Drive 연결 전이면 '연결 전 · [연결]'.
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

async function fixture(page, { features = ['calls', 'gdrive_photos'], status = { ok: true, scope: true, folders_on: 0, synced_at: null }, statusCode = 200, prefs = null, counts = true, od = true, content = null } = {}) {
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
      if (body.action === 'status') return r.fulfill({ json: od ? { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true, whole: true } : { configured: true, connected: false } });
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
      // S71-21 사진 설명 색인: 지어낸 서버는 찾는 글 → 걸린 드라이브 파일 id만 돌려준다(설명 글 없음). 기능 키가 없으면 403.
      if (body.action === 'content-find') {
        if (!features.includes('photo_content')) return r.fulfill({ status: 403, json: { ok: false, error: 'feature_off' } });
        return r.fulfill({ json: { ok: true, index: true, ids: (content && content[body.q]) || [], more: false } });
      }
      if (body.action === 'sync') return r.fulfill({ json: { ok: true, photos: 0, partial: 0 } });
      if (body.action === 'folders') {
        const parent = body.parent || 'root';
        // 서버 새 판: 켠 폴더는 색인 장수(count), 끈 폴더 null, total = 켠 폴더 전체. counts:false = 옛 서버(장수 없음).
        const n = id => state.photos.filter(p => p.folder === id).length;
        const folders = (state.folders[parent] || []).map(f => (counts ? { ...f, count: f.enabled ? n(f.id) : null } : { ...f }));
        const total = [...on()].reduce((a, id) => a + n(id), 0);
        return r.fulfill({ json: { ok: true, parent, name: parent === 'root' ? '' : '카메라 백업', up: null, folders, complete: true, ...(counts ? { total } : {}) } });
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
    // S68-37: 저장된 메뉴 순서가 없는 계정은 [사진]이 기본 하단바 칸, 순서를 저장한 계정은 [메뉴] 창 칸이다.
    if (await page.locator('.mobile-tabs [data-view="photos"]').isVisible()) await page.locator('.mobile-tabs [data-view="photos"]').click();
    else { await page.locator('#mobileMenuTab').click(); await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click(); }
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const ids = page => page.locator('#photosRoot [data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));
// S71-25 PHOTO-머리한줄: 구글 드라이브는 맨 위 줄 [가져올 곳] 단추 → 고르기 메뉴(#photosSrcMenu)의 한 줄. 문제 점은 [가져올 곳] 단추에.
const gdBtn = page => srcRow(page, 'gdrive');
// 메뉴를 열어 구글 드라이브 줄을 본 뒤(검사) 닫는다.
async function gdCheck(page, fn) { await openSrcMenu(page); await fn(gdBtn(page)); await page.keyboard.press('Escape'); await expect(page.locator('#photosSrcMenu')).toBeHidden(); }
// S46-29: 문제 표시 점(::before)은 10px 이하, 단추의 누르는 영역(::after)은 높이 44px 이상. 두 가상 요소가 겹치면 점이 44px 원이 된다.
const gdMarks = page => srcPick(page).evaluate(b => {
  const d = getComputedStyle(b, '::before'), a = getComputedStyle(b, '::after');
  return { dot: [d.content, parseFloat(d.width), parseFloat(d.height)], hit: [a.content, parseFloat(a.width), parseFloat(a.height), a.backgroundColor] };
});
async function expectSmallDot(page) {
  await expect(srcPick(page)).toHaveAttribute('data-problem', '');
  const m = await gdMarks(page);
  expect(m.dot[0]).not.toBe('none');
  expect(m.dot[1]).toBeLessThanOrEqual(10);
  expect(m.dot[2]).toBeLessThanOrEqual(10);
  expect(m.hit[0]).not.toBe('none');
  expect(m.hit[1]).toBeGreaterThanOrEqual(32);
  expect(m.hit[2]).toBeGreaterThanOrEqual(44);
  expect(m.hit[3]).toBe('rgba(0, 0, 0, 0)');
}

test.describe('PC 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // S62-11 MULTI-구글드라이브사진모두: 칩은 기능 키와 상관없이 모두에게. Drive 연결 전이면(서버 424 drive_not_connected) '연결 전' + [연결] 한 줄.
  test('운영자 기능이 없는 새 작업공간(Drive 연결 전): 칩 보임 · 연결 전, 켜면 [연결] 한 줄, 사진 목록은 부르지 않음', async ({ page }) => {
    const { state } = await fixture(page, { features: [], status: { ok: false, error: 'drive_not_connected' }, statusCode: 424, prefs: { photo_sources_pc: { onedrive: true, gdrive: true, phone: true } } });
    await openPhotos(page, 1440);
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'O3']);
    await gdCheck(page, async b => {
      await expect(b).toBeVisible();
      await expect(b).toHaveAttribute('data-problem', 'drive_not_connected');
      await expect(b).toHaveAttribute('aria-label', '구글 드라이브 · 연결 전');
    });
    const noteEl = page.locator('#photosRoot [data-photos-gd-note]');
    await expect(noteEl).toContainText('구글 드라이브 연결 뒤 쓸 수 있어요');
    await expect(noteEl.getByRole('button', { name: '구글 드라이브 연결', exact: true })).toBeVisible();
    expect(state.gd.map(b => b.action)).toEqual(['status']);
    expect(state.errors).toEqual([]);
  });

  test('칩 켜기 → 폴더 스위치 켜기 → 사진에 섞임(같은 사진 한 장) → ⋯ 삭제는 확인 창 뒤에만 드라이브 휴지통으로', async ({ page }) => {
    const { state, server } = await fixture(page);
    await openPhotos(page, 1440);
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'O3']);
    await gdCheck(page, b => expect(b).toHaveAttribute('aria-pressed', 'false'));
    await pickSource(page, 'gdrive');
    await gdCheck(page, b => expect(b).toHaveAttribute('aria-pressed', 'true'));
    await expect.poll(() => server.patches.at(-1)?.photo_sources_pc?.gdrive).toBe(true);
    // [폴더]: 원드라이브와 같은 나무 — 맨 위 줄 '구글 드라이브 n', 맨 위 층 폴더(처음엔 꺼짐, 장수 '—') → 스위치 켜기.
    await page.locator('[data-sf-tools="photos"] [data-photos-view]').selectOption('folders');
    const bodyEl = page.locator('#photosRoot [data-photos-body]');
    await expect(bodyEl.locator('[data-photos-gf-open="root"] .ft-name')).toHaveText('구글 드라이브');
    await expect(bodyEl.locator('[data-photos-gf-open="root"] .ft-num')).toHaveText('0');
    await expect(bodyEl.locator('[data-photos-gf]:not([data-photos-gf="root"]) .ft-name')).toHaveText(['업무', '카메라 백업']); // 원드라이브와 같은 가나다순
    await expect(bodyEl.locator('[data-photos-gf]:not([data-photos-gf="root"]) .ft-num')).toHaveText(['—', '—']);
    const sw = bodyEl.locator('[data-photos-gf-sw="GF1"]');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(bodyEl.locator('[data-photos-gf-sw="GF1"]')).toHaveAttribute('aria-checked', 'true');
    expect(state.gd.find(b => b.action === 'folder-toggle')).toEqual({ action: 'folder-toggle', id: 'GF1', enabled: true });
    await expect(bodyEl.locator('[data-photos-gf="GF1"] .ft-num')).toHaveText('3');
    await expect(bodyEl.locator('[data-photos-gf-open="root"] .ft-num')).toHaveText('3');
    // 폴더를 누르면 나무는 그대로, 오른쪽 칸에 위치 줄·장수·그 폴더 사진, 나무에서 하위 폴더가 펼쳐짐.
    // S69-38 UI-탐색기나무누르기: 이름 누르기 = 그 폴더 열기 + 펼침(우클릭 [이 폴더로 들어가기]와 같은 곳), 오른쪽에 하위 폴더 줄.
    await treeEnter(bodyEl.locator('[data-photos-fx-tree] [data-photos-gf-open="GF1"]'));
    await expect(bodyEl.locator('[data-photos-fx-tree] [data-photos-gf="GF1"]')).toHaveClass(/ft-current/);
    await expect(bodyEl.locator('[data-photos-gd-folder] [data-photos-gf-open="GF11"]')).toBeVisible();
    await expect(bodyEl.locator('[data-photos-gd-folder] .photos-fx-path')).toContainText('구글 드라이브');
    await expect(bodyEl.locator('[data-photos-gd-folder] .photos-fx-here')).toContainText('카메라 백업 · 3장');
    await expect(bodyEl.locator('[data-photos-fx-tree] [data-photos-gf-open="GF11"]')).toBeVisible();
    await expect.poll(() => bodyEl.locator('[data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId))).toEqual(['gd:G1', 'gd:G2', 'gd:G3']);
    // [사진]: 찍은 날 순서로 섞이고 G2(원드라이브 O1과 같은 사진)는 빠짐, 출처 표시.
    await page.locator('[data-sf-tools="photos"] [data-photos-view]').selectOption('all');
    await expect.poll(() => ids(page)).toEqual(['gd:G1', 'O1', 'O2', 'gd:G3', 'O3']);
    await expect(page.locator('#photosRoot [data-photos-id="gd:G1"] .photos-src-mark')).toHaveAttribute('data-src', 'gdrive');
    await expect(page.locator('#photosRoot [data-photos-id="gd:G1"] .diary-photo')).toHaveAttribute('data-img-state', 'shown');
    expect(state.gd.some(b => b.action === 'thumb' && b.id === 'G1' && b.size === 'small')).toBe(true);
    // 사진 우클릭 ⋯: (S48-56 공유·일기에 넣기·업데이트로 보내기, 별표는 아직 없음) 이름 바꾸기·옮기기·정보수정(S50-31)·지우기(앨범 없음).
    await page.locator('#photosRoot [data-photos-id="gd:G1"]').click({ button: 'right' });
    const menu = page.locator('#photosPhotoMenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('button')).toHaveText(['선택', '공유', '하루 기록에 넣기', '업데이트로 보내기', '이름 바꾸기…', '폴더로 옮기기…', '정보수정', '삭제']);
    await menu.getByRole('button', { name: '삭제' }).click();
    const ask = page.locator('.kptu-ask');
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('구글 드라이브 사진 1장을 삭제할까요?');
    await expect(ask).toContainText('드라이브 휴지통에서 30일 안에 되살릴 수 있어요');
    expect(state.gd.some(b => b.action === 'trash')).toBe(false);
    await ask.getByRole('button', { name: '드라이브 휴지통으로' }).click();
    await expect.poll(() => state.gd.find(b => b.action === 'trash')).toEqual({ action: 'trash', ids: ['G1'], confirm: true });
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'gd:G3', 'O3']);
    expect(state.errors).toEqual([]);
  });
  test('구글 드라이브만: 원드라이브와 같은 나무 — ▸ 펼침(한 층씩 읽음)·장수·꺼진 폴더 흐림·오른쪽 칸(위치 줄·보임 여부·빈 폴더 안내)', async ({ page }) => {
    const { state } = await fixture(page, { od: false, prefs: { photo_sources_pc: { onedrive: false, gdrive: true, phone: false } } });
    state.folders.GF1[0].enabled = true; // 2026 폴더는 켜져 있고 사진이 없다
    await openPhotos(page, 1440);
    await page.locator('[data-sf-tools="photos"] [data-photos-view]').selectOption('folders');
    const bodyEl = page.locator('#photosRoot [data-photos-body]');
    const tree = bodyEl.locator('[data-photos-fx-tree]');
    // 처음엔 맨 위를 고른 채: 오른쪽 칸 '구글 드라이브 · n장'.
    await expect(tree.locator('[data-photos-gf="root"]')).toHaveClass(/ft-current/);
    await expect(bodyEl.locator('[data-photos-gd-folder] .photos-fx-here')).toHaveText('사진›구글 드라이브 · 0장'); // S69-90: 주소 줄 하나(위치 줄이 이 줄 안)
    await expect(tree.locator('[data-photos-gf="GF1"]')).toHaveClass(/is-off/);
    await expect(tree.locator('[data-photos-gf="GF1"] .ft-num')).toHaveText('—'); // S69-90: 개수는 공용 줄 개수 칸(작은 흐린 글씨, [파일]과 같음)
    expect(state.gd.filter(b => b.action === 'folders').map(b => b.parent)).toEqual(['root']);
    // ▸ 펼치기 = 그 층만 읽고 들여쓴 하위 폴더(장수 0, 흐림). 다시 누르면 접힘.
    await tree.locator('[data-photos-gf-tog="GF1"]').click();
    await expect(tree.locator('[data-photos-gf="GF11"]')).toBeVisible();
    await expect(tree.locator('[data-photos-gf="GF11"]')).toHaveAttribute('style', /--ft-depth:2/);
    await expect(tree.locator('[data-photos-gf="GF11"] .ft-num')).toHaveText('0');
    await expect(tree.locator('[data-photos-gf-tog="GF1"]')).toHaveAttribute('aria-expanded', 'true'); // S69-90: 공용 줄은 폴더 그림 단추가 펼침 상태를 가진다([파일]·노트 나무와 같음)
    expect(state.gd.filter(b => b.action === 'folders').map(b => b.parent)).toEqual(['root', 'GF1']);
    // 하위 폴더(켜짐, 사진 없음) → '이 폴더에 바로 든 사진이 없어요.'
    await tree.locator('[data-photos-gf="GF11"] .ft-name').click({ button: 'right' });
    await page.locator('#photosGdFolderMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
    await expect(bodyEl.locator('[data-photos-gd-folder] .photos-fx-path')).toHaveText(/사진›구글 드라이브›카메라 백업›2026/);
    await expect(bodyEl.locator('[data-photos-gd-folder] .photos-fx-here')).toContainText('2026 · 0장');
    await expect(bodyEl.locator('[data-photos-fx-foot]')).toHaveText('이 폴더에 바로 든 사진이 없어요.');
    // 꺼진 폴더 → '사진에 안 보임', 사진 칸 없음(색인이 없어 부르지 않음).
    await tree.locator('[data-photos-gf="GF2"] .ft-name').click({ button: 'right' });
    await page.locator('#photosGdFolderMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
    await expect(bodyEl.locator('[data-photos-gd-folder] .photos-fx-here')).toContainText('업무 · —장 · 사진에 안 보임');
    await expect(bodyEl.locator('[data-photos-gd-folder] [data-photos-open]')).toHaveCount(0);
    // 위치 줄 '구글 드라이브' = 맨 위 칸.
    await tree.locator('[data-photos-gf-tog="GF1"]').click();
    await expect(tree.locator('[data-photos-gf="GF11"]')).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });

  // S71-21 PHOTO-내용찾기 ②: '사진에서 찾기' = 이름 || 설명 색인(운영자 기능 photo_content만). 설명으로만 걸린 칸에 작은 '설명' 표시.
  test('사진 설명으로 찾기: 기능 키가 있으면 이름에 없는 낱말로도 걸리고 작은 표시, 이름으로 걸린 칸은 표시 없음', async ({ page }) => {
    const { state } = await fixture(page, { features: ['calls', 'gdrive_photos', 'photo_content'], prefs: { photo_sources_pc: { onedrive: true, gdrive: true, phone: false } },
      content: { '가상현수막': ['G3'], 'img': ['G3'] } });
    state.folders.root[0].enabled = true;
    await openPhotos(page, 1440);
    await expect.poll(() => ids(page)).toEqual(['gd:G1', 'O1', 'O2', 'gd:G3', 'O3']);
    const box = await screenFind(page);
    await box.fill('가상현수막');
    await expect.poll(() => ids(page)).toEqual(['gd:G3']);
    expect(state.gd.filter(b => b.action === 'content-find')).toEqual([{ action: 'content-find', q: '가상현수막' }]);
    const g3 = page.locator('#photosRoot [data-photos-id="gd:G3"]');
    await expect(g3.locator('[data-photos-content-mark]')).toHaveText('설명');
    await expect(g3.locator('[data-photos-content-mark]')).toHaveAttribute('title', '설명으로 찾음');
    await expect(g3).toHaveAttribute('aria-label', /, 설명으로 찾음$/);
    // 이름으로도 걸린 칸은 설명 색인에 있어도 표시 없음.
    await box.fill('img');
    await expect.poll(() => state.gd.filter(b => b.action === 'content-find').map(b => b.q)).toEqual(['가상현수막', 'img']);
    await expect.poll(() => ids(page)).toEqual(['gd:G1', 'gd:G3']);
    await expect(page.locator('#photosRoot [data-photos-content-mark]')).toHaveCount(0);
    await expect(g3).not.toHaveAttribute('aria-label', /설명으로 찾음/);
    // 지우면 전부, 표시 없음.
    await box.fill('');
    await expect.poll(() => ids(page)).toEqual(['gd:G1', 'O1', 'O2', 'gd:G3', 'O3']);
    await expect(page.locator('#photosRoot [data-photos-content-mark]')).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
  test('사진 설명으로 찾기: 기능 키가 없으면 서버에 묻지 않고 지금처럼 이름만', async ({ page }) => {
    const { state } = await fixture(page, { prefs: { photo_sources_pc: { onedrive: true, gdrive: true, phone: false } }, content: { '가상현수막': ['G3'] } });
    state.folders.root[0].enabled = true;
    await openPhotos(page, 1440);
    await expect.poll(() => ids(page)).toEqual(['gd:G1', 'O1', 'O2', 'gd:G3', 'O3']);
    const box = await screenFind(page);
    await box.fill('가상현수막');
    await expect.poll(() => ids(page)).toEqual([]);
    await page.waitForTimeout(700);
    expect(state.gd.some(b => b.action === 'content-find')).toBe(false);
    await expect(page.locator('#photosRoot [data-photos-content-mark]')).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
  test('옛 서버(장수 없음): 폴더·맨 위 장수는 —, 장수를 따로 부르지 않음', async ({ page }) => {
    const { state } = await fixture(page, { od: false, counts: false, prefs: { photo_sources_pc: { onedrive: false, gdrive: true, phone: false } } });
    state.folders.root[0].enabled = true;
    await openPhotos(page, 1440);
    await page.locator('[data-sf-tools="photos"] [data-photos-view]').selectOption('folders');
    const tree = page.locator('#photosRoot [data-photos-fx-tree]');
    await expect(tree.locator('[data-photos-gf="GF1"] .ft-num')).toHaveText('—');
    await expect(tree.locator('[data-photos-gf="root"] .ft-num')).toHaveText('—');
    expect(state.gd.map(b => b.action).filter(a => !['status', 'folders', 'sync', 'list', 'thumb'].includes(a))).toEqual([]);
    expect(state.errors).toEqual([]);
  });

});

test.describe('폰 412', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  for (const c of [
    { name: '권한 없음(scope:false)', status: { ok: true, scope: false, folders_on: 0, synced_at: null }, statusCode: 200, code: 'scope_missing' },
    { name: '연결 풀림(424)', status: { ok: false, error: 'drive_auth_expired' }, statusCode: 424, code: 'drive_auth_expired' },
  ]) {
    test(`구글 드라이브 ${c.name}: 칩 빨간 점 + '권한이 빠졌어요' + [구글 드라이브 다시 연결] + 이유 글, 사진 목록은 부르지 않음`, async ({ page }) => {
      const { state } = await fixture(page, { status: c.status, statusCode: c.statusCode, prefs: { photo_sources_pc: { onedrive: true, gdrive: true, phone: true } } });
      await openPhotos(page, 412);
      await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'O3']);
      await gdCheck(page, async b => {
        await expect(b).toBeVisible();
        await expect(b).toHaveAttribute('data-problem', c.code);
        await expect(b).toHaveAttribute('aria-label', '구글 드라이브 · 권한 없음');
      });
      await expectSmallDot(page);
      const noteEl = page.locator('#photosRoot [data-photos-gd-note]');
      await expect(noteEl).toContainText('권한이 빠졌어요');
      await expect(noteEl.getByRole('button', { name: '구글 드라이브 다시 연결' })).toBeVisible();
      await expect(noteEl.locator('.connect-note-why')).toContainText(`(${c.code})`);
      // 구글 드라이브 줄을 누르면 이유 + [Drive 다시 연결] 작은 메뉴.
      await pickSource(page, 'gdrive');
      const menu = page.locator('#photosGdMenu');
      await expect(menu).toBeVisible();
      await expect(menu).toContainText(`(${c.code})`);
      await expect(menu.getByRole('button', { name: '구글 드라이브 다시 연결' })).toBeVisible();
      expect(state.gd.map(b => b.action)).toEqual(['status']);
      expect(state.errors).toEqual([]);
    });
  }
  test('구글 드라이브 권한 없음: 사진·달력·폴더·앨범 탭 모두 칩 점은 작고(10px 이하) 누르는 영역은 44px 이상', async ({ page }) => {
    const { state } = await fixture(page, { status: { ok: true, scope: false, folders_on: 0, synced_at: null }, prefs: { photo_sources_pc: { onedrive: true, gdrive: true, phone: true } } });
    await openPhotos(page, 412);
    await gdCheck(page, b => expect(b).toHaveAttribute('data-problem', 'scope_missing'));
    for (const tab of ['all', 'calendar', 'folders', 'albums']) {
      await page.locator('[data-sf-tools="photos"] [data-photos-view]').selectOption(tab);
      await expect(page.locator('[data-sf-tools="photos"] [data-photos-view]')).toHaveValue(tab);
      await expect(srcPick(page)).toBeVisible();
      await expectSmallDot(page);
    }
    expect(state.errors).toEqual([]);
  });
  test('폰: 묶음 이름 ‘구글 드라이브 n’ + 폴더 줄(장수) → 들어가면 위치 줄·하위 폴더·사진, 뒤로가기 한 단계씩', async ({ page }) => {
    const { state } = await fixture(page, { od: false, prefs: { photo_sources_pc: { onedrive: false, gdrive: true, phone: false } } });
    state.folders.root[0].enabled = true;
    await openPhotos(page, 412);
    await page.locator('[data-sf-tools="photos"] [data-photos-view]').selectOption('folders');
    const bodyEl = page.locator('#photosRoot [data-photos-body]');
    // FOLDER-나무새기준 ③: 폰은 출처마다 상자(머리 = 이름, 오른쪽 전체 장수).
    await expect(bodyEl.locator('[data-photos-box="gdrive"] .ft-box-toggle')).toHaveText('구글 드라이브');
    await expect(bodyEl.locator('[data-photos-box="gdrive"] .ft-box-tail')).toHaveText('3');
    await expect(bodyEl.locator('[data-photos-gf] .ft-num')).toHaveText(['—', '3']); // 업무(꺼짐) · 카메라 백업(켬), 가나다순
    await bodyEl.locator('[data-photos-gf-open="GF1"]').click();
    // S51-24: 폰 '그 폴더만' = 상자 맨 위 위치 줄(위 단계만) + 그 폴더 줄(머리).
    await expect(bodyEl.locator('[data-photos-gd-folder] .photos-fx-path')).toHaveText('사진›구글 드라이브›');
    await expect(bodyEl.locator('[data-photos-gd-folder] .photos-fx-here')).toContainText('카메라 백업 · 3장');
    await expect(bodyEl.locator('[data-photos-gf-open="GF11"]')).toBeVisible();
    await expect.poll(() => bodyEl.locator('[data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId))).toEqual(['gd:G1', 'gd:G2', 'gd:G3']);
    await bodyEl.locator('[data-photos-gf-open="GF11"]').click();
    await expect(bodyEl.locator('[data-photos-gd-folder] .photos-fx-here')).toContainText('2026 · —장 · 사진에 안 보임');
    // 폴더 겹은 하나라 뒤로가기 한 번은 '한 단계 위'를 그린 뒤 라우터가 겹 칸으로 되돌아간다(history.go(+1), 비동기).
    // 그 되돌아가기가 끝나기 전에 다음 뒤로가기를 보내면 한 칸 아래(사진 탭 첫 화면)로 두 단계가 한꺼번에 빠진다 — 실제 손으로는 못 누르는 틈.
    // 그래서 겹 칸에 다시 선 것(주소 칸 번호)을 확인한 뒤 다음 뒤로가기를 누른다.
    const deep = await page.evaluate(() => navigation.currentEntry.index);
    await page.goBack();
    await expect(bodyEl.locator('[data-photos-gd-folder] .photos-fx-here')).toContainText('카메라 백업');
    await expect.poll(() => page.evaluate(() => navigation.currentEntry.index)).toBe(deep);
    await page.goBack();
    await expect(bodyEl.locator('[data-photos-box="gdrive"]')).toBeVisible();
    await expect(page.locator('#photosView')).toBeVisible();
    expect(state.errors).toEqual([]);
  });
});

// S62-11 MULTI-구글드라이브사진모두: 운영자 기능이 없는 새 작업공간도 폰 412·폴드 840·PC 1280에서 칩 '연결 전'·[연결] 한 줄, 메뉴에 [파일].
// 화면 사진은 SHOT_DIR=docs/design/screens/s62-11 로 돌릴 때만 남긴다(합성 값만).
for (const width of [412, 840, 1280]) {
  test(`새 작업공간 ${width}px: 구글 드라이브 칩 '연결 전' + [연결], 메뉴에 [파일]`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { state } = await fixture(page, { features: [], status: { ok: false, error: 'drive_not_connected' }, statusCode: 424, prefs: { photo_sources_pc: { onedrive: true, gdrive: true, phone: true } } });
    const files = width <= 760 ? page.locator('#mobileMenu nav').getByRole('button', { name: '파일', exact: true }) : page.locator('#appView>.app-nav').getByRole('link', { name: '파일', exact: true });
    if (width > 760) await expect(files).toBeVisible();
    await openPhotos(page, width);
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'O3']);
    await gdCheck(page, b => expect(b).toHaveAttribute('aria-label', '구글 드라이브 · 연결 전'));
    const noteEl = page.locator('#photosRoot [data-photos-gd-note]');
    await expect(noteEl.getByRole('button', { name: '구글 드라이브 연결', exact: true })).toBeVisible();
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/photos-new-${width}.png` });
    if (width <= 760) {
      await page.locator('#mobileMenuTab').click();
      await expect(files).toBeVisible();
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/menu-new-${width}.png` });
    }
    expect(state.gd.map(b => b.action)).toEqual(['status']);
    expect(state.errors).toEqual([]);
  });
}

// S62-36 UI-클라우드연결안내통일(명진 11/16): 원드라이브·구글 드라이브 둘 다 연결 전이면 [파일]과 같은 한 칸
// ('연결된 클라우드가 없어요.' + 아래 줄 [원드라이브 연결][구글 드라이브 연결]). 구글 드라이브 칩이 꺼져 있어도(PC 처음 기본값) 두 버튼,
// [구글 드라이브 연결]을 누르면 칩을 먼저 켜고(서버 view_prefs) drive-start로 간다. 화면 사진은 SHOT_DIR을 줄 때만.
for (const width of [412, 1280]) {
  test(`${width}px: 둘 다 연결 전이면 '연결된 클라우드가 없어요.' + 두 연결 버튼(파일 화면과 같은 칸)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { state, server } = await fixture(page, { od: false, status: { ok: false, error: 'drive_not_connected' }, statusCode: 424 });
    const starts = [];
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/public-policy-drive', r => { starts.push(r.request().postDataJSON()?.action); return r.fulfill({ status: 500, json: { error: 'test' } }); });
    await openPhotos(page, width);
    const body = page.locator('#photosRoot [data-photos-body]');
    const box = body.locator('[data-connect-cloud-none]');
    await expect(box).toHaveCount(1);
    await expect(box.locator('.connect-note-line')).toHaveText('연결된 클라우드가 없어요.');
    await expect(box.getByRole('button')).toHaveText(['원드라이브 연결', '구글 드라이브 연결']);
    await expect(body.locator('[data-connect-note]')).toHaveCount(1);
    await expect(body).not.toContainText('연결 뒤 쓸 수 있어요');
    const [l, b1, b2] = await Promise.all([box.locator('.connect-note-line').boundingBox(), box.getByRole('button').nth(0).boundingBox(), box.getByRole('button').nth(1).boundingBox()]);
    expect(b1.y).toBeGreaterThanOrEqual(l.y + l.height - 1);
    expect(Math.abs(b1.y - b2.y)).toBeLessThan(2);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/photos-none-${width}.png` });
    await box.getByRole('button', { name: '구글 드라이브 연결', exact: true }).click();
    await expect.poll(() => starts).toEqual(['drive-start']);
    await expect.poll(() => server.value?.photo_sources_pc?.gdrive).toBe(true);
    expect(state.errors).toEqual([]);
  });
}
