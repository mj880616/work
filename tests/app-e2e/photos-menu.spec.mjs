import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// PHOTO-사진메뉴(docs/design/photo-menu.md): '사진' 메뉴 = 원드라이브 사진·동영상 최신순 격자(서버 library 쪽 읽기)·날짜 머리줄·[달력](days)·[휴지통](trash-*)·
// 거르기(전체·★·동영상·스크린샷, view_prefs.photo_view)·크게 보기(일기와 같은 부품)·길게 눌러 여러 장 고르기·설정 창(일기와 같은 부품, 이 화면 안에서).
// 지어낸 Supabase: onedrive-photos(Edge)·app_diary_stars·프로필 view_prefs. 시계는 2026-10-06 KST.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const media = (day, id, hour, extra = {}) => ({ id, name: id + '.jpg', day, taken_at: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null, ...extra });
const newest = (a, b) => b.taken_at.localeCompare(a.taken_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

async function fixture(page, { width = 390, status = { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } } = {}) {
  const state = {
    media: [
      ...['A1', 'A2', 'A3'].map((id, i) => media('2026-10-05', id, i + 1)), media('2026-10-02', 'B1', 3, { screenshot: true }),
      media('2026-09-20', 'V1', 4, { kind: 'video', duration_ms: 42000, name: 'V1.mp4' }),
      ...['C1', 'C2'].map((id, i) => media('2026-08-15', id, i + 1)),
    ],
    trash: [], stars: [], edge: [], starWrites: [], deletes: [], status: { ...status }, errors: [],
  };
  page.on('pageerror', e => state.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) state.errors.push(m.text()); });
  await page.setViewportSize({ width, height: 900 });
  // OD-미리받기(od-warm.js)는 앱을 켠 뒤 한가할 때 일기용 이번 달 목록(action 'photos')을 뒤에서 받는다. 이 시험은 사진 메뉴가 그 목록을
  // 쓰지 않는지만 보므로, 시각에 따라 끼어드는 미리 받기를 끈다(installOdWarm은 이미 있으면 다시 설치하지 않는다).
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await openHome(page);
  state.prefs = await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    if (req.method() === 'GET') return r.fulfill({ json: state.stars });
    if (req.method() === 'POST') {
      const body = req.postDataJSON(); state.starWrites.push({ method: 'POST', body });
      if (!state.stars.some(s => s.item_key === body.item_key)) state.stars.push({ source: body.source, item_key: body.item_key, taken_day: body.taken_day });
      return r.fulfill({ status: 201, json: [body] });
    }
    if (req.method() === 'DELETE') {
      const key = q.get('item_key').replace(/^eq\./, ''); state.starWrites.push({ method: 'DELETE', key });
      state.stars = state.stars.filter(s => s.item_key !== key);
      return r.fulfill({ json: [] });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  const passes = (m, body) => body.filter === 'video' ? m.kind === 'video' : body.filter === 'shot' ? m.screenshot : body.filter === 'star' ? (body.star_ids || []).includes(m.id) : true;
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    state.edge.push(body);
    if (body.action === 'status') return r.fulfill({ json: state.status });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'library') {
      const c = body.cursor;
      const list = state.media.filter(m => passes(m, body) && (!c || m.taken_at < c.t || (m.taken_at === c.t && m.id < c.id))).sort(newest);
      const items = list.slice(0, body.limit), more = list.length > body.limit;
      return r.fulfill({ json: { items, next_cursor: more ? { t: items.at(-1).taken_at, id: items.at(-1).id } : null, indexing: false } });
    }
    if (body.action === 'months') {
      const months = {};
      for (const m of state.media.filter(x => passes(x, body))) months[m.day.slice(0, 7)] = (months[m.day.slice(0, 7)] || 0) + 1;
      return r.fulfill({ json: { months, total: Object.values(months).reduce((a, b) => a + b, 0) } });
    }
    if (body.action === 'days') {
      const days = {};
      for (const m of state.media.filter(x => passes(x, body) && x.day.startsWith(body.month)).sort((a, b) => a.taken_at.localeCompare(b.taken_at))) {
        if (!days[m.day]) days[m.day] = { count: 0, cover: { id: m.id, kind: m.kind } };
        days[m.day].count++;
      }
      return r.fulfill({ json: { month: body.month, days } });
    }
    if (body.action === 'photo-delete') {
      const ids = body.ids || [body.id];
      state.deletes.push(...ids);
      for (const id of ids) { const m = state.media.find(x => x.id === id); if (m) { state.media = state.media.filter(x => x !== m); state.trash.push(m); } }
      return r.fulfill({ json: body.ids ? { deleted: true, moved: ids, failed: {} } : { deleted: true, trashed: true } });
    }
    if (body.action === 'trash-list') return r.fulfill({ json: { items: state.trash.map(m => ({ ...m, trashed_at: '2026-10-06T00:00:00.000Z', purge_at: '2026-11-05T00:00:00.000Z', from: null })), purged: 0, truncated: false } });
    if (body.action === 'trash-restore') {
      const back = state.trash.filter(m => body.ids.includes(m.id));
      state.trash = state.trash.filter(m => !body.ids.includes(m.id)); state.media.push(...back);
      return r.fulfill({ json: { restored: back.map(m => m.id), failed: {} } });
    }
    if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: 7, total: 7 }, folders: [{ id: 'F1', name: '여행', parent_id: 'T', enabled: true, count: 0, total: 0 }], indexing: false } });
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
const root = page => page.locator('#photosRoot');
const items = page => root(page).locator('[data-photos-open]');

