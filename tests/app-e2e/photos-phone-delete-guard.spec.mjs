import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S52-06 PHOTO-폰지우기안전장치(명진 11/07 '모두 추천대로' — 사진 정리 다음 순서 A): 사진 정리 칸에서 폰 원본을 지우는 길.
// - 잡동사니 [지우기]: 서버가 원드라이브 사본을 확인한 것만 기본으로 지우고, 백업 없음은 체크해야만 함께. 지우기 전 개수·용량 요약 한 번.
// - 공간 비우기 [폰 공간만 비우기]: 요약에 용량.
// - 정리 칸 크게 보기 한 장 [지우기]: 되돌리기 시간 뒤가 아니라 바로 같은 요약 확인(백업 없음 한 장은 체크해야만).
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
const trashed = page => page.evaluate(() => window.__photoSent.filter(m => m.startsWith('photos:trash:')).flatMap(m => m.slice('photos:trash:'.length).split(',')).sort());
const ask = page => page.locator('.kptu-ask:not(.kptu-ask-choice)');
async function openTidy(page) {
  await page.locator('#mobileMenuTab').click();
  await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
  const box = page.locator('#photosRoot [data-photos-tidy]');
  await page.locator('#photosRoot [data-photos-tidy-chip]').click();
  await expect(box.locator('.photos-tidy-at')).toContainText('폰 7장 · 원드라이브 5장 확인', { timeout: 30_000 });
  return box;
}
async function openJunk(box) {
  const junk = box.locator('details[data-k="junk"]');
  await junk.locator('summary').click();
  return junk;
}

