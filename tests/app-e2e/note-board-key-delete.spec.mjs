import { test, expect } from '@playwright/test';
import { boardFixture, nbNode, nbEditor, nbBox } from './helpers/note-board-fixture.mjs';

// S70-03 ② NOTE-보드선택지우기(명진 11/25 09:30 "주제+ 2개 선택된 상태에서 backspace 랑 delete 누르면 지워지게").
// - 보드에서 하나 이상 고른 상태(글쓰기 중이 아닐 때) Delete·Backspace = 고른 것 모두 지우기(주제·글자·도형·선·카드 같은 규칙, 카드는 보드에서 빼기 — 노트는 그대로).
// - 지운 뒤 알림 한 줄 + [되돌리기](공용 small-notice, Ctrl+Z도 같음). 서버에서도 지워지고, 되돌리면 서버에 다시 생긴다.
// - 글 칸 안에서 쓰는 중 Backspace·Delete는 글자만 지운다.
test.describe.configure({ timeout: 60000 });
const BID = 'bs70003';
const SEED = [
  { id: 'T1', board_id: BID, body: '첫 주제', x: 300, y: 380 },
  { id: 'T2', board_id: BID, body: '둘째 주제', x: 600, y: 380 },
  { id: 'T3', board_id: BID, body: '아래 가지', parent_id: 'T2', ord: 1, x: 0, y: 0 },
  { id: 'T4', board_id: BID, body: '남는 주제', x: 300, y: 520 },
];
const LINKS = [{ id: 'L9', board_id: BID, from_text: 'T1', to_text: 'T4' }];
const notice = page => page.locator('.kptu-notice, [role="status"]').filter({ hasText: '삭제했어요' }).first();
// PC 마우스 빈 곳 끌기 = 사각형 고르기(닿은 것을 고름).
async function marquee(page, els, n) {
  const bs = []; for (const el of els) bs.push(await nbBox(el));
  const x0 = Math.min(...bs.map(b => b.x)) - 16, y0 = Math.min(...bs.map(b => b.y)) - 16, x1 = Math.max(...bs.map(b => b.x + b.width)) + 4, y1 = Math.max(...bs.map(b => b.y + b.height)) + 4;
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('[data-nb-sel-count]')).toHaveText(`${n}개 선택`);
}
const pickTwo = page => marquee(page, [nbNode(page, '첫 주제'), nbNode(page, '둘째 주제')], 2);

for (const key of ['Delete', 'Backspace']) test(`PC: 주제 2개 고르고 ${key} = 둘 다(아래 가지·붙은 선째) 지움, 서버에서도, [되돌리기]로 돌아옴 (1280)`, async ({ page }) => {
  const { errors, textRows, linkRows, textCalls } = await boardFixture(page, 1280, { bid: BID, seed: SEED, links: LINKS });
  await expect(nbNode(page, '아래 가지')).toHaveCount(1);
  await pickTwo(page);
  await page.keyboard.press(key);
  await expect(nbNode(page, '첫 주제')).toHaveCount(0);
  await expect(nbNode(page, '둘째 주제')).toHaveCount(0);
  await expect(nbNode(page, '아래 가지')).toHaveCount(0);
  await expect(nbNode(page, '남는 주제')).toHaveCount(1);
  await expect.poll(() => textRows.map(t => t.body).sort()).toEqual(['남는 주제']);
  expect(linkRows).toHaveLength(0);
  expect(textCalls.filter(c => c.method === 'DELETE').map(c => c.query.id).sort()).toEqual(['eq.T1', 'eq.T2']);
  await expect(page.locator('.kptu-ask')).toHaveCount(0); // 되돌리기가 있으니 묻지 않는다
  const undo = page.getByRole('button', { name: '되돌리기' });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(nbNode(page, '첫 주제')).toHaveCount(1);
  await expect(nbNode(page, '둘째 주제')).toHaveCount(1);
  await expect(nbNode(page, '아래 가지')).toHaveCount(1);
  await expect.poll(() => textRows.map(t => t.body).sort()).toEqual(['남는 주제', '둘째 주제', '아래 가지', '첫 주제']);
  const two = textRows.find(t => t.body === '둘째 주제'), kid = textRows.find(t => t.body === '아래 가지'), one = textRows.find(t => t.body === '첫 주제');
  expect(kid.parent_id).toBe(two.id);
  await expect.poll(() => linkRows.length).toBe(1);
  expect(linkRows[0]).toMatchObject({ from_text: one.id, to_text: 'T4' });
  expect(errors).toEqual([]);
});

test('PC: 다시 지운 뒤 Ctrl+Z = 되돌리기, 주제 하나만 고른 채 Delete도 [되돌리기] (1280)', async ({ page }) => {
  const { errors, textRows } = await boardFixture(page, 1280, { bid: BID, seed: SEED.filter(t => t.id !== 'T3') });
  await pickTwo(page);
  await page.keyboard.press('Delete');
  await expect(nbNode(page, '첫 주제')).toHaveCount(0);
  await page.locator('[data-nb-scroll]').focus().catch(() => {});
  await page.keyboard.press('Control+z');
  await expect(nbNode(page, '첫 주제')).toHaveCount(1);
  await expect(nbNode(page, '둘째 주제')).toHaveCount(1);
  await nbNode(page, '남는 주제').locator('.nb-tx').click();
  await page.keyboard.press('Delete');
  await expect(nbNode(page, '남는 주제')).toHaveCount(0);
  await expect.poll(() => textRows.some(t => t.body === '남는 주제')).toBe(false);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(nbNode(page, '남는 주제')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('PC: 글 칸 안에서 쓰는 중 Backspace·Delete는 글자만 지운다(고른 다른 것은 그대로) (1280)', async ({ page }) => {
  const { errors, textCalls } = await boardFixture(page, 1280, { bid: BID, seed: SEED.filter(t => t.id !== 'T3') });
  await nbNode(page, '첫 주제').locator('.nb-tx').click();
  await page.keyboard.press('F2');
  await expect(nbEditor(page)).toBeFocused();
  await page.keyboard.press('Backspace'); await page.keyboard.press('Home'); await page.keyboard.press('Delete');
  await page.keyboard.press('Enter');
  await expect(nbNode(page, '주')).toHaveCount(1);
  await expect(nbNode(page, '둘째 주제')).toHaveCount(1);
  expect(textCalls.filter(c => c.method === 'DELETE')).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('PC: 카드·주제 함께 고르고 Delete = 주제는 지우고 카드는 보드에서 빼기(노트는 그대로), [되돌리기]로 둘 다 (1280)', async ({ page }) => {
  const { errors, rows, textRows } = await boardFixture(page, 1280, { bid: BID, seed: [{ id: 'T1', board_id: BID, body: '첫 주제', x: 300, y: 560 }] });
  const card = page.locator('[data-note-board] [data-nb-card="n1"]');
  await marquee(page, [card, nbNode(page, '첫 주제')], 2);
  await page.keyboard.press('Delete');
  await expect(card).toHaveCount(0);
  await expect(nbNode(page, '첫 주제')).toHaveCount(0);
  await expect.poll(() => rows[0].metadata?.boards?.[BID] ?? null).toBe(null);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(card).toHaveCount(1);
  await expect(nbNode(page, '첫 주제')).toHaveCount(1);
  await expect.poll(() => rows[0].metadata?.boards?.[BID]?.x ?? null).toBe(40);
  expect(textRows.some(t => t.body === '첫 주제')).toBe(true);
  expect(errors).toEqual([]);
});
