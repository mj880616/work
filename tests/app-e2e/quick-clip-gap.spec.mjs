import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';

// UI-입력칸첨부간격(2026-10-30 요청): 폰 노트 입력칸에서 왼쪽 첨부(클립) 칸과 '노트를 입력하세요' 글자가 붙어 보였다.
// 클립이 입력칸 안 왼쪽에 있는 폰(~760px)에서는 글자 시작 자리(입력칸 왼쪽 + 테두리 + 왼쪽 여백)가 클립 칸 오른쪽 끝보다
// 8px 이상 오른쪽이어야 한다(노트, [할 일] 화면 모두 같은 규칙 하나).
// 폴드 펼침(884px)·PC(1440px)도 NOTE-입력줄높이(S71-67)부터 클립이 입력칸 안이라 같은 간격을 본다.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';

async function measure(quick) {
  await expect(quick.locator('[data-quick-file-picker] .basket-clip')).toBeVisible();
  return quick.evaluate(el => {
    const input = el.querySelector('[data-quick-input]'), picker = el.querySelector('[data-quick-file-picker]');
    const s = getComputedStyle(input), r = input.getBoundingClientRect(), c = picker.querySelector('.basket-clip').getBoundingClientRect();
    return {
      inside: picker.parentElement === input.parentElement,
      textStart: r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft),
      padding: parseFloat(s.paddingLeft), inputLeft: r.left, inputRight: r.right, clipLeft: c.left, clipRight: c.right,
      placeholder: input.placeholder,
    };
  });
}
// NOTE-입력줄높이(S71-67, 2026-11-26 사용자 결정): 폴드 펼침·PC도 클립은 입력칸 안 왼쪽 — 모든 폭에서 같은 규칙.
function expectGap(m, width, where) {
  expect(m.inside, `${where} ${width}: 클립은 입력칸 안`).toBe(true);
  expect(m.clipLeft, `${where} ${width}`).toBeGreaterThanOrEqual(m.inputLeft);
  expect(m.textStart - m.clipRight, `${where} ${width}: 글자 시작 − 클립 오른쪽 끝`).toBeGreaterThanOrEqual(8);
}

for (const width of [412, 884, 1440]) test(`quick input text starts at least 8px right of the clip ${width}`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  // The task-file table answers (empty), so the [할 일] screen shows the clip too.
  await openHome(page, { beforeLoad: () => page.route('**/rest/v1/app_task_attachments**', r => r.fulfill({ json: [] })) });
  await page.route(SB + '/rest/v1/app_notes**', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback());

  // QUICK-입력정리(2026-11-28): 홈·잊지 말기 손 입력칸은 지웠다 — 남은 노트·[할 일] 화면 입력칸을 본다.
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await openKindMenu(page, 'note');
  const noteNav = basketKindButton(page, 'note');
  if (width < 761) await noteNav.tap(); else await noteNav.click();
  const note = page.locator('[data-note-list] [data-home-quick]');
  await expect(note).toBeVisible();
  const n = await measure(note);
  expect(n.placeholder).toContain('노트');
  expectGap(n, width, '노트');

  await page.evaluate(() => window.KPTURouter.go('tasks'));
  expectGap(await measure(page.locator('#tasksView .home-quick[data-home-quick]')), width, '할 일 화면');
  expect(errors).toEqual([]);
});
