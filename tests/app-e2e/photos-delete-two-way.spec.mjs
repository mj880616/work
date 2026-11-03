import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S48-17 PHOTO-지우기두갈래(요청함 11/01 00:27, 시안 확정): 고른 사진 [지우기] → 작은 고르기 창 두 줄.
// - 폰 앱 412(앱 다리 흉내, 0.4.11 = 상태에 restore), 원드라이브 칩 끔(평소 쓰임):
//   ① [폰 공간만 비우기 · 1장]: 원드라이브에 원본이 있는 폰 사진만(서버 copy-check) → 폰 휴지통 → 비운 기록(keep·원래 폴더·찍은 시각) → 목록 원래 자리에 원드라이브 칸 + 아이콘.
//   ② 비운 사진 [폰으로 되돌리기]: 원본을 받아 photos:save:begin에 원래 폴더·찍은 시각 → 기록 지우기(kept-drop).
//   ③ [완전히 지우기 · n장]: 폰 휴지통 + 짝 원드라이브 사본까지 Web2 휴지통(photo-delete) + 비운 기록 지우기.
// - PC 1280: 원드라이브 사진 [지우기]는 예전처럼 바로 빠지고 [되돌리기](고르기 창 없음).
// 네트워크 없음(지어낸 서버·지어낸 앱), 사진은 1×1 그림.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.11';
const KEY = 'PhoneKeyForTest_0123456789';
const L1 = '00000000-0000-4000-8000-000000000001', L2 = '00000000-0000-4000-8000-000000000002';
const odRow = m => ({ approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: m.taken_at, ...m });
// O1 = 폰 사진 1의 원드라이브 사본(같은 이름·크기·시각), K9 = 전에 비운 사진의 원드라이브 칸.
const OD = [
  odRow({ id: 'O1', name: 'IMG_1.jpg', day: '2026-10-31', taken_at: '2026-10-31T03:00:00.000Z', size_bytes: 10 }),
  odRow({ id: 'K9', name: 'IMG_9.jpg', day: '2026-10-20', taken_at: '2026-10-20T03:00:00.000Z', size_bytes: 90 }),
];
const PHONE = [
  { id: '2', name: 'IMG_2.jpg', day: '2026-10-31', taken_at: '2026-10-31T04:00:00.000Z', size_bytes: 20, folder: 'DCIM/Camera/' },
  { id: '1', name: 'IMG_1.jpg', day: '2026-10-31', taken_at: '2026-10-31T03:00:00.000Z', size_bytes: 10, folder: 'DCIM/Camera/' },
].map(m => ({ ...m, approx: false, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: m.taken_at }));

