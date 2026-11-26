import { test, expect } from '@playwright/test';
import { start, openFiles, treeGo } from './helpers/files-server.mjs';
import { bootLibrary, libFolder, libDoc } from './helpers/library-folder-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
// TREE-펼치기먼저(S70-81, 명진 11/26 09:20): "어떤 폴더 안을 보다가 다른 폴더를 한번 누르면 폴더 트리만 펼쳐지고, 다시 한번 눌러야
// 비로소 그 폴더 안의 내용이 보였으면 좋겠어 … 그래야 폴더 끌어서 옮길 때 편해".
// 넓은 화면 두 칸 나무(왼쪽 나무 | 오른쪽 그 폴더): 오른쪽이 A를 보는 중 나무에서 B를 한 번 누르면 B만 펼쳐지고 오른쪽은 A 그대로,
// B를 다시 누르면 오른쪽이 B. 폴더 아이콘을 누르면 접히고 오른쪽 그대로. 끄는 중 닫힌 나무 폴더 위에 머무르면 저절로 펼침.
// 공용 부품 하나(folder-tree-press.mjs ftExplorePress·ftHoverExpander). 같은 시험을 [파일](한 칸·두 칸)·자료실·노트에서 되풀이한다. 이름·id는 모두 지어낸 것.

// ---------- [파일] ----------
const fx = page => page.locator('#filesRoot');
const listNames = page => fx(page).locator('[data-fx-pane-i="0"] [data-fx-list] [data-fx-row]').locator(':is(.fx-name, .ft-name)').allTextContents();
const fxTreeRow = (page, key) => fx(page).locator(`[data-fx-tree] [data-fx-fold="${key}"]`);
const fxTog = (page, key) => fxTreeRow(page, key).locator(':scope > .ft-tog');
function addFiles(server) {
  const it = o => ({ parent_id: null, is_folder: false, mime: null, size_bytes: 1000, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null, ...o });
  const dir = (source, item_id, name, parent_id = null) => it({ source, item_id, name, parent_id, is_folder: true, size_bytes: null });
  server.items.push(
    dir('gd', 'gdVoice', '음성 녹음 백업'),
    dir('gd', 'gdWait', '수동전사대기', 'gdVoice'), dir('gd', 'gdRaw', '원본', 'gdVoice'), dir('gd', 'gdText', '전사', 'gdVoice'),
    dir('od', 'OD!D', 'Documents'), dir('od', 'OD!PS', 'PowerShell', 'OD!D'), dir('od', 'OD!PSM', 'Modules', 'OD!PS'),
    it({ source: 'od', item_id: 'OD!DF', parent_id: 'OD!D', name: '가짜 목록.txt', mime: 'text/plain' }),
  );
}