for (const width of [390, 1280]) {
  test(`사진 메뉴: 최신순 격자(서버 쪽 읽기)·동영상 표시·크게 보기 ☆·★ 거르기·달력 ${width}`, async ({ page }) => {
    const f = await fixture(page, { width });
    await openPhotos(page, width);
    await expect(root(page).locator('[data-photos-tab]')).toHaveText(['사진', '달력', '폴더', '앨범', '휴지통']);
    await expect(root(page).locator('[data-od-link]')).toBeVisible();
    await expect(items(page)).toHaveCount(7);
    await expect(root(page).locator('.photos-day b')).toHaveText(['10월 5일 (월)', '10월 2일 (금)', '9월 20일 (일)', '8월 15일 (토)']);
    await expect(root(page).locator('.photos-day').first()).toContainText('· 3장');
    await expect(items(page).first().locator('img')).toBeVisible();
    expect(f.edge.find(b => b.action === 'library')).toMatchObject({ filter: 'all', limit: 120 });
    expect(f.edge.some(b => b.action === 'photos')).toBe(false);
    // 동영상 칸: 오른쪽 아래 '▶ 0:42'.
    await expect(root(page).locator('[data-photos-id="V1"] .photos-dur')).toHaveText('▶ 0:42');
    // 빠른 이동 막대: 달이 셋이라 보인다.
    await expect(root(page).locator('[data-photos-rail]')).toBeVisible();
    // 크게 보기: 일기와 같은 부품. 최신 사진(A3)부터, S 키 = 별표(서버 저장), Esc = 닫기.
    await items(page).first().click();
    const viewer = root(page).locator('[data-diary-viewer]');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('1 / 7');
    await expect(viewer.locator('.diary-viewer-actions button')).toHaveText(['☆ 별표', '⇪ 공유', '🗑 지우기', 'ⓘ 정보']);
    await viewer.locator('[data-diary-info]').click();
    await expect(viewer.locator('[data-strip-original]')).toHaveText('⤓ 원본 받기');
    await page.keyboard.press('s');
    await expect.poll(() => f.starWrites.length).toBe(1);
    expect(f.starWrites[0].body).toMatchObject({ source: 'onedrive', item_key: 'A3', taken_day: '2026-10-05' });
    await expect(viewer.locator('[data-diary-star]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(items(page).first().locator('.diary-star-mark')).toBeVisible();
    // ★ 거르기: 서버에 별표 id를 보내 그것만. 고른 거르기는 서버(view_prefs.photo_view)에 기억.
    await root(page).locator('[data-photos-filter]').selectOption('star');
    await expect(items(page)).toHaveCount(1);
    expect(f.edge.filter(b => b.action === 'library').at(-1)).toMatchObject({ filter: 'star', star_ids: ['A3'] });
    await expect.poll(() => f.prefs.value?.photo_view?.filter).toBe('star');
    await root(page).locator('[data-photos-filter]').selectOption('video');
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toHaveAttribute('data-photos-id', 'V1');
    await root(page).locator('[data-photos-filter]').selectOption('all');
    await expect(items(page)).toHaveCount(7);
    // [달력]: 칸마다 대표 사진과 장수(서버 days), 누르면 [사진]의 그날로. 뒤로가기 = 이전 칩.
    await root(page).locator('[data-photos-tab="calendar"]').click();
    await expect(root(page).locator('.photos-cal-head b')).toHaveText('2026년 10월');
    const day5 = root(page).locator('[data-photos-cal-day="2026-10-05"]');
    await expect(day5).toHaveAttribute('aria-label', '10월 5일 (월), 사진 3장');
    await expect(day5.locator('.photos-cal-c')).toHaveText('3');
    await page.goBack();
    await expect(root(page).locator('[data-photos-tab="all"]')).toHaveAttribute('aria-pressed', 'true');
    await root(page).locator('[data-photos-tab="calendar"]').click();
    await root(page).locator('[data-photos-cal="-1"]').click();
    await root(page).locator('[data-photos-cal="-1"]').click();
    await expect(root(page).locator('.photos-cal-head b')).toHaveText('2026년 8월');
    await root(page).locator('[data-photos-cal-day="2026-08-15"]').click();
    await expect(root(page).locator('[data-photos-tab="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(root(page).locator('[data-photos-day="2026-08-15"]')).toBeInViewport();
    expect(f.errors).toEqual([]);
  });
}

test('사진 메뉴: 길게 눌러 여러 장 고르기 → [☆ 별표]·[🗑 지우기](묻지 않음, 되돌리기 뒤 한 번에) → [휴지통]에서 되살리기 390', async ({ page }) => {
  const f = await fixture(page, { width: 390 });
  await openPhotos(page, 390);
  await expect(items(page)).toHaveCount(7);
  const hold = async locator => { const b = await locator.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); };
  await hold(items(page).nth(0));
  await expect(root(page).locator('[data-photos-sel]')).toBeVisible();
  await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('1개 골랐음');
  await expect(root(page).locator('[data-diary-viewer]')).toHaveCount(0);
  await items(page).nth(1).click();
  await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('2개 골랐음');
  await expect(items(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  // 날짜 머리줄 ○ = 그날 전체 고르기.
  await root(page).locator('[data-photos-day-pick="2026-10-05"]').click();
  await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('3개 골랐음');
  await root(page).locator('[data-photos-act-star]').click();
  await expect.poll(() => f.stars.map(s => s.item_key).sort()).toEqual(['A1', 'A2', 'A3']);
  await expect(root(page).locator('[data-photos-sel]')).toBeHidden();
  // 다시 고르고 지우기: 바로 목록에서 빠지고, 되돌리기 시간(5초) 뒤 한 번에(ids) 서버로 간다.
  await hold(items(page).nth(3));
  await items(page).nth(5).click();
  await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('2개 골랐음');
  await root(page).locator('[data-photos-act-delete]').click();
  await expect(items(page)).toHaveCount(5);
  await expect(page.locator('.kptu-notice-undo')).toBeVisible();
  expect(f.deletes).toEqual([]);
  await expect.poll(() => f.deletes.slice().sort(), { timeout: 10000 }).toEqual(['B1', 'C2']);
  const del = f.edge.filter(b => b.action === 'photo-delete');
  expect(del).toHaveLength(1);
  expect(del[0]).toMatchObject({ confirm: true });
  expect(del[0].ids.slice().sort()).toEqual(['B1', 'C2']);
  // [휴지통]: 지운 두 장. 고르고 [되살리기] → 휴지통에서 빠지고 [사진]으로 돌아오면 다시 보인다.
  await root(page).locator('[data-photos-tab="trash"]').click();
  await expect(root(page).locator('.photos-top')).toContainText('30일 뒤 원드라이브 휴지통으로 가요');
  await expect(items(page)).toHaveCount(2);
  await items(page).nth(0).click();
  await expect(root(page).locator('[data-photos-trash-act]')).toBeVisible();
  await items(page).nth(1).click();
  await root(page).locator('[data-photos-restore]').click();
  await expect(items(page)).toHaveCount(0);
  expect(f.edge.find(b => b.action === 'trash-restore').ids.slice().sort()).toEqual(['B1', 'C2']);
  await root(page).locator('[data-photos-tab="all"]').click();
  await expect(root(page).locator('[data-photos-tab="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(items(page)).toHaveCount(7);
  // 뒤로가기 = 선택 해제(화면 이동 아님).
  await hold(items(page).nth(0));
  await expect(root(page).locator('[data-photos-sel]')).toBeVisible();
  await page.goBack();
  await expect(root(page).locator('[data-photos-sel]')).toBeHidden();
  await expect(page.locator('#photosView')).toBeVisible();
  expect(f.errors).toEqual([]);
});

test('사진 메뉴: 원드라이브 설정 창(하위 폴더)을 일기로 넘어가지 않고 이 화면 안에서 연다 390', async ({ page }) => {
  const f = await fixture(page, { width: 390 });
  await openPhotos(page, 390);
  await expect(items(page)).toHaveCount(7);
  // PHOTO-출처 ①: 연결된 뒤 원드라이브 아이콘 누르기 = 켜기/끄기, 연결 메뉴는 꾹 누르기(PC 우클릭).
  await root(page).locator('[data-od-link]').click({ button: 'right' });
  const menu = page.locator('#photosOdMenu');
  await expect(menu).toBeVisible();
  await menu.locator('button', { hasText: '하위 폴더 켜고 끄기' }).click();
  const sheet = root(page).locator('[data-od-modal] [role="dialog"]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('원드라이브 · 카메라');
  await expect(sheet.locator('[data-od-sw="F1"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#photosView')).toBeVisible();
  await expect(page.locator('#diaryView')).toBeHidden();
  // [취소] = 창 닫기.
  await sheet.locator('[data-od-cancel]').click();
  await expect(root(page).locator('[data-od-modal]')).toHaveCount(0);
  await expect(page.locator('#photosView')).toBeVisible();
  expect(f.edge.some(b => b.action === 'folders-tree')).toBe(true);
  expect(f.errors).toEqual([]);
});

test('사진 메뉴: 원드라이브 연결 전에는 한 줄 안내와 [연결]만', async ({ page }) => {
  const f = await fixture(page, { width: 390, status: { configured: true, connected: false, folder: null, can_delete: false } });
  await openPhotos(page, 390);
  await expect(root(page).locator('[data-photos-body]')).toHaveText('원드라이브 연결 뒤 쓸 수 있어요 연결');
  await expect(items(page)).toHaveCount(0);
  expect(f.edge.some(b => b.action === 'library')).toBe(false);
  expect(f.errors).toEqual([]);
});
