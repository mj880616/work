import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S71-56 B10 노트 보드 표·파일 칸(사용자 결정 2026-11-26 21:11 "첨부한 파일 도 다 뻗을 수 있었으면", "표도 넣을 수 있고 모든 것에서", "관계망 형성이 되어야해").
// - 표: [도형▾] 줄 [표] → 3×3 빈 표. 고른 표의 칸을 다시 누르면 그 칸 글쓰기, 쓰는 중 Tab = 다음 칸(마지막 칸이면 줄 더하기), Enter = 저장.
//   표를 고른 채(쓰기 전) Tab = 하위 가지. 막대 [표 ⋯] [줄 더하기]. 다시 열어도 그대로.
// - 파일: [도형▾] 줄 [파일] → 고르기 창 [자료실]·[노트 첨부] → [넣기 n개] → 파일 칸. PC는 자료실 줄을 빈 곳에 끌어 놓아도. 고른 파일 칸을 다시 누르면
//   보드 위 옆 칸(폰은 아래 판) 미리보기 — 보드 그대로.
// - 표·파일 칸에서 하위 가지·관계선. 다른 작업공간 자료 id는 서버가 거절(화면은 알리고 다시 불러옴). 적용 전 서버는 [표]·[파일] '준비 중'.
// 서버 흉내: 글 상자 표의 kind 'table'(cells)·'file'(file_doc 또는 file_note+file_drive). PC 1280·폰 390. 이름·글은 지어낸 것.
test.describe.configure({ timeout: 60000 });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BID = 'bcel0001';
const DEF = { parent_id: null, parent_note: null, ord: 0, side: null, kind: 'topic', color: null, shape: 'round', font: 2, w: null, collapsed: false, h: null, pinned: false,
  z: 0, stroke: null, stroke_w: null, dash: false, alpha: null, bold: false, align: null, ink: null, cells: null, file_doc: null, file_note: null, file_drive: null };
const LDEF = { from_note: null, to_note: null, from_text: null, to_text: null, from_side: null, to_side: null, shape: 'line', dash: 'solid', ends: 'end', label: null, bend_x: null, bend_y: null,
  from_x: null, from_y: null, to_x: null, to_y: null, color: null, width: null, kind: 'line', mat_note: null, mat_doc: null, mat_url: null };
