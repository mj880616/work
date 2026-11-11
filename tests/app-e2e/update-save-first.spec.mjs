import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { openWriteFromEntry } from './helpers/write-opener.mjs';
import { typeInto } from './helpers/note-editor.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// BIZ-저장먼저닫기 2차(S59-10, 요청함 11/11 07:01 '같은 종류 전수'): basket-files로 올리는 업데이트 저장 3곳 —
// 빠른 입력칸 업데이트 [추가] · 업데이트 큰 창 [저장] · 조직 상세 [기록] 입력칸 [저장].
// [저장]·[추가]를 누르면 글이 먼저 업데이트로 저장(·연결)되고 입력칸·창이 바로 풀리거나 닫힌다. 고른 파일은 그 업데이트의 뒤 줄에서 끝까지
// 올라가고(화면을 옮겨도), 하단바 위 한 줄이 묶음 전체 진행 → '<곳>에 사진 n장·파일 n개 올렸어요'. 못 올린 것은 그 한 줄에 [다시 올리기]
// (못 올린 것만, 같은 업데이트로). 글 저장이 실패하면 창·입력칸을 그대로 두고 아무것도 보내지 않는다.
// 합성 데이터(가짜 이름·가짜 파일), 폰 412 · PC 1280. CAPTURE_DIR가 있으면 화면 사진을 남긴다(docs/design/screens/s59-10/).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch: true});
const at = '2026-10-06T01:00:00Z';
const SHOTS = process.env.CAPTURE_DIR || '';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png = name => ({name, mimeType: 'image/png', buffer: PNG});
const pdf = name => ({name, mimeType: 'application/pdf', buffer: Buffer.alloc(64 * 1024, 1)});
const quick = page => page.locator('#homeView [data-home-quick]');
const dock = page => page.locator('#uploadDock:not([hidden])');
const noFrameWidth = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function fixture(page, width, {postFails = false} = {}) {
  await page.setViewportSize({width, height: 900});
  const notes = [], writes = [], uploads = [], links = [], patches = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  let stamp = 10, open = null, gate = Promise.resolve(), fail = () => false;
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method();
    if (method === 'GET') { const id = q.get('id'); return r.fulfill({json: (id ? notes.filter(n => 'eq.' + n.id === id) : notes).map(n => structuredClone(n))}); }
    if (method === 'POST') {
      const body = req.postDataJSON(); writes.push({method, body});
      if (postFails) return r.fulfill({status: 500, json: {message: 'down'}});
      const row = {id: 'up-' + writes.length, kind: 'basket', occurred_at: at, created_at: at, updated_at: `2026-10-06T02:00:${String(stamp++).padStart(2, '0')}Z`, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}, ...body};
      notes.unshift(row); return r.fulfill({status: 201, json: [structuredClone(row)]});
    }
    return r.fallback();
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_record_links', r => r.request().method() === 'GET' ? r.fulfill({json: []}) : r.fallback());
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_basket_confirm_links', r => { links.push(r.request().postDataJSON()); return r.fulfill({json: {ok: true, created: 1, existing: 0}}); });
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/document-actions', r => { const b = r.request().postDataJSON(); return r.fulfill({json: {ok: true, result: 'created', document: {id: 'doc-' + b.drive_file_id, title: '합성 자료'}}}); });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_documents', r => {
    if (r.request().method() !== 'PATCH') return r.fallback();
    const id = new URL(r.request().url()).searchParams.get('id').slice(3), b = r.request().postDataJSON(); patches.push({id, organization_id: b.organization_id, project_id: b.project_id});
    return r.fulfill({json: [{id, project_id: b.project_id ?? null, organization_id: b.organization_id ?? null, file_id: id.slice(4)}]});
  });
  // basket-files: gate()가 열릴 때까지 잡아 두었다가, fail(이름)이면 다시 보내도 되는 거절(400), 아니면 그 업데이트에 붙인다(note_id가 없으면 첫 파일이 업데이트를 만든다 — 진짜 함수처럼).
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/basket-files', async r => {
    const req = r.request();
    if (req.method() === 'GET') {
      const action = new URL(req.url()).searchParams.get('action');
      if (action === 'photo') return r.fulfill({status: 200, contentType: 'image/png', body: PNG});
      return r.fulfill({json: {ok: false, code: 'OCR_UNSUPPORTED'}});
    }
    const raw = req.postDataBuffer()?.toString('latin1') || '';
    const noteId = raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1] || null, name = Buffer.from(raw.match(/filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8'), type = raw.match(/Content-Type: ([^\r]+)/)?.[1];
    uploads.push({noteId, name});
    await gate;
    if (fail(name)) return r.fulfill({status: 400, json: {error: '첨부를 저장하지 못했어요.', code: 'bad_file'}});
    let row = noteId ? notes.find(n => n.id === noteId) : null;
    if (noteId && !row) return r.fulfill({status: 404, json: {error: '없음', code: 'note_not_found'}});
    if (!row) { row = {id: 'made-' + uploads.length, kind: 'basket', raw_text: '', occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}}; notes.unshift(row); }
    row.attachments = [...row.attachments, {drive_file_id: 'drv' + uploads.length, file_name: name, mime_type: type || 'application/octet-stream', size_bytes: 4}];
    row.updated_at = `2026-10-06T03:00:${String(stamp++).padStart(2, '0')}Z`;
    return r.fulfill({json: {ok: true, note_id: row.id, attachments: row.attachments}});
  });
  return {notes, writes, uploads, links, patches, errors,
    hold() { gate = new Promise(resolve => { open = resolve; }); },
    release() { open?.(); },
    failWhen(fn) { fail = fn; }};
}

