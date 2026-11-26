import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S69-88 노트 › 보드 상자·카드 크기·자유 이동(명진 11/25 02:46~02:48 "입력창 자체를 자유자재로 크기 조절 … 높이 폭 모두",
// "이동도 자유롭고 파워포인트처럼", "노트 내용, 링크는 유지하더라도 텍스트는 다르게").
// - 고른 상자·카드에 크기 손잡이 8개(모서리 = 폭·높이, 변 = 그 방향만, 왼쪽·위는 반대편 고정), 끄는 동안 따라오고 놓으면 저장, 새로고침 뒤 유지.
// - 글 쓰는 중 입력칸 = 상자와 같은 크기(브라우저 기본 크기 손잡이 없음), 글 쓰는 중에도 손잡이.
// - 가지를 빈 곳에 끌어 두면 그 자리(자동 배치가 덮어쓰지 않음), [⋯] [자동 배치로]·[크기 자동]. 화살표 1px·Shift 10px, Alt+화살표 = 옆 상자.
// - 카드 [보드에 보일 글자]: 이 보드에서만 그 글자, 누르면 원래 노트가 열리고 노트 제목은 그대로. 이름·글은 지어낸 것.
test.use({ hasTouch: true });
test.describe.configure({ timeout: 60000 }); // 끌기·새로고침이 여러 번 든 긴 시험
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
// S69-83: [전체](모든 노트 판)는 없앴다 — 이름 붙은 보드 하나(BID)에서 시험한다.
const BID = 'bsize001';
const MAP = ['parent_id', 'ord', 'side', 'kind', 'color', 'shape', 'font', 'w', 'collapsed', 'h', 'pinned'];
const DEF = { parent_id: null, ord: 0, side: null, kind: 'topic', color: null, shape: 'round', font: 2, w: null, collapsed: false, h: null, pinned: false };
async function fixture(page, width, { frameless = false, seed = [] } = {}) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [], linkCalls = [], linkRows = [], textCalls = [], textRows = seed.map(t => ({ ...DEF, ...t }));
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: BID, name: '틀 보드' }], note_board: BID });
  await openHome(page);
  const row = (id, title, board) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n본문', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { boards: { [BID]: board } } });
  const rows = [row('n1', '가 노트', { x: 40, y: 600, r: 1, z: 0 })];
  page.noteRows = rows;
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    linkCalls.push({ method, query: Object.fromEntries(q), body });
    if (method === 'GET') return r.fulfill({ json: structuredClone(linkRows) });
    if (method === 'POST') { const saved = { id: `L${linkCalls.length}`, ...body }; delete saved.workspace_id; linkRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] }); }
    if (method === 'DELETE') { const id = q.get('id')?.slice(3); for (let i = linkRows.length - 1; i >= 0; i--) if (linkRows[i].id === id) linkRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  // 서버 흉내: 상자 표. 틀 칸(h·pinned)이 없는 서버(frameless)는 그 칸을 물으면 42703. 지우면 아래 가지·붙은 선도 지운다(cascade).
  const FRAME = ['h', 'pinned'];
  const shape = t => (frameless ? Object.fromEntries(Object.entries(t).filter(([k]) => !FRAME.includes(k))) : t);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    textCalls.push({ method, query: Object.fromEntries(q), body });
    if (frameless && (/(^|,)(h|pinned)(,|$)/.test(q.get('select') || '') || (body && FRAME.some(k => k in body)))) return r.fulfill({ status: 400, json: { code: '42703', message: 'column app_note_board_texts.h does not exist' } });
    if (method === 'GET') return r.fulfill({ json: textRows.map(t => structuredClone(shape(t))) });
    if (method === 'POST') { const saved = { ...DEF, id: `T${textCalls.length}`, ...body }; delete saved.workspace_id; textRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(shape(saved))] }); }
    if (method === 'PATCH') { const hit = textRows.find(t => 'eq.' + t.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(shape(hit))] }); }
    if (method === 'DELETE') {
      const gone = new Set([q.get('id')?.slice(3)]);
      let grew = true; while (grew) { grew = false; for (const t of textRows) if (t.parent_id && gone.has(t.parent_id) && !gone.has(t.id)) { gone.add(t.id); grew = true; } }
      for (let i = textRows.length - 1; i >= 0; i--) if (gone.has(textRows[i].id)) textRows.splice(i, 1);
      for (let i = linkRows.length - 1; i >= 0; i--) if (gone.has(linkRows[i].from_text) || gone.has(linkRows[i].to_text)) linkRows.splice(i, 1);
      return r.fulfill({ json: [] });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await openBoard(page);
  return { errors, linkCalls, linkRows, textCalls, textRows, noteRows: rows };
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


test('PC: 고른 상자 손잡이 8개 — 모서리·변·왼쪽 위(반대편 고정) 크기, 글 쓰는 중 입력칸 = 상자 크기·손잡이, 새로고침 뒤 유지, 크기 자동 (1280)', async ({ page }) => {
  const { errors, textCalls, textRows } = await fixture(page, 1280, { seed: [{ id: 'r', board_id: BID, body: '가운데 주제', x: 160, y: 380, font: 3 }, { id: 'g1', board_id: BID, body: '가지 하나', parent_id: 'r', ord: 0, side: 1 }] });
  const root = page.locator('[data-nb-text="r"]'); // 글 쓰는 중에도 같은 상자(안 글은 입력칸 뒤에 숨음)
  await root.locator('.nb-tx').click();
  await expect(root).toHaveClass(/nb-sel/);
  await expect(root.locator('[data-nb-resize]:visible')).toHaveCount(8);
  await expect(node(page, '가지 하나').locator('[data-nb-resize]:visible')).toHaveCount(0); // 고른 상자에만
  const z = await zoomOf(page), b0 = await box(root);
  // 오른쪽 아래 모서리 = 폭·높이 함께(끄는 동안 바로 따라온다).
  const se = await center(root.locator('[data-nb-resize="se"]'));
  await page.mouse.move(se.x, se.y); await page.mouse.down();
  await page.mouse.move(se.x + 60, se.y + 30, { steps: 5 });
  const mid = await box(root);
  expect(mid.width).toBeGreaterThan(b0.width + 40); expect(mid.height).toBeGreaterThan(b0.height + 15);
  await page.mouse.up();
  await expect.poll(() => rowBy(textRows, '가운데 주제').w).toBeGreaterThan(0);
  // S71-16: 서버 흉내 줄은 PATCH마다 그 자리에서 바뀐다 — 다음 끌기와 견줄 값은 지금 값을 복사해 둔다(같은 줄을 가리키면 다음 저장이 먼저 오면 기준도 같이 커진다).
  const r1 = { ...rowBy(textRows, '가운데 주제') };
  expect(near(r1.w, Math.round(b0.width / z + 60 / z), 3)).toBe(true); expect(near(r1.h, Math.round(b0.height / z + 30 / z), 3)).toBe(true);
  // 오른쪽 변 = 폭만(높이 그대로).
  const b1 = await box(root), e = await center(root.locator('[data-nb-resize="e"]'));
  await drag(page, e, { x: e.x + 40, y: e.y + 25 }, 5);
  await expect.poll(() => rowBy(textRows, '가운데 주제').w).toBeGreaterThan(r1.w + 20);
  expect(rowBy(textRows, '가운데 주제').h).toBe(r1.h);
  // 왼쪽 위 모서리: 오른쪽·아래 변은 그대로, 자리(x·y)가 함께 저장된다.
  const b2 = await box(root), nw = await center(root.locator('[data-nb-resize="nw"]'));
  await drag(page, nw, { x: nw.x - 30, y: nw.y - 20 }, 5);
  await expect.poll(() => rowBy(textRows, '가운데 주제').x).toBeLessThan(160);
  const b3 = await box(root);
  expect(near(b3.x + b3.width, b2.x + b2.width, 2)).toBe(true); expect(near(b3.y + b3.height, b2.y + b2.height, 2)).toBe(true);
  expect(b3.width).toBeGreaterThan(b2.width + 10);
  // 가지는 커진 뿌리 옆으로 다시 배치(겹치지 않음).
  const gb = await box(node(page, '가지 하나'));
  expect(gb.x).toBeGreaterThan(b3.x + b3.width);
  // 다시 누르면 글 쓰기 — 입력칸은 상자와 같은 크기, 브라우저 기본 크기 손잡이 없음(좁고 긴 칸이 아님).
  await root.locator('.nb-tx').click();
  await expect(editor(page)).toBeFocused();
  const eb = await box(editor(page)), nb = await box(root);
  expect(near(eb.width, nb.width - 2 * 2 * z, 6)).toBe(true); expect(eb.height).toBeLessThanOrEqual(nb.height);
  expect(await editor(page).evaluate(el => getComputedStyle(el).resize)).toBe('none');
  // 글 쓰는 중에도 아래 변 손잡이로 높이(입력칸 초점 그대로).
  await expect(root.locator('[data-nb-resize="s"]')).toBeVisible();
  const s = await center(root.locator('[data-nb-resize="s"]')), hBefore = rowBy(textRows, '가운데 주제').h;
  await drag(page, s, { x: s.x, y: s.y + 50 }, 5);
  await expect.poll(() => rowBy(textRows, '가운데 주제').h).toBeGreaterThan(hBefore + 20);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Escape');
  // 새로고침 뒤 그대로.
  const saved = { ...rowBy(textRows, '가운데 주제') }, before = await box(root);
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await page.waitForFunction(() => window.KPTURouter?.go);
  await openBoard(page);
  const z2 = await zoomOf(page), after = await box(node(page, '가운데 주제'));
  expect(near(after.width / z2, saved.w, 2)).toBe(true); expect(after.height / z2).toBeGreaterThanOrEqual(saved.h - 1);
  expect(near(after.width / after.height, before.width / before.height, 0.05)).toBe(true);
  // [⋯] [크기 자동] = 글 길이만큼으로.
  await node(page, '가운데 주제').locator('.nb-tx').click();
  await bar(page).locator('[data-nb-bar-open="more"]').click();
  await expect(bar(page).locator('[data-nb-auto]')).toBeHidden(); // 뿌리는 늘 자기 자리
  await bar(page).locator('[data-nb-autosize]').click();
  await expect.poll(() => lastPatch(textCalls)).toEqual({ w: null, h: null });
  await expect(node(page, '가운데 주제')).not.toHaveAttribute('style', /width|min-height/);
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('PC: 가지를 빈 곳에 끌어 두면 그 자리(자동 배치가 덮어쓰지 않음, 가지 선 따라감)·맞춤선, 화살표 1px·Shift 10px·Alt 옆 상자, 자동 배치로 (1280)', async ({ page }) => {
  const { errors, textCalls, textRows } = await fixture(page, 1280, { seed: [{ id: 'r', board_id: BID, body: '가운데 주제', x: 160, y: 380, font: 3 }, { id: 'g1', board_id: BID, body: '가지 하나', parent_id: 'r', ord: 0, side: 1 }, { id: 'g2', board_id: BID, body: '가지 둘', parent_id: 'r', ord: 1024, side: 1 }] });
  const g1 = node(page, '가지 하나'), from = await center(g1), far = await blankPoint(page);
  // 끄는 동안 다른 상자와 줄이 맞으면 맞춤선이 보인다(뿌리 위 끝과 같은 높이로 옮겨 본다).
  const rb = await box(node(page, '가운데 주제')), gb = await box(g1);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(far.x, rb.y + gb.height / 2 + 2, { steps: 10 });
  await expect(page.locator('[data-nb-guides] .nb-guide:not([visibility="hidden"])')).not.toHaveCount(0);
  await page.mouse.move(far.x, far.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('[data-nb-guides] .nb-guide:not([visibility="hidden"])')).toHaveCount(0);
  await expect.poll(() => rowBy(textRows, '가지 하나').pinned).toBe(true);
  expect(rowBy(textRows, '가지 하나').parent_id).toBe('r');
  await expect(g1).toHaveAttribute('data-pinned', '');
  const placed = await box(g1);
  expect(near(placed.x + placed.width / 2, far.x, 12)).toBe(true);
  await expect(page.locator('[data-nb-branches] .nb-branch')).toHaveCount(2); // 가지 선은 그대로(따라감)
  // 새 가지를 더해도(자동 배치가 다시 돌아도) 옮겨 둔 자리는 그대로.
  await node(page, '가운데 주제').locator('.nb-tx').click();
  await page.keyboard.press('Tab');
  await page.keyboard.type('가지 셋'); await page.keyboard.press('Enter');
  await expect.poll(() => rowBy(textRows, '가지 셋')?.parent_id).toBe('r');
  const still = await box(g1);
  expect(near(still.x, placed.x, 1) && near(still.y, placed.y, 1)).toBe(true);
  // 화살표 = 1px, Shift+화살표 = 10px(0.5초 멈추면 저장 한 번).
  const x0 = rowBy(textRows, '가지 하나').x, y0 = rowBy(textRows, '가지 하나').y;
  await g1.locator('.nb-tx').focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => rowBy(textRows, '가지 하나').x).toBe(x0 + 2);
  expect(rowBy(textRows, '가지 하나').y).toBe(y0 + 10);
  // Alt+화살표 = 옆 상자로(왼쪽 = 부모).
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(node(page, '가운데 주제').locator('.nb-tx')).toBeFocused();
  // [⋯] [자동 배치로] = 다시 자동 배치.
  await g1.locator('.nb-tx').click();
  await expect(bar(page)).toBeVisible();
  await bar(page).locator('[data-nb-bar-open="more"]').click();
  await bar(page).locator('[data-nb-auto]').click();
  await expect.poll(() => rowBy(textRows, '가지 하나').pinned).toBe(false);
  await expect(g1).not.toHaveAttribute('data-pinned', '');
  const back = await box(g1), rb2 = await box(node(page, '가운데 주제'));
  expect(back.x).toBeGreaterThan(rb2.x + rb2.width); expect(back.x - (rb2.x + rb2.width)).toBeLessThan(80);
  // 다른 상자 가운데에 놓으면 지금처럼 그 아래 가지(손으로 둔 표시는 풀린다).
  const g2c = await center(node(page, '가지 둘'));
  await drag(page, await center(node(page, '가지 셋')), g2c, 10);
  await expect.poll(() => rowBy(textRows, '가지 셋').parent_id).toBe('g2');
  expect(textCalls.filter(c => c.method === 'PATCH').some(c => c.body.parent_id === 'g2' && c.body.pinned === false)).toBe(true);
  expect(errors).toEqual([]);
});

test('PC: 노트 카드 크기 손잡이·새로고침 뒤 유지, [보드에 보일 글자] — 눌러도 원래 노트가 열리고 노트 제목 그대로, 비우면 제목 (1280)', async ({ page }) => {
  const { errors, noteRows } = await fixture(page, 1280);
  const card = page.locator('[data-nb-card="n1"]');
  await card.locator('.nb-open').focus(); // 초점 = 고르기
  await expect(card).toHaveClass(/nb-sel/);
  await expect(card.locator('[data-nb-resize]:visible')).toHaveCount(8);
  const z = await zoomOf(page), c0 = await box(card), se = await center(card.locator('[data-nb-resize="se"]'));
  await drag(page, se, { x: se.x + 70, y: se.y + 36 }, 6);
  await expect.poll(() => noteRows[0].metadata.boards[BID].w).toBeGreaterThan(128);
  const p = noteRows[0].metadata.boards[BID];
  expect(near(p.w, Math.round(c0.width / z + 70 / z), 3)).toBe(true); expect(near(p.h, Math.round(c0.height / z + 36 / z), 3)).toBe(true);
  expect(p.x).toBe(40); expect(p.y).toBe(600); // 오른쪽 아래 손잡이는 자리를 그대로 둔다
  await expect(page.locator('[data-note-detail]')).toBeHidden(); // 크기 바꾸기는 노트 열기가 아니다
  // ⋯ → [보드에 보일 글자].
  await card.locator('[data-note-row-more]').click();
  await page.locator('#noteDocMenu [data-nbb-label]').click();
  const ask = page.locator('.kptu-ask');
  await expect(ask).toBeVisible();
  await ask.locator('input').fill('산별 전환 요약');
  await ask.getByRole('button', { name: '확인' }).click();
  await expect.poll(() => noteRows[0].metadata.boards[BID].label).toBe('산별 전환 요약');
  expect(noteRows[0].metadata.boards[BID].w).toBe(p.w); // 크기는 그대로
  await expect(card.locator('.nb-title')).toHaveText('산별 전환 요약');
  await expect(card).toHaveAttribute('data-nb-alias', '');
  await expect(card.locator('.nb-open')).toHaveAttribute('title', /노트: 가 노트/);
  expect(noteRows[0].title).toBe('가 노트'); // 노트 제목·내용은 그대로
  expect(noteRows[0].raw_text).toBe('가 노트\n본문');
  // 비우면 노트 제목으로 → 다시 별명.
  const relabel = async text => {
    await card.locator('[data-note-row-more]').click();
    await page.locator('#noteDocMenu [data-nbb-label]').click();
    await expect(ask).toBeVisible();
    await ask.locator('input').fill(text);
    await ask.getByRole('button', { name: '확인' }).click();
  };
  await relabel('');
  await expect.poll(() => noteRows[0].metadata.boards[BID].label).toBe(undefined);
  await expect(card.locator('.nb-title')).toHaveText('가 노트');
  await expect(card).not.toHaveAttribute('data-nb-alias', '');
  await relabel('산별 전환 요약');
  await expect(card.locator('.nb-title')).toHaveText('산별 전환 요약');
  // 새로고침 뒤 그대로.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await page.waitForFunction(() => window.KPTURouter?.go);
  await openBoard(page);
  await expect(card.locator('.nb-title')).toHaveText('산별 전환 요약');
  const z2 = await zoomOf(page), c2 = await box(card);
  expect(near(c2.width / z2, p.w, 2)).toBe(true); expect(near(c2.height / z2, p.h, 2)).toBe(true);
  // [카드 크기 자동] = 처음 크기(별명은 그대로).
  await card.locator('.nb-open').focus(); // 고른 카드에만 ⋯가 보인다
  await card.locator('[data-note-row-more]').click();
  await page.locator('#noteDocMenu [data-nbb-autosize]').click();
  await expect.poll(() => noteRows[0].metadata.boards[BID].w).toBe(undefined);
  expect(noteRows[0].metadata.boards[BID]).toEqual({ x: 40, y: 600, r: 1, z: expect.any(Number), label: '산별 전환 요약' });
  // 누르면 원래 노트가 열린다(노트 제목 그대로).
  await card.locator('.nb-open').click();
  await expect(page.locator('[data-note-detail]')).toBeVisible();
  await expect(page.locator('[data-note-detail]')).toContainText('가 노트');
  await expect(page.locator('[data-note-detail]')).not.toContainText('산별 전환 요약');
  expect(errors).toEqual([]);
});

test('폰: 새 상자는 가로가 넉넉한 한 줄(좁고 긴 칸·기본 손잡이 없음), 고른 상자 모서리를 손가락으로 끌어 크기, 몸통 끌어 옮기기, 가로 넘침 없음 (390)', async ({ page }) => {
  const width = 390;
  const { errors, textRows } = await fixture(page, width);
  const cdp = await page.context().newCDPSession(page);
  await page.locator('[data-nb-add-text]').tap();
  await expect(editor(page)).toBeFocused();
  const eb = await box(editor(page));
  expect(eb.width).toBeGreaterThan(eb.height * 2.5); // 가로가 넉넉한 한 줄
  expect(eb.height).toBeLessThan(70);
  expect(await editor(page).evaluate(el => [getComputedStyle(el).resize, getComputedStyle(el).minHeight])).toEqual(['none', '0px']);
  await page.keyboard.type('폰 상자');
  let blank = await blankPoint(page);
  await page.touchscreen.tap(blank.x, blank.y);
  await expect.poll(() => textRows.map(t => t.body)).toEqual(['폰 상자']);
  const n = node(page, '폰 상자');
  await n.locator('.nb-tx').tap();
  await expect(n).toHaveClass(/nb-sel/);
  await expect(n.locator('[data-nb-resize]:visible')).toHaveCount(8);
  // 손가락으로 오른쪽 아래 모서리 끌기(보이는 점보다 넓은 잡는 칸).
  const b0 = await box(n), se = await center(n.locator('[data-nb-resize="se"]'));
  const grab = { x: se.x + 6, y: se.y + 6 };
  await touch(cdp, 'touchStart', [grab]); await swipe(cdp, grab, { x: grab.x + 50, y: grab.y + 40 }, 8); await touch(cdp, 'touchEnd', []);
  await expect.poll(() => rowBy(textRows, '폰 상자').h).toBeGreaterThan(0);
  const b1 = await box(n);
  expect(b1.width).toBeGreaterThan(b0.width + 30); expect(b1.height).toBeGreaterThan(b0.height + 25);
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  // 몸통 끌어 옮기기.
  const from = await center(n), x0 = rowBy(textRows, '폰 상자').x;
  await touch(cdp, 'touchStart', [from]); await swipe(cdp, from, { x: from.x - 60, y: from.y + 50 }, 10); await touch(cdp, 'touchEnd', []);
  await expect.poll(() => rowBy(textRows, '폰 상자').x).toBeLessThan(x0 - 20);
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('틀 칸 적용 전 서버: 폭은 저장·높이는 건너뜀, 가지를 빈 곳에 놓으면 옛 길(떼어 혼자 선 상자), 화면은 그대로 동작 (1280)', async ({ page }) => {
  const { errors, textCalls, textRows } = await fixture(page, 1280, { frameless: true, seed: [{ id: 'r', board_id: BID, body: '가운데 주제', x: 160, y: 380, font: 3 }, { id: 'g1', board_id: BID, body: '가지 하나', parent_id: 'r', ord: 0, side: 1 }] });
  const root = node(page, '가운데 주제');
  await expect(root).toHaveCount(1);
  await root.locator('.nb-tx').click();
  const se = await center(root.locator('[data-nb-resize="se"]'));
  await drag(page, se, { x: se.x + 50, y: se.y + 30 }, 5);
  await expect.poll(() => rowBy(textRows, '가운데 주제').w).toBeGreaterThan(0);
  const sent = textCalls.filter(c => c.method === 'PATCH').map(c => c.body);
  expect(sent.every(b => !('h' in b) && !('pinned' in b))).toBe(true);
  expect(textCalls.every(c => c.method !== 'PATCH' || c.query.select && !/(^|,)h(,|$)/.test(c.query.select))).toBe(true);
  const far = await blankPoint(page);
  await drag(page, await center(node(page, '가지 하나')), far, 10);
  await expect.poll(() => rowBy(textRows, '가지 하나').parent_id).toBe(null);
  await expect(page.locator('#toast')).not.toContainText('저장하지 못했어요');
  expect(errors).toEqual([]);
});
