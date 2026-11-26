import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { segBox } from './helpers/seg-box.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import {screenFind} from './helpers/screen-find.mjs';

// NOTE-보기3가지 (요청함 10/29 15:05, 명진 15:10 '추천대로'): 노트 검색 칸 오른쪽 [폴더|목록|보드](S68-38 옛 이름 포스트잇).
// 목록 = 모든 노트 최근 고친 순 한 줄(폴더 꼬리표·날짜), 보드 = 끝없이 넓은 판 위 제목만 보이는 같은 크기 작은 카드(S68-38), 끌어 놓으면
// 그 보드의 metadata.boards[보드 id]로 서버 저장(S69-83: 모든 노트를 늘어놓던 [전체]는 없앴다 — 이름 붙은 보드 BID에 세 노트를 붙여 둔 채 시험), 끈 칸은 맨 위. 검색은 세 보기 모두. 폰 412·884, PC 1440. 이름은 지어낸 것.
// 연결선(화살표)·두 손가락 확대·탭 넘김과의 관계는 note-board-map.spec.mjs.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const F = '00000000-0000-4000-8000-000000000001';
const BID = 'bview001';
const at = (x, y, z) => ({ boards: { [BID]: { x, y, r: 1, z } } });
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: BID, name: '생각' }], note_board: BID });
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n첫 줄 내용\n둘째 줄', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    // 자리는 옛 처음 배치(폴더끼리 모아 한 줄)와 같은 곳: 나(폴더 없음) → 다·가(회의).
    row('n1', '가 노트', '2026-10-10T01:00:00Z', { folder_id: F, ...at(346, 24, 2) }),
    row('n2', '나 노트', '2026-10-16T01:00:00Z', at(24, 24, 0)),
    row('n3', '다 노트', '2026-10-12T01:00:00Z', { folder_id: F, ...at(196, 24, 1) }),
  ];
  const folders = [{ id: F, workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ id: (q.get('id') || '').slice(3), body }); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  return { rows, writes, errors };
}
const view = (page, name) => page.locator(`.nv-switch [data-note-view="${name}"]`);
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };

