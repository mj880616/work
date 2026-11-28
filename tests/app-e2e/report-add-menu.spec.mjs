import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// MTG-사업보고 1단계: 상단 [+ 추가]에 일기. 그 화면의 기존 [새 일기] 버튼을 그대로 누른다(새 저장 경로 없음).
// NOTE-게시 ③: [공유 페이지] 줄은 화면과 함께 없앴다(공유는 노트 ⋯ [공유 링크 만들기]).
const menu=page=>page.locator('#toplineAddMenu');
const topAdd=page=>page.locator('[data-quick-add]:visible');
async function addItems(page){await topAdd(page).click();await expect(menu(page)).toBeVisible();return menu(page).locator('button').allTextContents()}

test('PC 1280: [+ 추가] lists 하루 기록 after 일정, no 공유 페이지',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 await openHome(page);
 // QUICK-입력정리(2026-11-28): '잊지 말기' 줄은 없다(손으로 잊지 말기를 넣는 길을 지움).
 expect(await addItems(page)).toEqual(['할 일','노트','일정','하루 기록','사업 보고']);
});

// 폰(390)에는 상단 줄이 없다(PC 전용). 폰의 일기는 [메뉴]/[일정] 길 그대로다.
test('폰 390: no top line, so no [+ 추가] and no page error',async({page})=>{
 await page.setViewportSize({width:390,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 await expect(page.locator('[data-quick-add]:visible')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('PC: 하루 기록 opens the diary screen and its new-diary editor; Esc closes the menu first',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 await topAdd(page).click();await expect(menu(page)).toBeVisible();
 await page.keyboard.press('Escape');await expect(menu(page)).toBeHidden();await expect(topAdd(page)).toBeFocused();
 await topAdd(page).click();
 await menu(page).locator('button',{hasText:'하루 기록'}).click();
 await expect(page.locator('#diaryView')).toBeVisible();
 await expect(page.locator('#diaryView [data-diary-editor], #diaryView .diary-editor, #diaryView textarea').first()).toBeVisible();
 // 뒤로가기: 쓰기 창이 한 칸, 그다음 화면 이동이 한 칸.
 await page.goBack();await page.goBack();await expect(page.locator('#homeView')).toBeVisible();
 expect(errors).toEqual([]);
});
