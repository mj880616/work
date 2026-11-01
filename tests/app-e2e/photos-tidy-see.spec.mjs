import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S47-19 정리 [보기] 그 줄 안 펼침(요청함 11/01 12:55·12:56): 정리 칸의 모든 [보기]는 그 줄 아래 사진 칸으로 펼치고(아래 [사진] 목록을 바꾸지 않음),
// 합계 용량·칸마다 용량·정렬 칩([용량 큰 순][찍은 날 최신][찍은 날 오래된])이 있다. 공간 비우기 수천 장도 처음 칸이 바로 보이고 내리면 이어 그린다.
// 펼친 칸 사진 → 크게 보기 → 뒤로가기 = 펼친 칸 그대로(명진 12:52 사례).
// 네트워크 없음(지어낸 서버·지어낸 앱), 사진은 1×1 그림.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.1';
const KEY = 'PhoneKeyForTest_0123456789';
const N = 3000;
// 2024년 사진 N장(1분 간격), 폰·원드라이브 둘 다(= 공간 비우기 후보). 크기는 번호마다 달라 i=7이 가장 크다.
const at = i => new Date(Date.parse('2024-03-01T00:00:00.000Z') + i * 60000).toISOString();
const sizeOf = i => (i === 7 ? 9_400_000 : 200_000 + i);
const base = i => ({ name: `IMG_${i}.jpg`, day: at(i).slice(0, 10), taken_at: at(i), size_bytes: sizeOf(i), approx: false, kind: 'photo', duration_ms: null, screenshot: false, uploaded_at: at(i) });
const OD = [
  ...Array.from({ length: N }, (_, i) => ({ id: `O${i}`, ...base(i) })),
  // 원드라이브에만(폰에서 지움): 2장
  { id: 'OX1', ...base(90001), name: 'gone1.jpg', taken_at: '2025-05-01T00:00:00.000Z', day: '2025-05-01', size_bytes: 1_500_000 },
  { id: 'OX2', ...base(90002), name: 'gone2.jpg', taken_at: '2025-06-01T00:00:00.000Z', day: '2025-06-01', size_bytes: 2_500_000 },
].sort((a, b) => b.taken_at.localeCompare(a.taken_at));
const PHONE = [
  ...Array.from({ length: N }, (_, i) => ({ id: String(i + 1), folder: 'DCIM/Camera/', width: 10, height: 10 + (i % 7), ...base(i) })),
  // 카톡 받은 사진 3장(원드라이브에 없음 = 백업 안 됨 폴더·잡동사니)
  ...[1, 2, 3].map(k => ({ id: String(80000 + k), folder: 'Pictures/KakaoTalk/', width: 10, height: 10, ...base(80000 + k), name: `k${k}.jpg`, size_bytes: k * 1_000_000,
    taken_at: `2026-0${k}-01T00:00:00.000Z`, day: `2026-0${k}-01` })),
].sort((a, b) => b.taken_at.localeCompare(a.taken_at));

