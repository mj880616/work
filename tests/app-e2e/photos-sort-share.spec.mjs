import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// PHOTO-정렬(요청함 10/30 10:29): 사진 메뉴 오른쪽 위 [찍은 날 ↓ ▾] → 누른 자리 작은 메뉴(기준 6줄, 고른 줄 ✓). 고른 기준은 서버 view_prefs.photo_view.sort 하나,
//   서버 쪽 읽기(library)에 sort를 보내 그 순서로 받는다. 날짜 머리줄은 찍은 날 기준일 때만, 달력에는 정렬 버튼 없음. 새로고침 뒤 같은 기준.
// PC공유메뉴(요청함 10/30 10:27): 넓은 화면(761px~)의 [공유] → Web2 작은 메뉴 4줄([사진 복사] [정리함에 넣기] [다운로드] [다른 앱으로 공유…]).
//   [사진 복사]는 clipboard.write(image/png), [정리함에 넣기]는 정리함 기존 저장 길(basket-files). 폰(≤760px)은 지금처럼 기기 공유 창.
// 지어낸 Supabase: onedrive-photos(Edge)·app_diary_stars·프로필 view_prefs·basket-files. 시계는 2026-10-06 KST.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const media = (day, id, hour, extra = {}) => ({ id, name: id + '.jpg', day, taken_at: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`, approx: false, kind: 'photo',
  screenshot: false, duration_ms: null, size_bytes: null, uploaded_at: null, ...extra });
// 서버(onedrive-photos sortCmp)와 같은 규칙의 흉내.
const ko = new Intl.Collator('ko', { numeric: true });
const idAsc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const n = v => (Number.isFinite(v) ? v : -1);
const CMP = {
  taken_desc: (a, b) => b.taken_at.localeCompare(a.taken_at) || idAsc(b.id, a.id),
  taken_asc: (a, b) => a.taken_at.localeCompare(b.taken_at) || idAsc(a.id, b.id),
  uploaded_desc: (a, b) => (b.uploaded_at || b.taken_at).localeCompare(a.uploaded_at || a.taken_at) || idAsc(b.id, a.id),
  name_asc: (a, b) => ko.compare(a.name, b.name) || idAsc(a.id, b.id),
  size_desc: (a, b) => n(b.size_bytes) - n(a.size_bytes) || idAsc(b.id, a.id),
  duration_desc: (a, b) => n(b.duration_ms) - n(a.duration_ms) || idAsc(b.id, a.id),
};

async function fixture(page, width) {
  const state = {
    media: [
      media('2026-10-05', 'A1', 1, { name: 'b10.jpg', size_bytes: 300 }), media('2026-10-05', 'A2', 2, { name: 'b2.jpg', size_bytes: 500 }),
      media('2026-10-05', 'A3', 3, { name: '가을.jpg', size_bytes: 100 }), media('2026-10-02', 'B1', 3, { screenshot: true, size_bytes: 900 }),
      media('2026-09-20', 'V1', 4, { kind: 'video', duration_ms: 42000, name: 'V1.mp4', size_bytes: 5000 }),
      media('2026-08-15', 'C1', 1, { size_bytes: 200, uploaded_at: '2026-10-06T00:00:00.000Z' }), media('2026-08-15', 'C2', 2),
    ],
    edge: [], uploads: [],
  };
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    window.KPTUOdWarm = { run: () => null };
    // 클립보드·기기 공유 창 흉내(시험 기록만, 기기 저장 없음). 실제 붙여넣기(Ctrl+V)는 merge 뒤 명진이 실기기에서 본다.
    window.__clip = []; window.__shared = 0;
    const clip = { write: async list => { for (const item of list) { const blob = await item.getType('image/png'); window.__clip.push({ types: [...item.types], type: blob.type, size: blob.size }); } } };
    Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => clip });
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: async () => { window.__shared++; } });
    Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: () => true });
  });
  await openHome(page);
  state.prefs = await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/basket-files', async r => {
    state.uploads.push(r.request().method());
    return r.fulfill({ json: { ok: true, note_id: 'n1', attachments: [{ drive_file_id: 'd1', file_name: 'A3.png', mime_type: 'image/gif', size_bytes: PNG.length }] } });
  });
  const passes = (m, body) => body.filter === 'video' ? m.kind === 'video' : body.filter === 'shot' ? m.screenshot : body.filter === 'star' ? (body.star_ids || []).includes(m.id) : true;
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    state.edge.push(body);
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'library') {
      const list = state.media.filter(m => passes(m, body) && (!body.folder_id || body.folder_id === 'T')).sort(CMP[body.sort || 'taken_desc']);
      return r.fulfill({ json: { items: list.slice(0, body.limit), next_cursor: null, indexing: false } });
    }
    if (body.action === 'months') {
      const months = {};
      for (const m of state.media.filter(x => passes(x, body))) months[m.day.slice(0, 7)] = (months[m.day.slice(0, 7)] || 0) + 1;
      return r.fulfill({ json: { months, total: state.media.length } });
    }
    if (body.action === 'days') return r.fulfill({ json: { month: body.month, days: {} } });
    if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: 7, total: 7 }, folders: [], indexing: false } });
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  return state;
}
// 그 폭의 실제 입구(PC 옆 메뉴·폴드 ☰·폰 [메뉴])로 연다(공용 도구).
async function openPhotos(page) {
  await clickView(page, 'photos');
  await expect(page.locator('#photosView')).toBeVisible();
}
const root = page => page.locator('#photosRoot');
const order = page => root(page).locator('[data-photos-list] [data-photos-open]').evaluateAll(list => list.map(b => b.dataset.photosId));
const sortBtn = page => root(page).locator('[data-photos-sort]');
const menu = page => page.locator('#photosSortMenu');
const libraryBodies = f => f.edge.filter(b => b.action === 'library');