test.describe('폰 앱 412 · 사진 정리 삭제 안전장치', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  test('잡동사니 [삭제]: 요약 한 번, 백업 없음 2장은 기본으로 남기고 사본 확인된 1장만 폰 휴지통', async ({ page }) => {
    const state = await fixture(page);
    const junk = await openJunk(await openTidy(page));
    await junk.locator('[data-photos-tidy-trash="kakao"]').click();
    await expect(ask(page).locator('.kptu-ask-text')).toHaveText('카톡 받은 사진 1장(1MB)을 폰 휴지통으로 옮길까요?');
    await expect(ask(page).locator('.kptu-ask-note')).toContainText('원드라이브에 같은 사진이 있는 것만 삭제해요 · 폰 갤러리 휴지통에서 30일 안에 되살릴 수 있어요');
    await expect(ask(page).locator('.kptu-ask-check')).toHaveText('백업 없음 2장(5MB)도 함께 삭제');
    await expect(ask(page).locator('[data-ask-check]')).not.toBeChecked();
    // 확인 창 아래 끝이 하단바에 가리지 않는다.
    const box = await ask(page).boundingBox(), bar = await page.locator('.mobile-tabs').boundingBox();
    if (bar) expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 1);
    expect(state.bodies.find(b => b.action === 'copy-check').pairs).toEqual([{ id: 'OK1', size: 1_000_000 }]);
    await ask(page).getByRole('button', { name: '폰 휴지통으로' }).click();
    await expect.poll(() => trashed(page)).toEqual(['80001']);
    await expect.poll(() => state.bodies.find(b => b.action === 'trash-log')?.pairs).toEqual([{ phone_id: '80001', copy_id: 'OK1', keep: false }]);
    expect(state.errors).toEqual([]);
  });

  test('잡동사니 [삭제] 체크하면 백업 없음도 함께, [취소]면 아무것도 삭제하지 않음', async ({ page }) => {
    const state = await fixture(page);
    const junk = await openJunk(await openTidy(page));
    await junk.locator('[data-photos-tidy-trash="kakao"]').click();
    await ask(page).getByRole('button', { name: '취소' }).click();
    await expect(ask(page)).toHaveCount(0);
    expect(await trashed(page)).toEqual([]);
    await junk.locator('[data-photos-tidy-trash="kakao"]').click();
    await ask(page).locator('[data-ask-check]').check();
    await ask(page).getByRole('button', { name: '폰 휴지통으로' }).click();
    await expect.poll(() => trashed(page)).toEqual(['80001', '80002', '80003']);
    expect(state.errors).toEqual([]);
  });

  test('공간 비우기 [폰 공간만 비우기]: 요약에 장수·용량, 체크 줄 없음', async ({ page }) => {
    const state = await fixture(page);
    const box = await openTidy(page);
    const space = box.locator('details[data-k="space"]');
    await space.locator('summary').click();
    await space.locator('[data-photos-tidy-trash="space"]').click();
    await expect(ask(page).locator('.kptu-ask-text')).toHaveText('원드라이브에 있는 폰 사진 4장(10MB)을 폰 휴지통으로 옮길까요?');
    await expect(ask(page).locator('[data-ask-check]')).toHaveCount(0);
    await ask(page).getByRole('button', { name: '폰 휴지통으로' }).click();
    await expect.poll(() => trashed(page)).toEqual(['1', '2', '3', '4']);
    expect(state.errors).toEqual([]);
  });

  test('정리 칸 크게 보기 한 장 [삭제]: 백업 없음 한 장은 체크해야만, 체크하면 바로 폰 휴지통', async ({ page }) => {
    const state = await fixture(page);
    const junk = await openJunk(await openTidy(page));
    // 빠른 이동 막대(오른쪽 끝)가 [보기]·칸 위에 겹칠 수 있어(CI 화면) 누르기 대신 초점 → Enter(키보드로 여는 길과 같음).
    await junk.locator('[data-photos-tidy-see="junk:kakao"]').focus();
    await page.keyboard.press('Enter');
    const pane = junk.locator('[data-photos-tidy-pane="junk:kakao"]');
    const cell = pane.locator('[data-photos-id="ph:80003"]');
    await cell.focus();
    await page.keyboard.press('Enter');
    const viewer = page.locator('[data-diary-viewer]');
    await expect(viewer).toBeVisible();
    await viewer.locator('[data-od-delete]').click();
    await expect(ask(page).locator('.kptu-ask-text')).toHaveText('사진 1장 모두 백업 없음이에요');
    const ok = ask(page).getByRole('button', { name: '폰 휴지통으로' });
    await expect(ok).toBeDisabled();
    await ask(page).locator('[data-ask-check]').check();
    await expect(ok).toBeEnabled();
    await ok.click();
    await expect.poll(() => trashed(page)).toEqual(['80003']);
    // 백업이 없던 사진이라 지운 기록(사본 짝)은 남기지 않는다.
    expect(state.bodies.filter(b => b.action === 'trash-log')).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('폰 폴더째 [삭제]: 백업 없음이 들어 있으면(정리로 확인) 체크해야만 폴더를 폰 휴지통으로', async ({ page }) => {
    const state = await fixture(page);
    await openTidy(page);
    await page.locator('#photosRoot [data-photos-tidy-chip]').click();
    await page.locator('#photosRoot [data-photos-view]').selectOption('folders');
    const row = page.locator('#photosRoot [data-photos-pf="Pictures/KakaoTalk/"]');
    await row.locator('[data-photos-pf-more]').click();
    await page.locator('#photosPhoneFolderMenu').getByRole('button', { name: '삭제', exact: true }).click();
    await expect(ask(page).locator('.kptu-ask-text')).toHaveText("'KakaoTalk' 폴더를 삭제할까요?");
    await expect(ask(page).locator('.kptu-ask-note')).toContainText('안의 사진 3장(6MB)(하위 폴더 포함)이 폰 휴지통으로 가요');
    await expect(ask(page).locator('.kptu-ask-note')).toContainText('그중 백업 없음 2장');
    const ok = ask(page).getByRole('button', { name: '삭제', exact: true });
    await expect(ok).toBeDisabled();
    await ask(page).locator('[data-ask-check]').check();
    await ok.click();
    // 앱 다리가 '미디어 관리 허용' 꺼짐이라 한 번 묻는다(예전 그대로) → [취소]면 폰 확인 창으로 진행.
    await expect(ask(page).locator('.kptu-ask-text')).toContainText('미디어 관리 허용');
    await ask(page).getByRole('button', { name: '취소' }).click();
    await expect.poll(() => page.evaluate(() => window.__photoSent.filter(m => m.startsWith('photos:op:')))).toEqual(['photos:op:{"op":"trashfolder","from":"Pictures/KakaoTalk/"}']);
    expect(state.errors).toEqual([]);
  });
});
