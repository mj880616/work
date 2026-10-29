import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { testOrigin } from './helpers/test-origin.mjs';
// JOURNAL-일기원드라이브 2단계: [일기]의 원드라이브 사진(날짜별 모아 보기)·스와이프 ☆ 별표·지우기(휴지통)·연결 한 줄.
// 지어낸 Supabase: onedrive-photos(Edge)와 app_diary_stars(별표 표). 시계는 2026-10-06 KST. 사진 바이트는 1x1 그림 하나다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const photo = (id, hour) => ({ id, name: id + '.jpg', taken_at: `2026-10-12T${String(hour).padStart(2, '0')}:00:00Z`, approx: false });

async function fixture(page, { width = 390, status = { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true }, days = null, statusFail = false } = {}) {
  const state = {
    days: days || { '2026-10-12': ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((id, i) => photo(id, i + 1)) },
    stars: [], edge: [], syncPlan: [], tree: null, toggles: [], starWrites: [], photoReads: [], status: { ...status }, statusFail, errors: [],
  };
  page.on('pageerror', e => state.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) state.errors.push(m.text()); });
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    if (req.method() === 'GET') return r.fulfill({ json: state.stars });
    if (req.method() === 'POST') {
      const body = req.postDataJSON(); state.starWrites.push({ method: 'POST', body });
      if (!state.stars.some(s => s.source === body.source && s.item_key === body.item_key)) state.stars.push({ source: body.source, item_key: body.item_key, taken_day: body.taken_day });
      return r.fulfill({ status: 201, json: [body] });
    }
    if (req.method() === 'DELETE') {
      state.starWrites.push({ method: 'DELETE', query: Object.fromEntries(q) });
      const key = q.get('item_key').replace(/^eq\./, '');
      state.stars = state.stars.filter(s => s.item_key !== key);
      return r.fulfill({ json: [] });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') { state.photoReads.push(body); return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); }
    state.edge.push(body);
    if (body.action === 'status') return state.statusFail ? r.fulfill({ status: 503, json: { error: 'onedrive_unavailable' } }) : r.fulfill({ json: state.status });
    if (body.action === 'photos') return r.fulfill({ json: { month: body.month, days: state.days, truncated: false } });
    if (body.action === 'photo-delete') {
      for (const day of Object.keys(state.days)) state.days[day] = state.days[day].filter(p => p.id !== body.id);
      return r.fulfill({ json: { deleted: true } });
    }
    if (body.action === 'auth-start') return r.fulfill({ json: { url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=s.t' } });
    if (body.action === 'auth-finish') { state.status = { configured: true, connected: true, folder: null, can_delete: true }; return r.fulfill({ json: { connected: true } }); }
    if (body.action === 'sync') { const next = state.syncPlan.shift(); if (next && next.status) return r.fulfill({ status: next.status, json: next.json }); return r.fulfill({ json: next || { more: false, indexing: false } }); }
    if (body.action === 'folders-tree') return r.fulfill({ json: state.tree || { top: { id: 'T', name: '카메라', count: 4, total: 9 }, folders: [], indexing: false } });
    if (body.action === 'folder-toggle') { state.toggles.push(body); const f = state.tree.folders.find(x => x.id === body.folder_id); if (f) f.enabled = body.enabled; return r.fulfill({ json: { folder: { id: body.folder_id, enabled: body.enabled } } }); }
    if (body.action === 'folders') return r.fulfill({ json: { folders: body.parent_id ? [{ id: 'F3', name: '2026' }] : [{ id: 'F1', name: '사진' }, { id: 'F2', name: '문서' }] } });
    if (body.action === 'folder-set') { state.status = { configured: true, connected: true, folder: { name: '사진' }, can_delete: true }; return r.fulfill({ json: { folder: { name: '사진' } } }); }
    if (body.action === 'disconnect') { state.status = { configured: true, connected: false, folder: null, can_delete: false }; return r.fulfill({ json: { connected: false } }); }
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  return state;
}
async function openDiary(page, width) {
  if (width <= 760) {
    await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
    await expect(page.locator('#calendarView')).toBeVisible();
    await page.locator('#calendarView .schedule-switch [data-view="diary"]').click();
  } else await page.locator('.app-nav [data-view="diary"]').click();
  await expect(page.locator('#diaryView')).toBeVisible();
  await expect(page.locator('#diaryRoot [data-diary-title]')).toHaveText('2026년 10월');
}
const cell = (page, day) => page.locator(`#diaryRoot [data-diary-day="${day}"]`);
// OD-연결아이콘: 연결 표시는 [오늘] 오른쪽 아이콘 하나, 누르면 드롭다운(#diaryOdMenu).
const odIcon = page => page.locator('#diaryRoot [data-od-link]');
const odMenu = page => page.locator('#diaryOdMenu');
async function odPick(page, name) {
  await odIcon(page).click();
  await expect(odMenu(page)).toBeVisible();
  await odMenu(page).locator('button', { hasText: name }).click();
  await expect(odMenu(page)).toBeHidden();
}
// 크게 보기 사진 위 한 손가락 세로 밀기(dy<0 위, dy>0 아래). 터치 이벤트를 직접 보낸다.
async function swipe(page, dy) {
  await page.locator('#diaryRoot [data-diary-viewer-strip]').evaluate((el, dy) => {
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const t = (cy) => new Touch({ identifier: 1, target: el, clientX: x, clientY: cy });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(y)], changedTouches: [t(y)], bubbles: true }));
    el.dispatchEvent(new TouchEvent('touchmove', { touches: [t(y + dy)], changedTouches: [t(y + dy)], bubbles: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(y + dy)], bubbles: true }));
  }, dy);
}

