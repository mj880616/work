import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { expectNoteTitle } from './helpers/note-title.mjs';
import { noteTrash } from './helpers/note-trash.mjs';
import { answerAsk } from './helpers/small-notice.mjs';
// NOTE-파일붙이기 (2026-10-22 사용자 결정): files on notes.
// - The note input bar has the clip ([📎]); [추가] makes the note first, then its files go up with its id (basket-files, which puts
//   them in Drive "노트 첨부"). A note of files only is titled by the first file's name.
// - The big editor (크게 쓰기) has [📎 첨부] at the end of the format button row; its save sends the chosen files with the note id.
// - Files show under the note body as the existing file cards (type · name · size · [Drive에서 열기]) with a ⋯ → [빼기] that takes
//   the link off the note only (no Drive request). A note with files and no body shows only the cards, no "본문이 없는 노트입니다.".
// - Deleting a note removes the row (owner RLS) and keeps its files in Drive (no server trash call).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch: true});
const at = '2026-10-22T01:00:00Z';
const pdf = (id, name, size = 2048) => ({drive_file_id: id, file_name: name, mime_type: 'application/pdf', size_bytes: size});
function rows() {
  const row = (id, title, raw_text, attachments, updated) => ({id, workspace_id: 'w', kind: 'note', title, raw_text, occurred_at: at, created_at: at, updated_at: updated, archived_at: null, ai_export_allowed: true, attachments, metadata: {}});
  return [
    row('n-files', '자료만 있는 노트', '', [pdf('drive_a', '교섭 요구안.pdf', 2048), {drive_file_id: 'drive_b', file_name: '회의록.hwp', mime_type: 'application/x-hwp', size_bytes: 3 * 1048576}], '2026-10-22T03:00:00Z'),
    row('n-text', '글 노트', '본문 첫 줄', [], '2026-10-22T02:00:00Z'),
    row('n-empty', '빈 노트', '', [], '2026-10-22T01:00:00Z'),
  ];
}
async function fixture(page, width) {
  await page.setViewportSize({width, height: 900});
  const notes = rows(), writes = [], uploads = [], functions = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await openHome(page);
  const trash = await noteTrash(page, SB);
  let stamp = 10;
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method();
    const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + row.updated_at === q.get('updated_at'));
    if (method === 'GET') { if (q.get('metadata')) return r.fulfill({json: []}); return r.fulfill({json: notes.filter(pick).slice(Number(q.get('offset') || 0))}); }
    if (method === 'POST') {
      const body = req.postDataJSON(); writes.push({method, body});
      const row = {id: 'new-' + writes.length, occurred_at: at, created_at: at, updated_at: `2026-10-22T04:00:${String(stamp++).padStart(2, '0')}Z`, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}, ...body};
      notes.unshift(row); return r.fulfill({status: 201, json: [row]});
    }
    if (method === 'PATCH') {
      const body = req.postDataJSON(); writes.push({method, query: Object.fromEntries(q), body});
      const hit = notes.filter(pick); for (const row of hit) Object.assign(row, body);
      return r.fulfill({json: hit});
    }
    if (method === 'DELETE') { writes.push({method, query: Object.fromEntries(q)}); const hit = notes.filter(pick); for (const row of hit) { notes.splice(notes.indexOf(row), 1); trash.take(row, 0); } return r.fulfill({json: []}); }
    return r.fulfill({status: 500, json: {}});
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({json: []}) : r.fallback());
  // basket-files: the stored row gets the file (as the real function does with the note id it was sent).
  await page.route(SB + '/functions/v1/basket-files**', r => {
    const raw = r.request().postDataBuffer()?.toString('utf8') || '';
    functions.push(r.request().url());
    const noteId = raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1], name = raw.match(/filename="([^"]*)"/)?.[1];
    uploads.push({noteId, name, rawText: /name="raw_text"/.test(raw)});
    const row = notes.find(n => n.id === noteId);
    if (!row) return r.fulfill({status: 404, json: {error: '첨부를 저장하지 못했어요.', code: 'note_not_found'}});
    row.attachments = [...row.attachments, {drive_file_id: 'up_' + uploads.length, file_name: name, mime_type: 'application/pdf', size_bytes: 4}];
    row.updated_at = `2026-10-22T05:00:${String(stamp++).padStart(2, '0')}Z`;
    return r.fulfill({json: {ok: true, note_id: row.id, attachments: row.attachments}});
  });
  await page.route(SB + '/functions/v1/document-actions', r => { functions.push(r.request().url()); return r.fulfill({status: 500, json: {}}); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await openKindMenu(page,'note');await press(page, basketKindButton(page, 'note'), width);
  await expect(page.locator('[data-note-row="n-files"]')).toBeVisible();
  return {notes, writes, uploads, functions, errors, trash};
}
async function press(page, locator, width) {
  await expect(locator).toBeVisible();
  if (width < 761) await locator.tap(); else await locator.click();
}
const fileBuffer = name => ({name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF')});
const noFrameWidth = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [390, 1280]) {
  test(`note input clip: text + file adds the note, then the file with its id; files only is titled by the file ${width}`, async ({page}) => {
    const f = await fixture(page, width);
    const bar = page.locator('[data-note-list] [data-home-quick]'), clip = bar.locator('[data-quick-file-picker] .basket-clip');
    await expect(clip).toBeVisible(); await expect(clip).toHaveAccessibleName('파일 첨부');
    // 44px touch target, inside the docked bar on a phone / before [추가] on a PC.
    const box = await clip.boundingBox(); expect(box.height).toBeGreaterThanOrEqual(32);
    await bar.locator('input[type=file]').setInputFiles([fileBuffer('교섭 일정.pdf')]);
    await expect(bar.locator('[data-basket-file]')).toContainText('교섭 일정.pdf');
    await expect(clip.locator('[data-basket-count]')).toHaveText('1');
    await bar.locator('[data-quick-input]').fill('교섭 준비');
    if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-input-clip-${width}.png`});
    await press(page, bar.locator('[data-quick-save]'), width);
    await expect(page.locator('#toast')).toHaveText('노트를 추가했습니다.');
    expect(f.writes[0]).toEqual({method: 'POST', body: {workspace_id: 'w', kind: 'note', title: '교섭 준비', raw_text: '교섭 준비', metadata: {markdown: false}}});
    expect(f.uploads).toEqual([{noteId: 'new-1', name: '교섭 일정.pdf', rawText: false}]);
    await expect(bar.locator('[data-quick-input]')).toHaveValue(''); await expect(bar.locator('[data-basket-file]')).toHaveCount(0);
    await expect(bar.locator('[data-quick-lock]')).toBeHidden();
    // NOTE-탐색기 ②: the one-line row marks files with 📎 (its name says how many).
    await expect(page.locator('[data-note-row="new-1"] .nx-clip')).toHaveAttribute('aria-label', '첨부 1개');
    // Files only: the first file's name is the title, the body stays empty.
    await bar.locator('input[type=file]').setInputFiles([fileBuffer('현장 사진 모음.pdf')]);
    await press(page, bar.locator('[data-quick-save]'), width);
    await expect.poll(() => f.uploads.length).toBe(2);
    await expect(bar.locator('[data-basket-file]')).toHaveCount(0);
    expect(f.writes[1].body).toEqual({workspace_id: 'w', kind: 'note', title: '현장 사진 모음.pdf', raw_text: '', metadata: {markdown: false}});
    expect(f.uploads[1]).toEqual({noteId: f.notes.find(n => n.title === '현장 사진 모음.pdf').id, name: '현장 사진 모음.pdf', rawText: false});
    expect(await noFrameWidth(page)).toBe(true);
    expect(f.errors).toEqual([]);
  });

  test(`a note of files only shows only the file cards; ⋯ → 빼기 takes the link off, Drive untouched ${width}`, async ({page}) => {
    const f = await fixture(page, width);
    await press(page, page.locator('[data-note-row="n-files"]'), width);
    const detail = page.locator('[data-note-detail]');
    await expectNoteTitle(page,'자료만 있는 노트');
    await expect(detail).not.toContainText('본문이 없는 노트입니다.');
    await expect(detail.locator('[data-basket-read-text]')).toBeHidden();
    const cards = detail.locator('[data-note-attachments] .file-line');
    await expect(cards).toHaveCount(2);
    // The existing card: type · name · size · [Drive에서 열기], then the ⋯.
    const first = cards.nth(0);
    await expect(first.locator('.file-kind')).toHaveText('PDF');
    await expect(first.locator('.file-line-main b')).toHaveText('교섭 요구안.pdf');
    await expect(first.locator('.file-line-main small')).toHaveText('2.0 KB');
    await expect(first.getByRole('link', {name: '교섭 요구안.pdf Drive에서 열기'})).toHaveAttribute('href', 'https://drive.google.com/file/d/drive_a/view');
    await expect(cards.nth(1).locator('.file-line-main small')).toHaveText('3.0 MB');
    const more = first.getByRole('button', {name: '교섭 요구안.pdf 메뉴'});
    const [lb, mb] = await Promise.all([first.getByRole('link').boundingBox(), more.boundingBox()]);
    expect(mb.x).toBeGreaterThanOrEqual(lb.x + lb.width - 1); expect(Math.abs((mb.y + mb.height / 2) - (lb.y + lb.height / 2))).toBeLessThan(4);
    expect(await more.evaluate(el => parseFloat(getComputedStyle(el, '::after').height))).toBe(44);
    expect(await noFrameWidth(page)).toBe(true);
    if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-file-cards-${width}.png`});
    // Cancel keeps it.
    await press(page, more, width); await press(page, page.locator('#noteDocMenu [data-note-file-detach]'), width);
    await answerAsk(page, false);
    await expect(cards).toHaveCount(2); expect(f.writes).toEqual([]);
    await expect(more).toBeFocused();
    await press(page, more, width);
    await expect(page.locator('#noteDocMenu button')).toHaveText(['Drive에서 열기', '내려받기', '빼기', '삭제']);
    await expect(page.locator('#noteDocMenu [data-note-file-detach]')).toHaveText('빼기');
    await press(page, page.locator('#noteDocMenu [data-note-file-detach]'), width);
    const asked = await answerAsk(page, true);
    await expect(page.locator('#toast')).toHaveText('파일을 노트에서 뺐어요. Drive에는 그대로 있어요.');
    expect(asked).toBe("'교섭 요구안.pdf' 파일을 이 노트에서 뺄까요?");
    await expect(cards).toHaveCount(1); await expect(cards.nth(0)).toContainText('회의록.hwp');
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].method).toBe('PATCH');
    expect(f.writes[0].query).toMatchObject({id: 'eq.n-files', kind: 'eq.note', workspace_id: 'eq.w', updated_at: 'eq.2026-10-22T03:00:00Z'});
    expect(Object.keys(f.writes[0].body).sort()).toEqual(['attachments', 'updated_at']);
    expect(f.writes[0].body.attachments.map(x => x.drive_file_id)).toEqual(['drive_b']);
    // The link only: no Edge, no Drive request.
    expect(f.functions).toEqual([]);
    // Last file off: the note still shows no "no body" box until the files are gone; then it says so.
    await press(page, cards.nth(0).getByRole('button', {name: '회의록.hwp 메뉴'}), width); await press(page, page.locator('#noteDocMenu [data-note-file-detach]'), width);
    await answerAsk(page, true);
    await expect(cards).toHaveCount(0);
    await expect(detail.locator('[data-basket-read-text]')).toHaveText('본문이 없는 노트입니다.');
    expect(f.errors).toEqual([]);
  });

  // FILE-첨부삭제: ⋯ [삭제] → 한 번 묻고 → document-actions trash-file(서버가 노트에서 떼고 Drive 원본 휴지통) → 다시 읽어 그림
  // → 화면 위 '삭제했어요 · [되돌리기]' → restore-file(휴지통에서 꺼내 다시 붙임). [빼기]는 위 시험 그대로.
  test(`⋯ → 삭제 asks once, sends trash-file, shows 삭제했어요 · 되돌리기, and 되돌리기 puts it back ${width}`, async ({page}) => {
    const f = await fixture(page, width), calls = [];
    const row = () => f.notes.find(n => n.id === 'n-files');
    let held = null;
    await page.route(SB + '/functions/v1/document-actions', async r => {
      const body = r.request().postDataJSON(); calls.push(body);
      const n = row();
      if (body.action === 'trash-file') {
        held = n.attachments.find(a => a.drive_file_id === body.drive_file_id);
        n.attachments = n.attachments.filter(a => a.drive_file_id !== body.drive_file_id); n.updated_at = '2026-10-22T06:00:00Z';
        return r.fulfill({json: {ok: true, detached: true, drive: 'trashed', target: 'note', id: n.id, drive_file_id: body.drive_file_id, note: {id: n.id, updated_at: n.updated_at}}});
      }
      n.attachments = [...n.attachments, held]; n.updated_at = '2026-10-22T07:00:00Z';
      return r.fulfill({json: {ok: true, restored: true, target: 'note', id: n.id, drive_file_id: body.drive_file_id, note: {id: n.id, updated_at: n.updated_at}}});
    });
    await press(page, page.locator('[data-note-row="n-files"]'), width);
    const cards = page.locator('[data-note-detail] [data-note-attachments] .file-line');
    await expect(cards).toHaveCount(2);
    const more = cards.nth(0).getByRole('button', {name: '교섭 요구안.pdf 메뉴'});
    await press(page, more, width);
    await expect(page.locator('#noteDocMenu [data-note-file-delete]')).toHaveText('삭제');
    if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-file-menu-${width}.png`});
    // Cancel: nothing sent.
    await press(page, page.locator('#noteDocMenu [data-note-file-delete]'), width);
    await answerAsk(page, false);
    expect(calls).toEqual([]); await expect(cards).toHaveCount(2);
    await press(page, more, width); await press(page, page.locator('#noteDocMenu [data-note-file-delete]'), width);
    const asked = await answerAsk(page, true);
    expect(asked).toBe("'교섭 요구안.pdf' 파일을 삭제할까요?");
    await expect(cards).toHaveCount(1); await expect(cards.nth(0)).toContainText('회의록.hwp');
    expect(calls).toEqual([{action: 'trash-file', target: 'note', id: 'n-files', drive_file_id: 'drive_a'}]);
    const notice = page.locator('[data-undo-notice]');
    await expect(notice.locator('[data-undo-text]')).toHaveText('삭제했어요');
    if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-file-deleted-${width}.png`});
    // The note row itself is not written by the screen (the server did it); no basket-files call either.
    expect(f.writes).toEqual([]); expect(f.uploads).toEqual([]);
    await press(page, notice.locator('[data-undo-action]'), width);
    await expect(cards).toHaveCount(2);
    expect(calls[1]).toEqual({action: 'restore-file', target: 'note', id: 'n-files', drive_file_id: 'drive_a'});
    await expect(notice.locator('[data-undo-text]')).toHaveText('되돌렸어요');
    expect(await noFrameWidth(page)).toBe(true);
    expect(f.errors).toEqual([]);
  });

  test(`⋯ → 삭제 of a file this app did not make: taken off only, said in one line, no 되돌리기 ${width}`, async ({page}) => {
    const f = await fixture(page, width);
    await page.route(SB + '/functions/v1/document-actions', r => {
      const n = f.notes.find(x => x.id === 'n-files'); n.attachments = n.attachments.filter(a => a.drive_file_id !== 'drive_a');
      return r.fulfill({json: {ok: true, detached: true, drive: 'not_ours', target: 'note', id: 'n-files', drive_file_id: 'drive_a', note: {id: 'n-files', updated_at: n.updated_at}}});
    });
    await press(page, page.locator('[data-note-row="n-files"]'), width);
    const cards = page.locator('[data-note-detail] [data-note-attachments] .file-line');
    await press(page, cards.nth(0).getByRole('button', {name: '교섭 요구안.pdf 메뉴'}), width);
    await press(page, page.locator('#noteDocMenu [data-note-file-delete]'), width);
    await answerAsk(page, true);
    await expect(cards).toHaveCount(1);
    await expect(page.locator('#toast')).toHaveText('빼기만 했어요. 이 앱이 만든 파일이 아니라 Drive에는 그대로 있어요.');
    await expect(page.locator('[data-undo-notice]')).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });

  test(`big editor: [📎 첨부] under the text; save sends the file with the note id and shows its card ${width}`, async ({page}) => {
    const f = await fixture(page, width);
    await press(page, page.locator('[data-note-row="n-text"]'), width);
    await noteMenuAction(page, 'data-note-edit', {width});
    await expect(page.locator('[data-note-detail] [data-note-body-field] .ProseMirror')).toBeVisible();
    await press(page, page.locator('[data-note-big-write]'), width);
    // ED③ 노트: the note's new big window. [📎 첨부] is the row under the text (the new editor's format row has no file button).
    const e = page.locator('#edWindow'); await expect(e).toBeVisible();
    const row = e.locator('[data-edw-attach]'), clip = row.getByRole('button', {name: '파일 첨부', exact: true});
    await expect(clip).toBeVisible();
    const cb = await clip.boundingBox();
    expect(cb.height).toBe(32);
    expect(await clip.evaluate(el => parseFloat(getComputedStyle(el, '::after').height))).toBe(44);
    const chooser = page.waitForEvent('filechooser'); await clip.click(); await (await chooser).setFiles([fileBuffer('참고 자료.pdf')]);
    await expect(clip.locator('[data-basket-count]')).toHaveText('1');
    await expect(row.locator('[data-basket-file]')).toContainText('참고 자료.pdf');
    expect(await noFrameWidth(page)).toBe(true);
    if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-big-editor-clip-${width}.png`});
    await e.locator('[data-edw-save]').click();
    await expect(e.locator('.ed-window-status')).toHaveText('첨부를 저장했어요');
    expect(f.uploads).toEqual([{noteId: 'n-text', name: '참고 자료.pdf', rawText: false}]);
    // Text was not changed: no text write; the window stays and its chosen-file list empties.
    expect(f.writes.filter(w => w.method !== 'GET')).toEqual([]);
    await expect(clip.locator('[data-basket-count]')).toBeHidden();
    // ✕ closes without asking (nothing left unsaved) and, as after any save there (NOTE-큰창저장유지), back to the read view
    // with the new card under the note.
    await e.locator('[data-close="edWindow"]').click(); await expect(page.locator('#edWindow')).toHaveCount(0);
    await expect(page.locator('[data-note-editor]')).toBeHidden();
    const cards = page.locator('[data-note-detail] [data-note-attachments] .file-line');
    await expect(cards).toHaveCount(1); await expect(cards.nth(0)).toContainText('참고 자료.pdf');
    await expect(page.locator('[data-note-detail] [data-basket-read-text]')).toContainText('본문 첫 줄');
    expect(f.errors).toEqual([]);
  });

  test(`deleting a note moves it to the trash and keeps its files in Drive: owner-RLS delete only, the confirmation says so ${width}`, async ({page}) => {
    const f = await fixture(page, width);
    await press(page, page.locator('[data-note-row="n-files"]'), width);
    await noteMenuAction(page, 'data-note-delete', {width});
    const asked = await answerAsk(page, true);
    await expect(page.locator('[data-note-row="n-files"]')).toHaveCount(0);
    expect(asked).toBe('노트를 휴지통으로 옮길까요?\n첨부 파일 2개는 Drive에 그대로 남습니다.\n휴지통에서 되돌릴 수 있습니다.');
    await expect(page.locator('[data-undo-notice]')).toContainText('노트를 휴지통으로 옮겼어요.');
    expect(f.writes).toEqual([{method: 'DELETE', query: {id: 'eq.n-files', workspace_id: 'eq.w', select: 'id'}}]);
    expect(f.functions).toEqual([]);
    expect(f.errors).toEqual([]);
  });
}

// FILE-누르면동작: 노트 첨부 줄을 누르면 종류별 동작(PDF = Drive 보기 새 탭, HWP = 내려받기 주소), ⋯에는 둘 다 있다.
test('note file line: PDF opens the Drive view in a new tab, HWP starts the Drive download, ⋯ has both for any file', async ({page, context}) => {
  await context.route('https://drive.google.com/**', r => r.fulfill({status: 200, contentType: 'text/html', body: 'ok'}));
  const f = await fixture(page, 1280);
  await press(page, page.locator('[data-note-row="n-files"]'), 1280);
  const cards = page.locator('[data-note-attachments] .file-line');
  await expect(cards).toHaveCount(2);
  let [tab] = await Promise.all([context.waitForEvent('page'), cards.nth(0).locator('.file-line-main').click()]);
  await tab.waitForURL('https://drive.google.com/file/d/drive_a/view'); await tab.close();
  [tab] = await Promise.all([context.waitForEvent('page'), cards.nth(1).locator('.file-line-main').click()]);
  await tab.waitForURL('https://drive.google.com/uc?export=download&id=drive_b'); await tab.close();
  // ⋯: Drive에서 열기 and 내려받기 for a PDF too.
  await press(page, cards.nth(0).getByRole('button', {name: '교섭 요구안.pdf 메뉴'}), 1280);
  await expect(page.locator('#noteDocMenu button')).toHaveText(['Drive에서 열기', '내려받기', '빼기', '삭제']);
  [tab] = await Promise.all([context.waitForEvent('page'), page.locator('#noteDocMenu [data-file-menu="download"]').click()]);
  await tab.waitForURL('https://drive.google.com/uc?export=download&id=drive_a'); await tab.close();
  expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
});

// UX-먼저묻고뒤에처리 3차 (2): the big window's files go up behind the screen, by the id of the note they were chosen for.
// Before: the save locked the whole note (every button and input), the window's clip and the back step, until every file was up.
async function openBig(page, id, width) {
  await press(page, page.locator(`[data-note-row="${id}"]`), width);
  await noteMenuAction(page, 'data-note-edit', {width});
  await expect(page.locator('[data-note-detail] [data-note-body-field] .ProseMirror')).toBeVisible();
  await press(page, page.locator('[data-note-big-write]'), width);
  const e = page.locator('#edWindow'); await expect(e).toBeVisible();
  return e;
}
// Holds every basket-files request until open() (the fixture's own handler then stores the file). seen: file names as they arrive.
// fail(name): answer that request with a refusal the screen may send again (400) instead of storing it.
async function holdUploads(page, {fail = () => false} = {}) {
  const seen = []; let open; const gate = new Promise(resolve => { open = resolve; });
  await page.route(SB + '/functions/v1/basket-files**', async r => {
    const name = (r.request().postDataBuffer()?.toString('utf8') || '').match(/filename="([^"]*)"/)?.[1]; seen.push(name);
    await gate;
    if (fail(name)) return r.fulfill({status: 400, json: {error: '첨부를 저장하지 못했어요.', code: 'bad_file'}});
    return r.fallback();
  });
  return {seen, open: () => open()};
}
const sent = (noteId, name) => ({noteId, name, rawText: false});
for (const width of [412, 1280]) {
  test(`big editor files go up behind the screen: nothing is locked, the window and the note close, another note opens, the file goes to its own note ${width}`, async ({page}) => {
    const f = await fixture(page, width), held = await holdUploads(page);
    const e = await openBig(page, 'n-text', width);
    await e.locator('#edwNoteEditAttach').setInputFiles([fileBuffer('뒤에서 올림.pdf')]);
    await e.locator('[data-edw-save]').click();
    await expect.poll(() => held.seen.length).toBe(1);
    // Not locked while it goes up: the window says so, its chosen list is empty again, the clip and the save can be used,
    // and the file is on the window's own upload row.
    await expect(e.locator('.ed-window-status')).toHaveText('첨부를 올리는 중이에요');
    const clip = e.locator('[data-edw-attach]').getByRole('button', {name: '파일 첨부', exact: true});
    await expect(clip).toBeEnabled(); await expect(clip.locator('[data-basket-count]')).toBeHidden();
    await expect(e.locator('[data-edw-save]')).toBeEnabled();
    await expect(e.locator('[data-edw-attach-sent] .up-row')).toContainText('뒤에서 올림.pdf');
    expect(await noFrameWidth(page)).toBe(true);
    if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-attach-${width}.png`});
    // ✕ closes without asking (nothing is left unsaved); the note behind is not locked and the line above the bottom bar shows the upload.
    await e.locator('[data-close="edWindow"]').click(); await expect(page.locator('#edWindow')).toHaveCount(0);
    await expect(page.locator('[data-note-detail] [data-note-more]')).toBeEnabled();
    await expect(page.locator('#uploadDock')).toContainText('올리는 중');
    // The back step leaves the note (it was refused while files went up), and another note opens.
    await page.goBack();
    await press(page, page.locator('[data-note-row="n-empty"]'), width);
    await expectNoteTitle(page, '빈 노트');
    held.open();
    await expect.poll(() => f.uploads).toEqual([sent('n-text', '뒤에서 올림.pdf')]);
    await expect(page.locator('#kptuNotice')).toContainText('노트에 뒤에서 올림.pdf 올렸어요');
    // The note on the screen is not drawn over; the first note's row has the file.
    await expectNoteTitle(page, '빈 노트');
    await expect(page.locator('[data-note-detail] [data-note-attachments] .file-line')).toHaveCount(0);
    await page.goBack();
    await expect(page.locator('[data-note-row="n-text"] .nx-clip')).toHaveAttribute('aria-label', '첨부 1개');
    expect(f.errors).toEqual([]);
  });

  test(`big editor files: one that did not go up is told by the small notice, and [다시] sends only that file to the same note ${width}`, async ({page}) => {
    const f = await fixture(page, width);
    let refused = false;
    const held = await holdUploads(page, {fail: name => name === '둘째.pdf' && !refused && (refused = true)});
    const e = await openBig(page, 'n-text', width);
    await e.locator('#edwNoteEditAttach').setInputFiles([fileBuffer('첫째.pdf'), fileBuffer('둘째.pdf')]);
    await e.locator('[data-edw-save]').click();
    await expect.poll(() => held.seen.length).toBe(1);
    await e.locator('[data-close="edWindow"]').click(); await expect(page.locator('#edWindow')).toHaveCount(0);
    await page.goBack(); await expect(page.locator('[data-note-row="n-text"]')).toBeVisible();
    held.open();
    const notice = page.locator('#kptuNotice');
    await expect(notice).toContainText('노트에 첫째.pdf 올렸어요 · 1개 못 올렸어요');
    await notice.getByRole('button', {name: '다시', exact: true}).click();
    await expect.poll(() => f.uploads).toEqual([sent('n-text', '첫째.pdf'), sent('n-text', '둘째.pdf')]);
    expect(held.seen).toEqual(['첫째.pdf', '둘째.pdf', '둘째.pdf']); // the stored file is not sent again
    await expect(notice).toContainText('노트에 둘째.pdf 올렸어요');
    await expect(page.locator('[data-note-row="n-text"] .nx-clip')).toHaveAttribute('aria-label', '첨부 2개');
  });
}
test('big editor files: files saved while the first goes up wait in the same line and reach the same note from another screen (412)', async ({page}) => {
  const width = 412, f = await fixture(page, width), held = await holdUploads(page);
  const e = await openBig(page, 'n-text', width);
  await e.locator('#edwNoteEditAttach').setInputFiles([fileBuffer('첫째.pdf')]);
  await e.locator('[data-edw-save]').click();
  await expect.poll(() => held.seen.length).toBe(1);
  // More files while the first goes up: chosen and saved without a refusal, sent only after the first.
  await e.locator('#edwNoteEditAttach').setInputFiles([fileBuffer('둘째.pdf')]);
  await expect(e.locator('[data-edw-attach-files] [data-basket-file]')).toContainText('둘째.pdf');
  await e.locator('[data-edw-save]').click();
  await expect(e.locator('[data-edw-attach-files] [data-basket-file]')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(held.seen).toEqual(['첫째.pdf']);
  await e.locator('[data-close="edWindow"]').click(); await expect(page.locator('#edWindow')).toHaveCount(0);
  await page.evaluate(() => window.KPTURouter.go('home'));
  await expect(page.locator('#homeView')).toBeVisible();
  held.open();
  await expect.poll(() => f.uploads).toEqual([sent('n-text', '첫째.pdf'), sent('n-text', '둘째.pdf')]);
  await expect(page.locator('#kptuNotice')).toContainText('노트에 둘째.pdf 올렸어요');
  expect(f.errors).toEqual([]);
});
test('big editor files: text saved while a file goes up waits behind it and is saved on the version the upload left (412)', async ({page}) => {
  const width = 412, f = await fixture(page, width), held = await holdUploads(page);
  const e = await openBig(page, 'n-text', width);
  await e.locator('#edwNoteEditAttach').setInputFiles([fileBuffer('먼저 올림.pdf')]);
  await e.locator('[data-edw-save]').click();
  await expect.poll(() => held.seen.length).toBe(1);
  // The upload moves the note's version on the server, and the server refuses an upload whose note changed meanwhile: the text save
  // is not sent past it (and is not refused either) — it goes after the file, on the new version.
  await e.locator('.ProseMirror').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 덧붙인 글');
  await e.locator('[data-edw-save]').click();
  await page.waitForTimeout(300);
  expect(f.writes.filter(w => w.method === 'PATCH')).toHaveLength(0);
  held.open();
  await expect(e.locator('.ed-window-status')).toHaveText('저장했어요');
  expect(f.uploads).toEqual([sent('n-text', '먼저 올림.pdf')]);
  const patches = f.writes.filter(w => w.method === 'PATCH');
  expect(patches).toHaveLength(1);
  expect(patches[0].query.updated_at).toMatch(/^eq\.2026-10-22T05:00:/); // the version the upload left (the fixture stamps uploads 05:00:…)
  expect(patches[0].body.raw_text).toContain('덧붙인 글');
  expect(f.notes.find(n => n.id === 'n-text').attachments).toHaveLength(1);
  expect(f.errors).toEqual([]);
});
