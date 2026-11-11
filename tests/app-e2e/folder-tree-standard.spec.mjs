import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { pinch } from './helpers/pinch.mjs';
// FOLDER-나무새기준(S51-12, 요청함 11/06 01:31·명진 01:39 'ㅇㅋ'): 노트·자료실 폴더 나무가 같은 공용 줄·상자(folder-tree-ui.mjs, folder-tree.css ft-).
// 폰(412×915): '최근' 상자 + 폴더 상자, 폴더를 누르면 그 자리에서 하위 폴더·노트까지 펼침(폴더 그림 열린/닫힌 모양, 세모·꺽쇠 없음),
// 노트가 많으면 처음 5개 + 'n개 더 보기', 펼친 폴더 위 두 손가락 벌리기 = 그 폴더만([‹] 위치 줄), 오므리기·[‹]·뒤로 키 = 펼친 자리 그대로 나무.
// 폴드 펼침(884)·PC(1280)는 같은 줄 모양으로 '나무 | 목록'. 점(●)은 어디에도 없다. 이름은 지어낸 것이다.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
async function notesFixture(page, width, height = 915) {
  await page.setViewportSize({ width, height });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const folders = [
    { id: U(1), workspace_id: 'w', parent_id: null, name: '업무 메모', sort_order: 1024, color: 3, created_at: '2026-10-01T00:00:00Z' },
    { id: U(2), workspace_id: 'w', parent_id: null, name: '개발', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' },
    { id: U(3), workspace_id: 'w', parent_id: U(2), name: '웹', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: U(4), workspace_id: 'w', parent_id: null, name: '빈 폴더', sort_order: 3072, created_at: '2026-10-01T00:00:00Z' },
  ];
  const rows = [];
  for (let i = 1; i <= 8; i++) rows.push(row('w' + i, `업무 노트 ${i}`, `2026-10-0${i > 5 ? 1 : 2}T0${i}:00:00Z`, { folder_id: U(1), folder: '업무 메모' }));
  rows.push(row('d1', '개발 노트', '2026-10-03T01:00:00Z', { folder_id: U(2), folder: '개발' }));
  rows.push(row('x1', '웹 노트', '2026-10-04T01:00:00Z', { folder_id: U(3), folder: '웹' }));
  rows.push(row('o1', '폴더 없는 노트', '2026-10-05T01:00:00Z'));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 11');
  return { errors };
}
const folderRow = (page, id) => page.locator(`#noteRows [data-nx-folder="${id}"]`);
const shape = l => l.locator('.ft-ico').first().getAttribute('data-ft-shape');
// 점(●): 종류 점·색 점·글자 '●' 모두 없다.
async function noDots(page, scope) {
  await expect(page.locator(`${scope} .lu-kdot, ${scope} .lu-pdot, ${scope} .lu-kdots`)).toHaveCount(0);
  expect(await page.locator(scope).first().innerText()).not.toContain('●');
}

test('노트 폰 412: 최근 상자 + 폴더 상자, 그 자리 펼치기 · n개 더 보기 · 두 손가락 그 폴더만 · 뒤로 키 = 펼친 자리 그대로', async ({ page }) => {
  const f = await notesFixture(page, 412);
  // ① 상자 두 개: '최근'(5줄, [더보기]) + 폴더 상자.
  await expect(page.locator('[data-nx-recent] .ft-box .ft-box-toggle')).toHaveText('최근');
  await expect(page.locator('[data-nx-recent] [data-note-row]')).toHaveCount(5);
  await page.locator('[data-nx-recent] [data-nx-recent-more]').tap();
  await expect(page.locator('[data-nx-recent] [data-note-row]')).toHaveCount(11);
  await page.locator('[data-nx-recent] [data-nx-recent-more]').tap();
  await expect(page.locator('[data-nx-recent] [data-note-row]')).toHaveCount(5);
  const box = page.locator('#noteRows > .ft-box');
  await expect(box).toHaveCount(1);
  // ② 맨 위 단계는 굵은 이름 + 회색 수 + ⋯. 처음엔 모두 닫힌 그림, 하위 없는 폴더도 닫힌 그림. 꺽쇠·세모 없음.
  const work = folderRow(page, U(1));
  await expect(work).toHaveClass(/ft-top/);
  await expect(work.locator('.ft-num')).toHaveText('8');
  await expect(work.locator('.ft-dots')).toBeVisible();
  expect(await work.locator('.ft-name').evaluate(e => getComputedStyle(e).fontWeight)).toBe('700');
  expect(await shape(work)).toBe('closed');
  expect(await shape(folderRow(page, U(4)))).toBe('closed');
  await expect(work.locator('.ft-ico')).toHaveAttribute('data-fc', '3');
  expect(await box.innerText()).not.toMatch(/[▸▾›]/);
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(0);
  // ③ 누르면 그 자리에서 펼침(화면 바뀌지 않음): 노트 처음 5개 + '3개 더 보기'. 다시 누르면 접힘.
  await work.locator('.ft-main').tap();
  expect(await shape(work)).toBe('open');
  await expect(page.locator('#noteRows [data-nx-focus]')).toBeHidden();
  await expect(page.locator('#noteRows [data-ft-parent="' + U(1) + '"] [data-note-row]')).toHaveCount(5);
  const more = page.locator(`#noteRows [data-nx-more="${U(1)}"]`);
  await expect(more).toContainText('3개 더 보기');
  await more.tap();
  await expect(page.locator('#noteRows [data-ft-parent="' + U(1) + '"] [data-note-row]')).toHaveCount(8);
  // 하위 폴더: 들여쓰기, 선 없이, 보통 굵기.
  await folderRow(page, U(2)).locator('.ft-main').tap();
  const sub = folderRow(page, U(3));
  await expect(sub).toHaveClass(/ft-sub/);
  expect(await sub.evaluate(e => getComputedStyle(e).borderTopWidth)).toBe('0px');
  expect(await sub.locator('.ft-name').evaluate(e => getComputedStyle(e).fontWeight)).toBe('400');
  const [topX, subX] = await Promise.all([folderRow(page, U(2)).locator('.ft-ico').boundingBox(), sub.locator('.ft-ico').boundingBox()]);
  expect(subX.x - topX.x).toBeGreaterThan(15);
  await noDots(page, '[data-note-list]');
  await page.screenshot({ path: 'test-results/ft-notes-phone-tree.png' });
  // ④ 펼친 '업무 메모' 노트 줄 위 두 손가락 벌리기 → 그 폴더만([‹] 노트 › 업무 메모 · 8), 폴더 상자·최근 상자 없음.
  await page.locator('#noteRows [data-nx-note="w2"]').evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const y0 = await page.evaluate(() => window.scrollY);
  expect(y0).toBeGreaterThan(0);
  await pinch(page, page.locator(`#noteRows [data-nx-note="w2"]`), 'out');
  // S51-24: 그 폴더만 = 나무와 같은 상자(위치 줄 + 머리: 열린 폴더 그림 + 이름 + 개수).
  await expect(page.locator('#noteRows [data-nx-focus] .ft-focus-head')).toHaveText('‹업무 메모 노트 8');
  await expect(page.locator('#noteRows [data-nx-focus] .ft-focus-head .ft-ico')).toHaveAttribute('data-ft-shape', 'open');
  await expect(page.locator('#noteRows [data-nx-focus] .ft-focus-back')).toHaveText('‹');
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(8);
  await expect(page.locator('[data-nx-recent]')).toBeHidden();
  await page.screenshot({ path: 'test-results/ft-notes-phone-focus.png' });
  // 오므리기 → 나무로, 펼친 자리 그대로.
  await pinch(page, page.locator('#noteRows'), 'in');
  await expect(page.locator('#noteRows [data-nx-focus]')).toBeHidden();
  expect(await shape(folderRow(page, U(1)))).toBe('open');
  expect(await shape(folderRow(page, U(2)))).toBe('open');
  await expect(folderRow(page, U(3))).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(y0);
  // 다시 벌렸다가 뒤로 키 → 나무.
  await pinch(page, folderRow(page, U(2)), 'out');
  await expect(page.locator('#noteRows [data-nx-focus] .ft-focus-head')).toHaveText('‹개발 폴더 1 · 노트 1');
  await page.goBack();
  await expect(page.locator('#noteRows [data-nx-focus]')).toBeHidden();
  await expect(folderRow(page, U(3))).toBeVisible();
  // [‹]도 같다.
  await pinch(page, folderRow(page, U(2)), 'out');
  await page.locator('#noteRows [data-nx-focus] .ft-focus-back').tap();
  await expect(page.locator('#noteRows [data-nx-focus]')).toBeHidden();
  await expect(folderRow(page, U(3))).toBeVisible();
  expect(f.errors).toEqual([]);
});

for (const [width, height, name] of [[884, 1000, '폴드 펼침'], [1280, 900, 'PC']]) test(`노트 ${name} ${width}: 같은 줄 모양으로 나무 | 목록`, async ({ page }) => {
  const f = await notesFixture(page, width, height);
  const tree = page.locator('[data-nx-tree]');
  await expect(tree).toBeVisible();
  const work = tree.locator(`[data-nx-folder="${U(1)}"]`);
  await expect(work).toHaveClass(/ft-row/);
  await expect(work).toHaveClass(/ft-top/);
  expect(await work.locator('.ft-name').evaluate(e => getComputedStyle(e).fontWeight)).toBe('700');
  await expect(work.locator('.ft-num')).toHaveText('8');
  await work.locator('[data-nx-folder-more]').click(); // UI-폴더누르기한규칙(S57-5): 나무 누르기 = 펼침만, 들어가기 = ⋯ [이 폴더로 들어가기]
  await page.locator('#noteDocMenu [data-nx-enter]').click();
  await expect(page.locator('[data-nx-here]')).toHaveText('업무 메모 · 8');
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(8);
  await noDots(page, '[data-note-list]');
  await page.screenshot({ path: `test-results/ft-notes-${width}.png` });
  expect(f.errors).toEqual([]);
});

// 자료실(기준 화면): 폴더 묶기의 폴더 줄도 같은 공용 폴더 그림(닫힘·열림), 점(●) 없음, 두 손가락 그 폴더만 → 오므리기·[‹]·뒤로 = 펼친 자리 그대로.
test('자료실 폰 412: 폴더 그림 열림/닫힘·점 없음·두 손가락 그 폴더만·[‹]·뒤로 키로 나무', async ({ page }) => {
  const { bootLibrary, libFolder } = await import('./helpers/library-folder-server.mjs');
  const { errors } = await bootLibrary(page, 412, { folders: [libFolder('fa', 'top-a', { name: '가상 A', sort_order: 1024, color: 4 }), libFolder('fc', 'top-a', { name: '가상 C', parent_id: 'fa', sort_order: 0 }), libFolder('fe', null, { name: '가상 빈', sort_order: 2048 })], items: [{ document_id: 'a-1', folder_id: 'fc' }, { document_id: 'n-1', folder_id: 'fa' }] });
  await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
  const head = key => page.locator(`#documentList details[data-lu-node="${key}"] > summary`);
  const visibleShape = key => head(key).locator('.ft-ico:visible').getAttribute('data-ft-shape');
  expect(await visibleShape('f:fa')).toBe('closed');
  await expect(head('f:fa').locator('.ft-ico:visible')).toHaveAttribute('data-fc', '4');
  await expect(head('f:fe').locator('.ft-ico')).toHaveCount(1);
  await head('f:fa').tap();
  expect(await visibleShape('f:fa')).toBe('open');
  await expect(page.locator('#documentList details[data-lu-node="f:fc"]')).toBeVisible();
  await noDots(page, '#documentList');
  await page.screenshot({ path: 'test-results/ft-library-phone-tree.png' });
  const y0 = await page.evaluate(() => window.scrollY);
  await pinch(page, head('f:fa'), 'out');
  const path = page.locator('#libraryPath');
  await expect(path).toBeVisible();
  // S51-24: 폰 '그 폴더만' = 목록 상자 맨 위 위치 줄(위 단계만) + 바로 아래 그 폴더 줄(열린 폴더 그림·굵은 이름)이 머리.
  await expect(path).toHaveText('‹자료실›');
  await expect(path).toHaveClass(/ft-focus-anc/);
  expect(await visibleShape('f:fa')).toBe('open');
  await expect(path.locator('[data-lu-path-back]')).toHaveText('‹');
  await pinch(page, page.locator('#documentList'), 'in');
  await expect(path).toBeHidden();
  expect(await visibleShape('f:fa')).toBe('open');
  await pinch(page, head('f:fa'), 'out');
  await expect(path).toBeVisible();
  await page.goBack();
  await expect(path).toBeHidden();
  await expect(page.locator('#documentList details[data-lu-node="f:fc"]')).toBeVisible();
  await pinch(page, head('f:fa'), 'out');
  await path.locator('[data-lu-path-back]').tap();
  await expect(path).toBeHidden();
  expect(typeof y0).toBe('number');
  expect(errors).toEqual([]);
});

// [파일](② S51-12): 폰 나무 = '최근' 상자 + 별표·큰 파일 상자 + 저장소마다 상자(머리를 누르면 접기). 폴더는 그 자리에서 하위 폴더·파일까지,
// 파일이 많으면 5개 + 'n개 더 보기'. 두 손가락 = 그 폴더만(폴더 목록 화면), [‹]·뒤로 키·오므리기 = 펼친 자리 그대로 나무.
test('파일 폰 412: 저장소 상자·그 자리 펼치기(파일까지)·n개 더 보기·두 손가락 그 폴더만·뒤로 키로 나무', async ({ page }) => {
  const { start, openFiles } = await import('./helpers/files-server.mjs');
  const { errors, server } = await start(page, 412);
  for (let i = 1; i <= 7; i++) server.items.push({ source: 'od', item_id: 'OD!3' + i, parent_id: 'OD!2', name: `가짜 사진 ${i}.jpg`, is_folder: false, mime: 'image/jpeg', size_bytes: 1000, modified_at: `2026-09-0${i}T01:00:00Z`, hash: null, trashed: false, starred: false, library_doc_id: null });
  await openFiles(page, 412);
  const tree = page.locator('#filesRoot [data-fx-tree]');
  await expect(tree.locator('[data-fx-box="recent"] .ft-box-toggle')).toHaveText('최근');
  await expect(tree.locator('[data-fx-box="recent"] [data-fx-tfile]')).toHaveCount(5);
  const od = tree.locator('[data-fx-box="od"]');
  await expect(od.locator('.ft-box-toggle')).toContainText('원드라이브');
  const box = od.locator('[data-fx-fold="od:OD!2"]');
  await expect(box).toHaveClass(/ft-top/);
  expect(await box.locator('.ft-ico').getAttribute('data-ft-shape')).toBe('closed');
  await box.locator('.ft-main').tap();
  expect(await box.locator('.ft-ico').getAttribute('data-ft-shape')).toBe('open');
  await expect(od.locator('[data-ft-parent="od:OD!2"] [data-fx-tfile]')).toHaveCount(5);
  await expect(od.locator('[data-fx-tmore="od:OD!2"]')).toContainText('3개 더 보기');
  await od.locator('[data-fx-tmore="od:OD!2"]').tap();
  await expect(od.locator('[data-ft-parent="od:OD!2"] [data-fx-tfile]')).toHaveCount(8);
  await noDots(page, '#filesRoot [data-fx-tree]');
  await page.screenshot({ path: 'test-results/ft-files-phone-tree.png' });
  // 상자 머리를 누르면 그 저장소 접기.
  const gd = tree.locator('[data-fx-box="gd"]');
  await gd.locator('.ft-box-toggle').tap();
  await expect(gd.locator('.ft-box-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(gd.locator('[data-fx-fold]')).toHaveCount(0);
  // 두 손가락 벌리기 → 그 폴더만(목록), 오므리기 → 나무(펼친 자리 그대로).
  await pinch(page, od.locator('[data-ft-parent="od:OD!2"]').first(), 'out');
  await expect(page.locator('#filesRoot [data-fx-list] [data-fx-row]').first()).toBeVisible();
  await expect(tree).toBeHidden();
  await pinch(page, page.locator('#filesRoot [data-fx-list]'), 'in');
  await expect(tree).toBeVisible();
  expect(await tree.locator('[data-fx-fold="od:OD!2"] .ft-ico').getAttribute('data-ft-shape')).toBe('open');
  // 뒤로 키도 같다(한 단계 위가 아니라 나무로).
  await pinch(page, tree.locator('[data-fx-fold="od:OD!1"]'), 'out');
  await expect(tree).toBeHidden();
  await page.goBack();
  await expect(tree).toBeVisible();
  expect(errors).toEqual([]);
});
