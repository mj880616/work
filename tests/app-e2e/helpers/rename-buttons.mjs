import {expect} from '@playwright/test';
// UI-이름고치기단추(S69-100, 요청함 11/25 '저장 버튼만 미세하게 디자인이 다른'): 파일 이름 고치는 칸(app/file-rename.js)의
// [이름 추천 받기][저장][취소]는 공용 ② 작은 버튼(button.secondary) 한 모양 — 높이·테두리·바탕·모서리·글자 크기·굵기·색이 셋 모두 같다.
const LOOK = ['height', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRadius', 'backgroundColor', 'color', 'fontSize', 'fontWeight', 'paddingLeft'];
export async function readRenameButtons(scope) {
  const acts = scope.locator('.fr-acts');
  await expect(acts.locator('button')).toHaveText(['이름 추천 받기', '저장', '취소']);
  return acts.locator('button').evaluateAll((bs, keys) => bs.map(b => {
    const c = getComputedStyle(b), out = {text: b.textContent, secondary: b.classList.contains('secondary')};
    for (const k of keys) out[k] = c[k];
    return out;
  }), LOOK);
}
export async function expectRenameButtonsOneLook(scope) {
  const [ai, save, cancel] = await readRenameButtons(scope);
  for (const b of [ai, save, cancel]) {
    expect(b.secondary, b.text).toBe(true);
    for (const k of LOOK) expect(b[k], `${b.text} ${k}`).toBe(ai[k]);
  }
  // 보이는 얇은 회색 선(투명·바탕색이 아님), 공용 작은 버튼 높이
  expect(ai.borderTopStyle).toBe('solid');
  expect(ai.borderTopColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(ai.borderTopColor).not.toBe(ai.backgroundColor);
  const compact = await scope.evaluate(el => getComputedStyle(el).getPropertyValue('--ds-compact-height').trim());
  expect(ai.height).toBe(compact);
}
