// UI-모바일고르기칸: 모든 고르기 칸(select)이 같은 앱 목록 부품 하나로 열린다. 화면마다 다른 select를 일일이 띄우지 않고,
// 실제 앱 화면(홈)에 같은 모양의 select를 두어 부품 규칙(칸 폭·하단바 위·위로 펼침·긴 목록 안 스크롤·값/change 유지)을 본다.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
test.use({hasTouch:true});

async function setup(page,width){
 await page.setViewportSize({width,height:780});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 await page.evaluate(()=>{
  const host=document.createElement('div');host.id='selHost';
  const opts=n=>Array.from({length:n},(_,i)=>`<option value="v${i}">항목 ${i}</option>`).join('');
  host.innerHTML=`<div style="position:fixed;top:120px;left:16px;width:200px;z-index:50"><select id="selTop" aria-label="위쪽 칸" style="width:200px">${opts(40)}</select></div><div style="position:fixed;bottom:70px;left:16px;width:200px;z-index:50"><select id="selLow" aria-label="아래쪽 칸" style="width:200px">${opts(6)}</select></div>`;
  document.body.append(host);
  window.__changes=[];document.addEventListener('change',e=>{if(e.target.matches('#selTop,#selLow'))window.__changes.push(e.target.id+':'+e.target.value)});
 });
 return errors;
}
const list=page=>page.locator('#kptuSelectMenu');

for(const width of [390,1280])test(`고르기 칸 ${width}: 칸 아래 앱 목록, 긴 목록은 안에서 스크롤, 고르면 값·change 유지`,async({page})=>{
 const errors=await setup(page,width);
 const sel=page.locator('#selTop');await sel.tap();
 await expect(list(page)).toBeVisible();
 const s=await sel.boundingBox(),m=await list(page).boundingBox();
 expect(Math.abs(m.width-s.width)).toBeLessThan(2);expect(m.y).toBeGreaterThanOrEqual(s.y+s.height-1);
 expect(await list(page).evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
 // 하단바(폰)·화면 아래에 가리지 않는다.
 const tabs=width<761?await page.locator('.mobile-tabs').boundingBox():null;
 expect(m.y+m.height).toBeLessThanOrEqual((tabs?tabs.y:780)+1);
 await page.keyboard.press('End');
 await expect(list(page).getByRole('option',{name:'항목 39'})).toBeInViewport();
 await page.keyboard.press('Enter');
 await expect(list(page)).toBeHidden();
 await expect(sel).toHaveValue('v39');
 expect(await page.evaluate(()=>window.__changes)).toEqual(['selTop:v39']);
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`고르기 칸 ${width}: 아래가 모자라면 위로 펼치고 하단바를 덮지 않는다, 바깥을 누르면 닫힌다`,async({page})=>{
 const errors=await setup(page,width);
 const sel=page.locator('#selLow');await sel.click();
 await expect(list(page)).toBeVisible();
 await expect(list(page)).toHaveAttribute('data-side','above');
 const s=await sel.boundingBox(),m=await list(page).boundingBox();
 expect(m.y+m.height).toBeLessThanOrEqual(s.y+1);
 await list(page).getByRole('option',{name:'항목 2'}).click();
 await expect(sel).toHaveValue('v2');
 await sel.click();await expect(list(page)).toBeVisible();
 await page.mouse.click(width-4,300);
 await expect(list(page)).toBeHidden();
 expect(await page.evaluate(()=>window.__changes)).toEqual(['selLow:v2']);
 expect(errors).toEqual([]);
});
