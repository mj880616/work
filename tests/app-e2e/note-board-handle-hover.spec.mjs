import { test, expect } from '@playwright/test';
import { boardFixture, nbNode, nbBox, nbCenter } from './helpers/note-board-fixture.mjs';

// S71-48 NOTE-연결점유지(사용자 2026-11-26 19:46 "저 동그라미로 마우스 커서를 가져갈라고 주제 네모 바깥으로 커서를 옮기면 동그라미가 사라져").
// B2: 마우스를 올려 연결점 동그라미(·⋯·×)가 보이는 동안에는 '상자 + 떠 있는 동그라미·단추를 둘러싼 띠' 안이면 계속 보인다.
// - 상자 밖 틈을 지나 동그라미까지 천천히 가도 사라지지 않고, 동그라미 위에서는 크고 진하게, 거기서 끌면 선.
// - 띠를 벗어나면 잠깐(공용 값) 뒤 사라진다.
// - 이웃 상자와 띠가 겹치면 커서에 가까운 상자 것만 보인다.
// - 손가락(폰)은 그대로(고르기로만 보임). 이름·글은 지어낸 것.
test.describe.configure({ timeout: 60000 });
const BID = 'bs71048';
const handles = el => el.locator('[data-nb-handle]');
const shown = el => handles(el).first().isVisible();

for (const width of [1280, 884]) {
  test(`B2 PC ${width}: 상자 밖 틈을 지나 동그라미까지 가도 유지 → 동그라미가 커지고 진해짐 → 끌어 선, 띠 밖이면 사라짐`, async ({ page }) => {
    const { errors, linkRows } = await boardFixture(page, width, { bid: BID, seed: [{ id: 'R1', board_id: BID, body: '시작 주제', x: 300, y: 300 }] });
    const start = nbNode(page, '시작 주제');
    await expect(start).toHaveCount(1);
    const b = await nbBox(start), c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await page.mouse.move(c.x, c.y);
    const h = start.locator('[data-nb-handle="right"]');
    await expect(h).toBeVisible();
    const look = () => h.evaluate(el => { const s = getComputedStyle(el); return `${s.transform}|${s.backgroundColor}`; });
    const idle = await look(); // 상자 위(동그라미 밖)에서의 모양
    const hb = await nbBox(h), hc = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    expect(hb.x - (b.x + b.width)).toBeGreaterThan(6); // 동그라미는 상자 밖에 떠 있다(틈이 있음)
    // 상자 오른쪽 변 → 동그라미까지 한 걸음씩(틈을 지남). 걸음마다 동그라미가 보여야 한다.
    const from = { x: b.x + b.width - 4, y: c.y }, steps = 12;
    for (let i = 0; i <= steps; i++) {
      await page.mouse.move(from.x + (hc.x - from.x) * i / steps, c.y);
      expect(await h.isVisible(), `걸음 ${i}`).toBe(true);
    }
    // 틈 한가운데서 잠깐 멈춰도(여유 시간보다 길게) 그대로 보인다 — 대기가 아니라 띠 판정.
    await page.mouse.move((b.x + b.width + hb.x) / 2, c.y);
    await page.waitForTimeout(600);
    await expect(h).toBeVisible();
    // 동그라미 위 = 크고 진하게(누를 수 있음).
    await page.mouse.move(b.x + b.width - 4, c.y);
    await expect.poll(look).toBe(idle);
    await page.mouse.move(hc.x, hc.y);
    await expect.poll(look).not.toBe(idle);
    // 띠 밖(동그라미 바깥 끝에서 한참)으로 → 잠깐 뒤 사라짐.
    await page.mouse.move(hb.x + hb.width + 60, c.y + 60, { steps: 4 });
    await expect(h).toBeHidden({ timeout: 1500 });
    // 다시 올려 틈을 지나 동그라미로 가서, 끌어 노트 카드에 놓으면 선.
    await page.mouse.move(c.x, c.y);
    await expect(h).toBeVisible();
    await page.mouse.move(hc.x, hc.y, { steps: 10 });
    await expect(h).toBeVisible();
    const card = await nbCenter(page.locator('[data-nb-card="n1"]'));
    await page.mouse.down(); await page.mouse.move(card.x, card.y, { steps: 10 }); await page.mouse.up();
    await expect.poll(() => linkRows.length).toBe(1);
    expect(linkRows[0]).toMatchObject({ from_text: 'R1', to_note: 'n1', from_side: 'right' });
    expect(errors).toEqual([]);
  });
}

