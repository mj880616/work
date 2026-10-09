import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';
for(const width of [360,390,686,760,761,1023,1280])test(`toolbar one row, accessible icons and persistence at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});await openEmphasisFixture(page,{view:'default'});
  const toolbar=page.locator('.calendar-toolbar');
  await expect(toolbar.locator('.calendar-view-switch')).toHaveCount(1);
  expect(await toolbar.evaluate(el=>[...el.children].map(e=>e.id||e.className))).toEqual(['prevMonthBtn','monthTitle','nextMonthBtn','calendarTodayBtn','calendar-toolbar-divider','calendar-view-switch','newEventBtn']);
  for(const [view,name] of (width<=760?[['week','주간 보기'],['list','목록 보기'],['month','월간 보기']]:[['list','목록 보기'],['week','주간 보기'],['month','월간 보기']])){
    const button=toolbar.getByRole('button',{name,exact:true});await expect(button).toBeVisible();await expect(button.locator('svg')).toHaveCount(1);
    const rect=await button.boundingBox();expect(rect.width).toBe(36);expect(rect.height).toBe(32);
    await button.click();await expect(button).toHaveAttribute('aria-pressed','true');
    await expect(toolbar.locator('[data-calendar-view][aria-pressed="true"]')).toHaveCount(1);
    for(const inactive of await toolbar.locator('[data-calendar-view][aria-pressed="false"]').all())await expect(inactive).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    const colors=await button.evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,color:s.color,stroke:getComputedStyle(el.querySelector('svg')).stroke}});expect(colors.background).toBe('rgb(92, 106, 53)');expect(colors.color).toBe('rgb(255, 255, 255)');expect(colors.stroke).toBe(colors.color);
    expect(await page.evaluate(()=>localStorage.getItem('kptu-calendar-view'))).toBe(view);
  }
  // Do not seed storage on reload: the real selection must survive.
  await page.reload();await expect(page.locator('#calendarGrid')).toBeVisible();await expect(toolbar.locator('[data-calendar-view="month"]')).toHaveAttribute('aria-pressed','true');
  const geometry=await toolbar.evaluate(el=>{const r=el.getBoundingClientRect(),children=[...el.children].map(e=>({name:e.id||e.className,...e.getBoundingClientRect().toJSON()}));return {width:r.width,left:r.left,right:r.right,children,overflow:document.documentElement.scrollWidth,remaining:r.width-children.reduce((s,c)=>s+c.width,0)-parseFloat(getComputedStyle(el).columnGap)*(el.children.length-1)-[...el.children].filter(e=>e.id!=='newEventBtn').reduce((sum,e)=>sum+parseFloat(getComputedStyle(e).marginLeft)+parseFloat(getComputedStyle(e).marginRight),0)}});
  console.log('TOOLBAR',width,JSON.stringify(geometry));
  expect(geometry.overflow).toBe(width);for(const c of geometry.children){expect(c.left).toBeGreaterThanOrEqual(geometry.left-.5);expect(c.right).toBeLessThanOrEqual(geometry.right+.5);expect(c.height).toBeLessThanOrEqual(44)}
  const targets=await toolbar.locator('button').evaluateAll(bs=>bs.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),p=getComputedStyle(el,'::after'),active=p.content!=='none';const left=active?r.left+parseFloat(s.borderLeftWidth)+parseFloat(p.left):r.left,top=active?r.top+parseFloat(s.borderTopWidth)+parseFloat(p.top):r.top,w=active?parseFloat(p.width):r.width,h=active?parseFloat(p.height):r.height;return {name:el.id||el.dataset.calendarView,left,top,w,h,hits:[[left+1,top+h/2],[left+w-1,top+h/2],[left+w/2,top+1],[left+w/2,top+h-1]].map(([x,y])=>document.elementFromPoint(x,y)?.closest('button')===el)}}));
  for(const target of targets){expect(target.w,target.name).toBeGreaterThanOrEqual(44);expect(target.h,target.name).toBeGreaterThanOrEqual(44);expect(target.hits,target.name).toEqual([true,true,true,true])}
  expect(await toolbar.evaluate(el=>el.getBoundingClientRect().height)).toBe(48);
  const iconShapes=await toolbar.locator('.calendar-view-switch svg path').evaluateAll(ps=>ps.map(p=>({width:p.getBBox().width,height:p.getBBox().height,verticals:(p.getAttribute('d').match(/v10/g)||[]).length})));
  expect(iconShapes[0]).toMatchObject({width:16,height:12});expect(iconShapes[1]).toEqual({width:21,height:10,verticals:7});expect(iconShapes[2].height).toBeGreaterThan(iconShapes[1].height);
  const appearance=await toolbar.evaluate(el=>{const group=el.querySelector('.calendar-view-switch'),gs=getComputedStyle(group),divider=el.querySelector('.calendar-toolbar-divider'),ds=getComputedStyle(divider),ts=getComputedStyle(el);return {padding:[ts.paddingTop,ts.paddingBottom],group:{outline:gs.outlineWidth,style:gs.outlineStyle,color:gs.outlineColor,height:group.getBoundingClientRect().height},divider:{width:divider.getBoundingClientRect().width,height:divider.getBoundingClientRect().height,color:ds.borderLeftColor},buttons:[...el.querySelectorAll('button')].map(b=>({height:b.getBoundingClientRect().height,border:getComputedStyle(b).borderTopWidth})),icons:[...group.querySelectorAll('svg')].map(s=>({width:s.getBoundingClientRect().width,stroke:getComputedStyle(s).strokeWidth})),border:getComputedStyle(document.documentElement).getPropertyValue('--kptu-border').trim()}});
  expect(appearance.padding).toEqual(['8px','8px']);expect(appearance.group).toMatchObject({outline:'1px',style:'solid',height:32});expect(appearance.divider.width).toBe(1);expect(appearance.divider.height).toBe(20);expect(appearance.group.color).toBe(appearance.divider.color);
  for(const b of appearance.buttons)expect(b.height).toBe(32);for(const icon of appearance.icons)expect(icon).toEqual({width:16,stroke:'1.7px'});
  for(const b of await toolbar.locator('.calendar-view-switch button').all())await expect(b).toHaveCSS('border-top-width','0px');
  for(const id of ['prevMonthBtn','nextMonthBtn']){await expect(page.locator('#'+id)).toHaveCSS('border-top-width','0px');await expect(page.locator('#'+id)).toHaveCSS('background-color','rgba(0, 0, 0, 0)')}
  for(let i=0;i<targets.length;i++)for(let j=i+1;j<targets.length;j++){const a=targets[i],b=targets[j];expect(Math.min(a.left+a.w,b.left+b.w)-Math.max(a.left,b.left),a.name+'/'+b.name).toBeLessThanOrEqual(.5)}
  const buttonCenters=await toolbar.locator('button').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return r.top+r.height/2}));expect(Math.max(...buttonCenters)-Math.min(...buttonCenters)).toBeLessThan(1);
  await expect(page.locator('#monthTitle')).toHaveAccessibleName('2026년 10월');
  if(width<=760)await expect(page.locator('.calendar-title-compact')).toHaveText('10월');
  const old=await page.locator('#monthTitle').getAttribute('aria-label');await page.locator('#nextMonthBtn').click();await expect(page.locator('#monthTitle')).not.toHaveAttribute('aria-label',old);await page.locator('#prevMonthBtn').click();await expect(page.locator('#monthTitle')).toHaveAttribute('aria-label',old);await page.locator('#calendarTodayBtn').click();await expect(page.locator('#monthTitle')).toHaveAttribute('aria-label',old);
  await page.locator('#newEventBtn').click();await expect(page.locator('#eventModal')).toBeVisible();
});
for(const view of ['month','week','list'])test(`compact ${view} title stacks another year without widening`,async({page})=>{
  await page.setViewportSize({width:360,height:844});await openEmphasisFixture(page,{view:'default'});await page.locator(`[data-calendar-view="${view}"]`).click();
  const compact=page.locator('.calendar-title-compact');await expect(compact).toHaveText('10월');
  for(let i=0;i<(view==='month'?12:view==='week'?52:26);i++)await page.locator('#nextMonthBtn').click();
  await expect(compact.locator('.calendar-title-year')).toHaveText('2027');await expect(compact.locator('.calendar-title-year')).toHaveCSS('font-size','12px');
  await expect(page.locator('#monthTitle')).toHaveAccessibleName(/2027년/);
  const g=await compact.evaluate(el=>({width:el.getBoundingClientRect().width,month:el.querySelector('.calendar-title-month').getBoundingClientRect().width,year:el.querySelector('.calendar-title-year').getBoundingClientRect().toJSON(),monthRect:el.querySelector('.calendar-title-month').getBoundingClientRect().toJSON()}));expect(g.width).toBeCloseTo(g.month,1);expect(g.year.bottom).toBeLessThanOrEqual(g.monthRect.top+.5);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(360);
});
