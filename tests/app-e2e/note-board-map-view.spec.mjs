import { test, expect } from '@playwright/test';
import { boardFixture, nbNode } from './helpers/note-board-fixture.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { screenFind } from './helpers/screen-find.mjs';

// S71-52 ② NOTE-큰생각지도 보기 기능(사용자 2026-11-26 19:58 "광범위한 생각지도 … 무한정 뻗어나가는", docs/design/note-board-mindmap.md 11절):
// ④ 아주 작게 줄이면 큰 가지(뿌리·첫 가지)만 글자, 그 아래는 흐린 막대 ⑤ 미니맵(오른쪽 아래, 접기·서버 기억, 누르면 그 자리로, 폰 기본 접힘)
// ⑥ 맨 위 '노트에서 찾기'가 보드 주제도 맞춤(띄어쓰기 무시) → 누르면 그 주제로·접힌 가지 펴기 ⑦ 주제 막대 […] '이 가지만 보기' · [전체 보기]. 글은 지어낸 것.
const BID = 'bmapv001';
const SEED = [
  { id: 'R', board_id: BID, body: '큰 주제', x: 300, y: 300, font: 4 },
  { id: 'A', board_id: BID, body: '가지 하나', parent_id: 'R', ord: 0, side: 1 },
  { id: 'A1', board_id: BID, body: '작은 잎', parent_id: 'A', ord: 0 },
  { id: 'B', board_id: BID, body: '가지 둘', parent_id: 'R', ord: 1, side: -1, collapsed: true },
  { id: 'B1', board_id: BID, body: '숨은 낱말', parent_id: 'B', ord: 0 },
  { id: 'Z', board_id: BID, body: '멀리 주제', x: 7000, y: 5000, font: 4 },
];
const tx = (page, id) => page.locator(`[data-nb-texts] [data-nb-text="${id}"]`);
const zoomOut = async (page, steps) => { const s = await page.locator('[data-note-board] [data-nb-scroll]').boundingBox(); await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.keyboard.down('Control'); for (let i = 0; i < Math.abs(steps); i++) await page.mouse.wheel(0, steps > 0 ? 200 : -200); await page.keyboard.up('Control'); };
// 그 상자가 판 칸 안에 다 보이나(화면 밖 상자는 붙어 있지 않으므로 없으면 거짓).
const inScroll = (page, l) => l.evaluateAll(els => { const el = els[0]; if (!el) return false; const s = document.querySelector('[data-note-board] [data-nb-scroll]').getBoundingClientRect(), b = el.getBoundingClientRect(); return b.left >= s.left && b.top >= s.top && b.right <= s.right && b.bottom <= s.bottom; });

test('④ 멀리 보기: 아주 작게 줄이면 큰 가지만 글자(화면에서 읽히는 크기), 그 아래는 흐린 막대, 다시 키우면 모든 글 (1280)', async ({ page }) => {
  const { errors } = await boardFixture(page, 1280, { bid: BID, seed: SEED });
  const box = page.locator('[data-note-board]');
  await expect(box).not.toHaveAttribute('data-nb-far', '');
  await page.locator('[data-note-board] [data-nb-fit]').click();
  await zoomOut(page, 6);
  await expect(box).toHaveAttribute('data-nb-far', '');
  const look = id => tx(page, id).evaluate(el => ({ ink: getComputedStyle(el.querySelector('.nb-tx')).color, label: getComputedStyle(el, '::after').content, deep: el.hasAttribute('data-deep'), op: getComputedStyle(el).opacity, s: getComputedStyle(el, '::after').transform }));
  const root = await look('R'), branch = await look('A'), leaf = await look('A1');
  expect(root.label).toBe('"큰 주제"'); expect(branch.label).toBe('"가지 하나"');
  expect(leaf.deep).toBe(true); expect(leaf.label).toBe('none'); expect(leaf.ink).toBe('rgba(0, 0, 0, 0)'); expect(Number(leaf.op)).toBeLessThan(0.6);
  expect(root.s).not.toBe('none'); // 큰 가지 글자는 키운 글자(scale)
  // 다시 키우면 모든 글이 보인다.
  await zoomOut(page, -6);
  await expect(box).not.toHaveAttribute('data-nb-far', '');
  const back = await look('A1');
  expect(back.ink).not.toBe('rgba(0, 0, 0, 0)'); expect(back.label).toBe('none'); expect(Number(back.op)).toBe(1);
  expect(errors).toEqual([]);
});

