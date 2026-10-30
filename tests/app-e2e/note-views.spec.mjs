import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

// NOTE-보기3가지 (요청함 10/29 15:05, 명진 15:10 '추천대로'): 노트 검색 칸 오른쪽 [폴더|목록|포스트잇].
// 목록 = 모든 노트 최근 고친 순 한 줄(폴더 꼬리표·날짜), 포스트잇 = 넓은 보드 위 같은 크기 칸(제목·앞 줄·폴더 이름), 끌어 놓으면
// metadata.board로 서버 저장(처음 옮길 때 아직 자리 없는 칸도 보이던 자리로 함께), 끈 칸은 맨 위. 검색은 세 보기 모두. 폰 412·884, PC 1440. 이름은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const F = '00000000-0000-4000-8000-000000000001';
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n첫 줄 내용\n둘째 줄', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    row('n1', '가 노트', '2026-10-10T01:00:00Z', { folder_id: F }),
    row('n2', '나 노트', '2026-10-16T01:00:00Z'),
    row('n3', '다 노트', '2026-10-12T01:00:00Z', { folder_id: F }),
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
  test(`세 보기 전환·목록 순서·포스트잇 칸·검색 (${width})`, async ({ page }) => {
    const { errors } = await fixture(page, width);
    await expect(view(page, 'folder')).toHaveAttribute('aria-pressed', 'true');
    const head = await page.locator('.note-list-head').boundingBox(), sw = await page.locator('.nv-switch').boundingBox();
    expect(sw.height).toBeLessThanOrEqual(34); expect(sw.y + sw.height).toBeLessThanOrEqual(head.y + head.height + 1);
    // 목록: 최근 고친 순(나 → 다 → 가), 폴더 노트에만 꼬리표.
    await press(page, view(page, 'list'), width);
    await expect(view(page, 'list')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-nx-tree]')).toBeHidden();
    await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(3);
    await expect(page.locator('#noteRows .basket-title-text')).toHaveText(['나 노트', '다 노트', '가 노트']);
    await expect(page.locator('#noteRows [data-nx-note="n3"] .nx-path')).toHaveText('회의');
    await expect(page.locator('#noteRows [data-nx-note="n2"] .nx-path')).toHaveCount(0);
    // 포스트잇: 같은 크기 칸 3장, 제목·앞 줄·폴더 이름.
    await press(page, view(page, 'board'), width);
    const cards = page.locator('[data-note-board] [data-nb-card]');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('[data-nx-body]')).toBeHidden();
    await expect(page.locator('[data-nb-card="n1"] .nb-title')).toHaveText('가 노트');
    await expect(page.locator('[data-nb-card="n1"] .nb-text')).toContainText('첫 줄 내용');
    await expect(page.locator('[data-nb-card="n1"] .nb-folder')).toHaveText('회의');
    const sizes = await cards.evaluateAll(list => list.map(el => [el.offsetWidth, el.offsetHeight]));
    expect(new Set(sizes.map(s => s.join('x'))).size).toBe(1);
    expect(await page.locator('[data-nb-card="n1"]').getAttribute('data-tone')).toBe(await page.locator('[data-nb-card="n3"]').getAttribute('data-tone'));
    expect(await page.locator('[data-nb-card="n2"]').getAttribute('data-tone')).toBe('none');
    // 검색은 포스트잇에서도.
    await page.locator('[data-note-search]').fill('다 노트');
    await expect(cards).toHaveCount(1);
    await page.locator('[data-note-search]').fill('');
    await expect(cards).toHaveCount(3);
    // [＋][－]
    const before = await page.locator('[data-nb-sizer]').evaluate(el => el.offsetWidth);
    await press(page, page.locator('[data-nb-zoom="1"]'), width);
    expect(await page.locator('[data-nb-sizer]').evaluate(el => el.offsetWidth)).toBeGreaterThan(before);
    // 한 번 누르면 노트 열기.
    await press(page, page.locator('[data-nb-card="n2"] .nb-open'), width);
    await expect(page.locator('[data-note-detail]')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('포스트잇 끌어 놓기: 서버 저장(처음엔 모두), 끈 칸이 맨 위, 다시 그려도 그 자리 (1440)', async ({ page }) => {
  const { writes, errors } = await fixture(page, 1440);
  await view(page, 'board').click();
  const card = page.locator('[data-nb-card="n1"]');
  const z = el => el.evaluate(n => Number(n.style.zIndex));
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40); await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120, { steps: 6 }); await page.mouse.move(box.x + 240, box.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => writes.filter(w => w.body?.metadata?.board).length).toBe(3);
  const moved = writes.find(w => w.id === 'n1' && w.body.metadata.board).body.metadata.board;
  expect(Object.keys(moved).sort()).toEqual(['r', 'x', 'y', 'z']);
  for (const w of writes) expect(w.body.updated_at).toBeUndefined(); // 옮기기는 고치기가 아니다
  const others = await Promise.all(['n2', 'n3'].map(id => z(page.locator(`[data-nb-card="${id}"]`))));
  expect(await z(card)).toBeGreaterThan(Math.max(...others));
  // 끈 뒤에는 열리지 않는다.
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  // 다른 보기로 갔다 와도(다시 그림) 같은 자리.
  const left = await card.evaluate(n => n.style.left);
  await view(page, 'list').click(); await view(page, 'board').click();
  await expect(page.locator('[data-nb-card="n1"]')).toHaveCSS('left', left);
  expect(errors).toEqual([]);
});

