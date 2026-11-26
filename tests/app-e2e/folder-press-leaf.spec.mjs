import { test, expect } from '@playwright/test';
import { start, openFiles, phoneFolder } from './helpers/files-server.mjs';
import { bootLibrary, libFolder } from './helpers/library-folder-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import { pinch } from './helpers/pinch.mjs';
import { treeEnter } from './helpers/tree-enter.mjs';
// OPS-빠진일2차 1(S59-17, 명진 11/11 14:55 '가'): 폴더 누르기 한 규칙 — 자료실·[파일]·노트·사진의 모든 나무·목록(폰·폴드·PC).
//  ① [파일] PC·폴드 오른쪽 목록 칸도 왼쪽 나무처럼 폴더 누르기 = 그 자리 펼치기·접기(들어가기는 우클릭 [이 폴더로 들어가기]·펼친 폴더 위 두 손가락 벌리기).
//  ② (UI-폴더이름펼치기, 명진 11/24 18:09로 바뀜) 그 자리 펼치는 목록(두 칸 칸 안·폰 나무)의 폴더 이름 누르기 = 늘 펼치기·접기 — 빈 폴더도 펼쳐 안에 '빈 폴더' 한 줄,
//     주소·위치 그대로. 들어가기는 ⋯ 첫 줄 [이 폴더로 들어가기](PC 우클릭도 같은 메뉴)·두 손가락 벌리기만. 전의 '하위 없는 폴더 = 한 번에 열기'는 없앴다.
// S69-38 UI-탐색기나무누르기(명진 11/24 '상위폴더를 눌러도 오른쪽에 내용이 보이게 / 모든곳 공통'): 탐색기(왼쪽 나무 | 오른쪽 그 폴더) 나무 이름 누르기 = 그 폴더 열기 + 펼침,
//  S69-68(명진 11/24 20:09): 한 칸 오른쪽·폰 '그 폴더만'의 하위 폴더 누르기도 그 자리 펼치기·접기(들어가기는 왼쪽 나무·⋯·우클릭 메뉴).
// 화면 사진(S59_17_SHOTS=폴더): PC 1280·폰 412·폴드 884. 이름은 모두 지어낸 것이다.
const shot = async (page, name) => { if (process.env.S59_17_SHOTS) await page.screenshot({ path: `${process.env.S59_17_SHOTS}/${name}.png` }); };
const files = page => page.locator('#filesRoot');
// 가짜 빈 폴더(가짜 문서함 안): 펼쳐 보일 것이 없는 폴더.
const EMPTY = () => ({ source: 'od', item_id: 'OD!19', parent_id: 'OD!1', name: '가짜 빈 폴더', is_folder: true, mime: null, size_bytes: null, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null });

