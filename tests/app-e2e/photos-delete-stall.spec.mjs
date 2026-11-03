import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S48-52 PHOTO-지우기멈춤(요청함 11/03 07:41 ★급★): 폰 앱에서 고른 사진 [지우기]가 반응 없거나 '확인하는 중…'에서 멈추던 것.
// - 폰 사진 5000장 + 원드라이브 5000장, 원드라이브 응답은 한 번에 0.8초(느림 흉내) — 예전처럼 전체를 다시 읽으면 25번 × 0.8초 = 20초.
//   고른 사진의 찍은 시각 근처만 읽으므로 3초 안에 두 갈래 고르기 창이 뜬다.
// - 원드라이브가 답하지 않으면 15초 뒤 '확인이 오래 걸려 지우지 않았어요 [다시]', 그동안 다시 누르면 '확인 중이에요'. [다시]는 다시 확인한다.
// - 같은 PR ⑤(요청함 11/03 07:46): 작은 알림이 고르기 창 뒤에 남지 않고, 화면을 옮기면 닫힌다.
// 네트워크 없음(지어낸 서버·지어낸 앱), 사진은 1×1 그림.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.11';
const KEY = 'PhoneKeyForTest_0123456789';
const N = 5000, T0 = Date.parse('2026-10-31T04:00:00.000Z'), SLOW_MS = 800;
const iso = ms => new Date(ms).toISOString();
const dayOf = ms => iso(ms).slice(0, 10);
// 폰 i번(1부터) = 1분 간격, 최근 먼저. 원드라이브 O<i> = 같은 이름·크기·시각의 사본.
const PHONE = Array.from({ length: N }, (_, i) => {
  const t = T0 - i * 60000;
  return { id: String(i + 1), name: `IMG_${i + 1}.jpg`, day: dayOf(t), taken_at: iso(t), size_bytes: 1000 + i, folder: 'DCIM/Camera/',
    approx: false, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: iso(t) };
});
const OD = PHONE.map(p => ({ id: 'O' + p.id, name: p.name, day: p.day, taken_at: p.taken_at, size_bytes: p.size_bytes,
  approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: p.taken_at }));
const months = list => list.reduce((m, p) => ((m[p.day.slice(0, 7)] = (m[p.day.slice(0, 7)] || 0) + 1), m), {});

