import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S71-54 B9 노트 보드 주제 재료(사용자 결정 2026-11-26 19:58~59).
// - 잇기: 주제 우클릭(PC)·막대 […] 줄(폰) [재료 잇기] → 고르기 창 [노트]·[자료실]·[링크] → [잇기 n개]. PC는 노트 목록 줄·주소를 주제 위에 끌어 놓아도.
// - 칩: 주제 아래(3개 넘으면 '+n'), 누르면 보드 위 옆 칸(폰은 아래 판)에서 열어 보기 — 보드 그대로, 링크는 새 탭(noopener). 칩 ⋯ [잇기 풀기].
// - 반대 방향: 노트 읽기 화면 '이어진 생각지도 주제' → 그 보드의 그 주제로. javascript: 주소는 거절. 재료 칸이 없는 서버는 [재료 잇기]·칩 없음.
// 서버 흉내: 연결선 표의 kind 'material' 줄(mat_note·mat_doc·mat_url). PC 1280·폰 390. 이름·글은 지어낸 것.
test.describe.configure({ timeout: 60000 });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BID = 'bmat0001';
const DEF = { parent_id: null, parent_note: null, ord: 0, side: null, kind: 'topic', color: null, shape: 'round', font: 2, w: null, collapsed: false, h: null, pinned: false,
  z: 0, stroke: null, stroke_w: null, dash: false, alpha: null, bold: false, align: null, ink: null };
const LDEF = { from_note: null, to_note: null, from_text: null, to_text: null, from_side: null, to_side: null, shape: 'line', dash: 'solid', ends: 'end', label: null, bend_x: null, bend_y: null,
  from_x: null, from_y: null, to_x: null, to_y: null, color: null, width: null, kind: 'line', mat_doc: null, mat_url: null };
