import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// 사진 메뉴 ②(2026-10-29 08:07 요청): [폴더](원드라이브 폴더 나무·폴더 안 사진·여러 장 옮기기·끌어 놓기·되돌리기·우클릭/⋯ 메뉴·새 폴더)와
// [앨범](#태그: 새 앨범에 넣기·앨범 카드·앨범 사진·앨범에서 빼기). 지어낸 Supabase: onedrive-photos(Edge)·app_photo_tags·app_photo_tag_items·app_diary_stars.
// 폭: 폰 412(한 화면씩)·폴드 펼침 884(한 화면씩)·PC 1440(왼쪽 나무 + 오른쪽 격자).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const media = (id, parent, day, hour) => ({ id, parent, name: id + '.jpg', day, taken_at: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null });
const newest = (a, b) => b.taken_at.localeCompare(a.taken_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
const out = ({ parent, ...m }) => m;

async function fixture(page, width) {
  const state = {
    folders: [{ id: 'S1', name: '2026', parent_id: 'T' }, { id: 'S2', name: '여행', parent_id: 'T' }, { id: 'S21', name: '제주', parent_id: 'S2' }],
    media: [media('A1', 'T', '2026-10-05', 3), media('A2', 'T', '2026-10-04', 3), media('B1', 'S1', '2026-10-03', 3), media('B2', 'S1', '2026-10-02', 3), media('B3', 'S1', '2026-10-01', 3),
      media('C1', 'S21', '2026-09-20', 3)],
    tags: [], links: [], edge: [], rest: [], errors: [],
  };
  page.on('pageerror', e => state.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) state.errors.push(m.text()); });
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    state.rest.push({ table: 'tags', method: req.method(), body: req.postDataJSON?.() ?? null });
    if (req.method() === 'GET') return r.fulfill({ json: state.tags });
    if (req.method() === 'POST') { const row = { id: 'tag-' + (state.tags.length + 1), name: req.postDataJSON().name, cover_key: null }; state.tags.push(row); return r.fulfill({ status: 201, json: [row] }); }
    if (req.method() === 'DELETE') { const id = q.get('id').replace(/^eq\./, ''); state.tags = state.tags.filter(t => t.id !== id); state.links = state.links.filter(l => l.tag_id !== id); return r.fulfill({ status: 204, body: '' }); }
    return r.fulfill({ status: 204, body: '' });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tag_items', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    if (req.method() === 'GET') return r.fulfill({ json: state.links });
    if (req.method() === 'POST') { const rows = req.postDataJSON(); state.rest.push({ table: 'items', method: 'POST', body: rows }); state.links.push(...rows.map(x => ({ tag_id: x.tag_id, item_key: x.item_key, taken_day: x.taken_day }))); return r.fulfill({ status: 201, body: '' }); }
    if (req.method() === 'DELETE') {
      const keys = (q.get('item_key') || '').replace(/^in\.\(|\)$/g, '').split(',').map(k => k.replace(/^"|"$/g, ''));
      state.rest.push({ table: 'items', method: 'DELETE', keys });
      state.links = state.links.filter(l => !keys.includes(l.item_key));
      return r.fulfill({ status: 204, body: '' });
    }
    return r.fulfill({ status: 400, json: {} });
  });
  const total = id => state.media.filter(m => m.parent === id).length + state.folders.filter(f => f.parent_id === id).reduce((n, f) => n + total(f.id), 0);
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    state.edge.push(body);
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': 5, '2026-09': 1 }, total: 6 } });
    if (body.action === 'library') {
      const list = state.media.filter(m => (body.folder_id ? m.parent === body.folder_id : true) && (body.filter === 'star' ? (body.star_ids || []).includes(m.id) : true)).sort(newest);
      return r.fulfill({ json: { items: list.slice(0, body.limit).map(out), next_cursor: null, indexing: false } });
    }
    if (body.action === 'folders-tree') {
      return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: state.media.filter(m => m.parent === 'T').length, total: total('T') },
        folders: state.folders.map(f => ({ ...f, enabled: true, count: state.media.filter(m => m.parent === f.id).length, total: total(f.id) })), indexing: false } });
    }
    if (body.action === 'photos-move') {
      const moved = [];
      for (const id of body.ids) { const m = state.media.find(x => x.id === id); if (m) { moved.push({ id, from: m.parent }); m.parent = body.parent_id; } }
      return r.fulfill({ json: { moved, failed: {} } });
    }
    if (body.action === 'folder-create') { const f = { id: 'N' + state.folders.length, name: body.name, parent_id: body.parent_id }; state.folders.push(f); return r.fulfill({ json: { folder: f } }); }
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  return state;
}
// 폭마다 보이는 메뉴(왼쪽 메뉴·☰·아래 [메뉴] 탭)로 연다(공용 도우미).
async function openPhotos(page) {
  await clickView(page, 'photos');
  await expect(page.locator('#photosView')).toBeVisible();
}
const root = page => page.locator('#photosRoot');
const items = page => root(page).locator('[data-photos-open]');
const ids = async page => items(page).evaluateAll(list => list.map(b => b.dataset.photosId));
const hold = async (page, locator) => { const b = await locator.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); };
const path = page => root(page).locator('.photos-fx-path');

