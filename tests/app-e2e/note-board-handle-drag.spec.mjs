import { test, expect } from '@playwright/test';
import { boardFixture, nbNode, nbEditor, nbBox, nbCenter, nbBlank, SB } from './helpers/note-board-fixture.mjs';

// S70-77 NOTE-보드연결점끌기(명진 11/26 09:00 "선을 시작하는 위치랑 동그라미가 뜨는 위치(가이드)가 서로 달라서 조작이 직관적이지 않아").
// - 상자에 마우스를 올리면(폰은 상자를 고르면) 네 방향 연결점 동그라미. 그 동그라미를 눌러 끌면 선이 동그라미 가운데에서 시작한다(보이는 곳 = 잡는 곳).
// - 동그라미: PC 지름 약 12px·잡는 범위 약 24px, 폰 잡는 범위 약 40px.
// - 빈 곳에 놓으면 그 자리에 새 주제 + 선, 바로 글자 입력. 다른 상자·카드 위에 놓으면 잇기만. 놓기 전 Esc = 아무것도 안 생김.
// - 되돌리기(Ctrl+Z·알림 [되돌리기]) 한 번에 새 주제와 선이 함께 사라진다.
// - 상자 메뉴(우클릭·막대 …) [노트로 만들기] = 상자 글을 제목으로 새 노트, 상자 자리에 그 노트 카드(붙은 선은 카드로 옮겨 붙음).
// 이름·글은 지어낸 것.
test.use({ hasTouch: true });
test.describe.configure({ timeout: 60000 });
const BID = 'bs70077';
const SEED = [{ id: 'R1', board_id: BID, body: '시작 주제', x: 300, y: 300 }];
const temp = page => page.locator('[data-nb-temp]');
// 끄는 중 선(임시 선)의 시작점(화면 좌표).
const tempStart = page => temp(page).evaluate(el => { const p = el.getPointAtLength(0), m = el.getScreenCTM(); return { x: p.x * m.a + m.e, y: p.y * m.d + m.f }; });
const near = (a, b, tol = 1.5) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
const menu = page => page.locator('#rowMenu');
// 새 노트 만들기(POST)를 받는 서버 흉내(공용 흉내는 GET·PATCH만) — 만든 노트는 rows에 더해 다음 읽기에도 나온다.
async function acceptNewNotes(page, rows) {
  const made = [];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(); if (req.method() !== 'POST') return r.fallback();
    const body = req.postDataJSON(), saved = { id: `N${made.length + 1}`, kind: 'note', occurred_at: '2026-11-26T01:00:00Z', created_at: '2026-11-26T01:00:00Z', updated_at: '2026-11-26T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}, ...body };
    made.push(saved); rows.push(saved);
    return r.fulfill({ status: 201, json: [structuredClone(saved)] });
  });
  return made;
}

