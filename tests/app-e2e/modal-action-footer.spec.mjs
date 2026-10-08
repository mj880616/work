import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const orgs=Array.from({length:16},(_,i)=>({id:'footer-org-'+i,name:'합성 담당조직 '+(i+1),active:true}));
const event={id:'event',title:'오전 일정',start:'2026-10-06T10:00:00+09:00',end:'2026-10-06T11:00:00+09:00',calendarId:'c',recurring:false,organizationIds:[]};
const cases=[
  {id:'eventModal',save:'saveEventBtn',status:'eventStatus',last:'#soEventOrgChecks label:last-child',input:'eventDescription'},
  {id:'ciGoogleModal',save:'ciGoogleSave',status:'ciGoogleStatus',last:'#soGoogleEditOrgChecks label:last-child',input:'ciGoogleMemo'},
  {id:'taskModal',save:'saveTaskBtn',status:'taskModalStatus',last:'#taskNote',input:'taskNote'},
  {id:'gtTaskModal',save:'gtSaveBtn',status:'gtEditStatus',last:'#gtEditLinkBody label:last-child',input:'gtEditNotes'}
];
test.use({timezoneId:'Asia/Seoul'});

async function open(page,c,{gate=null,error="합성 저장 오류"}={}){
  await openHome(page,{query:'?view=calendar'});
  const writes=[];
  await page.route(SB+'/**',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(p.endsWith('app_suborganizations'))return route.fulfill({json:orgs});
    if(p.endsWith('app_suborganization_assignees'))return route.fulfill({json:orgs.map(o=>({organization_id:o.id,user_id:'home-test'}))});
    if(p.endsWith('google-calendar')&&u.searchParams.get('action')==='event')return route.fulfill({json:{event}});
    if(req.method()==='POST'&&p.includes('/functions/')){writes.push(req.postDataJSON());await gate;return route.fulfill({status:500,json:{message:error}});}
    return route.fallback();
  });
  await page.waitForFunction(()=>window.__KPTU_RELOAD_SUBORGANIZATIONS__&&window.KPTUGoogleTasks);
  await page.evaluate(()=>window.__KPTU_RELOAD_SUBORGANIZATIONS__());
  if(c.id==='eventModal')await page.locator('#newEventBtn').click();
  if(c.id==='ciGoogleModal')await page.locator('[data-google-event="event"]').first().click();
  if(c.id==='taskModal'){
    // Retained editor has no primary navigation entry after Google Tasks became the default.
    await page.evaluate(async()=>{await import('/app/task-layout.js');window.KPTUTaskLayout.openCreate();});
  }
  if(c.id==='gtTaskModal')await page.evaluate(()=>window.KPTUGoogleTasks.openEditor({id:'today',title:'오늘 항목',status:'needsAction',taskListId:'default'}));
  await expect(page.locator('#'+c.id)).toBeVisible();
  await expect(page.locator('#'+c.save)).toBeEnabled();
  return writes;
}
async function top(page,c){await page.locator('#'+c.id+' .modal-card').evaluate(el=>el.scrollTop=0);}
async function inViewport(locator){
  const r=await locator.boundingBox();expect(r).not.toBeNull();expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.y+r.height).toBeLessThanOrEqual(await locator.page().evaluate(()=>innerHeight));
}

for(const width of [360,1280])for(const c of cases){
  test(`${width}px ${c.id}: save/error stay visible and last input clears footer`,async({page})=>{
    await page.setViewportSize({width,height:640});await open(page,c);await top(page,c);
    await inViewport(page.locator('#'+c.save));
    const card=page.locator('#'+c.id+' .modal-card');
    const cardAtTop=await card.boundingBox(),footerAtTop=await page.locator('#'+c.id+' .modal-action-footer').boundingBox();
    expect(Math.abs((footerAtTop.y+footerAtTop.height)-(cardAtTop.y+cardAtTop.height))).toBeLessThanOrEqual(1);
    await card.evaluate(el=>el.scrollTop=el.scrollHeight);
    if(c.id==='gtTaskModal')await page.locator('#gtEditLinkBody').evaluate(el=>el.scrollTop=el.scrollHeight);
    const last=await page.locator(c.last).last().boundingBox(),footer=await page.locator('#'+c.id+' .modal-action-footer').boundingBox();
    expect(last.y+last.height).toBeLessThanOrEqual(footer.y);
    // Hit-test the full 44px target (including D-3c's transparent extension).
    for(const button of await page.locator('#'+c.id+' .modal-action-footer button:visible').all()){
      const hit=await button.evaluate(el=>{const r=el.getBoundingClientRect();return [-21,21].every(d=>document.elementFromPoint(r.x+r.width/2,r.y+r.height/2+d)?.closest('button')===el)&&[-21,21].every(d=>document.elementFromPoint(r.x+r.width/2+d,r.y+r.height/2)?.closest('button')===el);});
      expect(hit).toBe(true);
    }
    if(c.id==='eventModal')await page.locator('#eventTitle').fill('합성 저장 시험');
    if(c.id==='taskModal')await page.locator('#taskTitle').fill('');
    await top(page,c);await page.locator('#'+c.save).click();
    await expect(page.locator('#'+c.status)).toContainText(c.id==='taskModal'?'할 일을 입력해 주세요.':'합성 저장 오류');await top(page,c);
    await inViewport(page.locator('#'+c.status));await inViewport(page.locator('#'+c.save));
    expect(await page.locator('#'+c.status).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
  });
}

test('event task mode shares the footer and keeps failed draft',async({page})=>{
  await page.setViewportSize({width:360,height:640});const c=cases[0];await open(page,c);
  await page.locator('[data-event-mode="task"]').click();await page.locator('#eventTitle').fill('합성 할 일');
  await top(page,c);await inViewport(page.locator('#saveEventBtn'));await page.locator('#saveEventBtn').click();
  await expect(page.locator('#eventStatus')).toContainText('합성 저장 오류');await expect(page.locator('#eventTitle')).toHaveValue('합성 할 일');
  await top(page,c);await inViewport(page.locator('#eventStatus'));
});

for(const c of cases)test(`${c.id}: visual keyboard releases footer and restores when keyboard viewport recovers`,async({page})=>{
  await page.setViewportSize({width:360,height:640});await open(page,c);
  await page.locator('#'+c.input).focus();
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:320});visualViewport.dispatchEvent(new Event('resize'));});
  const footer=page.locator('#'+c.id+' .modal-action-footer');
  await expect(footer).toHaveCSS('position','static');
  await page.locator('#'+c.input).scrollIntoViewIfNeeded();
  const input=await page.locator('#'+c.input).boundingBox(),r=await footer.boundingBox();expect(input.y+input.height).toBeLessThanOrEqual(r.y);
  await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
  await expect(footer).toHaveCSS('position','sticky');await top(page,c);await inViewport(page.locator('#'+c.save));
});