for (const width of [412, 884, 1440]) {
  test(`사진 메뉴 ② 폴더: 폴더 나무·폴더 안 사진·여러 장 옮기기·되돌리기·메뉴·새 폴더 ${width}`, async ({ page }) => {
    const f = await fixture(page, width), wide = width >= 1024;
    await openPhotos(page);
    await root(page).locator('[data-photos-tab="folders"]').click();
    await expect(root(page).locator('[data-photos-tab="folders"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(path(page)).toHaveText('사진›카메라');
    // 맨 위 폴더 바로 안 사진(서버 library folder_id).
    await expect.poll(() => ids(page)).toEqual(['A1', 'A2']);
    expect(f.edge.find(b => b.action === 'library' && b.folder_id)).toMatchObject({ folder_id: 'T' });
    if (wide) {
      // PC: 왼쪽 폴더 나무(맨 위 폴더 + 이름순, 폴더마다 장수, 닫힌 폴더 안은 안 보임) + 맨 아래 + 새 폴더.
      const tree = root(page).locator('[data-photos-fx-tree]');
      await expect(tree.locator('.nx-name')).toHaveText(['카메라', '2026', '여행']);
      await expect(tree.locator('.nx-num')).toHaveText(['6', '3', '1']);
      await expect(tree.locator('[data-photos-fx-new]')).toHaveText('+ 새 폴더');
      await tree.locator('[data-photos-fx-tog="S2"]').click();
      await expect(tree.locator('.nx-name')).toHaveText(['카메라', '2026', '여행', '제주']);
      await tree.locator('[data-photos-fx-open="S1"]').click();
      await expect(tree.locator('[data-photos-folder="S1"]')).toHaveClass(/nx-current/);
    } else {
      // 폰: 한 화면씩 — 위 하위 폴더 줄, 아래 그 폴더 사진. 들어가면 위치 줄, 뒤로가기로 올라온다.
      await expect(root(page).locator('.photos-fx-list .nx-name')).toHaveText(['2026', '여행']);
      await expect(root(page).locator('[data-photos-fx-tree]')).toHaveCount(0);
      await root(page).locator('[data-photos-fx-open="S2"]').click();
      await expect(path(page)).toHaveText('사진›카메라›여행');
      await expect(root(page).locator('.photos-fx-list .nx-name')).toHaveText(['제주']);
      await root(page).locator('[data-photos-fx-open="S21"]').click();
      await expect(path(page)).toHaveText('사진›카메라›여행›제주');
      await expect.poll(() => ids(page)).toEqual(['C1']);
      await page.goBack();
      await expect(path(page)).toHaveText('사진›카메라›여행');
      // 위치 줄의 앞 칸을 누르면 그 단계로.
      await path(page).getByRole('button', { name: '카메라' }).click();
      await expect(path(page)).toHaveText('사진›카메라');
      await root(page).locator('[data-photos-fx-open="S1"]').click();
    }
    await expect(path(page)).toHaveText('사진›카메라›2026');
    await expect.poll(() => ids(page)).toEqual(['B1', 'B2', 'B3']);
    // 여러 장 고르기 → [📁 옮기기] → 폴더 나무에서 고름 → 원드라이브에서도 옮김(서버 photos-move), 위쪽 '옮겼어요 · 되돌리기'.
    await hold(page, items(page).nth(0));
    await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('1개 골랐음');
    await items(page).nth(1).click();
    await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('2개 골랐음');
    await root(page).locator('[data-photos-act-move]').click();
    const pick = page.locator('#photosPickMenu');
    await expect(pick).toBeVisible();
    await expect(pick.locator('[data-pick-folder]')).toHaveText(['📁 카메라', '📁 2026', '📁 여행', '📁 제주']);
    await expect(pick.locator('[data-pick-folder="S1"]')).toBeDisabled();
    await pick.locator('[data-pick-folder="S2"]').click();
    await expect.poll(() => ids(page)).toEqual(['B3']);
    const move = f.edge.filter(b => b.action === 'photos-move');
    expect(move).toHaveLength(1);
    expect(move[0]).toMatchObject({ parent_id: 'S2' });
    expect(move[0].ids.slice().sort()).toEqual(['B1', 'B2']);
    await expect(page.locator('.kptu-notice-undo')).toBeVisible();
    await page.locator('.kptu-notice-undo').click();
    await expect.poll(() => f.edge.filter(b => b.action === 'photos-move').length).toBe(2);
    const back = f.edge.filter(b => b.action === 'photos-move')[1];
    expect(back.parent_id).toBe('S1');
    expect(back.ids.slice().sort()).toEqual(['B1', 'B2']);
    await expect.poll(() => ids(page)).toEqual(['B1', 'B2', 'B3']);
    // 폴더 메뉴: PC는 우클릭(공용 context-menu.js), 폰은 ⋯. 새 하위 폴더·이름 바꾸기·옮기기·지우기.
    const fm = page.locator('#photosFolderMenu');
    if (wide) await root(page).locator('[data-photos-fx-tree] [data-photos-folder="S2"] .nx-name').click({ button: 'right' });
    else {
      // 폰: 위치 줄로 맨 위 폴더에 올라가 그 하위 폴더 줄의 ⋯.
      await path(page).getByRole('button', { name: '카메라' }).click();
      await expect(path(page)).toHaveText('사진›카메라');
      await root(page).locator('[data-photos-fx-more="S2"]').click();
    }
    await expect(fm).toBeVisible();
    await expect(fm.locator('button')).toHaveText(['새 하위 폴더', '이름 바꾸기', '옮기기…', '지우기']);
    await page.keyboard.press('Escape');
    await expect(fm).toBeHidden();
    // + 새 폴더: 지금 폴더(PC 2026, 폰 맨 위 카메라) 안에. 이름 줄에 쓰고 Enter.
    await root(page).locator('[data-photos-fx-new]').click();
    await expect(root(page).locator('[data-photos-name]')).toBeVisible();
    await root(page).locator('[data-photos-name-input]').fill('가을');
    await root(page).locator('[data-photos-name-input]').press('Enter');
    await expect.poll(() => f.edge.find(b => b.action === 'folder-create')).toMatchObject({ parent_id: wide ? 'S1' : 'T', name: '가을' });
    await expect(root(page).locator('[data-photos-folder="N3"] .nx-name')).toHaveText('가을');
    expect(f.errors).toEqual([]);
  });
}

test('사진 메뉴 ② 폴더 PC 1440: 고른 사진을 왼쪽 폴더로 끌어 놓기 → 옮김·되돌리기, 사진 우클릭 메뉴 맨 위 [선택]', async ({ page }) => {
  const f = await fixture(page, 1440);
  await openPhotos(page);
  await root(page).locator('[data-photos-tab="folders"]').click();
  const tree = root(page).locator('[data-photos-fx-tree]');
  await tree.locator('[data-photos-fx-open="S1"]').click();
  await expect.poll(() => ids(page)).toEqual(['B1', 'B2', 'B3']);
  // 사진 우클릭 = [선택] [폴더로 옮기기…] [앨범에 넣기…] [지우기].
  await items(page).nth(2).click({ button: 'right' });
  const pm = page.locator('#photosPhotoMenu');
  await expect(pm).toBeVisible();
  await expect(pm.locator('button')).toHaveText(['선택', '폴더로 옮기기…', '앨범에 넣기…', '지우기']);
  await pm.locator('button', { hasText: '선택' }).click();
  await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('1개 골랐음');
  await items(page).nth(1).click();
  await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('2개 골랐음');
  // 고른 것 중 하나를 잡아 왼쪽 '여행' 폴더에 놓는다.
  await items(page).nth(1).dragTo(tree.locator('[data-photos-folder="S2"] .nx-main'));
  await expect.poll(() => f.edge.filter(b => b.action === 'photos-move').length).toBe(1);
  const move = f.edge.find(b => b.action === 'photos-move');
  expect(move.parent_id).toBe('S2');
  expect(move.ids.slice().sort()).toEqual(['B2', 'B3']);
  await expect.poll(() => ids(page)).toEqual(['B1']);
  await expect(tree.locator('[data-photos-folder="S2"] .nx-num')).toHaveText('3');
  await page.locator('.kptu-notice-undo').click();
  await expect.poll(() => ids(page)).toEqual(['B1', 'B2', 'B3']);
  expect(f.edge.filter(b => b.action === 'photos-move')[1]).toMatchObject({ parent_id: 'S1' });
  expect(f.errors).toEqual([]);
});

for (const width of [412, 1440]) {
  test(`사진 메뉴 ② 앨범: 고른 사진을 새 앨범에 넣기 → 앨범 카드 → 앨범 사진 → 앨범에서 빼기 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await openPhotos(page);
    await root(page).locator('[data-photos-tab="albums"]').click();
    await expect(root(page).locator('[data-photos-al-new]')).toHaveText('+ 새 앨범');
    await expect(root(page).locator('[data-photos-album]')).toHaveCount(0);
    await root(page).locator('[data-photos-tab="all"]').click();
    await expect.poll(() => ids(page)).toEqual(['A1', 'A2', 'B1', 'B2', 'B3', 'C1']);
    await hold(page, items(page).nth(0));
    await items(page).nth(2).click();
    await expect(root(page).locator('[data-photos-sel-count]')).toHaveText('2개 골랐음');
    await root(page).locator('[data-photos-act-tag]').click();
    const pick = page.locator('#photosPickMenu');
    await expect(pick).toBeVisible();
    await pick.locator('[data-pick-newtag]').click();
    await root(page).locator('[data-photos-name-input]').fill('#제주');
    await root(page).locator('[data-photos-name-input]').press('Enter');
    await expect.poll(() => f.links.map(l => l.item_key).sort()).toEqual(['A1', 'B1']);
    expect(f.rest.find(x => x.table === 'tags' && x.method === 'POST').body).toMatchObject({ name: '제주' });
    expect(f.rest.find(x => x.table === 'items' && x.method === 'POST').body.every(x => x.tag_id === 'tag-1' && x.source === 'onedrive')).toBe(true);
    await expect(root(page).locator('[data-photos-sel]')).toBeHidden();
    // [앨범]: 카드(#이름·장수) → 누르면 그 앨범 사진(서버 library에 그 사진 id만).
    await root(page).locator('[data-photos-tab="albums"]').click();
    const card = root(page).locator('[data-photos-album="tag-1"]');
    await expect(card.locator('.photos-album-name')).toHaveText('#제주');
    await expect(card.locator('.photos-album-n')).toHaveText('2');
    await card.locator('[data-photos-al-open]').click();
    await expect.poll(() => ids(page)).toEqual(['A1', 'B1']);
    expect(f.edge.filter(b => b.action === 'library').at(-1)).toMatchObject({ filter: 'star' });
    expect(f.edge.filter(b => b.action === 'library').at(-1).star_ids.slice().sort()).toEqual(['A1', 'B1']);
    // 하나 골라 [앨범에서 빼기] → 연결만 지움(사진은 그대로), 되돌리기 있음.
    await hold(page, items(page).nth(1));
    await expect(root(page).locator('[data-photos-act-untag]')).toBeVisible();
    await root(page).locator('[data-photos-act-untag]').click();
    await expect.poll(() => ids(page)).toEqual(['A1']);
    expect(f.rest.find(x => x.table === 'items' && x.method === 'DELETE').keys).toEqual(['B1']);
    await expect(page.locator('.kptu-notice-undo')).toBeVisible();
    // 뒤로가기 = 앨범 목록.
    await page.goBack();
    await expect(root(page).locator('[data-photos-album="tag-1"] .photos-album-n')).toHaveText('1');
    expect(f.errors).toEqual([]);
  });
}
