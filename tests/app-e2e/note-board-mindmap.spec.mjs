import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S69-82 노트 › 보드 → 브레인스토밍·마인드맵(명진 11/24 23:51 "전체를 브레인 스토밍 마인드맵 하게. 제대로 개선", docs/design/note-board-mindmap.md).
// - 상자(보드에만 있는 글, 서버 표 app_note_board_texts): 가로 글(글 길이만큼 폭), 고른 채 Tab = 하위 가지, Enter = 형제 가지, Delete = 지우기(아래가 있으면 확인).
// - 자동 배치(양쪽·겹침 없음), 끌면 가지째, 다른 상자 위에 놓으면 그 아래로, 빈 곳에 놓으면 떼어 혼자 선 상자. 접기·펼치기.
// - 고른 상자 위 막대: 색·모양·글자 크기·+ 하위·+ 형제·삭제. 손잡이로 잇기(가까이 놓아도 붙음, 빈 곳 = 새 상자 + 선).
// - 생각 지도 칸이 아직 없는 서버(적용 전)는 옛 상자를 혼자 선 상자로 보이고 가지·꾸미기만 '준비 중'. 이름·글은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
// S69-83: [전체](모든 노트 판)는 없앴다 — 이름 붙은 보드 하나(BID)에서 시험한다.
const BID = 'bmind001';
const MAP = ['parent_id', 'ord', 'side', 'kind', 'color', 'shape', 'font', 'w', 'collapsed', 'h', 'pinned'];
const DEF = { parent_id: null, ord: 0, side: null, kind: 'topic', color: null, shape: 'round', font: 2, w: null, collapsed: false, h: null, pinned: false };
async function fixture(page, width, { legacy = false, seed = [] } = {}) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [], linkCalls = [], linkRows = [], textCalls = [], textRows = seed.map(t => ({ ...DEF, ...t }));
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: BID, name: '생각 지도' }], note_board: BID });
  await openHome(page);
  const row = (id, title, board) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n본문', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { boards: { [BID]: board } } });
  const rows = [row('n1', '가 노트', { x: 40, y: 600, r: 1, z: 0 })];
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
  // 서버 흉내: 상자 표. 새 칸이 없는 서버(legacy)는 그 칸을 물으면 42703. 지우면 아래 가지·붙은 선도 지운다(cascade).
  const shape = t => (legacy ? Object.fromEntries(Object.entries(t).filter(([k]) => !MAP.includes(k))) : t);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    textCalls.push({ method, query: Object.fromEntries(q), body });
    if (legacy && (/parent_id/.test(q.get('select') || '') || (body && MAP.some(k => k in body)))) return r.fulfill({ status: 400, json: { code: '42703', message: 'column app_note_board_texts.parent_id does not exist' } });
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
  return { errors, linkCalls, linkRows, textCalls, textRows };
}
async function openBoard(page) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(1);
}
const nodes = page => page.locator('[data-nb-texts] [data-nb-text]:not([data-nb-text=""])');
const node = (page, text) => page.locator('[data-nb-texts] [data-nb-text]').filter({ has: page.locator('.nb-tx', { hasText: new RegExp(`^${text}$`) }) });
const editor = page => page.locator('[data-nb-text-edit]');
const bar = page => page.locator('[data-nb-bar]');
const rowBy = (rows, body) => rows.find(t => t.body === body);
async function center(l) { const b = await box(l); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
// 저장 답이 와서 바뀐 상자는 새로 그려지므로, 잰 순간 막 바뀐 요소면 다시 잰다.
async function box(l) { for (let i = 0; i < 20; i++) { const b = await l.boundingBox({ timeout: 2000 }).catch(() => null); if (b) return b; await new Promise(r => setTimeout(r, 50)); } return null; }
const blankPoint = (page, from = 'bottom') => page.locator('[data-nb-scroll]').evaluate((el, from) => {
  const r = el.getBoundingClientRect(), ys = [];
  for (let y = r.bottom - 30; y > r.top + 60; y -= 20) ys.push(y);
  if (from === 'top') ys.reverse();
  for (const y of ys) for (let x = r.right - 40; x > r.left + 40; x -= 20) {
    const hit = document.elementFromPoint(x, y);
    if (hit && el.contains(hit) && !hit.closest('[data-nb-card],[data-nb-text],.nb-tools,[data-nb-hit],.nb-node-bar')) {
      // 상자·카드에서 40px 넘게 떨어진 곳만(잇기 끝 붙이기·놓을 곳에 걸리지 않게).
      const near = [...el.querySelectorAll('[data-nb-card],[data-nb-text]')].some(n => { const b = n.getBoundingClientRect(); return x > b.left - 40 && x < b.right + 40 && y > b.top - 40 && y < b.bottom + 40; });
      if (!near) return { x, y };
    }
  }
  return null;
}, from);
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
async function swipe(cdp, from, to, steps = 10) { for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]); }
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const meet = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
async function drag(page, from, to, steps = 10) { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps }); await page.mouse.up(); }

