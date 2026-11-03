import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S48-60 PHOTO-정보고치기(요청함 11/03 00:29, 명진 결정 E1·E2): 폰 앱 412(앱 다리 흉내 0.4.15 = 상태에 meta).
// 완료 기준: 사진 12장을 골라 ⋯ [정보 고치기…] → '모두 −8시간' → 앞→뒤 표 → [저장] = 앱에 시각만 한 번(photos:meta:write) →
// 목록을 새로 읽어 순서가 바뀜 + 서버에 되돌리기 기록 12줄 → 알림 [되돌리기] = 앞 시각으로 다시 고치고 undone_at.
// 네트워크 없음(지어낸 서버·지어낸 앱), 사진은 1×1 그림. 앱 흉내는 고친 시각을 자기 목록에 반영한다(실제 앱의 EXIF + DATE_TAKEN 자리).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.15';
const KEY = 'PhoneKeyForTest_0123456789';
const H = 3600000;
const T0 = Date.parse('2026-10-31T05:00:00Z'); // 서울 14:00
// 소니 사진 12장(1~12, 1분 간격) + 폰으로 찍은 1장(99, 4시간 앞). '−8시간' 뒤에는 99가 맨 위로 온다.
const START = [...Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), taken: T0 + i * 60000 })), { id: '99', taken: T0 - 4 * H }];

test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

async function fixture(page) {
  const state = { errors: [], posts: [], patches: [], records: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await page.addInitScript(({ key, start }) => {
    const listeners = [];
    window.__photoSent = [];
    window.__phoneTaken = Object.fromEntries(start.map(x => [x.id, x.taken]));
    const say = data => setTimeout(() => listeners.forEach(fn => fn({ data })), 0);
    window.KPTUAppShell = {
      postMessage(m) {
        m = String(m);
        window.__photoSent.push(m);
        if (m === 'photos:hello' || m === 'photos:ask') say(`photos:state:{"access":"full","key":"${key}","trash":true,"hide":true,"ops":true,"manage":false,"edit":true,"restore":true,"meta":true}`);
        else if (m.startsWith('photos:meta:read:')) {
          const ids = JSON.parse(m.slice('photos:meta:read:'.length));
          say('photos:meta:' + JSON.stringify({ ok: true, items: ids.map(id => ({ id, taken: window.__phoneTaken[id], lat: null, lon: null, make: 'SONY', model: 'ILCE-7M4', lens: 'FE 24-70mm', can: true })), error: '' }));
        } else if (m.startsWith('photos:meta:write:')) {
          const { items } = JSON.parse(m.slice('photos:meta:write:'.length));
          for (const it of items) if (Number.isFinite(it.taken)) window.__phoneTaken[it.id] = it.taken;
          say('photos:metadone:' + JSON.stringify({ ok: true, count: items.length, failed: [], error: '' }));
        }
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    };
  }, { key: KEY, start: START });
  await installViewPrefsServer(page);
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_info_edits', async r => {
      const req = r.request(), method = req.method();
      if (method === 'POST') { const rows = req.postDataJSON(); state.posts.push(rows); state.records.push(...rows); return r.fulfill({ status: 201, body: '' }); }
      if (method === 'PATCH') { state.patches.push({ url: req.url(), body: req.postDataJSON() }); return r.fulfill({ status: 204, body: '' }); }
      return r.fulfill({ json: [] });
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'library') return r.fulfill({ json: { items: [], next_cursor: null, indexing: false } });
      if (body.action === 'months') return r.fulfill({ json: { months: {}, total: 0 } });
      if (body.action === 'trash-watch') return r.fulfill({ json: { gone: 0, checked: 0 } });
      if (body.action === 'kept-list') return r.fulfill({ json: { items: [] } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route('**/__phone/**', async r => {
      const u = new URL(r.request().url());
      if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({ status: 404, body: '' });
      const taken = await page.evaluate(() => window.__phoneTaken).catch(() => null) || Object.fromEntries(START.map(x => [x.id, x.taken]));
      const day = ms => new Date(ms + 9 * H).toISOString().slice(0, 10);
      const list = Object.entries(taken).sort((a, b) => b[1] - a[1]).map(([id, ms]) => ({ id, name: `DSC0${id}.JPG`, day: day(ms), taken_at: new Date(ms).toISOString(),
        size_bytes: 10, folder: 'DCIM/Camera/', approx: false, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: new Date(ms).toISOString() }));
      if (u.pathname.endsWith('/page')) return r.fulfill({ json: { items: list, next: null, total: list.length } });
      if (u.pathname.endsWith('/months')) return r.fulfill({ json: { months: { '2026-10': list.length } } });
      if (u.pathname.endsWith('/days')) return r.fulfill({ json: { days: {} } });
      if (u.pathname.endsWith('/folders')) return r.fulfill({ json: { folders: [] } });
      if (u.pathname.includes('/thumb/')) return r.fulfill({ status: 200, contentType: 'image/jpeg', body: PNG });
      return r.fulfill({ status: 404, body: '' });
    });
  } });
  return state;
}
const root = page => page.locator('#photosRoot');
const ids = page => root(page).locator('[data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));
const cellOf = (page, id) => root(page).locator(`[data-photos-list] [data-photos-id="${id}"]`);
async function hold(page, locator) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
}
const sentOf = (page, re) => page.evaluate(src => window.__photoSent.filter(m => new RegExp(src).test(m)), re.source);
const SONY = Array.from({ length: 12 }, (_, i) => `ph:${12 - i}`);

