import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S47-19B 같은 사진 묶음 바로잡기(요청함 11/01 12:54·12:55): '같은 사진'과 '연사'를 칩으로 나누고 뜻이 보이는 숫자,
// 묶음을 열면 그 줄 안에서 두 장씩 나란히 비교(폰 412도)·넘기며 남길 것 고르기, 사진마다 있는 곳(폰 폴더·원드라이브 사본) 한 줄씩.
// 받은 사진(카톡)처럼 저장 시각이 붙은 사진은 연사로 묶지 않는다. 네트워크 없음(지어낸 서버·지어낸 앱).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.1';
const KEY = 'PhoneKeyForTest_0123456789';
const T0 = Date.parse('2026-10-05T01:00:00.000Z');
const at = ms => new Date(T0 + ms).toISOString();
const m = (id, name, ms, size, folder, extra = {}) => ({ id: String(id), name, folder, day: at(ms).slice(0, 10), taken_at: at(ms), size_bytes: size, width: 40, height: 30,
  approx: false, kind: 'photo', duration_ms: null, screenshot: false, uploaded_at: at(ms), ...extra });
const PHONE = [
  // 연사 3장(0·0.4·0.8초) — 가장 큰 3번째가 기본 남김
  m(1, 'S1.jpg', 0, 1_000_000, 'DCIM/Camera/'), m(2, 'S2.jpg', 400, 2_000_000, 'DCIM/Camera/'), m(3, 'S3.jpg', 800, 3_000_000, 'DCIM/Camera/'),
  // 같은 사진 2곳(카메라·카톡), 원드라이브에도 사본
  m(10, 'IMG_10.jpg', 60_000, 500_000, 'DCIM/Camera/', { width: 400, height: 300 }), m(11, 'IMG_10(1).jpg', 120_000, 500_000, 'Pictures/KakaoTalk/', { width: 400, height: 300 }),
  // 카톡 받은 사진 5장이 같은 저장 시각 — 연사 아님
  ...[21, 22, 23, 24, 25].map(n => m(n, `k${n}.jpg`, 200_000, 100_000 + n, 'Pictures/KakaoTalk/')),
].sort((a, b) => b.taken_at.localeCompare(a.taken_at));
const OD = [{ id: 'O10', name: 'IMG_10.jpg', day: at(60_000).slice(0, 10), taken_at: at(60_000), size_bytes: 500_000, approx: false, kind: 'photo', duration_ms: null, screenshot: false, uploaded_at: at(60_000) }];
const N = 0;

