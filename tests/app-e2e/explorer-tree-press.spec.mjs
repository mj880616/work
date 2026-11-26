import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
import { bootLibrary, libFolder, libDoc } from './helpers/library-folder-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { treeEnter } from './helpers/tree-enter.mjs';
// S69-38 UI-탐색기나무누르기(사용자 11/24 "상위폴더를 눌러도 오른쪽에 내용이 보이게 / 이거는 모든곳 공통 노트 자료 파일"):
// 탐색기 화면(왼쪽 나무 | 오른쪽 그 폴더 내용)의 나무에서 어느 폴더를 누르든(하위 폴더가 있는 상위 폴더 포함) 오른쪽이 그 폴더 — 하위 폴더 줄 다음에 파일·자료·노트.
// TREE-탐색기꺾쇠(S70-81b, T10): 이름 한 번 = 오른쪽 그 폴더(나무 펼침 그대로), 펼치기·접기는 아이콘 왼쪽 꺾쇠·두 번 누르기·→ ←. 이 시험의 '들어가며 펼치기'는 treeEnter(이름 + 꺾쇠). S69-68: 오른쪽 하위 폴더를 누르면 그 자리 펼치기·접기(들어가기는 왼쪽 나무·⋯). 공용 부품 하나(folder-tree-press.mjs ftExplorePress).
// 같은 시험을 화면마다 되풀이한다: [파일] · 자료실 · 노트. 이름·id는 모두 지어낸 것이다.

// ---------- [파일] ----------
const fx = page => page.locator('#filesRoot');
const listNames = page => fx(page).locator('[data-fx-pane-i="0"] [data-fx-list] [data-fx-row]').locator(':is(.fx-name, .ft-name)').allTextContents();
const fxTreeRow = (page, key) => fx(page).locator(`[data-fx-tree] [data-fx-fold="${key}"]`);
function addFiles(server) {
  const it = o => ({ parent_id: null, is_folder: false, mime: null, size_bytes: 1000, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null, ...o });
  const dir = (source, item_id, name, parent_id = null) => it({ source, item_id, name, parent_id, is_folder: true, size_bytes: null });
  server.items.push(
    dir('gd', 'gdVoice', '음성 녹음 백업'),
    dir('gd', 'gdWait', '수동전사대기', 'gdVoice'), dir('gd', 'gdRaw', '원본', 'gdVoice'), dir('gd', 'gdText', '전사', 'gdVoice'),
    it({ source: 'gd', item_id: 'gdWaitFile', parent_id: 'gdWait', name: '가짜 녹음 1.m4a', mime: 'audio/mp4' }),
    dir('od', 'OD!D', 'Documents'), dir('od', 'OD!PS', 'PowerShell', 'OD!D'), dir('od', 'OD!PSM', 'Modules', 'OD!PS'),
    it({ source: 'od', item_id: 'OD!DF', parent_id: 'OD!D', name: '가짜 목록.txt', mime: 'text/plain' }),
  );
}

