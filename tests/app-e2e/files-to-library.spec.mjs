import { test, expect } from '@playwright/test';
import { start, openFiles, treeGo } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// FILES-자료실로보내기(S52-26, 요청함 11/07 11:37, 시안 docs/design/mockups/files-to-library.html, 명진 11:41 '(가) 연결만').
// [파일]의 파일 ⋯(PC 우클릭) → [자료실로 보내기] → 자료실 등록 창(같은 칸·같은 [등록])에 그 파일이 들어가고,
// 원드라이브 파일은 사본으로 올리고(library-files), 구글 드라이브 파일은 사본 없이 연결만(document-actions register-drive-file, library-files 없음).
// 이미 자료실에 있는 구글 드라이브 파일은 메뉴가 [자료실에서 보기], 여러 개 고른 줄의 [자료실로]는 '이미 자료실에 있어요 · 보기'. 합성 데이터만.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);

async function begin(page) {
  const { errors, server } = await start(page, 1440);
  await installViewPrefsServer(page);
  // 아직 자료실에 없는 구글 드라이브 파일 하나(합성).
  server.items.push({ source: 'gd', item_id: 'gdNew1', parent_id: 'gdFolder1', name: '가짜 연결 자료.pdf', is_folder: false, mime: 'application/pdf', size_bytes: 2048,
    modified_at: '2026-10-05T06:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null });
  const lib = { uploads: [], registers: [], patches: [] };
  // 자료실 쪽 서버(나중에 붙인 길이 먼저): 사본 올리기·연결·칸 적기.
  await page.route(SB + '/functions/v1/library-files', async route => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const raw = req.postDataBuffer()?.toString('latin1') || '', name = Buffer.from(raw.match(/filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8');
    lib.uploads.push(name);
    return route.fulfill({ json: { ok: true, document: { id: 'up-' + lib.uploads.length, workspace_id: 'w1', project_id: null, title: name, tags: [] } } });
  });
  await page.route(SB + '/functions/v1/document-actions', async route => {
    const body = route.request().postDataJSON?.() || {};
    if (body.action !== 'register-drive-file') return route.fallback();
    lib.registers.push(body);
    return route.fulfill({ json: { ok: true, result: 'created', document: { id: 'link-' + lib.registers.length, title: '가짜 연결 자료' } } });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_documents', async route => {
    const req = route.request();
    if (req.method() !== 'PATCH') return route.fallback();
    const id = new URL(req.url()).searchParams.get('id')?.replace(/^eq\./, '');
    lib.patches.push({ id, body: req.postDataJSON() });
    return route.fulfill({ json: [{ id, project_id: null }] });
  });
  await page.reload();
  await openFiles(page, 1440);
  return { errors, server, lib };
}
async function menuOn(page, key, item) {
  await row(page, key).first().click({ button: 'right' });
  const menu = page.locator('[data-row-item]');
  await expect(menu.first()).toBeVisible();
  return page.locator(`[data-row-item="${item}"]`);
}

test('PC 1440: 원드라이브 파일 우클릭 → [자료실로 보내기] → 자료 등록 창 → [등록]이면 사본을 자료실로 올린다', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server, lib } = await begin(page);
  await treeGo(page, 'od', '');
  await row(page, 'od:OD!1').first().click();
  const send = await menuOn(page, 'od:OD!11', 'tolib');
  await expect(send).toHaveText(/자료실로 보내기/);
  await send.click();
  const modal = page.locator('#documentModal');
  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(modal.locator('[data-lu-upload-file]')).toHaveCount(1);
  await expect(modal.locator('[data-lu-upload-file]')).toContainText('가짜 안내문.pdf');
  // 원드라이브 원본은 서버 media로 받아 사본을 만든다(원본은 그대로: 원드라이브 쓰기 없음).
  expect(server.calls.filter(c => c.what === 'edge' && c.action === 'media' && c.body.id === 'OD!11')).toHaveLength(1);
  await page.locator('#saveDocumentBtn').click();
  await expect(modal).toBeHidden({ timeout: 15000 });
  await expect.poll(() => lib.uploads, { timeout: 15000 }).toEqual(['가짜 안내문.pdf']);
  expect(lib.registers).toEqual([]);
  expect(server.calls.filter(c => c.what === 'edge' && ['move', 'trash', 'rename', 'job_add'].includes(c.action))).toEqual([]);
  expect(errors).toEqual([]);
});

test('PC 1440: 구글 드라이브 파일은 사본 없이 연결만, 이미 자료실에 있는 파일은 [자료실에서 보기]·[자료실로]는 이미 있어요 · 보기', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, lib } = await begin(page);
  await treeGo(page, 'gd', '');
  await row(page, 'gd:gdFolder1').first().click();
  // 이미 자료실에 있는 파일: 메뉴는 [자료실에서 보기](보내기 없음).
  await expect(await menuOn(page, 'gd:gdDoc1', 'libview')).toHaveText(/자료실에서 보기/);
  await expect(page.locator('[data-row-item="tolib"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const send = await menuOn(page, 'gd:gdNew1', 'tolib');
  await send.click();
  const modal = page.locator('#documentModal');
  await expect(modal).toBeVisible({ timeout: 15000 });
  const line = modal.locator('[data-lu-upload-file]');
  await expect(line).toContainText('가짜 연결 자료.pdf');
  await expect(line.locator('[data-lu-upload-state]')).toHaveText('연결만(사본 없음)');
  await page.locator('#saveDocumentBtn').click();
  await expect(modal).toBeHidden({ timeout: 15000 });
  await expect.poll(() => lib.registers, { timeout: 15000 }).toEqual([{ action: 'register-drive-file', drive_file_id: 'gdNew1' }]);
  expect(lib.uploads).toEqual([]); // 사본 없음
  // 여러 개 고르기 → [자료실로]: 이미 있는 것만이면 창을 열지 않고 '이미 자료실에 있어요 · 보기'.
  await row(page, 'gd:gdDoc1').first().click({ modifiers: ['Control'] });
  await root(page).locator('[data-fx-bar] [data-fx-tolib]').click();
  const notice = page.locator('.kptu-notice-text');
  await expect(notice).toHaveText('이미 자료실에 있어요 · 가짜 결과 정리.pdf');
  await expect(page.getByRole('button', { name: '보기', exact: true })).toBeVisible();
  await expect(modal).toBeHidden();
  expect(lib.registers).toHaveLength(1);
  expect(errors).toEqual([]);
});
