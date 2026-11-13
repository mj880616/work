import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

// NOTE-목록에파일놓기(S61-16 ①, 요청함 11/12 14:31): PC 파일을 노트 화면 오른쪽 목록(노트 줄 위·빈 자리)에 끌어 오면 목록 칸에
// '여기 놓으면 새 노트', 놓으면 새 노트 창(⤢와 같은 창)이 그 파일을 붙인 채 뜬다 — 제목 = 파일 이름(확장자 뺌), 초점은 본문,
// 저장 폴더는 지금 고른 폴더. [저장]을 눌러야 저장(그 전에는 아무 요청도 없음), 닫으면 아무것도 남지 않는다.
// 노트 줄 위에 놓아도 그 노트에 붙이지 않고 새 노트. 왼쪽 폴더 나무와 위 입력칸은 이 길을 타지 않는다(입력칸은 제 첨부).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FOLDER = '01. 업무 메모';

async function fixture(page) {
  await page.setViewportSize({width: 1280, height: 900});
  const errors = [], writes = [], uploads = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata});
  const rows = [
    row('n1', '업무 가', '2026-11-12T01:00:00Z', {folder_id: U(1), folder: FOLDER}),
    row('n2', '업무 나', '2026-11-11T01:00:00Z', {folder_id: U(1), folder: FOLDER}),
    row('n3', '바깥 노트', '2026-11-10T01:00:00Z'),
  ];
  let made = 0;
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const metaOk = (x, key) => !q.has('metadata->>' + key) || (q.get('metadata->>' + key) === 'is.null' ? x.metadata[key] == null : 'eq.' + x.metadata[key] === q.get('metadata->>' + key));
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'))
      && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at')) && metaOk(x, 'pinned_at') && metaOk(x, 'folder');
    if (req.method() === 'GET') return r.fulfill({json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x))});
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON(); writes.push({method: 'PATCH', query: Object.fromEntries(q), body});
      const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({json: hit.map(x => structuredClone(x))});
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON(); writes.push({method: 'POST', body});
      const x = {...row('n-new' + ++made, body.title, `2026-11-13T01:00:0${made}Z`), raw_text: body.raw_text}; rows.unshift(x);
      return r.fulfill({status: 201, json: [structuredClone(x)]});
    }
    return r.fulfill({status: 500, json: {}});
  });
  const folders = [{id: U(1), workspace_id: 'w', parent_id: null, name: FOLDER, sort_order: 1024, created_at: '2026-10-01T00:00:00Z'}, {id: U(2), workspace_id: 'w', parent_id: null, name: '02. 회의', sort_order: 2048, created_at: '2026-10-01T00:00:00Z'}];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({json: structuredClone(folders)}) : r.fulfill({status: 500, json: {}}));
  await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({json: []}) : r.fallback());
  await page.route(SB + '/functions/v1/basket-files**', r => {
    const raw = r.request().postDataBuffer()?.toString('utf8') || '';
    const noteId = raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1], name = raw.match(/filename="([^"]*)"/)?.[1];
    uploads.push({noteId, name});
    const x = rows.find(n => n.id === noteId);
    if (!x) return r.fulfill({status: 404, json: {error: '첨부를 저장하지 못했어요.', code: 'note_not_found'}});
    x.attachments = [...x.attachments, {drive_file_id: 'up_' + uploads.length, file_name: name, mime_type: 'application/pdf', size_bytes: 4}];
    return r.fulfill({json: {ok: true, note_id: x.id, attachments: x.attachments}});
  });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText(`노트 · ${rows.length}`);
  // 왼쪽 나무에서 '01. 업무 메모'로 들어간다(⋯ → 들어가기, UI-폴더누르기한규칙).
  await page.locator(`[data-nx-tree] [data-nx-folder-more="${U(1)}"]`).click();
  await page.locator('#noteDocMenu [data-nx-enter]').click();
  await expect(page.locator('[data-note-list] [data-quick-input]')).toHaveAttribute('placeholder', `${FOLDER}에 노트 추가`);
  await expect(page.locator('.nx-pane [data-note-row="n1"]')).toBeVisible();
  return {rows, writes, uploads, errors};
}

