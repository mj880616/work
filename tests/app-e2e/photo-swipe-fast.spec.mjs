import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// 요청함 10/30(명진 결정 확정) 세 건을 지어낸 서버로 본다(네트워크 없음, 사진은 1×1 그림). 폰 412·PC 1440.
// A PHOTO-스와이프안내: 위로 밀면 사진이 손가락을 따라 올라가고 정해진 거리를 넘겨야 별표(덜 밀면 제자리), 아래로 밀면 따라 내려가다 닫힘.
//   처음 3번만 손동작 안내(본 횟수는 서버 view_prefs.photo_hint).
// B PHOTO-크게보기빨리: 누르면 이미 있는 작은 그림이 바로 뜨고 큰 그림이 오면 바뀐다. [ⓘ 정보]에 '불러오기' 한 줄.
// C PHOTO-미리받기앱시작: 일기를 열지 않아도 앱을 켠 뒤 미리 받기가 시작되고, 최근 100장은 큰 그림도 받는다.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const N = 240, PER_DAY = 12;
const pad = (n, w = 3) => String(n).padStart(w, '0');
// 최신순: P000이 가장 늦게 찍은 사진. 하루 12장씩 20일(10월 30일부터 거꾸로). 시계는 2026-10-06(openHome)이라 달 목록은 10월 하나.
const MEDIA = Array.from({ length: N }, (_, i) => {
  const day = `2026-10-${pad(30 - Math.floor(i / PER_DAY), 2)}`;
  const sec = PER_DAY - (i % PER_DAY);
  return { id: 'P' + pad(i), name: 'p.jpg', day, taken_at: `${day}T03:00:${pad(sec, 2)}.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null };
});

async function fixture(page, width, { warm = false, largeDelay = 0, prefs = null } = {}) {
  const state = { edge: [], urls: [], images: [], starWrites: [], errors: [], stars: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  // A·B는 사진 메뉴 요청만 본다: 앱 시작 미리 받기(od-warm.js)는 끈다. C는 켠다.
  if (!warm) await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  const routes = async () => {
    if (prefs) state.prefs = await installViewPrefsServer(page, prefs);
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', async r => {
      const req = r.request();
      if (req.method() === 'GET') return r.fulfill({ json: state.stars });
      if (req.method() === 'POST') { const body = req.postDataJSON(); state.starWrites.push({ method: 'POST', key: body.item_key }); state.stars.push({ source: body.source, item_key: body.item_key, taken_day: body.taken_day }); return r.fulfill({ status: 201, json: [body] }); }
      if (req.method() === 'DELETE') { const key = new URL(req.url()).searchParams.get('item_key').replace(/^eq\./, ''); state.starWrites.push({ method: 'DELETE', key }); state.stars = state.stars.filter(s => s.item_key !== key); return r.fulfill({ json: [] }); }
      return r.fulfill({ status: 500, json: {} });
    });
    await page.route(u => u.origin === CDN, async r => {
      const [, size, file] = new URL(r.request().url()).pathname.split('/');
      state.images.push({ size, id: file.replace(/\.png$/, '') });
      if (size === 'large' && largeDelay) await new Promise(resolve => setTimeout(resolve, largeDelay));
      return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG });
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      state.edge.push(body);
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') {
        state.urls.push({ size: body.size, ids: body.ids.slice() });
        return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      }
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
  state.prefs ||= await installViewPrefsServer(page);
  return state;
}
async function openPhotos(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
  await expect(page.locator('#photosRoot [data-photos-open="5"] .diary-photo')).toHaveAttribute('data-img-state', 'shown', { timeout: 15000 });
}
const viewer = page => page.locator('[data-diary-viewer]');
async function openViewer(page, i = 5) {
  await page.locator(`#photosRoot [data-photos-open="${i}"]`).click();
  await expect(viewer(page)).toBeVisible();
}
// 한 손가락 세로 밀기(CDP 터치). during(): 손가락을 떼기 전 확인.
async function drag(page, cdp, dy, during = null) {
  const b = await page.locator('[data-diary-viewer-strip]').boundingBox();
  const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(y + dy * i / 8) }] });
  if (during) await during();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const slide = (page, i = 5) => viewer(page).locator('.diary-slide').nth(i);
