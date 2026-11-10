import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// PHOTO-위쪽두줄앨범보기(요청함 10/31 16:18, 명진 '시안대로 진행'). 지어낸 서버(onedrive-photos·gdrive-photos·app_photo_tags·app_my_features), 네트워크 없음.
// - (UI-보기탭드롭다운 11/10) 보기는 [사진 ▾] 고르기 상자 하나. 다섯 보기 모두 위쪽 높이가 같고, 폰 412는 두 줄(제목+출처 / 도구 줄), PC 1280은 한 줄.
// - 출처 아이콘은 폰 제목 줄 오른쪽·PC 도구 줄 오른쪽 끝. 구글 드라이브 칩의 점(::before ≤10px)·누르는 범위(::after ≥44px) 그대로.
// - 앨범 탭: 정렬 [－][＋] … 출처 [+ 새 앨범](출처 칩은 모든 탭에서 보임). [－][＋]로 큰 칸 → 작은 그림 목록(이름·장수·기간) → 한 줄 목록, 서버(view_prefs.album_view)에 저장되어 새로고침해도 그대로.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const OD = [
  { id: 'O1', name: 'a.jpg', day: '2026-10-30', taken_at: '2026-10-30T03:00:00.000Z' },
  { id: 'O2', name: 'b.jpg', day: '2026-10-02', taken_at: '2026-10-02T03:00:00.000Z' },
].map(m => ({ ...m, approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: m.taken_at, size_bytes: 100 }));
const TAGS = [{ id: 't1', name: '제주', cover_key: null }, { id: 't2', name: '가족', cover_key: null }];
const LINKS = [{ tag_id: 't1', source: 'onedrive', item_key: 'O1', taken_day: '2026-10-30' }, { tag_id: 't1', source: 'onedrive', item_key: 'O2', taken_day: '2026-10-02' },
  { tag_id: 't2', source: 'onedrive', item_key: 'O2', taken_day: '2026-10-02' }];
const TABS = ['all', 'calendar', 'folders', 'albums', 'trash'];

async function fixture(page, width, prefs = { photo_sources_pc: { onedrive: true, gdrive: true } }) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  const server = await installViewPrefsServer(page, prefs);
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: TAGS }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tag_items', r => r.fulfill({ json: LINKS }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_my_features', r => r.fulfill({ json: ['calls', 'gdrive_photos'] }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true, whole: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'library') return r.fulfill({ json: { items: body.folder_id ? [] : OD, next_cursor: null, indexing: false } });
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': OD.length }, total: OD.length } });
      if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: OD.length, total: OD.length, enabled: true }, folders: [], indexing: false, whole: true } });
      if (body.action === 'trash-list') return r.fulfill({ json: { items: [], truncated: false } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/gdrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'status') return r.fulfill({ status: 424, json: { ok: false, error: 'drive_auth_expired' } });
      if (body.action === 'folders') return r.fulfill({ json: { ok: true, parent: 'root', name: '', up: null, folders: [], complete: true } });
      return r.fulfill({ json: { ok: true, items: [], more: false } });
    });
  } });
  return { errors, server };
}
async function openPhotos(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const root = page => page.locator('#photosRoot');
// 위쪽 묶음 높이와 줄 수(보이는 칸 가운데 높이가 다른 줄의 개수), 도구 줄 칸 순서, 출처 아이콘·제목 자리.
// UI-보기탭드롭다운(11/10): 탭 줄 없음 — 폰 = 제목 '사진' + 출처 / 도구 줄([사진 ▾] 맨 앞), PC = 한 줄(출처는 도구 줄 오른쪽 끝).
const barShape = page => root(page).locator('[data-photos-bar]').evaluate(bar => {
  const box = bar.getBoundingClientRect(), tools = bar.querySelector('[data-photos-tools]'), srcs = bar.querySelector('.photos-srcs'), title = bar.querySelector('.photos-title');
  const visible = el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 1;
  const shown = [...tools.children].filter(visible), all = [...shown, ...[...srcs.children].filter(visible)];
  if (visible(title)) all.push(title);
  const mids = [...new Set(all.map(el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) / 6)))];
  return { height: Math.round(box.height), lines: mids.length, toolsTop: tools.getBoundingClientRect().top, srcsBottom: srcs.getBoundingClientRect().bottom,
    srcsLeft: srcs.getBoundingClientRect().left, toolsRight: Math.max(...shown.map(el => el.getBoundingClientRect().right)), titleShown: visible(title),
    inside: all.every(el => el.getBoundingClientRect().right <= box.right + 0.5 && el.getBoundingClientRect().left >= box.left - 0.5),
    tabRow: bar.querySelectorAll('.ds-seg, [data-photos-tab]').length,
    order: shown.map(el => el.dataset.photosView !== undefined ? 'view' : el.dataset.photosFilter !== undefined ? 'filter' : el.dataset.photosSort !== undefined ? 'sort' : el.classList.contains('photo-size') ? 'size'
      : el.classList.contains('photos-sp') ? 'sp' : el.dataset.photosAlNew !== undefined ? 'new' : el.dataset.photosTidyChip !== undefined ? 'tidy' : el.className) };
});
const gdMarks = page => root(page).locator('[data-photos-src="gdrive"]').evaluate(b => {
  const d = getComputedStyle(b, '::before'), a = getComputedStyle(b, '::after');
  return { dot: [d.content, parseFloat(d.width), parseFloat(d.height)], hit: [a.content, parseFloat(a.minWidth), parseFloat(a.minHeight)] };
});

