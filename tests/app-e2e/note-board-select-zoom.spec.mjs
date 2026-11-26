import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S69-33 (명진 11/24): "눌러서 노트에 붙기 x가아니라 드래그해서 붙이기만 남겨 / 보드에서 드래그 해서 노트 선택 가능하게"
// · "+ - 누르면 현재 몇 %로 보는지 표시" · "그 숫자를 누르면 80% 90% 100% 110% 120% 이렇게 드롭다운이 떠" · "보드 전체 화면 보기 기능 추가"
// · [전체] → 뜻이 드러나는 [맞추기]. 이름 붙은 보드 하나, 붙은 노트 2장(n1·n2)과 안 붙은 노트 1장(n3). 이름은 지어낸 것.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BID = 'b1a2b3c4';
async function fixture(page, width, { touch = false } = {}) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_view: 'board', note_boards: [{ id: BID, name: '교섭' }], note_board: BID });
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n첫 줄 내용', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    row('n1', '가 노트', '2026-10-10T01:00:00Z', { boards: { [BID]: { x: 200, y: 160, r: 1, z: 0 } } }),
    row('n2', '나 노트', '2026-10-16T01:00:00Z', { boards: { [BID]: { x: 360, y: 220, r: 1, z: 1 } } }),
    row('n3', '다 노트', '2026-10-12T01:00:00Z'),
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ id: (q.get('id') || '').slice(3), body }); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  await expect(cards(page)).toHaveCount(2);
  return { rows, writes, errors };
}
const cards = page => page.locator('[data-note-board] [data-nb-card]');
const pct = page => page.locator('[data-note-board] [data-nb-zoom-pct]');
const zoomNow = page => page.locator('[data-note-board]').getAttribute('data-nb-zoom-now').then(Number);
const center = async l => { const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const place = (rows, id) => rows.find(r => r.id === id).metadata.boards?.[BID];

test('PC: 목록 누르기는 붙이지 않음 · 끌어 놓은 자리에 카드 · 붙은 노트 누르면 그 카드로 · 빈 곳 끌어 여러 장 고르기·함께 옮기기·Esc (1440)', async ({ page }) => {
  const { rows, writes, errors } = await fixture(page, 1440);
  const side = page.locator('[data-nbb-side]'), scroll = page.locator('[data-nb-scroll]');
  await side.locator('[data-nbb-folder]', { hasText: '폴더 없음' }).click();
  await expect(side.locator('[data-nbb-note]')).toHaveCount(3);
  // 안내 글: 누르면 붙는다는 말이 없다.
  await expect(side.locator('[data-nbb-note="n3"]')).not.toHaveAttribute('title', /.+/); // S70-79: 줄마다 조작 안내 툴팁 없음
  // 붙은 노트를 누르면 판이 그 카드로(가운데) 가고 그 카드를 고른다. 판을 먼저 멀리 밀어 둔다(휠 = 판 이동).
  await page.mouse.move(700, 500); await page.mouse.wheel(900, 600);
  const sb = await scroll.boundingBox();
  await side.locator('[data-nbb-note="n1"]').click();
  await expect(page.locator('[data-nb-card="n1"]')).toHaveClass(/nb-sel/);
  const c1 = await center(page.locator('[data-nb-card="n1"]'));
  expect(Math.abs(c1.x - (sb.x + sb.width / 2))).toBeLessThanOrEqual(3);
  expect(Math.abs(c1.y - (sb.y + sb.height / 2))).toBeLessThanOrEqual(3);
  expect(writes).toEqual([]);
  // 끌어 놓기: 놓은 자리에 카드.
  const drop = { x: Math.round(sb.width / 2 + 260), y: Math.round(sb.height / 2 + 140) };
  await side.locator('[data-nbb-note="n3"]').dragTo(scroll, { targetPosition: drop });
  await expect(cards(page)).toHaveCount(3);
  const c3 = await center(page.locator('[data-nb-card="n3"]'));
  expect(Math.abs(c3.x - (sb.x + drop.x))).toBeLessThanOrEqual(4);
  expect(Math.abs(c3.y - (sb.y + drop.y))).toBeLessThanOrEqual(4);
  await expect.poll(() => place(rows, 'n3')).toBeTruthy();
  // [맞추기]로 다 보이게 한 뒤 빈 곳 왼쪽 위에서 n1·n2를 덮는 사각형을 끈다(n3는 밖).
  await page.locator('[data-nb-fit]').click();
  const b1 = await page.locator('[data-nb-card="n1"]').boundingBox(), b2 = await page.locator('[data-nb-card="n2"]').boundingBox();
  const b3 = await page.locator('[data-nb-card="n3"]').boundingBox();
  expect(b3.x > Math.max(b1.x + b1.width, b2.x + b2.width) + 12 || b3.y > Math.max(b1.y + b1.height, b2.y + b2.height) + 12).toBe(true); // n3는 사각형 밖
  const from = { x: Math.min(b1.x, b2.x) - 12, y: Math.min(b1.y, b2.y) - 12 };
  expect(await page.evaluate(({ x, y }) => !document.elementFromPoint(x, y)?.closest('[data-nb-card],.nb-tools'), from)).toBe(true);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 40, { steps: 4 });
  await page.mouse.move(Math.max(b1.x + b1.width, b2.x + b2.width) + 10, Math.max(b1.y + b1.height, b2.y + b2.height) + 10, { steps: 6 });
  await expect(page.locator('.marquee-box')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('[data-nb-card].nb-multi')).toHaveCount(2);
  await expect(page.locator('[data-nb-card="n3"]')).not.toHaveClass(/nb-multi/);
  await expect(page.locator('[data-nb-selbar]')).toBeVisible();
  await expect(page.locator('[data-nb-sel-count]')).toHaveText('2개 선택');
  if (process.env.CAPTURE_DIR) await page.screenshot({ path: `${process.env.CAPTURE_DIR}/note-board-select-1440.png` });
  // Shift+클릭 = 더하기·빼기(노트를 열지 않음).
  await page.locator('[data-nb-card="n3"] .nb-open').click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-nb-card].nb-multi')).toHaveCount(3);
  await page.locator('[data-nb-card="n3"] .nb-open').click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-nb-card].nb-multi')).toHaveCount(2);
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  // 고른 카드 하나를 끌면 함께 옮겨진다(같은 만큼).
  const p1 = structuredClone(place(rows, 'n1')), p2 = structuredClone(place(rows, 'n2'));
  const g = await center(page.locator('[data-nb-card="n1"]'));
  await page.mouse.move(g.x - 20, g.y); await page.mouse.down();
  await page.mouse.move(g.x + 20, g.y + 30, { steps: 5 }); await page.mouse.move(g.x + 60, g.y + 50, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => place(rows, 'n1').x).not.toBe(p1.x);
  await expect.poll(() => place(rows, 'n2').x).not.toBe(p2.x);
  const d1 = { x: place(rows, 'n1').x - p1.x, y: place(rows, 'n1').y - p1.y }, d2 = { x: place(rows, 'n2').x - p2.x, y: place(rows, 'n2').y - p2.y };
  expect(Math.abs(d1.x - d2.x)).toBeLessThanOrEqual(1); expect(Math.abs(d1.y - d2.y)).toBeLessThanOrEqual(1);
  expect(d1.x).toBeGreaterThan(20);
  // Esc = 고르기 풀기.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-nb-card].nb-multi')).toHaveCount(0);
  await expect(page.locator('[data-nb-selbar]')).toBeHidden();
  // 다시 고른 뒤 Delete = 함께 보드에서 빼기(노트는 남는다).
  await page.locator('[data-nb-card="n1"] .nb-open').click({ modifiers: ['Shift'] });
  await page.locator('[data-nb-card="n2"] .nb-open').click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-nb-card].nb-multi')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(cards(page)).toHaveCount(1);
  await expect.poll(() => place(rows, 'n1') ?? null).toBe(null);
  await expect.poll(() => place(rows, 'n2') ?? null).toBe(null);
  expect(rows.length).toBe(3);
  // 안 붙은 노트를 누르면 붙지 않고 노트가 열린다.
  await side.locator('[data-nbb-note="n2"]').click();
  await expect(page.locator('[data-note-detail]')).toBeVisible();
  expect(place(rows, 'n2') ?? null).toBe(null);
  expect(errors).toEqual([]);
});

