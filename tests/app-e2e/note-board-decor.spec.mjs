import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S69-91 ① 노트 › 보드 글자·도형·선 넣기(사용자 11/25 03:01 "파워포인트 처럼 도형 삽입 선 삽입 등 꾸밈 입력 자유롭게",
// 03:03 "배경 없는 텍스트도 추가 가능하게 크기 자유 이동 자유로워서 선 위에 놓기 등 자유롭게").
// - [글자] = 배경·테두리 없는 글: 쓰기·크기·옮기기, 선 위에 겹쳐 놓아도 가지로 붙거나 밀려나지 않음, [앞으로]·[뒤로].
// - [도형▾] = 글 없는 도형: 고르기·손잡이 크기·옮기기·채우기·테두리(색·두께·점선)·안에 글 쓰기, 손잡이로 선 잇기.
// - [선▾] = 양 끝이 판 위 점인 선: 고르면 양 끝 동그라미, 끝을 도형에 놓으면 붙어서 도형을 옮기면 따라옴, 선 메뉴 꺾은선·색·두께.
// - 새로고침 뒤 그대로. 꾸미기·선 칸이 없는 서버는 서버에 보내지 않고 '준비 중'. 폰 390·PC 1280, 이름·글은 지어낸 것.
test.use({ hasTouch: true });
test.describe.configure({ timeout: 60000 });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BID = 'bdeco001';
const DEF = { parent_id: null, ord: 0, side: null, kind: 'topic', color: null, shape: 'round', font: 2, w: null, collapsed: false, h: null, pinned: false,
  z: 0, stroke: null, stroke_w: null, dash: false, alpha: null, bold: false, align: null, ink: null };
const DECOR = ['z', 'stroke', 'stroke_w', 'dash', 'alpha', 'bold', 'align', 'ink'], LINES = ['from_x', 'from_y', 'to_x', 'to_y', 'color', 'width'];
async function fixture(page, width, { old = false, seed = [] } = {}) {
  await page.setViewportSize({ width, height: width > 600 ? 1000 : 860 }); // PC: 판 전체가 창 안에(넣은 칸을 창 스크롤 없이 끌기)
  const errors = [], linkCalls = [], linkRows = [], textCalls = [], textRows = seed.map(t => ({ ...DEF, ...t }));
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: BID, name: '꾸밈 보드' }], note_board: BID });
  await openHome(page);
  const row = (id, title, board) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n본문', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { boards: { [BID]: board } } });
  const rows = [row('n1', '가 노트', { x: 40, y: 640, r: 1, z: 0 })];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  // 서버 흉내: old면 꾸미기·점 끝 칸을 물으면 42703(적용 전).
  const asks = (q, body, keys) => keys.some(k => new RegExp(`(^|,)${k}(,|$)`).test(q.get('select') || '')) || (body && keys.some(k => k in body));
  const missing = (r, table) => r.fulfill({ status: 400, json: { code: '42703', message: `column ${table}.z does not exist` } });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    linkCalls.push({ method, query: Object.fromEntries(q), body });
    if (old && asks(q, body, LINES)) return missing(r, 'app_note_board_links');
    if (method === 'GET') return r.fulfill({ json: structuredClone(linkRows) });
    if (method === 'POST') { const saved = { id: `L${linkCalls.length}`, from_x: null, from_y: null, to_x: null, to_y: null, color: null, width: null, ...body }; delete saved.workspace_id; linkRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] }); }
    if (method === 'PATCH') { const hit = linkRows.find(l => 'eq.' + l.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(hit)] }); }
    if (method === 'DELETE') { const id = q.get('id')?.slice(3); for (let i = linkRows.length - 1; i >= 0; i--) if (linkRows[i].id === id) linkRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    textCalls.push({ method, query: Object.fromEntries(q), body });
    if (old && asks(q, body, DECOR)) return missing(r, 'app_note_board_texts');
    if (method === 'GET') return r.fulfill({ json: structuredClone(textRows) });
    if (method === 'POST') { const saved = { ...DEF, id: `T${textCalls.length}`, ...body }; delete saved.workspace_id; textRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] }); }
    if (method === 'PATCH') { const hit = textRows.find(t => 'eq.' + t.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(hit)] }); }
    if (method === 'DELETE') { const id = q.get('id')?.slice(3); for (let i = textRows.length - 1; i >= 0; i--) if (textRows[i].id === id) textRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await openBoard(page);
  return { errors, linkCalls, linkRows, textCalls, textRows };
}
async function openBoard(page) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(1);
}
const node = (page, text) => page.locator('[data-nb-texts] [data-nb-text]').filter({ has: page.locator('.nb-tx', { hasText: new RegExp(`^${text}$`) }) });
const editor = page => page.locator('[data-nb-text-edit]');
const bar = page => page.locator('[data-nb-bar]');
const rowBy = (rows, body) => rows.find(t => t.body === body);
const zoomOf = async page => Number(await page.locator('[data-note-board]').getAttribute('data-nb-zoom-now'));
async function box(l) { for (let i = 0; i < 20; i++) { const b = await l.boundingBox({ timeout: 2000 }).catch(() => null); if (b) return b; await new Promise(r => setTimeout(r, 50)); } return null; }
async function center(l) { const b = await box(l); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function drag(page, from, to, steps = 10) { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps }); await page.mouse.up(); }
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
async function swipe(cdp, from, to, steps = 10) { for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]); }
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const lastPatch = calls => calls.filter(c => c.method === 'PATCH').at(-1)?.body;
const near = (a, b, d = 3) => Math.abs(a - b) <= d;
const blankPoint = page => page.locator('[data-nb-scroll]').evaluate(el => {
  const r = el.getBoundingClientRect();
  for (let y = r.top + 90; y < r.bottom - 30; y += 20) for (let x = r.right - 60; x > r.left + 40; x -= 20) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !el.contains(hit) || hit.closest('[data-nb-card],[data-nb-text],.nb-tools,[data-nb-hit],.nb-node-bar')) continue;
    const near = [...el.querySelectorAll('[data-nb-card],[data-nb-text]')].some(n => { const b = n.getBoundingClientRect(); return x > b.left - 60 && x < b.right + 60 && y > b.top - 60 && y < b.bottom + 60; });
    if (!near) return { x, y };
  }
  return null;
});

