import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// PHOTO-크게보기정렬(S73-12, 명진 11/27 22:50 폴드 폰 앱): "섬네일에서 클릭한거 하나 뒤에거가 나옴 / 확대하면 또 다른 사진이 확대됨 / 화질이 안 좋음".
// 원인: 크게 보기 가로 줄의 칸 폭이 소수(폴드 411.43px 등)인데 정수 clientWidth × 번호로 자리를 잡고 읽어, 뒤 칸일수록 보이는 사진과
// 크게 보기가 '지금 사진'으로 아는 칸(at)이 한두 장 어긋났다 — 별표·지우기·확대·큰 판 받기가 모두 보이지 않는 옆 사진에 걸렸다.
// 이 시험은 칸 폭을 소수(100.5px)로 두어 같은 어긋남을 짧은 목록(240장)에서 재현하고, 여러 자리(날짜 경계·쪽 경계·마지막 장)를 눌러
// 누른 사진 = 보이는 사진 = 숫자 = 별표·지우기·확대 대상 = 큰 판 받기 대상인지 본다. 지어낸 서버(네트워크 없음, 사진은 1×1 그림).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const N = 240;
const pad = (n, w = 3) => String(n).padStart(w, '0');
const MEDIA = Array.from({ length: N }, (_, i) => {
  const day = `2026-10-${pad(30 - Math.floor(i / 12), 2)}`;
  return { id: 'P' + pad(i), name: 'p.jpg', day, taken_at: `${day}T03:00:${pad(12 - (i % 12), 2)}.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null };
});
// 칸 폭을 소수로(폴드처럼). 줄만 좁히고 위 줄·아래 단추줄은 그대로.
const FRACTION_CSS = '#appView #photosView .diary-viewer-strip{ flex:1 1 auto !important; width:100.5px !important; max-width:100.5px !important; }';

async function fixture(page, width) {
  const state = { media: [], stars: [], cdn: [], errors: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  const routes = async () => {
    await installViewPrefsServer(page, { photo_hint: 3 });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => {
      if (r.request().method() === 'POST') state.stars.push(r.request().postDataJSON().item_key);
      return r.fulfill({ json: [] });
    });
    await page.route(u => u.origin === CDN, async r => {
      const [, size, file] = new URL(r.request().url()).pathname.split('/');
      state.cdn.push(`${size}/${file.replace(/\.png$/, '')}`);
      return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG });
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'media-url') { state.media.push(body.id); return r.fulfill({ json: { url: `${CDN}/orig/${body.id}.png`, kind: 'photo', name: 'p.jpg', expires_in: 3000 } }); }
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'photos') {
        const days = {};
        if (body.month === '2026-10') for (const m of [...MEDIA].reverse()) (days[m.day] ||= []).push({ id: m.id, name: m.name, taken_at: m.taken_at, approx: false });
        return r.fulfill({ json: { days, truncated: false } });
      }
      if (body.action === 'library') {
        const c = body.cursor;
        const list = MEDIA.filter(m => !c || m.taken_at < c.t || (m.taken_at === c.t && m.id < c.id));
        const items = list.slice(0, body.limit), more = list.length > body.limit;
        return r.fulfill({ json: { items, next_cursor: more ? { t: items.at(-1).taken_at, id: items.at(-1).id } : null, indexing: false } });
      }
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': N }, total: N } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
  };
  await openHome(page, { beforeLoad: routes });
  await page.addStyleTag({ content: FRACTION_CSS });
  return state;
}
async function openPhotos(page, width) {
  if (width <= 760) {
    if (await page.locator('.mobile-tabs [data-view="photos"]').isVisible()) await page.locator('.mobile-tabs [data-view="photos"]').click();
    else { await page.locator('#mobileMenuTab').click(); await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click(); }
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
  await expect(page.locator('#photosRoot [data-photos-open="5"] .diary-photo')).toHaveAttribute('data-img-state', 'shown', { timeout: 15000 });
  // 둘째 쪽(121~240장)까지 받아 둔다: 목록 끝으로 내려 마지막 칸이 생길 때까지.
  const last = page.locator(`#photosRoot [data-photos-id="P${pad(N - 1)}"]`);
  for (let k = 0; k < 30 && !(await last.count()); k++) {
    await page.evaluate(() => { const f = document.querySelector('#photosRoot [data-photos-foot]'); (f || document.scrollingElement).scrollIntoView({ block: 'end' }); window.scrollBy(0, 4000); });
    await page.waitForTimeout(150);
  }
  await expect(last).toHaveCount(1);
}
const viewer = page => page.locator('[data-diary-viewer]');
const count = page => viewer(page).locator('[data-diary-viewer-count]');
// 지금 화면 가운데에 보이는 칸: {i: 몇 번째 칸, id: 그 칸 사진}
const visible = page => page.locator('[data-diary-viewer-strip]').evaluate(strip => {
  const r = strip.getBoundingClientRect(), x = r.left + r.width / 2;
  const i = [...strip.children].findIndex(c => { const b = c.getBoundingClientRect(); return b.left <= x && x < b.right; });
  return { i, id: (strip.children[i]?.querySelector('.diary-photo')?.dataset.diaryPhoto || '').replace(/^od:/, '') };
});
async function openAt(page, i) {
  const cell = page.locator(`#photosRoot [data-photos-id="P${pad(i)}"]`);
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  await expect(viewer(page)).toBeVisible();
  await expect(count(page)).toHaveText(`${i + 1} / ${N}`);
  // 붙는 움직임이 끝난 뒤에도 보이는 칸 = 누른 사진 = 숫자.
  await page.waitForTimeout(250);
  await expect.poll(() => visible(page)).toEqual({ i, id: `P${pad(i)}` });
  await expect(count(page)).toHaveText(`${i + 1} / ${N}`);
}
const close = async page => { await viewer(page).locator('[data-diary-viewer-close]').click(); await expect(viewer(page)).toHaveCount(0); };

for (const width of [412, 1280]) {
  test.describe(`${width}`, () => {
    if (width === 412) test.use({ hasTouch: true });
    test('여러 자리 썸네일: 누른 사진이 그대로 열리고, 넘긴 뒤 별표·확대·큰 판·지우기 대상이 화면 사진', async ({ page }) => {
      const f = await fixture(page, width);
      await openPhotos(page, width);
      // 첫 장 · 날짜 경계(12번째↔13번째) · 첫 쪽 끝(120번째) · 둘째 쪽 첫 장 · 뒤쪽 · 마지막 장.
      for (const i of [0, 11, 12, 119, 120, 200, N - 1]) { await openAt(page, i); await close(page); }

      await openAt(page, 200);
      // 큰 판: 보이는 장은 큰 그림(large)을 받는다(썸네일을 늘려 쓰지 않음).
      await expect.poll(() => f.cdn.includes(`large/P200`)).toBe(true);
      // 넘기기 → 보이는 사진·숫자가 함께 다음 장.
      await page.keyboard.press('ArrowRight');
      await expect(count(page)).toHaveText(`202 / ${N}`);
      await expect.poll(() => visible(page)).toEqual({ i: 201, id: 'P201' });
      await expect.poll(() => f.cdn.includes(`large/P201`)).toBe(true);
      // 별표 = 화면 사진.
      await viewer(page).locator('[data-diary-star]').click();
      await expect.poll(() => f.stars).toEqual(['P201']);
      // 확대 = 화면 사진 칸만 커지고, 원본도 그 사진 것을 받는다.
      const strip = await page.locator('[data-diary-viewer-strip]').boundingBox();
      await page.mouse.dblclick(strip.x + strip.width / 2, strip.y + strip.height / 2);
      await expect(viewer(page)).toHaveAttribute('data-strip-zoom', '');
      const zoomed = await page.locator('[data-diary-viewer-strip] .diary-photo').evaluateAll(els => els.filter(el => el.style.transform).map(el => el.dataset.diaryPhoto));
      expect(zoomed).toEqual(['od:P201']);
      await expect.poll(() => f.media).toEqual(['P201']);
      await page.mouse.dblclick(strip.x + strip.width / 2, strip.y + strip.height / 2);
      await expect(viewer(page)).not.toHaveAttribute('data-strip-zoom', '');
      // 지우기 = 화면 사진(목록에서 그 사진만 빠지고, 되돌리면 돌아온다).
      await viewer(page).locator('[data-od-delete]').click();
      await expect(viewer(page).locator('[data-diary-undo]')).toBeVisible();
      await expect(count(page)).toHaveText(`202 / ${N - 1}`);
      await expect(page.locator('#photosRoot [data-photos-id="P201"]')).toHaveCount(0);
      await expect(page.locator('#photosRoot [data-photos-id="P200"]')).toHaveCount(1);
      await expect(page.locator('#photosRoot [data-photos-id="P202"]')).toHaveCount(1);
      await expect.poll(() => visible(page)).toEqual({ i: 201, id: 'P202' });
      await viewer(page).locator('[data-diary-undo]').click();
      await expect(page.locator('#photosRoot [data-photos-id="P201"]')).toHaveCount(1);
      await expect(count(page)).toHaveText(`202 / ${N}`);
      await expect.poll(() => visible(page)).toEqual({ i: 201, id: 'P201' });
      expect(f.errors).toEqual([]);
    });
  });
}