test('rotation with focused input keeps the footer pinned',async({page})=>{
  await page.setViewportSize({width:360,height:640});await open(page,cases[0]);
  await page.locator('#eventDescription').focus();await page.setViewportSize({width:640,height:360});
  await expect(page.locator('#eventModal .modal-action-footer')).toHaveCSS('position','sticky');
  await page.locator('#saveEventBtn').focus();await top(page,cases[0]);await inViewport(page.locator('#saveEventBtn'));
});

test('closing and reopening clears keyboard state; zoom does not release footer',async({page})=>{
  await page.setViewportSize({width:360,height:640});await open(page,cases[0]);
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:320});visualViewport.dispatchEvent(new Event('resize'));});
  await expect(page.locator('#eventModal .modal-action-footer')).toHaveCSS('position','static');
  await page.locator('[data-close="eventModal"]').click();await expect(page.locator('#eventModal')).toBeHidden();
  await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
  await page.locator('#newEventBtn').click();await expect(page.locator('#eventModal .modal-action-footer')).toHaveCSS('position','sticky');
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'scale',{configurable:true,value:2});Object.defineProperty(visualViewport,'height',{configurable:true,value:320});visualViewport.dispatchEvent(new Event('resize'));});
  await expect(page.locator('#eventModal .modal-action-footer')).toHaveCSS('position','sticky');
});

test('pending save and wrapped server error remain above the save button',async({page})=>{
  await page.setViewportSize({width:360,height:640});let release;const gate=new Promise(r=>release=r);
  const error='합성 저장 오류: '+('연결을 다시 확인해 주세요. '.repeat(12));
  const c=cases[0];await open(page,c,{gate,error});await page.locator('#eventTitle').fill('진행 상태 시험');await top(page,c);
  await page.locator('#saveEventBtn').click();
  try{await expect(page.locator('#eventStatus')).toContainText('저장 중');await top(page,c);await inViewport(page.locator('#eventStatus'));await inViewport(page.locator('#saveEventBtn'));}finally{release();}
  await expect(page.locator('#eventStatus')).toHaveText(error.trim());await top(page,c);
  await inViewport(page.locator('#eventStatus'));await inViewport(page.locator('#saveEventBtn'));
});

test('pinned calendar delete keeps confirmation and the existing request',async({page})=>{
  await page.setViewportSize({width:360,height:640});const c=cases[1],writes=await open(page,c);await top(page,c);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#ciGoogleDelete').click();
  expect(writes).toHaveLength(0);await expect(page.locator('#ciGoogleModal')).toBeVisible();
  const deleted=[];await page.route(SB+'/functions/v1/google-calendar',route=>{
    deleted.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});
  });
  page.once('dialog',dialog=>dialog.accept());await page.locator('#ciGoogleDelete').click();
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  expect(deleted).toEqual([{action:'delete-event',calendar_id:'c',event_id:'event'}]);
});

test('input auto-zoom still releases the footer when the visual keyboard opens',async({page})=>{
  await page.setViewportSize({width:360,height:640});await open(page,cases[0]);
  await page.locator('#eventDescription').focus();
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'scale',{configurable:true,value:1.2});Object.defineProperty(visualViewport,'height',{configurable:true,value:280});visualViewport.dispatchEvent(new Event('resize'));});
  await expect(page.locator('#eventModal .modal-action-footer')).toHaveCSS('position','static');
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:innerHeight/1.2});visualViewport.dispatchEvent(new Event('resize'));});
  await expect(page.locator('#eventModal .modal-action-footer')).toHaveCSS('position','sticky');
});