// NOTE-포스트잇끌기 (요청함 10/30 14:09 "둘 다 되게"): 폰·폴드 한 손가락 — 바로 끌기도, 꾹 누른 뒤 끌기도 옮기고 서버 저장,
// 꾹 눌렀다 움직이지 않고 떼면 노트 메뉴(끌기를 끊지 않음), 판 빈 곳은 판 밀기, 확대 상태에서도 손가락만큼 움직인다(배율 반영).
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
const cardAt = l => l.evaluate(n => ({ x: parseFloat(n.style.left), y: parseFloat(n.style.top) }));
async function center(l) { await l.scrollIntoViewIfNeeded(); const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 + 10 }; }
async function swipe(cdp, from, dx, dy, steps = 8) { for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', [{ x: from.x + dx * i / steps, y: from.y + dy * i / steps }]); }
const boardWrites = (writes, id) => writes.filter(w => w.id === id && w.body?.metadata?.board);
const zoomOf = page => page.locator('[data-nb-board]').evaluate(n => Number(/scale\(([\d.]+)\)/.exec(n.style.transform)?.[1]));

for (const width of [412, 884]) {
  test(`폰 손가락: 바로 끌기·꾹 눌러 끌기 이동·저장, 꾹 눌렀다 떼면 메뉴 (${width})`, async ({ page }) => {
    const { writes, errors } = await fixture(page, width);
    await press(page, view(page, 'board'), width);
    const cdp = await page.context().newCDPSession(page);
    const card = page.locator('[data-nb-card="n2"]'), zoom = await zoomOf(page);
    // 1) 바로 끌기: 누르자마자 움직인다.
    let start = await cardAt(card), from = await center(card);
    await touch(cdp, 'touchStart', [from]); await swipe(cdp, from, 60, 40); await touch(cdp, 'touchEnd', []);
    await expect.poll(() => boardWrites(writes, 'n2').length).toBe(1);
    let end = await cardAt(card);
    expect(Math.abs(end.x - start.x - 60 / zoom)).toBeLessThanOrEqual(2); expect(Math.abs(end.y - start.y - 40 / zoom)).toBeLessThanOrEqual(2);
    expect(boardWrites(writes, 'n2')[0].body.metadata.board.x).toBe(end.x);
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
    expect(Math.abs(end.x - start.x + 50 / zoom)).toBeLessThanOrEqual(2); expect(Math.abs(end.y - start.y - 30 / zoom)).toBeLessThanOrEqual(2);
    await expect(card).not.toHaveClass(/nb-held|nb-dragging/);
    await expect(page.locator('#noteDocMenu')).toBeHidden();
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    // 3) 꾹 눌렀다 움직이지 않고 떼면 노트 메뉴(열리지 않음, 자리 그대로).
    from = await center(card);
    await touch(cdp, 'touchStart', [from]); await page.waitForTimeout(700); await touch(cdp, 'touchEnd', []);
    await expect(page.locator('#noteDocMenu')).toBeVisible();
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    expect(boardWrites(writes, 'n2').length).toBe(2);
    expect(await cardAt(card)).toEqual(end);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.classList.contains('nb-drag-on'))).toBe(false);
    expect(errors).toEqual([]);
  });

  test(`폰 손가락: 판 빈 곳은 판 밀기, 가장 크게(1.5배)·작게(0.5배)도 손가락만큼 이동, 가장자리에서 판 자동 밀림 (${width})`, async ({ page }) => {
    const { writes, errors } = await fixture(page, width);
    await press(page, view(page, 'board'), width);
    const cdp = await page.context().newCDPSession(page), scroll = page.locator('[data-nb-scroll]');
    // 판 빈 곳(칸·크기 단추가 없는 곳)을 왼쪽으로 밀면 판이 오른쪽으로 밀린다. 칸은 그대로.
    const blank = await scroll.evaluate(el => {
      const r = el.getBoundingClientRect();
      for (let y = r.bottom - 30; y > r.top + 60; y -= 20) for (let x = r.right - 60; x > r.left + 60; x -= 20) {
        const hit = document.elementFromPoint(x, y); if (hit && el.contains(hit) && !hit.closest('[data-nb-card],.nb-tools')) return { x, y };
      }
      return null;
    });
    expect(blank).not.toBeNull();
    await touch(cdp, 'touchStart', [blank]); await swipe(cdp, blank, -160, 0, 10); await touch(cdp, 'touchEnd', []);
    await expect.poll(() => scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(40);
    expect(writes.filter(w => w.body?.metadata?.board)).toEqual([]);
    await scroll.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
    // 가장 크게: 손가락 90px = 판 위 60칸(1.5배).
    const plus = page.locator('[data-nb-zoom="1"]'), minus = page.locator('[data-nb-zoom="-1"]');
    while (await plus.isEnabled()) await press(page, plus, width);
    expect(await zoomOf(page)).toBe(1.5);
    const card = page.locator('[data-nb-card="n2"]');
    let start = await cardAt(card), from = await center(card);
    await touch(cdp, 'touchStart', [from]); await swipe(cdp, from, 90, 45); await touch(cdp, 'touchEnd', []);
    await expect.poll(() => boardWrites(writes, 'n2').length).toBe(1);
    let end = await cardAt(card);
    expect(Math.abs(end.x - start.x - 60)).toBeLessThanOrEqual(2); expect(Math.abs(end.y - start.y - 30)).toBeLessThanOrEqual(2);
    // 가장 작게: 손가락 50px = 판 위 100칸(0.5배), 꾹 누른 뒤 끌기.
    while (await minus.isEnabled()) await press(page, minus, width);
    expect(await zoomOf(page)).toBe(0.5);
    start = end; from = await center(card);
    await touch(cdp, 'touchStart', [from]); await page.waitForTimeout(700); await swipe(cdp, from, 50, 25); await touch(cdp, 'touchEnd', []);
    await expect.poll(() => boardWrites(writes, 'n2').length).toBe(2);
    end = await cardAt(card);
    expect(Math.abs(end.x - start.x - 100)).toBeLessThanOrEqual(3); expect(Math.abs(end.y - start.y - 50)).toBeLessThanOrEqual(3);
    // 가장자리: 끄는 손가락을 판 오른쪽 끝에 멈춰 두면 판이 저절로 밀리고 칸도 따라간다.
    await press(page, plus, width); await press(page, plus, width); await press(page, plus, width); // 0.5 → 1
    await scroll.evaluate(el => { el.scrollLeft = 0; });
    const sr = await scroll.boundingBox();
    start = await cardAt(card); from = await center(card);
    const scroll0 = await scroll.evaluate(el => el.scrollLeft);
    await touch(cdp, 'touchStart', [from]);
    const edge = { x: sr.x + sr.width - 12, y: from.y };
    await swipe(cdp, from, edge.x - from.x, 0, 10);
    await expect.poll(() => scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(scroll0 + 60);
    await touch(cdp, 'touchEnd', []);
    await expect.poll(() => boardWrites(writes, 'n2').length).toBe(3);
    const scrolled = await scroll.evaluate(el => el.scrollLeft);
    end = await cardAt(card);
    expect(Math.abs(end.x - start.x - (edge.x - from.x + scrolled - scroll0) / (await zoomOf(page)))).toBeLessThanOrEqual(3);
    expect(errors).toEqual([]);
  });
}
