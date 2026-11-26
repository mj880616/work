import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S52-06 PHOTO-폰지우기안전장치(사용자 11/07 '모두 추천대로'): 폰 폴더째 [삭제]는 백업을 확인하지 못하면 체크해야만 폰 휴지통으로.
// S71-25 PHOTO-정리삭제(사용자 결정: 정리 기능 삭제): [정리] 칸(잡동사니·공간 비우기·크게 보기 한 장 지우기)은 지웠다 —
// 그 길의 시험도 함께 지웠고, 폴더째 삭제는 [정리]가 읽어 둔 백업 수 없이 늘 '확인하지 못함' + 체크해야만.
// 네트워크 없음(지어낸 서버·지어낸 앱 다리), 사진은 1×1 그림. 폰 휴지통 = 안드로이드 휴지통(앱 다리 photos:trash, 30일 되살림).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.11';
const KEY = 'PhoneKeyForTest_0123456789';
const base = (name, taken, size) => ({ name, day: taken.slice(0, 10), taken_at: taken, size_bytes: size, approx: false, kind: 'photo', duration_ms: null, screenshot: false, uploaded_at: taken });
// 카메라 4장(2024, 원드라이브에도 있음 = 공간 비우기 후보), 카톡 받은 사진 3장 중 k1만 원드라이브에도 있음.
const CAM = [1, 2, 3, 4].map(i => ({ id: String(i), folder: 'DCIM/Camera/', width: 10, height: 10, ...base(`IMG_${i}.jpg`, `2024-03-0${i}T00:00:00.000Z`, i * 1_000_000) }));
const KAKAO = [1, 2, 3].map(k => ({ id: String(80000 + k), folder: 'Pictures/KakaoTalk/', width: 10, height: 10, ...base(`k${k}.jpg`, `2026-0${k}-01T00:00:00.000Z`, k * 1_000_000) }));
const PHONE = [...CAM, ...KAKAO].sort((a, b) => b.taken_at.localeCompare(a.taken_at));
const OD = [...CAM.map(p => ({ id: `O${p.id}`, ...base(p.name, p.taken_at, p.size_bytes) })), { id: 'OK1', ...base('k1.jpg', KAKAO[0].taken_at, KAKAO[0].size_bytes) }]
  .sort((a, b) => b.taken_at.localeCompare(a.taken_at));