test("12장 '모두 −8시간' → 앱에 한 번, 순서 바뀜, 기록 12줄 → [되돌리기]로 원래대로", async ({ page }) => {
  const state = await fixture(page);
  await page.locator('#mobileMenuTab').click();
  await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
  await expect.poll(() => ids(page)).toEqual([...SONY, 'ph:99']);
  await hold(page, cellOf(page, 'ph:12'));
  for (const id of SONY.slice(1)) await cellOf(page, id).click();
  await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('12개 골랐음');
  const more = root(page).locator('[data-photos-act-more]');
  await expect(more).toBeVisible();
  await more.click();
  await page.locator('#photosSelMenu').getByRole('button', { name: '정보 고치기…' }).click();
  const dlg = page.locator('#photoInfoDialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-pi-count]')).toHaveText('12장');
  await expect(dlg.locator('[data-pi-cam]')).toHaveText('카메라 SONY ILCE-7M4 · 렌즈 FE 24-70mm');
  await expect(dlg.locator('[data-pi-rows] tr')).toHaveCount(12);
  await expect(dlg.locator('[data-pi-save]')).toBeDisabled();
  await dlg.locator('[data-pi-h]').fill('8');
  // 앞→뒤 미리 보기: 첫 줄(가장 이른 1번) 14:00 → 06:00.
  await expect(dlg.locator('[data-pi-rows] tr.pi-changed')).toHaveCount(12);
  const row1 = dlg.locator('[data-pi-rows] tr', { hasText: 'DSC01.JPG' });
  await expect(row1.locator('td').nth(0)).toHaveText('2026.10.31 14:00');
  await expect(row1.locator('td').nth(1)).toHaveText('2026.10.31 06:00');
  await expect(dlg.locator('[data-pi-status]')).toHaveText('12장을 고쳐요');
  // 창이 하단바에 가리지 않는다.
  const box = await dlg.boundingBox(), bar = await page.locator('.mobile-tabs').boundingBox().catch(() => null);
  if (bar) expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 1);
  await dlg.locator('[data-pi-save]').click();
  const writes = await (async () => { await expect.poll(() => sentOf(page, /^photos:meta:write:/).then(x => x.length)).toBe(1); return sentOf(page, /^photos:meta:write:/); })();
  const items = JSON.parse(writes[0].slice('photos:meta:write:'.length)).items;
  expect(items).toHaveLength(12);
  expect(items.find(x => x.id === '1')).toEqual({ id: '1', taken: T0 - 8 * H });
  expect(items.every(x => !('loc' in x))).toBe(true);
  await expect(dlg).toBeHidden();
  // 서버 기록 12줄(사진 이름 없음), 목록은 새로 읽어 99가 맨 위로.
  await expect.poll(() => state.records.length).toBe(12);
  expect(state.records[0]).toMatchObject({ source: 'phone', loc_changed: false });
  expect(JSON.stringify(state.records)).not.toContain('DSC0');
  await expect.poll(() => ids(page)).toEqual(['ph:99', ...SONY]);
  await expect(page.locator('.kptu-notice')).toContainText('12장 고쳤어요');
  // [되돌리기] = 앞 시각으로 다시(한 번), undone_at 표시, 순서 원래대로.
  await page.locator('.kptu-notice-undo').click();
  await expect.poll(() => sentOf(page, /^photos:meta:write:/).then(x => x.length)).toBe(2);
  const back = JSON.parse((await sentOf(page, /^photos:meta:write:/))[1].slice('photos:meta:write:'.length)).items;
  expect(back.find(x => x.id === '1')).toEqual({ id: '1', taken: T0 });
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0].body).toHaveProperty('undone_at');
  expect(decodeURIComponent(state.patches[0].url)).toContain('item_key=in.("ms:');
  await expect.poll(() => ids(page)).toEqual([...SONY, 'ph:99']);
  expect(state.errors).toEqual([]);
});