for (const two of [false, true]) {
  test(`[파일] PC 1280 ${two ? '두 칸' : '한 칸'}: A를 보는 중 나무 B 한 번 = 펼치기만(오른쪽 A 그대로), 다시 = 오른쪽 B, 아이콘 = 접기`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, 1280);
    addFiles(server);
    await openFiles(page, 1280);
    if (two) {
      await fx(page).locator('[data-fx-view-seg] [data-fx-two]').click();
      await expect(fx(page).locator('[data-fx-pane-i="1"]')).toHaveCount(1);
      // 두 칸은 나무가 접혀 있다(S52-41 ③) — ◫로 연다. 나무에서 연 폴더는 지금 칸(왼쪽 칸)에 열린다.
      if (await fx(page).locator('[data-fx-tree]').isHidden()) await fx(page).locator('[data-fx-tree-tog]').click();
      await expect(fx(page).locator('[data-fx-tree]')).toBeVisible();
    }
    // A = '음성 녹음 백업'(⋯ 우클릭 [이 폴더로 들어가기]로 들어감).
    await treeGo(page, 'gd', 'gdVoice');
    const A = ['수동전사대기', '원본', '전사'];
    await expect.poll(() => listNames(page)).toEqual(A);
    // B = 'Documents'(닫힘, 하위 있음) 한 번 → 나무에서 펼치기만, 오른쪽은 A 그대로.
    const B = fxTreeRow(page, 'od:OD!D');
    await expect(fxTog(page, 'od:OD!D')).toHaveAttribute('aria-expanded', 'false');
    await B.locator('.ft-main').click();
    await expect(fxTog(page, 'od:OD!D')).toHaveAttribute('aria-expanded', 'true');
    await expect(fxTreeRow(page, 'od:OD!PS')).toBeVisible();
    await expect(B).toHaveClass(/ft-armed/);
    await expect(B).not.toHaveClass(/ft-current/);
    expect(await listNames(page)).toEqual(A);
    await expect(fxTreeRow(page, 'gd:gdVoice')).toHaveClass(/ft-current/);
    // B 다시 → 오른쪽이 B(하위 폴더 줄 → 파일), 나무 펼침 그대로.
    await B.locator('.ft-main').click();
    await expect.poll(() => listNames(page)).toEqual(['PowerShell', '가짜 목록.txt']);
    await expect(B).toHaveClass(/ft-current/);
    await expect(fxTog(page, 'od:OD!D')).toHaveAttribute('aria-expanded', 'true');
    // 폴더 아이콘 = 접기(오른쪽 B 그대로). 지금 폴더 이름 누르기 = 닫혀 있으면 펼치기만.
    await fxTog(page, 'od:OD!D').click();
    await expect(fxTreeRow(page, 'od:OD!PS')).toHaveCount(0);
    expect(await listNames(page)).toEqual(['PowerShell', '가짜 목록.txt']);
    await B.locator('.ft-main').click();
    await expect(fxTog(page, 'od:OD!D')).toHaveAttribute('aria-expanded', 'true');
    expect(await listNames(page)).toEqual(['PowerShell', '가짜 목록.txt']);
    // 키보드 ← = 접기(오른쪽 그대로).
    await B.locator('.ft-main').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(fxTog(page, 'od:OD!D')).toHaveAttribute('aria-expanded', 'false');
    expect(await listNames(page)).toEqual(['PowerShell', '가짜 목록.txt']);
    expect(errors).toEqual([]);
  });
}

test('[파일] PC 1280: 오른쪽 폴더를 끌어 닫힌 나무 폴더 위에 잠깐 머무르면 저절로 펼침(놓을 하위 폴더가 보임)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1280);
  addFiles(server);
  await openFiles(page, 1280);
  await treeGo(page, 'od', 'OD!D');
  await expect.poll(() => listNames(page)).toEqual(['PowerShell', '가짜 목록.txt']);
  // 'Documents'는 들어가며 펼쳐졌으니 아이콘으로 접고, '음성 녹음 백업'은 닫힌 채로 둔다.
  await expect(fxTog(page, 'gd:gdVoice')).toHaveAttribute('aria-expanded', 'false');
  const from = fx(page).locator('[data-fx-pane-i="0"] [data-fx-row="od:OD!DF"]');
  const to = fxTreeRow(page, 'gd:gdVoice').locator('.ft-main');
  await from.hover();
  await page.mouse.down();
  const b = await to.boundingBox();
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + 44, b.y + b.height / 2, { steps: 2 });
  await expect(fxTreeRow(page, 'gd:gdWait')).toBeVisible({ timeout: 3000 });
  await expect(fxTog(page, 'gd:gdVoice')).toHaveAttribute('aria-expanded', 'true');
  // 펼쳐진 하위 폴더 위로 옮겨 가도 오른쪽(끌던 줄)은 그대로.
  const sub = await fxTreeRow(page, 'gd:gdRaw').locator('.ft-main').boundingBox();
  await page.mouse.move(sub.x + 40, sub.y + sub.height / 2, { steps: 4 });
  await expect(from).toBeVisible();
  // 놓지 않고 빈 곳에서 뗀다.
  await page.mouse.move(5, 5, { steps: 4 });
  await page.mouse.up();
  expect(await listNames(page)).toEqual(['PowerShell', '가짜 목록.txt']);
  expect(errors).toEqual([]);
});

