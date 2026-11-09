import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S49-23 PHOTO-크게보기메뉴통일 (요청함 11/04 07:36): 사진 크게 보기 아래 줄 = 사진 고르기 아래 줄과 같은 부품·같은 목록.
// 폰 412·폴드 884·PC 1440에서 (1) 크게 보기 줄 항목이 고르기 줄과 같고(크게 보기에만 [정보]), (2) 버튼이 지금 사진 1장에 동작한다.
// 네트워크 없음(지어낸 서버·지어낸 앱), 사진은 1×1 그림.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.7';
const KEY = 'PhoneKeyForTest_0123456789';
const OD = [
  { id: 'O1', name: 'a.png', day: '2026-10-30', taken_at: '2026-10-30T03:00:00.000Z', size_bytes: 111 },
].map(m => ({ ...m, approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: m.taken_at }));
const PHONE = [
  { id: '1', name: 'IMG_1.jpg', day: '2026-10-31', taken_at: '2026-10-31T03:00:00.000Z', size_bytes: 10 },
].map(m => ({ ...m, approx: false, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: m.taken_at }));

async function fixture(page, { app = false, edit = true, out = true } = {}) {
  const state = { errors: [], phoneReads: [], edge: [], moves: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  if (app) {
    // 앱 다리 흉내: 상태(edit), 편집(번호 1·77은 바뀜, 원드라이브 사진은 폰에 없음), 받기(시작·조각·끝 → 번호 77).
    await page.addInitScript(({ key, edit, out }) => {
      const listeners = [];
      window.__photoSent = [];
      const say = data => setTimeout(() => listeners.forEach(fn => fn({ data })), 0);
      let got = 0;
      const prev = window.KPTUAppShell;
      window.KPTUAppShell = {
        postMessage(m) {
          m = String(m);
          window.__photoSent.push(m.startsWith('photos:save:part:') ? 'photos:save:part' : m.startsWith('out:part:') ? 'out:part' : m);
          if (m === 'photos:hello' || m === 'photos:ask') say(`photos:state:{"access":"full","key":"${key}","trash":true,"hide":true,"ops":true,"manage":false${edit ? ',"edit":true' : ''}}`);
          else if (m.startsWith('photos:edit:')) {
            const t = JSON.parse(m.slice('photos:edit:'.length));
            say(t.id ? 'photos:edited:{"ok":true,"changed":true,"error":""}' : 'photos:edited:{"ok":false,"changed":false,"error":"none"}');
          } else if (m.startsWith('photos:save:begin:')) { got = 0; say('photos:save:{"ok":true,"step":"begin","got":0,"error":""}'); }
          else if (m.startsWith('photos:save:part:')) { got += atob(m.slice('photos:save:part:'.length)).length; say(`photos:save:{"ok":true,"step":"part","got":${got},"error":""}`); }
          else if (m === 'photos:save:end') say(`photos:save:{"ok":true,"step":"end","got":${got},"id":"77","error":""}`);
          // PHOTO-폰앱공유(0.4.7): 공유 창 다리. out=false면 옛 앱(답 없음).
          else if (m.startsWith('out:') && out) {
            const step = m === 'out:go' || m === 'out:clip' ? 'sent' : m.slice(4).split(':')[0];
            if (step === 'hello') say('out:state:{"v":1}');
            else if (step === 'sent') say('out:sent:{"ok":true,"error":""}');
            else if (step !== 'cancel') say(`out:ack:{"ok":true,"step":"${step}","error":""}`);
          }
          prev?.postMessage?.(m);
        },
        addEventListener(type, fn) { if (type === 'message') listeners.push(fn); prev?.addEventListener?.(type, fn); },
      };
    }, { key: KEY, edit, out });
  }
  // PHOTO-기기별출처(S49-5): 폰 앱 기본은 폰 폴더만이므로, 원드라이브·폰 사진이 함께 보이는 목록을 쓰는 이 시험은 둘 다 켠 채 시작한다.
  await installViewPrefsServer(page, { photo_sources_phone: { onedrive: true, gdrive: false, phone: true } });
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      state.edge.push(body.action + (body.purpose ? ':' + body.purpose : ''));
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'media-url') return r.fulfill({ json: { url: `${CDN}/orig/${body.id}.png`, kind: 'photo', name: 'a.png', expires_in: 3000 } });
      if (body.action === 'library') { if (state.gate) await state.gate; return r.fulfill({ json: { items: OD, next_cursor: null, indexing: false } }); }
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': OD.length }, total: OD.length } });
      if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'TOP', name: '카메라', count: 1, total: 1 }, folders: [{ id: 'F1', name: '여행', parent_id: 'TOP', count: 0, total: 0 }], indexing: false, whole: true } });
      if (body.action === 'photos-move') { state.moves.push({ ids: body.ids, to: body.parent_id }); return r.fulfill({ json: { moved: body.ids.map(id => ({ id, from: 'TOP' })), failed: {} } }); }
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route('**/__phone/**', r => {
      const u = new URL(r.request().url());
      state.phoneReads.push(u.pathname.replace(/^.*__phone\//, '') + u.search);
      if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({ status: 404, body: '' });
      if (u.pathname.endsWith('/page')) return r.fulfill({ json: { items: PHONE, next: null, total: PHONE.length } });
      if (u.pathname.endsWith('/months')) return r.fulfill({ json: { months: { '2026-10': PHONE.length } } });
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
const ids = page => page.locator('#photosRoot [data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));
const viewer = page => page.locator('[data-diary-viewer]');
const outSent = page => page.evaluate(() => window.__photoSent.filter(m => m.startsWith('out:') && m !== 'out:hello'));
const trashSent = page => page.evaluate(() => window.__photoSent.filter(m => m.startsWith('photos:trash')));


const menu = page => page.locator('#shareMenu');
const press = async (page, locator, { hold = 700, move = 0 } = {}) => {
  const b = await locator.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  if (move) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + move, y }] });
  await page.waitForTimeout(hold);
  return { cdp, end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) };
};


