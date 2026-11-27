import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S68-38c 노트 보드 글 상자·선 곡선(명진 11/23 08:32·08:47). S69-82: 글 상자는 생각 지도 상자가 됨(note-board-mindmap.spec.mjs가 가지·꾸미기를 본다).
// - 상자: [+ 주제]·빈 곳 두 번 누르기(PC 더블클릭)로 그 보드에만 있는 짧은 글. 누르면 고르기, 다시 누르면 고치기, 끌면 옮기기, 고른 상자 위 막대에 [삭제].
//   노트 카드처럼 네 변 손잡이로 선을 잇고 받는다. 노트 목록에는 나오지 않는다(서버 표 app_note_board_texts).
// - 선: 새 선은 직선. 선 위를 누른 채 끌면 그 점을 지나는 곡선(끄는 동안 보임), 상대 위치로 저장(카드·상자를 옮겨도 따라옴, 새로고침 뒤 유지).
//   거의 일직선으로 되돌리면 직선, 선 메뉴 [직선으로]. 이름·글은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
// S69-83: [전체](모든 노트 판)는 없앴다 — 이름 붙은 보드 하나(BID)에 노트를 붙여 둔 채로 시험한다.
const BID = 'bmap0001';
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [], linkCalls = [], linkRows = [], textCalls = [], textRows = [], hold = { linkPatch: null };
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: BID, name: '생각 지도' }], note_board: BID });
  await openHome(page);
  const row = (id, title, board) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n본문', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { boards: { [BID]: board } } });
  const rows = [row('n1', '가 생각', { x: 40, y: 40, r: 1, z: 0 }), row('n2', '나 생각', { x: 420, y: 60, r: 1, z: 1 }), row('n3', '다 생각', { x: 60, y: 320, r: 1, z: 2 })];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  // 서버 흉내: 연결선 표(끝 = 노트 또는 글 상자 정확히 하나)와 글 상자 표(지우면 붙은 선도 지움 = cascade).
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    linkCalls.push({ method, query: Object.fromEntries(q), body });
    if (!q.get('workspace_id') && method !== 'POST') return r.fulfill({ status: 400, json: { message: 'workspace filter missing' } });
    if (method === 'GET') return r.fulfill({ json: structuredClone(linkRows) });
    if (method === 'POST') {
      if (!body.from_note === !body.from_text || !body.to_note === !body.to_text) return r.fulfill({ status: 400, json: { code: '23514', message: 'check' } });
      const saved = { id: `L${linkCalls.length}`, ...body }; delete saved.workspace_id; linkRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] });
    }
    if (method === 'PATCH') { const hit = linkRows.find(l => 'eq.' + l.id === q.get('id')); Object.assign(hit, body); const answer = [structuredClone(hit)]; if (hold.linkPatch) await hold.linkPatch; return r.fulfill({ json: answer }); }
    if (method === 'DELETE') { const id = q.get('id')?.slice(3); for (let i = linkRows.length - 1; i >= 0; i--) if (linkRows[i].id === id) linkRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    textCalls.push({ method, query: Object.fromEntries(q), body });
    if (!q.get('workspace_id') && method !== 'POST') return r.fulfill({ status: 400, json: { message: 'workspace filter missing' } });
    if (method === 'GET') return r.fulfill({ json: structuredClone(textRows) });
    if (method === 'POST') { const saved = { id: `T${textCalls.length}`, ...body }; delete saved.workspace_id; textRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] }); }
    if (method === 'PATCH') { const hit = textRows.find(t => 'eq.' + t.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(hit)] }); }
    if (method === 'DELETE') {
      const id = q.get('id')?.slice(3);
      for (let i = textRows.length - 1; i >= 0; i--) if (textRows[i].id === id) textRows.splice(i, 1);
      for (let i = linkRows.length - 1; i >= 0; i--) if (linkRows[i].from_text === id || linkRows[i].to_text === id) linkRows.splice(i, 1);
      return r.fulfill({ json: [] });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await openBoard(page);
  return { errors, linkCalls, linkRows, textCalls, textRows, hold };
}
async function openBoard(page) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(3);
}
const card = (page, id) => page.locator(`[data-nb-card="${id}"]`);
const texts = page => page.locator('[data-nb-texts] [data-nb-text]');
const lines = page => page.locator('[data-nb-lines] [data-nb-line]');
const menu = page => page.locator('.nb-link-menu');
const editor = page => page.locator('[data-nb-text-edit]');
async function center(l) { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
// 선(id) 가운데 점(화면 좌표)과 그 점에서 선에 수직인 방향.
const lineMid = (page, id) => page.locator(`[data-nb-line="${id}"] [data-nb-hit]`).evaluate(el => {
  const L = el.getTotalLength(), p = el.getPointAtLength(L / 2), a = el.getPointAtLength(L / 2 - 2), b = el.getPointAtLength(L / 2 + 2), m = el.getScreenCTM();
  const dx = b.x - a.x, dy = b.y - a.y, n = Math.hypot(dx, dy) || 1;
  return { x: p.x * m.a + m.e, y: p.y * m.d + m.f, nx: -dy / n, ny: dx / n };
});
const dOf = (page, id) => page.locator(`[data-nb-line="${id}"] .nb-line`).getAttribute('d');
// 판 안 빈 곳(카드·글 상자·선·도구 밖) 하나.
const blankPoint = (page, from = 'bottom') => page.locator('[data-nb-scroll]').evaluate((el, from) => {
  const r = el.getBoundingClientRect(), ys = [];
  for (let y = r.bottom - 30; y > r.top + 60; y -= 20) ys.push(y);
  if (from === 'top') ys.reverse();
  for (const y of ys) for (let x = r.right - 40; x > r.left + 40; x -= 20) { const hit = document.elementFromPoint(x, y); if (hit && el.contains(hit) && !hit.closest('[data-nb-card],[data-nb-text],.nb-tools,[data-nb-hit]')) return { x, y }; }
  return null;
}, from);
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
async function swipe(cdp, from, to, steps = 10) { for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]); }
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('PC: 상자 만들기·수정·옮기기, 노트↔글 상자 선, 선 끌어 곡선·옮겨도 유지·새로고침 뒤 유지·직선 복귀, 삭제, 노트 목록에 안 나옴 (1440)', async ({ page }) => {
  const { errors, linkCalls, linkRows, textCalls, textRows, hold } = await fixture(page, 1440);
  // [+ 주제] → 바로 입력칸 → 바깥 누르기 = 저장.
  await page.locator('[data-nb-add-text]').click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('중간 생각');
  const blank = await blankPoint(page);
  await page.mouse.click(blank.x, blank.y);
  await expect(texts(page)).toHaveCount(1);
  await expect.poll(() => textCalls.filter(c => c.method === 'POST').length).toBe(1);
  expect(textCalls.find(c => c.method === 'POST').body).toMatchObject({ workspace_id: expect.any(String), board_id: BID, body: '중간 생각', x: expect.any(Number), y: expect.any(Number), parent_id: null });
  await expect(texts(page).first().locator('.nb-tx')).toHaveText('중간 생각');
  // 빈 곳 더블클릭 → 그 자리에 새 글 상자, Ctrl+Enter = 저장(줄바꿈 글도).
  const blank2 = await blankPoint(page, 'top');
  await page.mouse.dblclick(blank2.x, blank2.y);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('둘째'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('줄');
  await page.keyboard.press('Control+Enter');
  await expect(texts(page)).toHaveCount(2);
  await expect.poll(() => textRows.map(t => t.body)).toEqual(['중간 생각', '둘째\n줄']);
  const t1 = textRows[0].id, t2 = textRows[1].id;
  const box1 = page.locator(`[data-nb-text="${t1}"]`), box2 = page.locator(`[data-nb-text="${t2}"]`);
  // 누르면 고르기, 다시 누르면 수정 → 바꾼 글 저장. Esc는 취소.
  await box1.locator('.nb-tx').click();
  await expect(editor(page)).toHaveCount(0);
  await box1.locator('.nb-tx').click();
  await expect(editor(page)).toHaveValue('중간 생각');
  await editor(page).fill('고친 생각'); await page.keyboard.press('Control+Enter');
  await expect.poll(() => textCalls.filter(c => c.method === 'PATCH').at(-1)?.body).toEqual({ body: '고친 생각' });
  await expect(box1.locator('.nb-tx')).toHaveText('고친 생각');
  await box2.locator('.nb-tx').dblclick(); await editor(page).fill('버릴 글'); await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0); await expect(box2.locator('.nb-tx')).toHaveText('둘째\n줄');
  // 끌어 옮기기 → 자리 저장.
  const before = textRows[0].x;
  let c = await center(box1);
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 60, c.y + 40, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => textCalls.filter(c => c.method === 'PATCH').at(-1)?.body).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  expect(textRows[0].x).toBeGreaterThan(before + 40);
  await expect(editor(page)).toHaveCount(0); // 끈 것은 수정이 아니다
  // 노트 카드 손잡이 → 글 상자, 글 상자 손잡이 → 노트 카드.
  await card(page, 'n1').hover();
  let from = await center(card(page, 'n1').locator('[data-nb-handle="right"]')); c = await center(box1);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => linkCalls.filter(x => x.method === 'POST').length).toBe(1);
  expect(linkCalls.find(x => x.method === 'POST').body).toMatchObject({ from_note: 'n1', from_text: null, to_note: null, to_text: t1, shape: 'line', bend_x: null });
  await box1.hover();
  from = await center(box1.locator('[data-nb-handle="right"]')); c = await center(card(page, 'n2'));
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => linkRows.length).toBe(2);
  expect(linkRows[1]).toMatchObject({ from_note: null, from_text: t1, to_note: 'n2', to_text: null });
  await expect(lines(page)).toHaveCount(2);
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  // 선 가운데를 끌면 곡선(끄는 동안 바로 보임) → 상대 위치 저장. 먼저 빈 곳을 눌러 상자 선택을 푼다(선택한 상자 위 막대가 선을 덮지 않게).
  const away = await blankPoint(page, 'top'); await page.mouse.click(away.x, away.y);
  await expect(page.locator('[data-nb-bar]')).toBeHidden();
  const L1 = linkRows[0].id;
  await expect(page.locator(`[data-nb-line="${L1}"].nb-pending`)).toHaveCount(0);
  expect(await dOf(page, L1)).toMatch(/L/);
  const m = await lineMid(page, L1);
  await page.mouse.move(m.x, m.y); await page.mouse.down();
  await page.mouse.move(m.x + m.nx * 30, m.y + m.ny * 30, { steps: 3 });
  await page.mouse.move(m.x + m.nx * 70, m.y + m.ny * 70, { steps: 3 });
  expect(await dOf(page, L1)).toMatch(/Q/);
  await expect(menu(page)).toBeHidden();
  await page.mouse.up();
  await expect.poll(() => linkCalls.filter(x => x.method === 'PATCH').at(-1)?.body).toEqual({ shape: 'curve', bend_x: expect.any(Number), bend_y: expect.any(Number) });
  await expect(menu(page)).toBeHidden(); // 끌기는 메뉴가 아니다
  const bent = { ...linkRows[0] };
  expect(Math.abs(bent.bend_y)).toBeGreaterThan(0.1);
  // 글 상자를 옮겨도 곡선이 따라온다(저장 값은 그대로, 경로는 바뀜).
  const d0 = await dOf(page, L1); c = await center(box1);
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 30, c.y + 90, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => dOf(page, L1)).not.toBe(d0);
  expect(await dOf(page, L1)).toMatch(/Q/);
  expect(linkRows[0]).toMatchObject({ bend_x: bent.bend_x, bend_y: bent.bend_y });
  // 새로고침 뒤에도 곡선·글 상자 그대로.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await page.waitForFunction(() => window.KPTURouter?.go);
  await openBoard(page);
  await expect(texts(page)).toHaveCount(2);
  await expect(lines(page)).toHaveCount(2);
  expect(await dOf(page, L1)).toMatch(/Q/);
  // 선 누르기 → 메뉴 [직선으로] → 직선.
  const m2 = await lineMid(page, L1);
  await page.mouse.click(m2.x, m2.y);
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).locator('[data-nb-straight]')).toBeEnabled();
  // S68-57: [직선으로]의 저장 답은 둘째 선을 끄는 도중에 오게 붙잡아 둔다(전에는 답이 늦게 오면 끌기가 끊겨 CI에서 간헐 실패).
  let release; hold.linkPatch = new Promise(r => { release = r; });
  await menu(page).locator('[data-nb-straight]').click();
  await expect.poll(() => linkCalls.filter(x => x.method === 'PATCH').at(-1)?.body).toEqual({ shape: 'line', bend_x: null, bend_y: null });
  expect(await dOf(page, L1)).toMatch(/L/);
  await expect(menu(page).locator('[data-nb-straight]')).toBeDisabled();
  await page.keyboard.press('Escape');
  // 둘째 선: 끌어 휘었다가 거의 일직선 자리로 되돌려 놓으면 직선 그대로(서버에 곡선을 보내지 않음).
  const L2 = linkRows[1].id, patchesBefore = linkCalls.filter(x => x.method === 'PATCH').length;
  const m3 = await lineMid(page, L2);
  await page.mouse.move(m3.x, m3.y); await page.mouse.down();
  await page.mouse.move(m3.x + m3.nx * 60, m3.y + m3.ny * 60, { steps: 4 });
  expect(await dOf(page, L2)).toMatch(/Q/);
  // 끄는 도중에 다른 선의 저장 답이 와서 선을 모두 다시 그려도(끌던 선의 옛 요소가 빠짐) 끌기는 이어진다.
  const oldLine = await page.locator(`[data-nb-line="${L2}"]`).elementHandle();
  hold.linkPatch = null; release();
  await expect.poll(() => oldLine.evaluate(el => el.isConnected)).toBe(false);
  await expect(page.locator(`[data-nb-line="${L2}"]`)).toHaveCount(1);
  expect(await dOf(page, L2)).toMatch(/Q/);
  expect(await dOf(page, L1)).toMatch(/L/);
  await page.mouse.move(m3.x + m3.nx * 50, m3.y + m3.ny * 50, { steps: 2 });
  expect(await dOf(page, L2)).toMatch(/Q/);
  await page.mouse.move(m3.x + m3.nx * 3, m3.y + m3.ny * 3, { steps: 4 });
  expect(await dOf(page, L2)).toMatch(/L/);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(linkCalls.filter(x => x.method === 'PATCH').length).toBe(patchesBefore);
  // 노트 목록·검색에는 글 상자가 없다.
  await page.locator('.nv-switch [data-note-view="list"]').click();
  await expect(page.locator('[data-note-rows]')).toContainText('가 생각');
  await expect(page.locator('[data-note-rows]')).not.toContainText('고친 생각');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(texts(page)).toHaveCount(2);
  // 고른 상자(키보드 초점) 위 막대의 [삭제] → 상자와 붙은 선이 함께 사라진다.
  await box1.locator('.nb-tx').focus();
  await expect(box1).toHaveClass(/nb-sel/);
  await page.locator('[data-nb-bar] [data-nb-bar-del]').click();
  await expect(texts(page)).toHaveCount(1);
  await expect(lines(page)).toHaveCount(0);
  await expect.poll(() => textCalls.filter(x => x.method === 'DELETE').length).toBe(1);
  expect(textCalls.find(x => x.method === 'DELETE').query).toMatchObject({ workspace_id: expect.any(String), id: 'eq.' + t1 });
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('폰: [+ 상자]·두 번 누르기로 만들기, 누르면 고르기·다시 누르면 수정, 꾹 눌러 옮기기·잇기, 선 끌어 곡선, 삭제 (412)', async ({ page }) => {
  const width = 412;
  const { errors, linkCalls, linkRows, textCalls, textRows } = await fixture(page, width);
  const cdp = await page.context().newCDPSession(page);
  await page.locator('[data-nb-add-text]').tap();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('폰 글');
  let blank = await blankPoint(page);
  await page.touchscreen.tap(blank.x, blank.y);
  await expect.poll(() => textRows.map(t => t.body)).toEqual(['폰 글']);
  await expect(texts(page)).toHaveCount(1);
  // 빈 곳 빠르게 두 번 = 그 자리 글 상자.
  blank = await blankPoint(page, 'top');
  await touch(cdp, 'touchStart', [blank]); await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(80);
  await touch(cdp, 'touchStart', [blank]); await touch(cdp, 'touchEnd', []);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('두 번');
  const away = await blankPoint(page);
  await page.touchscreen.tap(away.x, away.y);
  await expect.poll(() => textRows.map(t => t.body)).toEqual(['폰 글', '두 번']);
  const t1 = textRows[0].id, box1 = page.locator(`[data-nb-text="${t1}"]`);
  // 누르면 고르기, 다시 누르면 수정(입력칸이 초점을 잃지 않는다).
  await box1.locator('.nb-tx').tap();
  await expect(box1).toHaveClass(/nb-sel/);
  await box1.locator('.nb-tx').tap();
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue('폰 글');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  // 꾹 누른 뒤 끌기 = 옮기기.
  const x0 = textRows[0].x;
  let c = await center(box1);
  await touch(cdp, 'touchStart', [c]); await page.waitForTimeout(700); await swipe(cdp, c, { x: c.x + 50, y: c.y + 30 }, 6); await touch(cdp, 'touchEnd', []);
  await expect.poll(() => textRows[0].x).toBeGreaterThan(x0 + 20);
  await expect(editor(page)).toHaveCount(0);
  // 꾹 눌러 고르기 → 손잡이를 노트 카드에 끌어 놓기(먼저 [맞추기]로 카드가 판 가장자리에 걸리지 않게 — 가장자리는 판이 저절로 밀린다).
  await page.locator('[data-nb-fit]').tap();
  c = await center(box1);
  await touch(cdp, 'touchStart', [c]); await page.waitForTimeout(700); await touch(cdp, 'touchEnd', []);
  await expect(box1).toHaveClass(/nb-sel/);
  await expect(page.locator('[data-nb-bar] [data-nb-bar-del]')).toBeVisible();
  const h = box1.locator('[data-nb-handle="bottom"]'); await expect(h).toBeVisible();
  const from = await center(h), to = await center(card(page, 'n3'));
  await touch(cdp, 'touchStart', [from]); await swipe(cdp, from, to); await touch(cdp, 'touchEnd', []);
  await expect.poll(() => linkRows.length).toBe(1);
  expect(linkRows[0]).toMatchObject({ from_text: t1, from_note: null, to_note: 'n3', to_text: null, shape: 'line' });
  const L = linkRows[0].id;
  await expect(page.locator(`[data-nb-line="${L}"].nb-pending`)).toHaveCount(0);
  // 선 위를 끌면 곡선(판 이동이 아니다).
  const tf = await page.locator('[data-nb-board]').evaluate(n => n.style.transform);
  const m = await lineMid(page, L);
  await touch(cdp, 'touchStart', [m]); await swipe(cdp, m, { x: m.x + m.nx * 60, y: m.y + m.ny * 60 }, 6);
  expect(await dOf(page, L)).toMatch(/Q/);
  await touch(cdp, 'touchEnd', []);
  await expect.poll(() => linkCalls.filter(x => x.method === 'PATCH').at(-1)?.body).toEqual({ shape: 'curve', bend_x: expect.any(Number), bend_y: expect.any(Number) });
  expect(await page.locator('[data-nb-board]').evaluate(n => n.style.transform)).toBe(tf);
  await expect(menu(page)).toBeHidden();
  // 짧게 누르면 선 메뉴(아래 탭에 가리지 않음).
  const m2 = await lineMid(page, L);
  await page.touchscreen.tap(m2.x, m2.y);
  await expect(menu(page)).toBeVisible();
  const mb = await menu(page).boundingBox();
  expect(mb.x).toBeGreaterThanOrEqual(0); expect(mb.x + mb.width).toBeLessThanOrEqual(width);
  const tabs = page.locator('nav.mobile-tabs');
  if (await tabs.isVisible()) expect(mb.y + mb.height).toBeLessThanOrEqual((await tabs.boundingBox()).y + 1);
  await expect(menu(page).locator('[data-nb-straight]')).toBeEnabled();
  await page.keyboard.press('Escape');
  // 꾹 눌러 고른 상자의 [삭제].
  c = await center(box1);
  await touch(cdp, 'touchStart', [c]); await page.waitForTimeout(700); await touch(cdp, 'touchEnd', []);
  await page.locator('[data-nb-bar] [data-nb-bar-del]').tap();
  await expect(texts(page)).toHaveCount(1);
  await expect(lines(page)).toHaveCount(0);
  await expect.poll(() => textCalls.filter(x => x.method === 'DELETE').length).toBe(1);
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});