const shapeEl = (page, id) => page.locator(`[data-nb-text="${id}"]`);
const kindRow = (rows, kind) => rows.find(t => t.kind === kind);
const grip = (page, id, side) => page.locator(`[data-nb-lend-of="${id}"][data-nb-lend="${side}"]`);
const dOf = (page, id) => page.locator(`[data-nb-line="${id}"] .nb-line`).getAttribute('d');
async function insert(page, which, kind) {
  await page.locator(`[data-nb-insert-open="${which}"]`).click();
  await page.locator(which === 'shape' ? `[data-nb-add-shape="${kind}"]` : `[data-nb-add-line="${kind}"]`).click();
}

test('PC: 글자 넣기(배경 없음)·도형 넣기·꾸미기·크기·옮기기, 선 넣기 → 끝을 도형에 붙이면 따라옴, 글자를 선 위에 겹쳐 놓기·겹침 순서, 새로고침 뒤 유지 (1280)', async ({ page }) => {
  const { errors, textCalls, textRows, linkCalls, linkRows } = await fixture(page, 1280);
  // [글자] → 바로 쓰기 → Enter 저장(종류 label, 배경·테두리 없음)
  await page.locator('[data-nb-add-label]').click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('선 위 글'); await page.keyboard.press('Enter');
  await expect.poll(() => kindRow(textRows, 'label')?.body).toBe('선 위 글');
  const label = node(page, '선 위 글');
  await expect(label).toHaveAttribute('data-kind', 'label');
  await expect(label).not.toHaveClass(/nb-pending/);
  await expect.poll(() => label.evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el).borderTopColor])).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
  // [도형▾] → 마름모: 글 없는 도형이 바로 골라진다(막대·손잡이 8개, 가지 단추 없음)
  await insert(page, 'shape', 'diamond');
  await expect.poll(() => kindRow(textRows, 'shape')?.shape).toBe('diamond');
  const sid = kindRow(textRows, 'shape').id, shape = shapeEl(page, sid);
  expect(kindRow(textRows, 'shape').body).toBe('');
  await expect(shape).toHaveClass(/nb-sel/);
  await expect(shape.locator('.nb-shape-art polygon')).toHaveCount(1);
  await expect(shape.locator('[data-nb-resize]:visible')).toHaveCount(8);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('[data-nb-bar-child]')).toBeHidden();
  // 꾸미기: 채우기 색 · 테두리 색·두께·점선 · 투명도
  await bar(page).locator('[data-nb-bar-open="tone"]').click();
  await bar(page).locator('[data-nb-tone="3"]').click();
  await expect.poll(() => kindRow(textRows, 'shape').color).toBe(3);
  await bar(page).locator('[data-nb-bar-open="stroke"]').click();
  await bar(page).locator('[data-nb-stroke="9"]').click();
  await bar(page).locator('[data-nb-sw="4"]').click();
  await bar(page).locator('[data-nb-bar-row="stroke"] [data-nb-dash]').click();
  await expect.poll(() => { const t = kindRow(textRows, 'shape'); return [t.stroke, t.stroke_w, t.dash]; }).toEqual([9, 4, true]);
  await expect(shape).toHaveAttribute('data-dash', '');
  // 크기: 오른쪽 아래 손잡이
  const s0 = await box(shape), se = await center(shape.locator('[data-nb-resize="se"]'));
  await drag(page, se, { x: se.x + 40, y: se.y + 30 });
  await expect.poll(() => kindRow(textRows, 'shape').w).toBeGreaterThan(140);
  const s1 = await box(shape); expect(s1.width).toBeGreaterThan(s0.width + 30); expect(s1.height).toBeGreaterThan(s0.height + 20);
  // 안에 글 쓰기(고른 도형 다시 누르기)
  await shape.locator('.nb-tx').click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('결정'); await page.keyboard.press('Enter');
  await expect.poll(() => kindRow(textRows, 'shape').body).toBe('결정');
  // [선▾] → 화살표 선: 양 끝 점, 바로 골라져 메뉴·끝 동그라미
  await insert(page, 'line', 'arrow');
  await expect.poll(() => linkRows.length).toBe(1);
  const lid = linkRows[0].id;
  expect([linkRows[0].from_note, linkRows[0].from_text, linkRows[0].to_text, linkRows[0].ends]).toEqual([null, null, null, 'end']);
  expect(linkRows[0].from_x).toBeGreaterThanOrEqual(0);
  await expect(grip(page, lid, 'to')).toBeVisible();
  // 끝(to)을 도형에 놓으면 붙는다(끄는 동안 선 메뉴는 숨어 놓을 곳을 가리지 않음)
  const g = await center(grip(page, lid, 'to')), sc = await center(shape);
  await drag(page, g, sc, 12);
  await expect.poll(() => [linkRows[0].to_text, linkRows[0].to_x]).toEqual([sid, null]);
  // 도형을 옮기면 선 끝이 따라온다(빈 곳을 눌러 선 메뉴를 닫고)
  const bl = await blankPoint(page); await page.mouse.click(bl.x, bl.y);
  await expect(page.locator('.nb-link-menu')).toBeHidden();
  const before = await dOf(page, lid), c0 = await center(shape), sx0 = kindRow(textRows, 'shape').x;
  await drag(page, c0, { x: c0.x + 80, y: c0.y + 60 }, 12);
  await expect.poll(() => kindRow(textRows, 'shape').x).toBeGreaterThan(sx0 + 40);
  await expect(shape).not.toHaveClass(/nb-pending/);
  await expect.poll(() => dOf(page, lid)).not.toBe(before);
  // 글자를 선 가운데 위에 겹쳐 놓는다: 가지로 붙지 않고 그 자리(자유), 맞춤선 Alt 없이도 밀려나지 않음
  const midOf = id => page.locator(`[data-nb-line="${id}"] .nb-hit`).evaluate(p => { const l = p.getTotalLength(), pt = p.getPointAtLength(l / 2), m = p.getScreenCTM(); return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f }; });
  const mid = await midOf(lid), lx0 = kindRow(textRows, 'label').x;
  await expect(label).not.toHaveClass(/nb-pending/);
  const lc = await center(label);
  await drag(page, lc, mid, 12);
  await expect.poll(() => kindRow(textRows, 'label').x).not.toBe(lx0);
  await expect.poll(async () => { const b = await box(label), m = await midOf(lid); return Math.hypot(b.x + b.width / 2 - m.x, b.y + b.height / 2 - m.y); }).toBeLessThan(12);
  expect(kindRow(textRows, 'label').parent_id).toBeNull();
  // 겹침 순서: 도형을 맨 앞으로 → 글자 뒤로
  await shape.locator('.nb-tx').click(); await page.keyboard.press('Escape');
  await shape.locator('.nb-tx').click();
  await bar(page).locator('[data-nb-bar-open="more"]').click();
  await bar(page).locator('[data-nb-z="1"]').click();
  await expect.poll(() => kindRow(textRows, 'shape').z).toBeGreaterThan(kindRow(textRows, 'label').z);
  // 선 메뉴(키보드: 선에 초점 + Enter): 꺾은선·색·두께
  await page.keyboard.press('Escape');
  await page.locator(`[data-nb-line="${lid}"] .nb-hit`).focus();
  await page.keyboard.press('Enter');
  const menu = page.locator('.nb-link-menu');
  await expect(menu).toBeVisible();
  await menu.locator('[data-nb-lshape="elbow"]').click();
  await menu.locator('[data-nb-lm-tint]').click();
  await menu.locator('[data-nb-lcolor="2"]').click();
  await menu.locator('[data-nb-lwidth="4"]').click();
  await expect.poll(() => [linkRows[0].shape, linkRows[0].color, linkRows[0].width]).toEqual(['elbow', 2, 4]);
  expect(await dOf(page, lid)).toMatch(/[HV]/);
  // 새로고침 뒤에도 그대로
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await page.waitForFunction(() => window.KPTURouter?.go);
  await openBoard(page);
  await expect(node(page, '선 위 글')).toHaveAttribute('data-kind', 'label');
  await expect(shapeEl(page, sid)).toHaveAttribute('data-shape', 'diamond');
  expect(await dOf(page, lid)).toMatch(/[HV]/);
  expect(textCalls.every(c => c.method === 'GET' || c.method === 'DELETE' || !c.body || !('workspace_id' in c.body) || c.body.workspace_id === 'w')).toBe(true);
  expect(errors).toEqual([]);
});