const CARD = '20000000-0000-4000-8000-000000000001', NOTE = '20000000-0000-4000-8000-000000000002';
const DOC = '30000000-0000-4000-8000-000000000001', DOC2 = '30000000-0000-4000-8000-000000000002', FOREIGN = '39000000-0000-4000-8000-000000000009';
const CELL_COLS = ['cells', 'file_doc', 'file_note', 'file_drive'];
const SEED = [{ id: 'tp', board_id: BID, body: '큰 주제', x: 320, y: 120 }];
let clockAt = Date.parse('2026-10-06T01:00:00Z');
async function later(page, ms = 600) { clockAt += ms; await page.clock.setFixedTime(new Date(clockAt)); }
async function fixture(page, width, { old = false, seed = SEED, compact = false } = {}) {
  clockAt = Date.parse('2026-10-06T01:00:00Z');
  await page.setViewportSize({ width, height: width > 600 ? 1000 : 860 });
  const errors = [], textCalls = [], linkCalls = [], textRows = seed.map(t => ({ ...DEF, ...t })), linkRows = [];
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: BID, name: '칸 보드' }], note_board: BID, note_view: 'board' });
  await openHome(page);
  const row = (id, title, board, extra = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n본문 한 줄', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: board ? { boards: { [BID]: board } } : {}, ...extra });
  const rows = [row(CARD, '보드 위 노트', compact ? { x: 20, y: 120, r: 1, z: 0 } : { x: 60, y: 160, r: 1, z: 0 }),
    row(NOTE, '첨부 있는 노트', null, { updated_at: '2026-10-12T01:00:00Z', attachments: [{ drive_file_id: 'driveAtt_01', file_name: '가상 회의록.pdf', mime_type: 'application/pdf', file_size: 52000 }] })];
  const docs = [{ id: DOC, workspace_id: 'w', title: '가상 계획서', file_name: 'plan.hwp', mime_type: 'application/x-hwp', file_size: 24576, file_id: 'driveDoc_01', created_at: '2026-10-09T01:00:00Z', description: null, drive_url: 'https://drive.google.com/file/d/driveDoc_01/view', category: null },
    { id: DOC2, workspace_id: 'w', title: '가상 표 자료', file_name: 'sheet.xlsx', mime_type: 'application/vnd.ms-excel', file_size: 2048, file_id: 'driveDoc_02', created_at: '2026-10-08T01:00:00Z', description: null, drive_url: null, category: null }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && ['/rest/v1/app_library_folders', '/rest/v1/app_library_folder_items'].includes(u.pathname), r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_documents', r => {
    const q = new URL(r.request().url()).searchParams, id = q.get('id');
    const hit = !id ? docs : id.startsWith('eq.') ? docs.filter(d => d.id === id.slice(3)) : docs.filter(d => id.slice(4, -1).split(',').includes(d.id));
    return r.fulfill({ json: hit.map(d => structuredClone(d)) });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  let seq = 0;
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    linkCalls.push({ method, query: Object.fromEntries(q), body });
    if (method === 'GET') return r.fulfill({ json: linkRows.map(l => structuredClone(l)) });
    if (method === 'POST') { const saved = { ...LDEF, id: `L${++seq}`, ...body }; delete saved.workspace_id; linkRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] }); }
    if (method === 'DELETE') { const id = q.get('id')?.slice(3); for (let i = linkRows.length - 1; i >= 0; i--) if (linkRows[i].id === id) linkRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  // old면 표·파일 칸(cells·file_*)을 물으면 42703(적용 전). 파일 칸은 내 자료·내 노트 첨부만(좁히기 정책 흉내 — 아니면 403).
  const asksCells = (q, body) => CELL_COLS.some(k => new RegExp(`(^|,)${k}(,|$)`).test(q.get('select') || '')) || (body && CELL_COLS.some(k => k in body));
  const strip = t => (old ? Object.fromEntries(Object.entries(t).filter(([k]) => !CELL_COLS.includes(k))) : t);
  const mine = body => (!body.file_doc || docs.some(d => d.id === body.file_doc)) && (!body.file_note || rows.some(n => n.id === body.file_note && n.attachments.some(f => f.drive_file_id === body.file_drive)));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    textCalls.push({ method, query: Object.fromEntries(q), body });
    if (old && asksCells(q, body)) return r.fulfill({ status: 400, json: { code: '42703', message: 'column app_note_board_texts.cells does not exist' } });
    if (method === 'GET') { const id = q.get('id'), list = id?.startsWith('in.(') ? id.slice(4, -1).split(',') : null; return r.fulfill({ json: textRows.filter(t => !list || list.includes(t.id)).map(t => structuredClone(strip(t))) }); }
    if (method === 'POST') {
      if (!mine(body)) return r.fulfill({ status: 403, json: { code: '42501', message: 'new row violates row-level security policy "note_board_texts_file_own" for table "app_note_board_texts"' } });
      const saved = { ...DEF, id: `T${++seq}`, ...body }; delete saved.workspace_id; textRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(strip(saved))] });
    }
    if (method === 'PATCH') { const hit = textRows.find(t => 'eq.' + t.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(strip(hit))] }); }
    if (method === 'DELETE') { const gone = q.get('id')?.slice(3); for (let i = textRows.length - 1; i >= 0; i--) if (textRows[i].id === gone) textRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await openBoard(page);
  return { errors, textCalls, linkCalls, textRows, linkRows, docs };
}
async function openBoard(page) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  const sw = page.locator('.nv-switch [data-note-view="board"]');
  if ((await sw.getAttribute('aria-pressed')) !== 'true') await sw.click();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(1);
  await expect(page.locator('[data-nb-texts] [data-nb-text="tp"]')).toBeVisible();
  await later(page);
}
const cell = (page, id) => page.locator(`[data-nb-texts] [data-nb-text="${id}"]`);
const kind = (page, k) => page.locator(`[data-nb-texts] [data-nb-text][data-kind="${k}"]`);
const menu = page => page.locator('#rowMenu');
const item = (page, name) => menu(page).locator('button').filter({ hasText: new RegExp(`^${name}$`) }).first();
const picker = page => page.locator('[data-nbm-pick]');
const view = page => page.locator('[data-nbm-view]');
const edit = page => page.locator('[data-nb-texts] textarea.nb-cell-edit');
const posts = (calls, k) => calls.filter(c => c.method === 'POST' && (!k || c.body?.kind === k));
const patches = calls => calls.filter(c => c.method === 'PATCH');
async function box(l) { for (let i = 0; i < 20; i++) { const b = await l.boundingBox({ timeout: 2000 }).catch(() => null); if (b) return b; await new Promise(r => setTimeout(r, 50)); } return null; }
async function center(l) { const b = await box(l); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function insert(page, what, tap = false) {
  const open = page.locator('[data-nb-insert-open="shape"]');
  if (tap) await open.tap(); else await open.click();
  const b = page.locator(`[data-nb-insert="shape"] [data-nb-add-${what}]`);
  if (tap) await b.tap(); else await b.click();
}
async function dropAt(page, x, y, data) {
  await page.evaluate(({ x, y, data }) => {
    const dt = new DataTransfer(); for (const [k, v] of Object.entries(data)) dt.setData(k, v);
    const el = document.elementFromPoint(x, y);
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, { x, y, data });
}

test('B10 PC: [표] 3×3 · 칸 다시 누르면 글쓰기 · 쓰는 중 Tab = 다음 칸 · Enter 저장 · [표 ⋯] 줄 더하기 · 다시 열어도 그대로 (1280)', async ({ page, browser }) => {
  const { errors, textCalls, textRows } = await fixture(page, 1280);
  await insert(page, 'table');
  await expect.poll(() => posts(textCalls, 'table').length).toBe(1);
  expect(posts(textCalls, 'table')[0].body).toMatchObject({ board_id: BID, kind: 'table', body: '', cells: [['', '', ''], ['', '', ''], ['', '', '']] });
  const t = kind(page, 'table');
  await expect(t.locator('td')).toHaveCount(9);
  await expect(t).toHaveClass(/nb-sel/); // 넣자마자 고름
  await later(page);
  // 고른 표의 둘째 줄 첫 칸을 다시 누름 = 그 칸 글쓰기
  await t.locator('td[data-nb-cell="1,0"]').click();
  await expect(edit(page)).toBeFocused();
  await expect(edit(page)).toHaveAttribute('aria-label', '표 2줄 1칸');
  await page.keyboard.type('가상 항목');
  await page.keyboard.press('Tab'); // 표 안 Tab = 다음 칸(하위 가지가 아님)
  await expect(edit(page)).toHaveAttribute('aria-label', '표 2줄 2칸');
  await page.keyboard.type('<b>굵게</b>');
  await expect(page.locator('[data-nb-texts] textarea:not(.nb-cell-edit)')).toHaveCount(0); // 새 가지 입력칸이 생기지 않음
  await page.keyboard.press('Enter');
  await expect(edit(page)).toHaveCount(0);
  await expect.poll(() => patches(textCalls).length).toBe(1);
  expect(patches(textCalls)[0].body).toEqual({ cells: [['', '', ''], ['가상 항목', '<b>굵게</b>', ''], ['', '', '']] });
  await expect(t.locator('td[data-nb-cell="1,1"]')).toHaveText('<b>굵게</b>'); // 글자 그대로(escape)
  await expect(t.locator('b')).toHaveCount(0);
  // 마지막 칸에서 Tab = 줄 더하기
  await later(page);
  await t.locator('td[data-nb-cell="2,2"]').click();
  await expect(edit(page)).toHaveAttribute('aria-label', '표 3줄 3칸');
  await page.keyboard.press('Tab');
  await expect(edit(page)).toHaveAttribute('aria-label', '표 4줄 1칸');
  await page.keyboard.type('넷째 줄');
  await page.keyboard.press('Escape'); // Esc = 고친 것 버림(줄 더하기도)
  await expect(t.locator('tr')).toHaveCount(3);
  expect(patches(textCalls)).toHaveLength(1);
  // 막대 [표 ⋯] → [줄 더하기]
  await page.locator('[data-nb-bar] [data-nb-bar-open="table"]').click();
  await page.locator('[data-nb-bar] [data-nb-tbl="row+"]').click();
  await expect.poll(() => patches(textCalls).length).toBe(2);
  expect(patches(textCalls)[1].body.cells).toHaveLength(4);
  await expect(t.locator('tr')).toHaveCount(4);
  // 다시 열어도(서버 줄을 처음부터 읽음) 그대로
  const ctx = await browser.newContext(), again = await ctx.newPage();
  const second = await fixture(again, 1280, { seed: textRows.map(x => structuredClone(x)) });
  await expect(kind(again, 'table').locator('tr')).toHaveCount(4);
  await expect(kind(again, 'table').locator('td[data-nb-cell="1,0"]')).toHaveText('가상 항목');
  expect(second.errors).toEqual([]);
  await ctx.close();
  expect(errors).toEqual([]);
});

test('B10 PC: 표를 고른 채 Tab = 하위 가지 · 표에서 관계 잇기 → 파일 칸 · 파일 칸 아래 가지 (1280)', async ({ page }) => {
  const seed = [...SEED, { id: 'tb', board_id: BID, body: '', kind: 'table', shape: 'rect', w: 300, x: 320, y: 300, cells: [['가', '나'], ['다', '라']] },
    { id: 'fl', board_id: BID, body: '', kind: 'file', shape: 'rect', w: 220, x: 700, y: 300, file_doc: DOC }];
  const { errors, textCalls, linkCalls } = await fixture(page, 1280, { seed });
  await expect(cell(page, 'fl').locator('.nb-file-name')).toHaveText('가상 계획서');
  await expect(cell(page, 'fl').locator('.nb-file-meta')).toHaveText('한글 · 24KB');
  // 표 고르기(키보드 초점) → Tab = 하위 가지
  await cell(page, 'tb').locator('.nb-tx').focus();
  await page.keyboard.press('Tab');
  const draft = page.locator('[data-nb-texts] textarea.nb-tx-edit:not(.nb-cell-edit)');
  await expect(draft).toBeFocused();
  await page.keyboard.type('표 아래 가지');
  await page.keyboard.press('Enter');
  await expect.poll(() => posts(textCalls).length).toBe(1);
  expect(posts(textCalls)[0].body).toMatchObject({ parent_id: 'tb', body: '표 아래 가지' });
  expect(posts(textCalls)[0].body.kind ?? 'topic').toBe('topic');
  await expect(page.locator('[data-nb-branches] path')).toHaveCount(1);
  // 표 우클릭 [관계 잇기] → 파일 칸 누르기 = 관계선
  await later(page);
  const c = await center(cell(page, 'tb').locator('td').first());
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await expect(item(page, '줄 더하기')).toHaveCount(1);
  await item(page, '관계 잇기').click();
  await later(page);
  await cell(page, 'fl').locator('.nb-tx').click();
  await expect.poll(() => linkCalls.filter(x => x.method === 'POST').length).toBe(1);
  expect(linkCalls.find(x => x.method === 'POST').body).toMatchObject({ kind: 'relation', from_text: 'tb', to_text: 'fl' });
  // 파일 칸을 고른 채 Tab = 하위 가지
  await later(page);
  await cell(page, 'fl').locator('.nb-tx').focus();
  await page.keyboard.press('Tab');
  await expect(draft).toBeFocused();
  await page.keyboard.type('파일 아래 가지');
  await page.keyboard.press('Enter');
  await expect.poll(() => posts(textCalls).length).toBe(2);
  expect(posts(textCalls)[1].body).toMatchObject({ parent_id: 'fl', body: '파일 아래 가지' });
  expect(errors).toEqual([]);
});

test('B10 PC: [파일] 고르기 창 자료실·노트 첨부 → 파일 칸 둘 · 자료실 줄 끌어 놓기 · 다시 누르면 보드 위 미리보기(보드 그대로) (1280)', async ({ page }) => {
  const { errors, textCalls } = await fixture(page, 1280);
  await insert(page, 'file');
  await expect(picker(page)).toBeVisible();
  await expect(picker(page)).toContainText('파일 넣기');
  await expect(picker(page).locator('[data-nbm-pick-row]', { hasText: '가상 계획서' })).toBeVisible();
  await picker(page).locator('[data-nbm-pick-row]', { hasText: '가상 계획서' }).click();
  await picker(page).locator('[data-nbm-tab="att"]').click();
  await picker(page).locator('[data-nbm-pick-row]', { hasText: '가상 회의록.pdf' }).click();
  await expect(picker(page).locator('[data-nbm-done]')).toHaveText('넣기 2개');
  await picker(page).locator('[data-nbm-done]').click();
  await expect.poll(() => posts(textCalls, 'file').length).toBe(2);
  expect(posts(textCalls, 'file').map(c => c.body)).toEqual([
    expect.objectContaining({ board_id: BID, kind: 'file', body: '', file_doc: DOC }),
    expect.objectContaining({ kind: 'file', file_note: NOTE, file_drive: 'driveAtt_01' })]);
  expect(posts(textCalls, 'file')[0].body).not.toHaveProperty('file_note');
  await expect(kind(page, 'file')).toHaveCount(2);
  await expect(kind(page, 'file').locator('.nb-file-name')).toHaveText(['가상 계획서', '가상 회의록.pdf']);
  // PC: 자료실 줄을 판 빈 곳에 끌어 놓으면 그 자리에 파일 칸
  const sb = await box(page.locator('[data-nb-scroll]'));
  await dropAt(page, sb.x + 120, sb.y + sb.height - 120, { 'application/x-kptu-doc-ref': DOC2 });
  await expect.poll(() => posts(textCalls, 'file').length).toBe(3);
  expect(posts(textCalls, 'file')[2].body).toMatchObject({ file_doc: DOC2 });
  await expect(kind(page, 'file')).toHaveCount(3);
  // 고른 파일 칸을 다시 누르면 보드 위 옆 칸 미리보기(보드를 떠나지 않음)
  const hwp = kind(page, 'file').filter({ hasText: '가상 계획서' });
  await later(page);
  await hwp.locator('.nb-tx').click();
  await later(page);
  await hwp.locator('.nb-tx').click();
  await expect(view(page)).toBeVisible();
  await expect(view(page).locator('.nbm-view-title')).toHaveText('가상 계획서');
  await expect(view(page)).toContainText('plan.hwp');
  await expect(view(page)).toContainText('24KB');
  await expect(view(page).locator('button', { hasText: 'HWP 편집으로 열기' })).toBeVisible();
  await expect(view(page).locator('button', { hasText: '자료실에서 보기' })).toBeVisible();
  await expect(page.locator('[data-note-board]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(view(page)).toBeHidden();
  // 노트 첨부 파일 칸: 막대 [열기]
  await later(page);
  const att = kind(page, 'file').filter({ hasText: '가상 회의록.pdf' });
  await att.locator('.nb-tx').click();
  await page.locator('[data-nb-bar] [data-nb-file-open]').click();
  await expect(view(page)).toBeVisible();
  await expect(view(page)).toContainText('첨부 있는 노트');
  await expect(view(page).locator('button', { hasText: '노트 열기' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('B10 보안: 다른 작업공간 자료 id는 서버가 거절 — 화면은 알리고 칸을 남기지 않음 · 틀린 id는 보내지 않음 (1280)', async ({ page }) => {
  const { errors, textCalls } = await fixture(page, 1280);
  const sb = await box(page.locator('[data-nb-scroll]'));
  await dropAt(page, sb.x + 140, sb.y + sb.height - 140, { 'application/x-kptu-doc-ref': FOREIGN }); // 내 자료실에 없는(다른 작업공간) 자료
  await expect.poll(() => posts(textCalls, 'file').length).toBe(1);
  await expect(page.locator('#toast, .kptu-toast').filter({ hasText: '상자를 저장하지 못했어요' }).first()).toBeVisible();
  await expect(kind(page, 'file')).toHaveCount(0);
  await dropAt(page, sb.x + 160, sb.y + sb.height - 160, { 'application/x-kptu-doc-ref': '../../etc' }); // id 모양이 아니면 보내지 않음
  await later(page, 400);
  expect(posts(textCalls, 'file')).toHaveLength(1);
  // 고르기 창 [자료실]에는 내 자료만(서버 owner RLS로 읽은 목록)
  await insert(page, 'file');
  await expect(picker(page).locator('[data-nbm-pick-row]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('B10 적용 전 서버(표·파일 칸 없음): 옛 보드는 그대로 · [표]·[파일]은 준비 중 한 줄 · 서버에 안 보냄 (1280)', async ({ page }) => {
  const { errors, textCalls } = await fixture(page, 1280, { old: true });
  await expect(cell(page, 'tp')).toBeVisible();
  await insert(page, 'table');
  await expect(page.locator('#toast, .kptu-toast').filter({ hasText: '준비 중' }).first()).toBeVisible();
  await insert(page, 'file');
  await expect(picker(page)).toBeHidden();
  expect(posts(textCalls)).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('B10 PC: 보드 HTML 내보내기에 표 칸 글·파일 이름이 들어감(파일은 이름만) (1280)', async ({ page }) => {
  const seed = [...SEED, { id: 'tb', board_id: BID, body: '', kind: 'table', shape: 'rect', x: 320, y: 300, cells: [['가상 줄', '값'], ['둘째', '<i>x</i>']] },
    { id: 'fl', board_id: BID, body: '', kind: 'file', shape: 'rect', x: 700, y: 300, file_doc: DOC }];
  const { errors } = await fixture(page, 1280, { seed });
  await expect(cell(page, 'fl').locator('.nb-file-name')).toHaveText('가상 계획서');
  await page.locator('[data-nbb-board]').first().click({ button: 'right' });
  const dl = page.waitForEvent('download');
  await page.locator('[data-nbb-menu] [data-nbb-export="html"]').click();
  const html = readFileSync(await (await dl).path(), 'utf8');
  for (const s of ['가상 줄', '둘째', '&lt;i&gt;x&lt;/i&gt;', '가상 계획서']) expect(html).toContain(s);
  expect(html).not.toContain('<i>x</i>');
  expect(html).not.toContain('nb-file-meta');
  expect(errors).toEqual([]);
});

test.describe('폰', () => {
test.use({ hasTouch: true });
test('B10 폰: [표] → 칸 두 번 눌러 글쓰기 · 바깥 누르면 저장 · 파일 칸 두 번 누르면 아래 판 미리보기 · 가로 넘침 없음 (390)', async ({ page }) => {
  const seed = [{ id: 'tp', board_id: BID, body: '큰 주제', x: 200, y: 140 }, { id: 'fl', board_id: BID, body: '', kind: 'file', shape: 'rect', x: 120, y: 470, file_note: NOTE, file_drive: 'driveAtt_01' }];
  const { errors, textCalls } = await fixture(page, 390, { seed, compact: true });
  await insert(page, 'table', true);
  await expect.poll(() => posts(textCalls, 'table').length).toBe(1);
  const t = kind(page, 'table');
  await expect(t.locator('td')).toHaveCount(9);
  await later(page);
  await t.locator('td[data-nb-cell="0,0"]').tap();
  await later(page);
  await t.locator('td[data-nb-cell="0,0"]').tap();
  await expect(edit(page)).toBeFocused();
  await page.keyboard.type('폰 글');
  const sb = await box(page.locator('[data-nb-scroll]'));
  await page.touchscreen.tap(sb.x + sb.width - 20, sb.y + 60); // 바깥 = 저장
  await expect(edit(page)).toHaveCount(0);
  await expect.poll(() => patches(textCalls).length).toBe(1);
  expect(patches(textCalls)[0].body.cells[0][0]).toBe('폰 글');
  await expect(t.locator('td').first()).toHaveText('폰 글');
  // 파일 칸: 한 번 = 고르기, 한 번 더 = 아래 판 미리보기
  await later(page);
  await cell(page, 'fl').locator('.nb-tx').tap();
  await later(page);
  await cell(page, 'fl').locator('.nb-tx').tap();
  await expect(view(page)).toBeVisible();
  await expect(view(page)).toHaveClass(/nbm-view-sheet/);
  await expect(view(page).locator('.nbm-view-title')).toHaveText('가상 회의록.pdf');
  await expect(page.locator('[data-note-board]')).toBeVisible();
  await page.goBack();
  await expect(view(page)).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});
});