async function fixture(page) {
  const state = { errors: [], bodies: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await page.addInitScript(key => {
    const listeners = [];
    window.__photoSent = []; window.__trashed = [];
    const say = data => setTimeout(() => listeners.forEach(fn => fn({ data })), 0);
    window.KPTUAppShell = {
      postMessage(m) {
        m = String(m); window.__photoSent.push(m);
        if (m === 'photos:hello' || m === 'photos:ask') say(`photos:state:{"access":"full","key":"${key}","trash":true,"hide":true,"ops":true,"manage":false,"edit":true,"restore":true}`);
        else if (m.startsWith('photos:op:')) say('photos:done:{"ok":true,"count":3,"error":"","path":null}');
        else if (m.startsWith('photos:trash:')) { const ids = m.slice('photos:trash:'.length).split(','); window.__trashed.push(...ids); say(`photos:trashed:{"ok":true,"count":${ids.length}}`); }
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    };
  }, KEY);
  await installViewPrefsServer(page, { photo_sources_phone: { onedrive: true, gdrive: false, phone: true } });
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
      if (body.action === 'library') return r.fulfill({ json: { items: OD, next_cursor: null, indexing: false } });
      if (body.action === 'months') return r.fulfill({ json: { months: { '2024-03': 4, '2026-01': 1 }, total: OD.length } });
      if (body.action === 'trash-watch') return r.fulfill({ json: { gone: 0 } });
      if (body.action === 'copy-check') return r.fulfill({ json: { ok: body.pairs.map(p => p.id), missing: [], unsure: [] } });
      if (body.action === 'trash-log') return r.fulfill({ json: { saved: body.pairs.length } });
      if (body.action === 'kept-list') return r.fulfill({ json: { items: [] } });
      if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: OD.length, total: OD.length }, folders: [], indexing: false } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route('**/__phone/**', async r => {
      const u = new URL(r.request().url());
      if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({ status: 404, body: '' });
      const gone = await page.evaluate(() => window.__trashed || []).catch(() => []);
      const list = PHONE.filter(p => !gone.includes(p.id));
      if (u.pathname.endsWith('/page')) {
        const offset = Number(u.searchParams.get('offset') || 0), limit = Number(u.searchParams.get('limit') || 120);
        return r.fulfill({ json: { items: list.slice(offset, offset + limit), next: offset + limit < list.length ? offset + limit : null, total: list.length } });
      }
      if (u.pathname.endsWith('/folders')) return r.fulfill({ json: { folders: [{ id: 'DCIM/Camera/', name: 'Camera', count: 4, cover: CAM[0] }, { id: 'Pictures/KakaoTalk/', name: 'KakaoTalk', count: 3, cover: KAKAO[0] }] } });
      if (u.pathname.endsWith('/months')) return r.fulfill({ json: { months: {} } });
      if (u.pathname.endsWith('/days')) return r.fulfill({ json: { days: {} } });
      if (u.pathname.includes('/thumb/')) return r.fulfill({ status: 200, contentType: 'image/jpeg', body: PNG });
      return r.fulfill({ status: 404, body: '' });
    });
  } });
  return state;
}
const ask = page => page.locator('.kptu-ask:not(.kptu-ask-choice)');
async function openPhotos(page) {
  // S68-37: 저장된 메뉴 순서가 없는 계정은 [사진]이 기본 하단바 칸, 순서를 저장한 계정은 [메뉴] 창 칸이다.
  if (await page.locator('.mobile-tabs [data-view="photos"]').isVisible()) await page.locator('.mobile-tabs [data-view="photos"]').click();
  else { await page.locator('#mobileMenuTab').click(); await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click(); }
  await expect(page.locator('#photosView')).toBeVisible();
}

test.describe('폰 앱 412 · 폰 폴더째 삭제 안전장치', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  test('폰 폴더째 [삭제]: 백업을 확인하지 못했으니 체크해야만 폴더를 폰 휴지통으로', async ({ page }) => {
    const state = await fixture(page);
    await openPhotos(page);
    await page.locator('[data-sf-tools="photos"] [data-photos-view]').selectOption('folders');
    const row = page.locator('#photosRoot [data-photos-pf="Pictures/KakaoTalk/"]');
    await row.locator('[data-photos-pf-more]').click();
    await page.locator('#photosPhoneFolderMenu').getByRole('button', { name: '삭제', exact: true }).click();
    await expect(ask(page).locator('.kptu-ask-text')).toHaveText("'KakaoTalk' 폴더를 삭제할까요?");
    await expect(ask(page).locator('.kptu-ask-note')).toContainText('안의 사진 3장(하위 폴더 포함)이 폰 휴지통으로 가요');
    await expect(ask(page).locator('.kptu-ask-note')).toContainText('원드라이브 백업 여부를 확인하지 못했어요');
    await expect(ask(page).locator('.kptu-ask-note')).not.toContainText('정리');
    const ok = ask(page).getByRole('button', { name: '삭제', exact: true });
    await expect(ok).toBeDisabled();
    await ask(page).locator('[data-ask-check]').check();
    await ok.click();
    // 앱 다리가 '미디어 관리 허용' 꺼짐이라 한 번 묻는다(예전 그대로) → [취소]면 폰 확인 창으로 진행.
    await expect(ask(page).locator('.kptu-ask-text')).toContainText('미디어 관리 허용');
    await ask(page).getByRole('button', { name: '취소' }).click();
    await expect.poll(() => page.evaluate(() => window.__photoSent.filter(m => m.startsWith('photos:op:')))).toEqual(['photos:op:{"op":"trashfolder","from":"Pictures/KakaoTalk/"}']);
    // 폰 사진 전체를 미리 읽는 [정리] 찾기는 없다(폴더 삭제가 폰 사진 전부를 읽지 않음).
    expect(state.bodies.filter(b => b.action === 'trash-watch')).toEqual([]);
    expect(state.errors).toEqual([]);
  });
});