const CARD = '20000000-0000-4000-8000-000000000001', NOTE = '20000000-0000-4000-8000-000000000002', OTHER = '20000000-0000-4000-8000-000000000003';
const DOC = '30000000-0000-4000-8000-000000000001';
const SEED = [{ id: 'tp', board_id: BID, body: '큰 주제', x: 320, y: 120 }, { id: 'tp2', board_id: BID, body: '둘째 주제', x: 320, y: 300 }];
let clockAt = Date.parse('2026-10-06T01:00:00Z');
async function later(page, ms = 600) { clockAt += ms; await page.clock.setFixedTime(new Date(clockAt)); }
async function fixture(page, width, { old = false, links = [], seed = SEED, compact = false } = {}) {
  clockAt = Date.parse('2026-10-06T01:00:00Z');
  await page.setViewportSize({ width, height: width > 600 ? 1000 : 860 });
  const errors = [], linkCalls = [], textRows = seed.map(t => ({ ...DEF, ...t })), linkRows = links.map(l => ({ ...LDEF, ...l }));
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: BID, name: '재료 보드' }], note_board: BID, note_view: 'board' });
  await openHome(page);
  const row = (id, title, board, extra = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n본문 한 줄', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: board ? { boards: { [BID]: board } } : {}, ...extra });
  const rows = [row(CARD, '보드 위 노트', compact ? { x: 20, y: 120, r: 1, z: 0 } : { x: 60, y: 160, r: 1, z: 0 }),
    row(NOTE, '자료 정리 노트', null, { updated_at: '2026-10-12T01:00:00Z', raw_text: '자료 정리 노트\n재료로 쓸 본문' }), row(OTHER, '다른 노트', null)];
  const docs = [{ id: DOC, workspace_id: 'w', title: '회의 결과 문서', file_name: 'result.pdf', created_at: '2026-10-09T01:00:00Z', description: null, drive_url: 'https://drive.google.com/file/d/x/view' }];
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
  // 서버 흉내: old면 재료 칸(mat_doc·mat_url)을 물으면 42703(적용 전). 같은 주제·같은 재료는 한 줄(unique 409). 주소는 http/https만(check 400).
  const asksMat = (q, body) => /(^|,)(mat_note|mat_doc|mat_url)(,|$)/.test(q.get('select') || '') || (body && ('mat_note' in body || 'mat_doc' in body || 'mat_url' in body));
  const strip = l => (old ? Object.fromEntries(Object.entries(l).filter(([k]) => !['mat_note', 'mat_doc', 'mat_url'].includes(k))) : l);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    linkCalls.push({ method, query: Object.fromEntries(q), body });
    if (old && asksMat(q, body)) return r.fulfill({ status: 400, json: { code: '42703', message: 'column app_note_board_links.mat_doc does not exist' } });
    if (method === 'GET') {
      const keep = l => (!q.get('kind') || 'eq.' + l.kind === q.get('kind')) && (!q.get('mat_note') || 'eq.' + l.mat_note === q.get('mat_note')) && (!q.get('mat_doc') || 'eq.' + l.mat_doc === q.get('mat_doc'));
      return r.fulfill({ json: linkRows.filter(keep).map(l => structuredClone(strip(l))) });
    }
    if (method === 'POST') {
      if (body.kind === 'material' && body.mat_url && !/^https?:\/\/\S+$/.test(body.mat_url)) return r.fulfill({ status: 400, json: { code: '23514', message: 'app_note_board_links_url_check' } });
      if (body.kind === 'material' && linkRows.some(l => l.kind === 'material' && l.from_text === body.from_text && (l.mat_note || l.mat_doc || l.mat_url) === (body.mat_note || body.mat_doc || body.mat_url))) return r.fulfill({ status: 409, json: { code: '23505' } });
      const saved = { ...LDEF, id: `L${++seq}`, ...body }; delete saved.workspace_id; linkRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(strip(saved))] });
    }
    if (method === 'DELETE') { const id = q.get('id')?.slice(3); for (let i = linkRows.length - 1; i >= 0; i--) if (linkRows[i].id === id) linkRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    if (method === 'GET') { const id = q.get('id'), list = id?.startsWith('in.(') ? id.slice(4, -1).split(',') : null; return r.fulfill({ json: textRows.filter(t => !list || list.includes(t.id)).map(t => structuredClone(t)) }); }
    if (method === 'POST') { const saved = { ...DEF, id: `T${++seq}`, ...body }; delete saved.workspace_id; textRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] }); }
    if (method === 'PATCH') { const hit = textRows.find(t => 'eq.' + t.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(hit)] }); }
    if (method === 'DELETE') { const gone = q.get('id')?.slice(3); for (let i = textRows.length - 1; i >= 0; i--) if (textRows[i].id === gone) textRows.splice(i, 1); for (let i = linkRows.length - 1; i >= 0; i--) if (linkRows[i].from_text === gone || linkRows[i].to_text === gone) linkRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  // 링크 새 탭(밖 주소)은 이 시험 안에서 작은 글 한 장으로 답한다(밖으로 나가지 않음).
  await page.context().route('https://example.org/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>밖 글</title><p>밖 글</p>' }));
  await openBoard(page);
  return { errors, linkCalls, linkRows, textRows, rows };
}
async function openBoard(page) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  const sw = page.locator('.nv-switch [data-note-view="board"]');
  if ((await sw.getAttribute('aria-pressed')) !== 'true') await sw.click();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(1);
  await expect(page.locator('[data-nb-texts] [data-nb-text="tp"]')).toBeVisible();
  await later(page); // 보기 바꾸기 바로 뒤 누르기 막음(시험 시계는 멈춰 있음)
}
const cell = (page, id) => page.locator(`[data-nb-texts] [data-nb-text="${id}"]`);
const chips = (page, id) => cell(page, id).locator('[data-nb-mat]');
const menu = page => page.locator('#rowMenu');
const item = (page, name) => menu(page).locator('button').filter({ hasText: new RegExp(`^${name}$`) }).first();
const picker = page => page.locator('[data-nbm-pick]');
const view = page => page.locator('[data-nbm-view]');
const posts = calls => calls.filter(c => c.method === 'POST' && c.body?.kind === 'material');
async function box(l) { for (let i = 0; i < 20; i++) { const b = await l.boundingBox({ timeout: 2000 }).catch(() => null); if (b) return b; await new Promise(r => setTimeout(r, 50)); } return null; }
async function center(l) { const b = await box(l); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function openPickByMenu(page, id) {
  const c = await center(cell(page, id).locator('.nb-tx'));
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await item(page, '재료 잇기').click();
  await expect(picker(page)).toBeVisible();
}
// 브라우저 끌어 놓기(HTML 끌기)를 주제 위 한 점에 흉내 낸다: dragover → drop(같은 DataTransfer).
async function dropOn(page, target, data) {
  const c = await center(target);
  await page.evaluate(({ x, y, data }) => {
    const dt = new DataTransfer(); for (const [k, v] of Object.entries(data)) dt.setData(k, v);
    const el = document.elementFromPoint(x, y);
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, { x: c.x, y: c.y, data });
}

test('B9 PC: 우클릭 [재료 잇기] → 노트 · 자료실 · 링크를 한 번에 잇기 → 주제 아래 칩 셋 · 다시 열어도 그대로 · javascript: 주소 거절 (1280)', async ({ page, browser }) => {
  const { errors, linkCalls, linkRows } = await fixture(page, 1280);
  await openPickByMenu(page, 'tp');
  await expect(picker(page)).toContainText('재료 잇기 · 큰 주제');
  // [노트]: 최근 고친 순, 찾기
  await picker(page).locator('[data-nbm-find]').fill('정리');
  await picker(page).locator('[data-nbm-pick-row]', { hasText: '자료 정리 노트' }).click();
  await expect(picker(page).locator('[data-nbm-done]')).toHaveText('잇기 1개');
  // [자료실]
  await picker(page).locator('[data-nbm-tab="doc"]').click();
  await picker(page).locator('[data-nbm-pick-row]', { hasText: '회의 결과 문서' }).click();
  // [링크]: javascript: 는 거절(서버에 보내지 않음), http(s)만
  await picker(page).locator('[data-nbm-tab="link"]').click();
  await picker(page).locator('[data-nbm-url]').fill('javascript:alert(1)');
  await picker(page).locator('[data-nbm-add-link]').click();
  await expect(picker(page).locator('[data-nbm-err]')).toBeVisible();
  await picker(page).locator('[data-nbm-url]').fill('https://example.org/story?id=7');
  await picker(page).locator('[data-nbm-title]').fill('참고 기사');
  await picker(page).locator('[data-nbm-done]').click(); // 링크 칸에 적은 주소도 함께
  await expect(picker(page)).toBeHidden();
  await expect.poll(() => posts(linkCalls).length).toBe(3);
  expect(posts(linkCalls).map(c => c.body)).toEqual([
    expect.objectContaining({ board_id: BID, kind: 'material', from_text: 'tp', mat_note: NOTE, label: '자료 정리 노트' }),
    expect.objectContaining({ kind: 'material', from_text: 'tp', mat_doc: DOC, label: '회의 결과 문서' }),
    expect.objectContaining({ kind: 'material', from_text: 'tp', mat_url: 'https://example.org/story?id=7', label: '참고 기사' })]);
  expect(linkCalls.some(c => JSON.stringify(c.body || {}).includes('javascript:'))).toBe(false);
  for (const c of posts(linkCalls)) expect(c.body.workspace_id).toBe(await page.evaluate(() => window.KPTURuntime.context.read().workspace.id));
  await expect(chips(page, 'tp')).toHaveCount(3);
  await expect(chips(page, 'tp').locator('.nb-mat-name')).toHaveText(['자료 정리 노트', '회의 결과 문서', '참고 기사']);
  await expect(chips(page, 'tp').nth(0)).toHaveAttribute('data-kind', 'note');
  await expect(page.locator('[data-nb-lines] g')).toHaveCount(0); // 재료는 선으로 그리지 않는다
  // 칩은 주제 상자 아래(상자 안 맨 아래 줄)
  const tx = await box(cell(page, 'tp').locator('.nb-tx')), ch = await box(chips(page, 'tp').first());
  expect(ch.y).toBeGreaterThanOrEqual(tx.y + tx.height - 1);
  // 다시 열어도(서버 줄을 처음부터 읽음) 칩 그대로. 넷째부터는 '+n'.
  linkRows.push({ ...LDEF, id: 'X4', board_id: BID, kind: 'material', from_text: 'tp', mat_note: OTHER });
  const ctx = await browser.newContext(), again = await ctx.newPage();
  const second = await fixture(again, 1280, { links: linkRows.map(l => structuredClone(l)) });
  await expect(chips(again, 'tp')).toHaveCount(3);
  const plus = cell(again, 'tp').locator('[data-nb-mat-all]');
  await expect(plus).toHaveText('+1');
  await plus.click();
  await expect(chips(again, 'tp')).toHaveCount(4);
  await expect(cell(again, 'tp').locator('[data-nb-mat-all]')).toHaveText('접기');
  expect(second.errors).toEqual([]);
  await ctx.close();
  expect(errors).toEqual([]);
});

test('B9 PC: 칩 누르기 = 보드 위 옆 칸에서 열어 보기(보드 그대로) · 링크는 새 탭(noopener) · 칩 ⋯ [잇기 풀기] (1280)', async ({ page }) => {
  const links = [{ id: 'M1', board_id: BID, kind: 'material', from_text: 'tp', mat_note: NOTE, label: '옛 제목' },
    { id: 'M2', board_id: BID, kind: 'material', from_text: 'tp', mat_doc: DOC },
    { id: 'M3', board_id: BID, kind: 'material', from_text: 'tp', mat_url: 'https://example.org/a' },
    { id: 'BAD', board_id: BID, kind: 'material', from_text: 'tp2', mat_url: 'javascript:alert(1)' }];
  const { errors, linkCalls } = await fixture(page, 1280, { links });
  // 노트 이름은 지금 제목, 자료 이름은 자료실에서 읽은 이름, 링크는 주소 줄임. 서버에 javascript: 줄이 있어도 그리지 않는다.
  await expect(chips(page, 'tp').locator('.nb-mat-name')).toHaveText(['자료 정리 노트', '회의 결과 문서', 'example.org/…']); // 12자 넘으면 줄임
  await expect(chips(page, 'tp2')).toHaveCount(0);
  const url = page.url();
  await chips(page, 'tp').nth(0).locator('[data-nb-mat-open]').click();
  await expect(view(page)).toBeVisible();
  await expect(view(page).locator('.nbm-view-title')).toHaveText('자료 정리 노트');
  await expect(view(page)).toContainText('재료로 쓸 본문');
  await expect(page.locator('[data-note-board]')).toBeVisible(); // 보드를 떠나지 않음
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(1);
  expect(page.url()).toBe(url);
  const vb = await box(view(page)), sb = await box(page.locator('[data-nb-scroll]'));
  expect(vb.x + vb.width).toBeLessThanOrEqual(sb.x + sb.width + 10); expect(vb.width).toBeLessThan(sb.width * 0.6); // 판 오른쪽 옆 칸
  await page.keyboard.press('Escape');
  await expect(view(page)).toBeHidden();
  await chips(page, 'tp').nth(1).locator('[data-nb-mat-open]').click();
  await expect(view(page).locator('.nbm-view-title')).toHaveText('회의 결과 문서');
  await expect(view(page)).toContainText('result.pdf');
  await expect(view(page).getByRole('button', { name: '자료실에서 보기' })).toBeVisible();
  await view(page).locator('.nbm-x').click();
  await expect(view(page)).toBeHidden();
  // 링크: 새 탭, 이 창을 건드리지 못함(opener 없음)
  const [popup] = await Promise.all([page.waitForEvent('popup'), chips(page, 'tp').nth(2).locator('[data-nb-mat-open]').click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe('https://example.org/a');
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
  await expect(view(page)).toBeHidden();
  // 칩 ⋯ → [잇기 풀기]
  await chips(page, 'tp').nth(1).locator('[data-nb-mat-more]').click();
  await expect(item(page, '열기')).toBeVisible();
  await item(page, '잇기 풀기').click();
  await expect(chips(page, 'tp')).toHaveCount(2);
  await expect.poll(() => linkCalls.filter(c => c.method === 'DELETE').map(c => c.query.id)).toEqual(['eq.M2']);
  // PC 칩 우클릭도 같은 칩 메뉴
  const c = await center(chips(page, 'tp').nth(0));
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await expect(item(page, '잇기 풀기')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('B9 PC: 노트 목록 줄·브라우저 주소를 주제 위에 끌어 놓으면 재료 · 빈 곳에 놓은 노트는 지금처럼 카드 (1280)', async ({ page }) => {
  const { errors, linkCalls, rows } = await fixture(page, 1280);
  const side = page.locator('[data-nbb-side]');
  if (!(await side.isVisible())) await page.locator('[data-nb-side-toggle]').click().catch(() => {});
  await expect(side).toBeVisible();
  // 실제 끌기: 노트 목록 줄 → 주제
  await side.locator(`[data-nbb-note="${NOTE}"]`).dragTo(cell(page, 'tp').locator('.nb-tx'));
  await expect.poll(() => posts(linkCalls).length).toBe(1);
  expect(posts(linkCalls)[0].body).toMatchObject({ kind: 'material', from_text: 'tp', mat_note: NOTE });
  await expect(chips(page, 'tp')).toHaveCount(1);
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(1); // 카드로 붙지 않음
  // 브라우저 주소(주소창·링크 끌기): text/uri-list + 제목
  await dropOn(page, cell(page, 'tp2').locator('.nb-tx'), { 'text/uri-list': 'https://example.org/drop', 'text/x-moz-url': 'https://example.org/drop\n끌어 온 글' });
  await expect.poll(() => posts(linkCalls).length).toBe(2);
  expect(posts(linkCalls)[1].body).toMatchObject({ from_text: 'tp2', mat_url: 'https://example.org/drop', label: '끌어 온 글' });
  await expect(chips(page, 'tp2').locator('.nb-mat-name')).toHaveText(['끌어 온 글']);
  // javascript: 주소는 끌어 놓아도 잇지 않는다
  await dropOn(page, cell(page, 'tp2').locator('.nb-tx'), { 'text/plain': 'javascript:alert(1)' });
  await expect(page.getByText('주제에는 노트·자료·http(s) 주소만 이을 수 있어요.')).toBeVisible();
  expect(posts(linkCalls)).toHaveLength(2);
  // 빈 곳에 놓은 노트 = 지금처럼 카드
  await side.locator(`[data-nbb-note="${OTHER}"]`).dragTo(page.locator('[data-nb-scroll]'), { targetPosition: { x: 300, y: 700 } });
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(2);
  await expect.poll(() => rows.find(r => r.id === OTHER).metadata.boards?.[BID]).toBeTruthy();
  expect(posts(linkCalls)).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('B9 PC: 노트 읽기 화면 "이어진 생각지도 주제" → 그 보드의 그 주제로 이동·고르기 (1280)', async ({ page }) => {
  const links = [{ id: 'M1', board_id: BID, kind: 'material', from_text: 'tp2', mat_note: CARD }];
  const { errors } = await fixture(page, 1280, { links });
  await page.locator('[data-note-board] [data-nb-card] .nb-open').dblclick();
  const line = page.locator('[data-note-topics]');
  await expect(line).toBeVisible();
  await expect(line).toContainText('이어진 생각지도 주제');
  await line.getByRole('button', { name: '둘째 주제' }).click();
  await expect(page.locator('[data-note-board]')).toBeVisible();
  await expect(cell(page, 'tp2')).toHaveClass(/nb-sel/);
  expect(errors).toEqual([]);
});

test('B9 PC: 보드 HTML 내보내기에 재료 이름 전체가 들어가고(⋯·+n 없음) 내보낸 뒤 칩은 다시 줄인 모양 (1280)', async ({ page }) => {
  const links = [{ id: 'M1', board_id: BID, kind: 'material', from_text: 'tp', mat_note: NOTE },
    { id: 'M2', board_id: BID, kind: 'material', from_text: 'tp', mat_url: 'https://example.org/a-very-long-path/story', label: '아주 긴 이름의 참고 기사 하나' },
    { id: 'M3', board_id: BID, kind: 'material', from_text: 'tp', mat_doc: DOC }, { id: 'M4', board_id: BID, kind: 'material', from_text: 'tp', mat_note: OTHER }];
  const { errors } = await fixture(page, 1280, { links });
  await expect(cell(page, 'tp').locator('[data-nb-mat-all]')).toHaveText('+1');
  await page.locator('[data-nbb-board]').first().click({ button: 'right' });
  const dl = page.waitForEvent('download');
  await page.locator('[data-nbb-menu] [data-nbb-export="html"]').click();
  const html = readFileSync(await (await dl).path(), 'utf8');
  for (const name of ['노트 · 자료 정리 노트', '링크 · 아주 긴 이름의 참고 기사 하나', '자료 · 회의 결과 문서', '노트 · 다른 노트']) expect(html).toContain(name);
  expect(html).not.toContain('data-nb-mat-more'); expect(html).not.toContain('data-nb-mat-all');
  await expect(cell(page, 'tp').locator('[data-nb-mat-all]')).toHaveText('+1');
  await expect(chips(page, 'tp')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('B9 적용 전 서버(재료 칸 없음): [재료 잇기]·칩 없음 · 주제 위 끌어 놓기도 안 받음 · 서버에 안 보냄 (1280)', async ({ page }) => {
  const { errors, linkCalls } = await fixture(page, 1280, { old: true });
  const c = await center(cell(page, 'tp').locator('.nb-tx'));
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  await expect(item(page, '재료 잇기')).toHaveCount(0);
  await expect(item(page, '관계 잇기')).toHaveCount(1); // 관계선 칸은 있음
  await page.keyboard.press('Escape');
  await dropOn(page, cell(page, 'tp').locator('.nb-tx'), { 'text/uri-list': 'https://example.org/x' });
  await expect(chips(page, 'tp')).toHaveCount(0);
  expect(linkCalls.filter(c => c.method !== 'GET')).toHaveLength(0);
  expect(errors).toEqual([]);
});

test.describe('폰', () => {
test.use({ hasTouch: true });
test('B9 폰: 주제 막대 […] [재료 잇기] → 아래 판 고르기 창 · 링크 잇기 · 칩 누르면 아래 판에서 열어 보기 · 가로 넘침 없음 (390)', async ({ page }) => {
  const seed = [{ id: 'tp', board_id: BID, body: '큰 주제', x: 200, y: 140 }, { id: 'tp2', board_id: BID, body: '둘째 주제', x: 200, y: 320 }];
  const links = [{ id: 'M1', board_id: BID, kind: 'material', from_text: 'tp', mat_note: NOTE }];
  const { errors, linkCalls } = await fixture(page, 390, { seed, links, compact: true });
  await cell(page, 'tp').locator('.nb-tx').tap();
  await page.locator('[data-nb-bar] [data-nb-bar-open="more"]').tap();
  await page.locator('[data-nb-bar] [data-nb-material]').tap();
  await expect(picker(page)).toBeVisible();
  await expect(picker(page)).toHaveClass(/nbm-sheet/);
  const pb = await box(picker(page));
  expect(pb.width).toBeGreaterThan(380); // 아래 판(폭 전체)
  await picker(page).locator('[data-nbm-tab="link"]').tap();
  await picker(page).locator('[data-nbm-url]').fill('www.example.org/phone');
  await picker(page).locator('[data-nbm-add-link]').tap();
  await expect(picker(page).locator('[data-nbm-picked] .nbm-chip')).toHaveCount(1);
  await picker(page).locator('[data-nbm-done]').tap();
  await expect.poll(() => posts(linkCalls).length).toBe(1);
  expect(posts(linkCalls)[0].body).toMatchObject({ from_text: 'tp', mat_url: 'https://www.example.org/phone', label: null });
  await expect(chips(page, 'tp')).toHaveCount(2);
  await later(page);
  await chips(page, 'tp').nth(0).locator('[data-nb-mat-open]').tap();
  await expect(view(page)).toBeVisible();
  await expect(view(page)).toHaveClass(/nbm-view-sheet/);
  await expect(view(page).locator('.nbm-view-title')).toHaveText('자료 정리 노트');
  await expect(page.locator('[data-note-board]')).toBeVisible();
  await page.goBack(); // 폰 뒤로가기 = 열어 보기 닫힘(보드 그대로)
  await expect(view(page)).toBeHidden();
  await expect(page.locator('[data-note-board]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});
});