for (const width of [390, 1280]) {
  test(`원드라이브 사진이 찍은 날짜에 모이고, 크게 보기에서 넘기며 ☆(버튼·위로 밀기·S키), [별표]에 모이고, 🗑은 묻지 않고 되돌리기 뒤 휴지통으로 ${width}`, async ({ page }) => {
    const f = await fixture(page, { width });
    await openDiary(page, width);
    const day = cell(page, '2026-10-12');
    await expect(day.locator('[data-diary-od-dot]')).toBeVisible();
    await expect(day).toHaveAttribute('aria-label', '10월 12일, 원드라이브 사진 6장');
    await expect(cell(page, '2026-10-11').locator('[data-diary-od-dot]')).toHaveCount(0);
    expect(f.edge.some(b => b.action === 'photos' && b.month === '2026-10')).toBe(true);
    await day.click();
    const detail = page.locator('#diaryRoot [data-diary-detail]'), grid = detail.locator('[data-diary-grid] .diary-grid-item');
    await expect(detail).toContainText('일기 없음');
    await expect(grid).toHaveCount(6);
    await expect(grid.first().locator('img')).toBeVisible();
    // OD-사진크기: [－]는 칸을 늘리고 [＋]는 줄인다(폰 4→6, 넓은 화면 6→8). 끝 단계 버튼은 누를 수 없다. 격자를 다시 그리지 않는다.
    const cols = () => detail.locator('[data-diary-grid]').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    const firstImg = await grid.first().locator('img').elementHandle();
    expect(await cols()).toBe(width < 761 ? 4 : 6);
    await expect(detail.locator('[data-photo-size="1"]')).toBeEnabled({ enabled: width < 761 });
    await detail.locator('[data-photo-size="-1"]').click();
    await expect.poll(cols).toBe(width < 761 ? 6 : 8);
    expect(await firstImg.evaluate(el => el.isConnected)).toBe(true);
    await detail.locator('[data-photo-size="1"]').click();
    await expect.poll(cols).toBe(width < 761 ? 4 : 6);
    // 격자 위 두 손가락: 벌리면 크게(칸 줄임), 오므리면 작게(칸 늘림). 격자는 touch-action:pan-y라 화면 확대가 되지 않는다.
    const pinch = (from, to) => detail.locator('[data-diary-grid]').evaluate((el, [from, to]) => {
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + 20;
      const T = (id, x) => new Touch({ identifier: id, target: el, clientX: x, clientY: cy });
      const ev = (type, d) => el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [T(1, cx - d), T(2, cx + d)], changedTouches: [T(1, cx - d), T(2, cx + d)], bubbles: true, cancelable: true }));
      ev('touchstart', from); ev('touchmove', to); ev('touchend', to);
    }, [from, to]);
    expect(await detail.locator('[data-diary-grid]').evaluate(el => getComputedStyle(el).touchAction)).toBe('pan-y');
    await pinch(40, 70);
    await expect.poll(cols).toBe(width < 761 ? 3 : 6);
    await pinch(70, 40);
    await expect.poll(cols).toBe(width < 761 ? 4 : 8);
    await expect(detail.locator('.diary-star-mark:not([hidden])')).toHaveCount(0);
    expect(f.photoReads.every(r => r.size === 'small')).toBe(true);

    await grid.nth(0).click();
    const viewer = page.locator('#diaryRoot [data-diary-viewer]'), star = viewer.locator('[data-diary-star]'), count = viewer.locator('[data-diary-viewer-count]');
    await expect(viewer).toBeVisible();
    await expect(count).toHaveText('1 / 6');
    // 위 줄 오른쪽에 찍은 날짜·시각(아래 가운데 글은 직접 올린 사진의 설명만).
    await expect(viewer.locator('[data-diary-viewer-when]')).toContainText('10:00');
    await expect(viewer.locator('[data-diary-viewer-caption]')).toHaveText('');
    await expect(viewer.locator('.diary-viewer-more, [data-diary-viewer-stars]')).toHaveCount(0);
    await expect(viewer.locator('.diary-slide').first().locator('img')).toBeVisible();
    // 가까운 사진만 크게 받는다(6장 중 처음 3장).
    expect(new Set(f.photoReads.filter(r => r.size === 'large').map(r => r.id))).toEqual(new Set(['A1', 'A2', 'A3']));
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => f.starWrites.length).toBe(1);
    expect(f.starWrites[0].body).toEqual({ workspace_id: 'w', source: 'onedrive', item_key: 'A1', taken_day: '2026-10-12' });
    // 넘기기 + S 키
    await page.keyboard.press('ArrowRight');
    await expect(count).toHaveText('2 / 6');
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('s');
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    // 위로 밀기 = 별표(한 손가락, 충분히 길게). 짧게 밀면 아무 일도 없다.
    await page.keyboard.press('ArrowRight');
    await expect(count).toHaveText('3 / 6');
    await swipe(page, -30);
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await swipe(page, -160);
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => f.stars.map(s => s.item_key).sort()).toEqual(['A1', 'A2', 'A3']);
    await viewer.locator('[data-diary-viewer-close]').click();
    await expect(viewer).toHaveCount(0);
    await expect(detail.locator('.diary-star-mark:not([hidden])')).toHaveCount(3);

    // [별표]에는 별표한 3장만. 거기서 하나 풀면 닫을 때 목록에서 빠진다.
    await detail.locator('[data-diary-source="star"]').click();
    await expect(grid).toHaveCount(3);
    await grid.nth(0).click();
    await page.keyboard.press('s');
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => f.stars.map(s => s.item_key).sort()).toEqual(['A2', 'A3']);
    await viewer.locator('[data-diary-viewer-close]').click();
    await expect(grid).toHaveCount(2);
    await detail.locator('[data-diary-source="all"]').click();
    await expect(grid).toHaveCount(6);

    // 🗑 지우기: 묻지 않고 바로 목록에서 빠지고 '되돌리기'가 보인다. 되돌리면 같은 자리로, 요청은 없다.
    await grid.nth(0).click();
    await expect(count).toHaveText('1 / 6');
    await page.keyboard.press('ArrowRight');
    await expect(count).toHaveText('2 / 6');
    const writesBefore = f.starWrites.length;
    const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    const undo = viewer.locator('[data-diary-undo]');
    await viewer.locator('[data-od-delete]').click();
    await expect(count).toHaveText('2 / 5');
    await expect(viewer.locator('[data-diary-viewer-note]')).toContainText('휴지통으로 옮겼어요');
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(count).toHaveText('2 / 6');
    await expect(undo).toBeHidden();
    expect(f.edge.filter(b => b.action === 'photo-delete').length).toBe(0);
    // 다시 지우고 닫으면(되돌리기 시간 안이라도) 그때 휴지통 이동 요청 한 번, 별표 기록은 그대로.
    await viewer.locator('[data-od-delete]').click();
    await expect(count).toHaveText('2 / 5');
    await swipe(page, 160); // 아래로 밀기 = 닫기
    await expect(viewer).toHaveCount(0);
    await expect.poll(() => f.edge.filter(b => b.action === 'photo-delete').length).toBe(1);
    expect(f.edge.find(b => b.action === 'photo-delete')).toEqual({ action: 'photo-delete', id: 'A2', confirm: true });
    expect(f.starWrites.length).toBe(writesBefore);
    expect(f.stars.some(s => s.item_key === 'A2')).toBe(true);
    expect(dialogs).toEqual([]);
    await expect(grid).toHaveCount(5);
    await expect(day).toHaveAttribute('aria-label', '10월 12일, 원드라이브 사진 5장');
    expect(f.errors).toEqual([]);
  });
}

