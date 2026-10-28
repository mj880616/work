import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-PC팝업위치: on a PC (761px~) the shared choice sheet (choice-sheet.js) opens as a small list right by the button that was
// pressed (anchored-popup.js), without dimming the screen; outside press and Esc close it, focus goes to the first choice and
// back to the button. Phones keep the bottom sheet.
const quick=page=>page.locator('#homeView [data-home-quick]');
const dialog=page=>page.getByRole('dialog');
async function projectTrigger(page,width,height=844){
 await page.setViewportSize({width,height});await openHome(page);const q=quick(page);
 await q.locator('[data-quick-mode="task"]').click();await q.locator('[data-quick-input]').fill('QA');
 return q.locator('[data-quick-project]');
}
const near=async(trigger,sheet)=>{
 const t=await trigger.boundingBox(),d=await sheet.boundingBox();
 return {t,d,gap:d.y>=t.y+t.height-1?d.y-(t.y+t.height):t.y-(d.y+d.height)};
};

test('PC: list opens right below the pressed button, no dimming, Esc and outside press close, focus first choice then back',async({page})=>{
 const trigger=await projectTrigger(page,1280);
 await trigger.click();const sheet=dialog(page);await expect(sheet).toBeVisible();await expect(sheet).toHaveClass(/home-choice-anchored/);
 const {t,d,gap}=await near(trigger,sheet);
 expect(d.y).toBeGreaterThanOrEqual(t.y+t.height-1);expect(gap).toBeLessThanOrEqual(12);
 expect(Math.abs(d.x-t.x)).toBeLessThanOrEqual(1);expect(d.width).toBeLessThanOrEqual(360);
 expect(await sheet.evaluate(el=>getComputedStyle(el,'::backdrop').backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 await expect(sheet.getByRole('button',{name:'사업영역 없음',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(sheet).toBeHidden();await expect(trigger).toBeFocused();
 await trigger.click();await expect(sheet).toBeVisible();
 await page.mouse.click(1200,800);await expect(sheet).toBeHidden();await expect(trigger).toBeFocused();
 await trigger.click();await sheet.getByRole('button',{name:'자식 프로젝트',exact:true}).click();
 await expect(sheet).toBeHidden();await expect(trigger).toHaveText('자식 프로젝트 ▾');await expect(trigger).toBeFocused();
});

test('PC: the list follows the button when the window is resized, and becomes the bottom sheet at phone width',async({page})=>{
 const trigger=await projectTrigger(page,1280);
 await trigger.click();const sheet=dialog(page);await expect(sheet).toHaveClass(/home-choice-anchored/);
 await page.setViewportSize({width:1000,height:700});
 await expect.poll(async()=>(await near(trigger,sheet)).gap).toBeLessThanOrEqual(12);
 const {t,d}=await near(trigger,sheet);expect(Math.abs(d.x-t.x)).toBeLessThanOrEqual(1);expect(d.x+d.width).toBeLessThanOrEqual(1000);
 await page.setViewportSize({width:390,height:844});
 await expect(sheet).not.toHaveClass(/home-choice-anchored/);
 const b=await sheet.boundingBox();expect(b.width).toBeGreaterThanOrEqual(380);expect(b.y+b.height).toBeGreaterThan(844-200);
});

test('phone keeps the bottom sheet with the dimmed backdrop',async({page})=>{
 const trigger=await projectTrigger(page,390);
 await trigger.click();const sheet=dialog(page);await expect(sheet).toBeVisible();
 await expect(sheet).not.toHaveClass(/home-choice-anchored/);
 expect(await sheet.evaluate(el=>getComputedStyle(el,'::backdrop').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
 const b=await sheet.boundingBox();expect(b.width).toBeGreaterThanOrEqual(380);
});

// Placement rules of the shared module, with measured boxes standing in for buttons at the window edges.
test('placement: below, above when no room below, beside when neither, never past the window edges',async({page})=>{
 await page.setViewportSize({width:1280,height:700});await openHome(page);
 const r=await page.evaluate(async()=>{
  const {placeAnchored}=await import('./anchored-popup.js');
  const panel=document.createElement('div');panel.style.position='fixed';document.body.append(panel);
  const at=(left,top,w=40,h=32)=>({getBoundingClientRect:()=>({left,top,right:left+w,bottom:top+h,width:w,height:h})});
  const run=(anchor,opts)=>{const side=placeAnchored(panel,anchor,opts),b=panel.getBoundingClientRect();return {side,left:b.left,top:b.top,right:b.right,bottom:b.bottom,max:parseFloat(panel.style.maxHeight)};};
  panel.style.height='200px';
  const out={below:run(at(100,50)),above:run(at(100,640)),rightEdge:run(at(1250,50)),side:run(at(100,300),{maxHeight:480,minHeight:400})};
  panel.remove();return out;
 });
 expect(r.below).toMatchObject({side:'below',left:100,top:86});
 expect(r.above.side).toBe('above');expect(r.above.bottom).toBe(636);
 expect(r.rightEdge.side).toBe('below');expect(r.rightEdge.right).toBeLessThanOrEqual(1272);
 expect(r.side.side).toBe('side');expect(r.side.left).toBe(144);expect(r.side.top).toBeGreaterThanOrEqual(8);
 for(const v of Object.values(r)){expect(v.left).toBeGreaterThanOrEqual(8);expect(v.right).toBeLessThanOrEqual(1272);expect(v.max).toBeGreaterThan(0);}
});