// ---------- 자료실 ----------
const LIB_FOLDERS = [
  libFolder('s05', null, { name: '05. 교육', sort_order: 1 }),
  libFolder('s06', null, { name: '06. 선전', sort_order: 2 }),
  libFolder('s06a', null, { name: '필수유지', parent_id: 's06', sort_order: 1 }),
  libFolder('s06b', null, { name: '카드뉴스', parent_id: 's06', sort_order: 2 }),
];
const LIB_DOCS = [libDoc('dA', null), libDoc('dB', null), libDoc('dC', null)];
const LIB_ITEMS = [{ document_id: 'dA', folder_id: 's06' }, { document_id: 'dB', folder_id: 's06b' }, { document_id: 'dC', folder_id: 's05' }];
const luNav = id => `#libraryFolderNav [data-lu-nav="${id}"]`;
const luNavRow = (page, id) => page.locator(luNav(id)).locator('xpath=..');
const luTog = (page, id) => page.locator(`#libraryFolderNav [data-lu-nav-tog="${id}"]`);
const doc = (page, id) => page.locator(`#documentList [data-lu-document="${id}"]`);

test('자료실 PC 1280: A를 보는 중 나무 B 한 번 = 펼치기만(오른쪽 A 그대로), 다시 = 오른쪽 B, 아이콘 = 접기, 하위 없는 폴더는 골라짐 뒤', async ({ page }) => {
  const { errors } = await bootLibrary(page, 1280, { folders: LIB_FOLDERS, items: LIB_ITEMS, docs: LIB_DOCS, init: { viewPrefs: { library_two: false } } });
  await page.locator('#libraryGroupBy').selectOption({ label: '폴더' });
  // A = '05. 교육'(하위 없음): 첫 누르기 골라짐, 두 번째 들어가기.
  await page.locator(luNav('s05')).click();
  await expect(luNavRow(page, 's05')).toHaveClass(/ft-armed/);
  await expect(luNavRow(page, 's05')).not.toHaveClass(/ft-current/);
  await page.locator(luNav('s05')).click();
  await expect(luNavRow(page, 's05')).toHaveClass(/ft-current/);
  await expect(doc(page, 'dC')).toBeVisible();
  // B = '06. 선전'(닫힘, 하위 있음) 한 번 → 펼치기만, 오른쪽 A 그대로.
  await expect(luTog(page, 's06')).toHaveAttribute('aria-expanded', 'false');
  await page.locator(luNav('s06')).click();
  await expect(luTog(page, 's06')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(luNav('s06a'))).toBeVisible();
  await expect(luNavRow(page, 's05')).toHaveClass(/ft-current/);
  await expect(doc(page, 'dC')).toBeVisible();
  await expect(doc(page, 'dA')).toHaveCount(0);
  // B 다시 → 오른쪽 B.
  await page.locator(luNav('s06')).click();
  await expect(luNavRow(page, 's06')).toHaveClass(/ft-current/);
  await expect(doc(page, 'dA')).toBeVisible();
  await expect(luTog(page, 's06')).toHaveAttribute('aria-expanded', 'true');
  // 아이콘 = 접기, 오른쪽 그대로.
  await luTog(page, 's06').click();
  await expect(page.locator(luNav('s06a'))).toHaveCount(0);
  await expect(doc(page, 'dA')).toBeVisible();
  // '자료실 전체'는 폴더가 아니라 한 번에 연다.
  await page.locator(luNav('')).click();
  await expect(page.locator(luNav(''))).toHaveAttribute('aria-current', 'true');
  expect(errors).toEqual([]);
});