// ---------- [파일] ----------
// S69-38: 그 자리 펼치기는 두 칸 칸 안 목록에만 남는다 — 두 칸 왼쪽 칸에서 본다(한 칸 탐색기는 explorer-tree-press.spec.mjs).
async function twoPanes(page, width) {
  await openFiles(page, width, { two: true });
  const two = files(page).locator('[data-fx-two]');
  if ((await two.getAttribute('aria-pressed')) !== 'true') await two.click();
  await expect(files(page).locator('[data-fx-pane-i="1"]')).toHaveCount(1);
  const pane = files(page).locator('[data-fx-pane-i="0"]');
  return { list: pane.locator('[data-fx-list]'), crumb: pane.locator('.fx-ptop') }; // 칸 위 줄(위치 길): 맨 위는 저장소 이름만
}
for (const width of [884, 1280]) test(`[파일] ${width} 두 칸: 칸 안 목록 폴더 누르기 = 그 자리 펼치기·접기(빈 폴더도), 들어가기는 우클릭 메뉴 · 한 칸 오른쪽도 펼치기(S69-68)`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, width);
  server.items.push(EMPTY());
  const { list, crumb } = await twoPanes(page, width);
  const docs = list.locator('[data-fx-row="od:OD!1"]'), sub = list.locator('[data-fx-row="od:OD!10"]'), inFile = list.locator('[data-fx-row="od:OD!11"]'), empty = list.locator('[data-fx-row="od:OD!19"]');
  await expect(docs).toBeVisible();
  const crumb0 = (await crumb.textContent()).trim();
  // ① 하위 폴더가 있는 폴더: 누르면 그 자리에서 하위 폴더·파일이 들여 보이고(위치 줄 그대로), 다시 누르면 접힌다.
  await expect(docs).toHaveAttribute('aria-expanded', 'false');
  await docs.click();
  await expect(docs).toHaveAttribute('aria-expanded', 'true');
  await expect(sub).toBeVisible();
  await expect(inFile).toBeVisible();
  await expect(sub).toHaveClass(/fx-xin/);
  await expect(crumb).toHaveText(crumb0);
  const [a, b] = [await docs.boundingBox(), await sub.locator('.fx-ico').boundingBox()];
  expect(b.x).toBeGreaterThan(a.x + 8); // 안 줄은 들여 보인다
  await shot(page, `files-${width}-1-expand`);
  await docs.click();
  await expect(sub).toHaveCount(0);
  await expect(docs).toHaveAttribute('aria-expanded', 'false');
  await expect(docs).toBeFocused();
  // 키보드: → 펼치기, ← 접기, Enter = 누르기와 같음
  await docs.focus(); await page.keyboard.press('ArrowRight');
  await expect(sub).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(sub).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(sub).toBeVisible();
  // 하위 폴더 없이 파일만 든 폴더(가짜 2026)는 그 자리 펼침에 파일이 들여 보인다(한 단 더).
  await sub.click();
  await expect(sub).toHaveAttribute('aria-expanded', 'true');
  await expect(list.locator('[data-fx-row="od:OD!14"]')).toBeVisible();
  await expect(crumb).toHaveText(crumb0);
  // ② 펼친 폴더 안의 빈 폴더 누르기 = 그 자리 펼침(안에 '빈 폴더' 한 줄, 위치 줄 그대로), 다시 누르면 접힘. 들어가기는 우클릭 [이 폴더로 들어가기].
  await empty.click();
  await expect(empty).toHaveAttribute('aria-expanded', 'true');
  await expect(list.locator('.fx-xnote', { hasText: '이 폴더는 비어 있어요' })).toBeVisible();
  await expect(crumb).toHaveText(crumb0);
  await shot(page, `files-${width}-2-empty-expand`);
  await empty.click();
  await expect(empty).toHaveAttribute('aria-expanded', 'false');
  await expect(list.locator('.fx-xnote', { hasText: '이 폴더는 비어 있어요' })).toHaveCount(0);
  await empty.click({ button: 'right' });
  await page.locator('#rowMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
  await expect(crumb).toContainText('가짜 빈 폴더');
  // 한 칸으로 돌아와도 탐색기 오른쪽 하위 폴더 누르기 = 그 자리 펼치기·접기(S69-68, 위치 줄 그대로). 들어가기는 왼쪽 나무.
  await files(page).locator('[data-fx-one]').click();
  await expect(files(page).locator('[data-fx-pane-i="1"]')).toHaveCount(0);
  const one = files(page).locator('[data-fx-pane-i="0"] [data-fx-list]'), crumb1 = files(page).locator('[data-fx-crumb] .fx-crumb-now');
  await treeEnter(files(page).locator('[data-fx-tree] [data-fx-fold="od:OD!1"] .ft-main'));
  await expect(crumb1).toHaveText('가짜 문서함');
  await one.locator('[data-fx-row="od:OD!10"]').click();
  await expect(one.locator('[data-fx-row="od:OD!10"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(one.locator('[data-fx-row="od:OD!14"]')).toBeVisible();
  await expect(crumb1).toHaveText('가짜 문서함');
  expect(errors).toEqual([]);
});

test('[파일] 폴드 884 두 칸: 펼친 폴더 위 두 손가락 벌리기 = 들어가지 않고 줄 크기 한 단계(S69-99)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, 884);
  const { list, crumb } = await twoPanes(page, 884);
  const docs = list.locator('[data-fx-row="od:OD!1"]');
  await docs.click();
  await expect(list.locator('[data-fx-row="od:OD!11"]')).toBeVisible();
  const before = await crumb.textContent();
  await pinch(page, list.locator('[data-fx-row="od:OD!11"]'), 'out');
  // UI-폴더줄크기(명진 11/25 08:23 "폴더 안으로 들어가기가 아니라"): 들어가기는 ⋯·우클릭 첫 줄만.
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.rowSize)).toBe('l');
  await expect(crumb).toHaveText(before);
  await expect(list.locator('[data-fx-row="od:OD!1"]')).toHaveAttribute('aria-expanded', 'true');
  expect(errors).toEqual([]);
});

