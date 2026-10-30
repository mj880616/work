import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// PHOTO-속도(2026-10-30 명진 "사진 속도 빠르게"): 사진 메뉴의 요청 수·순서를 지어낸 서버로 잰다(네트워크 없음, 사진은 1×1 그림).
// - 첫 화면: 목록 읽기(library·months)는 sync:false(서버가 원드라이브 delta를 기다리지 않음), 썸네일 주소는 꽉 찬 묶음(photo-urls 20장)으로,
//   화면에 보이는 칸과 곧 보일 칸(아래 한 화면, 위 200px)만 받는다. 한 장씩 받는 길(photo)은 쓰지 않는다.
// - 스크롤: 건너뛴 칸은 받지 않고 새 자리 근처 칸만 받는다.
// - 크게 보기: 보는 장과 앞뒤 두 장씩을 한 묶음으로 미리 받고(보는 장이 맨 앞), 넘기면 새 앞뒤 장을 받는다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const N = 600, PER_DAY = 30;
const pad = (n, w = 3) => String(n).padStart(w, '0');
// 최신순: P000이 가장 늦게 찍은 사진. 하루 30장씩 20일(10월 30일부터 거꾸로).
const MEDIA = Array.from({ length: N }, (_, i) => {
  const day = `2026-10-${pad(30 - Math.floor(i / PER_DAY), 2)}`;
  const sec = PER_DAY - (i % PER_DAY);
  return { id: 'P' + pad(i), name: 'p.jpg', day, taken_at: `${day}T03:${pad(Math.floor(sec / 60), 2)}:${pad(sec % 60, 2)}.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null };
});

async function fixture(page, width) {
  const state = { edge: [], urls: [], images: [], bytes: 0, errors: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  // 일기용 뒤에서 미리 받기(od-warm.js)는 끈다: 이 시험은 사진 메뉴 요청만 센다.
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await openHome(page);
  await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === CDN, r => {
    const [, size, file] = new URL(r.request().url()).pathname.split('/');
    state.images.push({ size, id: file.replace(/\.png$/, '') });
    return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG });
  });
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') { state.bytes++; return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); }
    state.edge.push(body);
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
    if (body.action === 'photo-urls') {
      state.urls.push({ size: body.size, ids: body.ids.slice() });
      return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
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
  return state;
}
async function openPhotos(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const cells = page => page.locator('#photosRoot [data-photos-list] [data-photos-open]');
// 칸마다 지금 화면 위치와 그림 상태. near = 서버에 받을 수 있는 자리(IntersectionObserver 'near'의 rootMargin '200px 0px 100% 0px', 칸 경계 여유 2px).
const layout = page => page.evaluate(() => {
  const H = innerHeight;
  return [...document.querySelectorAll('#photosRoot [data-photos-list] [data-photos-open]')].map(b => {
    const r = b.getBoundingClientRect();
    return { id: b.dataset.photosId, visible: r.bottom > 0 && r.top < H && r.width > 0, near: r.bottom > -202 && r.top < 2 * H + 2, shown: b.querySelector('.diary-photo')?.dataset.imgState === 'shown' };
  });
});
const smallIds = state => state.urls.filter(u => u.size === 'small').flatMap(u => u.ids);
// 보이는 칸이 모두 그림이 될 때까지, 그리고 요청이 멈출 때까지 기다린다.
async function settled(page, state) {
  await expect.poll(async () => (await layout(page)).filter(c => c.visible).every(c => c.shown), { timeout: 15000 }).toBe(true);
  let last = -1;
  await expect.poll(() => { const n = state.urls.length; const same = n === last; last = n; return same; }, { intervals: [300, 300, 300, 300, 300, 300] }).toBe(true);
}

for (const width of [412, 884, 1440]) {
  test(`사진 속도: 첫 화면은 delta 없이 목록 한 번 + 꽉 찬 주소 묶음, 보이는 곳 근처만 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await openPhotos(page, width);
    await expect.poll(() => cells(page).count()).toBeGreaterThanOrEqual(120);
    await settled(page, f);
    const lib = f.edge.filter(b => b.action === 'library');
    expect(lib[0]).toMatchObject({ filter: 'all', limit: 120, sync: false });
    expect(lib[0].cursor).toBeUndefined();
    for (const b of lib) expect(b.sync).toBe(false);
    expect(f.edge.filter(b => b.action === 'months')).toEqual([{ action: 'months', filter: 'all', sync: false }]);
    expect(f.edge.filter(b => b.action === 'sync')).toHaveLength(1);
    const cellsNow = await layout(page);
    const asked = smallIds(f), near = new Set(cellsNow.filter(c => c.near).map(c => c.id));
    expect(new Set(asked).size).toBe(asked.length); // 같은 사진을 두 번 묻지 않는다
    expect(asked.filter(id => !near.has(id))).toEqual([]); // 보이는 곳·곧 보일 곳 밖의 칸은 묻지 않는다
    for (const c of cellsNow.filter(x => x.visible)) expect(asked).toContain(c.id);
    // 꽉 찬 묶음: 1~2장짜리 묶음이 여럿 나가지 않는다(모자란 묶음은 마지막 몫·늦게 들어온 칸 정도).
    expect(f.urls.filter(u => u.ids.length < 20).length).toBeLessThanOrEqual(2);
    expect(f.urls.length).toBeLessThanOrEqual(Math.ceil(asked.length / 20) + 1);
    expect(f.bytes).toBe(0);
    console.log(`[photos-speed ${width}] first screen: edge=${f.edge.map(b => b.action).join(',')} small=${asked.length} batches=${f.urls.map(u => u.ids.length).join('+')} visible=${cellsNow.filter(c => c.visible).length}`);
    expect(f.errors).toEqual([]);
  });

  test(`사진 속도: 스크롤하면 건너뛴 칸은 받지 않고 새 자리 근처만 받는다 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await openPhotos(page, width);
    await expect.poll(() => cells(page).count()).toBeGreaterThanOrEqual(120);
    await settled(page, f);
    const before = new Set(smallIds(f));
    // 지금 받은 목록의 맨 끝으로 한 번에(다음 쪽도 이어 붙는다).
    await cells(page).last().evaluate(el => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
    await settled(page, f);
    const now = await layout(page), near = new Set(now.filter(c => c.near).map(c => c.id));
    const fresh = smallIds(f).filter(id => !before.has(id));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.filter(id => !near.has(id))).toEqual([]);
    expect(new Set(smallIds(f)).size).toBe(smallIds(f).length);
    // 처음 자리와 새 자리 사이에서 어느 쪽 근처에도 없던 칸은 받지 않았다.
    const skipped = now.filter(c => !near.has(c.id) && !before.has(c.id)).map(c => c.id);
    expect(skipped.filter(id => smallIds(f).includes(id))).toEqual([]);
    console.log(`[photos-speed ${width}] scroll: new small=${fresh.length} skipped=${skipped.length} batches=${f.urls.length}`);
    expect(f.errors).toEqual([]);
  });

  test(`사진 속도: 크게 보기는 보는 장 먼저, 앞뒤 두 장씩 한 묶음으로 미리 받고 넘기면 다음 장을 받는다 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await openPhotos(page, width);
    await expect.poll(() => cells(page).count()).toBeGreaterThanOrEqual(120);
    await settled(page, f);
    await page.locator('#photosRoot [data-photos-open="5"]').click();
    const viewer = page.locator('[data-diary-viewer]');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText(/^6 \/ \d+$/);
    await expect.poll(() => f.urls.filter(u => u.size === 'large').length).toBeGreaterThan(0);
    const first = f.urls.find(u => u.size === 'large');
    expect(first.ids).toEqual(['P005', 'P006', 'P004', 'P007', 'P003']);
    await expect.poll(() => [...new Set(f.images.filter(x => x.size === 'large').map(x => x.id))].sort()).toEqual(['P003', 'P004', 'P005', 'P006', 'P007']);
    await expect(viewer.locator('.diary-slide').nth(5).locator('.diary-photo')).toHaveAttribute('data-img-state', 'shown');
    // 다음 장: 이미 받아 둔 장이라 새 요청 없이 바로 보이고, 새 두 장 건너(P008)만 받는다.
    const largeBefore = f.urls.filter(u => u.size === 'large').length;
    await viewer.locator('[data-diary-viewer-strip]').press('ArrowRight');
    await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText(/^7 \/ \d+$/);
    await expect(viewer.locator('.diary-slide').nth(6).locator('.diary-photo')).toHaveAttribute('data-img-state', 'shown');
    await expect.poll(() => f.urls.filter(u => u.size === 'large').slice(largeBefore).flatMap(u => u.ids)).toEqual(['P008']);
    const large = f.urls.filter(u => u.size === 'large').flatMap(u => u.ids);
    expect(new Set(large).size).toBe(large.length);
    expect(f.bytes).toBe(0);
    console.log(`[photos-speed ${width}] viewer: large batches=${f.urls.filter(u => u.size === 'large').map(u => u.ids.length).join('+')}`);
    expect(f.errors).toEqual([]);
  });
}