test('PC: 비율 글자·80~120% 목록·[맞추기]·전체 화면(Esc·뒤로가기·노트 목록) (1440)', async ({ page }) => {
  const { errors } = await fixture(page, 1440);
  const shown = async () => Math.round((await zoomNow(page)) * 100);
  await expect(pct(page)).toHaveText(`${await shown()}%`);
  // [＋]·[－]마다 비율 글자가 바뀐다.
  const a = await pct(page).textContent();
  await page.locator('[data-nb-zoom="1"]').click();
  await expect(pct(page)).not.toHaveText(a);
  await expect(pct(page)).toHaveText(`${await shown()}%`);
  await page.locator('[data-nb-zoom="-1"]').click();
  await expect(pct(page)).toHaveText(`${await shown()}%`);
  // Ctrl+휠도.
  const before = await pct(page).textContent();
  const sc = await center(page.locator('[data-nb-scroll]'));
  await page.mouse.move(sc.x, sc.y); await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control');
  await expect(pct(page)).not.toHaveText(before);
  // 비율 글자를 누르면 그 자리에 80~120% 목록, 110%를 고르면 110%.
  await pct(page).click();
  const menu = page.locator('#rowMenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-row-item]')).toHaveText(['80%', '90%', '100%', '110%', '120%']);
  if (process.env.CAPTURE_DIR) await page.screenshot({ path: `${process.env.CAPTURE_DIR}/note-board-zoom-menu-1440.png` });
  const mb = await menu.boundingBox(), pb = await pct(page).boundingBox();
  expect(mb.y).toBeGreaterThanOrEqual(pb.y + pb.height - 1); // 글자 바로 아래
  await menu.locator('[data-row-item="110"]').click();
  await expect(menu).toBeHidden();
  await expect(pct(page)).toHaveText('110%');
  expect(await zoomNow(page)).toBeCloseTo(1.1, 3);
  await pct(page).click();
  await expect(menu.locator('[data-row-item="110"] path')).toHaveCount(1); // 지금 값에 체크
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // [맞추기]: 이름·설명.
  await expect(page.locator('[data-nb-fit]')).toHaveText('맞추기');
  await expect(page.locator('[data-nb-fit]')).toHaveAttribute('title', '맞추기 — 카드가 모두 보이게');
  // 전체 화면: 창 가득, 앱 머리 줄·보기 탭이 안 보이고 도구 줄은 판 오른쪽 위에 그대로.
  // S70-21 NOTE-보드탭자리: 보드 칸 줄은 전체 화면에서도 판 바로 위 한 줄에 함께 있고, 판은 그 아래를 창 끝까지 채운다.
  const full = page.locator('[data-nb-full]');
  await full.click();
  const wrap = page.locator('[data-note-board-wrap]');
  await expect(wrap).toHaveClass(/nbw-full/);
  await expect(page.locator('[data-nbb]')).toBeVisible();
  const vb = page.viewportSize(), sb = await page.locator('[data-nb-scroll]').boundingBox(), bb = await page.locator('[data-nbb]').boundingBox();
  expect(bb.y).toBeLessThanOrEqual(1); expect(bb.height).toBeLessThanOrEqual(40);
  expect(sb.x).toBeLessThanOrEqual(1); expect(Math.abs(sb.y - (bb.y + bb.height))).toBeLessThanOrEqual(1);
  expect(sb.width).toBeGreaterThanOrEqual(vb.width - 2); expect(sb.y + sb.height).toBeGreaterThanOrEqual(vb.height - 2);
  for (const [x, y] of [[4, 4], [vb.width - 4, vb.height - 4], [vb.width / 2, 30], [30, vb.height / 2]])
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-note-board-wrap]'), [x, y]), `${x},${y}`).toBe(true);
  const covered = async sel => { const c = await center(page.locator(sel).first()); return page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-note-board-wrap]'), [c.x, c.y]); };
  expect(await covered('.nv-switch')).toBe(true); // 보기 탭은 덮였다
  const tb = await page.locator('[data-note-board] .nb-tools').boundingBox();
  expect(vb.width - (tb.x + tb.width)).toBeLessThanOrEqual(16); expect(tb.y - sb.y).toBeLessThanOrEqual(16);
  await expect(full).toHaveAttribute('aria-label', '전체 화면 끝내기 (Esc)');
  // 왼쪽 노트 목록은 [노트 목록]으로 옆에 펼친다.
  const sideBtn = page.locator('[data-nb-side-toggle]');
  await expect(page.locator('[data-nbb-side]')).toBeHidden();
  await sideBtn.click();
  await expect(page.locator('[data-nbb-side]')).toBeVisible();
  await expect(sideBtn).toHaveAttribute('aria-pressed', 'true');
  if (process.env.CAPTURE_DIR) await page.screenshot({ path: `${process.env.CAPTURE_DIR}/note-board-full-1440.png` });
  // Esc로 원래대로.
  await page.keyboard.press('Escape');
  await expect(wrap).not.toHaveClass(/nbw-full/);
  await expect(page.locator('[data-nbb]')).toBeVisible();
  expect(await covered('.nv-switch')).toBe(false);
  // 뒤로가기도 원래대로(보드 보기는 그대로).
  await full.click();
  await expect(wrap).toHaveClass(/nbw-full/);
  await page.goBack();
  await expect(wrap).not.toHaveClass(/nbw-full/);
  await expect(page.locator('.nv-switch [data-note-view="board"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(2);
  expect(errors).toEqual([]);
});