test('[파일] 폰 412: 나무 폴더 누르기 = 늘 그 자리 펼치기(빈 폴더도 빈 폴더 한 줄) · 그 폴더만은 ⋯ [이 폴더로 들어가기]', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  server.items.push(EMPTY());
  await openFiles(page, 412);
  const tree = files(page).locator('[data-fx-tree]');
  await tree.locator('[data-fx-tog="od:OD!1"]').click();
  await expect(tree.locator('[data-fx-fold="od:OD!10"]')).toBeVisible(); // 그 자리 펼침(화면 그대로)
  await expect(files(page)).toHaveAttribute('data-fx-pane', 'tree');
  await tree.locator('[data-fx-tog="od:OD!10"]').click(); // 파일만 든 폴더 = 그 자리 펼침(파일까지)
  await expect(tree.locator('[data-ft-parent="od:OD!10"] [data-fx-tfile]')).toHaveCount(1);
  await shot(page, 'files-412-1-expand');
  const url0 = page.url();
  await tree.locator('[data-fx-tog="od:OD!19"]').click(); // 빈 폴더 → 그 자리 펼침(안에 '빈 폴더' 한 줄, 화면·주소 그대로)
  await expect(tree.locator('[data-fx-tog="od:OD!19"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.locator('.ft-empty-row[data-ft-parent="od:OD!19"]')).toContainText('이 폴더는 비어 있어요');
  await expect(files(page)).toHaveAttribute('data-fx-pane', 'tree');
  expect(page.url()).toBe(url0);
  await shot(page, 'files-412-2-empty-expand');
  await tree.locator('[data-fx-tog="od:OD!19"]').click(); // 다시 누르면 접힘
  await expect(tree.locator('.ft-empty-row[data-ft-parent="od:OD!19"]')).toHaveCount(0);
  await tree.locator('[data-fx-fold="od:OD!19"] [data-fx-tmenu]').click(); // 들어가기는 ⋯ 첫 줄
  await expect(page.locator('#rowMenu button').first()).toHaveText('이 폴더로 들어가기');
  await page.locator('#rowMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
  await expect(tree).toBeHidden();
  await expect(files(page).locator('[data-fx-list]')).toContainText('이 폴더는 비어 있어요');
  await page.goBack();
  await expect(tree).toBeVisible();
  // S69-68: '그 폴더만'(폰의 내용 칸) 안 하위 폴더 누르기도 그 자리 펼치기·접기(빈 폴더도 '빈 폴더' 한 줄). 한 단계 들어가기는 ⋯ 첫 줄, 뒤로가기 = 한 단계 위.
  await phoneFolder(page, 'od', 'OD!1');
  const focus = files(page).locator('[data-fx-list]');
  await focus.locator('[data-fx-row="od:OD!10"]').click();
  await expect(focus.locator('[data-fx-row="od:OD!10"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(files(page).locator('.ft-focus-name')).toHaveText('가짜 문서함');
  await expect(focus.locator('[data-fx-row="od:OD!14"]')).toBeVisible();
  await focus.locator('[data-fx-row="od:OD!19"]').click(); // 빈 폴더 = 그 자리 펼침
  await expect(focus.locator('[data-fx-row="od:OD!19"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(focus.locator('.fx-xnote[data-fx-xof="od:OD!19"]')).toContainText('이 폴더는 비어 있어요');
  await focus.locator('[data-fx-tmenu="od:OD!10"]').click();
  await page.locator('#rowMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
  await expect(files(page).locator('.ft-focus-name')).toHaveText('가짜 2026');
  await page.goBack();
  await expect(files(page).locator('.ft-focus-name')).toHaveText('가짜 문서함');
  expect(errors).toEqual([]);
});

// ---------- 자료실 ----------
const FOLDERS = [libFolder('fa', 'top-a', { name: '가상 A', sort_order: 1024 }), libFolder('fc', 'child-a1', { name: '가상 C', parent_id: 'fa', sort_order: 0 }), libFolder('fn', null, { name: '가상 N', sort_order: 2048 })];
const ITEMS = [{ document_id: 'a-1', folder_id: 'fc' }, { document_id: 'n-1', folder_id: 'fa' }];
const nav = page => page.locator('#libraryFolderNav');
const tops = page => page.locator('#documentList > details').evaluateAll(xs => xs.map(x => x.dataset.luNode));
const pickGroup = (page, label) => page.locator('#libraryGroupBy').selectOption({ label });

// S69-28 LIB-한칸탐색기(명진 11/24 '윈도우 탐색기처럼'): 한 칸 PC는 나무 이름 누르기 = 그 폴더 열기(하위가 있든 없든). 펼치기·접기는 나무의 폴더 그림.
// S69-68(명진 11/24 20:09): 오른쪽 폴더 줄 누르기 = 그 자리 펼치기·접기(들어가지 않음).
test('자료실 PC 1280: 나무 이름 누르기 = 그 폴더 열기, 오른쪽 폴더 줄 = 그 자리 펼치기, 나무 그림 = 그 자리 펼치기', async ({ page }) => {
  test.setTimeout(90000);
  const { s, errors } = await bootLibrary(page, 1280, { folders: FOLDERS, items: ITEMS });
  await pickGroup(page, '폴더');
  await nav(page).locator('[data-lu-nav-tog="fa"]').click();
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toBeVisible();
  await expect.poll(() => tops(page)).toEqual(['f:fa', 'f:fn']);
  await treeEnter(nav(page).locator('[data-lu-nav="fc"]'));
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => tops(page)).toEqual([]);
  await shot(page, 'library-1280-1-tree-leaf');
  await nav(page).locator('[data-lu-nav=""]').click();
  await expect.poll(() => tops(page)).toEqual(['f:fa', 'f:fn']);
  const head = id => page.locator(`#documentList details[data-lu-node="f:${id}"] > summary`);
  await head('fa').click(); // 오른쪽 폴더 줄 = 그 자리 펼치기(들어가지 않음, 왼쪽 나무 그대로)
  await expect(page.locator('#documentList details[data-lu-node="f:fa"]')).toHaveAttribute('open', '');
  await expect(page.locator('#documentList details[data-lu-node="f:fc"]')).toBeVisible();
  await expect(nav(page).locator('[data-lu-nav=""]')).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => tops(page)).toEqual(['f:fa', 'f:fn']);
  await head('fa').click();
  await expect(page.locator('#documentList details[data-lu-node="f:fa"]')).not.toHaveAttribute('open', '');
  await head('fn').click(); // 빈 폴더도 그 자리 펼침('빈 폴더' 한 줄)
  await expect(page.locator('#documentList details[data-lu-node="f:fn"] .lu-node-empty')).toContainText('이 폴더는 비어 있어요');
  await expect(nav(page).locator('[data-lu-nav=""]')).toHaveAttribute('aria-current', 'true');
  expect(s.writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('자료실 두 칸 884: 칸 안 폴더 누르기 = 늘 그 자리 펼침(빈 폴더도 빈 폴더 한 줄) · 들어가기는 메뉴 첫 줄', async ({ page }) => {
  test.setTimeout(90000);
  const { s, errors } = await bootLibrary(page, 884, { folders: FOLDERS, items: ITEMS });
  await pickGroup(page, '폴더');
  const btn = page.locator('#libraryTwoBtn');
  await expect(btn).toBeVisible();
  await btn.click(); await expect(btn).toHaveAttribute('aria-pressed', 'true');
  const right = page.locator('[data-lu-pane-i="1"]');
  await expect(right.locator('[data-lu-nav="fa"]')).toBeVisible();
  await right.locator('[data-lu-nav="fa"]').click(); // 하위 있음 = 그 칸 안 펼치기
  await expect(right.locator('[data-lu-nav="fc"]')).toBeVisible();
  await expect(right.locator('.lu-pane-here')).toHaveText('자료실');
  await shot(page, 'library-884-two-1-expand');
  await right.locator('[data-lu-nav="fc"]').click(); // 자료만 든 폴더 = 그 칸 안 펼침(펼친 폴더 안 놓기 그대로)
  await expect(right.locator('[data-lu-pane-sub="fc"]')).toBeVisible();
  await expect(right.locator('.lu-pane-here')).toHaveText('자료실');
  await right.locator('[data-lu-nav="fn"]').click(); // 빈 폴더 = 그 칸 안 펼침(안에 '빈 폴더' 한 줄)
  await expect(right.locator('[data-lu-nav="fn"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(right.locator('.lu-pane-empty[data-lu-pane-sub="fn"]')).toContainText('이 폴더는 비어 있어요');
  await expect(right.locator('.lu-pane-here')).toHaveText('자료실');
  await shot(page, 'library-884-two-2-empty-expand');
  await right.locator('[data-lu-nav="fn"]').click(); // 다시 누르면 접힘
  await expect(right.locator('.lu-pane-empty[data-lu-pane-sub="fn"]')).toHaveCount(0);
  await right.locator('[data-lu-nav="fn"]').click({ button: 'right' }); // 들어가기 = 메뉴 첫 줄
  await expect(page.locator('#luFolderMenu button').first()).toHaveText('이 폴더로 들어가기');
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(right.locator('.lu-pane-here')).toHaveText('가상 N');
  expect(s.writes).toEqual([]);
  expect(errors).toEqual([]);
});

// UI-폴더이름펼치기(명진 11/24 18:09 '폴더 명칭을 누르면 펼쳐졌으면 / 들어가는 거는 ⋯ 이 폴더 안으로 들어가기를 눌렀을 때만'):
//  폰 나무 폴더 이름 누르기 = 그 자리 펼치기·접기(하위 없는 폴더는 안 자료 줄, 빈 폴더는 '빈 폴더' 한 줄), 주소·위치 그대로. 들어가기는 ⋯ 첫 줄만.
for (const width of [390, 412]) test(`자료실 폰 ${width}: 폴더 이름 누르기 = 그 자리 펼치기·접기(주소 그대로) · 들어가기는 ⋯ [이 폴더로 들어가기]만`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors, s } = await bootLibrary(page, width, { folders: FOLDERS, items: ITEMS });
  await pickGroup(page, '폴더');
  await expect.poll(() => tops(page)).toEqual(['x:out', 'f:fa', 'f:fn']);
  const node = id => page.locator(`#documentList details[data-lu-node="f:${id}"]`);
  // 폴더 이름 자리를 누른다(줄 앞 폴더 그림이 아니라 — 전에는 이름 = 들어가기, 그림 = 펼치기였다).
  const name = id => ({ click: async () => { const head = node(id).locator(':scope > summary'), nm = head.locator('.lu-node-name'); const [h, n] = [await head.boundingBox(), await nm.boundingBox()]; await head.click({ position: { x: n.x - h.x + Math.min(20, n.width / 2), y: h.height / 2 } }); } });
  const url0 = page.url();
  // 하위 폴더 + 자료가 든 폴더: 이름을 누르면 그 자리에 하위 폴더·자료 줄(들어가지 않음)
  await name('fa').click();
  await expect(node('fa')).toHaveAttribute('open', '');
  await expect(node('fc')).toBeVisible();
  await expect(node('fa').locator('[data-lu-document="n-1"]').first()).toBeVisible();
  // 하위 폴더 없이 자료만 든 폴더(회의처럼): 누르면 그 자리에 자료 줄이 펼쳐지고, 다시 누르면 접힌다
  await name('fc').click();
  await expect(node('fc')).toHaveAttribute('open', '');
  await expect(node('fc').locator('[data-lu-document="a-1"]').first()).toBeVisible();
  await expect(page.locator('#libraryPath .lu-focus-here')).toHaveCount(0);
  expect(page.url()).toBe(url0);
  await expect.poll(() => tops(page)).toEqual(['x:out', 'f:fa', 'f:fn']);
  await shot(page, `library-${width}-1-leaf-expand`);
  await name('fc').click();
  await expect(node('fc')).not.toHaveAttribute('open', '');
  await expect(node('fc').locator('[data-lu-document="a-1"]').first()).toBeHidden();
  // 빈 폴더: 펼치면 '빈 폴더' 한 줄(들어가지 않음)
  await name('fn').click();
  await expect(node('fn')).toHaveAttribute('open', '');
  await expect(node('fn').locator('.lu-node-empty')).toContainText('이 폴더는 비어 있어요');
  expect(page.url()).toBe(url0);
  await name('fn').click();
  await expect(node('fn')).not.toHaveAttribute('open', '');
  // 들어가기 = ⋯ 첫 줄 [이 폴더로 들어가기]
  await node('fc').locator(':scope > summary [data-lu-node-menu]').click();
  await expect(page.locator('#luFolderMenu button').first()).toHaveText('이 폴더로 들어가기');
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(page.locator('#libraryPath .lu-focus-here')).toHaveText('가상 C');
  await shot(page, `library-${width}-2-menu-enter`);
  expect(s.writes).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------- 노트 ----------
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const note = (id, title, t, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: t, created_at: t, updated_at: t, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
async function notes(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await installViewPrefsServer(page);
  const folders = [
    { id: U(1), workspace_id: 'w', parent_id: null, name: '가상 메모', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: U(2), workspace_id: 'w', parent_id: null, name: '가상 개발', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' },
    { id: U(3), workspace_id: 'w', parent_id: U(1), name: '가상 회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: U(4), workspace_id: 'w', parent_id: null, name: '가상 빈 폴더', sort_order: 3072, created_at: '2026-10-01T00:00:00Z' },
  ];
  const rows = [note('a1', '가상 노트 1', '2026-10-02T01:00:00Z', { folder_id: U(1), folder: '가상 메모' }), note('b1', '가상 개발 노트', '2026-10-04T01:00:00Z', { folder_id: U(2), folder: '가상 개발' }), note('c1', '가상 회의 노트', '2026-10-05T01:00:00Z', { folder_id: U(3), folder: '가상 회의' })];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  return { errors };
}
for (const width of [884, 1280]) test(`노트 ${width}: 나무 폴더 누르기 = 그 폴더(하위 폴더 줄 + 노트) + 펼침, 아이콘 = 펼치기·접기만`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await notes(page, width);
  const tree = page.locator('[data-nx-tree]'), right = page.locator('#noteRows');
  // S69-38: 하위 폴더가 있는 폴더도 누르면 오른쪽이 그 폴더(하위 폴더 줄 → 노트), 나무에서 펼침.
  await treeEnter(tree.locator(`[data-nx-folder="${U(1)}"] .ft-main`));
  await expect(tree.locator(`[data-nx-folder="${U(3)}"]`)).toBeVisible();
  await expect(tree.locator(`[data-nx-folder="${U(1)}"]`)).toHaveClass(/ft-current/);
  await expect(page.locator('[data-nx-here]')).toHaveText('가상 메모 · 2');
  await expect(right.locator(`[data-nx-folder="${U(3)}"]`)).toBeVisible();
  await expect(right.locator('[data-note-row="a1"]')).toBeVisible();
  // 노트만 든 폴더도 같다(그 폴더 + 나무에서 그 노트 줄까지 펼침).
  await treeEnter(tree.locator(`[data-nx-folder="${U(2)}"] .ft-main`));
  await expect(tree.locator('[data-nx-note="b1"]')).toBeVisible();
  await expect(page.locator('[data-nx-here]')).toHaveText('가상 개발 · 1');
  await shot(page, `notes-${width}-leaf-open`);
  // 아이콘은 펼치기·접기만(오른쪽 그대로).
  await tree.locator(`[data-nx-tog="${U(2)}"]`).click();
  await expect(tree.locator('[data-nx-note="b1"]')).toHaveCount(0);
  await expect(page.locator('[data-nx-here]')).toHaveText('가상 개발 · 1');
  // 빈 폴더도 한 번 누르면 그 폴더.
  await treeEnter(tree.locator(`[data-nx-folder="${U(4)}"] .ft-main`));
  await expect(page.locator('[data-nx-here]')).toHaveText('가상 빈 폴더 · 0');
  expect(errors).toEqual([]);
});
test('노트 폰 412: 폴더 누르기 = 늘 그 자리 펼치기(빈 폴더도 빈 폴더 한 줄) · 그 폴더만은 ⋯ 첫 줄', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await notes(page, 412);
  const rows = page.locator('#noteRows');
  await rows.locator(`[data-nx-folder="${U(1)}"] .ft-main`).click();
  await expect(rows.locator(`[data-nx-folder="${U(3)}"]`)).toBeVisible();
  await expect(rows.locator('.ft-focus')).toHaveCount(0);
  await rows.locator(`[data-nx-folder="${U(2)}"] .ft-main`).click(); // 노트만 든 폴더 = 그 자리 펼침(노트까지)
  await expect(rows.locator(`[data-ft-parent="${U(2)}"] [data-note-row]`)).toHaveCount(1);
  await expect(rows.locator('.ft-focus')).toHaveCount(0);
  await rows.locator(`[data-nx-folder="${U(4)}"] .ft-main`).click(); // 빈 폴더 = 그 자리 펼침(안에 '빈 폴더' 한 줄)
  await expect(rows.locator(`.ft-empty-row[data-ft-parent="${U(4)}"]`)).toContainText('이 폴더는 비어 있어요');
  await expect(rows.locator('.ft-focus')).toHaveCount(0);
  await shot(page, 'notes-412-empty-expand');
  await rows.locator(`[data-nx-folder="${U(4)}"] .ft-main`).click(); // 다시 누르면 접힘
  await expect(rows.locator(`.ft-empty-row[data-ft-parent="${U(4)}"]`)).toHaveCount(0);
  await rows.locator(`[data-nx-folder-more="${U(4)}"]`).click(); // 들어가기 = ⋯ 첫 줄
  await expect(page.locator('#noteDocMenu button').first()).toHaveText('이 폴더로 들어가기');
  await page.locator('#noteDocMenu [data-nx-enter]').click();
  await expect(rows.locator('.ft-focus')).toBeVisible();
  await page.goBack();
  await expect(rows.locator('.ft-focus')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ---------- 사진 ----------
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const media = (id, parent, day) => ({ id, parent, name: id + '.jpg', day, taken_at: `${day}T03:00:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null });
async function photos(page, width) {
  const state = { errors: [], folders: [{ id: 'S1', name: '가상 2026', parent_id: 'T' }, { id: 'S2', name: '가상 여행', parent_id: 'T' }, { id: 'S21', name: '가상 제주', parent_id: 'S2' }, { id: 'S3', name: '가상 빈 폴더', parent_id: 'T' }],
    media: [media('A1', 'T', '2026-10-05'), media('B1', 'S1', '2026-10-03'), media('B2', 'S1', '2026-10-02'), media('C1', 'S21', '2026-09-20')] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && ['/rest/v1/app_diary_stars', '/rest/v1/app_photo_tags', '/rest/v1/app_photo_tag_items'].includes(u.pathname), r => r.fulfill({ json: [] }));
  const total = id => state.media.filter(m => m.parent === id).length + state.folders.filter(f => f.parent_id === id).reduce((n, f) => n + total(f.id), 0);
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '가상 카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': 3, '2026-09': 1 }, total: 4 } });
    if (body.action === 'library') {
      const list = state.media.filter(m => (body.folder_id ? m.parent === body.folder_id : true)).sort((a, b) => b.taken_at.localeCompare(a.taken_at));
      return r.fulfill({ json: { items: list.slice(0, body.limit).map(({ parent, ...m }) => m), next_cursor: null, indexing: false } });
    }
    if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '가상 카메라', count: 1, total: total('T') }, folders: state.folders.map(f => ({ ...f, enabled: true, count: state.media.filter(m => m.parent === f.id).length, total: total(f.id) })), indexing: false } });
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  await clickView(page, 'photos');
  await expect(page.locator('#photosView')).toBeVisible();
  await page.locator('#photosRoot [data-photos-view]').selectOption('folders');
  return state;
}
const ph = page => page.locator('#photosRoot');
const photoIds = page => ph(page).locator('[data-photos-open]').evaluateAll(list => list.map(b => b.dataset.photosId));
test('사진 PC 1280: 나무 폴더 누르기 = 그 폴더(오른쪽 하위 폴더 줄 + 사진) + 펼침, 오른쪽 하위 = 들어가기', async ({ page }) => {
  test.setTimeout(90000);
  const f = await photos(page, 1280);
  const tree = ph(page).locator('[data-photos-fx-tree]'), pane = ph(page).locator('.photos-fx-pane');
  await expect(tree.locator('.ft-name')).toHaveText(['가상 카메라', '가상 2026', '가상 빈 폴더', '가상 여행']);
  // S69-38: 하위 폴더가 있는 폴더도 오른쪽이 그 폴더 + 나무에서 펼침.
  await treeEnter(tree.locator('[data-photos-fx-open="S2"]'));
  await expect(tree.locator('.ft-name')).toHaveText(['가상 카메라', '가상 2026', '가상 빈 폴더', '가상 여행', '가상 제주']);
  await expect(tree.locator('[data-photos-folder="S2"]')).toHaveClass(/ft-current/);
  await expect(pane.locator('[data-photos-fx-open="S21"]')).toBeVisible();
  await pane.locator('[data-photos-fx-open="S21"]').click();
  await expect(tree.locator('[data-photos-folder="S21"]')).toHaveClass(/ft-current/);
  await expect.poll(() => photoIds(page)).toEqual(['C1']);
  await treeEnter(tree.locator('[data-photos-fx-open="S1"]'));
  await expect(tree.locator('[data-photos-folder="S1"]')).toHaveClass(/ft-current/);
  await expect.poll(() => photoIds(page)).toEqual(['B1', 'B2']);
  await shot(page, 'photos-1280-leaf-open');
  expect(f.errors).toEqual([]);
});
for (const width of [412, 884]) test(`사진 ${width}: 폴더 누르기 = 늘 그 자리 펼치기(빈 폴더도 빈 폴더 한 줄) · 그 폴더만은 ⋯ 첫 줄`, async ({ page }) => {
  test.setTimeout(90000);
  const f = await photos(page, width);
  const box = ph(page).locator('[data-photos-box="onedrive"]');
  await expect(box.locator('.ft-folder .ft-name')).toHaveText(['가상 2026', '가상 빈 폴더', '가상 여행']);
  await box.locator('[data-photos-ftog="o:S2"]').click();
  await expect(box.locator('.ft-folder .ft-name')).toHaveText(['가상 2026', '가상 빈 폴더', '가상 여행', '가상 제주']);
  await expect(ph(page).locator('.photos-fx-path')).toHaveCount(0);
  await box.locator('[data-photos-ftog="o:S1"]').click(); // 사진만 든 폴더 = 그 자리 펼침(사진 한 줄)
  await expect(ph(page).locator('[data-photos-strip="o:S1"]')).toBeVisible();
  await expect(ph(page).locator('.photos-fx-path')).toHaveCount(0);
  await box.locator('[data-photos-ftog="o:S3"]').click(); // 빈 폴더 = 그 자리 펼침(안에 '빈 폴더' 한 줄)
  await expect(box.locator('.ft-empty-row[data-ft-parent="o:S3"]')).toContainText('이 폴더는 비어 있어요');
  await expect(ph(page).locator('.photos-fx-path')).toHaveCount(0);
  await shot(page, `photos-${width}-empty-expand`);
  await box.locator('[data-photos-ftog="o:S3"]').click(); // 다시 누르면 접힘
  await expect(box.locator('.ft-empty-row[data-ft-parent="o:S3"]')).toHaveCount(0);
  await box.locator('[data-photos-fx-more="S3"]').click(); // 그 폴더만 = ⋯ 첫 줄
  await expect(page.locator('#photosFolderMenu button').first()).toHaveText('이 폴더로 들어가기');
  await page.locator('#photosFolderMenu [data-fm-enter]').click();
  await expect(ph(page).locator('.photos-fx-path')).toBeVisible();
  await page.goBack();
  await expect(ph(page).locator('.photos-fx-path')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
