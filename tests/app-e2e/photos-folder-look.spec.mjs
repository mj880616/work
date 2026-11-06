import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// FOLDER-순서·색 ③-2 (S49-50, docs/design/folder-color-order.md): 사진 [폴더](원드라이브 폴더)와 [앨범]에 노트와 같은 색 8가지·직접 정한 순서.
// 폴더·앨범 ⋯ 메뉴: [색 고르기…] → 동그라미 하나 / [위로][아래로] → 서버(app_folder_prefs·앨범 칸, 서버 함수)에 저장, 새로고침해도 유지, 저장 실패는 그대로 두고 알림,
// DB 적용 전(표·칸·함수 없음)에도 목록은 그대로. 폴더·앨범 이름은 모두 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const RGB = { 5: 'rgb(74, 132, 173)', 1: 'rgb(180, 90, 82)' };
const media = (id, parent, day) => ({ id, parent, name: id + '.jpg', day, taken_at: `${day}T03:00:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null });
const out = ({ parent, ...m }) => m;

async function fixture(page, width, { prefs = [], prefsMissing = false, prefsFail = false, tagsColMissing = false, tags = [] } = {}) {
  const state = { folders: [{ id: 'S1', name: '2026', parent_id: 'T' }, { id: 'S2', name: '여행', parent_id: 'T' }, { id: 'S3', name: '행사', parent_id: 'T' }],
    media: [media('A1', 'T', '2026-10-05'), media('B1', 'S1', '2026-10-03')], tags: tags.map(t => ({ cover_key: null, color: null, sort_order: 0, ...t })), prefs: prefs.map(p => ({ ...p })),
    prefCalls: [], tagCalls: [], errors: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) state.errors.push(m.text()); });
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tag_items', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', async r => {
    const q = new URL(r.request().url()).searchParams;
    if (r.request().method() !== 'GET') return r.fulfill({ status: 204, body: '' });
    if (tagsColMissing && /color|sort_order/.test(q.get('select') || '')) return r.fulfill({ status: 400, json: { code: '42703', message: 'column app_photo_tags.color does not exist' } });
    return r.fulfill({ json: state.tags.map(t => (tagsColMissing ? { id: t.id, name: t.name, cover_key: t.cover_key } : t)) });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_folder_prefs', r => (prefsMissing ? r.fulfill({ status: 404, json: { code: 'PGRST205', message: 'Could not find the table public.app_folder_prefs' } }) : r.fulfill({ json: state.prefs })));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_folder_prefs_apply', async r => {
    const b = r.request().postDataJSON();
    state.prefCalls.push({ source: b.p_source, items: b.p_items });
    if (prefsFail || prefsMissing) return r.fulfill({ status: prefsMissing ? 404 : 403, json: { code: prefsMissing ? 'PGRST202' : '42501', message: 'x' } });
    for (const it of b.p_items) {
      let row = state.prefs.find(x => x.source === b.p_source && x.folder_key === it.k);
      if (!row) state.prefs.push(row = { source: b.p_source, folder_key: it.k, color: null, sort_order: null });
      if ('c' in it) row.color = it.c;
      if ('o' in it) row.sort_order = it.o;
    }
    return r.fulfill({ json: { ok: true, count: b.p_items.length } });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_photo_tag_look_apply', async r => {
    const b = r.request().postDataJSON();
    state.tagCalls.push(b.p_items);
    if (prefsFail) return r.fulfill({ status: 403, json: { code: '42501', message: 'PHOTO_TAG_LOOK_FORBIDDEN' } });
    for (const it of b.p_items) { const t = state.tags.find(x => x.id === it.id); if (t) { if ('c' in it) t.color = it.c; if ('o' in it) t.sort_order = it.o; } }
    return r.fulfill({ json: { ok: true, count: b.p_items.length } });
  });
  const total = id => state.media.filter(m => m.parent === id).length + state.folders.filter(f => f.parent_id === id).reduce((n, f) => n + total(f.id), 0);
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': 2 }, total: 2 } });
    if (body.action === 'library') return r.fulfill({ json: { items: state.media.slice(0, body.limit).map(out), next_cursor: null, indexing: false } });
    if (body.action === 'folders-tree') {
      return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: 1, total: total('T') }, folders: state.folders.map(f => ({ ...f, enabled: true, count: state.media.filter(m => m.parent === f.id).length, total: total(f.id) })), indexing: false } });
    }
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  return state;
}
const root = page => page.locator('#photosRoot');
async function openTab(page, tab) {
  await clickView(page, 'photos');
  await expect(page.locator('#photosView')).toBeVisible();
  await root(page).locator(`[data-photos-tab="${tab}"]`).click();
}
const folderIds = page => root(page).locator('[data-photos-folder]').evaluateAll(els => els.map(e => e.dataset.photosFolder).filter(id => id !== 'T'));
// FOLDER-나무새기준 ③: 폰은 공용 줄(.ft-ico, 안 고른 폴더는 기본 노랑 그림), PC 나무는 지금 줄(.nx-ico).
const folderIcon = (page, id) => root(page).locator(`[data-photos-folder="${id}"] :is(.nx-ico, .ft-ico)`).first();
const plainIcon = async (page, id) => { const el = folderIcon(page, id); if (await el.evaluate(e => e.classList.contains('ft-ico'))) await expect(el).not.toHaveAttribute('data-fc', /./); else { await expect(el.locator('svg')).toHaveCount(1); await expect(el).not.toHaveAttribute('data-fc', /./); } };
async function openFolderMenu(page, id) {
  await root(page).locator(`[data-photos-fx-more="${id}"]`).first().click();
  await expect(page.locator('#photosFolderMenu')).toBeVisible();
}
async function pickFolderColor(page, id, name) {
  await openFolderMenu(page, id);
  await page.locator('#photosFolderMenu').getByRole('button', { name: '색 고르기…', exact: true }).click();
  const choice = page.locator('#photosFolderMenu .fl-choice');
  await expect(choice).toBeVisible();
  await choice.getByRole('radio', { name, exact: true }).click();
  await expect(page.locator('#photosFolderMenu')).toBeHidden();
}

for (const width of [1440, 412]) test.describe(`사진 폴더·앨범 색·순서 ${width}`, () => {
  test.use({ hasTouch: width < 761 });
  test(`폴더: 색·순서가 서버에 저장되고 새로고침해도 유지 ${width}`, async ({ page }, info) => {
    test.setTimeout(120000);
    const s = await fixture(page, width);
    await openTab(page, 'folders');
    await expect.poll(() => folderIds(page)).toEqual(['S1', 'S2', 'S3']);
    await expect(root(page).locator('[data-fc]')).toHaveCount(0);
    await plainIcon(page, 'S2');
    // 메뉴: 가운데 줄은 [색 고르기…][위로][아래로](끝 줄은 한쪽만).
    await openFolderMenu(page, 'S2');
    await expect(page.locator('#photosFolderMenu button')).toHaveText(['새 하위 폴더', '이름 바꾸기', '옮기기…', '색 고르기…', '위로', '아래로', '지우기']);
    await page.keyboard.press('Escape');
    await openFolderMenu(page, 'S1');
    await expect(page.locator('#photosFolderMenu button')).toHaveText(['새 하위 폴더', '이름 바꾸기', '옮기기…', '색 고르기…', '아래로', '지우기']);
    await page.keyboard.press('Escape');
    expect(s.prefCalls).toEqual([]);

    // 강청(5): 서버 함수 한 번, 그 폴더만 칠함, 값은 토큰 색.
    await pickFolderColor(page, 'S2', '강청');
    await expect.poll(() => s.prefCalls.length).toBe(1);
    expect(s.prefCalls[0]).toEqual({ source: 'od', items: [{ k: 'S2', c: 5 }] });
    await expect(folderIcon(page, 'S2')).toHaveAttribute('data-fc', '5');
    await expect(folderIcon(page, 'S1')).not.toHaveAttribute('data-fc', /./);
    expect(await folderIcon(page, 'S2').locator('svg').evaluate(x => getComputedStyle(x).color)).toBe(RGB[5]);

    // 위로: 순서 값 없던 형제 전체를 1024 간격으로 다시 매겨 한 번에. 목록 순서가 바뀐다.
    await openFolderMenu(page, 'S2');
    await page.locator('#photosFolderMenu').getByRole('button', { name: '위로', exact: true }).click();
    await expect.poll(() => s.prefCalls.length).toBe(2);
    expect(s.prefCalls[1].source).toBe('od');
    expect(s.prefCalls[1].items.map(i => i.k)).toEqual(['S2', 'S1', 'S3']);
    expect(s.prefCalls[1].items.map(i => i.o)).toEqual([1024, 2048, 3072]);
    await expect.poll(() => folderIds(page)).toEqual(['S2', 'S1', 'S3']);

    // 새로고침해도 유지(서버 값).
    await page.reload();
    await openTab(page, 'folders');
    await expect.poll(() => folderIds(page)).toEqual(['S2', 'S1', 'S3']);
    await expect(folderIcon(page, 'S2')).toHaveAttribute('data-fc', '5');

    // 맨 위 폴더는 [위로]가 없고 [아래로]만. [기본]으로 돌리면 지금 모양(📁), 서버에는 null.
    await openFolderMenu(page, 'S2');
    await expect(page.locator('#photosFolderMenu button')).toHaveText(['새 하위 폴더', '이름 바꾸기', '옮기기…', '색 고르기…', '아래로', '지우기']);
    await page.keyboard.press('Escape');
    await pickFolderColor(page, 'S2', '기본');
    await expect.poll(() => s.prefCalls.length).toBe(3);
    expect(s.prefCalls[2]).toEqual({ source: 'od', items: [{ k: 'S2', c: null }] });
    await expect(root(page).locator('[data-fc]')).toHaveCount(0);
    await plainIcon(page, 'S2');
    expect(s.errors).toEqual([]);
    if (width < 761) await page.screenshot({ path: info.outputPath('photos-folder-look-412.png') });
  });

  test(`폴더: 서버에 있던 정한 순서와 색이 그대로 보이고, 저장 실패는 그대로 두고 알림 ${width}`, async ({ page }) => {
    const s = await fixture(page, width, { prefs: [{ source: 'od', folder_key: 'S3', color: 1, sort_order: 1024 }], prefsFail: true });
    await openTab(page, 'folders');
    await expect.poll(() => folderIds(page)).toEqual(['S3', 'S1', 'S2']); // 정한 폴더가 앞, 나머지는 이름순
    await expect(folderIcon(page, 'S3')).toHaveAttribute('data-fc', '1');
    expect(await folderIcon(page, 'S3').locator('svg').evaluate(x => getComputedStyle(x).color)).toBe(RGB[1]);
    await pickFolderColor(page, 'S1', '청록');
    await expect.poll(() => s.prefCalls.length).toBe(1);
    await expect(page.locator('body')).toContainText('폴더 색을 저장하지 못했어요');
    await expect(folderIcon(page, 'S1')).not.toHaveAttribute('data-fc', /./);
    await openFolderMenu(page, 'S2');
    await page.locator('#photosFolderMenu').getByRole('button', { name: '위로', exact: true }).click();
    await expect.poll(() => s.prefCalls.length).toBe(2);
    await expect(page.locator('body')).toContainText('폴더 순서를 저장하지 못했어요');
    expect(await folderIds(page)).toEqual(['S3', 'S1', 'S2']);
  });

  test(`폴더: DB 적용 전(표·함수 없음)에도 목록은 이름순으로 뜬다 ${width}`, async ({ page }) => {
    await fixture(page, width, { prefsMissing: true });
    await openTab(page, 'folders');
    await expect.poll(() => folderIds(page)).toEqual(['S1', 'S2', 'S3']);
    await expect(root(page).locator('[data-fc]')).toHaveCount(0);
  });

  test(`앨범: 색·순서가 서버에 저장되고 새로고침해도 유지, 칸이 없는 서버는 이름순 ${width}`, async ({ page }, info) => {
    test.setTimeout(120000);
    const tags = [{ id: 't1', name: '가족' }, { id: 't2', name: '여행' }, { id: 't3', name: '행사' }];
    const s = await fixture(page, width, { tags });
    await openTab(page, 'albums');
    const albumIds = () => root(page).locator('[data-photos-album]').evaluateAll(els => els.map(e => e.dataset.photosAlbum));
    const nameIcon = id => root(page).locator(`[data-photos-album="${id}"] .photos-album-name .fl-ico`);
    await expect.poll(albumIds).toEqual(['t1', 't2', 't3']);
    await expect(root(page).locator('.photos-album-ico')).toHaveCount(0); // 안 고른 앨범은 지금 모양 그대로
    const menu = page.locator('#photosAlbumMenu');
    // 다시 그리는 중에 누르면 메뉴가 붙어 있던 단추가 바뀌어 닫히므로, 열릴 때까지 다시 누른다.
    const open = async id => { await expect(async () => { await root(page).locator(`[data-photos-album="${id}"] [data-photos-al-more]`).click(); await expect(menu).toBeVisible({ timeout: 1500 }); }).toPass({ timeout: 15000 }); };
    await open('t3');
    await expect(menu.locator('button')).toHaveText(['이름 바꾸기', '색 고르기…', '위로', '지우기(사진은 그대로)']);
    await menu.getByRole('button', { name: '색 고르기…', exact: true }).click();
    const choice = menu.locator('.fl-choice');
    await expect(choice.getByRole('radio')).toHaveCount(9);
    await choice.getByRole('radio', { name: '벽돌', exact: true }).click();
    await expect(menu).toBeHidden();
    await expect.poll(() => s.tagCalls.length).toBe(1);
    expect(s.tagCalls[0]).toEqual([{ id: 't3', c: 1 }]);
    await expect(nameIcon('t3')).toHaveAttribute('data-fc', '1');
    expect(await nameIcon('t3').locator('svg').evaluate(x => getComputedStyle(x).color)).toBe(RGB[1]);
    await expect(nameIcon('t1')).toHaveCount(0);

    // 위로: 정한 순서가 없던 앨범 전체를 1024 간격으로 다시 매긴다(한 번). 카드 순서가 바뀐다.
    await open('t3');
    await menu.getByRole('button', { name: '위로', exact: true }).click();
    await expect.poll(() => s.tagCalls.length).toBe(2);
    expect(s.tagCalls[1]).toEqual([{ id: 't1', o: 1024 }, { id: 't3', o: 2048 }, { id: 't2', o: 3072 }]);
    await expect.poll(albumIds).toEqual(['t1', 't3', 't2']);

    // [기본]: 그림이 없어지고 서버에는 null. 이미 기본인 앨범에 [기본]을 고르면 저장하지 않는다.
    await open('t3');
    await menu.getByRole('button', { name: '색 고르기…', exact: true }).click();
    await menu.locator('.fl-choice').getByRole('radio', { name: '기본', exact: true }).click();
    await expect.poll(() => s.tagCalls.length).toBe(3);
    expect(s.tagCalls[2]).toEqual([{ id: 't3', c: null }]);
    await expect(root(page).locator('.photos-album-ico')).toHaveCount(0);
    await open('t1');
    await menu.getByRole('button', { name: '색 고르기…', exact: true }).click();
    await menu.locator('.fl-choice').getByRole('radio', { name: '기본', exact: true }).click();
    await expect(menu).toBeHidden();
    expect(s.tagCalls.length).toBe(3);
    // 마지막 앨범에 강청(5) → 새로고침해도 순서와 색이 서버 값으로 유지.
    await open('t2');
    await expect(menu.locator('button')).toHaveText(['이름 바꾸기', '색 고르기…', '위로', '지우기(사진은 그대로)']);
    await menu.getByRole('button', { name: '색 고르기…', exact: true }).click();
    await menu.locator('.fl-choice').getByRole('radio', { name: '강청', exact: true }).click();
    await expect.poll(() => s.tagCalls.length).toBe(4);
    expect(s.tagCalls[3]).toEqual([{ id: 't2', c: 5 }]);
    await page.reload();
    await openTab(page, 'albums');
    await expect.poll(albumIds).toEqual(['t1', 't3', 't2']);
    await expect(nameIcon('t2')).toHaveAttribute('data-fc', '5');
    await expect(root(page).locator('.photos-album-ico')).toHaveCount(1);
    expect(s.errors).toEqual([]);
    if (width < 761) await page.screenshot({ path: info.outputPath('photos-album-look-412.png') });
  });

  test(`앨범: 색·순서 칸이 없는(DB 적용 전) 서버는 이름순으로 뜨고 저장만 알림 ${width}`, async ({ page }) => {
    const s = await fixture(page, width, { tags: [{ id: 't1', name: '가족' }, { id: 't2', name: '여행' }], tagsColMissing: true, prefsFail: true });
    await openTab(page, 'albums');
    const albumIds = () => root(page).locator('[data-photos-album]').evaluateAll(els => els.map(e => e.dataset.photosAlbum));
    await expect.poll(albumIds).toEqual(['t1', 't2']);
    await root(page).locator('[data-photos-album="t2"] [data-photos-al-more]').click();
    const menu = page.locator('#photosAlbumMenu');
    await menu.getByRole('button', { name: '색 고르기…', exact: true }).click();
    await menu.locator('.fl-choice').getByRole('radio', { name: '자주', exact: true }).click();
    await expect.poll(() => s.tagCalls.length).toBe(1);
    await expect(page.locator('body')).toContainText('앨범 색을 저장하지 못했어요');
    await expect(root(page).locator('.photos-album-ico')).toHaveCount(0);
  });
});