test('PC: 양 끝이 점인 선은 몸통을 끌어 통째로 옮기고, 끝을 빈 곳에 놓으면 점, 고른 도형 복제·삭제 (1280)', async ({ page }) => {
  const { errors, textRows, linkRows } = await fixture(page, 1280, { seed: [{ id: 's1', board_id: BID, body: '', kind: 'shape', shape: 'ellipse', x: 300, y: 200, w: 120, h: 80, z: 1 }] });
  await insert(page, 'line', 'line');
  await expect.poll(() => linkRows.length).toBe(1);
  const lid = linkRows[0].id, x0 = linkRows[0].from_x;
  await page.keyboard.press('Escape');
  const mid = await page.locator(`[data-nb-line="${lid}"] .nb-hit`).evaluate(p => { const l = p.getTotalLength(), pt = p.getPointAtLength(l / 2), m = p.getScreenCTM(); return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f }; });
  await drag(page, mid, { x: mid.x + 60, y: mid.y + 90 }, 10);
  await expect.poll(() => linkRows[0].from_x).toBeGreaterThan(x0 + 40);
  expect(linkRows[0].to_x - linkRows[0].from_x).toBe(160); // 길이 그대로
  // 끝(from)을 빈 곳으로 → 점 그대로(붙지 않음)
  const mid2 = await page.locator(`[data-nb-line="${lid}"] .nb-hit`).evaluate(p => { const l = p.getTotalLength(), pt = p.getPointAtLength(l / 2), m = p.getScreenCTM(); return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f }; });
  await page.mouse.click(mid2.x, mid2.y);
  await expect(page.locator('.nb-link-menu')).toBeVisible();
  const g = await center(grip(page, lid, 'from'));
  await drag(page, g, { x: g.x - 30, y: g.y + 60 }, 8);
  await expect.poll(() => linkRows[0].from_y).toBeGreaterThan(linkRows[0].to_y + 10);
  expect(linkRows[0].from_text).toBeNull();
  // 도형 복제 → 옆에 같은 모양, 삭제
  await page.keyboard.press('Escape');
  await page.locator('[data-nb-text="s1"] .nb-tx').click();
  await bar(page).locator('[data-nb-bar-open="more"]').click();
  await bar(page).locator('[data-nb-dup]').click();
  await expect.poll(() => textRows.filter(t => t.kind === 'shape').length).toBe(2);
  const copy = textRows.find(t => t.kind === 'shape' && t.id !== 's1');
  expect([copy.shape, copy.w, copy.h, copy.x, copy.y]).toEqual(['ellipse', 120, 80, 316, 216]);
  await expect(shapeEl(page, copy.id)).toHaveClass(/nb-sel/);
  await bar(page).locator('[data-nb-bar-del]').click();
  await expect.poll(() => textRows.length).toBe(1);
  expect(errors).toEqual([]);
});

