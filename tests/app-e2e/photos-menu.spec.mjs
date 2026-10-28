import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// PHOTO-사진메뉴 1차(docs/design/photo-menu.md): '사진' 메뉴 = 원드라이브 사진 최신순 격자·날짜 머리줄·[달력]·★ 거르기·크게 보기(일기와 같은 부품)·
// 길게 눌러 여러 장 고르기([☆ 별표]·[🗑 지우기], 되돌리기 시간 뒤 휴지통). 지어낸 Supabase: onedrive-photos(Edge)·app_diary_stars. 시계는 2026-10-06 KST.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const photo = (day, id, hour) => ({ id, name: id + '.jpg', taken_at: `${day}T${String(hour).padStart(2, '0')}:00:00Z`, approx: false });

async function fixture(page, { width = 390, status = { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } } = {}) {
  const state = {
    months: {
      '2026-10': { '2026-10-05': ['A1', 'A2', 'A3'].map((id, i) => photo('2026-10-05', id, i + 1)), '2026-10-02': [photo('2026-10-02', 'B1', 3)] },
      '2026-08': { '2026-08-15': ['C1', 'C2'].map((id, i) => photo('2026-08-15', id, i + 1)) },
    },
    stars: [], edge: [], starWrites: [], deletes: [], status: { ...status }, errors: [],
  };
  page.on('pageerror', e => state.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) state.errors.push(m.text()); });
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
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
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    state.edge.push(body);
    if (body.action === 'status') return r.fulfill({ json: state.status });
    if (body.action === 'photos') return r.fulfill({ json: { month: body.month, days: state.months[body.month] || {}, truncated: false } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'photo-delete') {
      state.deletes.push(body.id);
      for (const days of Object.values(state.months)) for (const d of Object.keys(days)) days[d] = days[d].filter(p => p.id !== body.id);
      return r.fulfill({ json: { deleted: true } });
    }
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
  test(`사진 메뉴: 최신순 격자·날짜 머리줄·크게 보기 ☆·★ 거르기·달력 ${width}`, async ({ page }) => {
    const f = await fixture(page, { width });
    await openPhotos(page, width);
    await expect(root(page).locator('[data-photos-tab]')).toHaveText(['사진', '달력']);
    await expect(root(page).locator('[data-od-link]')).toBeVisible();
    // 이번 달부터 거슬러 받는다: 10월(4장) → 9월(없음) → 8월(2장). 머리줄은 최신 날부터.
    await expect(items(page)).toHaveCount(6);
    await expect(root(page).locator('.photos-day b')).toHaveText(['10월 5일 (월)', '10월 2일 (금)', '8월 15일 (토)']);
    await expect(root(page).locator('.photos-day').first()).toContainText('· 3장');
    await expect(items(page).first().locator('img')).toBeVisible();
    expect(f.edge.filter(b => b.action === 'photos').map(b => b.month).slice(0, 3)).toEqual(['2026-10', '2026-09', '2026-08']);
    // 크게 보기: 일기와 같은 부품. 최신 사진(A3)부터, S 키 = 별표(서버 저장), Esc = 닫기.
    await items(page).first().click();
    const viewer = root(page).locator('[data-diary-viewer]');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('1 / 6');
    await expect(viewer.locator('.diary-viewer-actions button')).toHaveText(['☆ 별표', '⇪ 공유', '🗑 지우기', 'ⓘ 정보']);
    await page.keyboard.press('s');
    await expect.poll(() => f.starWrites.length).toBe(1);
    expect(f.starWrites[0].body).toMatchObject({ source: 'onedrive', item_key: 'A3', taken_day: '2026-10-05' });
    await expect(viewer.locator('[data-diary-star]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(items(page).first().locator('.diary-star-mark')).toBeVisible();
    // ★ 거르기: 별표한 것만.
    await root(page).locator('[data-photos-filter]').selectOption('star');
    await expect(items(page)).toHaveCount(1);
    await root(page).locator('[data-photos-filter]').selectOption('all');
    await expect(items(page)).toHaveCount(6);
    // [달력]: 칸마다 대표 사진과 장수, 누르면 [사진]의 그날 머리줄로. 뒤로가기 = 이전 칩.
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

test('사진 메뉴: 길게 눌러 여러 장 고르기 → [☆ 별표]·[🗑 지우기](묻지 않음, 되돌리기 시간 뒤 휴지통) 390', async ({ page }) => {
  const f = await fixture(page, { width: 390 });
  await openPhotos(page, 390);
  await expect(items(page)).toHaveCount(6);
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
  // 다시 고르고 지우기: 바로 목록에서 빠지고, 되돌리기 시간(5초) 뒤 서버로 간다.
  await hold(items(page).nth(3));
  await items(page).nth(4).click();
  await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('2개 골랐음');
  await root(page).locator('[data-photos-act-delete]').click();
  await expect(items(page)).toHaveCount(4);
  await expect(page.locator('.kptu-notice-undo')).toBeVisible();
  expect(f.deletes).toEqual([]);
  await expect.poll(() => f.deletes.slice().sort(), { timeout: 10000 }).toEqual(['B1', 'C2']);
  // 뒤로가기 = 선택 해제(화면 이동 아님).
  await hold(items(page).nth(0));
  await expect(root(page).locator('[data-photos-sel]')).toBeVisible();
  await page.goBack();
  await expect(root(page).locator('[data-photos-sel]')).toBeHidden();
  await expect(page.locator('#photosView')).toBeVisible();
  expect(f.errors).toEqual([]);
});

test('사진 메뉴: 원드라이브 연결 전에는 한 줄 안내와 [연결]만', async ({ page }) => {
  const f = await fixture(page, { width: 390, status: { configured: true, connected: false, folder: null, can_delete: false } });
  await openPhotos(page, 390);
  await expect(root(page).locator('[data-photos-body]')).toHaveText('원드라이브 연결 뒤 쓸 수 있어요 연결');
  await expect(items(page)).toHaveCount(0);
  expect(f.edge.some(b => b.action === 'photos')).toBe(false);
  expect(f.errors).toEqual([]);
});
