// S71-30 BRIEF-머리한줄: 브리핑 룸 머리 단추는 맨 위 줄 단추 상자(screen-find.js toolsBox 'brief')의 [⋯]·[+] 둘.
// [+] 작은 메뉴 = 자료실에서 선택 · 파일 업로드. 시험은 이 도움으로 같은 길을 연다.
import { expect } from '@playwright/test';

export const briefTools = page => page.locator('.sf-tools[data-sf-tools="brief"]');
export const briefAdd = page => briefTools(page).locator('[data-br-top-add]');
export const briefMore = page => briefTools(page).locator('[data-br-top-more]');
export const briefAddMenu = page => page.locator('#brAddMenu');
export const briefTopMenu = page => page.locator('#brTopMenu');
// [+] → [자료실에서 선택]. 고르기 창이 붙는 자리는 [+] 단추라 그 단추를 돌려준다.
export async function openBriefLibPick(page) {
  const plus = briefAdd(page);
  await expect(plus).toBeVisible();
  await plus.click();
  await briefAddMenu(page).locator('[data-br-add-act="lib"]').click();
  return plus;
}
