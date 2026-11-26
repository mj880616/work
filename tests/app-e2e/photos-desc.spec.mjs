import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { screenFind } from './helpers/screen-find.mjs';
// S71-62 PHOTO-찾기넓히기·설명(docs/design/standard-interactions.md Q6·E1). 지어낸 서버: gdrive-photos·app_my_features, 네트워크 없음, 그림 1×1.
// - Q6: 기능 키가 없는 사람도 '사진에서 찾기'가 drive-find(드라이브 글자 찾기)로 이름에 없는 낱말까지 찾는다. 걸린 칸에 작은 '설명' 표시.
// - E1: 크게 보기 [수정 ▾] '설명' → 아래 작은 칸(지금 설명 채워짐) + 자주 쓴 낱말 칩 → [저장](desc-set set) → 그림 밑 한 줄 + 바로 찾기에 걸림.
//       여러 장 선택 [메뉴] '설명 붙이기' → 같은 칸(desc-set add). 서버가 거절(남의 파일·목록 밖)하면 칸에 까닭 한 줄, 화면은 그대로.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const GD = [
  { id: 'G1', folder: 'GF1', name: 'sunset.jpg', day: '2026-10-31', taken_at: '2026-10-31T03:00:00+00:00', size_bytes: 10 },
  { id: 'G2', folder: 'GF1', name: 'IMG_2.jpg', day: '2026-10-30', taken_at: '2026-10-30T03:00:00+00:00', size_bytes: 20 },
  { id: 'G3', folder: 'GF1', name: 'IMG_3.jpg', day: '2026-10-27', taken_at: '2026-10-27T03:00:00+00:00', size_bytes: 30 },
].map(m => ({ ...m, video: false, approx: false }));