test('PC: 주제 → Tab 하위·Enter 형제, 가로 글·자동 배치(양쪽·겹침 없음), 접기, 가지째 끌어 옮겨 붙이기·떼기 (1440)', async ({ page }) => {
  const { errors, textCalls, textRows } = await fixture(page, 1440);
  await expect(page.locator('[data-nb-add-text]')).toHaveText('+ 상자');
  // 주제 하나 → Enter = 저장(고른 채로).
  await page.locator('[data-nb-add-text]').click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('가운데 주제');
  await page.keyboard.press('Enter');
  await expect.poll(() => textRows.length).toBe(1);
  expect(textCalls.find(c => c.method === 'POST').body).toMatchObject({ board_id: BID, body: '가운데 주제', parent_id: null, font: 3 });
  const root = node(page, '가운데 주제');
  await expect(root.locator('.nb-tx')).toBeFocused();
  // Tab = 하위 가지 → 쓰고 Enter. 고른 채 Enter = 형제 가지.
  await page.keyboard.press('Tab');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('가지 하나'); await page.keyboard.press('Enter');
  await expect.poll(() => rowBy(textRows, '가지 하나')?.parent_id).toBe(rowBy(textRows, '가운데 주제').id);
  await expect(node(page, '가지 하나').locator('.nb-tx')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('가지 둘'); await page.keyboard.press('Tab'); // Tab = 저장하고 하위
  await expect.poll(() => rowBy(textRows, '가지 둘')?.parent_id).toBe(rowBy(textRows, '가운데 주제').id);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('더 아래'); await page.keyboard.press('Enter');
  await expect.poll(() => rowBy(textRows, '더 아래')?.parent_id).toBe(rowBy(textRows, '가지 둘').id);
  // 가지 셋(긴 글) — 최대 폭에서만 줄바꿈.
  await root.locator('.nb-tx').focus(); await page.keyboard.press('Tab');
  await page.keyboard.type('아주 길게 쓴 가지 글은 최대 폭에 닿을 때까지 가로로 늘어나고 그 뒤에만 줄을 바꾼다'); await page.keyboard.press('Enter');
  await expect(nodes(page)).toHaveCount(5);
  const ids = Object.fromEntries(textRows.map(t => [t.body.slice(0, 5), t.id]));
  // 가로 글: 짧은 글은 한 줄(높이 < 폭), 긴 글은 최대 폭 근처에서 줄바꿈.
  const short = await box(node(page, '가지 하나'));
  expect(short.width).toBeGreaterThan(short.height * 2);
  const long = await box(node(page, '아주 길게 쓴 가지 글은 최대 폭에 닿을 때까지 가로로 늘어나고 그 뒤에만 줄을 바꾼다'));
  expect(long.width).toBeGreaterThan(200); expect(long.width).toBeLessThanOrEqual(262 * 1.25);
  // 자동 배치: 뿌리 가지는 양쪽, 어느 두 상자도 겹치지 않는다, 가지 선이 그려진다.
  const rb = await box(root), sides = [];
  for (const t of ['가지 하나', '가지 둘']) { const b = await box(node(page, t)); sides.push(b.x > rb.x + rb.width ? 1 : b.x + b.width < rb.x ? -1 : 0); }
  expect(sides).not.toContain(0);
  const all = []; for (const el of await nodes(page).all()) all.push(await el.boundingBox());
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(meet(all[i], all[j]), `${i}-${j}`).toBe(false);
  await expect(page.locator('[data-nb-branches] .nb-branch')).toHaveCount(4);
  // 접기·펼치기(가지 둘 아래 '더 아래').
  await node(page, '가지 둘').locator('[data-nb-fold]').click();
  await expect(node(page, '더 아래')).toHaveCount(0);
  await expect.poll(() => rowBy(textRows, '가지 둘').collapsed).toBe(true);
  await expect(node(page, '가지 둘').locator('[data-nb-fold]')).toHaveText('1');
  await node(page, '가지 둘').locator('[data-nb-fold]').click();
  await expect(node(page, '더 아래')).toHaveCount(1);
  // 가지째 끌기: '가지 둘'을 끄는 동안 '더 아래'도 같이 움직이고, '가지 하나' 가운데에 놓으면 그 아래로.
  const g2 = node(page, '가지 둘'), low = node(page, '더 아래'), g1 = node(page, '가지 하나');
  const lowBefore = await box(low), g2Before = await box(g2), from = await center(g2), to = await center(g1);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 30, { steps: 4 });
  const lowMid = await box(low), g2Mid = await box(g2);
  // S69-88: 끄는 동안 맞춤선에 살짝 붙을 수 있다(6px 안) — 아래 가지는 끄는 상자와 똑같이 움직인다.
  expect(Math.abs(g2Mid.x - g2Before.x - 30)).toBeLessThanOrEqual(6); expect(Math.abs(g2Mid.y - g2Before.y - 30)).toBeLessThanOrEqual(6);
  expect(Math.round(lowMid.x - lowBefore.x)).toBe(Math.round(g2Mid.x - g2Before.x)); expect(Math.round(lowMid.y - lowBefore.y)).toBe(Math.round(g2Mid.y - g2Before.y));
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(g1).toHaveClass(/nb-drop-in/);
  await page.mouse.up();
  await expect.poll(() => rowBy(textRows, '가지 둘').parent_id).toBe(ids['가지 하나']);
  expect(rowBy(textRows, '더 아래').parent_id).toBe(ids['가지 둘']); // 아래 가지는 그대로 따라감
  // S69-88: 가지를 빈 곳에 놓으면 그 자리에 선다(손으로 둔 가지 — 가지는 그대로, 자동 배치가 덮어쓰지 않음). [⋯] [가지 떼기] = 혼자 선 상자.
  const blank = await blankPoint(page, 'top');
  await drag(page, await center(node(page, '가지 둘')), blank);
  await expect.poll(() => rowBy(textRows, '가지 둘').pinned).toBe(true);
  expect(rowBy(textRows, '가지 둘').parent_id).toBe(ids['가지 하나']);
  expect(rowBy(textRows, '가지 둘').x).toBeGreaterThan(0);
  await expect(bar(page)).toBeVisible(); // 끈 상자는 고른 채로 남는다
  await bar(page).locator('[data-nb-bar-open="more"]').click();
  await bar(page).locator('[data-nb-detach]').click();
  await expect.poll(() => rowBy(textRows, '가지 둘').parent_id).toBe(null);
  await expect(node(page, '가지 둘')).toHaveClass(/nb-root/);
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('PC: 선택한 상자 막대로 색·모양·글자 크기, 다시 눌러 수정(가로로 늘어남), 손잡이 잇기(가까이 놓아도 붙음·빈 곳 = 새 상자 + 선), 새로고침 뒤 유지, 아래 가지 있는 상자 바로 삭제·[되돌리기] (1440)', async ({ page }) => {
  const { errors, linkRows, textCalls, textRows } = await fixture(page, 1440, { seed: [{ id: 'r', board_id: BID, body: '가운데 주제', x: 600, y: 520, font: 3 }, { id: 'g1', board_id: BID, body: '가지 하나', parent_id: 'r', ord: 0, side: 1 },
    { id: 'lg', board_id: BID, body: '긴 가지', parent_id: 'r', ord: 1, side: -1 }, { id: 'g2', board_id: BID, body: '가지 둘', x: 300, y: 900 }, { id: 'low', board_id: BID, body: '더 아래', parent_id: 'g2', ord: 0 }] });
  await expect(nodes(page)).toHaveCount(5);
  // 막대: 고른 상자 위 → 색·모양·글자 크기 저장.
  await node(page, '가지 하나').locator('.nb-tx').click();
  await expect(bar(page)).toBeVisible();
  const bb = await box(bar(page)), nb = await box(node(page, '가지 하나'));
  expect(meet(bb, nb)).toBe(false); // 막대는 상자 위(자리가 없으면 아래)에 뜨고 상자를 덮지 않는다
  await bar(page).locator('[data-nb-bar-open="tone"]').click();
  await bar(page).locator('[data-nb-tone="3"]').click();
  await expect.poll(() => rowBy(textRows, '가지 하나').color).toBe(3);
  await expect(node(page, '가지 하나')).toHaveAttribute('data-tone', '3');
  await bar(page).locator('[data-nb-bar-open="shape"]').click();
  await bar(page).locator('[data-nb-shape="pill"]').click();
  await expect.poll(() => rowBy(textRows, '가지 하나').shape).toBe('pill');
  const heightOf = async () => (await box(node(page, '가지 하나')))?.height || 0;
  await expect.poll(heightOf).toBeGreaterThan(0);
  const h0 = await heightOf();
  await bar(page).locator('[data-nb-font="1"]').click();
  await expect.poll(() => rowBy(textRows, '가지 하나').font).toBe(3);
  await expect.poll(heightOf).toBeGreaterThan(h0);
  // 고른 상자 다시 누르기 = 글 고치기(가로로 늘어남), Enter = 저장.
  await node(page, '가지 하나').locator('.nb-tx').click();
  await expect(editor(page)).toBeFocused();
  const editing = page.locator('[data-nb-texts] .nb-editing'), w0 = (await box(editing)).width;
  await page.keyboard.press('End'); await page.keyboard.type(' 더하기');
  expect((await box(editing)).width).toBeGreaterThan(w0);
  await page.keyboard.press('Enter');
  await expect.poll(() => textCalls.filter(c => c.method === 'PATCH').at(-1)?.body).toEqual({ body: '가지 하나 더하기' });
  // 잇기: 손잡이를 노트 카드 가까이(카드 밖 10px)에 놓아도 붙는다. 먼저 [맞추기]로 카드·상자가 모두 보이게.
  await page.locator('[data-nb-fit]').click();
  const g1b = node(page, '가지 하나 더하기');
  await g1b.hover();
  const hand = await center(g1b.locator('[data-nb-handle="bottom"]')), cb = await box(page.locator('[data-nb-card="n1"]'));
  await page.mouse.move(hand.x, hand.y); await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2, cb.y - 10, { steps: 10 });
  await expect(page.locator('[data-nb-card="n1"]')).toHaveClass(/nb-target/);
  await page.mouse.up();
  await expect.poll(() => linkRows.length).toBe(1);
  expect(linkRows[0]).toMatchObject({ from_text: 'g1', to_note: 'n1' });
  // 빈 곳에 놓으면 그 자리 새 상자 → 쓰고 Enter → 상자와 선 저장.
  await g1b.hover();
  const hand2 = await center(g1b.locator('[data-nb-handle="right"]')), far = await blankPoint(page);
  await drag(page, hand2, far);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('이은 생각'); await page.keyboard.press('Enter');
  await expect.poll(() => linkRows.length).toBe(2);
  expect(linkRows[1]).toMatchObject({ from_text: 'g1', to_text: rowBy(textRows, '이은 생각').id });
  expect(rowBy(textRows, '이은 생각').parent_id).toBe(null);
  // 새로고침 뒤 그대로.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await page.waitForFunction(() => window.KPTURouter?.go);
  await openBoard(page);
  await expect(nodes(page)).toHaveCount(6);
  await expect(node(page, '가지 하나 더하기')).toHaveAttribute('data-shape', 'pill');
  await expect(page.locator('[data-nb-lines] [data-nb-line]')).toHaveCount(2);
  // 지우기: 아래 가지가 있는 뿌리 → Delete → 확인 창 없이 바로(K1 한 규칙 I-6: [되돌리기]가 있으니) → 뿌리와 아래 가지(가지 하나·더 아래 제외: '가지 둘'은 떼어 냄).
  await node(page, '가운데 주제').locator('.nb-tx').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.kptu-ask')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '되돌리기' })).toBeVisible();
  await expect(node(page, '가운데 주제')).toHaveCount(0);
  await expect(node(page, '가지 하나 더하기')).toHaveCount(0);
  await expect(node(page, '가지 둘')).toHaveCount(1);
  await expect(node(page, '더 아래')).toHaveCount(1);
  await expect.poll(() => textCalls.filter(c => c.method === 'DELETE').length).toBe(1);
  await expect(page.locator('[data-nb-lines] [data-nb-line]')).toHaveCount(0);
  // 노트 목록에는 상자가 나오지 않는다.
  await page.locator('.nv-switch [data-note-view="list"]').click();
  await expect(page.locator('[data-note-rows]')).toContainText('가 노트');
  await expect(page.locator('[data-note-rows]')).not.toContainText('가지 둘');
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('폰: [+ 상자]·막대 [+ 하위]·[+ 형제], 누르면 고르기·다시 누르면 고치기, 꾹 눌러 끌어 옮겨 붙이기, 가로 넘침 없음 (412)', async ({ page }) => {
  const width = 412;
  const { errors, textRows } = await fixture(page, width);
  const cdp = await page.context().newCDPSession(page);
  await page.locator('[data-nb-add-text]').tap();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('폰 주제');
  let blank = await blankPoint(page, 'top');
  await page.touchscreen.tap(blank.x, blank.y);
  await expect.poll(() => textRows.map(t => t.body)).toEqual(['폰 주제']);
  // 누르면 고르기 + 막대.
  await node(page, '폰 주제').locator('.nb-tx').tap();
  await expect(node(page, '폰 주제')).toHaveClass(/nb-sel/);
  await expect(editor(page)).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  const bb = await box(bar(page));
  expect(bb.x).toBeGreaterThanOrEqual(0); expect(bb.x + bb.width).toBeLessThanOrEqual(width);
  await bar(page).locator('[data-nb-bar-child]').tap();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('폰 가지');
  blank = await blankPoint(page, 'top');
  await page.touchscreen.tap(blank.x, blank.y);
  await expect.poll(() => rowBy(textRows, '폰 가지')?.parent_id).toBe(rowBy(textRows, '폰 주제').id);
  await node(page, '폰 가지').locator('.nb-tx').tap();
  await bar(page).locator('[data-nb-bar-sibling]').tap();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('폰 형제');
  blank = await blankPoint(page, 'top');
  await page.touchscreen.tap(blank.x, blank.y);
  await expect.poll(() => rowBy(textRows, '폰 형제')?.parent_id).toBe(rowBy(textRows, '폰 주제').id);
  expect(rowBy(textRows, '폰 형제').ord).toBeGreaterThan(rowBy(textRows, '폰 가지').ord);
  // 고른 상자를 다시 누르면 고치기(입력칸이 초점을 잃지 않는다), Esc = 취소.
  await node(page, '폰 형제').locator('.nb-tx').tap();
  await node(page, '폰 형제').locator('.nb-tx').tap();
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue('폰 형제');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  // 꾹 누른 뒤 끌어 '폰 가지' 위에 놓기 = 그 아래로.
  const from = await center(node(page, '폰 형제')), to = await center(node(page, '폰 가지'));
  await touch(cdp, 'touchStart', [from]); await page.waitForTimeout(700); await swipe(cdp, from, to, 10); await touch(cdp, 'touchEnd', []);
  await expect.poll(() => rowBy(textRows, '폰 형제').parent_id).toBe(rowBy(textRows, '폰 가지').id);
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('옛 보드(생각 지도 칸 적용 전 서버): 옛 글 상자는 혼자 선 상자로 보이고, 가지·꾸미기는 준비 중 알림, 옮기기·고치기는 된다 (1280)', async ({ page }) => {
  const { errors, textCalls, textRows } = await fixture(page, 1280, { legacy: true, seed: [{ id: 'old1', board_id: BID, body: '옛 글 상자', x: 300, y: 400 }] });
  const old = node(page, '옛 글 상자');
  await expect(old).toHaveCount(1);
  const b = await box(old);
  expect(b.width).toBeGreaterThan(b.height * 2); // 가로 글(예전처럼 세로로 쌓이지 않음)
  await old.locator('.nb-tx').click();
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('[data-nb-bar-open="tone"]')).toBeHidden();
  await expect(bar(page).locator('[data-nb-bar-del]')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('#toast')).toContainText('준비 중');
  await expect(editor(page)).toHaveCount(0);
  const c = await center(old);
  await drag(page, c, { x: c.x + 80, y: c.y + 40 });
  await expect.poll(() => textRows[0].x).toBeGreaterThan(330);
  expect(textCalls.filter(x => x.method === 'PATCH').at(-1).body).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  expect(errors).toEqual([]);
});
