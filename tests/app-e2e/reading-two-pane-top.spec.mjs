import { test, expect } from '@playwright/test';
import { DOC_SCREENS } from './helpers/doc-view.mjs';
// S70-40b ③ READ-글보기머리(docs/design/reading-screens.md 2절 A9·3절 B7·5절 ③ (가), 명진 11/25 16:16 "추천대로"):
// 두 글 보기 화면(저장한 글·읽을 거리)은 공용 '글 보기 머리'(ui-standard.css .ds-doc-*)를 쓴다.
// ① 두 칸 위 끝 맞음: PC 1280에서 왼쪽 첫 줄(저장한 글 목록 머리 줄 / 읽을 거리 왼쪽 칸 첫 줄 — 찾기 줄은 맨 위 칸으로 옮김)과 오른쪽 글 머리 첫 줄의 위 끝이 1px 안.
// ② 머리 아이콘 높이 같음: 머리 첫 줄 아이콘([↗ 원래 페이지]·[−][+]·[⋯])의 보이는 높이가 모두 --ds-compact-height이고 세로 가운데가 1px 안.
const rect = loc => loc.evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, mid: r.top + r.height / 2 }; });
// 보이는 높이: 아이콘은 상자 그대로, [−][+](공용 ⑤ .ds-seg)는 누르는 범위 여백(위아래 padding)을 뺀 알약 바탕.
const icons = detail => detail.locator('.ds-doc-top .ds-doc-icons').evaluate(el => [...el.querySelectorAll(':scope > .ds-doc-icon, :scope > .ds-seg')].map(b => {
  const r = b.getBoundingClientRect(), cs = getComputedStyle(b), pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
  const top = r.top + pt, height = r.height - pt - pb, row = el.closest('.ds-doc-top').getBoundingClientRect();
  // 가운데 차이는 머리 줄과 같은 순간에 잰다(폰 글 보기 칸이 들어오는 중이어도 둘이 함께 움직여 차이만 남는다).
  return { name: b.getAttribute('aria-label') || b.textContent.trim(), height, off: top + height / 2 - (row.top + row.height / 2) };
}));
const compact = page => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ds-compact-height')) || 32);

for (const [name, open] of DOC_SCREENS) {
  test(`두 칸 위 끝 맞음 ${name} PC 1280: 왼쪽 첫 줄과 오른쪽 글 머리 첫 줄 위 끝 1px 안`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, detail, firstLeft } = await open(page, 1280);
    const left = await rect(firstLeft), right = await rect(detail.locator('.ds-doc-top'));
    expect(Math.abs(left.top - right.top), `왼쪽 ${left.top} 오른쪽 ${right.top}`).toBeLessThanOrEqual(1);
    expect(Math.abs(right.height - await compact(page))).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
  for (const width of [390, 1280]) test(`머리 아이콘 높이 같음 ${name} ${width}: 보이는 높이 같고 세로 가운데 1px 안`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, detail } = await open(page, width);
    const want = await compact(page), list = await icons(detail);
    expect(list.length).toBeGreaterThan(0);
    expect(list.map(x => x.name)).toContain('원래 페이지 (새 창)');
    for (const b of list) expect(Math.abs(b.height - want), b.name).toBeLessThanOrEqual(1);
    for (const b of list) expect(Math.abs(b.off), b.name).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

test('저장한 글 글 보기: 테두리 단추 줄·안내문 없음, 동작은 머리 ⋯ 안, 제목은 말줄임 없이 줄바꿈', async ({ page }) => {
  test.setTimeout(60000);
  const { openSavedDoc } = await import('./helpers/doc-view.mjs');
  const long = '아주 긴 예시 제목이 머리 칸 폭을 넘어도 말줄임 없이 다음 줄로 넘어가야 해요 — 끝까지 다 보여야 해요';
  const { errors, detail } = await openSavedDoc(page, 1280, { title: long });
  await expect(detail.locator('.rd-acts')).toHaveCount(0);
  await expect(detail.locator('.rd-tip')).toHaveCount(0);
  const t = detail.locator('.ds-doc-title');
  await expect(t).toHaveText(long);
  expect(await t.evaluate(el => el.scrollWidth <= el.clientWidth && getComputedStyle(el).textOverflow !== 'ellipsis' && getComputedStyle(el).whiteSpace !== 'nowrap')).toBe(true);
  await detail.locator('[data-rd-head-more]').click();
  await expect(page.locator('#rdRowMenu button')).toHaveText(['수정', '노트로 만들기', '밑줄을 노트로', '안 읽음으로', '사업에 연결', '폴더로 옮기기', '삭제']);
  expect(errors).toEqual([]);
});

// 5절 ④ (가): 메모 칸(공용 memo-thread 부품)은 비어 있으면 한 줄, 누르면 커진다. 두 글 보기 화면 모두.
for (const [name, open] of DOC_SCREENS) test(`메모 칸 한 줄 → 누르면 커짐 ${name} 390`, async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await open(page, 390);
  const ta = page.locator('.memo-th:visible [data-cm-text]').first();
  await expect(ta).toBeVisible();
  await expect(ta).toHaveAttribute('placeholder', '메모 남기기…');
  // 칸은 메모 목록이 오면 다시 그려질 수 있다 — 높이는 그때그때 지금 칸에서 잰다.
  const h = () => ta.evaluate(el => el.getBoundingClientRect().height).catch(() => 0);
  await expect.poll(h).toBeGreaterThan(0);
  const before = await h();
  expect(before).toBeLessThanOrEqual(await compact(page) + 2);
  await ta.click();
  await expect.poll(h).toBeGreaterThan(before * 1.8);
  expect(errors).toEqual([]);
});
