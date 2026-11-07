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
// S52-01 ②: 이름으로 줄을 찾아(접힌 묶음이면 펼쳐) 누른다. 하나만 고르는 창은 누르면 바로 닫힌다.
export async function pressName(page, name) {
  await expect(page.locator(SHEET)).toBeVisible();
  const key = await page.locator(SHEET).evaluate((sheet, name) => [...sheet.querySelectorAll('.aop-list [data-sheet-value]')].find(el => el.querySelector('.home-choice-name')?.textContent === name)?.dataset.sheetValue ?? null, name);
  if (key === null) throw new Error('고르기 창에 없는 이름: ' + name);
  await pressRow(page, key);
}
// 창 안의 접힌 묶음(사업영역 상위·담당조직 묶음)을 모두 펼친다. sheet: 열린 고르기 창 locator.
export async function openFolds(sheet) {
  await expect(sheet).toBeVisible();
  await sheet.locator('[data-sheet-content] [data-sheet-value]').first().waitFor({state: 'attached'});
  for (let i = 0; i < 40; i++) {
    const t = sheet.locator('[data-aop-toggle][aria-expanded="false"]').filter({visible: true}).first();
    if (!(await t.count())) break;
    await t.click();
  }
}
// S52-01 ③: 여러 개 고르는 창에서 이름들을 눌러 [넣기]로 닫는다(창은 이미 열려 있어야 한다).
export async function pressNamesAndSave(page, names) {
  for (const name of [].concat(names)) await pressName(page, name);
  await page.locator(`${SHEET} [data-sheet-save]`).click();
  await expect(page.locator(SHEET)).toBeHidden();
}
// S52-01 ③c: 값을 가진 <select>(자료실 #docProject·#libraryEditProject) 옆 칸 단추를 눌러 공용 창에서 사업영역 하나를 고른다(''는 '사업영역 없음').
export async function pickSelectArea(page, select, id) {
  await page.locator(`${select} + .lu-area-pick`).click();
  await pressRow(page, id ? 'p:' + id : '');
  await expect(page.locator(SHEET)).toBeHidden();
}