for (const width of [412, 884]) {
  test(`폰·폴드: 비율 목록·전체 화면·뒤로가기, [맞추기]는 읽을 수 있는 배율까지만 (${width})`, async ({ browser }) => {
    const ctx = await browser.newContext({ hasTouch: true, isMobile: width < 761 });
    const page = await ctx.newPage();
    const { errors } = await fixture(page, width);
    await page.locator('[data-nb-fit]').tap();
    expect(await zoomNow(page)).toBeGreaterThanOrEqual(0.6 - 1e-6);
    await pct(page).tap();
    const menu = page.locator('#rowMenu');
    await expect(menu).toBeVisible();
    await menu.locator('[data-row-item="90"]').tap();
    await expect(pct(page)).toHaveText('90%');
    await page.locator('[data-nb-full]').tap();
    const wrap = page.locator('[data-note-board-wrap]');
    await expect(wrap).toHaveClass(/nbw-full/);
    if (process.env.CAPTURE_DIR) await page.screenshot({ path: `${process.env.CAPTURE_DIR}/note-board-full-${width}.png` });
    const vb = page.viewportSize();
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-note-board-wrap]'), [vb.width / 2, vb.height - 6])).toBe(true); // 하단 탭도 덮는다
    await page.goBack();
    await expect(wrap).not.toHaveClass(/nbw-full/);
    await expect(cards(page)).toHaveCount(2);
    expect(errors).toEqual([]);
    await ctx.close();
  });
}
