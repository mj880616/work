import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// ORG-PC좌우(2026-10-21 요청): PC(≥1024) 담당조직 화면은 왼쪽 목록 1/3 + 오른쪽 상세 2/3(같은 상세 창을 칸에 옮겨 씀,
// 프로젝트 화면 UI-PC프로젝트좌우와 같은 짜임). 처음 열면 이 기기에서 마지막으로 본 조직(없거나 저장소가 막히면 맨 위).
// 상세의 기록 → 업데이트 화면에서 "← (조직)으로 돌아가기"·뒤로 가기 → 같은 조직·같은 스크롤. 761~1023px·폰은 목록 + 상세 창.
// 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const note={id:'10000000-0000-4000-8000-0000000000bb',workspace_id:'w',kind:'basket',occurred_at:stamp,updated_at:stamp,raw_text:'합성 조직 바구니 원문',ai_export_allowed:true,archived_at:null,attachments:[]};
// The first two are in the 철도 group order (organization-order.js); the rest fall in "그 외" by name.
const orgs=[
 {id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp},
 {id:'ob',workspace_id:'w',name:'합성 나 지부',active:true,created_by:owner,updated_at:stamp},
 {id:'oc',workspace_id:'w',name:'합성 다 지부',active:true,created_by:owner,updated_at:stamp}
];
const day=i=>`2026-09-${String(30-i).padStart(2,'0')}T0${i%10}:00:00Z`;
async function fixture(page,{width=1280,blockStorage=false}={}){
 await page.setViewportSize({width,height:800});
 if(blockStorage)await page.addInitScript(()=>{const deny=()=>{throw new DOMException('blocked','SecurityError')};const s=Storage.prototype,get=s.getItem,set=s.setItem;s.getItem=function(k){return String(k).includes('organization-last')?deny():get.call(this,k)};s.setItem=function(k,v){return String(k).includes('organization-last')?deny():set.call(this,k,v)}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await openHome(page);
 const state={writes:[],
  updates:Array.from({length:24},(_,i)=>({id:'u-'+i,organization_id:'oa',raw_text:'합성 기록 '+i,detail_text:null,occurred_at:day(i)})),
  links:[{id:'l-o',workspace_id:'w',note_id:note.id,project_id:null,organization_id:'oa',status:'confirmed',summary:'합성 조직 연결 요약'}]};
 const list=(route,rows)=>{const q=new URL(route.request().url()).searchParams;const o=Number(q.get('offset')||0);return route.fulfill({json:rows.slice(o,o+Number(q.get('limit')||rows.length||1))})};
 page.on('request',req=>{if(req.url().startsWith(SB+'/rest/')&&!['GET','HEAD','OPTIONS'].includes(req.method()))state.writes.push(req.method()+' '+new URL(req.url()).pathname)});
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return route.fulfill({json:id?orgs.filter(o=>'eq.'+o.id===id):orgs})});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner}))})});
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('organization_id')||'';return list(route,state.updates.filter(u=>id==='eq.'+u.organization_id||id.startsWith('in.(')&&id.slice(4,-1).split(',').includes(u.organization_id)))});
 await page.route(SB+'/rest/v1/app_notes?**',route=>list(route,[note]));
 await page.route(SB+'/rest/v1/app_record_links?**',route=>{
  const q=new URL(route.request().url()).searchParams;if(q.has('google_task_id'))return route.fulfill({json:[]});
  let rows=state.links;const v=q.get('organization_id');if(v?.startsWith('in.('))rows=rows.filter(x=>v.slice(4,-1).split(',').includes(x.organization_id));else if(q.get('project_id')?.startsWith('in.('))rows=[];
  const n=q.get('note_id');if(n?.startsWith('eq.'))rows=rows.filter(x=>x.note_id===n.slice(3));
  return list(route,rows.map(row=>({...row,note,organization:{name:orgs.find(o=>o.id===row.organization_id)?.name||''},project:null})));
 });
 return {f,state,errors};
}
const pane=page=>page.locator('#wdDetailPane');
const title=page=>page.locator('#wdTitle');
const row=(page,id)=>page.locator(`#soOrganizationList [data-so-org="${id}"]`);
const lastKeys=page=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('organization-last')).map(k=>[k,localStorage.getItem(k)])).catch(()=>[['navigating']]);
const top=locator=>locator.evaluate(el=>Math.round(el.getBoundingClientRect().top));
async function browserBack(page){const c=await page.context().newCDPSession(page);for(const type of ['mousePressed','mouseReleased'])await c.send('Input.dispatchMouseEvent',{type,x:1,y:1,button:'back',clickCount:1});await c.detach()}
const goBack=(page,how)=>how==='browser'?browserBack(page):page.goBack();
async function scrollToRecord(page,locator){
 await locator.evaluate(el=>{let n=el.parentElement;while(n&&!(n.scrollHeight>n.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(n).overflowY)))n=n.parentElement;(n||document.scrollingElement).scrollTop+=el.getBoundingClientRect().top-300});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r())));return top(locator);
}

