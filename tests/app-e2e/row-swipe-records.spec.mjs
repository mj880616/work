import { test, expect } from '@playwright/test';
import { testOrigin } from './helpers/test-origin.mjs';
import { answerAsk } from './helpers/small-notice.mjs';
// S70-65 UI-밀기메뉴통일(사용자 2026-11-26 08:16 "조직 관리 기록·사업 관리 진행 기록 = [수정][삭제] 두 칸"):
// 폰 390에서 기록 줄을 왼쪽으로 밀면 [수정][삭제] 두 칸만 펼쳐지고(끝까지 밀어도 실행 없음 — S70-60), 칸을 눌러야 그 줄 ⋯ 메뉴와 같은 일을 한다.
// - 조직 관리 기록 창(#wdUpdates): 직접 쓴 기록 줄 [수정] = 그 자리 고쳐 쓰기 칸, [삭제] = 한 번 묻고 지움.
//   잊지 말기·노트에서 연결된 줄 [수정] = ⋯ [요약 수정], [삭제] = ⋯ [원문 삭제](한 번 묻기).
// - 사업 관리 진행 기록(#ps3-progress): 연결된 업데이트 줄 [수정] = ⋯ [요약 수정], 원문을 지우는 길이 없어 [연결 해제](⋯와 같은 이름·길).
// 기록에는 여러 개 고르기가 없어 오른쪽 밀기는 없다. 기준표 docs/design/standard-interactions.md 8절 W2.
// 화면은 담당조직·사업 상세 공용 흉내(basket-link-detail-fixture.html — basket-link-disconnect.spec.mjs와 같은 것). 글·이름은 모두 지어낸 것.
test.use({ hasTouch: true });
const fixture = testOrigin + '/tests/app-e2e/basket-link-detail-fixture.html';
const W = 390;

async function ready(page, kind) {
  await page.setViewportSize({ width: W, height: 900 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(fixture); await expect.poll(() => page.evaluate(() => window.__detailReady === true)).toBe(true);
  await page.evaluate(kind => {
    const s = window.__detailState; s.notes[0].archived_at = null; s.notes[0].updated_at = '2026-10-11T01:30:00Z';
    window.__went = []; window.KPTURouter.go = (view, options) => window.__went.push([view, options]);
    if (kind === 'project') for (const row of s.links) { row.project_id = s.ids.project; row.organization_id = null; }
  }, kind);
  await page.evaluate(kind => { const s = window.__detailState; return kind === 'organization' ? window.KPTUWorkplace.open(s.ids.org) : window.KPTUProjects.open(s.ids.project); }, kind);
  const host = page.locator(kind === 'organization' ? '#wdUpdates' : '#ps3-progress [data-ps3-records]');
  await expect(host.locator('[data-basket-link]')).toHaveCount(2);
  return { errors, host, ids: await page.evaluate(() => window.__detailState.ids) };
}
// 손가락 밀기(합성 터치 포인터). 목록이 다시 그려져 줄이 빠졌으면 다시 찾아 민다.
async function swipe(row, dx) {
  await expect(async () => {
    const sent = await row.evaluate((el, dx) => {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 20);
      const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
      fire('pointerdown', x); for (let i = 1; i <= 12; i++) fire('pointermove', x + dx * i / 12); fire('pointerup', x + dx);
      return true;
    }, dx);
    expect(sent).toBe(true);
  }).toPass({ timeout: 10000 });
}
const tap = async l => { await l.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true }); await l.dispatchEvent('click'); };
async function openCells(host, row) {
  const ends = host.locator('[data-row-swipe-act="end"]');
  await expect(async () => { await swipe(row, -(W + 40)); await expect(ends.first()).toBeVisible({ timeout: 1000 }); }).toPass({ timeout: 15000 });
  return ends;
}
const deletes = page => page.evaluate(() => (window.__detailState.deletes || []).length);