for (const width of [412, 1280]) {
  test(`빠른 입력칸 업데이트 [추가]: 글이 저장되면 입력칸이 바로 풀리고, 사진·파일은 다른 화면으로 가도 그 업데이트로 끝까지 올라간다 ${width}`, async ({page}) => {
    const f = await fixture(page, width), q = quick(page);
    f.hold();
    await q.locator('[data-quick-input]').fill('현장 점검 소식');
    await q.locator('input[type=file]').setInputFiles([png('현장 사진.png'), pdf('점검표.pdf')]);
    await q.locator('[data-quick-save]').click();
    // 글이 먼저 업데이트로 저장되고 입력칸은 바로 풀린다(올리는 동안 잠그지 않음).
    await expect(page.locator('#toast')).toHaveText('잊지 말기에 저장했어요. 사진·파일은 올리는 중이에요.');
    await expect(q.locator('[data-quick-input]')).toHaveValue('');
    await expect(q.locator('[data-quick-input]')).toBeEditable();
    await expect(q.locator('[data-quick-save]')).toBeEnabled();
    await expect(q.locator('[data-basket-file]')).toHaveCount(0);
    expect(f.writes).toEqual([{method: 'POST', body: expect.objectContaining({raw_text: '현장 점검 소식'})}]);
    await expect.poll(() => f.uploads.length).toBe(1);
    await expect(dock(page)).toContainText('2개 올리는 중');
    expect(await noFrameWidth(page)).toBe(true);
    if (SHOTS) await page.screenshot({path: `${SHOTS}/quick-saving-${width}.png`});
    // 다른 화면으로 옮겨도 멈추지 않는다(예전에는 화면을 옮기면 멈췄다).
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await expect(page.locator('#basketView')).toBeVisible();
    f.release();
    await expect.poll(() => f.uploads).toEqual([{noteId: 'up-1', name: '현장 사진.png'}, {noteId: 'up-1', name: '점검표.pdf'}]);
    await expect(dock(page)).toContainText('업데이트에 사진 1장·파일 1개 올렸어요');
    if (SHOTS) await page.screenshot({path: `${SHOTS}/quick-done-${width}.png`});
    expect(f.notes.find(n => n.id === 'up-1').attachments).toHaveLength(2);
    await expect(page.locator('[data-basket-row-item="up-1"]')).toContainText('첨부 2개');
    expect(f.errors).toEqual([]);
  });

  test(`빠른 입력칸 업데이트: 못 올린 파일은 하단 한 줄에 남고 [다시 올리기]는 못 올린 것만 같은 업데이트로 보낸다 ${width}`, async ({page}) => {
    const f = await fixture(page, width), q = quick(page);
    f.failWhen(name => name === '두번째.pdf');
    await q.locator('[data-quick-input]').fill('자료 모음');
    await q.locator('input[type=file]').setInputFiles([pdf('첫번째.pdf'), pdf('두번째.pdf')]);
    await q.locator('[data-quick-save]').click();
    await expect(q.locator('[data-quick-input]')).toHaveValue('');
    const line = dock(page);
    await expect(line).toContainText('업데이트에 파일 1개 못 올렸어요');
    await expect(line.locator('.up-dock-note')).toContainText('파일 1개 올렸어요');
    const again = line.getByRole('button', {name: '못 올린 파일 다시 올리기'});
    await expect(again).toHaveText('다시 올리기');
    // 누를 때까지 남는다.
    await page.waitForTimeout(6500); await expect(again).toBeVisible();
    expect(await noFrameWidth(page)).toBe(true);
    if (SHOTS) await page.screenshot({path: `${SHOTS}/quick-fail-${width}.png`});
    f.failWhen(() => false);
    await again.click();
    await expect(dock(page)).toContainText('업데이트에 파일 1개 올렸어요');
    expect(f.uploads).toEqual([{noteId: 'up-1', name: '첫번째.pdf'}, {noteId: 'up-1', name: '두번째.pdf'}, {noteId: 'up-1', name: '두번째.pdf'}]);
    expect(f.notes.find(n => n.id === 'up-1').attachments.map(a => a.file_name)).toEqual(['첫번째.pdf', '두번째.pdf']);
    expect(f.writes).toHaveLength(1); // 업데이트는 한 번만 만든다
    expect(f.errors).toEqual([]);
  });

  test(`업데이트 큰 창 [저장]: 창이 바로 닫히고 [📎 첨부]는 그 업데이트로 뒤에서 올라가 고른 곳 자료로 들어간다 ${width}`, async ({page}) => {
    const f = await fixture(page, width);
    f.hold();
    await openWriteFromEntry(page, width);
    const win = page.locator('#edWindow'); await expect(win).toBeVisible();
    await typeInto(page, win.locator('.ed-window-body .ProseMirror'), '교섭 경과 기록');
    await page.locator('#edwUpdateAttach').setInputFiles([png('교섭 사진.png')]);
    await win.locator('[data-edw-place]').click();
    const sheet = page.locator('#edwPlaceSheet');
    await sheet.locator('[data-sheet-all]').getByRole('button', {name: '테스트 조직', exact: true}).first().click();
    await sheet.getByRole('button', {name: '저장', exact: true}).click();
    await win.locator('[data-edw-save]').click();
    // 글이 저장·연결되면 창은 올리기를 기다리지 않고 닫힌다.
    await expect(win).toHaveCount(0);
    await expect(page.locator('#toast')).toContainText('테스트 조직 기록에 저장했어요. 사진·파일은 올리는 중이에요.');
    expect(f.writes).toHaveLength(1); expect(f.writes[0].body.raw_text).toBe('교섭 경과 기록');
    expect(f.links.map(l => [l.p_note_id, l.p_targets.map(t => t.target_id)])).toEqual([['up-1', ['o']]]);
    await expect(dock(page)).toContainText('올리는 중');
    expect(await noFrameWidth(page)).toBe(true);
    if (SHOTS) await page.screenshot({path: `${SHOTS}/window-saving-${width}.png`});
    // 다른 화면으로 옮겨도 이어진다.
    await page.evaluate(() => window.KPTURouter.go('basket'));
    f.release();
    await expect(dock(page)).toContainText('테스트 조직 기록에 사진 1장 올렸어요');
    expect(f.uploads).toEqual([{noteId: 'up-1', name: '교섭 사진.png'}]);
    await expect.poll(() => f.patches).toEqual([{id: 'doc-drv1', organization_id: 'o', project_id: undefined}]);
    expect(f.errors).toEqual([]);
  });

  test(`조직 기록 입력칸 [저장]: 글이 기록으로 이어지면 입력칸이 바로 비고, 사진은 다른 화면으로 가도 끝까지 올라가 조직 자료로 들어간다 ${width}`, async ({page}) => {
    const f = await fixture(page, width);
    await clickView(page, 'team'); await page.locator('[data-so-org="o"]').first().click();
    await expect(page.locator('#wdModal')).toBeVisible();
    await expect(page.locator('#wdInboxClip [data-basket-clip]')).toBeVisible();
    f.hold();
    await page.locator('#wdInboxText').fill('지부 간담회 기록');
    await page.locator('#wdInboxAttach').setInputFiles([png('간담회 사진.png'), pdf('간담회 자료.pdf')]);
    await expect(page.locator('#wdInboxFiles [data-basket-file]')).toHaveCount(2);
    await page.locator('#wdInboxSave').click();
    await expect(page.locator('#wdInboxState')).toHaveText('저장했어요. 사진·파일은 올리는 중이에요.');
    await expect(page.locator('#wdInboxText')).toHaveValue('');
    await expect(page.locator('#wdInboxFiles [data-basket-file]')).toHaveCount(0);
    await expect(page.locator('#wdInboxSave')).toBeEnabled();
    expect(f.links.map(l => [l.p_note_id, l.p_targets])).toEqual([['up-1', [{kind: 'organization', target_id: 'o', reason: '직접 연결'}]]]);
    await expect(dock(page)).toContainText('2개 올리는 중');
    expect(await noFrameWidth(page)).toBe(true);
    if (SHOTS) await page.screenshot({path: `${SHOTS}/org-saving-${width}.png`});
    // 다른 화면으로 옮겨도 이어진다.
    // (폰에서는 조직 상세가 겹 화면이라 옮기기가 잠깐 거절될 수 있다 — 옮겨질 때까지 다시 누른다.)
    await expect.poll(() => page.evaluate(() => { window.KPTURouter.go('home'); return window.KPTURouter.current; })).toBe('home');
    f.release();
    await expect(dock(page)).toContainText('테스트 조직 기록에 사진 1장·파일 1개 올렸어요');
    if (SHOTS) await page.screenshot({path: `${SHOTS}/org-done-${width}.png`});
    expect(f.uploads).toEqual([{noteId: 'up-1', name: '간담회 사진.png'}, {noteId: 'up-1', name: '간담회 자료.pdf'}]);
    await expect.poll(() => f.patches.map(p => [p.id, p.organization_id])).toEqual([['doc-drv1', 'o'], ['doc-drv2', 'o']]);
    expect(f.errors).toEqual([]);
  });
}

