import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

// A full-width sidebar, CSS-only reordering, or equal-height card rows must fail.
async function boxes(page) {
  return page.locator('#homeView').evaluate(root => {
    const rect = el => { const {x,y,width,height,bottom,right}=el.getBoundingClientRect();return {x,y,width,height,bottom,right}; };
    return Object.fromEntries([...root.querySelectorAll('[data-home-quick],[data-home-card]')]
      .filter(el=>!el.hidden).map(el=>[el.dataset.homeCard||'quick',rect(el)]));
  });
}
async function readingOrder(page) {
  return page.locator('#homeView').evaluate(root=>[...root.querySelectorAll('[data-home-quick],[data-home-card]')]
    .filter(el=>!el.hidden).map(el=>el.dataset.homeCard||'quick'));
}
async function noOverflow(page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
for(const width of [1024,1280,1440,1023,390])for(const milestones of [true,false]) {
  test(`home columns and reading order ${width} D-day ${milestones}`,async({page})=>{
    await page.setViewportSize({width,height:1000});
    await openHome(page,{milestones});
    await page.waitForFunction(()=>window.KPTUHome?.metrics.readyAt);
    const b=await boxes(page);
    const left=['quick','calendar','tasks','meetings'];
    const right=milestones?['dday','updates']:['updates'];
    const order=width>=1024?[...left,...right]:['quick',...(milestones?['dday']:[]),'calendar','tasks','meetings','updates'];
    expect(await readingOrder(page)).toEqual(order);
    if(width>=1024){
      const sidebar=b[right[0]];
      expect(sidebar.width).toBeGreaterThanOrEqual(320);
      expect(sidebar.width).toBeLessThanOrEqual(380);
      expect(b.quick.width).toBeGreaterThan(sidebar.width);
      expect(Math.abs(b.quick.y-sidebar.y)).toBeLessThan(1);
      expect(sidebar.x).toBeGreaterThan(b.quick.right);
      for(let i=1;i<left.length;i++){
        expect(b[left[i]].x).toBe(b.quick.x);
        expect(b[left[i]].y-b[left[i-1]].bottom).toBeCloseTo(12,0);
      }
      if(milestones)expect(b.updates.y-b.dday.bottom).toBeCloseTo(12,0);
      expect(b.updates.bottom).toBeLessThan(b.meetings.bottom);
    }else{
      for(let i=1;i<order.length;i++){
        expect(b[order[i]].x).toBe(b.quick.x);
        expect(b[order[i]].y).toBeGreaterThanOrEqual(b[order[i-1]].bottom);
      }
    }
    await noOverflow(page);
    await expect(page.locator('[data-home-card="dday"]')).toHaveCount(1);
    if(!milestones)await expect(page.locator('[data-home-card="dday"]')).toBeHidden();
  });
}
test('home breakpoint moves the same D-day control and preserves input and focus',async({page})=>{
  await page.setViewportSize({width:1023,height:1000});await openHome(page);
  await page.waitForFunction(()=>window.KPTUHome?.metrics.readyAt);
  await page.locator('[data-quick-input]').fill('유지할 입력');
  const chip=page.locator('[data-home-project]').first();await chip.focus();
  await chip.evaluate(el=>window.layoutChip=el);
  for(const width of [1024,390,1440,1023]){
    await page.setViewportSize({width,height:1000});
    await expect(chip).toBeFocused();
    expect(await chip.evaluate(el=>el===window.layoutChip)).toBe(true);
    await expect(page.locator('[data-quick-input]')).toHaveValue('유지할 입력');
    await noOverflow(page);
    expect(await readingOrder(page)).toEqual(width>=1024?['quick','calendar','tasks','meetings','dday','updates']:['quick','dday','calendar','tasks','meetings','updates']);
  }
});
for(const [card,view] of [['calendar','calendar'],['tasks','tasks'],['meetings','meetings'],['updates','team']]){
  test(`desktop home ${card} arrow keeps its destination`,async({page})=>{
    await page.setViewportSize({width:1280,height:1000});await openHome(page);
    await page.locator(`[data-home-card="${card}"] [data-goto="${view}"]`).click();
    await expect(page.locator(`#${view}View`)).toBeVisible();
  });
}
test('desktop home completion keeps its existing undo behavior',async({page})=>{
  await page.setViewportSize({width:1024,height:1000});await openHome(page);
  const toggle=page.locator('[data-home-toggle="today"]');await expect(toggle).toBeEnabled();
  await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');
  await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','false');
});
test('home refresh preserves the mounted input, draft and focus',async({page})=>{
  await page.setViewportSize({width:1280,height:1000});await openHome(page);
  await page.waitForFunction(()=>window.KPTUHome?.metrics.readyAt);
  const input=page.locator('[data-quick-input]');await input.fill('갱신 중 입력');
  await input.evaluate(el=>window.layoutInput=el);
  await page.evaluate(()=>new Promise(resolve=>{
    addEventListener('kptu:home-ready',resolve,{once:true});KPTUHome.start();
  }));
  await expect(input).toBeFocused();await expect(input).toHaveValue('갱신 중 입력');
  expect(await input.evaluate(el=>el===window.layoutInput)).toBe(true);
});