test('폰: 글자·도형 넣기, 손가락으로 크기·옮기기, 선 넣기, 가로 넘침 없음 (390)', async ({ page }) => {
  const { errors, textRows, linkRows } = await fixture(page, 390);
  const cdp = await page.context().newCDPSession(page);
  await page.locator('[data-nb-add-label]').tap();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('폰 글자');
  const blank = await blankPoint(page);
  await page.touchscreen.tap(blank.x, blank.y);
  await expect.poll(() => kindRow(textRows, 'label')?.body).toBe('폰 글자');
  const label = node(page, '폰 글자');
  await expect(label).not.toHaveClass(/nb-pending/);
  const from = await center(label), x0 = kindRow(textRows, 'label').x;
  await touch(cdp, 'touchStart', [from]); await swipe(cdp, from, { x: from.x - 40, y: from.y + 60 }, 10); await touch(cdp, 'touchEnd', []);
  await expect.poll(() => kindRow(textRows, 'label').x).toBeLessThan(x0 - 20);
  await page.locator('[data-nb-insert-open="shape"]').tap();
  await page.locator('[data-nb-add-shape="round"]').tap();
  await expect.poll(() => kindRow(textRows, 'shape')?.shape).toBe('round');
  const shape = shapeEl(page, kindRow(textRows, 'shape').id);
  await expect(shape.locator('[data-nb-resize]:visible')).toHaveCount(8);
  const se = await center(shape.locator('[data-nb-resize="se"]')), grab = { x: se.x + 6, y: se.y + 6 };
  await touch(cdp, 'touchStart', [grab]); await swipe(cdp, grab, { x: grab.x + 40, y: grab.y + 30 }, 8); await touch(cdp, 'touchEnd', []);
  await expect.poll(() => kindRow(textRows, 'shape').w).toBeGreaterThan(140);
  await page.locator('[data-nb-insert-open="line"]').tap();
  await page.locator('[data-nb-add-line="elbow"]').tap();
  await expect.poll(() => linkRows[0]?.shape).toBe('elbow');
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('꾸미기·선 칸 적용 전 서버: 글자·도형·선 넣기는 서버에 보내지 않고 준비 중 한 줄, 주제 상자는 그대로 (1280)', async ({ page }) => {
  const { errors, textCalls, linkCalls, textRows } = await fixture(page, 1280, { old: true });
  const posts = () => [...textCalls, ...linkCalls].filter(c => c.method === 'POST').length;
  await page.locator('[data-nb-add-label]').click();
  await expect(page.getByText('글자·도형·꾸미기는 아직 서버에 저장할 수 없어요(준비 중).')).toBeVisible();
  await page.locator('[data-nb-insert-open="line"]').click();
  await expect(page.getByText(/선 넣기·선 끝 옮기기·꺾은선·선 색은 아직 서버에 저장할 수 없어요/)).toBeVisible();
  await expect(page.locator('[data-nb-insert="line"]')).toBeHidden();
  expect(posts()).toBe(0);
  await page.locator('[data-nb-add-text]').click();
  await page.keyboard.type('옛 주제'); await page.keyboard.press('Enter');
  await expect.poll(() => textRows.map(t => t.body)).toEqual(['옛 주제']);
  expect(textCalls.filter(c => c.method === 'POST').every(c => !Object.keys(c.body).some(k => DECOR.includes(k)))).toBe(true);
  expect(errors).toEqual([]);
});