test('연결 전: 한 줄 안내 → 연결 버튼은 마이크로소프트 로그인으로, 돌아오면 폴더를 고르고, 연결 끊기는 확인 뒤', async ({ page }) => {
  const f = await fixture(page, { status: { configured: true, connected: false, folder: null, can_delete: false }, days: {} });
  await page.route('https://login.microsoftonline.com/**', r => r.fulfill({ contentType: 'text/html', body: '<p>ms</p>' }));
  await openDiary(page, 390);
  await expect(odIcon(page)).toBeVisible();
  await expect(odIcon(page)).toHaveAttribute('data-state', 'off');
  await expect(odIcon(page)).toHaveAttribute('aria-label', '원드라이브 · 연결 안 됨');
  // 옛 연결 줄은 없다(아이콘 하나만).
  await expect(page.locator('#diaryRoot .diary-od-line')).toHaveCount(0);
  await expect(page.locator('#diaryRoot [data-diary-od]')).toBeHidden();
  await odIcon(page).click();
  await expect(odMenu(page)).toContainText('연결 안 됨');
  await odMenu(page).getByRole('button', { name: '원드라이브 연결' }).click();
  await page.waitForURL(/login\.microsoftonline\.com/);
  expect(f.edge.some(b => b.action === 'auth-start')).toBe(true);
  // 돌아오는 페이지: 코드를 # 뒤로 옮겨 일기로 보낸다.
  await page.goto(`${testOrigin}/app/onedrive-return.html?code=abc12345&state=s.t`);
  await expect(page.locator('#diaryRoot [data-diary-od]')).toContainText('연결됐어요. 사진을 읽을 폴더를 골라 주세요.');
  expect(f.edge.find(b => b.action === 'auth-finish')).toEqual({ action: 'auth-finish', code: 'abc12345', state: 's.t' });
  expect(new URL(page.url()).hash).toBe('');
  const panel = page.locator('#diaryRoot [data-diary-od]');
  await expect(panel.getByRole('button', { name: '사진', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '사진', exact: true }).click();
  await expect(panel).toContainText('맨 위 › 사진');
  await panel.getByRole('button', { name: '이 폴더 쓰기' }).click();
  await expect(odIcon(page)).toHaveAttribute('aria-label', '원드라이브 · 연결됨 · 사진');
  await expect(odIcon(page)).toHaveAttribute('data-state', 'ok');
  expect(f.edge.find(b => b.action === 'folder-set')).toEqual({ action: 'folder-set', folder_id: 'F3' });
  page.once('dialog', d => { expect(d.message()).toContain('별표 기록도 남아요'); d.accept(); });
  await odPick(page, '연결 끊기');
  await expect(odIcon(page)).toHaveAttribute('data-state', 'off');
  expect(f.edge.some(b => b.action === 'disconnect')).toBe(true);
  expect(f.errors).toEqual([]);
});

test('원드라이브 준비가 안 된 서버에서는 연결 줄이 없고 일기는 그대로다', async ({ page }) => {
  const f = await fixture(page, { status: { configured: false, connected: false, folder: null }, days: {} });
  await openDiary(page, 390);
  await expect(page.locator('#diaryRoot [data-diary-od]')).toBeHidden();
  await expect(odIcon(page)).toBeHidden();
  await cell(page, '2026-10-12').click();
  await expect(page.locator('#diaryRoot [data-diary-detail]')).toContainText('일기 없음');
  await expect(page.locator('#diaryRoot [data-diary-detail] [data-diary-source]')).toHaveCount(0);
  // 원드라이브에는 연결 확인만 묻는다(OD-미리받기: 앱을 켤 때 한 번 + 일기를 열 때 한 번까지. '연결 안 됨'은 다시 쓰지 않는다).
  const actions = f.edge.map(b => b.action);
  expect(actions.length).toBeGreaterThanOrEqual(1); expect(actions.length).toBeLessThanOrEqual(2);
  expect(actions.every(a => a === 'status')).toBe(true);
  expect(f.errors).toEqual([]);
});

const TREE = () => ({
  top: { id: 'T', name: '카메라', count: 4, total: 30 },
  folders: [
    { id: 'A', name: '봄', parent_id: 'T', enabled: true, count: 5, total: 12 },
    { id: 'A1', name: '봄 여행', parent_id: 'A', enabled: true, count: 7, total: 7 },
    { id: 'B', name: '여름', parent_id: 'T', enabled: true, count: 14, total: 14 },
  ],
  indexing: false,
});
for (const width of [390, 1280]) {
  test(`설정 창: 하위 폴더 스위치를 펼치고 끈 뒤 [저장]하면 바뀐 폴더만 보내고 달 사진을 다시 읽는다. [취소]·뒤로가기는 보내지 않는다 ${width}`, async ({ page }) => {
    const f = await fixture(page, { width });
    f.tree = TREE();
    await openDiary(page, width);
    const panel = page.locator('#diaryRoot [data-diary-od]');
    await odPick(page, '하위 폴더 켜고 끄기');
    const sheet = panel.locator('[data-od-modal] [role="dialog"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('원드라이브 · 카메라');
    await expect(sheet).toContainText('켠 폴더의 사진만 달력에 보여요. 하위 폴더도 함께 읽어요.');
    await expect(sheet.getByRole('button', { name: '위 폴더 바꾸기' })).toBeVisible();
    await expect(sheet.locator('.diary-od-toprow')).toHaveText('카메라 (이 폴더 바로 안)4장');
    const rows = sheet.locator('.diary-od-row');
    await expect(rows).toHaveCount(2);
    await expect(sheet.locator('[role="switch"][aria-checked="true"]')).toHaveCount(2);
    // 팝업이 하단바에 가리지 않는다.
    const box = await sheet.boundingBox(), tabs = await page.locator('.mobile-tabs').boundingBox().catch(() => null);
    if (width <= 760 && tabs) expect(box.y + box.height).toBeLessThanOrEqual(tabs.y + 1);
    // ▸ 펼치면 하위 폴더가 들여쓰기로 나온다.
    await sheet.getByRole('button', { name: '봄 하위 폴더' }).click();
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toHaveAttribute('data-depth', '1');
    // 상위를 끄면 하위는 흐려진다.
    await sheet.getByRole('switch', { name: '봄 사진 보기' }).click();
    await expect(rows.nth(1)).toHaveClass(/is-dim/);
    await sheet.getByRole('switch', { name: '봄 여행 사진 보기' }).click();
    // 취소: 아무것도 보내지 않는다.
    await sheet.getByRole('button', { name: '취소' }).click();
    await expect(sheet).toHaveCount(0);
    expect(f.toggles).toEqual([]);
    // 뒤로가기도 창 닫기.
    await odPick(page, '하위 폴더 켜고 끄기');
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toHaveCount(0);
    // 저장: 바뀐 것만.
    await odPick(page, '하위 폴더 켜고 끄기');
    await sheet.getByRole('button', { name: '봄 하위 폴더' }).click();
    await sheet.getByRole('switch', { name: '봄 여행 사진 보기' }).click();
    await sheet.getByRole('switch', { name: '여름 사진 보기' }).click();
    await sheet.getByRole('switch', { name: '여름 사진 보기' }).click();
    const before = f.edge.filter(b => b.action === 'photos').length;
    await sheet.getByRole('button', { name: '저장' }).click();
    await expect(sheet).toHaveCount(0);
    expect(f.toggles).toEqual([{ action: 'folder-toggle', folder_id: 'A1', enabled: false }]);
    await expect.poll(() => f.edge.filter(b => b.action === 'photos').length).toBeGreaterThan(before);
    expect(f.errors).toEqual([]);
  });
}

test('사진 목록 받는 중: 429면 retry_after초 뒤, 409면 몇 초 뒤 다시 부르고 more:false에서 멈춘다. 화면을 떠나면 반복이 멈춘다', async ({ page }) => {
  const f = await fixture(page, { width: 390 });
  f.tree = TREE();
  f.syncPlan = [{ more: true, indexing: true }, { status: 429, json: { error: 'onedrive_throttled', retry_after: 1 } }, { more: true, indexing: true }, { more: false, indexing: false }];
  await openDiary(page, 390);
  const panel = page.locator('#diaryRoot [data-diary-od]');
  // UI-기다림표시통일 2차: 받는 중 글자 대신 회색 칸(wait-state.js) + 받은 장수.
  await expect(panel.locator('[data-od-sync] [data-wait]')).toHaveCount(1);
  await expect(panel.locator('[data-od-sync]')).toContainText('30장');
  await expect(panel.locator('[data-od-sync]')).toHaveCount(0, { timeout: 15000 });
  expect(f.edge.filter(b => b.action === 'sync')).toHaveLength(4);
  expect(f.errors).toEqual([]);
});

test('사진 목록 받기를 알 수 없는 오류가 막으면 알려진 문구로 보이고 반복하지 않는다', async ({ page }) => {
  const f = await fixture(page, { width: 390 });
  f.syncPlan = [{ status: 424, json: { error: 'onedrive_auth_expired' } }];
  await openDiary(page, 390);
  await expect(page.locator('#diaryRoot [data-diary-od]')).toContainText('원드라이브 연결이 풀렸어요. 다시 연결해 주세요.');
  expect(f.edge.filter(b => b.action === 'sync')).toHaveLength(1);
  // 오류는 아이콘의 작은 빨간 점, 드롭다운에도 같은 문구.
  await expect(odIcon(page)).toHaveAttribute('data-state', 'error');
  await expect(odIcon(page).locator('.od-link-dot')).toBeVisible();
  await odIcon(page).click();
  await expect(odMenu(page)).toContainText('원드라이브 연결이 풀렸어요. 다시 연결해 주세요.');
});

for (const width of [390, 1280]) {
  test(`원드라이브 아이콘: [오늘] 오른쪽 작은 아이콘, 드롭다운 항목, '일기에서 사진 보이기'를 끄면 원드라이브 사진만 빠지고 다시 켜면 돌아온다 ${width}`, async ({ page }) => {
    const f = await fixture(page, { width });
    await openDiary(page, width);
    const icon = odIcon(page), today = page.locator('#diaryRoot [data-diary-today]');
    await expect(icon).toHaveAttribute('data-state', 'ok');
    await expect(icon).toHaveAttribute('aria-label', '원드라이브 · 연결됨 · 카메라');
    const a = await today.boundingBox(), b = await icon.boundingBox();
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    expect(Math.abs((b.y + b.height / 2) - (a.y + a.height / 2))).toBeLessThanOrEqual(4);
    expect(b.height).toBeLessThanOrEqual(40);
    await expect(cell(page, '2026-10-12').locator('[data-diary-od-dot]')).toBeVisible();
    await icon.click();
    const menu = odMenu(page);
    await expect(menu).toContainText('연결됨 · 카메라');
    await expect(menu.locator('button')).toHaveText(['폴더 바꾸기', '하위 폴더 켜고 끄기', '✓일기에서 사진 보이기', '연결 끊기']);
    // 뒤로가기로 닫힌다.
    await page.goBack();
    await expect(menu).toBeHidden();
    await odPick(page, '일기에서 사진 보이기');
    await expect(cell(page, '2026-10-12').locator('[data-diary-od-dot]')).toHaveCount(0);
    await icon.click();
    await expect(menu.locator('[data-od-act="show"]')).toHaveAttribute('aria-checked', 'false');
    await menu.locator('[data-od-act="show"]').click();
    await expect(cell(page, '2026-10-12').locator('[data-diary-od-dot]')).toBeVisible();
    // 폴더 바꾸기 = 폴더 고르기 창.
    await odPick(page, '폴더 바꾸기');
    await expect(page.locator('#diaryRoot [data-od-modal]')).toContainText('맨 위');
    expect(f.errors).toEqual([]);
  });
}

test('원드라이브 상태 확인이 실패하면 아이콘에 빨간 점, 드롭다운 [다시 확인]', async ({ page }) => {
  const f = await fixture(page, { width: 390, statusFail: true });
  await openDiary(page, 390);
  await expect(odIcon(page)).toHaveAttribute('data-state', 'error');
  f.statusFail = false;
  await odPick(page, '다시 확인');
  await expect(odIcon(page)).toHaveAttribute('data-state', 'ok');
});