test(`조직 관리 기록 폰 ${W}: 직접 쓴 기록 줄 왼쪽 밀기 [수정][삭제] — 끝까지 밀어도 실행 없음, [수정]은 고쳐 쓰기 칸, [삭제]는 한 번 묻기, 오른쪽 밀기 없음`, async ({ page }) => {
  const { errors, host } = await ready(page, 'organization');
  const row = host.locator('[data-wd-up="old-log"]');
  await expect(row).toBeVisible();
  const ends = await openCells(host, row);
  await expect(ends.locator('.row-swipe-tx')).toHaveText(['수정', '삭제']);
  await page.waitForTimeout(500);
  expect(await deletes(page)).toBe(0); await expect(page.locator('.kptu-ask')).toHaveCount(0);
  await tap(host.locator('[data-row-swipe-key="edit"]'));
  await expect(row.locator('[data-wd-up-edit]')).toBeVisible();
  await expect(ends).toHaveCount(0);
  await row.locator('[data-wd-up-edit]').getByRole('button', { name: '취소' }).click();
  await expect(row.locator('[data-wd-up-edit]')).toHaveCount(0);
  await openCells(host, row);
  await tap(host.locator('[data-row-swipe-key="delete"]'));
  expect(await answerAsk(page, false)).toContain('삭제');
  await expect(row).toBeVisible(); expect(await deletes(page)).toBe(0);
  // 오른쪽 밀기: 칸도 고르기 막대도 없다.
  await swipe(row, W + 40); await page.waitForTimeout(300);
  await expect(host.locator('[data-row-swipe-act]')).toHaveCount(0); await expect(page.locator('.row-swipe-pickbar:visible')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test(`조직 관리 기록 폰 ${W}: 연결된 줄 왼쪽 밀기 [수정][삭제] — [수정]은 ⋯ [요약 수정] 칸, [삭제]는 ⋯ [원문 삭제]처럼 한 번 묻기`, async ({ page }) => {
  const { errors, host, ids } = await ready(page, 'organization');
  const row = host.locator(`[data-basket-link="${ids.link}"]`);
  const ends = await openCells(host, row);
  await expect(ends.locator('.row-swipe-tx')).toHaveText(['수정', '삭제']);
  await tap(host.locator('[data-row-swipe-key="edit"]'));
  await expect(row.locator('[data-link-summary-form]')).toBeVisible();
  await row.locator('[data-link-summary-cancel]').click(); await expect(row.locator('[data-link-summary-form]')).toHaveCount(0);
  await openCells(host, row);
  await tap(host.locator('[data-row-swipe-key="delete"]'));
  expect(await answerAsk(page, false)).toContain('휴지통으로 옮길까요'); // ⋯ [원문 삭제]와 같은 확인창
  await expect(row).toBeVisible(); expect(await deletes(page)).toBe(0);
  expect(errors).toEqual([]);
});

test(`사업 관리 진행 기록 폰 ${W}: 연결된 업데이트 줄 왼쪽 밀기 [수정][연결 해제] — [수정]은 요약 수정 칸, [연결 해제]는 ⋯와 같은 한 번 묻기, 오른쪽 밀기 없음`, async ({ page }) => {
  const { errors, host, ids } = await ready(page, 'project');
  const row = host.locator(`[data-basket-link="${ids.link}"]`);
  const ends = await openCells(host, row);
  await expect(ends.locator('.row-swipe-tx')).toHaveText(['수정', '연결 해제']);
  await page.waitForTimeout(500); expect(await deletes(page)).toBe(0);
  await tap(host.locator('[data-row-swipe-key="edit"]'));
  await expect(row.locator('[data-link-summary-form]')).toBeVisible();
  await row.locator('[data-link-summary-cancel]').click(); await expect(row.locator('[data-link-summary-form]')).toHaveCount(0);
  await openCells(host, row);
  await tap(host.locator('[data-row-swipe-key="disconnect"]'));
  expect(await answerAsk(page, true)).toContain('연결을 해제할까요');
  await expect(row).toHaveCount(0); expect(await deletes(page)).toBe(1);
  await swipe(host.locator('[data-basket-link]').first(), W + 40); await page.waitForTimeout(300);
  await expect(host.locator('[data-row-swipe-act]')).toHaveCount(0); await expect(page.locator('.row-swipe-pickbar:visible')).toHaveCount(0);
  expect(errors).toEqual([]);
});