test('조직 기록 입력칸: 못 올린 파일은 [다시 올리기]로 못 올린 것만, 같은 업데이트로 (412)', async ({page}) => {
  const f = await fixture(page, 412);
  await clickView(page, 'team'); await page.locator('[data-so-org="o"]').first().click();
  await expect(page.locator('#wdInboxClip [data-basket-clip]')).toBeVisible();
  f.failWhen(name => name === '빠진 자료.pdf');
  await page.locator('#wdInboxText').fill('자료 두 개');
  await page.locator('#wdInboxAttach').setInputFiles([pdf('먼저 자료.pdf'), pdf('빠진 자료.pdf')]);
  await page.locator('#wdInboxSave').click();
  const again = dock(page).getByRole('button', {name: '못 올린 파일 다시 올리기'});
  await expect(dock(page)).toContainText('테스트 조직 기록에 파일 1개 못 올렸어요'); await expect(again).toBeVisible();
  if (SHOTS) await page.screenshot({path: `${SHOTS}/org-fail-412.png`});
  f.failWhen(() => false); await again.click();
  await expect(dock(page)).toContainText('테스트 조직 기록에 파일 1개 올렸어요');
  expect(f.uploads.map(u => [u.noteId, u.name])).toEqual([['up-1', '먼저 자료.pdf'], ['up-1', '빠진 자료.pdf'], ['up-1', '빠진 자료.pdf']]);
  // 자료로 넣기는 올라간 파일마다 한 번씩(다시 올린 것도).
  await expect.poll(() => f.patches.map(p => p.id)).toEqual(['doc-drv1', 'doc-drv3']);
  expect(f.writes).toHaveLength(1);
});

