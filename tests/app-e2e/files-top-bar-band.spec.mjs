import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// UI-위쪽줄흰띠·여백(S55-19, 명진 11/10): PC [파일] 위쪽 줄([◫][찾기][새 폴더][올리기][방금 맞춤][출처][한 칸 보기])이
// 화면 바탕 위에 흰 띠로 떠 보이고, 아래 칸 테두리가 그 띠 바로 아래에 붙어 있었다.
// 지금: 줄 바탕 = 화면 바탕(화면 사진에서 같은 색), 아래 칸과 6px 띄움, 줄 왼쪽 끝 = 아래 칸 왼쪽 끝. 서버는 흉내(이름은 모두 가짜).
const root = page => page.locator('#filesRoot');
const SHOTS = process.env.UI_TOPBAR_SHOTS || '';
const box = loc => loc.evaluate(el => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; });
// 화면 사진에서 점 하나(1×1)를 잘라 PNG 그대로 비교한다 — 같은 색이면 같은 바이트.
const pixel = (page, x, y) => page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 }, animations: 'disabled', caret: 'hide' });

for (const [name, two] of [['두 칸', true], ['한 칸', false]]) {
  test(`PC 1280 ${name}: 위쪽 줄은 흰 띠가 아니고(화면 바탕과 같은 색) 아래 칸과 띄우며 왼쪽 끝이 맞다`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors } = await start(page, 1280);
    await installViewPrefsServer(page, two ? { files_two: { pc: { wide: true } } } : null);
    await page.reload();
    await openFiles(page, 1280, { two });
    await expect(root(page)).toHaveClass(/fx-split-scroll/);
    const top = root(page).locator('.fx-top'), cols = root(page).locator('.fx-cols');
    const first = two ? root(page).locator('[data-fx-pane-i="0"]') : root(page).locator('[data-fx-tree]');
    await expect(first).toBeVisible();
    const t = await box(top), c = await box(cols), f = await box(first);
    // 바탕: 화면 바탕 토큰과 같은 계산값, 아래 선 없음.
    const style = await top.evaluate(el => { const cs = getComputedStyle(el), probe = document.createElement('i');
      probe.style.background = 'var(--kptu-bg)'; el.appendChild(probe); const bg = getComputedStyle(probe).backgroundColor; probe.remove();
      return { bg: cs.backgroundColor, want: bg, line: cs.borderBottomWidth, sticky: cs.position }; });
    expect(style.sticky).toBe('sticky');
    expect(style.bg).toBe(style.want);
    expect(style.line).toBe('0px');
    // 화면 사진으로도: 줄 안 빈 자리(한 칸은 위치 길 오른쪽 끝, 두 칸은 줄 오른쪽 끝) 색 = 줄 아래 띄운 자리(화면 바탕) 색.
    const crumb = top.locator('[data-fx-crumb]');
    const x = (await crumb.isVisible()) ? (await box(crumb)).right - 3 : t.right - 3;
    const inBar = await pixel(page, x, (t.top + t.bottom) / 2), inGap = await pixel(page, x, t.bottom + 3);
    expect(inBar.equals(inGap)).toBe(true);
    // 여백: 줄 아래와 칸 사이 6px(아스날 위쪽 줄과 같은 값).
    expect(Math.round(c.top - t.bottom)).toBe(6);
    expect(Math.round(f.top - t.bottom)).toBe(6);
    // 줄맞춤: 줄 첫 단추·칸 왼쪽 끝이 같다.
    const lead = await top.locator(':scope > :not([hidden])').first().evaluate(el => el.getBoundingClientRect().left);
    expect(Math.abs(lead - f.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.left - f.left)).toBeLessThanOrEqual(1);
    // 내려도 칸이 줄 아래 같은 6px 자리에 붙는다(움찔하지 않음).
    if (two) expect(await first.evaluate(el => el.style.getPropertyValue('--follow-top'))).toBe(`${Math.round(t.bottom - t.top) + 6}px`);
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/files-top-1280-${two ? 'two' : 'one'}.png`, clip: { x: 0, y: 0, width: 1280, height: 260 } }); }
    expect(errors).toEqual([]);
  });
}

test('폰 412: 위쪽 줄은 지금대로(고정 없음·흰 띠 없음)', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  await expect(root(page)).not.toHaveClass(/fx-split-scroll/);
  const top = root(page).locator('.fx-top');
  expect(await top.evaluate(el => getComputedStyle(el).position)).toBe('static');
  expect(await top.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/files-top-412.png`, clip: { x: 0, y: 0, width: 412, height: 400 } }); }
  expect(errors).toEqual([]);
});