async function fixture(page) {
  const state = { errors: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
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
  await installViewPrefsServer(page);
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'library') {
        const start = body.cursor ? OD.findIndex(x => x.id === body.cursor.id) + 1 : 0, limit = body.limit || 120;
        const items = OD.slice(start, start + limit), last = items.at(-1);
        return r.fulfill({ json: { items, next_cursor: start + limit < OD.length && last ? { t: last.taken_at, id: last.id } : null, indexing: false } });
      }
      if (body.action === 'months') return r.fulfill({ json: { months: { '2024-03': N }, total: OD.length } });
      if (body.action === 'trash-watch') return r.fulfill({ json: { gone: 0 } });
      if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: OD.length, total: OD.length }, folders: [], indexing: false } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route('**/__phone/**', r => {
      const u = new URL(r.request().url());
      if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({ status: 404, body: '' });
      if (u.pathname.endsWith('/page')) {
        const offset = Number(u.searchParams.get('offset') || 0), limit = Number(u.searchParams.get('limit') || 120);
        const items = PHONE.slice(offset, offset + limit);
        return r.fulfill({ json: { items, next: offset + limit < PHONE.length ? offset + limit : null, total: PHONE.length } });
      }
      if (u.pathname.endsWith('/folders')) return r.fulfill({ json: { folders: [
        { id: 'DCIM/Camera/', name: 'Camera', count: N, cover: PHONE[3] },
        { id: 'Pictures/KakaoTalk/', name: 'KakaoTalk', count: 3, cover: PHONE[0] },
      ] } });
      if (u.pathname.endsWith('/months')) return r.fulfill({ json: { months: { '2024-03': N } } });
      if (u.pathname.endsWith('/days')) return r.fulfill({ json: { days: {} } });
      if (u.pathname.includes('/thumb/')) return r.fulfill({ status: 200, contentType: 'image/jpeg', body: PNG });
      return r.fulfill({ status: 404, body: '' });
    });
  } });
  return state;
}
async function openPhotos(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
for (const width of [412, 1280]) {
  test.describe(`폰 앱 ${width}`, () => {
    test.use({ viewport: { width, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: width <= 760 });
    test('같은 사진·연사 묶음: 종류 칩·뜻이 보이는 숫자·두 장 나란히 비교·넘기기·남길 것 고르기·있는 곳 한 줄씩', async ({ page }) => {
      const state = await fixture(page);
      await openPhotos(page, width);
      const box = page.locator('#photosRoot [data-photos-tidy]');
      await page.locator('#photosRoot [data-photos-tidy-chip]').click();
      await expect(box.locator('.photos-tidy-at')).toContainText(`폰 ${PHONE.length}장 · 원드라이브 1장 확인`, { timeout: 30_000 });
      const dups = box.locator('details[data-k="dups"]');
      await expect(dups.locator('summary')).toContainText('같은 사진·연사 묶음 2개 · 지울 수 있는 3장');
      await dups.locator('summary').click();
      await expect(dups.locator('[data-photos-tidy-dupkind="copy"]')).toHaveText('같은 사진 1');
      await expect(dups.locator('[data-photos-tidy-dupkind="burst"]')).toHaveText('연사 1');
      await expect(dups.locator('.photos-tidy-line').first()).toHaveText('파일 크기·가로세로가 똑같은 사진 · 묶음 1개 · 지울 수 있는 사진 1장 · 아낄 용량 500KB');
      // 같은 사진: 비교 → 두 장 나란히, 있는 곳 한 줄씩(폰 폴더 + 원드라이브 사본).
      const copy = dups.locator('[data-photos-tidy-dup="ph:10"]');
      await copy.locator('[data-photos-tidy-see="dup:ph:10"]').click();
      const cmp = copy.locator('[data-photos-tidy-cmp="ph:10"]');
      const slots = cmp.locator('.photos-tidy-cmp-slot');
      await expect(slots).toHaveCount(2);
      const [a, b] = [await slots.nth(0).boundingBox(), await slots.nth(1).boundingBox()];
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      expect(b.x).toBeGreaterThan(a.x + a.width - 1);
      expect(a.x + a.width * 2).toBeLessThanOrEqual(width + 1);
      await expect(slots.nth(0).locator('.photos-tidy-where')).toHaveText(['폰 · DCIM/Camera', '원드라이브 · 폴더 모름']);
      await expect(slots.nth(1).locator('.photos-tidy-where')).toHaveText(['폰 · Pictures/KakaoTalk']);
      await expect(slots.nth(0).locator('.photos-tidy-num')).toContainText('500KB · 2026.10.05 10:01:00 · 400×300');
      // 연사 칩 → 비교 → 넘기기 → 이것 남기기.
      await dups.locator('[data-photos-tidy-dupkind="burst"]').click();
      await expect(dups.locator('.photos-tidy-line').first()).toHaveText('카메라로 1초 안에 이어 찍은 사진 · 묶음 1개 · 지울 수 있는 사진 2장 · 아낄 용량 3MB');
      await expect(dups.locator('[data-photos-tidy-dup]')).toHaveCount(1);
      const burst = dups.locator('[data-photos-tidy-dup="ph:1"]');
      await expect(burst.locator('.photos-tidy-num').first()).toHaveText('연사 3장 · 아낄 3MB');
      await burst.locator('[data-photos-tidy-see="dup:ph:1"]').click();
      const ids = () => burst.locator('[data-photos-tidy-cmp-open]').evaluateAll(els => els.map(e => e.dataset.photosTidyCmpOpen.split('|')[1]));
      await expect.poll(ids).toEqual(['ph:3', 'ph:1']);
      await expect(burst.locator('.photos-tidy-cmp-nav .photos-tidy-num')).toHaveText('1 / 2');
      await burst.locator('[data-photos-tidy-cmp-step="ph:1|1"]').click();
      await expect.poll(ids).toEqual(['ph:3', 'ph:2']);
      await burst.locator('.photos-tidy-cmp-slot').nth(1).locator('[data-photos-tidy-keep="ph:1|ph:2"]').click();
      await expect.poll(ids).toEqual(['ph:2', 'ph:1']);
      await expect(burst.locator('.photos-tidy-cmp-slot').nth(0).locator('[data-photos-tidy-keep]')).toHaveText('남길 사진');
      await expect(burst.locator('.photos-tidy-pick[aria-pressed="true"]')).toHaveAttribute('data-photos-tidy-keep', 'ph:1|ph:2');
      // 비교 사진 → 크게 보기(묶음 사진들) → 뒤로 = 비교 칸 그대로.
      await burst.locator('[data-photos-tidy-cmp-open="ph:1|ph:1"]').click();
      const viewer = page.locator('[data-diary-viewer]');
      await expect(viewer).toBeVisible();
      await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('1 / 3');
      await page.goBack();
      await expect(viewer).toBeHidden();
      await expect(burst.locator('.photos-tidy-cmp-slot')).toHaveCount(2);
      expect(state.errors).toEqual([]);
    });
  });
}