for (const width of [412, 884, 1440]) {
  test(`세 보기 전환·목록 순서·보드 카드·검색 (${width})`, async ({ page }) => {
    const { errors } = await fixture(page, width);
    await expect(view(page, 'folder')).toHaveAttribute('aria-pressed', 'true');
    const head = await page.locator('.note-list-head').boundingBox(), sw = await segBox(page.locator('.nv-switch'));
    expect(sw.height).toBeLessThanOrEqual(34);
    // FOLDER-나무새기준 ⑧(01:25 탭 자리 규칙): 폰은 아래 탭 바로 위 가운데(일정 전환 줄과 같은 줄), 넓은 화면은 위 머리줄 안.
    if (width < 761) { const tabs = await page.locator('.mobile-tabs').boundingBox(); expect(sw.y + sw.height).toBeLessThanOrEqual(tabs.y); expect(Math.abs(sw.x + sw.width / 2 - width / 2)).toBeLessThanOrEqual(2); }
    else expect(sw.y + sw.height).toBeLessThanOrEqual(head.y + head.height + 1);
    // 목록: 최근 고친 순(나 → 다 → 가), 폴더 노트에만 꼬리표.
    await press(page, view(page, 'list'), width);
    await expect(view(page, 'list')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-nx-tree]')).toBeHidden();
    await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(3);
    await expect(page.locator('#noteRows .basket-title-text')).toHaveText(['나 노트', '다 노트', '가 노트']);
    await expect(page.locator('#noteRows [data-nx-note="n3"] .nx-path')).toHaveText('회의');
    await expect(page.locator('#noteRows [data-nx-note="n2"] .nx-path')).toHaveCount(0);
    // 보드: 같은 크기 작은 카드 3장, 제목 한 줄만(본문·폴더 줄 없음), 폴더 색.
    await press(page, view(page, 'board'), width);
    await expect(view(page, 'board')).toHaveText('보드');
    const cards = page.locator('[data-note-board] [data-nb-card]');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('[data-nx-body]')).toBeHidden();
    await expect(page.locator('[data-nb-card="n1"] .nb-title')).toHaveText('가 노트');
    await expect(page.locator('[data-nb-card] .nb-text, [data-nb-card] .nb-folder')).toHaveCount(0);
    const sizes = await cards.evaluateAll(list => list.map(el => [el.offsetWidth, el.offsetHeight]));
    expect(new Set(sizes.map(s => s.join('x')))).toEqual(new Set(['128x34']));
    expect(await page.locator('[data-nb-card="n1"]').getAttribute('data-tone')).toBe(await page.locator('[data-nb-card="n3"]').getAttribute('data-tone'));
    expect(await page.locator('[data-nb-card="n2"]').getAttribute('data-tone')).toBe('none');
    // 처음엔 카드가 모두 판 안에 보인다(맞추기).
    const sr = await page.locator('[data-nb-scroll]').boundingBox();
    for (const b of await cards.evaluateAll(list => list.map(el => { const r = el.getBoundingClientRect(); return {x:r.x, y:r.y, r:r.right, b:r.bottom}; })))
      expect(b.x >= sr.x && b.y >= sr.y && b.r <= sr.x + sr.width + 1 && b.b <= sr.y + sr.height + 1).toBe(true);
    // 고르지 않은 카드는 ×·⋯·손잡이가 안 보인다(폰).
    if (width < 761) { await expect(page.locator('[data-nb-card="n1"] .nb-more')).toBeHidden(); await expect(page.locator('[data-nb-card="n1"] [data-nb-handle]').first()).toBeHidden(); }
    // 검색은 보드에서도.
    await (await screenFind(page)).fill('다 노트');
    await expect(cards).toHaveCount(1);
    await (await screenFind(page)).fill('');
    await expect(cards).toHaveCount(3);
    // [＋][－][맞추기]
    const before = await zoomOf(page);
    await press(page, page.locator('[data-nb-zoom="1"]'), width);
    expect(await zoomOf(page)).toBeGreaterThan(before);
    await press(page, page.locator('[data-nb-fit]'), width);
    expect(await zoomOf(page)).toBeCloseTo(before, 3);
    // 가로 넘침 없음.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    // 한 번 누르면 노트 열기.
    await press(page, page.locator('[data-nb-card="n2"] .nb-open'), width);
    await expect(page.locator('[data-note-detail]')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

// S69-88: 끄는 카드는 다른 칸 가장자리·가운데에 화면 6px 안이면 살짝 붙는다(맞춤선) — 그만큼 더 받는다.
const snapSlack = zoom => 2 + 6 / zoom;
test('보드 카드 끌어 놓기: 그 보드 자리만 서버 저장, 끈 칸이 맨 위, 다시 그려도 그 자리 (1440)', async ({ page }) => {
  const { writes, errors } = await fixture(page, 1440);
  // S68-47: 보드를 열면 연결선·글 상자(app_note_board_links·texts)를 따로 읽고, 그 답이 오면 선·글 상자를 다시 그린다.
  // 그 답이 카드를 끄는 도중에 와도 끌기가 끊기지 않아야 한다(전에는 판 전체를 다시 그려 끌기가 취소되고 카드가 바뀌어 CI에서 두 번 실패).
  // 사람이 하듯 보드가 뜨자마자 끌기 시작하고, 그 답은 끄는 도중에 오게 붙잡아 둔다.
  let release, answered = 0; const gate = new Promise(r => { release = r; });
  await page.route(u => u.origin === SB && /^\/rest\/v1\/app_note_board_(links|texts)$/.test(u.pathname), async r => { await gate; await r.fulfill({ json: [] }); answered++; });
  await view(page, 'board').click();
  const card = page.locator('[data-nb-card="n1"]');
  const z = el => el.evaluate(n => Number(n.style.zIndex));
  await expect(card).toBeVisible(); // boundingBox()는 기다리지 않는다
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 100, { steps: 6 });
  release(); await expect.poll(() => answered).toBe(2);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))); // 답을 받아 다시 그린 뒤
  await expect(card).toHaveClass(/nb-dragging/); // 끌기는 그대로 이어진다
  await page.mouse.move(box.x + 230, box.y + 180, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => writes.filter(w => w.body?.metadata?.boards?.[BID]).length).toBe(1);
  const moved = writes.find(w => w.id === 'n1' && w.body.metadata.boards?.[BID]).body.metadata.boards[BID];
  expect(writes.every(w => w.body.metadata.board === undefined)).toBe(true); // 옛 [전체] 자리(metadata.board)는 쓰지 않는다
  expect(Object.keys(moved).sort()).toEqual(['r', 'x', 'y', 'z']);
  for (const w of writes) expect(w.body.updated_at).toBeUndefined(); // 옮기기는 고치기가 아니다
  const others = await Promise.all(['n2', 'n3'].map(id => z(page.locator(`[data-nb-card="${id}"]`))));
  expect(await z(card)).toBeGreaterThan(Math.max(...others));
  // 끈 뒤에는 열리지 않고, 끈 카드가 골라진다.
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  await expect(card).toHaveClass(/nb-sel/);
  // 다른 보기로 갔다 와도(다시 그림) 같은 자리.
  const left = await card.evaluate(n => n.style.left);
  await view(page, 'list').click(); await view(page, 'board').click();
  await expect(page.locator('[data-nb-card="n1"]')).toHaveCSS('left', left);
  expect(errors).toEqual([]);
});