const bar = page => page.locator('[data-diary-viewer] .diary-viewer-actions');
const barNames = async page => (await bar(page).locator('button:visible .kptu-act-tx').allTextContents()).map(t => t.replace('▾', '').trim());
// PHOTO-아래줄정돈(S49-34, 명진 결정 11/04 12:06 A안): 아래 줄 다섯 칸, 나머지는 [공유 ▾]·[편집 ▾]·[더보기] 안 글자 항목.
const BAR_NAMES = ['별표', '공유', '수정', '삭제', '메뉴'];
const barMenu = page => page.locator('#photoBarMenu, #shareMenu').locator('button:visible');
const menuTexts = async (page, trigger) => { await trigger.click(); const t = await barMenu(page).allTextContents(); await page.keyboard.press('Escape'); await expect(page.locator('#photoBarMenu, #shareMenu').locator('button:visible')).toHaveCount(0); return t; };
const pickItem = async (page, trigger, text) => { await trigger.click(); await page.locator('#photoBarMenu, #shareMenu').getByRole('button', { name: text, exact: true }).click(); };

for (const [label, width, height] of [['폰 412', 412, 915], ['폴드 884', 884, 800], ['PC 1440', 1440, 900]]) {
  test.describe(`${label} — 크게 보기 아래 줄`, () => {
    test.use({ viewport: { width, height }, userAgent: ANDROID, hasTouch: width < 761, isMobile: width < 761 });

    test('크게 보기 줄 = 다섯 칸, 빠진 기능은 ▾·더보기 안에 있다', async ({ page }) => {
      const state = await fixture(page, { app: true });
      await openPhotos(page, width);
      await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
      await page.locator('#photosRoot [data-photos-id="ph:1"]').click();
      await expect(viewer(page)).toBeVisible();
      await expect(viewer(page).locator('.diary-slide .diary-photo[data-state="shown"]').first()).toBeVisible();
      expect(await barNames(page)).toEqual(BAR_NAMES);
      expect(await bar(page).locator('button:visible').count()).toBeLessThanOrEqual(5);
      const b = bar(page);
      expect(await menuTexts(page, b.locator('[data-diary-share]'))).toEqual(['사진 복사', '일기에 넣기', '업데이트로 보내기', '받기', '다른 앱으로 공유…']);
      expect(await menuTexts(page, b.locator('[data-strip-act="edit"]'))).toEqual(['사진 수정']); // 정보수정은 폰 앱 0.4.15(meta)부터라 이 흉내(0.4.7)에는 없다 — photos-info-edit.spec.mjs가 본다
      const more = await menuTexts(page, b.locator('[data-strip-act="more"]'));
      expect(more).toEqual(['정보', '폴더로 옮기기', '앨범에 넣기']);
      // 한 줄: 줄 바꿈·잘림 없음, 아이콘은 모두 선 아이콘(svg)
      const fit = await b.evaluate(el => ({ wrap: new Set([...el.querySelectorAll('button:not([hidden])')].map(x => Math.round(x.getBoundingClientRect().top))).size, over: el.scrollWidth > el.clientWidth, svg: el.querySelectorAll('button:not([hidden]) .kptu-act-ic svg').length, all: el.querySelectorAll('button:not([hidden])').length }));
      if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/viewer-${width}.png` });
      expect(fit.wrap).toBe(1);
      expect(fit.over).toBe(false);
      expect(fit.svg).toBe(fit.all);
      expect(state.errors).toEqual([]);
    });

    test('항목이 지금 사진 1장에 동작: 별표·정보·앨범·옮기기·업데이트로 보내기(알림이 보임)·삭제', async ({ page }) => {
      const state = await fixture(page, { app: true });
      await openPhotos(page, width);
      await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
      await page.locator('#photosRoot [data-photos-id="O1"]').click();
      await expect(viewer(page)).toBeVisible();
      await expect(viewer(page).locator('.diary-slide .diary-photo[data-state="shown"]').first()).toBeVisible();
      const b = bar(page), more = b.locator('[data-strip-act="more"]');
      await b.locator('[data-diary-star]').click();
      await expect(b.locator('[data-diary-star]')).toHaveAttribute('aria-pressed', 'true');
      // 정보 판 열기·닫기(더보기 안 [정보])
      await pickItem(page, more, '정보');
      await expect(viewer(page).locator('[data-diary-viewer-info]')).toBeVisible();
      await pickItem(page, more, '정보');
      await expect(viewer(page).locator('[data-diary-viewer-info]')).toBeHidden();
      // 앨범에 넣기: 작은 메뉴가 사진 위에 뜨고 Esc로 닫힌다
      await pickItem(page, more, '앨범에 넣기');
      await expect(page.locator('#photosPickMenu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#photosPickMenu')).toBeHidden();
      // 폴더로 옮기기: 폴더를 고르면 지금 보는 사진 1장(O1)만 그 폴더로
      await pickItem(page, more, '폴더로 옮기기');
      await expect(page.locator('#photosPickMenu')).toBeVisible();
      await page.locator('#photosPickMenu [data-pick-folder="F1"]').click();
      await expect.poll(() => state.moves).toEqual([{ ids: ['O1'], to: 'F1' }]);
      await expect(page.locator('#kptuNotice')).toContainText('옮겼어요');
      // 지우기: 다음 사진으로 넘어간다(2장 → 1장)
      await expect(viewer(page).locator('[data-diary-viewer-count]')).toHaveText(/\/ 2/);
      await b.locator('[data-od-delete]').click();
      await expect(viewer(page).locator('[data-diary-viewer-count]')).toHaveText(/\/ 1/);
      expect(state.errors).toEqual([]);
    });

    // PHOTO-옮긴뒤삭제: 옮긴 직후 목록 응답이 늦어도 [삭제]는 지금 사진을 지우고 다음 사진으로 넘어간다(조용히 무시되지 않는다).
    test('옮긴 직후(목록 응답을 일부러 늦춰서) [삭제]를 누르면 지워지고 다음 사진으로 넘어간다', async ({ page }) => {
      const state = await fixture(page, { app: true });
      await openPhotos(page, width);
      await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
      await page.locator('#photosRoot [data-photos-id="O1"]').click();
      await expect(viewer(page)).toBeVisible();
      await expect(viewer(page).locator('.diary-slide .diary-photo[data-state="shown"]').first()).toBeVisible();
      let release; state.gate = new Promise(r => { release = r; });
      try {
        const b = bar(page);
        await pickItem(page, b.locator('[data-strip-act="more"]'), '폴더로 옮기기');
        await page.locator('#photosPickMenu [data-pick-folder="F1"]').click();
        await expect.poll(() => state.moves).toEqual([{ ids: ['O1'], to: 'F1' }]);
        await expect(page.locator('#kptuNotice')).toContainText('옮겼어요');
        await expect(viewer(page).locator('[data-diary-viewer-count]')).toHaveText(/\/ 2/);
        await b.locator('[data-od-delete]').click();
        await expect(viewer(page).locator('[data-diary-viewer-count]')).toHaveText(/\/ 1/);
        await expect(viewer(page).locator('[data-diary-undo]')).toBeVisible();
      } finally { release(); }
      expect(state.errors).toEqual([]);
    });

    // PHOTO-업데이트반응없음(S49-34): 누르면 곧바로 '보내는 중'/결과 알림이 크게 보기 위에 보여야 한다(예전에는 크게 보기 뒤에 깔려 반응이 없어 보임).
    test('[공유 ▾] → 업데이트로 보내기·일기에 넣기: 알림이 크게 보기 위에 보인다', async ({ page }) => {
      const state = await fixture(page, { app: true });
      await openPhotos(page, width);
      await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
      await page.locator('#photosRoot [data-photos-id="O1"]').click();
      await expect(viewer(page).locator('.diary-slide .diary-photo[data-state="shown"]').first()).toBeVisible();
      await pickItem(page, bar(page).locator('[data-diary-share]'), '업데이트로 보내기');
      const note = page.locator('#kptuNotice');
      await expect(note).toBeVisible();
      // 알림은 누름을 받지 않는 칸(pointer-events:none)이라 elementFromPoint로는 못 잡는다 → 겹침 순서(z-index)가 크게 보기보다 위인지 본다.
      const z = await page.evaluate(() => ({ note: Number(getComputedStyle(document.getElementById('kptuNotice')).zIndex), viewer: Number(getComputedStyle(document.querySelector('[data-diary-viewer]')).zIndex) }));
      expect(z.note).toBeGreaterThan(z.viewer);
      await expect(note).toContainText(/업데이트로 보|사진 받는 중|받지 못했|보내지 못했/);
      expect(state.errors).toEqual([]);
    });
  });
}
