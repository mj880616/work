import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { ANDROID, phonePhotosFixture, openPhotos as openPhonePhotos } from './helpers/phone-photos-fixture.mjs';
import { head, srcPick, srcRow, openSrcMenu, pickSource, moreBtn, openHeadMenu, sizeBtn } from './helpers/photo-head.mjs';
// S71-25 PHOTO-머리한줄(사용자 결정 11/26, 시안 확정)·PHOTO-정리삭제(사용자 결정: 정리 기능 삭제).
// - 사진 위쪽은 맨 위 줄 하나: [W] 사진 · [사진 ▾] · [전체 ▾] …… 순서 · 가져올 곳 · 찾기 · ⋯ (폰 390·폴드 690·PC 1280). 화면 안 도구 줄 없음.
// - 가져올 곳 = 단추 하나(켠 곳 아이콘) → 원드라이브·구글 드라이브·폰 폴더 고르기(예전 큰 단추 셋과 같은 켜고 끄기, 서버 저장).
// - 순서 = 작은 아이콘 단추(aria-label에 지금 순서) → 순서 고르기 그대로.
// - ⋯ 안 = 크기 [－][＋](눌러도 메뉴가 닫히지 않음).
// - [정리] 단추·칸(사진 확인 중 상자 포함)은 없다.
// 지어낸 서버(onedrive-photos·gdrive-photos·app_photo_tags·app_my_features), 네트워크 없음.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const OD = [
  { id: 'O1', name: 'a.jpg', day: '2026-10-30', taken_at: '2026-10-30T03:00:00.000Z' },
  { id: 'O2', name: 'b.jpg', day: '2026-10-02', taken_at: '2026-10-02T03:00:00.000Z' },
].map(m => ({ ...m, approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: m.taken_at, size_bytes: 100 }));

async function webFixture(page, width) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  const server = await installViewPrefsServer(page, { photo_sources_pc: { onedrive: true, gdrive: true } });
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tag_items', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_my_features', r => r.fulfill({ json: ['gdrive_photos'] }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true, whole: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'library') return r.fulfill({ json: { items: body.folder_id ? [] : OD, next_cursor: null, indexing: false } });
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': OD.length }, total: OD.length } });
      if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: OD.length, total: OD.length, enabled: true }, folders: [], indexing: false, whole: true } });
      if (body.action === 'trash-list') return r.fulfill({ json: { items: [], truncated: false } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/gdrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'status') return r.fulfill({ json: { ok: true, connected: true, scope: true, folders_on: 0 } });
      if (body.action === 'folders') return r.fulfill({ json: { ok: true, parent: 'root', name: '', up: null, folders: [], complete: true } });
      return r.fulfill({ json: { ok: true, items: [], more: false } });
    });
  } });
  return { errors, server };
}
async function openWebPhotos(page, width) {
  if (width <= 760) {
    if (await page.locator('.mobile-tabs [data-view="photos"]').isVisible()) await page.locator('.mobile-tabs [data-view="photos"]').click();
    else { await page.locator('#mobileMenuTab').click(); await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click(); }
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
  await expect(srcPick(page)).toBeVisible();
}
// 맨 위 줄 모양: 보이는 칸마다 위·아래·왼쪽·이름. 줄 = 폰은 앱 머리 줄, PC는 상단 줄.
const lineShape = page => page.evaluate(() => {
  const box = document.querySelector('[data-sf-tools="photos"]');
  const line = box.closest('.mobile-shell-header, .app-topline, [data-screen-tools="line"]');
  const lr = line.getBoundingClientRect();
  const seen = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 1 && r.height > 1; };
  const name = el => el.matches('[data-photos-view]') ? 'view' : el.matches('[data-photos-filter]') ? 'filter' : el.matches('[data-photos-sort]') ? 'sort'
    : el.matches('[data-photos-src-pick]') ? 'src' : el.matches('[data-photos-head-more]') ? 'more' : el.matches('.mobile-shell-find, .gs-top-field, #gsTopInput') ? 'find' : el.matches('[data-mobile-view-name]') ? 'title' : '';
  const parts = [...line.querySelectorAll('[data-photos-view],[data-photos-filter],[data-photos-sort],[data-photos-src-pick],[data-photos-head-more],.mobile-shell-find,[data-mobile-view-name]')]
    .filter(seen).map(el => { const r = el.getBoundingClientRect(); return { n: name(el), l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), mid: Math.round((r.top + r.bottom) / 2) }; });
  const root = document.getElementById('photosRoot');
  return { parts, lineTop: Math.round(lr.top), lineBottom: Math.round(lr.bottom), lineHeight: Math.round(lr.height), vw: document.documentElement.clientWidth,
    toolsInRoot: !!root.querySelector('[data-photos-tools],[data-photos-bar],[data-photos-sort],[data-photo-size]'),
    tidy: document.querySelectorAll('[data-photos-tidy-chip],[data-photos-tidy],.photos-tidy').length,
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});

