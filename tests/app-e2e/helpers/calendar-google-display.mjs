import { expect } from '@playwright/test';

const rgb=value=>value.startsWith('color(srgb')
  ?value.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>x*255)
  :value.match(/[\d.]+/g).slice(0,3).map(Number);
const luminance=values=>values.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
const contrast=(fg,bg)=>{const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};

// A colored event must remain readable and visibly distinct from the outlined task chip.
export async function expectGoogleDisplay(chip,{stripe=0,tint=.15}={}){
  const look=await chip.evaluate(el=>{const s=getComputedStyle(el),time=el.querySelector('.cmv-event-time,.cmv-day-time');return {source:el.style.backgroundColor,background:s.backgroundColor,color:s.color,weight:s.fontWeight,stripe:parseFloat(s.borderLeftWidth),stripeStyle:s.borderLeftStyle,stripeColor:s.borderLeftColor,timeOpacity:time?Number(getComputedStyle(time).opacity):1};});
  const source=rgb(look.source),background=rgb(look.background),foreground=rgb(look.color);
  expect(look.weight).toBe('400');expect(look.stripe).toBe(stripe);
  for(let i=0;i<3;i++){
    expect(Math.abs(background[i]-(255*(1-tint)+source[i]*tint))).toBeLessThan(1);
    expect(Math.abs(foreground[i]-source[i]*.45)).toBeLessThan(1);
  }
  expect(contrast(foreground,background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(foreground.map((x,i)=>x*look.timeOpacity+background[i]*(1-look.timeOpacity)),background)).toBeGreaterThanOrEqual(4.5);
  if(stripe){expect(look.stripeStyle).toBe('solid');expect(rgb(look.stripeColor)).toEqual(source);}
}