const transformOf = loc => loc.evaluate(el => el.style.transform);

for (const width of [412, 1440]) {
  test(`A 위로 밀기: 거리 미만은 제자리·별표 안 됨, 넘기면 별이 차오르고 별표, 아래로 밀면 따라 내려가 닫힘 ${width}`, async ({ page }) => {
    const f = await fixture(page, width, { prefs: { photo_hint: 3 } });
    await openPhotos(page, width);
    await openViewer(page);
    const cdp = await page.context().newCDPSession(page);
    const starBtn = viewer(page).locator('[data-diary-star]');
    await expect(starBtn).toHaveAttribute('aria-pressed', 'false');
    // 덜 밀기(60px < 96px): 사진은 따라 올라가지만 별은 덜 찼고, 놓으면 제자리·별표 없음.
    await drag(page, cdp, -60, async () => {
      expect(await transformOf(slide(page))).toMatch(/^translateY\(-\d+px\)$/);
      await expect(viewer(page)).toHaveAttribute('data-strip-drag', 'up');
    });
    await expect.poll(() => transformOf(slide(page))).toBe('');
    await expect(starBtn).toHaveAttribute('aria-pressed', 'false');
    expect(f.starWrites).toEqual([]);
    // 넘기기(150px): 별이 다 차고(star-ready) 놓으면 별표, 버튼이 ★.
    await drag(page, cdp, -150, async () => {
      await expect(viewer(page)).toHaveAttribute('data-strip-drag', 'star-ready');
      await expect(viewer(page).locator('[data-strip-starfx]')).toHaveAttribute('data-anim', 'drag');
    });
    await expect(starBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(starBtn.locator('span').first()).toHaveText('★');
    await expect.poll(() => f.starWrites).toEqual([{ method: 'POST', key: 'P005' }]);
    await expect.poll(() => viewer(page).locator('[data-strip-starfx]').getAttribute('data-anim'), { timeout: 3000 }).toBeNull();
    await expect.poll(() => transformOf(slide(page))).toBe('');
    // 아래로 밀기(160px): 사진이 따라 내려가다 닫힌다.
    await drag(page, cdp, 160, async () => { expect(await transformOf(slide(page))).toMatch(/^translateY\(\d+px\)$/); });
    await expect(viewer(page)).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });

  test(`A 움직임 줄이기: 사진은 움직이지 않고 별표만 ${width}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const f = await fixture(page, width, { prefs: { photo_hint: 3 } });
    await openPhotos(page, width);
    await openViewer(page);
    const cdp = await page.context().newCDPSession(page);
    await drag(page, cdp, -150, async () => { expect(await transformOf(slide(page))).toBe(''); });
    await expect(viewer(page).locator('[data-diary-star]')).toHaveAttribute('aria-pressed', 'true');
    expect(await viewer(page).locator('[data-strip-starfx]').getAttribute('data-anim')).toBeNull();
    await expect(viewer(page).locator('[data-strip-finger]')).toBeHidden();
    expect(f.errors).toEqual([]);
  });

  test(`A 안내: 처음 3번만 손가락 시늉 + 한 줄, 본 횟수는 서버 값 ${width}`, async ({ page }) => {
    const f = await fixture(page, width, { prefs: {} });
    await openPhotos(page, width);
    const hint = viewer(page).locator('[data-diary-viewer-hint]');
    for (let n = 1; n <= 3; n++) {
      await openViewer(page);
      await expect(hint).toBeVisible();
      await expect(hint).toHaveText('↑ 위로 밀면 별표 · 아래로 밀면 닫기');
      await expect.poll(() => f.prefs.value?.photo_hint).toBe(n);
      await viewer(page).locator('[data-diary-viewer-close]').click();
      await expect(viewer(page)).toHaveCount(0);
    }
    await openViewer(page);
    await expect(hint).toBeHidden();
    await expect(viewer(page).locator('[data-strip-finger]')).toBeHidden();
    expect(f.prefs.value.photo_hint).toBe(3);
    expect(f.errors).toEqual([]);
  });

  test(`A 안내: 서버에 3번 본 기록이 있으면 처음부터 안 뜸 ${width}`, async ({ page }) => {
    const f = await fixture(page, width, { prefs: { photo_hint: 3 } });
    await openPhotos(page, width);
    await openViewer(page);
    await expect(viewer(page).locator('[data-diary-viewer-hint]')).toBeHidden();
    await expect(viewer(page).locator('[data-strip-finger]')).toBeHidden();
    expect(f.prefs.patches.filter(p => p && 'photo_hint' in p)).toEqual([]);
    expect(f.errors).toEqual([]);
  });

  test(`B 누르면 작은 그림이 바로, 큰 그림이 오면 바뀜 + 정보의 불러오기 한 줄 ${width}`, async ({ page }) => {
    const f = await fixture(page, width, { largeDelay: 1500, prefs: { photo_hint: 3 } });
    await openPhotos(page, width);
    await openViewer(page);
    const photo = slide(page).locator('.diary-photo');
    const preview = photo.locator('img.img-slot-preview');
    // 누른 직후: 큰 그림은 아직(1.5초 늦게 옴)인데 작은 그림이 이미 떠 있다(회색 칸 아님).
    await expect(preview).toHaveAttribute('src', /^(blob:|https:\/\/od-thumb\.example\.test\/small\/P005\.png)/, { timeout: 700 });
    await expect(photo).toHaveAttribute('data-img-preview', 'shown', { timeout: 700 });
    expect(await photo.getAttribute('data-img-state')).not.toBe('shown');
    // 큰 그림이 오면 큰 그림으로 바뀌고 작은 그림은 떼어 낸다.
    await expect(photo).toHaveAttribute('data-img-state', 'shown', { timeout: 10000 });
    await expect(photo.locator('img:not(.img-slot-preview)')).toHaveAttribute('src', /^(blob:|https:\/\/od-thumb\.example\.test\/large\/P005\.png)/);
    await expect(preview).toHaveCount(0);
    expect(f.images.some(x => x.size === 'large' && x.id === 'P005')).toBe(true);
    // [ⓘ 정보]: '불러오기 1.4초 (주소 0.5 · 사진 0.9)' 모양, 정보를 열 때만.
    const line = viewer(page).locator('[data-strip-load-time]');
    await expect(line).toHaveCount(0);
    await viewer(page).locator('[data-diary-info]').click();
    await expect(line).toHaveText(/^\d+\.\d초 \(주소 \d+\.\d · 사진 \d+\.\d\)$/);
    const secs = Number((await line.textContent()).match(/^(\d+\.\d)/)[1]);
    expect(secs).toBeGreaterThanOrEqual(1.4);
    expect(f.errors).toEqual([]);
  });

  test(`C 일기를 안 열어도 앱 시작 뒤 미리 받기 시작, 최근 100장은 큰 그림까지 ${width}`, async ({ page }) => {
    const f = await fixture(page, width, { warm: true, prefs: { photo_hint: 3 } });
    const largeIds = () => [...new Set(f.urls.filter(u => u.size === 'large').flatMap(u => u.ids))];
    await expect.poll(() => largeIds().length, { timeout: 45000, intervals: [500] }).toBe(100);
    expect(await page.evaluate(() => window.KPTURouter?.current)).not.toBe('diary');
    await expect(page.locator('#diaryView')).toBeHidden();
    expect(f.edge.filter(b => b.action === 'photos').map(b => b.month)).toContain('2026-10');
    expect(largeIds().sort()).toEqual(Array.from({ length: 100 }, (_, i) => 'P' + pad(i)));
    // 순서: 최근 장의 작은 그림이 큰 그림보다 먼저, 그다음 옛날 장은 작은 그림만.
    const firstLarge = f.urls.findIndex(u => u.size === 'large');
    const smallBefore = new Set(f.urls.slice(0, firstLarge).filter(u => u.size === 'small').flatMap(u => u.ids));
    expect(smallBefore.has('P099')).toBe(true);
    await expect.poll(() => f.urls.filter(u => u.size === 'small').flatMap(u => u.ids).includes('P' + pad(N - 1)), { timeout: 45000, intervals: [500] }).toBe(true);
    const lastLarge = f.urls.map(u => u.size).lastIndexOf('large');
    expect(f.urls.slice(lastLarge + 1).every(u => u.size === 'small')).toBe(true);
    expect(f.errors).toEqual([]);
  });
}
