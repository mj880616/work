import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { edWin } from './helpers/note-editor.mjs';
// BIZ-저장먼저닫기 2차(S59-8, 요청함 11/11 07:01 '같은 종류 전수'): basket-files로 올리는 새 노트 저장 — 빠른 입력칸 [추가] · 새 노트 큰 창 [저장].
// [저장]을 누르면 글(노트)이 먼저 저장되고 입력칸·창이 바로 풀리거나 닫힌다. 고른 파일은 그 노트의 뒤 줄에서 끝까지 올라가고(화면을 옮겨도),
// 하단바 위 한 줄이 묶음 전체 진행 → '노트에 파일 n개 올렸어요'. 못 올린 것은 그 한 줄에 [다시 올리기](못 올린 것만). 글 저장이 실패하면 창을 닫지 않고 아무것도 보내지 않는다.
// 합성 데이터(가짜 이름·가짜 파일), 폰 412 · PC 1280.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch: true});
const at = '2026-11-11T01:00:00Z';
const SHOTS = process.env.CAPTURE_DIR || '';
async function fixture(page, width, {postFails = false} = {}) {
  await page.setViewportSize({width, height: 900});
  const notes = [{id: 'n-old', workspace_id: 'w', kind: 'note', title: '예전 노트', raw_text: '본문', occurred_at: at, created_at: at, updated_at: '2026-11-11T02:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}, doc: null}];
  const writes = [], uploads = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  let stamp = 10, open = null, gate = Promise.resolve(), fail = () => false;
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method();
    const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + row.updated_at === q.get('updated_at'));
    if (method === 'GET') { if (q.get('metadata')) return r.fulfill({json: []}); return r.fulfill({json: notes.filter(pick).map(x => structuredClone(x))}); }
    if (method === 'POST') {
      const body = req.postDataJSON(); writes.push({method, body});
      if (postFails) return r.fulfill({status: 500, json: {message: 'down'}});
      const row = {id: 'new-' + writes.length, occurred_at: at, created_at: at, updated_at: `2026-11-11T04:00:${String(stamp++).padStart(2, '0')}Z`, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}, doc: null, ...body};
      notes.unshift(row); return r.fulfill({status: 201, json: [row]});
    }
    if (method === 'PATCH') { const body = req.postDataJSON(); writes.push({method, query: Object.fromEntries(q), body}); const hit = notes.filter(pick); for (const row of hit) Object.assign(row, body); return r.fulfill({json: hit.map(x => structuredClone(x))}); }
    return r.fulfill({status: 500, json: {}});
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({json: []}) : r.fallback());
  await page.route(SB + '/functions/v1/note-ai-title**', r => r.fulfill({json: {ok: true}}));
  // basket-files: gate()가 열릴 때까지 잡아 두었다가, fail(이름)이면 다시 보내도 되는 거절(400), 아니면 그 노트에 붙인다(진짜 함수처럼).
  await page.route(SB + '/functions/v1/basket-files**', async r => {
    const raw = r.request().postDataBuffer()?.toString('latin1') || '';
    const noteId = raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1], name = Buffer.from(raw.match(/filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8'), type = raw.match(/Content-Type: ([^\r]+)/)?.[1];
    uploads.push({noteId, name});
    await gate;
    if (fail(name)) return r.fulfill({status: 400, json: {error: '첨부를 저장하지 못했어요.', code: 'bad_file'}});
    const row = notes.find(n => n.id === noteId);
    if (!row) return r.fulfill({status: 404, json: {error: '없음', code: 'note_not_found'}});
    row.attachments = [...row.attachments, {drive_file_id: 'up_' + uploads.length, file_name: name, mime_type: type || 'application/octet-stream', size_bytes: 4}];
    row.updated_at = `2026-11-11T05:00:${String(stamp++).padStart(2, '0')}Z`;
    return r.fulfill({json: {ok: true, note_id: row.id, attachments: row.attachments}});
  });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await openKindMenu(page, 'note'); const kind = basketKindButton(page, 'note'); await expect(kind).toBeVisible(); await kind.click();
  await expect(page.locator('[data-note-row="n-old"]')).toBeVisible();
  return {notes, writes, uploads, errors,
    hold() { gate = new Promise(resolve => { open = resolve; }); },
    release() { open?.(); },
    failWhen(fn) { fail = fn; }};
}
const pdf = name => ({name, mimeType: 'application/pdf', buffer: Buffer.alloc(64 * 1024, 1)});
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png = name => ({name, mimeType: 'image/png', buffer: PNG});
const bar = page => page.locator('[data-note-list] [data-home-quick]');
const dock = page => page.locator('#uploadDock:not([hidden])');
const noFrameWidth = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [412, 1280]) {
  test(`빠른 입력칸 노트 [추가]: 글이 저장되면 입력칸이 바로 풀리고, 파일은 다른 화면으로 가도 그 노트로 끝까지 올라간다 ${width}`, async ({page}) => {
    const f = await fixture(page, width);
    f.hold();
    await bar(page).locator('input[type=file]').setInputFiles([png('현장 사진.png'), pdf('점검표.pdf')]);
    await bar(page).locator('[data-quick-input]').fill('현장 점검 메모');
    await bar(page).locator('[data-quick-save]').click();
    // 글(노트)이 먼저 저장되고 입력칸은 바로 풀린다(올리는 동안 잠그지 않음).
    await expect(page.locator('#toast')).toHaveText('노트를 추가했어요. 사진·파일은 올리는 중이에요.');
    await expect(bar(page).locator('[data-quick-input]')).toHaveValue('');
    await expect(bar(page).locator('[data-quick-input]')).toBeEnabled();
    await expect(bar(page).locator('[data-quick-save]')).toBeEnabled();
    await expect(bar(page).locator('[data-basket-file]')).toHaveCount(0);
    await expect.poll(() => f.uploads.length).toBe(1);
    expect(f.writes[0].body).toMatchObject({kind: 'note', title: '현장 점검 메모', raw_text: '현장 점검 메모'});
    // 묶음 전체가 하단바 위 한 줄에서 끝까지(차례를 기다리는 파일도 센다).
    await expect(dock(page)).toContainText('2개 올리는 중');
    expect(await noFrameWidth(page)).toBe(true);
    if (SHOTS) await page.screenshot({path: `${SHOTS}/note-quick-saving-${width}.png`});
    // 다른 화면으로 옮겨도 멈추지 않는다.
    await page.evaluate(() => window.KPTURouter.go('home'));
    await expect(page.locator('#homeView')).toBeVisible();
    f.release();
    await expect.poll(() => f.uploads).toEqual([{noteId: 'new-1', name: '현장 사진.png'}, {noteId: 'new-1', name: '점검표.pdf'}]);
    await expect(dock(page)).toContainText('노트에 사진 1장·파일 1개 올렸어요');
    if (SHOTS) await page.screenshot({path: `${SHOTS}/note-quick-done-${width}.png`});
    expect(f.notes.find(n => n.id === 'new-1').attachments).toHaveLength(2);
    // 돌아가면 그 노트 줄에 첨부가 붙어 있다.
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await expect(page.locator('[data-note-row="new-1"] .nx-clip')).toHaveAttribute('aria-label', '첨부 2개');
    expect(f.errors).toEqual([]);
  });

  test(`빠른 입력칸 노트: 못 올린 파일은 하단 한 줄에 남고 [다시 올리기]는 못 올린 것만 같은 노트로 보낸다 ${width}`, async ({page}) => {
    const f = await fixture(page, width);
    f.failWhen(name => name === '두번째.pdf');
    await bar(page).locator('input[type=file]').setInputFiles([pdf('첫번째.pdf'), pdf('두번째.pdf')]);
    await bar(page).locator('[data-quick-input]').fill('자료 모음');
    await bar(page).locator('[data-quick-save]').click();
    await expect(bar(page).locator('[data-quick-input]')).toHaveValue('');
    const line = dock(page);
    await expect(line).toContainText('노트에 파일 1개 못 올렸어요');
    await expect(line.locator('.up-dock-note')).toContainText('파일 1개 올렸어요');
    const again = line.getByRole('button', {name: '못 올린 파일 다시 올리기'});
    await expect(again).toHaveText('다시 올리기');
    // 누를 때까지 남는다(창은 이미 닫혀 있어 못 올린 줄 모르고 지나가지 않게).
    await page.waitForTimeout(6500); await expect(again).toBeVisible();
    expect(await noFrameWidth(page)).toBe(true);
    if (SHOTS) await page.screenshot({path: `${SHOTS}/note-quick-fail-${width}.png`});
    f.failWhen(() => false);
    await again.click();
    await expect(dock(page)).toContainText('노트에 파일 1개 올렸어요');
    expect(f.uploads).toEqual([{noteId: 'new-1', name: '첫번째.pdf'}, {noteId: 'new-1', name: '두번째.pdf'}, {noteId: 'new-1', name: '두번째.pdf'}]);
    expect(f.notes.find(n => n.id === 'new-1').attachments.map(a => a.file_name)).toEqual(['첫번째.pdf', '두번째.pdf']);
    expect(f.writes.filter(w => w.method === 'POST')).toHaveLength(1); // 노트는 한 번만 만든다
    expect(f.errors).toEqual([]);
  });

  test(`새 노트 큰 창 [저장]: 창이 바로 닫히고 [📎 첨부]는 그 노트로 뒤에서 올라간다 ${width}`, async ({page}) => {
    const f = await fixture(page, width);
    f.hold();
    await bar(page).locator('[data-quick-input]').fill('큰 창 노트');
    await bar(page).locator('[data-quick-big]').click();
    const win = edWin(page); await expect(win).toBeVisible();
    await win.locator('#edwNoteAttach').setInputFiles([pdf('붙임.pdf')]);
    await expect(win.locator('[data-basket-file]')).toContainText('붙임.pdf');
    await win.locator('[data-edw-save]').click();
    // 글이 저장되면 창은 올리기를 기다리지 않고 닫힌다.
    await expect(edWin(page)).toHaveCount(0);
    await expect(page.locator('#toast')).toContainText('노트로 저장했어요. 사진·파일은 올리는 중이에요.');
    await expect.poll(() => f.uploads.length).toBe(1);
    expect(f.writes[0].body).toMatchObject({kind: 'note', title: '큰 창 노트'});
    // 그 노트가 열려도 올리는 중에는 그 노트를 바꾸는 일(고정 등)은 올라간 뒤에 한다(같은 줄 — 노트 화면의 잠금 그대로).
    await expect(dock(page)).toContainText('올리는 중');
    if (SHOTS) await page.screenshot({path: `${SHOTS}/note-window-saving-${width}.png`});
    f.release();
    await expect(dock(page)).toContainText('노트에 파일 1개 올렸어요');
    expect(f.uploads).toEqual([{noteId: 'new-1', name: '붙임.pdf'}]);
    await expect(page.locator('[data-note-detail] [data-note-attachments] .file-line')).toHaveCount(1);
    expect(f.errors).toEqual([]);
  });
}