test('[파일] PC 1280: 하위 있는 상위 폴더를 눌러도 오른쪽 = 그 폴더(하위 폴더 줄 → 파일) · 나무 펼침 · 오른쪽 하위 → 왼쪽 따라 펼침 · [한 칸|두 칸]', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1280);
  addFiles(server);
  await openFiles(page, 1280);
  // 구글 드라이브 '음성 녹음 백업'(하위 3개) 이름 누르기 → 오른쪽에 수동전사대기·원본·전사(나무는 접힌 채), 꺾쇠로 펼치고 강조.
  const voice = fxTreeRow(page, 'gd:gdVoice');
  await voice.locator('.ft-main').click();
  await expect.poll(() => listNames(page)).toEqual(['수동전사대기', '원본', '전사']);
  await expect(voice.locator(':scope > .ft-tog')).toHaveAttribute('aria-expanded', 'false');
  await voice.locator(':scope > .ft-tog').click();
  await expect.poll(() => listNames(page)).toEqual(['수동전사대기', '원본', '전사']);
  await expect(fx(page).locator('[data-fx-crumb], [data-fx-pane-i="0"] .fx-ptop')).toContainText(['음성 녹음 백업']);
  await expect(voice).toHaveClass(/ft-current/);
  await expect(voice.locator(':scope > .ft-tog')).toHaveAttribute('aria-expanded', 'true');
  await expect(fxTreeRow(page, 'gd:gdWait')).toBeVisible();
  // 지금 폴더 이름을 다시 눌러도 접거나 펼치지 않는다(T10 — 접기는 꺾쇠·두 번 누르기·←). 오른쪽은 늘 그 폴더.
  await page.waitForTimeout(700); // 두 번 누르기로 세지 않게 띄어 누른다
  await voice.locator('.ft-main').click();
  await expect(voice.locator(':scope > .ft-tog')).toHaveAttribute('aria-expanded', 'true');
  await expect(fxTreeRow(page, 'gd:gdWait')).toBeVisible();
  await voice.locator(':scope > .ft-tog').click();
  await expect(fxTreeRow(page, 'gd:gdWait')).toHaveCount(0);
  await expect.poll(() => listNames(page)).toEqual(['수동전사대기', '원본', '전사']); // 아이콘은 오른쪽을 바꾸지 않음
  // 원드라이브 'Documents' → 오른쪽 PowerShell(폴더) 다음 파일(나무도 꺾쇠로 펼쳐 둔다).
  await treeEnter(fxTreeRow(page, 'od:OD!D').locator('.ft-main'));
  await expect.poll(() => listNames(page)).toEqual(['PowerShell', '가짜 목록.txt']);
  // S69-68(사용자 11/24 20:09): 오른쪽 하위 폴더 누르기 = 그 자리 펼치기·접기(들어가지 않음). 왼쪽 나무·주소는 그대로.
  const psRow = fx(page).locator('[data-fx-pane-i="0"] [data-fx-row="od:OD!PS"]');
  const url0 = page.url();
  await psRow.click();
  await expect(psRow).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => listNames(page)).toEqual(['PowerShell', 'Modules', '가짜 목록.txt']);
  await expect(fxTreeRow(page, 'od:OD!D')).toHaveClass(/ft-current/);
  await expect(fxTreeRow(page, 'od:OD!PS')).not.toHaveClass(/ft-current/);
  await expect(fxTreeRow(page, 'od:OD!PSM')).toHaveCount(0); // 왼쪽 나무는 따라 펼치지 않음
  expect(page.url()).toBe(url0);
  await psRow.click();
  await expect(psRow).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => listNames(page)).toEqual(['PowerShell', '가짜 목록.txt']);
  // 들어가기는 왼쪽 나무 또는 우클릭 [이 폴더로 들어가기] — 왼쪽 나무가 따라 펼침·강조.
  await psRow.click({ button: 'right' });
  await page.locator('#rowMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
  await expect.poll(() => listNames(page)).toEqual(['Modules']);
  await expect(fxTreeRow(page, 'od:OD!PS')).toHaveClass(/ft-current/);
  await expect(fxTreeRow(page, 'od:OD!PSM')).toBeVisible();
  // Backspace = 위 폴더(Documents) — 위치 줄·나무 강조가 같은 상태.
  await fx(page).locator('[data-fx-pane-i="0"] [data-fx-row="od:OD!PSM"]').focus();
  await page.keyboard.press('Backspace');
  await expect.poll(() => listNames(page)).toEqual(['PowerShell', '가짜 목록.txt']);
  await expect(fxTreeRow(page, 'od:OD!D')).toHaveClass(/ft-current/);
  // [한 칸 | 두 칸] 붙은 단추(자료실과 같은 ds-seg).
  const seg = fx(page).locator('[data-fx-view-seg]');
  await expect(seg).toHaveClass(/ds-seg/);
  await expect(seg.locator('[data-fx-one]')).toHaveAttribute('aria-pressed', 'true');
  await seg.locator('[data-fx-two]').click();
  await expect(fx(page).locator('[data-fx-pane-i="1"]')).toHaveCount(1);
  await expect(seg.locator('[data-fx-two]')).toHaveAttribute('aria-pressed', 'true');
  await seg.locator('[data-fx-one]').click();
  await expect(fx(page).locator('[data-fx-pane-i="1"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('[파일] 폰 412: 나무와 내용 한 칸씩 — 그 폴더 안 하위 폴더 누르기 = 그 자리 펼치기(S69-68), 들어가기는 ⋯, 뒤로가기 = 한 단계 위 → 나무', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  addFiles(server);
  await openFiles(page, 412);
  const { phoneFolder } = await import('./helpers/files-server.mjs');
  await phoneFolder(page, 'gd', 'gdVoice');
  await expect.poll(() => listNames(page)).toEqual(['수동전사대기', '원본', '전사']);
  const wait = fx(page).locator('[data-fx-row="gd:gdWait"]');
  await wait.click();
  await expect(wait).toHaveAttribute('aria-expanded', 'true');
  await expect(fx(page).locator('.ft-focus-name')).toHaveText('음성 녹음 백업');
  await expect.poll(() => listNames(page)).toEqual(['수동전사대기', '가짜 녹음 1.m4a', '원본', '전사']);
  await wait.click();
  await expect(wait).toHaveAttribute('aria-expanded', 'false');
  await fx(page).locator('[data-fx-focus] [data-fx-tmenu="gd:gdWait"]').click();
  await page.locator('#rowMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
  await expect(fx(page).locator('.ft-focus-name')).toHaveText('수동전사대기');
  await expect.poll(() => listNames(page)).toEqual(['가짜 녹음 1.m4a']);
  await page.goBack();
  await expect(fx(page).locator('.ft-focus-name')).toHaveText('음성 녹음 백업');
  await page.goBack();
  await expect(fx(page).locator('[data-fx-tree]')).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------- 자료실 ----------
const LIB_FOLDERS = [
  libFolder('s05', null, { name: '05. 교육', sort_order: 1 }),
  libFolder('s06', null, { name: '06. 선전', sort_order: 2 }),
  libFolder('s06a', null, { name: '필수유지', parent_id: 's06', sort_order: 1 }),
  libFolder('s06b', null, { name: '카드뉴스', parent_id: 's06', sort_order: 2 }),
  libFolder('s06c', null, { name: '성명·보도자료', parent_id: 's06', sort_order: 3 }),
];
const LIB_DOCS = [libDoc('dA', null), libDoc('dB', null)];
const LIB_ITEMS = [{ document_id: 'dA', folder_id: 's06' }, { document_id: 'dB', folder_id: 's06b' }];
const luNav = id => `#libraryFolderNav [data-lu-nav="${id}"]`;
const luRight = page => page.locator('#documentList > details.lu-node').evaluateAll(xs => xs.map(x => x.dataset.luNode));

test('자료실 PC 1280: 하위 있는 \'06. 선전\'을 누르면 오른쪽 = 필수유지·카드뉴스·성명·보도자료 + 자료 · 나무 펼침 · 오른쪽 하위 → 왼쪽 따라 펼침', async ({ page }) => {
  const { errors } = await bootLibrary(page, 1280, { folders: LIB_FOLDERS, items: LIB_ITEMS, docs: LIB_DOCS, init: { viewPrefs: { library_two: false } } });
  await page.locator('#libraryGroupBy').selectOption({ label: '폴더' });
  await treeEnter(page.locator(luNav('s06')));
  await expect.poll(() => luRight(page)).toEqual(['f:s06a', 'f:s06b', 'f:s06c']);
  await expect(page.locator('#documentList [data-lu-document="dA"]')).toBeVisible();
  await expect(page.locator(luNav('s06')).locator('xpath=..')).toHaveClass(/ft-current/);
  await expect(page.locator('#libraryFolderNav [data-lu-nav-tog="s06"]')).toHaveAttribute('aria-expanded', 'true');
  // S69-68(사용자 11/24 20:09): 오른쪽 하위 폴더 줄 누르기 = 그 자리 펼치기·접기(들어가지 않음, 왼쪽 나무 그대로). 들어가기는 왼쪽 나무.
  await page.locator('#documentList details[data-lu-node="f:s06b"] > summary').click();
  await expect(page.locator('#documentList details[data-lu-node="f:s06b"]')).toHaveAttribute('open', '');
  await expect(page.locator('#documentList [data-lu-document="dB"]')).toBeVisible();
  await expect(page.locator(luNav('s06')).locator('xpath=..')).toHaveClass(/ft-current/);
  await expect.poll(() => luRight(page)).toEqual(['f:s06a', 'f:s06b', 'f:s06c']);
  await page.locator('#documentList details[data-lu-node="f:s06b"] > summary').click();
  await expect(page.locator('#documentList [data-lu-document="dB"]')).toBeHidden();
  await page.locator(luNav('s06b')).click();
  await expect(page.locator('#documentList [data-lu-document="dB"]')).toBeVisible();
  await expect(page.locator(luNav('s06b')).locator('xpath=..')).toHaveClass(/ft-current/);
  await page.keyboard.press('Backspace');
  await expect.poll(() => luRight(page)).toEqual(['f:s06a', 'f:s06b', 'f:s06c']);
  // [한 칸 | 두 칸]
  await page.locator('#libraryTwoBtn').click();
  await expect(page.locator('#libraryTwoBtn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#libraryOneBtn').click();
  await expect(page.locator('#libraryOneBtn')).toHaveAttribute('aria-pressed', 'true');
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
    row('n3', '가짜 밖 노트', '2026-10-10T01:00:00Z'),
  ];
  const folders = [
    { id: U(1), workspace_id: 'w', parent_id: null, name: '가짜 회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: U(2), workspace_id: 'w', parent_id: U(1), name: '가짜 11월', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: rows.map(x => structuredClone(x)) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  return { errors };
}

test('노트 PC 1280: 하위 있는 폴더를 누르면 오른쪽 = 하위 폴더 줄 + 그 폴더 노트 · 나무 펼침 · 오른쪽 하위 → 그 자리 펼치기(S69-68)', async ({ page }) => {
  const { errors } = await notes(page, 1280);
  const tree = page.locator('[data-nx-tree]'), right = page.locator('#noteRows');
  await treeEnter(tree.locator(`[data-nx-open="${U(1)}"]`));
  await expect(right.locator(`[data-nx-folder="${U(2)}"]`)).toBeVisible();
  await expect(right.locator('[data-note-row="n1"]')).toBeVisible();
  await expect(right.locator('[data-note-row="n2"]')).toHaveCount(0); // 하위 폴더 안 노트는 그 폴더에 들어가야 보인다
  await expect(tree.locator(`[data-nx-folder="${U(1)}"]`)).toHaveClass(/ft-current/);
  await expect(tree.locator(`[data-nx-tog="${U(1)}"]`)).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.locator(`[data-nx-folder="${U(2)}"]`)).toBeVisible();
  // S69-68: 오른쪽 하위 폴더 누르기 = 그 자리 펼치기·접기(왼쪽 나무·지금 폴더 그대로).
  await right.locator(`[data-nx-open="${U(2)}"]`).click();
  await expect(right.locator('[data-note-row="n2"]')).toBeVisible();
  await expect(right.locator(`[data-nx-open="${U(2)}"]`)).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.locator(`[data-nx-folder="${U(1)}"]`)).toHaveClass(/ft-current/);
  await expect(tree.locator(`[data-nx-folder="${U(2)}"]`)).not.toHaveClass(/ft-current/);
  await right.locator(`[data-nx-open="${U(2)}"]`).click();
  await expect(right.locator('[data-note-row="n2"]')).toHaveCount(0);
  // 들어가기는 왼쪽 나무 — 왼쪽이 강조.
  await tree.locator(`[data-nx-open="${U(2)}"]`).click();
  await expect(right.locator('[data-note-row="n2"]')).toBeVisible();
  await expect(tree.locator(`[data-nx-folder="${U(2)}"]`)).toHaveClass(/ft-current/);
  // 뒤로가기 = 앞 폴더.
  await page.goBack();
  await expect(right.locator(`[data-nx-folder="${U(2)}"]`)).toBeVisible();
  await expect(tree.locator(`[data-nx-folder="${U(1)}"]`)).toHaveClass(/ft-current/);
  // 아이콘은 펼치기·접기만(오른쪽 그대로).
  await tree.locator(`[data-nx-tog="${U(1)}"]`).click();
  await expect(tree.locator(`[data-nx-folder="${U(2)}"]`)).toHaveCount(0);
  await expect(right.locator(`[data-nx-folder="${U(2)}"]`)).toBeVisible();
  expect(errors).toEqual([]);
});