test('자료실 PC 1280: 자료를 끌어 닫힌 왼쪽 나무 폴더 위에 잠깐 머무르면 저절로 펼침', async ({ page }) => {
  const { errors } = await bootLibrary(page, 1280, { folders: LIB_FOLDERS, items: LIB_ITEMS, docs: LIB_DOCS, init: { viewPrefs: { library_two: false } } });
  await page.locator('#libraryGroupBy').selectOption({ label: '폴더' });
  await page.locator(luNav('s05')).click();
  await page.locator(luNav('s05')).click();
  await expect(doc(page, 'dC')).toBeVisible();
  await expect(luTog(page, 's06')).toHaveAttribute('aria-expanded', 'false');
  await doc(page, 'dC').hover();
  await page.mouse.down();
  const b = await page.locator(luNav('s06')).boundingBox();
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + 44, b.y + b.height / 2, { steps: 2 });
  await expect(page.locator(luNav('s06a'))).toBeVisible({ timeout: 3000 });
  await expect(doc(page, 'dC')).toBeVisible(); // 오른쪽(끌던 줄)은 그대로
  await page.mouse.move(5, 5, { steps: 4 });
  await page.mouse.up();
  await expect(luNavRow(page, 's05')).toHaveClass(/ft-current/);
  expect(errors).toEqual([]);
});

// ---------- 노트 ----------
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function notes(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    row('n1', '가짜 상위 노트', '2026-10-16T01:00:00Z', { folder_id: U(1) }),
    row('n2', '가짜 하위 노트', '2026-10-12T01:00:00Z', { folder_id: U(2) }),
    row('n3', '가짜 다른 노트', '2026-10-10T01:00:00Z', { folder_id: U(3) }),
  ];
  const folders = [
    { id: U(1), workspace_id: 'w', parent_id: null, name: '가짜 회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: U(2), workspace_id: 'w', parent_id: U(1), name: '가짜 11월', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: U(3), workspace_id: 'w', parent_id: null, name: '가짜 기획', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' },
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: rows.map(x => structuredClone(x)) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  return { errors };
}

test('노트 PC 1280: A를 보는 중 나무 B 한 번 = 펼치기만(오른쪽 A 그대로), 다시 = 오른쪽 B, 아이콘 = 접기', async ({ page }) => {
  const { errors } = await notes(page, 1280);
  const tree = page.locator('[data-nx-tree]'), right = page.locator('#noteRows');
  // A = '가짜 기획'(하위 없음): 첫 누르기 골라짐, 두 번째 들어가기.
  await tree.locator(`[data-nx-open="${U(3)}"]`).click();
  await tree.locator(`[data-nx-open="${U(3)}"]`).click();
  await expect(tree.locator(`[data-nx-folder="${U(3)}"]`)).toHaveClass(/ft-current/);
  await expect(right.locator('[data-note-row="n3"]')).toBeVisible();
  await expect(right.locator('[data-note-row="n1"]')).toHaveCount(0);
  // B = '가짜 회의'(닫힘, 하위 있음) 한 번 → 펼치기만, 오른쪽 A 그대로.
  await tree.locator(`[data-nx-open="${U(1)}"]`).click();
  await expect(tree.locator(`[data-nx-tog="${U(1)}"]`)).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.locator(`[data-nx-folder="${U(2)}"]`)).toBeVisible();
  await expect(tree.locator(`[data-nx-folder="${U(3)}"]`)).toHaveClass(/ft-current/);
  await expect(right.locator('[data-note-row="n3"]')).toBeVisible();
  await expect(right.locator('[data-note-row="n1"]')).toHaveCount(0);
  // B 다시 → 오른쪽 B.
  await tree.locator(`[data-nx-open="${U(1)}"]`).click();
  await expect(tree.locator(`[data-nx-folder="${U(1)}"]`)).toHaveClass(/ft-current/);
  await expect(right.locator('[data-note-row="n1"]')).toBeVisible();
  await expect(tree.locator(`[data-nx-tog="${U(1)}"]`)).toHaveAttribute('aria-expanded', 'true');
  // 아이콘 = 접기, 오른쪽 그대로.
  await tree.locator(`[data-nx-tog="${U(1)}"]`).click();
  await expect(tree.locator(`[data-nx-folder="${U(2)}"]`)).toHaveCount(0);
  await expect(right.locator('[data-note-row="n1"]')).toBeVisible();
  expect(errors).toEqual([]);
});
