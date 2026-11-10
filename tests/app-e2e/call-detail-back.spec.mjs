// CALL-상세뒤로가기: 폰 통화 상세에서 뒤로가기 한 번 = 그 통화함 목록(개인이면 개인 통화 목록, 한 번 더 = 업무 통화 목록).
// 폰 앱 뒤로가기·PC 위 줄 ‹은 KPTURouter.back()이다. 고치기 전에는 화면을 다시 연 뒤(당겨서 새로고침·앱이 화면을 다시 엶·새 버전)
// back()이 '이 문서의 첫 기록'을 Web2의 첫 기록으로 보고 목록 대신 홈으로 갔다. 지금은 같은 앱 주소의 앞 기록까지 Web2 기록으로 본다.
// 서버는 흉내다(helpers/call-feed-server.mjs). 이름·내용은 모두 지어낸 것이다.
import {test,expect} from '@playwright/test';
import {W1,P1,fixture,openCalls} from './helpers/call-feed-server.mjs';
test.use({hasTouch:true});

const view=page=>page.locator('#callsView');
const detail=page=>page.locator('#callsView #cfDetail');
const back=page=>page.evaluate(()=>window.KPTURouter.back());
async function personalList(page){
 await expect(detail(page)).toBeHidden();
 await expect(view(page).locator('#cfList')).toBeVisible();
 await expect(view(page).locator('[data-cf-pcount]')).toHaveText('1건');
 await expect(page).not.toHaveURL(/[?&]call=/);
}
async function workList(page){
 await expect(detail(page)).toBeHidden();
 await expect(view(page).locator('[data-cf-box="personal"]')).toBeVisible();
 await expect(view(page).locator(`[data-cf-row="${W1}"]`)).toBeVisible();
 await expect(page).not.toHaveURL(/[?&]box=/);
}
async function openPersonal(page){
 await expect(view(page).locator(`[data-cf-row="${W1}"]`)).toBeVisible();
 await view(page).locator('[data-cf-box="personal"]').tap();
 await expect(view(page).locator('[data-cf-pcount]')).toHaveText('1건');
}
async function openRow(page){
 await view(page).locator(`[data-cf-row="${P1}"]`).tap();
 await expect(detail(page).locator('[data-cf-meta]')).toContainText('가상 친구 · 개인');
 await expect(detail(page).locator('[data-cf-script],[data-cf-raw-empty]')).toHaveCount(1);
}
const reload=async page=>{await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);};

for(const width of [390,344])test.describe(`폰 ${width}`,()=>{
 test('목록에서 연 통화 상세(전문 펼침): 뒤로 = 개인 통화 목록, 한 번 더 = 업무 통화 목록',async({page})=>{
  const f=await fixture(page,{width});await openCalls(page,width);
  await openPersonal(page);await openRow(page);
  await detail(page).locator('[data-cf-full] summary').tap();
  expect(await back(page)).toBe(true);await personalList(page);
  expect(await back(page)).toBe(true);await workList(page);
  expect(f.errors).toEqual([]);
 });
 test('상세에서 새로고침(당겨서 새로고침·앱이 다시 엶) 뒤: 뒤로 = 개인 통화 목록, 한 번 더 = 업무 통화 목록',async({page})=>{
  const f=await fixture(page,{width});await openCalls(page,width);
  await openPersonal(page);await openRow(page);
  await reload(page);
  await expect(detail(page).locator('[data-cf-meta]')).toContainText('가상 친구 · 개인');
  expect(await back(page)).toBe(true);await personalList(page);
  expect(await back(page)).toBe(true);await workList(page);
  expect(f.errors).toEqual([]);
 });
 test('개인 통화 목록에서 새로고침 뒤 연 상세: 뒤로 = 개인 통화 목록, 한 번 더 = 업무 통화 목록',async({page})=>{
  await fixture(page,{width});await openCalls(page,width);
  await openPersonal(page);
  await reload(page);await expect(view(page).locator('[data-cf-pcount]')).toHaveText('1건');
  await openRow(page);
  expect(await back(page)).toBe(true);await personalList(page);
  expect(await back(page)).toBe(true);await workList(page);
 });
 test('주소로 바로 연 상세(앱 다시 열기): 뒤로 = 개인 통화 목록, 한 번 더 = 업무 통화 목록',async({page})=>{
  await fixture(page,{width});
  const u=new URL(page.url());u.search=`?view=calls&box=personal&call=${P1}`;
  await page.goto(u.href);await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(detail(page).locator('[data-cf-meta]')).toContainText('가상 친구 · 개인');
  expect(await back(page)).toBe(true);await personalList(page);
  expect(await back(page)).toBe(true);await workList(page);
 });
});

test('PC 1280: 새로고침 뒤 위 줄 ‹(back)도 브라우저 뒤로와 같이 앞 화면으로, 앞으로 가기로 다시 통화',async({page})=>{
 await fixture(page,{width:1280});
 await page.evaluate(()=>window.KPTURouter.go('library',{source:'delegated'}));await expect(page.locator('#libraryView')).toBeVisible();
 await openCalls(page,1280);
 await reload(page);await expect(view(page)).toBeVisible();
 expect(await page.evaluate(()=>window.KPTURouter.canBack())).toBe(true);
 expect(await back(page)).toBe(true);await expect(page.locator('#libraryView')).toBeVisible();
 // 앞 기록은 새로고침 전 문서의 것이라 화면을 새로 연다: 앱이 다 뜬 뒤에 앞으로 간다.
 await expect.poll(()=>page.evaluate(()=>!!window.KPTURouter?.canForward?.())).toBe(true);
 expect(await page.evaluate(()=>window.KPTURouter.forward())).toBe(true);await expect(view(page)).toBeVisible();
});