const files = (page, list) => page.evaluateHandle(list => {
  const d = new DataTransfer();
  for (const [name, type] of list) d.items.add(new File(['%PDF-1.4'], name, {type}));
  return d;
}, list);
// 끌어 오기(dragenter·dragover)와 놓기(drop)를 화면의 한 점에서 — 실제 PC 끌기처럼 그 점 아래 요소가 받는다.
async function dragTo(page, dt, x, y, {drop = true} = {}) {
  const at = await page.evaluateHandle(([x, y]) => document.elementFromPoint(x, y), [x, y]);
  for (const type of ['dragenter', 'dragover', ...(drop ? ['drop'] : [])]) await at.asElement().dispatchEvent(type, {dataTransfer: dt, clientX: x, clientY: y});
}
const center = async l => { const b = await l.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

test('파일을 노트 줄 위에 끌어 오면 표시, 놓으면 그 파일을 붙인 새 노트 창 → [저장]해야 고른 폴더에 노트 (1280)', async ({page}) => {
  const f = await fixture(page);
  const dt = await files(page, [['교섭 요구안.pdf', 'application/pdf']]);
  const [x, y] = await center(page.locator('.nx-pane [data-note-row="n1"]'));
  await dragTo(page, dt, x, y, {drop: false});
  const mark = page.locator('[data-nx-file-drop]');
  await expect(mark).toBeVisible(); await expect(mark).toHaveText('여기 놓으면 새 노트');
  await expect(page.locator('.nx-pane')).toHaveClass(/nx-file-over/);
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-drop-over-1280.png`});
  await dragTo(page, dt, x, y);
  await expect(mark).toHaveCount(0);
  const w = page.locator('#edWindow'); await expect(w).toBeVisible();
  // 제목 = 파일 이름(확장자 뺌), 첨부 줄에 그 파일, 폴더 = 지금 고른 폴더, 초점은 본문.
  await expect(w.locator('[data-edw-title]')).toHaveValue('교섭 요구안');
  await expect(w.locator('[data-edw-attach] [data-basket-file]')).toHaveCount(1);
  await expect(w.locator('[data-edw-attach] [data-basket-file]')).toContainText('교섭 요구안.pdf');
  await expect(w.locator('[data-edw-folder]')).toContainText('01. 업무 메');
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('#edWindow .ProseMirror'))).toBe(true);
  // 노트 줄에 놓았지만 그 노트에는 아무것도 붙지 않았고, 아직 아무 저장 요청도 없다.
  expect(f.writes).toEqual([]); expect(f.uploads).toEqual([]);
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-drop-window-1280.png`});
  await page.keyboard.type('요구안 검토');
  await w.locator('[data-edw-save]').click();
  await expect(page.locator('#edWindow')).toHaveCount(0);
  await expect.poll(() => f.writes.find(x => x.method === 'POST')?.body?.title).toBe('교섭 요구안');
  await expect.poll(() => f.uploads).toEqual([{noteId: 'n-new1', name: '교섭 요구안.pdf'}]);
  await expect.poll(() => f.rows.find(r => r.id === 'n-new1')?.metadata).toMatchObject({folder_id: U(1), folder: FOLDER});
  // 위 입력칸은 건드리지 않았다(글·첨부 없음).
  await expect(page.locator('[data-note-list] [data-quick-input]')).toHaveValue('');
  await expect(page.locator('[data-note-list] [data-home-quick] [data-basket-file]')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test('목록 아래 빈 자리에 여러 파일을 놓으면 한 노트 창에 모두, 닫으면 아무것도 남지 않음 (1280)', async ({page}) => {
  const f = await fixture(page);
  const dt = await files(page, [['현장 사진.png', 'image/png'], ['회의록.hwp', 'application/x-hwp']]);
  const pane = await page.locator('.nx-pane').boundingBox();
  // 목록 칸 오른쪽 열의 맨 아래 빈 자리(노트 줄보다 한참 아래).
  await dragTo(page, dt, pane.x + pane.width / 2, 860);
  const w = page.locator('#edWindow'); await expect(w).toBeVisible();
  await expect(w.locator('[data-edw-title]')).toHaveValue('현장 사진');
  await expect(w.locator('[data-edw-attach] [data-basket-file]')).toHaveCount(2);
  // 닫기 → [저장하지 않고 닫기]: 요청 없음, 입력칸에도 아무것도 넘어가지 않는다.
  await w.locator('[data-close="edWindow"]').click();
  await page.getByRole('button', {name: '저장하지 않고 닫기'}).click();
  await expect(page.locator('#edWindow')).toHaveCount(0);
  expect(f.writes).toEqual([]); expect(f.uploads).toEqual([]);
  await expect(page.locator('[data-note-list] [data-quick-input]')).toHaveValue('');
  await expect(page.locator('[data-note-list] [data-home-quick] [data-basket-file]')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test('왼쪽 폴더 나무에 놓으면 아무 일 없고, 위 입력칸에 놓으면 지금처럼 입력칸 첨부 (1280)', async ({page}) => {
  const f = await fixture(page);
  const dt = await files(page, [['안내문.pdf', 'application/pdf']]);
  const [tx, ty] = await center(page.locator(`[data-nx-tree] [data-nx-folder="${U(2)}"]`).first());
  await dragTo(page, dt, tx, ty, {drop: false});
  await expect(page.locator('[data-nx-file-drop]')).toHaveCount(0);
  await dragTo(page, dt, tx, ty);
  await expect(page.locator('#edWindow')).toHaveCount(0);
  const quick = page.locator('[data-note-list] [data-home-quick]');
  const [qx, qy] = await center(quick.locator('[data-quick-input]'));
  await dragTo(page, dt, qx, qy);
  await expect(page.locator('#edWindow')).toHaveCount(0);
  await expect(quick.locator('[data-basket-file]')).toContainText('안내문.pdf');
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('포스트잇 보기에서도 목록 칸에 놓으면 새 노트 창 (1280)', async ({page}) => {
  const f = await fixture(page);
  await page.locator('[data-note-view="board"]').click();
  const wrap = page.locator('[data-note-board-wrap]'); await expect(wrap).toBeVisible();
  const dt = await files(page, [['보고서.pdf', 'application/pdf']]);
  const [x, y] = await center(page.locator('[data-note-board]'));
  await dragTo(page, dt, x, y, {drop: false});
  await expect(wrap).toHaveClass(/nx-file-over/);
  await dragTo(page, dt, x, y);
  await expect(page.locator('#edWindow [data-edw-title]')).toHaveValue('보고서');
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});