for (const width of [390, 690, 1280]) {
  test(`사진 위쪽 한 줄: [사진 ▾][전체 ▾] … 순서 · 가져올 곳 · (찾기) · ⋯, 화면 안 도구 줄 없음 ${width}`, async ({ page }) => {
    const f = await webFixture(page, width);
    await openWebPhotos(page, width);
    await expect(page.locator('#photosRoot [data-photos-open]').first()).toBeVisible();
    const s = await lineShape(page);
    const by = Object.fromEntries(s.parts.map(p => [p.n, p]));
    for (const n of ['view', 'filter', 'sort', 'src', 'more']) expect(by[n], `${n} 보임`).toBeTruthy();
    // 모두 한 줄: 가운데 높이가 같고(±3px) 줄 안·화면 안.
    const mids = s.parts.map(p => p.mid);
    expect(Math.max(...mids) - Math.min(...mids), JSON.stringify(s.parts)).toBeLessThanOrEqual(3);
    for (const p of s.parts) { expect(p.r, `${p.n} 화면 안`).toBeLessThanOrEqual(s.vw); expect(p.t).toBeGreaterThanOrEqual(s.lineTop - 1); expect(p.b).toBeLessThanOrEqual(s.lineBottom + 1); }
    expect(s.scrollX, '가로로 넘치지 않음').toBeLessThanOrEqual(0);
    // 차례: 사진 ▾ < 전체 ▾ < 순서 < 가져올 곳 < ⋯ (폰·폴드는 찾기가 가져올 곳과 ⋯ 사이).
    expect(by.view.l).toBeLessThan(by.filter.l);
    expect(by.filter.r).toBeLessThanOrEqual(by.sort.l);
    expect(by.sort.r).toBeLessThanOrEqual(by.src.l);
    expect(by.src.r).toBeLessThanOrEqual(by.more.l);
    if (width <= 760) {
      expect(by.title.r, '화면 이름 다음에 [사진 ▾]').toBeLessThanOrEqual(by.view.l);
      expect(by.find, '찾기 보임').toBeTruthy();
      expect(by.src.r).toBeLessThanOrEqual(by.find.l);
      expect(by.find.r).toBeLessThanOrEqual(by.more.l);
      // 줄 높이 하나(앱 머리 줄이 두 줄로 늘지 않음).
      expect(s.lineHeight).toBeLessThanOrEqual(56);
    }
    // 아이콘 단추는 32px(다른 화면 머리 줄 ⋯·[+]와 같음).
    for (const n of ['sort', 'more']) { expect(by[n].r - by[n].l).toBe(32); expect(by[n].b - by[n].t).toBe(32); }
    // 화면 안 예전 도구 줄([사진 ▾][정리][전체 ▾][찍은 날 ↓ ▾][－|＋])과 [정리] 칸은 없다.
    expect(s.toolsInRoot).toBe(false);
    expect(s.tidy).toBe(0);
    await expect(head(page).getByRole('button', { name: /정리/ })).toHaveCount(0);
    // 순서 단추: 글자 없는 아이콘, aria-label에 지금 순서. 눌러 다른 순서를 고르면 이름이 바뀐다(서버 저장).
    const sort = head(page).locator('[data-photos-sort]');
    await expect(sort).toHaveAttribute('aria-label', '순서: 찍은 날 최근 먼저');
    await expect(sort).toHaveText('');
    await sort.click();
    await expect(page.locator('#photosSortMenu')).toBeVisible();
    await page.locator('#photosSortMenu [data-sort-pick="taken_asc"]').click();
    await expect(sort).toHaveAttribute('aria-label', '순서: 찍은 날 오래된 먼저');
    await expect.poll(() => f.server.value?.photo_view?.sort).toBe('taken_asc');
    // 달력은 순서·⋯가 없고 거르기만.
    await head(page).locator('[data-photos-view]').selectOption('calendar');
    await expect(sort).toBeHidden();
    await expect(moreBtn(page)).toBeHidden();
    await expect(head(page).locator('[data-photos-filter]')).toBeVisible();
    expect(f.errors).toEqual([]);
  });
}

