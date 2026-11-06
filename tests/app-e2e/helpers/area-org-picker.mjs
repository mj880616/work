// S52-01 UI-사업영역조직고르기창: 사업영역·조직 두 줄(app/area-org-picker.js)을 시험에서 쓰는 손.
// scope: 두 줄이 든 칸(예: '#gtEditLinkBody'). kind: 'area' | 'org'. keys: 고를(또는 뺄) 값들('p:<id>'·'o:<id>').
import { expect } from '@playwright/test';

export const SHEET = '#areaOrgPickSheet';
// 지금 꼬리표로 보이는 값들(사업영역 줄 다음 조직 줄 순서).
export const chosenKeys = (page, scope) => page.locator(`${scope} [data-aop-chip]`).evaluateAll(els => els.map(el => el.dataset.aopChip));
// 고르기 창을 연다(접힌 묶음은 그대로).
export async function openPicker(page, scope, kind) {
  await page.locator(`${scope} [data-aop-add="${kind}"]`).click();
  await expect(page.locator(SHEET)).toBeVisible();
}
// 창에 있는 고를 수 있는 값들(자주 쓴 것 꼬리표는 빼고, 접힌 하위도 포함).
export const offeredKeys = page => page.locator(`${SHEET} .aop-list [data-sheet-value]`).evaluateAll(els => els.map(el => el.dataset.sheetValue));
// 값의 줄이 접힌 묶음 안에 있으면 꺾쇠를 눌러 펼친 뒤 그 줄을 누른다.
export async function pressRow(page, key) {
  const row = page.locator(`${SHEET} .aop-list [data-sheet-value="${key}"]`);
  for (let i = 0; i < 4 && !(await row.isVisible()); i++) {
    // 가장 바깥의 접힌 묶음부터 꺾쇠를 누른다.
    const id = await page.locator(SHEET).evaluate((sheet, key) => {
      const r = [...sheet.querySelectorAll('.aop-list [data-sheet-value]')].find(el => el.dataset.sheetValue === key);
      let n = r?.closest('.aop-kids')?.closest('.aop-node'), top = null;
      while (n) { if (!n.classList.contains('is-open')) top = n; n = n.parentElement?.closest('.aop-kids')?.closest('.aop-node'); }
      const t = top?.querySelector(':scope > .aop-line [data-aop-toggle]');
      if (t) t.setAttribute('data-qa-toggle', Math.random().toString(36).slice(2));
      return t ? t.getAttribute('data-qa-toggle') : '';
    }, key);
    if (!id) break;
    await page.locator(`${SHEET} [data-qa-toggle="${id}"]`).click();
  }
  await row.click();
}
// 창을 열어 keys 를 눌러(이미 고른 것은 빠진다) [넣기]로 닫는다.
export async function toggleKeys(page, scope, kind, keys) {
  await openPicker(page, scope, kind);
  for (const key of keys) await pressRow(page, key);
  await page.locator(`${SHEET} [data-sheet-save]`).click();
  await expect(page.locator(SHEET)).toBeHidden();
}
// 꼬리표 ✕로 뺀다.
export const removeKey = (page, scope, key) => page.locator(`${scope} [data-aop-remove="${key}"]`).click();