test('PC: 연결점 동그라미에서 끌면 선이 동그라미 가운데에서 시작, 빈 곳 = 새 주제+선+입력, Ctrl+Z 한 번에 둘 다, 상자 위 = 잇기만, Esc = 취소 (1280)', async ({ page }) => {
  const { errors, textRows, linkRows, rows } = await boardFixture(page, 1280, { bid: BID, seed: SEED });
  const made = await acceptNewNotes(page, rows);
  const start = nbNode(page, '시작 주제');
  await start.hover();
  const h = start.locator('[data-nb-handle="right"]');
  await expect(h).toBeVisible();
  const hb = await nbBox(h);
  expect(hb.width).toBeGreaterThanOrEqual(11); expect(hb.width).toBeLessThanOrEqual(14); // 보이는 동그라미 약 12px
  const hc = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  // 마우스를 올리면 진해짐(크기 또는 색이 바뀜).
  const look = () => h.evaluate(el => { const s = getComputedStyle(el); return `${s.transform}|${s.backgroundColor}`; });
  await page.mouse.move(hc.x + 40, hc.y + 40);
  await start.hover();
  const idle = await look();
  await page.mouse.move(hc.x, hc.y);
  await expect.poll(look).not.toBe(idle);
  // 동그라미 가장자리(가운데에서 10px, 잡는 범위 안)를 눌러도 잡히고, 선은 동그라미 가운데에서 시작한다.
  await page.mouse.move(hc.x + 8, hc.y + 6); await page.mouse.down();
  await page.mouse.move(hc.x + 60, hc.y + 50, { steps: 4 });
  await expect(temp(page)).toBeVisible();
  expect(near(await tempStart(page), hc)).toBe(true);
  // 빈 곳에 놓기 → 새 주제(입력 상태) + 이어진 선이 바로 보임.
  const blank = await nbBlank(page);
  await page.mouse.move(blank.x, blank.y, { steps: 8 }); await page.mouse.up();
  await expect(nbEditor(page)).toBeFocused();
  await expect(temp(page)).toBeVisible(); // 쓰는 동안 시작 상자와 새 주제를 잇는 선
  await page.keyboard.type('이은 주제'); await page.keyboard.press('Enter');
  await expect(nbNode(page, '이은 주제')).toHaveCount(1);
  await expect.poll(() => linkRows.length).toBe(1);
  const made1 = textRows.find(t => t.body === '이은 주제');
  expect(linkRows[0]).toMatchObject({ from_text: 'R1', to_text: made1.id, from_side: 'right' });
  await expect(page.locator('[data-nb-lines] [data-nb-line]')).toHaveCount(1);
  // Ctrl+Z 한 번 = 새 주제와 선이 함께 사라짐(서버에서도).
  await page.locator('[data-nb-scroll]').focus().catch(() => {});
  await page.keyboard.press('Control+z');
  await expect(nbNode(page, '이은 주제')).toHaveCount(0);
  await expect(page.locator('[data-nb-lines] [data-nb-line]')).toHaveCount(0);
  await expect.poll(() => textRows.map(t => t.body)).toEqual(['시작 주제']);
  expect(linkRows).toHaveLength(0);
  // 다른 상자(노트 카드) 위에 놓으면 잇기만 — 새 주제는 생기지 않는다.
  await start.hover();
  const hb2 = await nbCenter(start.locator('[data-nb-handle="bottom"]')), card = await nbCenter(page.locator('[data-nb-card="n1"]'));
  await page.mouse.move(hb2.x, hb2.y); await page.mouse.down(); await page.mouse.move(card.x, card.y, { steps: 10 }); await page.mouse.up();
  await expect.poll(() => linkRows.length).toBe(1);
  expect(linkRows[0]).toMatchObject({ from_text: 'R1', to_note: 'n1' });
  expect(textRows).toHaveLength(1);
  await expect(nbEditor(page)).toHaveCount(0);
  // 놓기 전 Esc = 취소(놓아도 아무것도 안 생김).
  await page.mouse.move(blank.x - 200, blank.y - 200);
  await start.hover();
  const hl = await nbCenter(start.locator('[data-nb-handle="left"]'));
  await page.mouse.move(hl.x, hl.y); await page.mouse.down(); await page.mouse.move(hl.x - 40, hl.y + 120, { steps: 6 });
  await expect(temp(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(temp(page)).toBeHidden();
  await page.mouse.move(hl.x - 60, hl.y + 160, { steps: 3 }); await page.mouse.up();
  await expect(nbEditor(page)).toHaveCount(0);
  expect(textRows).toHaveLength(1); expect(linkRows).toHaveLength(1);
  expect(errors).toEqual([]);
});

// 판 시험의 시계는 멈춰 있어(home-entry.mjs setFixedTime) 끌기 뒤 잠깐 막는 우클릭이 풀리지 않는다 — 우클릭 시험은 새 판에서 따로.
test('PC: 상자 우클릭 [노트로 만들기] = 상자 글로 새 노트, 상자 자리에 그 노트 카드, 붙은 선은 카드로 옮겨 붙음 (1280)', async ({ page }) => {
  const { errors, textRows, linkRows, rows } = await boardFixture(page, 1280, { bid: BID, seed: SEED, links: [{ id: 'L9', board_id: BID, from_text: 'R1', to_note: 'n1', from_side: 'bottom' }] });
  const made = await acceptNewNotes(page, rows);
  const start = nbNode(page, '시작 주제');
  const sc = await nbCenter(start);
  await page.mouse.click(sc.x, sc.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  const names = (await menu(page).locator('button').allInnerTexts()).map(t => t.trim());
  expect(names.slice(-2)).toEqual(['노트로 만들기', '삭제']);
  await menu(page).locator('button').filter({ hasText: /^노트로 만들기$/ }).click();
  await expect.poll(() => made.length).toBe(1);
  expect(made[0]).toMatchObject({ kind: 'note', title: '시작 주제' });
  await expect(page.locator(`[data-nb-card="${made[0].id}"]`)).toHaveCount(1);
  await expect(nbNode(page, '시작 주제')).toHaveCount(0);
  await expect.poll(() => textRows.length).toBe(0);
  await expect.poll(() => linkRows.length).toBe(1);
  expect(linkRows[0]).toMatchObject({ from_note: made[0].id, from_text: null, to_note: 'n1' });
  const cb = await nbBox(page.locator(`[data-nb-card="${made[0].id}"]`));
  expect(Math.abs(cb.x + cb.width / 2 - sc.x)).toBeLessThan(120); expect(Math.abs(cb.y + cb.height / 2 - sc.y)).toBeLessThan(120);
  expect(errors).toEqual([]);
});

const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
async function swipe(cdp, from, to, steps = 10) { for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]); }

test('폰: 상자를 고르면 연결점, 손가락으로 끌면 선이 동그라미 가운데에서 시작(잡는 범위 약 40px), 빈 곳 = 새 주제+입력, [되돌리기] 한 번에 둘 다, … [노트로 만들기] (390)', async ({ page }) => {
  const { errors, textRows, linkRows, rows } = await boardFixture(page, 390, { bid: BID, seed: [{ id: 'R1', board_id: BID, body: '시작 주제', x: 40, y: 120 }] });
  const made = await acceptNewNotes(page, rows);
  const cdp = await page.context().newCDPSession(page);
  const start = nbNode(page, '시작 주제');
  await page.locator('[data-nb-fit]').tap(); // 카드·상자가 모두 보이게
  await start.locator('.nb-tx').tap();
  await expect(start).toHaveClass(/nb-sel/);
  const h = start.locator('[data-nb-handle="bottom"]');
  await expect(h).toBeVisible();
  const hb = await nbBox(h), hc = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  // 손가락은 동그라미 가운데에서 16px 벗어나도 잡힌다(잡는 범위 약 40px).
  const grab = { x: hc.x + 12, y: hc.y + 10 };
  await touch(cdp, 'touchStart', [grab]);
  await swipe(cdp, grab, { x: grab.x + 20, y: grab.y + 60 }, 4);
  await expect(temp(page)).toBeVisible();
  expect(near(await tempStart(page), hc)).toBe(true);
  const blank = await nbBlank(page);
  await swipe(cdp, { x: grab.x + 20, y: grab.y + 60 }, blank, 8); await touch(cdp, 'touchEnd', []);
  await expect(nbEditor(page)).toBeFocused();
  await page.keyboard.type('폰 주제'); await page.keyboard.press('Enter');
  await expect(nbNode(page, '폰 주제')).toHaveCount(1);
  await expect.poll(() => linkRows.length).toBe(1);
  // 알림 [되돌리기] 한 번 = 둘 다 사라짐.
  await page.getByRole('button', { name: '되돌리기' }).tap();
  await expect(nbNode(page, '폰 주제')).toHaveCount(0);
  await expect.poll(() => textRows.length).toBe(1);
  expect(linkRows).toHaveLength(0);
  // 고른 상자 막대 … → [노트로 만들기].
  await start.locator('.nb-tx').tap();
  await expect(start).toHaveClass(/nb-sel/);
  await page.locator('.nb-node-bar [data-nb-bar-open="more"]').tap();
  await page.locator('.nb-node-bar [data-nb-to-note]').tap();
  await expect.poll(() => made.length).toBe(1);
  expect(made[0]).toMatchObject({ title: '시작 주제' });
  await expect(page.locator(`[data-nb-card="${made[0].id}"]`)).toHaveCount(1);
  await expect(nbNode(page, '시작 주제')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});
