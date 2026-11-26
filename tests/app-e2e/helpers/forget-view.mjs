// S52-20 HOME-잊지말기한목록 → S71-58 FORGET-처리전만(사용자 결정 2026-11-26): 잊지 말기 목록에는 보기 고르기가 없다 — 늘 처리 전(업데이트는 미분류)만.
// 처리한 업데이트(분류됨·보류)는 목록에 없고, 연결된 곳(조직·사업 기록)이나 주소(?view=basket&note=…)로만 연다 → openBasketUpdate.
import {expect} from '@playwright/test';
const OPEN = new Set(['unclassified', 'open']);
// 옛 시험 호환: 처리 전 보기만 있다. 다른 보기를 부르면 그 시험이 없앤 기능을 보고 있는 것이므로 바로 깨진다.
export async function pickBasketView(page, view) {
  if (!OPEN.has(view)) throw new Error(`잊지 말기 보기 '${view}'는 없앴다(FORGET-처리전만) — 처리한 업데이트는 openBasketUpdate로 연다`);
  await expect(page.locator('#basketView [data-forget-section]')).toBeVisible();
}
export const expectBasketView = async (page, view) => pickBasketView(page, view);
// 처리한(목록에 없는) 업데이트 하나를 연다: 다른 화면(조직·사업 기록 줄)이 여는 것과 같은 요청 길(basket-note-tasks.js) → 정리함.
export async function openBasketUpdate(page, id) {
  await page.evaluate(async noteId => {
    const {requestBasketNote} = await import('./basket-note-tasks.js');
    requestBasketNote(noteId);
    if (window.KPTURouter.current === 'basket') window.KPTURouter.go('home');
    window.KPTURouter.go('basket');
  }, id);
  await expect(page.locator('[data-basket-detail]')).toBeVisible();
}