async function fixture(page) {
  const state = { errors: [], bodies: [], hang: false, checkCalls: 0 };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await page.addInitScript(({ key }) => {
    const listeners = [];
    window.__photoSent = []; window.__trashed = [];
    const say = data => setTimeout(() => listeners.forEach(fn => fn({ data })), 0);
    window.KPTUAppShell = {
      postMessage(m) {
        m = String(m);
        window.__photoSent.push(m);
        if (m === 'photos:hello' || m === 'photos:ask') say(`photos:state:{"access":"full","key":"${key}","trash":true,"hide":true,"ops":true,"manage":false,"edit":true,"restore":true}`);
        else if (m.startsWith('photos:trash:')) { const ids = m.slice('photos:trash:'.length).split(','); window.__trashed.push(...ids); say(`photos:trashed:{"ok":true,"count":${ids.length}}`); }
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    };
  }, { key: KEY });
  // PHOTO-기기별출처(S49-5): 폰 앱 기본은 폰 폴더만이므로, 원드라이브·폰 사진이 함께 보이는 목록을 쓰는 이 시험은 둘 다 켠 채 시작한다.
  await installViewPrefsServer(page, { photo_sources_phone: { onedrive: true, gdrive: false, phone: true } });
  const library = body => {
    const c = body.cursor;
    const start = c ? OD.findIndex(o => o.taken_at < c.t || (o.taken_at === c.t && o.id < c.id)) : 0;
    if (start < 0) return { items: [], next_cursor: null, indexing: false };
    const items = OD.slice(start, start + (body.limit || 120)), last = items[items.length - 1];
    return { items, next_cursor: start + items.length < OD.length && last ? { t: last.taken_at, id: last.id } : null, indexing: false };
  };
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      state.bodies.push(body);
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'library') {
        // 지우기 짝 확인 읽기(첫 자리 id '!')는 hang이면 답하지 않는다(hang이 풀릴 때까지 기다림).
        const check = body.cursor?.id === '!';
        if (check) state.checkCalls++;
        while (check && state.hang) await new Promise(ok => setTimeout(ok, 200));
        await new Promise(ok => setTimeout(ok, SLOW_MS));
        return r.fulfill({ json: library(body) }).catch(() => {});
      }
      if (body.action === 'months') return r.fulfill({ json: { months: months(OD), total: OD.length } });
      if (body.action === 'days') return r.fulfill({ json: { days: {} } });
      if (body.action === 'trash-watch') return r.fulfill({ json: { gone: 0, checked: 0 } });
      if (body.action === 'kept-list') return r.fulfill({ json: { items: [] } });
      if (body.action === 'copy-check') return r.fulfill({ json: { ok: body.pairs.map(p => p.id), missing: [], unsure: [] } });
      if (body.action === 'trash-log') return r.fulfill({ json: { saved: body.pairs.length } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route('**/__phone/**', async r => {
      const u = new URL(r.request().url());
      if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({ status: 404, body: '' });
      const gone = await page.evaluate(() => window.__trashed || []).catch(() => []);
      const list = PHONE.filter(p => !gone.includes(p.id));
      if (u.pathname.endsWith('/page')) {
        const q = u.searchParams, before = Number(q.get('before')) || 0, offset = Number(q.get('offset')) || 0, limit = Number(q.get('limit')) || 120;
        const from = before ? list.findIndex(p => Date.parse(p.taken_at) < before) : 0;
        if (from < 0) return r.fulfill({ json: { items: [], next: null, total: list.length } });
        const items = list.slice(from + offset, from + offset + limit);
        return r.fulfill({ json: { items, next: from + offset + limit < list.length ? offset + limit : null, total: list.length } });
      }
      if (u.pathname.endsWith('/months')) return r.fulfill({ json: { months: months(list) } });
      if (u.pathname.endsWith('/days')) return r.fulfill({ json: { days: {} } });
      if (u.pathname.endsWith('/folders')) return r.fulfill({ json: { folders: [] } });
      if (u.pathname.includes('/thumb/')) return r.fulfill({ status: 200, contentType: 'image/jpeg', body: PNG });
      return r.fulfill({ status: 404, body: '' });
    });
  } });
  return state;
}
const root = page => page.locator('#photosRoot');
const cellOf = (page, id) => root(page).locator(`[data-photos-list] [data-photos-id="${id}"]`);
const choice = page => page.locator('.kptu-ask.kptu-ask-choice');
const notice = page => page.locator('#kptuNotice');
async function hold(page, locator) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
}
// 원드라이브 칩을 끈 폰 사진 보기에서 폰 사진 1번을 고른다(짝 = 원드라이브 O1, 읽어야 찾음).
async function pickPhoneOne(page) {
  await page.locator('#mobileMenuTab').click();
  await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
  await expect(cellOf(page, 'O1')).toBeVisible({ timeout: 15000 });
  await root(page).locator('[data-photos-src="onedrive"]').click();
  await expect(root(page).locator('[data-photos-src="onedrive"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(cellOf(page, 'ph:1')).toBeVisible({ timeout: 15000 });
  await hold(page, cellOf(page, 'ph:1'));
  await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('1개 골랐음');
}

test.describe('폰 앱 412 · 사진 5000장 · 느린 원드라이브', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  test('[지우기] → 3초 안 두 갈래 고르기 창(고른 사진 근처만 읽음), 확인 알림은 창 뒤에 남지 않음', async ({ page }) => {
    test.setTimeout(90000);
    const state = await fixture(page);
    await pickPhoneOne(page);
    const before = state.bodies.length;
    const t = Date.now();
    await root(page).locator('[data-photos-act-delete]').click();
    await expect(choice(page)).toBeVisible({ timeout: 3000 });
    expect(Date.now() - t).toBeLessThan(3000);
    const picks = choice(page).locator('[data-ask-pick]');
    await expect(picks.nth(0)).toContainText('폰 공간만 비우기 · 1장');
    // 원드라이브 읽기는 고른 사진 시각 근처 한 번(전체 25쪽이 아님), 첫 자리는 찍은 시각 + 2초.
    const reads = state.bodies.slice(before).filter(b => b.action === 'library' && b.cursor?.id === '!');
    expect(reads.length).toBe(1);
    expect(reads[0].cursor).toEqual({ t: iso(T0 + 2001), id: '!' });
    // '원드라이브 원본 확인 중…' 알림은 고르기 창이 뜨면 닫혀 있다.
    await expect(notice(page)).toBeHidden();
    await picks.nth(0).click();
    await expect.poll(() => page.evaluate(() => window.__photoSent.filter(m => m.startsWith('photos:trash:')))).toEqual(['photos:trash:1']);
    expect(state.bodies.find(b => b.action === 'copy-check').pairs).toEqual([{ id: 'O1', size: 1000 }]);
    await expect(notice(page)).toContainText('폰 공간을 비웠어요');
    // ⑤ 다른 화면으로 옮기면 사진 화면의 알림은 닫힌다.
    await page.waitForTimeout(600);
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '자료실', exact: true }).click();
    await expect(notice(page)).toBeHidden();
    expect(state.errors).toEqual([]);
  });

  test('원드라이브가 답하지 않으면 15초 뒤 안내·[다시], 확인 중 다시 누르면 "확인 중이에요"', async ({ page }) => {
    test.setTimeout(120000);
    const state = await fixture(page);
    await pickPhoneOne(page);
    state.hang = true;
    const t = Date.now();
    await root(page).locator('[data-photos-act-delete]').click();
    await expect(notice(page)).toContainText('원드라이브 원본 확인 중…');
    await expect(notice(page).getByRole('button', { name: '취소' })).toBeVisible();
    // 확인 중에 다시 누름: 조용히 무시하지 않는다.
    await root(page).locator('[data-photos-act-delete]').click();
    await expect(notice(page)).toContainText('확인 중이에요');
    // 15초 뒤: 지우지 않고 안내 + [다시].
    await expect(notice(page)).toContainText('확인이 오래 걸려 지우지 않았어요', { timeout: 20000 });
    expect(Date.now() - t).toBeGreaterThanOrEqual(14500);
    await expect(choice(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__photoSent.filter(m => m.startsWith('photos:trash:')))).toEqual([]);
    // [다시]: 원드라이브가 다시 답하면 고르기 창.
    state.hang = false;
    const calls = state.checkCalls;
    await notice(page).getByRole('button', { name: '다시' }).click();
    await expect(choice(page)).toBeVisible({ timeout: 5000 });
    expect(state.checkCalls).toBeGreaterThan(calls);
    await expect(choice(page).locator('[data-ask-pick]').nth(0)).toContainText('폰 공간만 비우기 · 1장');
    expect(state.errors).toEqual([]);
  });

  test('[취소]: 확인을 멈추고 지우지 않음, 다시 누르면 다시 확인', async ({ page }) => {
    test.setTimeout(90000);
    const state = await fixture(page);
    await pickPhoneOne(page);
    state.hang = true;
    await root(page).locator('[data-photos-act-delete]').click();
    await notice(page).getByRole('button', { name: '취소' }).click();
    await expect(notice(page)).toContainText('지우지 않았어요');
    state.hang = false;
    await root(page).locator('[data-photos-act-delete]').click();
    await expect(choice(page)).toBeVisible({ timeout: 5000 });
    expect(state.errors).toEqual([]);
  });
});
