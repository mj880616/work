import { test, expect } from '@playwright/test';
import { boardFixture, nbNode, nbEditor, nbBox, nbBlank } from './helpers/note-board-fixture.mjs';

// S70-03 ① NOTE-보드빈주제칸(명진 11/25 09:26): [+ 주제]로 연 빈 칸 둘레(네 방향 이동 표시)를 잡으면 칸이 사라지던 것.
// - 새 칸(글자 없음)도 둘레를 잡고 끌면 그 자리로 옮겨지고 글쓰기는 그대로(놓은 자리에서 저장).
// - 둘레를 누르기만 하면 사라지지 않고 글쓰기 그대로. 칸 밖 빈 곳을 누를 때만 글 없는 새 칸을 만들지 않는다(지금 규칙 유지).
// - 폰은 손가락 닿는 범위가 넓어 둘레 띠 대신 칸 안(입력칸)에서 끌어도 옮긴다.
// - 가지 새 칸(+ 하위)은 자리를 배치가 정하므로 끌 수 없다 — 이동 표시도 없고, 둘레를 눌러도 사라지지 않는다.
test.use({ hasTouch: true });
test.describe.configure({ timeout: 60000 });
const DRAFT = '[data-nb-texts] [data-nb-text="__draft"]';
// 칸 위 둘레 띠(칸 밖 4px, 왼쪽에서 1/4 — 크기 손잡이·잇기 손잡이를 피한 곳) — 글 쓰는 중 이동 표시가 뜨는 곳.
async function band(page) { const b = await nbBox(page.locator(DRAFT)); return { x: b.x + b.width / 4, y: b.y - 4, box: b }; }

for (const kind of ['주제', '글자']) {
  test(`PC: 빈 새 ${kind} 칸 둘레를 끌면 옮겨지고 글쓰기 그대로, 놓은 자리에 저장 (1280)`, async ({ page }) => {
    const { errors, textCalls, textRows } = await boardFixture(page, 1280);
    await page.locator(kind === '주제' ? '[data-nb-add-text]' : '[data-nb-add-label]').click();
    await expect(nbEditor(page)).toBeFocused();
    const from = await band(page);
    expect(await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y), '::before').cursor, from)).toBe('move');
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + 150, from.y + 90, { steps: 10 }); await page.mouse.up();
    await expect(page.locator(DRAFT)).toHaveCount(1);
    await expect(nbEditor(page)).toBeFocused();
    const moved = await nbBox(page.locator(DRAFT));
    expect(Math.abs(moved.x - (from.box.x + 150))).toBeLessThanOrEqual(3);
    expect(Math.abs(moved.y - (from.box.y + 90))).toBeLessThanOrEqual(3);
    expect(textCalls.filter(c => c.method === 'POST')).toHaveLength(0);
    await page.keyboard.type(`옮긴 ${kind}`); await page.keyboard.press('Enter');
    await expect(nbNode(page, `옮긴 ${kind}`)).toHaveCount(1);
    const saved = await nbBox(nbNode(page, `옮긴 ${kind}`));
    expect(Math.abs(saved.x - moved.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(saved.y - moved.y)).toBeLessThanOrEqual(3);
    expect(textRows.filter(t => t.body === `옮긴 ${kind}`)).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

test('PC: 빈 새 주제 둘레 누르기 = 사라지지 않고 글쓰기, 칸 밖 빈 곳 누르기 = 만들지 않음 (1280)', async ({ page }) => {
  const { errors, textCalls } = await boardFixture(page, 1280);
  await page.locator('[data-nb-add-text]').click();
  const at = await band(page);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(DRAFT)).toHaveCount(1);
  await expect(nbEditor(page)).toBeFocused();
  await page.keyboard.type('누른 뒤 쓰기');
  // 칸 밖 빈 곳 = 저장(글이 있으면)
  const blank = await nbBlank(page); await page.mouse.click(blank.x, blank.y);
  await expect(nbNode(page, '누른 뒤 쓰기')).toHaveCount(1);
  // 다시 빈 새 칸 → 칸 밖 빈 곳 = 글 없는 새 칸은 만들지 않는다
  await page.locator('[data-nb-add-text]').click();
  await expect(page.locator(DRAFT)).toHaveCount(1);
  const blank2 = await nbBlank(page); await page.mouse.click(blank2.x, blank2.y);
  await expect(page.locator(DRAFT)).toHaveCount(0);
  await expect(nbEditor(page)).toHaveCount(0);
  expect(textCalls.filter(c => c.method === 'POST')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('PC: 가지 새 칸(+ 하위)은 이동 표시가 없고 둘레를 눌러도 사라지지 않음 (1280)', async ({ page }) => {
  const { errors } = await boardFixture(page, 1280, { seed: [{ id: 'T90', board_id: 'bs70003', body: '뿌리', x: 300, y: 420 }] });
  await nbNode(page, '뿌리').locator('.nb-tx').click();
  await page.keyboard.press('Tab');
  await expect(page.locator(DRAFT)).toHaveCount(1);
  const at = await band(page);
  expect(await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y), '::before').cursor, at)).not.toBe('move');
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(DRAFT)).toHaveCount(1);
  await expect(nbEditor(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test('폰: 빈 새 주제 칸을 손가락으로 끌면 옮겨지고 글쓰기 그대로 (390)', async ({ page }) => {
  const { errors } = await boardFixture(page, 390);
  await page.locator('[data-nb-add-text]').click();
  await expect(page.locator(DRAFT)).toHaveCount(1);
  const b0 = await nbBox(page.locator(DRAFT)), from = { x: b0.x + b0.width / 2, y: b0.y + b0.height / 2, box: b0 }; // 폰: 손가락은 칸 안(입력칸)에서 끈다
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  await touch('touchStart', [from]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: from.x + 6 * i, y: from.y + 8 * i }]);
  await touch('touchEnd', []);
  await expect(page.locator(DRAFT)).toHaveCount(1);
  const moved = await nbBox(page.locator(DRAFT));
  expect(Math.abs(moved.x - (from.box.x + 60))).toBeLessThanOrEqual(4);
  expect(Math.abs(moved.y - (from.box.y + 80))).toBeLessThanOrEqual(4);
  await expect(nbEditor(page)).toHaveCount(1);
  // 짧게 누르기 = 글쓰기 그대로(사라지지 않음)
  const c = await nbBox(page.locator(DRAFT));
  await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2);
  await expect(page.locator(DRAFT)).toHaveCount(1);
  await expect(nbEditor(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});