const EXPECT = {
  taken_desc: ['A3', 'A2', 'A1', 'B1', 'V1', 'C2', 'C1'],
  taken_asc: ['C1', 'C2', 'V1', 'B1', 'A1', 'A2', 'A3'],
  uploaded_desc: ['C1', 'A3', 'A2', 'A1', 'B1', 'V1', 'C2'],
  name_asc: ['A3', 'B1', 'A2', 'A1', 'C1', 'C2', 'V1'],
  size_desc: ['V1', 'B1', 'A2', 'A1', 'C1', 'A3', 'C2'],
  duration_desc: ['V1', 'C2', 'C1', 'B1', 'A3', 'A2', 'A1'],
};
const ROWS = ['찍은 날 최근 먼저', '찍은 날 오래된 먼저', '올린 날 최근 먼저', '파일 이름 가나다', '크기 큰 것 먼저', '동영상 길이 긴 것 먼저'];
const SHORT = { taken_desc: '찍은 날 ↓', taken_asc: '찍은 날 ↑', uploaded_desc: '올린 날 ↓', name_asc: '이름 가나다', size_desc: '크기 ↓', duration_desc: '길이 ↓' };

for (const width of [1440, 884, 412]) {
  test(`사진 정렬: 기준 6가지마다 서버 순서·날짜 머리줄은 찍은 날만·서버 저장·새로고침 뒤 같은 기준·달력엔 없음 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await openPhotos(page, width);
    await expect(sortBtn(page)).toHaveText('찍은 날 ↓ ▾');
    await expect.poll(() => order(page)).toEqual(EXPECT.taken_desc);
    // [정렬]은 [−][+] 왼쪽
    expect(await sortBtn(page).evaluate(b => b.nextElementSibling?.classList.contains('photo-size'))).toBe(true);
    await sortBtn(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).locator('button')).toHaveText(ROWS.map((t, i) => (i === 0 ? '✓' : '') + t));
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    for (const [i, sort] of [['taken_asc', 1], ['uploaded_desc', 2], ['name_asc', 3], ['size_desc', 4], ['duration_desc', 5], ['taken_desc', 0]].map(([s, k]) => [k, s])) {
      await sortBtn(page).click();
      await menu(page).locator('button').nth(i).click();
      await expect(menu(page)).toBeHidden();
      await expect(sortBtn(page)).toHaveText(`${SHORT[sort]} ▾`);
      await expect.poll(() => order(page)).toEqual(EXPECT[sort]);
      expect(libraryBodies(f).at(-1).sort).toBe(sort === 'taken_desc' ? undefined : sort);
      await expect(root(page).locator('[data-photos-list] .photos-day')).toHaveCount(sort.startsWith('taken') ? 4 : 0);
      await expect.poll(() => f.prefs.value?.photo_view?.sort).toBe(sort === 'taken_desc' ? undefined : sort);
      if (sort !== 'taken_desc') await expect(root(page).locator('[data-photos-rail]')).toBeHidden();
    }
    // 크기 순으로 고르고 새로고침: 같은 기준(서버 값)으로 다시 받는다.
    await sortBtn(page).click();
    await menu(page).locator('button').nth(4).click();
    await expect.poll(() => order(page)).toEqual(EXPECT.size_desc);
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 15000 });
    if (!(await page.locator('#photosView').isVisible())) await openPhotos(page, width);
    await expect(sortBtn(page)).toHaveText('크기 ↓ ▾');
    await expect.poll(() => order(page)).toEqual(EXPECT.size_desc);
    expect(libraryBodies(f).at(-1).sort).toBe('size_desc');
    // 달력에는 정렬 버튼이 없다.
    await root(page).locator('[data-photos-tab="calendar"]').click();
    await expect(sortBtn(page)).toBeHidden();
    await root(page).locator('[data-photos-tab="folders"]').click();
    await expect(sortBtn(page)).toBeVisible();
    await expect.poll(() => libraryBodies(f).some(b => b.folder_id === 'T' && b.sort === 'size_desc')).toBe(true);
  });
}

test('PC 공유: 넓은 화면 [공유] → Web2 메뉴 4줄, 사진 복사는 image/png 클립보드, 정리함 넣기는 기존 저장 길, 동영상은 복사·정리함 없음 1440', async ({ page }) => {
  const f = await fixture(page, 1440);
  await openPhotos(page, 1440);
  await expect.poll(() => order(page)).toEqual(EXPECT.taken_desc);
  await root(page).locator('[data-photos-id="A3"]').click();
  const viewer = root(page).locator('[data-diary-viewer]');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('.diary-photo img:not(.img-slot-preview)').first()).toBeVisible();
  const shareMenu = page.locator('#shareMenu');
  await viewer.locator('[data-diary-share]').click();
  await expect(shareMenu).toBeVisible();
  await expect(shareMenu.locator('button')).toHaveText(['사진 복사', '정리함에 넣기', '다운로드', '다른 앱으로 공유…']);
  expect(await page.evaluate(() => window.__shared)).toBe(0);
  await shareMenu.getByRole('button', { name: '사진 복사' }).click();
  await expect.poll(() => page.evaluate(() => window.__clip)).toEqual([{ types: ['image/png'], type: 'image/png', size: PNG.length }]);
  await expect(viewer.locator('[data-diary-viewer-note-text]')).toHaveText('복사했어요');
  await expect(viewer).toBeVisible();
  // [정리함에 넣기]: basket-files 한 번(새 저장 경로 없음).
  await viewer.locator('[data-diary-share]').click();
  await shareMenu.getByRole('button', { name: '정리함에 넣기' }).click();
  await expect.poll(() => f.uploads).toEqual(['POST']);
  await expect(viewer.locator('[data-diary-viewer-note-text]')).toHaveText('정리함에 넣었어요');
  // [다른 앱으로 공유…] = 지금의 기기 공유 창.
  await viewer.locator('[data-diary-share]').click();
  await shareMenu.getByRole('button', { name: '다른 앱으로 공유…' }).click();
  await expect.poll(() => page.evaluate(() => window.__shared)).toBe(1);
  // 동영상: [사진 복사]·[정리함에 넣기] 없음.
  await viewer.locator('[data-diary-viewer-strip]').focus();
  for (let k = 2; k <= 5; k++) { await page.keyboard.press('ArrowRight'); await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText(`${k} / 7`); }
  await viewer.locator('[data-diary-share]').click();
  await expect(shareMenu.locator('button')).toHaveText(['다운로드', '다른 앱으로 공유…']);
  await page.keyboard.press('Escape');
  await expect(shareMenu).toBeHidden();
  await expect(viewer).toBeVisible();
});

test('폰 공유: 좁은 화면(412) [공유]는 메뉴 없이 기기 공유 창 그대로', async ({ page }) => {
  await fixture(page, 412);
  await openPhotos(page, 412);
  await expect.poll(() => order(page)).toEqual(EXPECT.taken_desc);
  await root(page).locator('[data-photos-id="A3"]').click();
  const viewer = root(page).locator('[data-diary-viewer]');
  await expect(viewer.locator('.diary-photo img:not(.img-slot-preview)').first()).toBeVisible();
  await viewer.locator('[data-diary-share]').click();
  await expect.poll(() => page.evaluate(() => window.__shared)).toBe(1);
  await expect(page.locator('#shareMenu')).toBeHidden();
  expect(await page.evaluate(() => window.__clip.length)).toBe(0);
});
