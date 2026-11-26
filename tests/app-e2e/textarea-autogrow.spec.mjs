import {test, expect} from '@playwright/test';
import {testOrigin} from './helpers/test-origin.mjs';
// UI-입력칸자동높이(STD-INPUT-01, 사용자 결정 2026-11-26): 앱의 여러 줄 입력칸은 모두 공용 auto-grow.js 칸이다.
// 전수 표의 칸 모양(세 줄·열두 줄에서 시작, CSS 상한, 줄바꿈을 거절하는 한 줄 칸, 글을 채워 연 창)이 모두 글만큼 늘고
// 화면 높이 절반(또는 칸 CSS 상한)에서 멈춘 뒤에만 칸 안 스크롤인지 본다. 어느 화면이 이 칸을 쓰는지는 tests/auto-grow.test.mjs 가 본다.
const box = (page, id) => page.locator('#' + id).evaluate(el => ({h: Math.round(el.getBoundingClientRect().height), inner: el.scrollHeight - el.clientHeight, overflow: getComputedStyle(el).overflowY, top: el.scrollTop, screen: innerHeight}));
const lines = n => Array.from({length: n}, (_, i) => `${i + 1}번째 줄 가나다라`).join('\n');

for (const [width, height] of [[390, 844], [1280, 800]]) test.describe(`${width}`, () => {
  test.beforeEach(async ({page}) => {
    await page.setViewportSize({width, height});
    await page.goto(testOrigin + '/tests/app-e2e/textarea-autogrow-fixture.html');
    await page.waitForFunction(() => window.__ready);
  });

  test('세 줄·열두 줄에서 시작한 칸: 처음 높이 그대로, 글이 넘으면 늘고, 화면 절반에서 멈춘 뒤에만 칸 안 스크롤', async ({page}) => {
    for (const [id, start] of [['three', 3], ['twelve', 12]]) {
      const field = page.locator('#' + id);
      const first = await box(page, id);
      await field.fill(lines(start + 5));
      const grown = await box(page, id);
      expect(grown.h, id).toBeGreaterThan(first.h);
      expect(grown.inner, id).toBeLessThanOrEqual(1);
      expect(grown.top, id).toBe(0);
      await field.fill(lines(80));
      const capped = await box(page, id);
      expect(capped.h, id).toBeLessThanOrEqual(Math.max(first.h, Math.round(height / 2)) + 1);
      expect(capped.inner, id).toBeGreaterThan(0);
      expect(capped.overflow, id).toBe('auto');
      await field.fill('');
      expect((await box(page, id)).h, id).toBe(first.h);
    }
  });

  test('CSS 상한이 있는 칸: 상한까지 늘고 거기서 칸 안 스크롤(글이 숨지 않음)', async ({page}) => {
    await page.locator('#capped').fill(lines(10)); // 화면 절반보다 낮고 CSS 상한보다 높은 글
    const r = await box(page, 'capped');
    expect(r.h).toBeLessThanOrEqual(121);
    expect(r.overflow).toBe('auto');
  });

  test('줄바꿈을 거절하는 한 줄 칸(오늘 한 일): 줄바꿈을 바꾸지 않고 늘어난다', async ({page}) => {
    const field = page.locator('#oneline');
    const first = await box(page, 'oneline');
    await field.fill('가나다라마바사아자차카타파하 '.repeat(20) + '\n둘째');
    await expect(field).toHaveValue(/\n둘째$/);
    const r = await box(page, 'oneline');
    expect(r.h).toBeGreaterThan(first.h);
    expect(r.inner).toBeLessThanOrEqual(1);
  });

  test('글을 채워 연 창: 열자마자 글 전체가 보인다', async ({page}) => {
    await page.evaluate(text => {
      const dlg = document.getElementById('dlg');
      document.getElementById('prefilled').value = text;
      dlg.classList.remove('hidden');
      window.KPTUA11y.dialog.activate(dlg, {initialFocus: 'button'});
    }, lines(9));
    await expect.poll(() => box(page, 'prefilled').then(r => r.inner)).toBeLessThanOrEqual(1);
    expect((await box(page, 'prefilled')).h).toBeGreaterThan(150);
  });
});
