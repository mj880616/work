import { test, expect } from '@playwright/test';
import { start, openFiles, treeGo, enterRow } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// FILES-자료실로보내기(S52-26, 요청함 11/07 11:37, 시안 docs/design/mockups/files-to-library.html, 명진 11:41 '(가) 연결만').
// [파일]의 파일 ⋯(PC 우클릭) → [자료실로 보내기] → 자료실 등록 창(같은 칸·같은 [등록])에 그 파일이 들어가고,
// 원드라이브 파일은 사본으로 올리고(library-files), 구글 드라이브 파일은 사본 없이 연결만(document-actions register-drive-file, library-files 없음).
// 이미 자료실에 있는 구글 드라이브 파일은 메뉴가 [자료실에서 보기], 여러 개 고른 줄의 [자료실로]는 '이미 자료실에 있어요 · 보기'. 합성 데이터만.
// 등록 창 먼저(S57-1, 2026-11-11 결정 — UX-먼저묻고뒤에처리): 누르자마자 등록 창이 뜨고(원본 바이트는 아직 받지 않음), [등록] 뒤 창이 닫히면
// 받기 → 올리기를 뒤에서 한다(다른 화면으로 옮겨도 끝까지, 실패는 알림 + [다시], ×로 닫으면 아무것도 받지 않음).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);

