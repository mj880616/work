import { expect } from '@playwright/test';

const rgb=value=>value.startsWith('color(srgb')
  ?value.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>x*255)
  :value.match(/[\d.]+/g).slice(0,3).map(Number);
const luminance=values=>values.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
const contrast=(fg,bg)=>{const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};

// S67-65 E1: a Google event is a solid chip — the painted background is the event's (toned) color itself, with no side stripe,
// and its text (and the time in front of it) stays readable on that fill. Still visibly distinct from the outlined task chip.
// S68-03 G2(사용자 11/22): 구글처럼 밝은 색 + 흰 글자 기본 — 흰 글자면 2.7:1 이상, 진한 글자(밝은 노랑)면 4.5:1 이상.
// S68-57: 달력은 자료가 올 때마다 칸을 통째로 다시 그린다(한 renderer, 같은 칠). locator.evaluate는 요소를 찾은 뒤 따로 읽으므로
// 그 사이에 다시 그려지면 떨어져 나간 옛 칩을 읽어 getComputedStyle이 빈 값을 준다(CI 간헐 실패 'null.slice').
// 그래서 문서에 붙어 있는 칩에서 한 번에 읽힐 때까지 기다린다(떨어진 칩이면 null → 다시 찾아 읽음). 값 판정은 그대로다.
export async function expectGoogleDisplay(chip){
  let look=null;
  await expect.poll(async()=>(look=await chip.evaluate(el=>{if(!el.isConnected)return null;const s=getComputedStyle(el),time=el.querySelector('.cmv-event-time,.cmv-day-time,.clv-time');return {source:el.style.getPropertyValue('--cmv-google-source')||el.style.backgroundColor,background:s.backgroundColor,color:s.color,weight:s.fontWeight,stripe:parseFloat(s.borderLeftWidth),timeOpacity:time?Number(getComputedStyle(time).opacity):1};}))).not.toBeNull();
  const source=look.source.startsWith('#')?look.source.slice(1).match(/../g).map(x=>parseInt(x,16)):rgb(look.source),background=rgb(look.background),foreground=rgb(look.color);
  expect(look.weight).toBe('400');expect(look.stripe).toBe(0);
  for(let i=0;i<3;i++)expect(Math.abs(background[i]-source[i])).toBeLessThan(1);
  const min=foreground.every(x=>x>=254.5)?2.7:4.5;
  expect(contrast(foreground,background)).toBeGreaterThanOrEqual(min);
  expect(contrast(foreground.map((x,i)=>x*look.timeOpacity+background[i]*(1-look.timeOpacity)),background)).toBeGreaterThanOrEqual(min);
  return {background,foreground};
}
