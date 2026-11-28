import { test, expect } from '@playwright/test';
import { boardFixture, nbNode, nbBox, nbCenter, nbBlank } from './helpers/note-board-fixture.mjs';

// S70-03 ③ NOTE-보드우클릭(명진 11/25 09:31 "지금은 왼쪽을 눌러서 삭제버튼이 있는데 우클릭해서 삭제버튼있는게 직관적").
// - PC에서 주제·글자·도형을 오른쪽 클릭하면 그 자리에 작은 메뉴(공용 줄 메뉴 #rowMenu — 달력·목록 우클릭과 같은 부품):
//   수정·+ 하위·+ 형제·색·테두리·글자·모양·글자 작게·글자 크게·삭제(위 막대와 같은 동작). 선은 선 메뉴([삭제] 포함).
// - 여러 개 고른 것 위 오른쪽 클릭 = 고른 것 전체 메뉴([N개 삭제]). 지운 뒤 [되돌리기].
// - 빈 보드 위 오른쪽 클릭은 지금 그대로(판 메뉴). 왼쪽 클릭 막대는 그대로 둔다(명진 답 전까지).
test.describe.configure({ timeout: 60000 });
const BID = 'bs70003';
const SEED = [
  { id: 'T1', board_id: BID, body: '첫 주제', x: 160, y: 380 },
  { id: 'T2', board_id: BID, body: '둘째 주제', x: 360, y: 380 },
  { id: 'T5', board_id: BID, body: '네모', kind: 'shape', shape: 'rect', x: 160, y: 520, w: 120, h: 60 },
];
const menu = page => page.locator('#rowMenu');
const item = (page, name) => menu(page).locator('button').filter({ hasText: new RegExp(`^${name.replace(/[+]/g, '\\+')}$`) }).first();

test('PC: 주제 오른쪽 클릭 = 작은 메뉴(막대 동작 + 삭제), [삭제]로 지움·서버에서도, [되돌리기] (1280)', async ({ page }) => {
  const { errors, textRows } = await boardFixture(page, 1280, { bid: BID, seed: SEED });
  const c = await nbCenter(nbNode(page, '첫 주제'));
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  const names = (await menu(page).locator('button').allInnerTexts()).map(t => t.trim());
  expect(names).toEqual(['수정', '+ 하위', '+ 형제', '색', '테두리', '글자', '모양', '글자 작게', '글자 크게', '노트로 만들기', '삭제']);
  // 메뉴는 누른 자리 근처
  const mb = await nbBox(menu(page));
  expect(Math.abs(mb.x - c.x)).toBeLessThan(220); expect(Math.abs(mb.y - c.y)).toBeLessThan(220);
  await item(page, '삭제').click();
  await expect(nbNode(page, '첫 주제')).toHaveCount(0);
  await expect.poll(() => textRows.some(t => t.body === '첫 주제')).toBe(false);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(nbNode(page, '첫 주제')).toHaveCount(1);
  // 다른 항목: [색] = 막대의 색 줄이 펼쳐짐, [+ 하위] = 새 가지 칸
  const c2 = await nbCenter(nbNode(page, '둘째 주제'));
  await page.mouse.click(c2.x, c2.y, { button: 'right' });
  await item(page, '색').click();
  await expect(page.locator('[data-nb-bar]')).toBeVisible();
  await expect(page.locator('[data-nb-bar-row="tone"]')).toBeVisible();
  await page.mouse.click(c2.x, c2.y, { button: 'right' });
  await item(page, '+ 하위').click();
  await expect(page.locator('[data-nb-texts] [data-nb-text="__draft"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('PC: 도형 오른쪽 클릭 = 가지 단추 있는 메뉴(S71-51 모든 칸 가지) + [삭제], 선 오른쪽 클릭 = 선 메뉴 [삭제] (1280)', async ({ page }) => {
  const { errors, textRows, linkRows } = await boardFixture(page, 1280, { bid: BID, seed: SEED, links: [{ id: 'L9', board_id: BID, from_text: 'T1', to_text: 'T2' }] });
  const s = await nbCenter(nbNode(page, '네모'));
  await page.mouse.click(s.x, s.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  const names = (await menu(page).locator('button').allInnerTexts()).map(t => t.trim());
  expect(names).toContain('+ 하위'); // S71-51(사용자 결정 2026-11-26): 도형도 가지를 뻗는다
  expect(names.at(-1)).toBe('삭제');
  await item(page, '삭제').click();
  await expect(nbNode(page, '네모')).toHaveCount(0);
  await expect.poll(() => textRows.some(t => t.body === '네모')).toBe(false);
  // 선: 두 상자 가운데 점
  const a = await nbCenter(nbNode(page, '첫 주제')), b = await nbCenter(nbNode(page, '둘째 주제'));
  const hit = page.locator('[data-nb-hit]').first();
  await expect(hit).toHaveCount(1);
  const mid = await hit.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  expect(mid.x).toBeGreaterThan(a.x); expect(mid.x).toBeLessThan(b.x);
  await page.mouse.click(mid.x, mid.y, { button: 'right' });
  const lm = page.locator('.nb-link-menu');
  await expect(lm).toBeVisible();
  await lm.locator('[data-nb-del]').click();
  await expect.poll(() => linkRows.length).toBe(0);
  await expect(page.getByRole('button', { name: '되돌리기' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('PC: 2개 골라 오른쪽 클릭 = 고른 것 전체 메뉴 [2개 삭제]로 둘 다, 빈 보드 오른쪽 클릭은 판 메뉴 그대로 (1280)', async ({ page }) => {
  const { errors, textRows } = await boardFixture(page, 1280, { bid: BID, seed: SEED });
  const one = await nbBox(nbNode(page, '첫 주제')), two = await nbBox(nbNode(page, '둘째 주제'));
  await page.mouse.move(one.x - 16, one.y - 16); await page.mouse.down(); await page.mouse.move(two.x + two.width + 4, two.y + two.height + 4, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('[data-nb-sel-count]')).toHaveText('2개 선택');
  await page.waitForTimeout(450); // 끈 바로 뒤(0.3초)의 우클릭은 끌기 끝으로 본다
  const c = await nbCenter(nbNode(page, '둘째 주제'));
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  await expect(item(page, '2개 삭제')).toBeVisible();
  await item(page, '2개 삭제').click();
  await expect(nbNode(page, '첫 주제')).toHaveCount(0);
  await expect(nbNode(page, '둘째 주제')).toHaveCount(0);
  await expect.poll(() => textRows.map(t => t.body)).toEqual(['네모']);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(nbNode(page, '첫 주제')).toHaveCount(1);
  await expect(nbNode(page, '둘째 주제')).toHaveCount(1);
  // 빈 보드: 판 메뉴(노트 화면 판 메뉴) — 상자 메뉴가 아니다
  const blank = await nbBlank(page);
  await page.mouse.click(blank.x, blank.y, { button: 'right' });
  await expect(page.locator('#rowMenu button', { hasText: /^삭제$/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