test('⑤ 미니맵: PC 기본 펼침 · 누르면 그 자리로 · 접기는 서버에 기억 (1280)', async ({ page }) => {
  const { errors } = await boardFixture(page, 1280, { bid: BID, seed: SEED });
  const server = await installViewPrefsServer(page);
  const body = page.locator('[data-note-board] [data-nb-mini-body]');
  await expect(body).toBeVisible();
  await expect(page.locator('[data-note-board] [data-nb-mini]')).toHaveAttribute('data-nb-mini-count', '6');
  await expect(page.locator('[data-note-board] [data-nb-mini-view]')).toBeVisible();
  expect(await inScroll(page, tx(page, 'Z'))).toBe(false);
  // 멀리 주제(판 오른쪽 아래 끝)는 미니맵 오른쪽 아래 끝 근처 — 누르면 그 자리가 화면 가운데로.
  const c = await body.boundingBox();
  await page.mouse.click(c.x + c.width - 12, c.y + c.height - 12);
  await expect.poll(() => inScroll(page, tx(page, 'Z'))).toBe(true);
  // 접기 → 서버 note_board_map.pc = false, 다시 펴기 → true.
  await page.locator('[data-note-board] [data-nb-mini-toggle]').click();
  await expect(body).toBeHidden();
  await expect.poll(() => server.value?.note_board_map?.pc).toBe(false);
  await page.locator('[data-note-board] [data-nb-mini-toggle]').click();
  await expect(body).toBeVisible();
  await expect.poll(() => server.value?.note_board_map?.pc).toBe(true);
  expect(errors).toEqual([]);
});

test('⑤ 미니맵: 폰은 기본 접힘, 펴면 보임 (390)', async ({ page }) => {
  await boardFixture(page, 390, { bid: BID, seed: SEED });
  await expect(page.locator('[data-note-board] [data-nb-mini-toggle]')).toBeVisible();
  await expect(page.locator('[data-note-board] [data-nb-mini-body]')).toBeHidden();
  await page.locator('[data-note-board] [data-nb-mini-toggle]').click();
  await expect(page.locator('[data-note-board] [data-nb-mini-body]')).toBeVisible();
});

for (const width of [1280, 390]) {
  test(`⑥ 보드 안 찾기: 맨 위 찾기가 주제를 띄어쓰기 없이도 맞추고, 누르면 그 주제로 가며 접힌 가지를 편다 (${width})`, async ({ page }) => {
    const { errors, textRows } = await boardFixture(page, width, { bid: BID, seed: SEED });
    await expect(tx(page, 'B1')).toHaveCount(0); // 접힌 가지 안
    const find = await screenFind(page);
    await find.fill('숨은낱말');
    const list = page.locator('[data-note-board] [data-nb-finds]');
    await expect(list).toBeVisible();
    await expect(list.locator('[data-nb-find-go]')).toHaveText(['숨은 낱말']);
    await list.locator('[data-nb-find-go="B1"]').click();
    await expect.poll(() => textRows.find(t => t.id === 'B').collapsed).toBe(false);
    await expect(nbNode(page, '숨은 낱말')).toBeVisible();
    await expect.poll(() => inScroll(page, tx(page, 'B1'))).toBe(true);
    await expect(tx(page, 'B1')).toHaveClass(/nb-sel/);
    await find.fill('멀리');
    await expect(list.locator('[data-nb-find-go]')).toHaveText(['멀리 주제']);
    await list.locator('[data-nb-find-go="Z"]').click();
    await expect.poll(() => inScroll(page, tx(page, 'Z'))).toBe(true);
    await find.fill('');
    await expect(list).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('⑦ 이 가지만 보기: 고른 주제와 그 아래만 또렷하게, 나머지는 흐리게 · [전체 보기]로 돌아오기 (1280)', async ({ page }) => {
  const { errors } = await boardFixture(page, 1280, { bid: BID, seed: SEED });
  await tx(page, 'A').locator('.nb-tx').click();
  const bar = page.locator('[data-nb-bar]');
  await bar.locator('[data-nb-bar-open="more"]').click();
  await bar.locator('[data-nb-focus]').click();
  const focusbar = page.locator('[data-note-board] [data-nb-focusbar]');
  await expect(focusbar).toBeVisible();
  await expect(focusbar).toContainText('이 가지만 보는 중');
  const op = id => tx(page, id).evaluate(el => Number(getComputedStyle(el).opacity));
  expect(await op('A')).toBe(1); expect(await op('A1')).toBe(1);
  expect(await op('R')).toBeLessThan(0.3);
  expect(await page.locator('[data-note-board] [data-nb-card]').evaluate(el => Number(getComputedStyle(el).opacity))).toBeLessThan(0.3);
  await focusbar.locator('[data-nb-focus-all]').click();
  await expect(focusbar).toBeHidden();
  expect(await op('R')).toBe(1);
  await expect(page.locator('[data-note-board]')).not.toHaveAttribute('data-nb-focus', '');
  expect(errors).toEqual([]);
});
