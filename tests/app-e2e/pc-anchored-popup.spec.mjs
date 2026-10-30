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

// UI-창잘림·끌어옮기기: the box the panel is really drawn at decides — a panel whose CSS makes it wider or taller than asked is still
// kept inside the window at the right and bottom edges (1440·1024·884), and ⋯ menus (anchored-menu.js) too.
for(const width of [1440,1024,884])test(`${width}: a popup drawn wider than asked, opened from the right or bottom edge, stays inside the window`,async({page})=>{
 await page.setViewportSize({width,height:700});await openHome(page);
 const r=await page.evaluate(async()=>{
  const {placeAnchored}=await import('./anchored-popup.js');const {createAnchoredMenu}=await import('./anchored-menu.js');
  const vw=document.documentElement.clientWidth,vh=innerHeight,out=[];
  const panel=document.createElement('div');Object.assign(panel.style,{position:'fixed'});panel.style.setProperty('min-width','430px');panel.style.setProperty('min-height','260px');document.body.append(panel);
  const at=(left,top,w=40,h=28)=>({getBoundingClientRect:()=>({left,top,right:left+w,bottom:top+h,width:w,height:h})});
  for(const a of [at(vw-44,40),at(vw-44,vh-32),at(vw-300,vh-60),at(vw-44,vh/2-14)]){placeAnchored(panel,a,{maxWidth:360,maxHeight:480,minHeight:400});const b=panel.getBoundingClientRect();out.push({left:b.left,top:b.top,right:b.right,bottom:b.bottom});}
  panel.remove();
  const trigger=document.createElement('button');trigger.type='button';trigger.textContent='⋯';Object.assign(trigger.style,{position:'fixed',right:'2px',bottom:'2px',width:'28px',height:'28px',zIndex:9999});document.body.append(trigger);
  const style=document.createElement('style');style.textContent='#qaWideMenu{position:fixed;min-width:300px}';document.head.append(style);
  const menu=createAnchoredMenu({id:'qaWideMenu',className:'qa-wide-menu',label:'시험 메뉴',historyKey:'qaWideMenu',key:()=>'x',render:()=>'<button type="button">하나</button><button type="button">둘</button>',onAction:()=>{}});
  menu.open(trigger);await new Promise(r=>requestAnimationFrame(r));
  const m=document.getElementById('qaWideMenu').getBoundingClientRect();out.push({left:m.left,top:m.top,right:m.right,bottom:m.bottom});
  const side='anchorSide' in document.getElementById('qaWideMenu').dataset;
  await menu.close();trigger.remove();
  return {vw,vh,out,side};
 });
 for(const b of r.out){expect(b.left).toBeGreaterThanOrEqual(0);expect(b.top).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(r.vw);expect(b.bottom).toBeLessThanOrEqual(r.vh);}
 // A ⋯ menu has no title row and is not an anchored (draggable) popup.
 expect(r.side).toBe(false);
});

test('PC: a popup dragged by its title stays where it was put while the page scrolls, and is forgotten when closed',async({page})=>{
 await page.setViewportSize({width:1280,height:700});await openHome(page);
 const r=await page.evaluate(async()=>{
  const {placeAnchored,followAnchor,clearAnchored,dragByTitle}=await import('./anchored-popup.js');
  const anchor=document.createElement('button');anchor.type='button';anchor.textContent='열기';Object.assign(anchor.style,{position:'fixed',left:'300px',top:'200px',zIndex:99999});document.body.append(anchor);
  const panel=document.createElement('div');panel.id='qaDragPanel';Object.assign(panel.style,{position:'fixed',background:'#fff',height:'160px',zIndex:99999});
  panel.innerHTML='<div class="anchored-drag-title" style="height:24px"><b>제목</b><button type="button">×</button></div>';document.body.append(panel);
  dragByTitle(panel,'.anchored-drag-title');
  const place=()=>placeAnchored(panel,anchor,{maxWidth:300,maxHeight:300});place();
  const stop=followAnchor(panel,anchor,{place,lost:()=>{window.__qaLost=true;}});
  window.__qa={place,stop,clearAnchored,panel,anchor};
  const b=panel.getBoundingClientRect(),t=panel.querySelector('b').getBoundingClientRect();
  return {left:b.left,top:b.top,hx:t.left+t.width/2,hy:t.top+t.height/2};
 });
 await page.mouse.move(r.hx,r.hy);await page.mouse.down();await page.mouse.move(r.hx+200,r.hy+150,{steps:5});await page.mouse.up();
 const moved=await page.locator('#qaDragPanel').boundingBox();
 expect(Math.round(moved.x-r.left)).toBe(200);expect(Math.round(moved.y-r.top)).toBe(150);
 // The page scrolls (the button moves): it does not follow the button and is not closed.
 await page.evaluate(()=>{window.__qa.anchor.style.top='420px';window.dispatchEvent(new Event('scroll'));});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const after=await page.locator('#qaDragPanel').boundingBox();
 expect(Math.round(after.x)).toBe(Math.round(moved.x));expect(Math.round(after.y)).toBe(Math.round(moved.y));
 expect(await page.evaluate(()=>!!window.__qaLost)).toBe(false);
 // Closed (clearAnchored) and opened again: by the button again.
 const back=await page.evaluate(()=>{const q=window.__qa;q.stop();q.clearAnchored(q.panel);q.anchor.style.top='200px';q.place();const b=q.panel.getBoundingClientRect(),a=q.anchor.getBoundingClientRect();return {moved:'anchorMoved' in q.panel.dataset,dx:b.left-a.left,dy:b.top-a.bottom};});
 expect(back.moved).toBe(false);expect(Math.round(back.dx)).toBe(0);expect(back.dy).toBeGreaterThanOrEqual(0);expect(back.dy).toBeLessThanOrEqual(12);
});
