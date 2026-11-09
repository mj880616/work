// AREA-추가버튼잘림(11/09): 사업영역 관리 위 추가 버튼은 폰·폴드 접힘에서 작은 [+] 아이콘(32px, 글자는 aria-label), PC·폴드 펼침에서 작은 [+ 사업영역]. 어느 폭에서도 잘리지 않는다.
// 글자의 주인은 index.html 마크업과 project-system-v3.css 하나다(action-labels.js는 이 버튼을 덮어쓰지 않는다). 모든 이름·글은 합성 값.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

test.use({timezoneId:'Asia/Seoul'});
async function openAreas(page,width){
  await page.setViewportSize({width,height:900});await mockApp(page,baseState());
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await page.locator('#meetingsView #reportMore:visible').click();
  await page.locator('#reportMoreMenu [data-report-areas]:visible').click();
  await expect(page.locator('#areaWindow')).toBeVisible();
}
for(const width of [390,884,1280])test(`${width}: 사업영역 관리 추가 버튼이 잘리지 않는다`,async({page})=>{
  await openAreas(page,width);
  const btn=page.locator('#areaWindow .area-window-head #newProjectBtn');
  await expect(btn).toBeVisible();
  const m=await btn.evaluate(b=>({sw:b.scrollWidth,cw:b.clientWidth,h:b.getBoundingClientRect().height,w:b.getBoundingClientRect().width,aria:b.getAttribute('aria-label'),text:b.textContent.trim(),fs:getComputedStyle(b).fontSize,fw:+getComputedStyle(b).fontWeight}));
  expect(m.aria).toBe('사업영역 추가');
  if(width>760)expect(m.sw).toBeLessThanOrEqual(m.cw);/* 폰은 누르는 범위(::after 44px)가 옆으로 6px씩 걸쳐 scrollWidth가 크지만 보이는 글자는 없다 */
  expect(Math.round(m.h)).toBe(32);
  if(width<=760){
    expect(Math.round(m.w)).toBe(32);
    expect(m.fs).toBe('0px');
    await expect(page.locator('#areaWindow .area-window-add-word')).toBeHidden();
    const after=await btn.evaluate(b=>getComputedStyle(b,'::before').content);
    expect(after).not.toBe('none');
  }else{
    expect(m.text).toBe('+ 사업영역');
    expect(parseFloat(m.fs)).toBeLessThanOrEqual(14);
    expect(m.fw).toBeLessThanOrEqual(500);
  }
  // 머리 줄 안에 있고 오른쪽으로 밀려 나가지 않는다.
  const b=await btn.boundingBox(),v=page.viewportSize();
  expect(b.x+b.width).toBeLessThanOrEqual(v.width);
});