// NOTE-포스트잇끌기 (요청함 10/30 14:09 "둘 다 되게") → S68-38: 폰·폴드 한 손가락 — 바로 끌기도, 꾹 누른 뒤 끌기도 옮기고 서버 저장,
// 꾹 눌렀다 움직이지 않고 떼면 그 카드를 고른다(×·⋯·손잡이가 보임, ⋯로 노트 메뉴). 판 빈 곳은 판 이동, 확대 상태에서도 손가락만큼 움직인다(배율 반영).
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
const cardAt = l => l.evaluate(n => ({ x: parseFloat(n.style.left), y: parseFloat(n.style.top) }));
async function center(l) { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function swipe(cdp, from, dx, dy, steps = 8) { for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', [{ x: from.x + dx * i / steps, y: from.y + dy * i / steps }]); }
const boardWrites = (writes, id) => writes.filter(w => w.id === id && w.body?.metadata?.boards?.[BID]);
const viewOf = page => page.locator('[data-nb-board]').evaluate(n => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([\d.]+)\)/.exec(n.style.transform); return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) }; });
const zoomOf = async page => (await viewOf(page)).z;

for (const width of [412, 884]) {
  test(`폰 손가락: 바로 끌기·꾹 눌러 끌기 이동·저장, 꾹 눌렀다 떼면 고르기 (${width})`, async ({ page }) => {
    const { writes, errors } = await fixture(page, width);
    await press(page, view(page, 'board'), width);
    const cdp = await page.context().newCDPSession(page);
    const card = page.locator('[data-nb-card="n2"]'), zoom = await zoomOf(page);
    await expect(card).toBeVisible(); // center()의 boundingBox()는 기다리지 않는다
    // 1) 바로 끌기: 누르자마자 움직인다.
    let start = await cardAt(card), from = await center(card);
    await touch(cdp, 'touchStart', [from]); await swipe(cdp, from, 60, 40); await touch(cdp, 'touchEnd', []);
    await expect.poll(() => boardWrites(writes, 'n2').length).toBe(1);
    let end = await cardAt(card);
    expect(Math.abs(end.x - start.x - 60 / zoom)).toBeLessThanOrEqual(snapSlack(zoom)); expect(Math.abs(end.y - start.y - 40 / zoom)).toBeLessThanOrEqual(snapSlack(zoom));
    expect(boardWrites(writes, 'n2')[0].body.metadata.boards[BID].x).toBe(end.x);
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    await expect(page.locator('#noteDocMenu')).toBeHidden();
    // 2) 꾹 누른 뒤 끌기: 떠오른 표시가 생기고 메뉴는 뜨지 않은 채 옮겨진다.
    start = end; from = await center(card);
    await touch(cdp, 'touchStart', [from]); await page.waitForTimeout(700);
    await expect(card).toHaveClass(/nb-held/);
    await expect(page.locator('#noteDocMenu')).toBeHidden();
    await swipe(cdp, from, -50, 30); await touch(cdp, 'touchEnd', []);
    await expect.poll(() => boardWrites(writes, 'n2').length).toBe(2);
    end = await cardAt(card);
    expect(Math.abs(end.x - start.x + 50 / zoom)).toBeLessThanOrEqual(snapSlack(zoom)); expect(Math.abs(end.y - start.y - 30 / zoom)).toBeLessThanOrEqual(snapSlack(zoom));
    await expect(card).not.toHaveClass(/nb-held|nb-dragging/);
    await expect(page.locator('#noteDocMenu')).toBeHidden();
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    // 3) 다른 카드를 꾹 눌렀다 움직이지 않고 떼면 그 카드를 고른다(열리지 않음, 자리 그대로) → ×·⋯·손잡이가 보이고 ⋯는 노트 메뉴.
    const other = page.locator('[data-nb-card="n3"]'), otherAt = await cardAt(other);
    from = await center(other);
    await touch(cdp, 'touchStart', [from]); await page.waitForTimeout(700); await touch(cdp, 'touchEnd', []);
    await expect(other).toHaveClass(/nb-sel/); await expect(card).not.toHaveClass(/nb-sel/);
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    await expect(page.locator('#noteDocMenu')).toBeHidden();
    await expect(other.locator('[data-nb-handle]')).toHaveCount(4);
    for (const h of await other.locator('[data-nb-handle]').all()) await expect(h).toBeVisible();
    expect(await cardAt(other)).toEqual(otherAt);
    await other.locator('.nb-more').tap();
    await expect(page.locator('#noteDocMenu')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.classList.contains('nb-drag-on'))).toBe(false);
    expect(errors).toEqual([]);
  });

  test(`폰 손가락: 판 빈 곳은 판 이동, 가장 크게·작게도 손가락만큼 이동, 가장자리에서 판 자동 이동 (${width})`, async ({ page }) => {
    const { writes, errors } = await fixture(page, width);
    await press(page, view(page, 'board'), width);
    const cdp = await page.context().newCDPSession(page), scroll = page.locator('[data-nb-scroll]');
    const blankOf = () => scroll.evaluate(el => {
      const r = el.getBoundingClientRect();
      for (let y = r.bottom - 30; y > r.top + 60; y -= 20) for (let x = r.right - 60; x > r.left + 60; x -= 20) {
        const hit = document.elementFromPoint(x, y); if (hit && el.contains(hit) && !hit.closest('[data-nb-card],.nb-tools,[data-nb-hit]')) return { x, y };
      }
      return null;
    });
    // 판 빈 곳을 왼쪽으로 밀면 판이 따라 움직인다. 카드 자리(판 좌표)는 그대로, 저장 없음.
    const blank = await blankOf();
    expect(blank).not.toBeNull();
    const v0 = await viewOf(page), card = page.locator('[data-nb-card="n2"]'), at0 = await cardAt(card);
    await touch(cdp, 'touchStart', [blank]); await swipe(cdp, blank, -160, -40, 10); await touch(cdp, 'touchEnd', []);
    const v1 = await viewOf(page);
    expect(Math.abs(v1.x - v0.x + 160)).toBeLessThanOrEqual(2); expect(Math.abs(v1.y - v0.y + 40)).toBeLessThanOrEqual(2);
    expect(await cardAt(card)).toEqual(at0);
    expect(writes.filter(w => w.body?.metadata?.boards)).toEqual([]);
    await expect(view(page, 'board')).toHaveAttribute('aria-pressed', 'true'); // 판 위 옆 밀기는 탭 넘김이 아니다
    await press(page, page.locator('[data-nb-fit]'), width);
    // 가장 크게(2.5배): 손가락 90px = 판 위 36칸.
    const plus = page.locator('[data-nb-zoom="1"]'), minus = page.locator('[data-nb-zoom="-1"]');
    while (await plus.isEnabled()) await press(page, plus, width);
    expect(await zoomOf(page)).toBe(2.5);
    await press(page, page.locator('[data-nb-fit]'), width); // 카드가 보이게 다시 맞춘 뒤 한 단계씩 키워 확인
    while (await plus.isEnabled()) { await press(page, plus, width); }
    await expect(card).toBeAttached();
    // 카드가 화면 밖이면 판을 옮겨 가운데로.
    const fitCard = async () => { const c = await center(card), r = await scroll.boundingBox(); const b = await blankOf(); if (c.x > r.x + 40 && c.x < r.x + r.width - 40 && c.y > r.y + 40 && c.y < r.y + r.height - 40) return; await touch(cdp, 'touchStart', [b]); await swipe(cdp, b, r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y, 10); await touch(cdp, 'touchEnd', []); };
    await fitCard();
    let start = await cardAt(card), from = await center(card);
    await touch(cdp, 'touchStart', [from]); await swipe(cdp, from, 90, 45); await touch(cdp, 'touchEnd', []);
    await expect.poll(() => boardWrites(writes, 'n2').length).toBe(1);
    let end = await cardAt(card);
    expect(Math.abs(end.x - start.x - 36)).toBeLessThanOrEqual(snapSlack(2.5)); expect(Math.abs(end.y - start.y - 18)).toBeLessThanOrEqual(snapSlack(2.5));
    // 아주 작게(약 0.2배 — S71-52 ②부터 가장 작게는 0.04배라 카드가 너무 작아 잡기 어려움): 손가락 40px = 판 위 40/배율 칸, 꾹 누른 뒤 끌기.
    while ((await zoomOf(page)) > 0.205) await press(page, minus, width);
    const small = await zoomOf(page);
    expect(small).toBeLessThan(0.25); expect(small).toBeGreaterThan(0.15);
    await fitCard();
    start = end; from = await center(card);
    await touch(cdp, 'touchStart', [from]); await page.waitForTimeout(700); await swipe(cdp, from, 40, 20); await touch(cdp, 'touchEnd', []);
    await expect.poll(() => boardWrites(writes, 'n2').length).toBe(2);
    end = await cardAt(card);
    expect(Math.abs(end.x - start.x - 40 / small)).toBeLessThanOrEqual(snapSlack(small)); expect(Math.abs(end.y - start.y - 20 / small)).toBeLessThanOrEqual(snapSlack(small));
    // 가장자리: 끄는 손가락을 판 오른쪽 끝에 멈춰 두면 판이 저절로 밀리고 카드도 따라간다.
    await press(page, page.locator('[data-nb-fit]'), width);
    await fitCard();
    const sr = await scroll.boundingBox();
    start = await cardAt(card); from = await center(card);
    const va = await viewOf(page);
    await touch(cdp, 'touchStart', [from]);
    const edge = { x: sr.x + sr.width - 10, y: from.y };
    await swipe(cdp, from, edge.x - from.x, 0, 10);
    await expect.poll(async () => (await viewOf(page)).x).toBeLessThan(va.x - 60);
    await touch(cdp, 'touchEnd', []);
    await expect.poll(() => boardWrites(writes, 'n2').length).toBe(3);
    const vb = await viewOf(page);
    end = await cardAt(card);
    expect(Math.abs(end.x - start.x - (edge.x - from.x + va.x - vb.x) / vb.z)).toBeLessThanOrEqual(4);
    expect(errors).toEqual([]);
  });
}