async function fixture(page, { drive = {}, words = ['가상바다', '가상산'], refuse = false } = {}) {
  const state = { errors: [], gd: [], desc: { G1: '', G2: '가상 앞설명', G3: '' } };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  const src = { onedrive: false, gdrive: true, phone: false };
  await installViewPrefsServer(page, { photo_sources_pc: src, photo_sources_phone: src });
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_my_features', r => r.fulfill({ json: ['gdrive_photos'] }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', r => {
      const body = r.request().postDataJSON();
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: false } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/gdrive-photos', r => {
      const body = r.request().postDataJSON();
      state.gd.push(body);
      const known = id => GD.some(p => p.id === id);
      switch (body.action) {
        case 'status': return r.fulfill({ json: { ok: true, scope: true, folders_on: 1, synced_at: null } });
        case 'sync': return r.fulfill({ json: { ok: true, photos: 0, partial: 0 } });
        case 'thumb': case 'media': return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
        case 'list': return r.fulfill({ json: { ok: true, items: GD, more: false } });
        case 'folders': return r.fulfill({ json: { ok: true, parent: 'root', name: '', up: null, folders: [{ id: 'GF1', name: '카메라 백업', enabled: true, count: 3 }], complete: true, total: 3 } });
        case 'content-find': return r.fulfill({ status: 403, json: { ok: false, error: 'feature_off' } });
        // 드라이브 글자 찾기: 지어낸 드라이브는 정해 둔 낱말만 안다(저장한 설명은 일부러 모름 — 화면이 바로 걸어야 한다).
        case 'drive-find': return r.fulfill({ json: { ok: true, ids: drive[body.q] || [], more: false } });
        case 'desc-get':
          if (!known(body.id)) return r.fulfill({ status: 404, json: { ok: false, error: 'photo_not_in_index' } });
          return r.fulfill({ json: { ok: true, id: body.id, description: state.desc[body.id] } });
        case 'desc-words': return r.fulfill({ json: { ok: true, words } });
        case 'desc-set': {
          if (body.confirm !== true) return r.fulfill({ status: 400, json: { ok: false, error: 'confirm_required' } });
          if (refuse || !body.ids.every(known)) return r.fulfill({ status: 404, json: { ok: false, error: 'photo_not_in_index' } });
          const done = body.ids.map(id => {
            state.desc[id] = body.mode === 'add' ? [state.desc[id], body.text].filter(Boolean).join(' ') : body.text;
            return { id, description: state.desc[id] };
          });
          return r.fulfill({ json: { ok: true, done, failed: [] } });
        }
        default: return r.fulfill({ status: 400, json: { ok: false, error: 'action_invalid' } });
      }
    });
  } });
  return state;
}
async function openPhotos(page, width) {
  if (width <= 760) {
    if (await page.locator('.mobile-tabs [data-view="photos"]').isVisible()) await page.locator('.mobile-tabs [data-view="photos"]').click();
    else { await page.locator('#mobileMenuTab').click(); await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click(); }
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const root = page => page.locator('#photosRoot');
const ids = page => root(page).locator('[data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));
const cell = (page, id) => root(page).locator(`[data-photos-list] [data-photos-id="${id}"]`);
const viewer = page => page.locator('#photosRoot [data-diary-viewer], body > [data-diary-viewer]').first();
const sheet = page => page.locator('#photoDescDialog');
async function hold(page, locator) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
}
const sets = state => state.gd.filter(b => b.action === 'desc-set');

for (const [label, width, height] of [['폰 390', 390, 844], ['PC 1280', 1280, 800]]) {
  test.describe(label, () => {
    test.use({ viewport: { width, height }, hasTouch: width < 761, isMobile: width < 761 });

    test('Q6 기능 키가 없어도 드라이브 글자 찾기로 이름에 없는 낱말까지 찾고, 걸린 칸에 작은 설명 표시', async ({ page }) => {
      const state = await fixture(page, { drive: { '가상현수막': ['G3'] } });
      await openPhotos(page, width);
      await expect.poll(() => ids(page)).toEqual(['gd:G1', 'gd:G2', 'gd:G3']);
      const box = await screenFind(page);
      await box.fill('가상현수막');
      await expect.poll(() => ids(page)).toEqual(['gd:G3']);
      expect(state.gd.filter(b => b.action === 'drive-find')).toEqual([{ action: 'drive-find', q: '가상현수막' }]);
      expect(state.gd.some(b => b.action === 'content-find')).toBe(false);
      await expect(cell(page, 'gd:G3').locator('[data-photos-content-mark]')).toHaveText('설명');
      // 이름으로 걸린 칸은 표시 없음.
      await box.fill('sunset');
      await expect.poll(() => ids(page)).toEqual(['gd:G1']);
      await expect(root(page).locator('[data-photos-content-mark]')).toHaveCount(0);
      expect(state.errors).toEqual([]);
    });

    test('E1 크게 보기 › 수정 › 설명: 칩으로 넣고 저장 → 그림 밑 한 줄, 찾기에 바로 걸림', async ({ page }) => {
      const state = await fixture(page);
      await openPhotos(page, width);
      await expect.poll(() => ids(page)).toEqual(['gd:G1', 'gd:G2', 'gd:G3']);
      await cell(page, 'gd:G1').click();
      const v = viewer(page);
      await expect(v).toBeVisible();
      await v.locator('[data-strip-act="edit"]').click();
      const menu = page.locator('#photoBarMenu');
      await expect(menu).toBeVisible();
      if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/menu-${width}.png` });
      await expect(menu.getByRole('button', { name: '설명', exact: true })).toBeVisible();
      await menu.getByRole('button', { name: '설명', exact: true }).click();
      const s = sheet(page);
      await expect(s).toBeVisible();
      await expect(s.locator('[data-pd-title]')).toHaveText('설명');
      await expect(s.locator('[data-pd-save]')).toBeDisabled();
      // 자주 쓴 낱말 칩(서버 desc-words): 누르면 칸 끝에 한 번만.
      const chips = s.locator('[data-pd-word]');
      await expect(chips).toHaveText(['가상바다', '가상산']);
      await chips.nth(0).click();
      await chips.nth(0).click();
      await expect(s.locator('[data-pd-text]')).toHaveValue('가상바다');
      await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'true');
      await s.locator('[data-pd-text]').pressSequentially(' 가상 회의실');
      await expect(s.locator('[data-pd-count]')).toHaveText('11/500');
      if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/sheet-${width}.png` });
      // 창은 화면 안(폰은 아래쪽), 하단바에 가리지 않는다.
      const b = await s.boundingBox(), vp = page.viewportSize();
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
      const tabs = await page.locator('.mobile-tabs').boundingBox().catch(() => null);
      if (tabs && width < 761 && await page.locator('.mobile-tabs').isVisible()) expect(b.y + b.height).toBeLessThanOrEqual(tabs.y + 1);
      if (width < 761) expect(b.y).toBeGreaterThan(vp.height / 3);
      await s.locator('[data-pd-save]').click();
      await expect(s).toBeHidden();
      expect(sets(state)).toEqual([{ action: 'desc-set', ids: ['G1'], text: '가상바다 가상 회의실', mode: 'set', confirm: true }]);
      await expect(v.locator('[data-diary-viewer-caption]')).toHaveText('가상바다 가상 회의실');
      if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/caption-${width}.png` });
      // 다시 열면 지금 설명이 채워져 있다(서버에 다시 묻지 않음).
      await v.locator('[data-strip-act="edit"]').click();
      await menu.getByRole('button', { name: '설명', exact: true }).click();
      await expect(s.locator('[data-pd-text]')).toHaveValue('가상바다 가상 회의실');
      await s.locator('[data-pd-close]').click();
      await expect(s).toBeHidden();
      await v.locator('[data-diary-viewer-close]').click();
      await expect(v).toBeHidden();
      // 드라이브 색인을 기다리지 않고 찾기에 바로 걸린다(지어낸 드라이브는 이 낱말을 모름).
      const box = await screenFind(page);
      await box.fill('가상 회의실');
      await expect.poll(() => ids(page)).toEqual(['gd:G1']);
      await expect(cell(page, 'gd:G1').locator('[data-photos-content-mark]')).toHaveText('설명');
      expect(state.errors).toEqual([]);
    });

    test('E1 여러 장 선택 › 메뉴 › 설명 붙이기: 같은 칸으로 있던 설명 뒤에 더하고 선택이 풀림', async ({ page }) => {
      const state = await fixture(page);
      await openPhotos(page, width);
      await expect.poll(() => ids(page)).toEqual(['gd:G1', 'gd:G2', 'gd:G3']);
      await hold(page, cell(page, 'gd:G1'));
      await cell(page, 'gd:G2').click();
      await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('2개 선택됨');
      await root(page).locator('[data-photos-act-more]').click();
      await page.locator('#photoBarMenu').getByRole('button', { name: '설명 붙이기', exact: true }).click();
      const s = sheet(page);
      await expect(s).toBeVisible();
      await expect(s.locator('[data-pd-title]')).toHaveText('설명 붙이기 · 2장');
      await expect(s.locator('[data-pd-text]')).toHaveValue('');
      await s.locator('[data-pd-word]').nth(1).click();
      await s.locator('[data-pd-save]').click();
      await expect(s).toBeHidden();
      expect(sets(state)).toEqual([{ action: 'desc-set', ids: ['G1', 'G2'], text: '가상산', mode: 'add', confirm: true }]);
      expect(state.desc.G2).toBe('가상 앞설명 가상산');
      await expect(root(page).locator('[data-photos-sel]')).toBeHidden();
      // 붙인 설명으로 바로 찾힌다.
      const box = await screenFind(page);
      await box.fill('가상산');
      await expect.poll(() => ids(page)).toEqual(['gd:G1', 'gd:G2']);
      expect(state.errors).toEqual([]);
    });

    test('E1 서버가 거절하면(목록 밖·남의 파일) 칸에 까닭 한 줄, 설명 글은 글자로만 그린다', async ({ page }) => {
      const state = await fixture(page, { refuse: true });
      state.desc.G3 = '<img src=x onerror="window.__pwned=1">가상';
      await openPhotos(page, width);
      await expect.poll(() => ids(page)).toEqual(['gd:G1', 'gd:G2', 'gd:G3']);
      await cell(page, 'gd:G3').click();
      const v = viewer(page);
      await expect(v.locator('[data-diary-viewer-caption]')).toHaveText('<img src=x onerror="window.__pwned=1">가상');
      await expect(v.locator('[data-diary-viewer-caption] img')).toHaveCount(0);
      await v.locator('[data-strip-act="edit"]').click();
      await page.locator('#photoBarMenu').getByRole('button', { name: '설명', exact: true }).click();
      const s = sheet(page);
      await s.locator('[data-pd-text]').fill('가상 새 설명');
      await s.locator('[data-pd-save]').click();
      await expect(s.locator('[data-pd-status]')).toHaveText(/저장하지 못했어요: 사진 목록에 없는 사진이에요/);
      await expect(s).toBeVisible();
      await expect(v.locator('[data-diary-viewer-caption]')).toHaveText('<img src=x onerror="window.__pwned=1">가상');
      expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
      expect(state.errors).toEqual([]);
    });
  });
}