async function fixture(page, { app = false } = {}) {
  const state = { errors: [], edge: [], bodies: [], kept: [{ log_id: L1, phone_id: '9', rel_path: 'DCIM/Camera/', taken_at: '2026-10-20T03:00:00.000Z', photo: OD[1] }] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  if (app) {
    // 앱 다리 흉내: 상태(trash·restore), 폰 휴지통(허용), 되돌리기 받기(시작·조각·끝 → 번호 88).
    await page.addInitScript(({ key }) => {
      const listeners = [];
      window.__photoSent = []; window.__trashed = [];
      const say = data => setTimeout(() => listeners.forEach(fn => fn({ data })), 0);
      let got = 0;
      window.KPTUAppShell = {
        postMessage(m) {
          m = String(m);
          window.__photoSent.push(m.startsWith('photos:save:part:') ? 'photos:save:part' : m);
          if (m === 'photos:hello' || m === 'photos:ask') say(`photos:state:{"access":"full","key":"${key}","trash":true,"hide":true,"ops":true,"manage":false,"edit":true,"restore":true}`);
          else if (m.startsWith('photos:trash:')) { const ids = m.slice('photos:trash:'.length).split(','); window.__trashed.push(...ids); say(`photos:trashed:{"ok":true,"count":${ids.length}}`); }
          else if (m.startsWith('photos:save:begin:')) { got = 0; say('photos:save:{"ok":true,"step":"begin","got":0,"error":""}'); }
          else if (m.startsWith('photos:save:part:')) { got += atob(m.slice('photos:save:part:'.length)).length; say(`photos:save:{"ok":true,"step":"part","got":${got},"error":""}`); }
          else if (m === 'photos:save:end') say(`photos:save:{"ok":true,"step":"end","got":${got},"id":"88","error":""}`);
        },
        addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
      };
    }, { key: KEY });
  }
  // PHOTO-기기별출처(S49-5): 폰 앱 기본은 폰 폴더만이므로, 원드라이브·폰 사진이 함께 보이는 목록을 쓰는 이 시험은 둘 다 켠 채 시작한다.
  const prefs = await installViewPrefsServer(page, { photo_sources_phone: { onedrive: true, gdrive: false, phone: true } });
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      state.edge.push(body.action + (body.purpose ? ':' + body.purpose : ''));
      state.bodies.push(body);
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'media-url') return r.fulfill({ json: { url: `${CDN}/orig/${body.id}.jpg`, kind: 'photo', name: 'IMG_9.jpg', expires_in: 3000 } });
      if (body.action === 'library') return r.fulfill({ json: { items: OD, next_cursor: null, indexing: false } });
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': OD.length }, total: OD.length } });
      if (body.action === 'trash-watch') return r.fulfill({ json: { gone: 0, checked: 0 } });
      if (body.action === 'copy-check') return r.fulfill({ json: { ok: body.pairs.map(p => p.id), missing: [], unsure: [] } });
      if (body.action === 'trash-log') {
        for (const p of body.pairs) if (p.keep) state.kept.push({ log_id: L2, phone_id: p.phone_id, rel_path: p.rel_path, taken_at: p.taken_at, photo: OD.find(o => o.id === p.copy_id) });
        return r.fulfill({ json: { saved: body.pairs.length } });
      }
      if (body.action === 'kept-list') return r.fulfill({ json: { items: state.kept } });
      if (body.action === 'kept-drop') { state.kept = state.kept.filter(k => !body.ids.includes(k.log_id)); return r.fulfill({ json: { dropped: true } }); }
      if (body.action === 'photo-delete') return r.fulfill({ json: { moved: body.ids, failed: {} } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route('**/__phone/**', async r => {
      const u = new URL(r.request().url());
      if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({ status: 404, body: '' });
      const gone = await page.evaluate(() => window.__trashed || []).catch(() => []);
      const list = PHONE.filter(p => !gone.includes(p.id));
      if (u.pathname.endsWith('/page')) return r.fulfill({ json: { items: list, next: null, total: list.length } });
      if (u.pathname.endsWith('/months')) return r.fulfill({ json: { months: { '2026-10': list.length } } });
      if (u.pathname.endsWith('/days')) return r.fulfill({ json: { days: {} } });
      if (u.pathname.endsWith('/folders')) return r.fulfill({ json: { folders: [] } });
      if (u.pathname.includes('/thumb/')) return r.fulfill({ status: 200, contentType: 'image/jpeg', body: PNG });
      return r.fulfill({ status: 404, body: '' });
    });
  } });
  return { state, prefs };
}
async function openPhotos(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const root = page => page.locator('#photosRoot');
const ids = page => root(page).locator('[data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));
const cellOf = (page, id) => root(page).locator(`[data-photos-list] [data-photos-id="${id}"]`);
async function hold(page, locator) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
}
const choice = page => page.locator('.kptu-ask.kptu-ask-choice');
const sentOf = (page, re) => page.evaluate(src => window.__photoSent.filter(m => new RegExp(src).test(m)), re.source);
// 원드라이브 칩을 끈 폰 사진 보기(평소 쓰임).
async function phoneOnly(page) {
  await openPhotos(page, 412);
  await expect.poll(() => ids(page)).toEqual(['ph:2', 'O1', 'K9']);
  await root(page).locator('[data-photos-src="onedrive"]').click();
  await expect(root(page).locator('[data-photos-src="onedrive"]')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => ids(page)).toEqual(['ph:2', 'ph:1', 'K9']);
}

test.describe('폰 앱 412', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  test('원드라이브 칩을 꺼도 비운 사진이 원래 날짜 자리에 원드라이브 아이콘을 달고 보인다', async ({ page }) => {
    const { state } = await fixture(page, { app: true });
    await phoneOnly(page);
    const k = cellOf(page, 'K9');
    await expect(k).toHaveAttribute('data-photos-kept', '');
    await expect(k.locator('.photos-src-mark')).toHaveAttribute('data-src', 'onedrive');
    // 폰 사진 칸에는 아이콘이 없다(출처 하나).
    await expect(cellOf(page, 'ph:2').locator('.photos-src-mark')).toHaveCount(0);
    // 누르면 지금 크게 보기(원드라이브 원본 길).
    await k.click();
    await expect(page.locator('[data-diary-viewer]')).toBeVisible();
    expect(state.edge.filter(a => a === 'kept-list').length).toBeGreaterThan(0);
    expect(state.errors).toEqual([]);
  });

  test('[지우기] → 두 갈래 창 → 폰 공간만 비우기: 원본 있는 사진만 폰 휴지통, 원래 폴더·시각 기록, 목록 원래 자리에 남음', async ({ page }) => {
    const { state } = await fixture(page, { app: true });
    await phoneOnly(page);
    await hold(page, cellOf(page, 'ph:2'));
    await cellOf(page, 'ph:1').click();
    await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('2개 골랐음');
    await root(page).locator('[data-photos-act-delete]').click();
    await expect(choice(page)).toBeVisible();
    const picks = choice(page).locator('[data-ask-pick]');
    await expect(picks.nth(0)).toContainText('폰 공간만 비우기 · 1장');
    await expect(picks.nth(0)).toContainText('목록에 남고, 나중에 [폰으로 되돌리기]로 제자리에');
    await expect(picks.nth(1)).toContainText('완전히 지우기 · 2장');
    await expect(picks.nth(1)).toHaveClass(/is-danger/);
    await expect(choice(page).locator('.kptu-ask-foot')).toHaveText('원드라이브에 원본이 없는 1장은 공간만 비우기에서 빠져요');
    // 창이 하단바에 가리지 않는다.
    const box = await choice(page).boundingBox(), bar = await page.locator('.mobile-tabs').boundingBox();
    if (bar) expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 1);
    await picks.nth(0).click();
    await expect.poll(() => sentOf(page, /^photos:trash:/)).toEqual(['photos:trash:1']);
    const check = state.bodies.find(b => b.action === 'copy-check');
    expect(check.pairs).toEqual([{ id: 'O1', size: 10 }]);
    await expect.poll(() => state.bodies.find(b => b.action === 'trash-log')?.pairs).toEqual([{ phone_id: '1', copy_id: 'O1', keep: true, rel_path: 'DCIM/Camera/', taken_at: '2026-10-31T03:00:00.000Z' }]);
    // 폰 칸은 빠지고 같은 자리에 원드라이브 칸(비운 사진)이 남는다.
    await expect.poll(() => ids(page)).toEqual(['ph:2', 'O1', 'K9']);
    await expect(cellOf(page, 'O1')).toHaveAttribute('data-photos-kept', '');
    await expect(page.locator('.kptu-notice')).toContainText('폰 공간을 비웠어요');
    expect(state.edge).not.toContain('photo-delete');
    expect(state.errors).toEqual([]);
  });

  test('비운 사진 [폰으로 되돌리기]: 원본을 원래 폴더·찍은 시각으로 사진첩에 넣고 기록을 지운다', async ({ page }) => {
    const { state } = await fixture(page, { app: true });
    await phoneOnly(page);
    await hold(page, cellOf(page, 'K9'));
    const back = root(page).locator('[data-photos-act-restore]');
    await expect(back).toBeVisible();
    await back.click();
    await expect.poll(() => sentOf(page, /^photos:save:/)).toEqual([
      `photos:save:begin:{"name":"IMG_9.jpg","mime":"image/png","size":${PNG.length},"dir":"DCIM/Camera/","taken":${Date.parse('2026-10-20T03:00:00Z')}}`,
      'photos:save:part', 'photos:save:end']);
    await expect.poll(() => state.bodies.filter(b => b.action === 'kept-drop').map(b => b.ids)).toEqual([[L1]]);
    await expect(page.locator('.kptu-notice')).toContainText('원래 폴더에 되돌렸어요');
    await expect.poll(() => ids(page)).toEqual(['ph:2', 'ph:1']);
    // 폰 사진만 고르면 [폰으로 되돌리기]는 없다.
    await hold(page, cellOf(page, 'ph:2'));
    await expect(back).toBeHidden();
    expect(state.errors).toEqual([]);
  });

  test('[완전히 지우기]: 폰 휴지통 + 짝 원드라이브 사본과 비운 사진을 Web2 휴지통으로, 비운 기록도 지움', async ({ page }) => {
    const { state } = await fixture(page, { app: true });
    await phoneOnly(page);
    await hold(page, cellOf(page, 'ph:1'));
    await cellOf(page, 'K9').click();
    await root(page).locator('[data-photos-act-delete]').click();
    const picks = choice(page).locator('[data-ask-pick]');
    await expect(picks.nth(0)).toContainText('폰 공간만 비우기 · 1장');
    await expect(picks.nth(1)).toContainText('완전히 지우기 · 2장');
    await expect(choice(page).locator('.kptu-ask-foot')).toHaveCount(0);
    await picks.nth(1).click();
    await expect.poll(() => sentOf(page, /^photos:trash:/)).toEqual(['photos:trash:1']);
    await expect.poll(() => state.bodies.filter(b => b.action === 'photo-delete').flatMap(b => b.ids).sort()).toEqual(['K9', 'O1']);
    await expect.poll(() => state.bodies.filter(b => b.action === 'kept-drop').flatMap(b => b.ids)).toEqual([L1]);
    await expect.poll(() => ids(page)).toEqual(['ph:2']);
    expect(state.edge).not.toContain('trash-log');
    expect(state.errors).toEqual([]);
  });
});