test('PC 1280: list 1/3 on the left, the first organization on the right without a dialog; another row switches the pane',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'team');
 await expect(title(page)).toHaveText('합성 가 지부');
 const modal=page.locator('#wdModal');
 await expect(pane(page).locator('#wdModal')).toBeVisible();
 await expect(modal).toHaveAttribute('role','region');await expect(modal).not.toHaveAttribute('aria-modal','true');
 await expect(modal.locator('[data-wd-close="wdModal"]')).toBeHidden();
 const list=await page.locator('#soOrganizationList').boundingBox(),right=await pane(page).boundingBox();
 expect(right.x).toBeGreaterThanOrEqual(list.x+list.width);expect(Math.abs(right.y-list.y)).toBeLessThanOrEqual(1);
 // 좌 1/3 : 우 2/3(--ds-split-*, UI-좌우비율): 오른쪽 폭이 왼쪽의 2배 안팎(틈 포함).
 expect(Math.abs(right.width/list.width-2)).toBeLessThan(0.1);
 await expect(row(page,'oa')).toHaveAttribute('aria-current','true');await expect(row(page,'oa')).toHaveClass(/is-selected/);
 // The detail content is the same: input, tasks, documents, records, timeline, more.
 for(const id of ['#wdInboxText','#wdTasks','#wdDocs','#wdLog','#wdTime','#wdMore'])await expect(modal.locator(id)).toBeVisible();
 await expect(modal.locator('#wdUpdates')).toContainText('합성 기록 0');
 // Another row: the pane changes in place, no history entry, the row shows the selection.
 const length=await page.evaluate(()=>history.length);
 await row(page,'ob').click();await expect(title(page)).toHaveText('합성 나 지부');
 await expect(row(page,'ob')).toHaveAttribute('aria-current','true');await expect(row(page,'oa')).not.toHaveAttribute('aria-current','true');
 await expect(pane(page).locator('#wdModal')).toBeVisible();await expect(modal).toHaveAttribute('role','region');
 expect(await page.evaluate(()=>history.length)).toBe(length);
 // The same row again leaves the pane as it is.
 await row(page,'ob').click();await expect(title(page)).toHaveText('합성 나 지부');
 expect(await lastKeys(page)).toEqual([[`kptu_owner_cache:organization-last-v1:${owner}`,'ob']]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 // Next time the screen opens on this device, the last organization shows first: another screen and back, and a reload.
 await clickView(page,'home');await expect(page.locator('#wdModal')).toBeHidden();
 await clickView(page,'team');await expect(title(page)).toHaveText('합성 나 지부');await expect(row(page,'ob')).toHaveAttribute('aria-current','true');
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 await clickView(page,'team');await expect(title(page)).toHaveText('합성 나 지부');
 expect(state.writes).toEqual([]);expect(errors).toEqual([]);
});

test('PC 1280: sign-out and another user on this device drop the remembered organization',async({page})=>{
 const {errors}=await fixture(page);
 await clickView(page,'team');await expect(title(page)).toHaveText('합성 가 지부');
 await row(page,'oc').click();await expect(title(page)).toHaveText('합성 다 지부');
 expect(await lastKeys(page)).toEqual([[`kptu_owner_cache:organization-last-v1:${owner}`,'oc']]);
 // Another user on the same device never sees it: the key goes with the owner change.
 await page.evaluate(()=>window.KPTURuntime.session.write({access_token:'token-b',refresh_token:'token-b',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'other-user'}}));
 await expect.poll(()=>lastKeys(page)).toEqual([]);
 await page.evaluate(owner=>localStorage.setItem('kptu_owner_cache:organization-last-v1:other-user','ob'),owner);
 await page.evaluate(()=>window.KPTURuntime.session.write(null));
 await expect.poll(()=>lastKeys(page)).toEqual([]);
 expect(errors).toEqual([]);
});

