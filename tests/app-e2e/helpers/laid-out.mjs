import {expect} from '@playwright/test';
// 화면이 자료를 받을 때마다 같은 칸을 다시 그리면, 찾은 요소가 재는 순간 떨어져 나가 boundingBox()가 null이 될 수 있다.
// 붙어 있고 크기가 잡힌 요소가 나올 때까지 다시 찾아 잰다(고정 대기 없음).
export async function laidOutBox(locator){
 let box=null;
 await expect.poll(async()=>(box=await locator.boundingBox())).not.toBeNull();
 return box;
}
// 떨어져 나간 요소의 getComputedStyle은 빈 문자열을 돌려준다. 붙어 있는 요소에서 읽은 값이 나올 때까지 다시 읽는다.
export const pseudoContent=(locator,pseudo='::before')=>locator.evaluate((e,p)=>e.isConnected?getComputedStyle(e,p).content:null,pseudo);
// 떨어져 나간 요소의 getBoundingClientRect는 전부 0이라 위 자리가 0으로 읽힌다(locator.evaluate는 '요소 찾기 → 재기'를 따로 보내므로
// 그 사이에 칸이 다시 그려지면 화면에서 빠진 옛 요소를 잰다). 붙어 있는 요소에서 잰 값이 나올 때까지 다시 찾아 잰다(고정 대기 없음).
export async function laidOutRect(locator){
 let rect=null;
 await expect.poll(async()=>(rect=await locator.evaluate(e=>{
  if(!e.isConnected)return null;
  const r=e.getBoundingClientRect();
  return{top:Math.round(r.top),bottom:Math.round(r.bottom)};
 }))).not.toBeNull();
 return rect;
}
