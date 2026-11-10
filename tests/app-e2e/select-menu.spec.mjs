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

// UI-고르기목록잘림: 고른 줄은 굵게 + ✓라 칸보다 길 수 있다. 목록은 가장 긴 줄만큼 넓어지고, 화면을 넘을 때만 줄바꿈(잘림·… 없음).
async function noClip(page){
 return list(page).evaluate(menu=>[...menu.querySelectorAll('.kptu-select-opt')].filter(o=>{
  const r=document.createRange();r.selectNodeContents(o);const t=r.getBoundingClientRect(),b=o.getBoundingClientRect();
  const check=parseFloat(getComputedStyle(o,'::after').width)||0;
  return o.scrollWidth>o.clientWidth+1||t.right>b.right+1||(o.getAttribute('aria-selected')==='true'&&t.right+check>b.right+1);
 }).map(o=>o.textContent));
}
for(const width of [412,1280])test(`고르기 목록 ${width}: 칸보다 긴 고른 줄(굵게 + ✓)도 잘리지 않는다, 오른쪽 끝 칸은 왼쪽으로 붙는다`,async({page})=>{
 const errors=await setup(page,width);
 await page.evaluate(()=>{
  const host=document.getElementById('selHost');
  host.insertAdjacentHTML('beforeend',`<select id="selArea" aria-label="사업영역" style="position:fixed;top:200px;right:16px;width:120px;z-index:50"><option value="">사업영역 전체</option><option value="a">조직</option></select>
   <select id="selLong" aria-label="긴 이름" style="position:fixed;top:260px;left:16px;width:110px;z-index:50"><option value="x">짧음</option><option value="y" selected>아주 긴 이름의 회의 이름이 화면 폭보다 길게 이어지는 경우를 보는 줄입니다 끝까지 보여야 합니다</option></select>`);
 });
 const area=page.locator('#selArea');await area.tap();
 await expect(list(page)).toBeVisible();
 const s=await area.boundingBox(),m=await list(page).boundingBox();
 expect(m.width).toBeGreaterThanOrEqual(s.width-1);
 expect(m.x+m.width).toBeLessThanOrEqual(width-8+1);expect(m.x).toBeGreaterThanOrEqual(7);
 await expect(list(page)).not.toHaveAttribute('data-wrap','');
 expect(await noClip(page)).toEqual([]);
 await page.keyboard.press('Escape');await expect(list(page)).toBeHidden();
 await page.locator('#selLong').tap();
 await expect(list(page)).toBeVisible();
 const l=await list(page).boundingBox();
 expect(l.x).toBeGreaterThanOrEqual(7);expect(l.x+l.width).toBeLessThanOrEqual(width-8+1);
 expect(await noClip(page)).toEqual([]);
 if(width<761)await expect(list(page)).toHaveAttribute('data-wrap','');
 expect(errors).toEqual([]);
});