for (const width of [412, 1280]) {
  test(`사진 위쪽: 다섯 보기 모두 [사진 ▾] 고르기 상자·같은 높이, 폰 두 줄(출처는 제목 줄)·PC 한 줄 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await openPhotos(page, width);
    await expect(root(page).locator('[data-photos-src="gdrive"]')).toBeVisible();
    const view = root(page).locator('[data-photos-view]');
    await expect(view.locator('option')).toHaveText(['사진', '달력', '폴더', '앨범', '휴지통']);
    // 폰은 앱 머리 대신 화면 첫 줄이 제목(앱 머리 숨김), PC는 위쪽 경로 줄이 이름을 보인다.
    await expect(page.locator('#appView > .mobile-shell-header')).toBeHidden();
    const heights = {};
    for (const tab of TABS) {
      await view.selectOption(tab);
      await expect(view).toHaveValue(tab);
      const s = await barShape(page);
      expect(s.tabRow, `${tab}: 탭 칸 줄 없음`).toBe(0);
      expect(s.lines, `${tab}: 위쪽 줄 수`).toBe(width <= 760 ? 2 : 1);
      expect(s.titleShown, `${tab}: 제목 '사진'은 폰만`).toBe(width <= 760);
      if (width <= 760) expect(s.toolsTop, `${tab}: 도구 줄은 제목·출처 줄 아래`).toBeGreaterThanOrEqual(s.srcsBottom - 0.5);
      else expect(s.srcsLeft, `${tab}: 출처는 도구 줄 오른쪽 끝`).toBeGreaterThanOrEqual(s.toolsRight - 0.5);
      expect(s.inside, `${tab}: 화면 안`).toBe(true);
      heights[tab] = s.height;
      expect(s.order[0], `${tab}: [사진 ▾]가 도구 줄 맨 앞`).toBe('view');
      if (tab === 'all') expect(s.order).toEqual(['view', 'filter', 'sort', 'size', 'sp']);
      if (tab === 'calendar') expect(s.order).toEqual(['view', 'filter', 'sp']);
      if (tab === 'folders') expect(s.order).toEqual(['view', 'sort', 'size', 'sp']);
      if (tab === 'albums') expect(s.order).toEqual(['view', 'sort', 'size', 'sp', 'new']);
      if (tab === 'trash') expect(s.order).toEqual(['view', 'size', 'sp']);
      // 고른 이름이 상자 글자.
      expect(await view.evaluate(el => el.selectedOptions[0].textContent)).toBe({ all: '사진', calendar: '달력', folders: '폴더', albums: '앨범', trash: '휴지통' }[tab]);
    }
    expect(new Set(Object.values(heights)).size, JSON.stringify(heights)).toBe(1);
    // 키보드: [사진 ▾]에서 Enter로 작은 목록(공용 select-menu.js) → ↓ → Enter면 다음 보기, Esc는 닫기만.
    await view.selectOption('all');
    await view.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#kptuSelectMenu')).toBeVisible();
    await expect(page.locator('#kptuSelectMenu')).toContainText('휴지통');
    await page.keyboard.press('Escape');
    await expect(view).toHaveValue('all');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(view).toHaveValue('calendar');
    await expect(root(page).locator('[data-photos-filter]')).toBeVisible();
    await expect(root(page).locator('[data-photos-sort]')).toBeHidden();
    // 출처 칩을 옮겨도 문제 점(::before)은 작고, 누르는 범위(::after)는 44px.
    await root(page).locator('[data-photos-view]').selectOption('all');
    await expect(root(page).locator('[data-photos-src="gdrive"]')).toHaveAttribute('data-problem', /.*/);
    const m = await gdMarks(page);
    expect(m.dot[0]).not.toBe('none');
    expect(m.dot[1]).toBeLessThanOrEqual(10);
    expect(m.dot[2]).toBeLessThanOrEqual(10);
    expect(m.hit[1]).toBeGreaterThanOrEqual(44);
    expect(m.hit[2]).toBeGreaterThanOrEqual(44);
    expect(f.errors).toEqual([]);
  });
}

test('앨범 탭: [－][＋]로 큰 칸 → 작은 그림 목록 → 한 줄 목록, 서버에 저장되어 새로고침해도 그대로 412', async ({ page }) => {
  const width = 412;
  const f = await fixture(page, width);
  await openPhotos(page, width);
  await root(page).locator('[data-photos-view]').selectOption('albums');
  const list = root(page).locator('[data-photos-albums]');
  const minus = root(page).locator('[data-photo-size="-1"]'), plus = root(page).locator('[data-photo-size="1"]');
  await expect(list).toHaveAttribute('data-view', 'card');
  await expect(root(page).locator('[data-photos-al-new]')).toBeVisible();
  await expect(plus).toBeDisabled();
  await expect(list.locator('[data-photos-album]')).toHaveCount(2);
  // 작은 그림 목록: 이름·장수·기간.
  await minus.click();
  await expect(list).toHaveAttribute('data-view', 'thumb');
  const jeju = list.locator('[data-photos-album="t1"]');
  await expect(jeju.locator('.photos-album-name')).toHaveText('#제주');
  await expect(jeju.locator('.photos-album-meta')).toHaveText('2장 · 2026.10.2–10.30');
  await expect(jeju.locator('[data-photos-al-cover]')).toBeVisible();
  // 한 줄 목록: 그림 없이 이름 … 장수.
  await minus.click();
  await expect(list).toHaveAttribute('data-view', 'line');
  await expect(minus).toBeDisabled();
  await expect(jeju.locator('[data-photos-al-cover]')).toHaveCount(0);
  await expect(jeju.locator('.photos-album-n')).toHaveText('2');
  const row = await jeju.boundingBox();
  expect(row.height).toBeLessThanOrEqual(52);
  await expect.poll(() => f.server.value?.album_view).toBe('line');
  // 앨범을 열면 [－][＋]는 다시 사진 칸 수, [+ 새 앨범]은 숨는다. 목록으로 돌아오면 한 줄 목록 그대로.
  await jeju.locator('[data-photos-al-open]').click();
  await expect(root(page).locator('[data-photos-al-back]')).toBeVisible();
  await expect(root(page).locator('[data-photos-al-new]')).toBeHidden();
  await expect(minus).toHaveAttribute('aria-label', /사진 작게/);
  await root(page).locator('[data-photos-al-back]').click();
  await expect(list).toHaveAttribute('data-view', 'line');
  // 새로고침해도 서버 값으로 한 줄 목록.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  if (!(await page.locator('#photosView').isVisible())) await openPhotos(page, width);
  await root(page).locator('[data-photos-view]').selectOption('albums');
  await expect(root(page).locator('[data-photos-albums]')).toHaveAttribute('data-view', 'line');
  await plus.click();
  await expect(root(page).locator('[data-photos-albums]')).toHaveAttribute('data-view', 'thumb');
  await expect.poll(() => f.server.value?.album_view).toBe('thumb');
  expect(f.errors).toEqual([]);
});