async function begin(page, width = 1440) {
  const { errors, server } = await start(page, width);
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
  await openFiles(page, width);
  return { errors, server, lib };
}
const mediaCalls = (server, id) => server.calls.filter(c => c.what === 'edge' && c.action === 'media' && c.body.id === id);
// 원본 바이트 받기(cloud-files media)를 붙잡거나 실패시키는 문(나중에 붙인 길이 먼저 본다). hold = 풀어 줄 때까지 응답을 미룸, failOnce = 그 id의 첫 받기만 실패.
async function mediaGate(page) {
  const gate = { seen: [], release: () => {}, held: null, failOnce: new Set() };
  await page.route(SB + '/functions/v1/cloud-files', async route => {
    const body = route.request().postDataJSON?.() || {};
    if (body.action !== 'media') return route.fallback();
    gate.seen.push(body.id);
    if (gate.held) await gate.held;
    if (gate.failOnce.delete(body.id)) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'cloud_throttled' }) });
    return route.fallback();
  });
  gate.hold = () => { gate.held = new Promise(r => { gate.release = () => { gate.held = null; r(); }; }); };
  return gate;
}
// 원드라이브 '가짜 문서함' 안의 파일들을 골라(여러 개 고르기 줄) [자료실로]를 누른다. 폰·PC 같은 길.
async function pickAndSend(page, names) {
  await treeGo(page, 'od');
  const list = root(page).locator('[data-fx-list]');
  await list.locator('[data-fx-row]', { hasText: '가짜 문서함' }).click();
  for (const name of names) await list.locator('[data-fx-row]', { hasText: name }).click({ modifiers: ['Control'] });
  await root(page).locator('[data-fx-bar]:not([hidden]) [data-fx-tolib]').click();
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
  await enterRow(page, row(page, 'od:OD!1').first());
  const send = await menuOn(page, 'od:OD!11', 'tolib');
  await expect(send).toHaveText(/자료실로 보내기/);
  await send.click();
  const modal = page.locator('#documentModal');
  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(modal.locator('[data-lu-upload-file]')).toHaveCount(1);
  await expect(modal.locator('[data-lu-upload-file]')).toContainText('가짜 안내문.pdf');
  // 등록 창 먼저: 창이 떴을 때 원본 바이트는 아직 받지 않았다.
  expect(mediaCalls(server, 'OD!11')).toHaveLength(0);
  await page.locator('#saveDocumentBtn').click();
  await expect(modal).toBeHidden({ timeout: 15000 });
  await expect.poll(() => lib.uploads, { timeout: 15000 }).toEqual(['가짜 안내문.pdf']);
  // 원드라이브 원본은 [등록] 뒤 서버 media로 한 번 받아 사본을 만든다(원본은 그대로: 원드라이브 쓰기 없음).
  expect(mediaCalls(server, 'OD!11')).toHaveLength(1);
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

// ── 등록 창 먼저(S57-1): 폰 412 · PC 1280 ──
for (const width of [412, 1280]) {
  test(`${width}: [자료실로]를 누르자마자 등록 창이 뜨고, [등록] 뒤 다른 화면으로 가도 받기 → 올리기가 끝까지 된다`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server, lib } = await begin(page, width);
    const gate = await mediaGate(page);
    gate.hold(); // 원본 받기는 풀어 줄 때까지 끝나지 않는다
    await pickAndSend(page, ['가짜 안내문.pdf']);
    const modal = page.locator('#documentModal');
    // ① 받기가 끝나기는커녕 시작도 하기 전에 창이 뜬다(이름·크기 줄).
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal.locator('[data-lu-upload-file]')).toContainText('가짜 안내문.pdf');
    expect(gate.seen).toEqual([]);
    await expect(root(page).locator('[data-fx-bar]')).not.toContainText('가져오는 중');
    // ② [등록] → 창은 바로 닫히고 그때 받기 시작. [파일]을 떠나도 계속된다.
    await page.locator('#docTitle').fill('가짜 제목');
    await page.locator('#saveDocumentBtn').click();
    await expect(modal).toBeHidden({ timeout: 15000 });
    await expect.poll(() => gate.seen).toEqual(['OD!11']);
    expect(lib.uploads).toEqual([]);
    await page.evaluate(() => window.KPTURouter.go('home', { source: 'qa' }));
    await expect(page.locator('#filesView')).toBeHidden();
    await expect(page.locator('#uploadDock')).toBeVisible(); // 진행은 공용 올리는 줄(하단바 위 한 줄)
    gate.release();
    await expect.poll(() => lib.uploads, { timeout: 15000 }).toEqual(['가짜 안내문.pdf']);
    await expect(page.locator('#kptuNotice')).toContainText('올렸어요');
    expect(mediaCalls(server, 'OD!11')).toHaveLength(1);
    expect(server.calls.filter(c => c.what === 'edge' && ['move', 'trash', 'rename', 'job_add'].includes(c.action))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`${width}: 받기에 실패한 파일은 알림 + [다시]로 그 파일만 다시 받아 올린다`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server, lib } = await begin(page, width);
    const gate = await mediaGate(page);
    gate.failOnce.add('OD!12');
    await pickAndSend(page, ['가짜 안내문.pdf', '가짜 예산표.xlsx']);
    const modal = page.locator('#documentModal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal.locator('[data-lu-upload-file]')).toHaveCount(2);
    await page.locator('#saveDocumentBtn').click();
    await expect(modal).toBeHidden({ timeout: 15000 });
    await expect.poll(() => lib.uploads, { timeout: 15000 }).toEqual(['가짜 안내문.pdf']);
    const notice = page.locator('#kptuNotice');
    await expect(notice).toContainText('1개 완료 · 1개 미완료');
    await expect(notice).toContainText('가짜 예산표.xlsx: 클라우드가 잠시 바쁩니다'); // 받지 못한 까닭(파일 이름과 함께)
    expect(mediaCalls(server, 'OD!12')).toHaveLength(0); // 실패한 받기는 문에서 돌려보냈다(서버 기록 없음)
    expect(gate.seen.filter(id => id === 'OD!12')).toHaveLength(1);
    await notice.getByRole('button', { name: '다시', exact: true }).click();
    await expect.poll(() => lib.uploads, { timeout: 15000 }).toEqual(['가짜 안내문.pdf', '가짜 예산표.xlsx']);
    // 그 파일만: 이미 올린 파일은 다시 받지도 올리지도 않는다.
    expect(gate.seen.filter(id => id === 'OD!11')).toHaveLength(1);
    expect(gate.seen.filter(id => id === 'OD!12')).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  test(`${width}: 등록 창을 ×로 닫으면 원본을 받지 않고 올리지도 않는다`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, lib } = await begin(page, width);
    const gate = await mediaGate(page);
    await pickAndSend(page, ['가짜 안내문.pdf']);
    const modal = page.locator('#documentModal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await modal.locator('[data-close="documentModal"]').click();
    await expect(modal).toBeHidden();
    await page.waitForTimeout(600);
    expect(gate.seen).toEqual([]);
    expect(lib.uploads).toEqual([]);
    expect(errors).toEqual([]);
  });
}