test('가져올 곳 단추 하나: 켠 곳 아이콘, 누르면 원드라이브·구글 드라이브 고르기 — 끄고 켜기가 예전 큰 단추와 같고 서버에 저장 1280', async ({ page }) => {
  const f = await webFixture(page, 1280);
  await openWebPhotos(page, 1280);
  await expect(srcPick(page)).toHaveAttribute('aria-label', '가져올 곳: 원드라이브·구글 드라이브');
  await expect(srcPick(page).locator('[data-photos-src-now] svg')).toHaveCount(2);
  await openSrcMenu(page);
  await expect(srcRow(page, 'onedrive')).toHaveAttribute('aria-pressed', 'true');
  await expect(srcRow(page, 'gdrive')).toHaveAttribute('aria-pressed', 'true');
  await expect(srcRow(page, 'phone')).toHaveCount(0); // 폰 폴더는 폰 앱에서만
  await srcRow(page, 'gdrive').click();
  await expect(page.locator('#photosSrcMenu')).toBeHidden();
  await expect(srcPick(page)).toHaveAttribute('aria-label', '가져올 곳: 원드라이브');
  await expect.poll(() => f.server.value?.photo_sources_pc?.gdrive).toBe(false);
  await pickSource(page, 'onedrive');
  await expect(srcPick(page)).toHaveAttribute('aria-label', '가져올 곳: 없음');
  await expect(page.locator('#photosRoot [data-photos-no-source]')).toBeVisible();
  await pickSource(page, 'onedrive');
  await expect(srcPick(page)).toHaveAttribute('aria-label', '가져올 곳: 원드라이브');
  await expect(page.locator('#photosRoot [data-photos-open]').first()).toBeVisible();
  // 원드라이브가 연결돼 있으면 메뉴 맨 아래 [원드라이브 연결 설정] → 연결 메뉴(예전 아이콘 꾹 누르기·우클릭).
  await openSrcMenu(page);
  await page.locator('#photosSrcMenu [data-photos-src-od]').click();
  await expect(page.locator('#photosOdMenu')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(f.errors).toEqual([]);
});

test.describe('폰 앱 412 · 가져올 곳 세 곳 · ⋯ 크기 · 정리 없음', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });
  const ids = page => page.locator('#photosRoot [data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));

  test('가져올 곳으로 원드라이브·폰 폴더 끄고 켜기, ⋯ 안 [－][＋](메뉴 그대로), [정리] 단추·칸·사진 확인 중 상자 없음', async ({ page }) => {
    const { state, prefs } = await phonePhotosFixture(page, { app: true });
    await openPhonePhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1', 'ph:2', 'O2', 'O3', 'ph:4']);
    await expect(srcPick(page)).toHaveAttribute('aria-label', '가져올 곳: 원드라이브·폰 폴더');
    // 세 곳이 메뉴 줄(구글 드라이브는 이 계정에 기능이 없어 줄이 없음 — 예전 단추와 같은 규칙).
    await openSrcMenu(page);
    await expect(srcRow(page, 'onedrive')).toHaveAttribute('aria-pressed', 'true');
    await expect(srcRow(page, 'phone')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    // 원드라이브 끄기 → 폰 사진만.
    await pickSource(page, 'onedrive');
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'ph:2', 'ph:9', 'ph:4']);
    await expect(srcPick(page)).toHaveAttribute('aria-label', '가져올 곳: 폰 폴더');
    await expect.poll(() => prefs.value?.photo_sources_phone?.onedrive).toBe(false);
    // 폰 폴더 끄고 원드라이브 켜기 → 원드라이브 사진만.
    await pickSource(page, 'phone');
    await pickSource(page, 'onedrive');
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'O3']);
    await expect(srcPick(page)).toHaveAttribute('aria-label', '가져올 곳: 원드라이브');
    await pickSource(page, 'phone');
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1', 'ph:2', 'O2', 'O3', 'ph:4']);
    // ⋯ 안 크기: [＋] 한 번 = 한 줄 칸 하나 줄임, 메뉴는 열린 채. [－]로 돌아옴.
    const grid = page.locator('#photosRoot [data-diary-grid]').first();
    const cols = () => grid.evaluate(g => getComputedStyle(g).getPropertyValue('--photo-cols').trim());
    const before = await cols();
    await openHeadMenu(page);
    await expect(sizeBtn(page, '-1')).toBeVisible();
    await expect(sizeBtn(page, '1')).toBeVisible();
    await sizeBtn(page, '1').click();
    await expect(page.locator('#photosHeadMenu')).toBeVisible();
    await expect.poll(cols).toBe(String(Number(before) - 1));
    await sizeBtn(page, '-1').click();
    await expect.poll(cols).toBe(before);
    await expect(page.locator('#photosHeadMenu')).not.toContainText('정리');
    await page.keyboard.press('Escape');
    await expect(page.locator('#photosHeadMenu')).toBeHidden();
    // 폰 앱 + 폰 사진이어도 [정리] 칩·칸·'사진 확인 중' 상자는 없다.
    await expect(page.locator('[data-photos-tidy-chip], [data-photos-tidy], .photos-tidy')).toHaveCount(0);
    await expect(page.locator('#photosView')).not.toContainText('사진 확인 중');
    await expect(head(page)).not.toContainText('정리');
    // 정리 찾기가 하던 폰 사진 전체 읽기(쪽 200장)·사진 지운 기록 확인(trash-watch)이 없다.
    expect(state.edge).not.toContain('trash-watch');
    expect(state.errors).toEqual([]);
  });
});