test('글 저장이 실패하면 큰 창은 닫히지 않고 파일도 보내지 않는다 (412)', async ({page}) => {
  const f = await fixture(page, 412, {postFails: true});
  await bar(page).locator('[data-quick-big]').click();
  const win = edWin(page); await expect(win).toBeVisible();
  await win.locator('#edwNoteAttach').setInputFiles([pdf('남는 파일.pdf')]);
  await win.locator('.ed-window-body .ProseMirror').click(); await page.keyboard.insertText('저장 실패 노트');
  await win.locator('[data-edw-save]').click();
  await expect(win.locator('.ed-window-status')).not.toHaveText('');
  await expect(win).toBeVisible();
  await expect(win.locator('[data-basket-file]')).toContainText('남는 파일.pdf');
  expect(f.uploads).toEqual([]);
  expect(f.writes.filter(w => w.method === 'POST')).toHaveLength(1);
});

test('글 저장이 실패하면 빠른 입력칸은 글과 파일을 그대로 두고 아무것도 보내지 않는다 (412)', async ({page}) => {
  const f = await fixture(page, 412, {postFails: true});
  await bar(page).locator('input[type=file]').setInputFiles([pdf('남는 파일.pdf')]);
  await bar(page).locator('[data-quick-input]').fill('저장 실패');
  await bar(page).locator('[data-quick-save]').click();
  await expect(bar(page).locator('[data-quick-status]')).not.toHaveText('');
  await expect(bar(page).locator('[data-quick-input]')).toHaveValue('저장 실패');
  await expect(bar(page).locator('[data-basket-file]')).toContainText('남는 파일.pdf');
  expect(f.uploads).toEqual([]);
});