// S48-32(명진 실기기 11/03 00:03): 원드라이브 칩을 켠 보통 목록에서는 폰·원드라이브 같은 사진이 원드라이브 칸(O1)으로 보인다.
// 그 칸만 골라도 폰 원본 짝(사진 정리와 같은 짝 판정)이 있으면 두 갈래 창. 짝 없는 원드라이브 칸만이면 예전 그대로. 크게 보기 한 장도 같은 판단.
test.describe('폰 앱 412 · 원드라이브 칸', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  test('폰 짝 있는 원드라이브 칸 [지우기] → 두 갈래 창 → 폰 공간만 비우기: 폰 짝만 폰 휴지통, 원드라이브는 그대로', async ({ page }) => {
    const { state } = await fixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:2', 'O1', 'K9']);
    await hold(page, cellOf(page, 'O1'));
    await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('1개 골랐음');
    await root(page).locator('[data-photos-act-delete]').click();
    await expect(choice(page)).toBeVisible();
    const picks = choice(page).locator('[data-ask-pick]');
    await expect(picks.nth(0)).toContainText('폰 공간만 비우기 · 1장');
    await expect(picks.nth(1)).toContainText('완전히 지우기 · 1장');
    await picks.nth(0).click();
    await expect.poll(() => sentOf(page, /^photos:trash:/)).toEqual(['photos:trash:1']);
    expect(state.bodies.find(b => b.action === 'copy-check').pairs).toEqual([{ id: 'O1', size: 10 }]);
    await expect.poll(() => state.bodies.find(b => b.action === 'trash-log')?.pairs).toEqual([{ phone_id: '1', copy_id: 'O1', keep: true, rel_path: 'DCIM/Camera/', taken_at: '2026-10-31T03:00:00.000Z' }]);
    await expect(page.locator('.kptu-notice')).toContainText('폰 공간을 비웠어요');
    await expect.poll(() => ids(page)).toEqual(['ph:2', 'O1', 'K9']);
    expect(state.edge).not.toContain('photo-delete');
    expect(state.errors).toEqual([]);
  });

  test('폰 짝 있는 원드라이브 칸 [완전히 지우기]: 폰 짝 + 원드라이브 둘 다', async ({ page }) => {
    const { state } = await fixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:2', 'O1', 'K9']);
    await hold(page, cellOf(page, 'O1'));
    await root(page).locator('[data-photos-act-delete]').click();
    await choice(page).locator('[data-ask-pick]').nth(1).click();
    await expect.poll(() => sentOf(page, /^photos:trash:/)).toEqual(['photos:trash:1']);
    await expect.poll(() => state.bodies.filter(b => b.action === 'photo-delete').flatMap(b => b.ids)).toEqual(['O1']);
    await expect.poll(() => ids(page)).toEqual(['ph:2', 'K9']);
    await expect(page.locator('.kptu-notice')).toContainText('1장을 지웠어요');
    expect(state.edge).not.toContain('trash-log');
    expect(state.errors).toEqual([]);
  });

  test('폰 짝 없는 원드라이브 칸만 [지우기]: 고르기 창 없이 예전처럼 바로 빠지고 [되돌리기]', async ({ page }) => {
    const { state } = await fixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:2', 'O1', 'K9']);
    await hold(page, cellOf(page, 'K9'));
    await root(page).locator('[data-photos-act-delete]').click();
    await expect.poll(() => ids(page)).toEqual(['ph:2', 'O1']);
    await expect(choice(page)).toHaveCount(0);
    await expect(page.locator('.kptu-notice')).toContainText('휴지통으로 옮겼어요');
    expect(await sentOf(page, /^photos:trash:/)).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('크게 보기 한 장 [지우기]: 폰 짝 있으면 같은 두 갈래 창(크게 보기 위에), 완전히 지우기', async ({ page }) => {
    const { state } = await fixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:2', 'O1', 'K9']);
    await cellOf(page, 'O1').click();
    const viewer = page.locator('[data-diary-viewer]');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('2 / 3');
    await viewer.locator('[data-od-delete]').click();
    await expect(choice(page)).toBeVisible();
    const picks = choice(page).locator('[data-ask-pick]');
    await expect(picks.nth(0)).toContainText('폰 공간만 비우기 · 1장');
    await expect(picks.nth(1)).toContainText('완전히 지우기 · 1장');
    await picks.nth(1).click();
    await expect.poll(() => sentOf(page, /^photos:trash:/)).toEqual(['photos:trash:1']);
    await expect.poll(() => state.bodies.filter(b => b.action === 'photo-delete').flatMap(b => b.ids)).toEqual(['O1']);
    await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText(/\/ 2$/);
    expect(state.errors).toEqual([]);
  });

  test('크게 보기 한 장 [지우기]: 폰 짝 없는 원드라이브 사진은 예전처럼 바로 [되돌리기]', async ({ page }) => {
    const { state } = await fixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:2', 'O1', 'K9']);
    await cellOf(page, 'K9').click();
    const viewer = page.locator('[data-diary-viewer]');
    await expect(viewer).toBeVisible();
    await viewer.locator('[data-od-delete]').click();
    await expect(viewer.locator('[data-diary-viewer-note]')).toContainText('휴지통으로 옮겼어요');
    await expect(viewer.locator('[data-diary-undo]')).toBeVisible();
    await expect(choice(page)).toHaveCount(0);
    expect(await sentOf(page, /^photos:trash:/)).toEqual([]);
    expect(state.errors).toEqual([]);
  });
});

test.describe('PC 1280', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test('원드라이브 사진 [지우기]는 고르기 창 없이 예전처럼 바로 빠지고 [되돌리기]', async ({ page }) => {
    const { state } = await fixture(page);
    await openPhotos(page, 1280);
    await expect.poll(() => ids(page)).toEqual(['O1', 'K9']);
    await hold(page, cellOf(page, 'O1'));
    await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('1개 골랐음');
    await root(page).locator('[data-photos-act-delete]').click();
    await expect(choice(page)).toHaveCount(0);
    await expect.poll(() => ids(page)).toEqual(['K9']);
    await expect(page.locator('.kptu-notice')).toContainText('휴지통으로 옮겼어요');
    await expect(root(page).locator('[data-photos-act-restore]')).toBeHidden();
    expect(state.edge).not.toContain('kept-list');
    expect(state.errors).toEqual([]);
  });
});