test('파일만(글 없음) 큰 창 [저장]: 기다릴 글이 없어 창이 바로 닫히고, 첫 파일이 뒤에서 업데이트를 만든다 (412)', async ({page}) => {
  const f = await fixture(page, 412);
  await openWriteFromEntry(page, 412);
  const win = page.locator('#edWindow'); await expect(win).toBeVisible();
  await page.locator('#edwUpdateAttach').setInputFiles([pdf('받은 공문.pdf')]);
  await win.locator('[data-edw-save]').click();
  await expect(win).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('사진·파일을 올리는 중이에요.');
  await expect(dock(page)).toContainText('업데이트에 파일 1개 올렸어요');
  expect(f.writes).toEqual([]);
  expect(f.uploads).toEqual([{noteId: null, name: '받은 공문.pdf'}]);
});

test('글 저장이 실패하면 업데이트 큰 창은 닫히지 않고 파일도 보내지 않는다 (412)', async ({page}) => {
  const f = await fixture(page, 412, {postFails: true});
  await openWriteFromEntry(page, 412);
  const win = page.locator('#edWindow'); await expect(win).toBeVisible();
  await typeInto(page, win.locator('.ed-window-body .ProseMirror'), '저장 실패 업데이트');
  await page.locator('#edwUpdateAttach').setInputFiles([pdf('남는 파일.pdf')]);
  await win.locator('[data-edw-save]').click();
  await expect(win.locator('.ed-window-status')).not.toHaveText('');
  await expect(win).toBeVisible();
  await expect(win.locator('[data-basket-file]')).toContainText('남는 파일.pdf');
  expect(f.uploads).toEqual([]);
  expect(f.writes).toHaveLength(1);
});