async function fixture(page) {
  const state = { errors: [], tidyScans: 0 };
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
    // S47-20: 앱이 상태를 다시 알리는 것(앱이 다시 앞으로 옴·미디어 관리 허용 바꿈) 흉내.
    window.__phoneState = extra => listeners.forEach(fn => fn({ data: `photos:state:${JSON.stringify({ access: 'full', key, trash: true, hide: true, ...extra })}` }));
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
        if (offset === 0 && limit === 200 && !u.searchParams.get('folder')) state.tidyScans++; // 정리 찾기 첫 쪽
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
const cellIds = pane => pane.locator('[data-photos-tidy-open]').evaluateAll(els => els.map(e => e.dataset.photosId));

for (const width of [412, 1280]) {
  test.describe(`폰 앱 ${width}`, () => {
    test.use({ viewport: { width, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: width <= 760 });
    test('정리: 모든 [보기]는 그 줄 아래 펼침·합계 용량·칸마다 용량·정렬 칩, 수천 장도 처음 칸 바로, 크게 보기 → 뒤로 = 펼친 칸', async ({ page }) => {
      test.setTimeout(90_000);
      const state = await fixture(page);
      await openPhotos(page, width);
      const box = page.locator('#photosRoot [data-photos-tidy]');
      await page.locator('#photosRoot [data-photos-tidy-chip]').click();
      await expect(box.locator('.photos-tidy-at')).toContainText(`폰 ${N + 3}장 · 원드라이브 ${N + 2}장 확인`, { timeout: 30_000 });
      const listBefore = await page.locator('#photosRoot [data-photos-list] [data-photos-open]').count();

      // ③ 공간 비우기: 줄을 열면 그 안에 바로 칸(별도 [보기] 없음), 기본 용량 큰 순, 처음 60칸만.
      const space = box.locator('details[data-k="space"]');
      await expect(space.locator('[data-photos-tidy-see]')).toHaveCount(0);
      await space.locator('summary').click();
      const sp = space.locator('[data-photos-tidy-pane="space"]');
      await expect(sp).toBeVisible();
      await expect(sp.locator('.photos-tidy-pane-head .photos-tidy-num')).toHaveText(/^3000장 · 합계 \d+(\.\d)?GB$|^3000장 · 합계 \d+MB$/);
      await expect(sp.locator('[data-photos-tidy-open]')).toHaveCount(60);
      expect((await cellIds(sp))[0]).toBe('ph:8');
      await expect(sp.locator('[data-photos-tidy-open]').first().locator('.photos-tidy-size')).toHaveText('9.4MB');
      await expect(sp.locator('[data-photos-tidy-sort="space|size"]')).toHaveAttribute('aria-pressed', 'true');
      // 정렬 칩: 찍은 날 오래된 → 첫 칸이 가장 먼저 찍은 사진, 최신 → 가장 나중.
      await sp.locator('[data-photos-tidy-sort="space|old"]').click();
      await expect(sp.locator('[data-photos-tidy-sort="space|old"]')).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => (await cellIds(sp))[0]).toBe('ph:1');
      await sp.locator('[data-photos-tidy-sort="space|new"]').click();
      await expect.poll(async () => (await cellIds(sp))[0]).toBe(`ph:${N}`);
      // 내리면 이어 그린다.
      await sp.locator('[data-photos-tidy-more]').scrollIntoViewIfNeeded();
      await expect.poll(() => sp.locator('[data-photos-tidy-open]').count()).toBeGreaterThan(60);
      // 아래 [사진] 목록은 바뀌지 않는다(예전 '정리 · … 보는 중' 줄 없음).
      await expect(page.locator('#photosRoot [data-photos-tidy-top]')).toHaveCount(0);
      await space.locator('summary').click();

      // ⑤ 잡동사니 · 카톡 [보기] → 그 줄 바로 아래 칸, 용량 큰 순.
      const junk = box.locator('details[data-k="junk"]');
      await junk.locator('summary').click();
      const see = junk.locator('[data-photos-tidy-see="junk:kakao"]');
      await see.click();
      await expect(see).toHaveAttribute('aria-expanded', 'true');
      const kp = junk.locator('[data-photos-tidy-pane="junk:kakao"]');
      await expect(kp.locator('.photos-tidy-pane-head .photos-tidy-num')).toHaveText('3장 · 합계 6MB');
      await expect.poll(() => cellIds(kp)).toEqual(['ph:80003', 'ph:80002', 'ph:80001']);
      expect(await kp.evaluate(el => el.previousElementSibling?.querySelector('[data-photos-tidy-see]')?.dataset.photosTidySee)).toBe('junk:kakao');
      await see.click();
      await expect(kp).toHaveCount(0);

      // ② 백업 안 됨 폴더 [보기] → 그 폴더 사진.
      const unb = box.locator('details[data-k="unbacked"]');
      await unb.locator('summary').click();
      await unb.locator('[data-photos-tidy-see="unbacked:Pictures/KakaoTalk/"]').click();
      await expect(unb.locator('[data-photos-tidy-pane="unbacked:Pictures/KakaoTalk/"] [data-photos-tidy-open]')).toHaveCount(3);

      // ① 원드라이브에만 → 칩 줄 아래 칸 → 사진 크게 보기 → 뒤로 = 펼친 칸 그대로.
      await box.locator('[data-photos-place="onedrive"]').click();
      await expect(box.locator('[data-photos-place="onedrive"]')).toHaveAttribute('aria-pressed', 'true');
      const op = box.locator('[data-photos-tidy-pane="place:onedrive"]');
      await expect.poll(() => cellIds(op)).toEqual(['OX2', 'OX1']);
      await expect(op.locator('.photos-tidy-pane-head .photos-tidy-num')).toHaveText('2장 · 합계 4MB');
      await op.locator('[data-photos-tidy-open]').nth(1).click();
      const viewer = page.locator('[data-diary-viewer]');
      await expect(viewer).toBeVisible();
      await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('2 / 2');
      await page.goBack();
      await expect(viewer).toBeHidden();
      await expect(op).toBeVisible();
      await expect(op.locator('[data-photos-tidy-open]')).toHaveCount(2);
      await expect(page.locator('#photosView')).toBeVisible();
      // 다시 누르면 접힘.
      await box.locator('[data-photos-place="onedrive"]').click();
      await expect(op).toHaveCount(0);
      expect(await page.locator('#photosRoot [data-photos-list] [data-photos-open]').count()).toBe(listBefore);
      expect(state.errors).toEqual([]);
    });
  });
}

// S47-20 정리 줄마다 쉬운 설명 + 대안 · 찾은 결과 남겨 두기(요청함 11/01 12:57).
test.describe('폰 앱 412 정리 설명·결과 남겨 두기', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });
  test('줄마다 설명이 접혀도 보이고, 다시 열거나 앱이 상태를 다시 알려도 다시 찾지 않으며, [다시 찾기]만 새로 찾는다', async ({ page }) => {
    test.setTimeout(90_000);
    const state = await fixture(page);
    await openPhotos(page, 412);
    const box = page.locator('#photosRoot [data-photos-tidy]'), chip = page.locator('#photosRoot [data-photos-tidy-chip]');
    await chip.click();
    const at = box.locator('.photos-tidy-at');
    await expect(at).toContainText(`방금 찾음 · 폰 ${N + 3}장 · 원드라이브 ${N + 2}장 확인`, { timeout: 30_000 });
    expect(state.tidyScans).toBe(1);
    await expect(box.locator('[data-photos-tidy-rescan]')).toHaveCount(1);
    await expect(box.locator('.photos-tidy-foot')).toHaveCount(0);
    // 접힌 줄에도 쉬운 설명 한 줄.
    const unb = box.locator('details[data-k="unbacked"]');
    await expect(unb.locator('summary .photos-tidy-help')).toHaveText('이 폴더 사진은 원드라이브에서 한 장도 못 찾았어요. 폰을 잃어버리면 같이 사라져요');
    await expect(box.locator('details[data-k="space"] summary .photos-tidy-help')).toContainText('폰에서만 지워도 안전한 사진');
    await expect(box.locator('details[data-k="junk"] summary .photos-tidy-help')).toBeVisible();
    await expect(box.getByText('폰 사진과 원드라이브 사진을 이름·크기(또는 크기·찍은 시각)로 맞춰 봤어요')).toBeVisible();
    // 펼치면 대안 줄 + [폴더 끄기].
    await unb.locator('summary').click();
    await expect(unb.locator('.photos-tidy-do').first()).toContainText("동기화 앱(OneSync)에 이 폴더를 '업로드만'으로 추가하세요");
    const offBtn = unb.locator('[data-photos-tidy-off="Pictures/KakaoTalk/"]');
    await expect(offBtn).toHaveText('폴더 끄기');
    await offBtn.click();
    await expect(unb.locator('summary')).toContainText('꺼 둔 1개');
    await expect(offBtn).toHaveText('다시 켜기');
    // 정리 칸을 닫고, 앱이 상태를 다시 알린 뒤(미디어 관리 허용 바뀜) 다시 열어도 지난 결과 그대로.
    await chip.click();
    await expect(box).toBeHidden();
    await page.evaluate(() => window.__phoneState({ manage: true }));
    await chip.click();
    await expect(at).toContainText(`폰 ${N + 3}장`);
    await expect(box.getByRole('status')).toHaveCount(0);
    expect(state.tidyScans).toBe(1);
    await expect(at).not.toContainText('폰이 바뀌었어요');
    // [다시 찾기]만 새로 찾는다.
    await box.locator('[data-photos-tidy-rescan]').click();
    await expect.poll(() => state.tidyScans).toBe(2);
    await expect(at).toContainText(`방금 찾음 · 폰 ${N + 3}장`, { timeout: 30_000 });
    expect(state.errors).toEqual([]);
  });
});