test('PC 1280: a blocked browser storage still opens the first organization',async({page})=>{
 const {errors}=await fixture(page,{blockStorage:true});
 await clickView(page,'team');await expect(title(page)).toHaveText('합성 가 지부');
 await row(page,'ob').click();await expect(title(page)).toHaveText('합성 나 지부');
 await clickView(page,'home');await clickView(page,'team');await expect(title(page)).toHaveText('합성 가 지부');expect(errors).toEqual([]);
});

test('PC 1280: a record opens the update with "← (organization)으로 돌아가기"; the button and back return to the same organization and scroll',async({page})=>{
 const {errors}=await fixture(page);
 await clickView(page,'team');await expect(title(page)).toHaveText('합성 가 지부');
 await row(page,'ob').click();await expect(title(page)).toHaveText('합성 나 지부');
 await row(page,'oa').click();await expect(title(page)).toHaveText('합성 가 지부');
 const line=page.locator('#wdModal [data-basket-link="l-o"] a[data-basket-link-open]');await expect(line).toBeVisible();
 const before=await scrollToRecord(page,line);expect(await pane(page).evaluate(el=>el.scrollTop)).toBeGreaterThan(100);
 for(const how of ['button','back','browser']){
  await line.click();
  await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('basket');await expect(page.locator('[data-basket-text]')).toHaveValue(note.raw_text);
  const back=page.locator('#basketView [data-basket-return]');await expect(back).toHaveText('← 합성 가 지부로 돌아가기');
  if(how==='button')await back.click();else await goBack(page,how);
  await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('team');await expect(title(page)).toHaveText('합성 가 지부');
  await expect(pane(page).locator('#wdModal')).toBeVisible();await expect(row(page,'oa')).toHaveAttribute('aria-current','true');
  await expect.poll(()=>top(line)).toBe(before);
 }
 expect(errors).toEqual([]);
});

test('PC 1024: the list keeps its minimum width, the pane takes the rest, nothing overflows sideways',async({page})=>{
 const {errors}=await fixture(page,{width:1024});
 await clickView(page,'team');await expect(title(page)).toHaveText('합성 가 지부');
 const list=await page.locator('#soOrganizationList').boundingBox(),right=await pane(page).boundingBox();
 expect(list.width).toBeGreaterThanOrEqual(239);expect(right.width).toBeGreaterThan(list.width);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
});

for(const width of [390,900])test(`${width}: list with the detail dialog as before (no pane, no auto-open)`,async({page})=>{
 const {errors}=await fixture(page,{width});
 await clickView(page,'team');await expect(row(page,'oa')).toBeVisible();
 await expect(pane(page)).toBeHidden();await expect(page.locator('#wdModal')).toBeHidden();
 const list=await page.locator('#soOrganizationList').boundingBox();expect(list.width).toBeGreaterThan(width*0.8);
 await row(page,'ob').click();const modal=page.locator('#wdModal');await expect(title(page)).toHaveText('합성 나 지부');
 await expect(modal).toHaveAttribute('aria-modal','true');await expect(modal).toHaveAttribute('role','dialog');
 expect(await modal.evaluate(el=>el.parentElement===document.body)).toBe(true);
 await expect(row(page,'ob')).not.toHaveAttribute('aria-current','true');
 await modal.locator('[data-wd-close="wdModal"]').click();await expect(modal).toBeHidden();await expect(row(page,'oa')).toBeVisible();
 expect(await lastKeys(page)).toEqual([[`kptu_owner_cache:organization-last-v1:${owner}`,'ob']]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
});

test('PC 1280: an organization opened over another screen stays a dialog and goes back into the pane on the 담당조직 screen',async({page})=>{
 const {errors}=await fixture(page);
 await clickView(page,'team');await expect(title(page)).toHaveText('합성 가 지부');
 await clickView(page,'basket');await expect(page.locator('#wdModal')).toBeHidden();
 await page.evaluate(()=>window.KPTUWorkplace.open('oc'));
 const modal=page.locator('#wdModal');await expect(title(page)).toHaveText('합성 다 지부');
 await expect(modal).toHaveAttribute('aria-modal','true');expect(await modal.evaluate(el=>el.parentElement===document.body)).toBe(true);
 await modal.locator('[data-wd-close="wdModal"]').click();await expect(modal).toBeHidden();
 await clickView(page,'team');await expect(title(page)).toHaveText('합성 다 지부');await expect(pane(page).locator('#wdModal')).toBeVisible();
 expect(errors).toEqual([]);
});
