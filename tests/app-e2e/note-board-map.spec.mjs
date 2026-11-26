import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S68-38 노트 '보드'(생각 지도, 사용자 11/23 08:12·08:23 — Obsidian Canvas 참고): 카드 네 변의 손잡이를 끌어 다른 카드에 놓으면 연결선(화살표).
// 선을 누르면 작은 메뉴 [실선|점선] [직선으로] [→|↔|없음] [뒤집기] [글자] [삭제](S68-38c: 새 선은 직선, 곡선은 선 끌기 — note-board-text-curve.spec.mjs). 카드를 옮기면 선이 따라오고, 새로고침해도 서버 값으로 남는다.
// 판: 두 손가락 확대·축소, 판 위 옆 밀기는 보기 탭 넘김이 아니다. 서버(표 app_note_board_links)가 거절하면 알리고 선을 거둔다. 이름은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
// S69-83: [전체](모든 노트 판)는 없앴다 — 이름 붙은 보드 하나(BID)에 노트를 붙여 둔 채로 시험한다.
const BID = 'bmap0001';
async function fixture(page, width, { reject = null } = {}) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [], linkCalls = [], linkRows = [];
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
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', r => r.fulfill({ json: [] })); // 글 상자 없음(S68-38c 시험은 따로)
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  // 연결선 표(서버 흉내): 작업공간 칸을 늘 붙이는지, 고치기에 작업공간·보드를 보내지 않는지 기록한다.
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    linkCalls.push({ method, query: Object.fromEntries(q), body });
    if (!q.get('workspace_id') && method !== 'POST') return r.fulfill({ status: 400, json: { message: 'workspace filter missing' } });
    if (method === 'GET') return r.fulfill({ json: structuredClone(linkRows) });
    if (method === 'POST') {
      if (reject && reject(body)) return r.fulfill({ status: 403, json: { code: '42501', message: 'new row violates row-level security policy for table "app_note_board_links"' } });
      const saved = { id: `L${linkCalls.length}`, ...body }; delete saved.workspace_id; linkRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] });
    }
    if (method === 'PATCH') { const hit = linkRows.find(l => 'eq.' + l.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(hit)] }); }
    if (method === 'DELETE') { const id = q.get('id')?.slice(3); for (let i = linkRows.length - 1; i >= 0; i--) if (linkRows[i].id === id) linkRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(3);
  return { errors, linkCalls, linkRows, rows };
}
const card = (page, id) => page.locator(`[data-nb-card="${id}"]`);
const lines = page => page.locator('[data-nb-lines] [data-nb-line]');
const menu = page => page.locator('.nb-link-menu');
async function center(l) { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
// 선 가운데 점(화면 좌표).
const lineMid = page => page.locator('[data-nb-hit]').first().evaluate(el => { const p = el.getPointAtLength(el.getTotalLength() / 2), m = el.getScreenCTM(); return { x: p.x * m.a + m.e, y: p.y * m.d + m.f }; });
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
async function swipe(cdp, from, to, steps = 10) { for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]); }
const zoomOf = page => page.locator('[data-nb-board]').evaluate(n => Number(/scale\(([\d.]+)\)/.exec(n.style.transform)[1]));
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function answerText(page, value) {
  const ask = page.locator('.kptu-ask');
  await ask.waitFor({ state: 'visible' });
  await ask.locator('.kptu-ask-field').fill(value);
  await ask.locator('.kptu-ask-actions button').nth(1).click();
  await ask.waitFor({ state: 'detached' });
}

