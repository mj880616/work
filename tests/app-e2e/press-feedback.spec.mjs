import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-눌림느낌(2026-10-27 명진 요청): 모든 버튼·누를 수 있는 줄이 누르는 순간 살짝 작아지고(scale) 바탕이 진해진다.
// 움직임 줄이기 설정에서는 작아지지 않고 색만 바뀐다. 버튼이 아닌데 눌리는 것(cursor:pointer)도 같은 규칙을 쓴다. 눌렀다 놓으면 원래대로.
// 누른 채로 시험하려고 마우스를 누르고, 놓기 전에 옆으로 옮겨 실제 누름(click)은 일으키지 않는다.
const NAV='.app-nav [data-view="diary"]';
const style=async(page,selector)=>page.locator(selector).first().evaluate(el=>{const s=getComputedStyle(el);return {scale:s.scale,shadow:s.boxShadow,pressing:el.hasAttribute('data-pressing')};});
async function hold(page,selector){
 const box=await page.locator(selector).first().boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();
 return box;
}
async function letGo(page){await page.mouse.move(2,2);await page.mouse.up();}

test('1280 PC: 버튼을 누르는 동안 0.97배로 작아지고 안쪽 그림자로 진해지며, 놓으면 원래대로',async({page})=>{
 await page.setViewportSize({width:1280,height:800});await openHome(page);
 await expect(page.locator(NAV)).toBeVisible();
 const before=await style(page,NAV);
 expect(before.scale).toBe('none');
 await hold(page,NAV);
 await expect.poll(async()=>(await style(page,NAV)).scale).toBe('0.97');
 expect((await style(page,NAV)).shadow).toContain('inset');
 await letGo(page);
 await expect.poll(async()=>(await style(page,NAV)).scale).toBe('none');
 expect((await style(page,NAV)).pressing).toBe(false);
});

test('움직임 줄이기: 작아지지 않고 색(안쪽 그림자)만 바뀐다',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:1280,height:800});await openHome(page);
 await expect(page.locator(NAV)).toBeVisible();
 await hold(page,NAV);
 await expect.poll(async()=>(await style(page,NAV)).shadow).toContain('inset');
 expect((await style(page,NAV)).scale).toBe('none');
 await letGo(page);
});

test('버튼이 아닌데 눌리는 줄·카드(cursor:pointer)도 같은 규칙, 큰 카드는 덜 작아진다, data-press="off"는 제외',async({page})=>{
 await page.setViewportSize({width:390,height:800});await openHome(page);
 await page.evaluate(()=>{
  const host=document.createElement('div');host.id='pressProbe';host.style.cssText='position:fixed;left:8px;top:8px;z-index:9999;width:370px;display:grid;gap:8px';
  host.innerHTML='<div id="pressSmall" style="cursor:pointer;width:100px;height:30px;background:#eee">작은 칩</div><div id="pressWide" style="cursor:pointer;height:70px;background:#eee"><span id="pressInner">큰 카드 안 글자</span></div><div id="pressOff" data-press="off" style="cursor:pointer;height:30px;background:#eee">끌기 손잡이</div>';
  document.body.append(host);
 });
 await hold(page,'#pressSmall');
 await expect.poll(async()=>(await style(page,'#pressSmall')).scale).toBe('0.97');
 await letGo(page);
 await expect.poll(async()=>(await style(page,'#pressSmall')).pressing).toBe(false);
 await hold(page,'#pressInner');
 await expect.poll(async()=>(await style(page,'#pressWide')).scale).toBe('0.985');
 expect((await style(page,'#pressWide')).shadow).toContain('inset');
 await letGo(page);
 await hold(page,'#pressOff');
 await page.waitForTimeout(150);
 expect((await style(page,'#pressOff')).scale).toBe('none');
 await letGo(page);
});