test('글 저장이 실패하면 빠른 입력칸·조직 기록 입력칸은 글과 파일을 그대로 두고 아무것도 보내지 않는다 (412)', async ({page}) => {
  const f = await fixture(page, 412, {postFails: true}), q = quick(page);
  await q.locator('[data-quick-input]').fill('저장 실패');
  await q.locator('input[type=file]').setInputFiles([pdf('남는 파일.pdf')]);
  await q.locator('[data-quick-save]').click();
  await expect(q.locator('[data-quick-status]')).not.toHaveText('');
  await expect(q.locator('[data-quick-input]')).toHaveValue('저장 실패');
  await expect(q.locator('[data-basket-file]')).toContainText('남는 파일.pdf');
  await clickView(page, 'team'); await page.locator('[data-so-org="o"]').first().click();
  await expect(page.locator('#wdInboxClip [data-basket-clip]')).toBeVisible();
  await page.locator('#wdInboxText').fill('기록 저장 실패');
  await page.locator('#wdInboxAttach').setInputFiles([pdf('남는 기록 파일.pdf')]);
  await page.locator('#wdInboxSave').click();
  await expect(page.locator('#wdInboxState')).toHaveClass(/error/);
  await expect(page.locator('#wdInboxText')).toHaveValue('기록 저장 실패');
  await expect(page.locator('#wdInboxFiles [data-basket-file]')).toContainText('남는 기록 파일.pdf');
  expect(f.uploads).toEqual([]);
  expect(f.writes).toHaveLength(2);
});