test('B2 PC 1280: 노트 카드도 같은 띠 — 위에 떠 있는 ⋯까지 가도 유지', async ({ page }) => {
  const { errors } = await boardFixture(page, 1280, { bid: BID, seed: [] });
  const card = page.locator('[data-nb-card="n1"]');
  const b = await nbBox(card);
  await page.mouse.move(b.x + b.width - 6, b.y + b.height / 2);
  const more = card.locator('.nb-more');
  await expect(more).toBeVisible();
  const mb = await nbBox(more), steps = 10, x = mb.x + mb.width / 2;
  for (let i = 0; i <= steps; i++) {
    await page.mouse.move(x, b.y + 2 - (b.y + 2 - (mb.y + mb.height / 2)) * i / steps);
    expect(await more.isVisible(), `걸음 ${i}`).toBe(true);
  }
  await page.mouse.move(x, mb.y - 70);
  await expect(more).toBeHidden({ timeout: 1500 });
  expect(errors).toEqual([]);
});

test('B2 PC 1280: 이웃 상자와 띠가 겹치면 커서에 가까운 상자 동그라미만', async ({ page }) => {
  const { errors } = await boardFixture(page, 1280, { bid: BID, seed: [
    { id: 'R1', board_id: BID, body: '위 주제', x: 300, y: 300 },
    { id: 'R2', board_id: BID, body: '아래 주제', x: 300, y: 380 },
  ] });
  const up = nbNode(page, '위 주제'), down = nbNode(page, '아래 주제');
  const ub = await nbBox(up), db = await nbBox(down);
  const gap = db.y - (ub.y + ub.height);
  expect(gap).toBeGreaterThan(20);
  const x = Math.max(ub.x, db.x) + 6; // 가운데(동그라미 자리)를 피한 세로 줄
  await page.mouse.move(x, ub.y + ub.height / 2);
  await expect(handles(up).first()).toBeVisible();
  // 틈 위쪽(위 상자에 가까움) = 위 상자 것 그대로.
  await page.mouse.move(x, ub.y + ub.height + gap * 0.25, { steps: 4 });
  await page.waitForTimeout(400);
  expect(await shown(up)).toBe(true);
  expect(await shown(down)).toBe(false);
  // 틈 아래쪽(아래 상자에 가까움, 아직 위 상자 띠 안) = 아래 상자 것만.
  await page.mouse.move(x, ub.y + ub.height + gap * 0.75, { steps: 4 });
  await expect(handles(down).first()).toBeVisible();
  await expect(handles(up).first()).toBeHidden();
  expect(errors).toEqual([]);
});

test.describe('B2 폰', () => {
  test.use({ hasTouch: true });
  test('B2 폰 390: 손가락은 그대로 — 올림 없이 고르기로만 동그라미', async ({ page }) => {
    const { errors } = await boardFixture(page, 390, { bid: BID, seed: [{ id: 'R1', board_id: BID, body: '시작 주제', x: 40, y: 120 }] });
    const start = nbNode(page, '시작 주제');
    await page.locator('[data-nb-fit]').tap();
    await expect(handles(start).first()).toBeHidden();
    await start.locator('.nb-tx').tap();
    await expect(start).toHaveClass(/nb-sel/);
    await expect(start).not.toHaveClass(/nb-hover/);
    await expect(handles(start).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