test('PC: 손잡이 끌어 잇기 → 카드 옮기면 선이 따라옴 → 메뉴로 모양·종류·방향·뒤집기·글자·삭제 → 새로고침 뒤 유지 (1440)', async ({ page }) => {
  const { errors, linkCalls, linkRows } = await fixture(page, 1440);
  await expect(lines(page)).toHaveCount(0);
  // 마우스를 올린 카드만 손잡이·×·⋯가 보인다.
  await expect(card(page, 'n1').locator('[data-nb-handle="right"]')).toBeHidden();
  await card(page, 'n1').hover();
  const handle = card(page, 'n1').locator('[data-nb-handle="right"]');
  await expect(handle).toBeVisible();
  const from = await center(handle), to = await center(card(page, 'n2'));
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, from.y + 30, { steps: 5 });
  await expect(page.locator('[data-nb-temp]')).toBeVisible(); // 끄는 동안 점선 미리 보기
  await page.mouse.move(to.x - 40, to.y, { steps: 5 }); await page.mouse.up();
  await expect(lines(page)).toHaveCount(1);
  await expect.poll(() => linkCalls.some(c => c.method === 'POST')).toBe(true);
  const post = linkCalls.find(c => c.method === 'POST');
  expect(post.body).toEqual({ workspace_id: expect.any(String), board_id: BID, from_note: 'n1', to_note: 'n2', from_text: null, to_text: null, from_side: 'right', to_side: 'left', shape: 'line', dash: 'solid', ends: 'end', label: null, bend_x: null, bend_y: null });
  await expect(page.locator('[data-note-detail]')).toBeHidden(); // 선 긋기는 노트 열기가 아니다
  const line = page.locator('[data-nb-line] .nb-line');
  await expect(line).toHaveAttribute('d', /^M[\d.]+ [\d.]+L/); // 새 선은 직선
  await expect(line).toHaveAttribute('marker-end', /url\(#/); await expect(line).toHaveAttribute('marker-start', 'none');
  // 카드를 옮기면 선이 따라온다(아래로 끌면 선 끝 y가 커진다).
  const d0 = await line.getAttribute('d'), c2 = await center(card(page, 'n2'));
  await page.mouse.move(c2.x, c2.y); await page.mouse.down(); await page.mouse.move(c2.x + 10, c2.y + 80, { steps: 4 });
  const dMid = await line.getAttribute('d'); expect(dMid).not.toBe(d0); // 끄는 동안에도
  await page.mouse.move(c2.x + 20, c2.y + 160, { steps: 4 }); await page.mouse.up();
  const end = s => Number(s.trim().split(/[\sCL]+/).at(-1));
  expect(end(await line.getAttribute('d'))).toBeGreaterThan(end(d0) + 100);
  // 선을 누르면 메뉴.
  const mid = await lineMid(page);
  await page.mouse.click(mid.x, mid.y);
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).locator('[data-nb-straight]')).toBeDisabled(); // 이미 직선
  await expect(page.locator('[data-nb-line]')).toHaveClass(/nb-line-sel/);
  const patches = () => linkCalls.filter(c => c.method === 'PATCH');
  await menu(page).locator('[data-nb-dash="dashed"]').click();
  await expect.poll(() => patches().length).toBe(1);
  expect(patches()[0].body).toEqual({ dash: 'dashed' });
  await expect(line).toHaveClass(/nb-dashed/);
  await expect(menu(page).locator('[data-nb-dash="dashed"]')).toHaveAttribute('aria-pressed', 'true');
  await menu(page).locator('[data-nb-ends="both"]').click();
  await expect(line).toHaveAttribute('marker-start', /url\(#/);
  await menu(page).locator('[data-nb-ends="none"]').click();
  await expect(line).toHaveAttribute('marker-end', 'none');
  await menu(page).locator('[data-nb-ends="end"]').click();
  await menu(page).locator('[data-nb-flip]').click();
  await expect.poll(() => patches().at(-1)?.body).toEqual({ from_note: 'n2', to_note: 'n1', from_text: null, to_text: null, from_side: 'left', to_side: 'right' });
  await menu(page).locator('[data-nb-label]').click();
  await answerText(page, '  이어지는 생각  ');
  await expect.poll(() => patches().at(-1)?.body).toEqual({ label: '이어지는 생각' });
  await expect(page.locator('[data-nb-line] .nb-label')).toHaveText('이어지는 생각');
  for (const p of patches()) { expect(p.body.workspace_id).toBeUndefined(); expect(p.body.board_id).toBeUndefined(); expect(p.query.workspace_id).toBeTruthy(); }
  // Esc로 메뉴 닫기 → 새로고침해도 서버 값으로 그대로.
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  expect(linkRows).toEqual([expect.objectContaining({ from_note: 'n2', to_note: 'n1', shape: 'line', dash: 'dashed', ends: 'end', label: '이어지는 생각' })]);
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await page.waitForFunction(() => window.KPTURouter?.go);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(lines(page)).toHaveCount(1);
  await expect(page.locator('[data-nb-line] .nb-line')).toHaveClass(/nb-dashed/);
  await expect(page.locator('[data-nb-line] .nb-label')).toHaveText('이어지는 생각');
  // 키보드: 선에 초점 + Enter = 메뉴, [삭제]는 바로 지운다.
  await page.locator('[data-nb-hit]').focus(); await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  await menu(page).locator('[data-nb-del]').click();
  await expect(lines(page)).toHaveCount(0);
  await expect.poll(() => linkCalls.filter(c => c.method === 'DELETE').length).toBe(1);
  expect(linkRows).toEqual([]);
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

for (const width of [390, 412, 884]) {
  test(`폰: 꾹 눌러 고른 카드의 손잡이로 잇기, 선 누르면 메뉴(하단바에 안 가림), 두 손가락 확대, 판 위 옆 밀기는 탭 넘김 아님 (${width})`, async ({ page }) => {
    const { errors, linkCalls } = await fixture(page, width);
    const cdp = await page.context().newCDPSession(page);
    // 꾹 눌러 고르기 → 아래 손잡이를 다 생각 카드에 끌어 놓기.
    const c1 = await center(card(page, 'n1'));
    await touch(cdp, 'touchStart', [c1]); await page.waitForTimeout(700); await touch(cdp, 'touchEnd', []);
    await expect(card(page, 'n1')).toHaveClass(/nb-sel/);
    const h = card(page, 'n1').locator('[data-nb-handle="bottom"]');
    await expect(h).toBeVisible();
    const from = await center(h), to = await center(card(page, 'n3'));
    await touch(cdp, 'touchStart', [from]); await swipe(cdp, from, to); await touch(cdp, 'touchEnd', []);
    await expect(lines(page)).toHaveCount(1);
    await expect.poll(() => linkCalls.find(c => c.method === 'POST')?.body).toMatchObject({ from_note: 'n1', to_note: 'n3', from_side: 'bottom', board_id: BID });
    await expect(page.locator('[data-nb-line].nb-pending')).toHaveCount(0); // 서버 답을 받은 뒤에 메뉴
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    // 선 누르기 → 메뉴, 아래 탭에 가리지 않음, 가로 넘침 없음.
    const mid = await lineMid(page);
    await page.touchscreen.tap(mid.x, mid.y);
    await expect(menu(page)).toBeVisible();
    const mb = await menu(page).boundingBox();
    expect(mb.x).toBeGreaterThanOrEqual(0); expect(mb.x + mb.width).toBeLessThanOrEqual(width);
    const tabs = page.locator('nav.mobile-tabs');
    if (await tabs.isVisible()) expect(mb.y + mb.height).toBeLessThanOrEqual((await tabs.boundingBox()).y + 1);
    await menu(page).locator('[data-nb-dash="dashed"]').tap();
    await expect(page.locator('[data-nb-line] .nb-line')).toHaveClass(/nb-dashed/);
    await menu(page).locator('[data-nb-del]').tap();
    await expect(lines(page)).toHaveCount(0);
    await expect(menu(page)).toBeHidden();
    // 두 손가락 벌리기 = 크게(손가락 가운데 기준), 오므리기 = 작게.
    const sr = await page.locator('[data-nb-scroll]').boundingBox(), cx = sr.x + sr.width / 2, cy = sr.y + sr.height / 2;
    const z0 = await zoomOf(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 30, y: cy, id: 0 }, { x: cx + 30, y: cy, id: 1 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 30 - i * 10, y: cy, id: 0 }, { x: cx + 30 + i * 10, y: cy, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const z1 = await zoomOf(page);
    expect(z1).toBeGreaterThan(z0 * 1.8);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 110, y: cy, id: 0 }, { x: cx + 110, y: cy, id: 1 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 110 + i * 10, y: cy, id: 0 }, { x: cx + 110 - i * 10, y: cy, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(await zoomOf(page)).toBeLessThan(z1 * 0.6);
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    // 판 위를 옆으로 길게 밀어도 보기 탭은 그대로 [보드](판이 먼저).
    await page.locator('[data-nb-fit]').tap();
    const blank = await page.locator('[data-nb-scroll]').evaluate(el => {
      const r = el.getBoundingClientRect();
      for (let y = r.bottom - 30; y > r.top + 60; y -= 20) for (let x = r.right - 40; x > r.left + 40; x -= 20) { const hit = document.elementFromPoint(x, y); if (hit && el.contains(hit) && !hit.closest('[data-nb-card],.nb-tools,[data-nb-hit]')) return { x, y }; }
      return null;
    });
    await touch(cdp, 'touchStart', [blank]); await swipe(cdp, blank, { x: blank.x - 200, y: blank.y }, 6); await touch(cdp, 'touchEnd', []);
    await expect(page.locator('.nv-switch [data-note-view="board"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await noOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('서버가 거절한 연결(다른 작업공간 노트 등)은 알리고 선을 거둔다, 같은 두 노트 같은 방향은 한 줄 (1440)', async ({ page }) => {
  const { errors, linkCalls } = await fixture(page, 1440, { reject: body => body.to_note === 'n3' });
  const drawTo = async (fromId, side, toId) => {
    await card(page, fromId).hover();
    const from = await center(card(page, fromId).locator(`[data-nb-handle="${side}"]`)), to = await center(card(page, toId));
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
  };
  await drawTo('n1', 'bottom', 'n3');
  await expect(page.locator('#toast')).toContainText('연결선을 저장하지 못했어요');
  await expect(lines(page)).toHaveCount(0);
  await drawTo('n1', 'right', 'n2');
  await expect(lines(page)).toHaveCount(1);
  await drawTo('n1', 'top', 'n2');
  await expect(page.locator('#toast')).toContainText('이미 이어져 있어요');
  expect(linkCalls.filter(c => c.method === 'POST').length).toBe(2);
  await expect(lines(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});
