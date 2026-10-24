import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';
// UI-모바일업데이트겹쳐보기: on a phone a tapped record first comes up as a card over the detail; its full-open button continues as before.
const viaSheet=async page=>{if((page.viewportSize()?.width||0)>760)return;const sheet=page.locator('#kptuRecordSheet');await expect(sheet).toBeVisible();await sheet.locator('[data-record-sheet-full]').click()};
// UI-PC프로젝트좌우(2026-10-20 사용자 확정, 시안 A): PC(≥1024) 프로젝트 화면은 왼쪽 목록 + 오른쪽 상세(같은 상세 창을 칸에 옮겨 씀).
// 처음 열면 이 기기에서 마지막으로 본 프로젝트(저장 실패 시 맨 위). 761~1023px·폰은 지금처럼 목록 + 상세 창.
// 돌아오기: 상세의 🧺 기록 → 업데이트 화면의 "← (이름)으로 돌아가기"·뒤로 가기·탭 → 같은 프로젝트(담당조직)·같은 스크롤.
// 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z';
const note={id:'10000000-0000-4000-8000-0000000000aa',workspace_id:'w',kind:'basket',occurred_at:stamp,updated_at:stamp,raw_text:'합성 정리함 원문',ai_export_allowed:true,archived_at:null,attachments:[]};
const spaces=[
 {id:'pa',workspace_id:'w',owner_id:'home-test',name:'합성 정책 사업',status:'active',sort_order:10,metadata:{project_system:'v2',color:'green'}},
 {id:'pc',workspace_id:'w',owner_id:'home-test',name:'합성 하위 토론회',parent_id:'pa',status:'active',sort_order:20,metadata:{project_system:'v2'}},
 {id:'pb',workspace_id:'w',owner_id:'home-test',name:'합성 조직 사업',status:'active',sort_order:30,metadata:{project_system:'v2',color:'blue'}}
];
const day=i=>`2026-09-${String(30-i).padStart(2,'0')}`;
async function fixture(page,{width=1280,blockStorage=false}={}){
 await page.setViewportSize({width,height:800});
 if(blockStorage)await page.addInitScript(()=>{const deny=()=>{throw new DOMException('blocked','SecurityError')};const s=Storage.prototype,get=s.getItem,set=s.setItem;s.getItem=function(k){return String(k).includes('project-last')?deny():get.call(this,k)};s.setItem=function(k,v){return String(k).includes('project-last')?deny():set.call(this,k,v)}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await openHome(page);
 const state={spaces:structuredClone(spaces),patches:[],progress:Array.from({length:28},(_,i)=>({id:'pr-'+i,project_id:'pa',workstream_id:null,summary:'합성 기록 '+i,effective_on:day(i),created_at:day(i)+'T00:00:00Z'})),
  links:[{id:'l-p',workspace_id:'w',note_id:note.id,project_id:'pa',organization_id:null,status:'confirmed',summary:'합성 연결 요약'},{id:'l-o',workspace_id:'w',note_id:note.id,project_id:null,organization_id:'o',status:'confirmed',summary:'합성 조직 연결 요약'}]};
 const list=(route,rows)=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:rows.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||rows.length||1))})};
 await page.route(SB+'/rest/v1/app_spaces?**',route=>{
  const req=route.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='PATCH'){const id=q.get('id').slice(3),row=state.spaces.find(x=>x.id===id),body=req.postDataJSON();state.patches.push({id,body});Object.assign(row,body);return route.fulfill({json:[row]})}
  if(q.get('select')?.includes('milestones:'))return route.fulfill({json:state.spaces.map(x=>({id:x.id,milestones:[]}))});
  return route.fulfill({json:state.spaces});
 });
 await page.route(SB+'/rest/v1/app_project_progress_updates?**',route=>{const pid=new URL(route.request().url()).searchParams.get('project_id')?.slice(3);return list(route,state.progress.filter(x=>x.project_id===pid))});
 await page.route(SB+'/rest/v1/app_notes?**',route=>list(route,[note]));
 await page.route(SB+'/rest/v1/app_record_links?**',route=>{
  const q=new URL(route.request().url()).searchParams;if(q.has('google_task_id'))return route.fulfill({json:[]});
  let rows=state.links;for(const key of ['project_id','organization_id']){const v=q.get(key);if(v?.startsWith('in.('))rows=rows.filter(x=>v.slice(4,-1).split(',').includes(x[key]));}
  const v=q.get('note_id');if(v?.startsWith('eq.'))rows=rows.filter(x=>x.note_id===v.slice(3));
  return list(route,rows.map(row=>({...row,note,organization:{name:'테스트 조직'},project:{name:'합성 정책 사업'}})));
 });
 return {f,state,errors};
}
const pane=page=>page.locator('#ps3DetailPane');
const basketLine=page=>page.locator('#ps3Body [data-basket-link="l-p"] a[data-ps3-basket-note]');
// The record's place on screen: equal before and after a return means the same scroll.
const top=locator=>locator.evaluate(el=>Math.round(el.getBoundingClientRect().top));
// Back as the browser itself does it (the mouse back button, a browser-started traversal like the toolbar, PWA or Android back),
// next to page.goBack().
async function browserBack(page){const c=await page.context().newCDPSession(page);for(const type of ['mousePressed','mouseReleased'])await c.send('Input.dispatchMouseEvent',{type,x:1,y:1,button:'back',clickCount:1});await c.detach()}
const goBack=(page,how)=>how==='browser'?browserBack(page):page.goBack();
async function scrollToRecord(page,locator){
 await locator.evaluate(el=>{let n=el.parentElement;while(n&&!(n.scrollHeight>n.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(n).overflowY)))n=n.parentElement;(n||document.scrollingElement).scrollTop+=el.getBoundingClientRect().top-300});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r())));return top(locator);
}

test('PC 1280: list on the left, the first project on the right without a dialog; rows switch the pane and children stay indented',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'projects');
 await expectProjectTitle(page,'합성 정책 사업');
 const modal=page.locator('#ps3DetailModal');
 await expect(pane(page).locator('#ps3DetailModal')).toBeVisible();
 await expect(modal).toHaveAttribute('role','region');await expect(modal).not.toHaveAttribute('aria-modal','true');
 await expect(modal.locator('[data-ps3-close="ps3DetailModal"]')).toBeHidden();
 const list=await page.locator('#projectGrid .ps3-plist').boundingBox(),right=await pane(page).boundingBox();
 expect(right.x).toBeGreaterThanOrEqual(list.x+list.width);expect(Math.abs(right.y-list.y)).toBeLessThanOrEqual(1);
 // 좌 1/3 : 우 2/3(UI-좌우비율): 오른쪽 폭이 왼쪽의 2배 안팎(틈 포함).
 expect(Math.abs(right.width/list.width-2)).toBeLessThan(0.1);
 // UI-프로젝트칸폭: 상세가 칸 폭을 다 쓴다(창 가운데 맞춤이 상세를 좁은 가운데 열로 줄이지 않음).
 { const card=await modal.locator('.ps3-detail-card').boundingBox();expect(card.width).toBeGreaterThan(right.width-40);expect(card.width).toBeLessThanOrEqual(right.width); }
 // Children: indented under the parent, with the parent's color dot in the soft tone.
 const main=page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]'),child=page.locator('#projectGrid .ps3-plist [data-ps3-project="pc"]');
 const pad=el=>el.evaluate(n=>parseFloat(getComputedStyle(n).paddingLeft));expect(await pad(child)).toBeGreaterThan(await pad(main));
 await expect(child.locator('.ps3-color-dot')).toHaveAttribute('data-tone','soft');await expect(main.locator('.ps3-color-dot')).toHaveAttribute('data-color','green');
 await expect(main).toHaveAttribute('aria-current','true');
 // Detail parts: record input, progress, child projects, tasks, documents.
 for(const id of ['#ps3-progress [data-ps3-record-input]','#ps3-children','#ps3-tasks','#ps3-documents'])await expect(page.locator('#ps3Body '+id)).toBeVisible();
 // Another row: the pane changes, the URL is replaced (no history entry), the row shows the selection.
 const length=await page.evaluate(()=>history.length);
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="pb"]').click();await expectProjectTitle(page,'합성 조직 사업');
 await expect(page.locator('#projectGrid .ps3-plist [data-ps3-project="pb"]')).toHaveAttribute('aria-current','true');await expect(main).not.toHaveAttribute('aria-current','true');
 expect(await page.evaluate(()=>history.length)).toBe(length);expect(new URL(page.url()).searchParams.get('project')).toBe('pb');
 // "+ 프로젝트" is the small button height.
 expect((await page.locator('#newProjectBtn').boundingBox()).height).toBe(32);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 // Next time the projects screen opens on this device, the last project shows first.
 await clickView(page,'home');await expect(page.locator('#ps3DetailModal')).toBeHidden();
 await clickView(page,'projects');await expectProjectTitle(page,'합성 조직 사업');
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});await clickView(page,'projects');await expectProjectTitle(page,'합성 조직 사업');
 expect(state.patches).toEqual([]);expect(errors).toEqual([]);
});

test('PC 1280: a blocked browser storage still opens the first project',async({page})=>{
 const {errors}=await fixture(page,{blockStorage:true});
 await clickView(page,'projects');await expectProjectTitle(page,'합성 정책 사업');
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="pb"]').click();await expectProjectTitle(page,'합성 조직 사업');
 await clickView(page,'home');await clickView(page,'projects');await expectProjectTitle(page,'합성 정책 사업');expect(errors).toEqual([]);
});

test('PC 1280: the right pane keeps the detail actions — ⋯ (complete, edit, archive, delete), child list and parent link',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'projects');await expectProjectTitle(page,'합성 정책 사업');
 const more=page.locator('#ps3Menu details.ps3-more');await more.locator('summary').click();await expect(more).toHaveAttribute('open','');
 expect(await more.locator('.ps3-more-panel button').allTextContents()).toEqual(['완료','수정','아래로 접기','보관','삭제']);
 await more.locator('[data-ps3-toggle-done]').click();await expect.poll(()=>state.patches.map(p=>p.body.status)).toEqual(['done']);
 await expect(more.locator('[data-ps3-toggle-done]')).toHaveText('완료 취소');await expect(page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]')).toHaveAttribute('aria-current','true');
 await more.locator('summary').click();await expect(more).toHaveAttribute('open','');
 await more.locator('[data-ps3-edit-project]').click();await expect(page.locator('#ps3CreateModal')).toBeVisible();await expect(page.locator('#ps3CreateName')).toHaveValue('합성 정책 사업');
 await page.locator('[data-ps3-close="ps3CreateModal"]').click();await expect(page.locator('#ps3CreateModal')).toBeHidden();await expectProjectTitle(page,'합성 정책 사업');
 // Child list in the body → the child in the same pane; its parent link sits above the title.
 await page.locator('#ps3-children [data-ps3-project="pc"]').click();await expectProjectTitle(page,'합성 하위 토론회');
 await expect(page.locator('#ps3Hierarchy .ps3-parent-link')).toHaveText('← 합성 정책 사업');await expect(page.locator('#projectGrid .ps3-plist [data-ps3-project="pc"]')).toHaveAttribute('aria-current','true');
 await page.locator('#ps3Hierarchy .ps3-parent-link').click();await expectProjectTitle(page,'합성 정책 사업');
 await expect(pane(page).locator('#ps3DetailModal')).toBeVisible();expect(errors).toEqual([]);
});

test('PC 1280: a 🧺 record opens the update with "← (project)으로 돌아가기"; the button and back return to the same project and scroll',async({page})=>{
 const {errors}=await fixture(page);
 await clickView(page,'projects');await expectProjectTitle(page,'합성 정책 사업');
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="pb"]').click();await expectProjectTitle(page,'합성 조직 사업');
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]').click();await expectProjectTitle(page,'합성 정책 사업');
 const before=await scrollToRecord(page,basketLine(page));expect(await pane(page).evaluate(el=>el.scrollTop)).toBeGreaterThan(100);
 for(const how of ['button','back','browser']){
  await basketLine(page).click();await viaSheet(page);
  await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('basket');await expect(page.locator('[data-basket-text]')).toHaveValue(note.raw_text);
  const back=page.locator('#basketView [data-basket-return]');await expect(back).toHaveText('← 합성 정책 사업으로 돌아가기');
  if(how==='button')await back.click();else await goBack(page,how);
  await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('projects');await expectProjectTitle(page,'합성 정책 사업');
  await expect(pane(page).locator('#ps3DetailModal')).toBeVisible();await expect.poll(()=>top(basketLine(page))).toBe(before);
 }
 // A note opened from the basket list itself has no return line.
 await clickView(page,'basket');await page.locator('[data-basket-filter="classified"]').click();await page.locator(`[data-basket-row="${note.id}"]`).click();await expect(page.locator('[data-basket-text]')).toHaveValue(note.raw_text);
 await expect(page.locator('#basketView [data-basket-return]')).toHaveCount(0);
 // …and its back stays the basket list, as before.
 for(const how of ['back','browser']){
  if(how==='browser'){await page.locator(`[data-basket-row="${note.id}"]`).click();await expect(page.locator('[data-basket-text]')).toHaveValue(note.raw_text)}
  await goBack(page,how);await expect(page.locator('[data-basket-text]')).toBeHidden();await expect(page.locator(`[data-basket-row="${note.id}"]`)).toBeVisible();
  expect(await page.evaluate(()=>KPTURouter.current)).toBe('basket');
 }
 expect(errors).toEqual([]);
});

test('phone 390: list and detail dialog stay; the update shows "← 프로젝트로 돌아가기" and the button or back reopen the project at the same scroll',async({page})=>{
 const {errors}=await fixture(page,{width:390});
 await clickView(page,'projects');await expect(page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]')).toBeVisible();
 await expect(pane(page)).toBeHidden();await expect(page.locator('#ps3DetailModal')).toBeHidden();
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]').click();await expectProjectTitle(page,'합성 정책 사업');
 const modal=page.locator('#ps3DetailModal');await expect(modal).toHaveAttribute('aria-modal','true');await expect(modal).toHaveAttribute('role','dialog');
 expect(await modal.evaluate(el=>el.parentElement===document.body)).toBe(true);
 const before=await scrollToRecord(page,basketLine(page));
 for(const how of ['button','back','browser']){
  await basketLine(page).click();await viaSheet(page);
  await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('basket');await expect(page.locator('[data-basket-text]')).toHaveValue(note.raw_text);
  const back=page.locator('#basketView [data-basket-return]');await expect(back).toHaveText('← 프로젝트로 돌아가기');
  const b=await back.boundingBox();expect(b.height).toBeGreaterThanOrEqual(44);
  if(how==='button')await back.click();else await goBack(page,how);
  await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('projects');await expect(modal).toBeVisible();await expectProjectTitle(page,'합성 정책 사업');
  await expect(modal).toHaveAttribute('aria-modal','true');await expect.poll(()=>top(basketLine(page))).toBe(before);
 }
 // The dialog still closes with × and back, back to the list.
 await modal.locator('[data-ps3-close="ps3DetailModal"]').click();await expect(modal).toBeHidden();await expect(page.locator('#projectGrid .ps3-plist')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
});

test('PC 1024: the list keeps its minimum width, the pane takes the rest, nothing overflows sideways',async({page})=>{
 const {errors}=await fixture(page,{width:1024});
 await clickView(page,'projects');await expectProjectTitle(page,'합성 정책 사업');
 const list=await page.locator('#projectGrid .ps3-plist').boundingBox(),right=await pane(page).boundingBox();
 expect(list.width).toBeGreaterThanOrEqual(239);expect(right.width).toBeGreaterThan(list.width);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
});

test('middle width 900: list with the detail dialog as before (no pane, no auto-open)',async({page})=>{
 const {errors}=await fixture(page,{width:900});
 await clickView(page,'projects');await expect(page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]')).toBeVisible();
 await expect(pane(page)).toBeHidden();await expect(page.locator('#ps3DetailModal')).toBeHidden();
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]').click();await expect(page.locator('#ps3DetailModal')).toHaveAttribute('aria-modal','true');
 await page.locator('[data-ps3-close="ps3DetailModal"]').click();await expect(page.locator('#ps3DetailModal')).toBeHidden();expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`organization ${width}: a 🧺 record returns to the same organization at the same scroll`,async({page})=>{
 const {errors}=await fixture(page,{width});
 await clickView(page,'team');await page.locator('[data-ps-workplace-org="o"]').first().click();
 const modal=page.locator('#wdModal'),line=modal.locator('[data-basket-link="l-o"] a[data-basket-link-open]');await expect(line).toBeVisible();
 const before=await scrollToRecord(page,line);
 for(const how of ['button','back','browser']){
  await line.click();await viaSheet(page);await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('basket');await expect(page.locator('[data-basket-text]')).toHaveValue(note.raw_text);
  await expect(page.locator('#basketView [data-basket-return]')).toHaveText(width<761?'← 담당조직으로 돌아가기':'← 테스트 조직으로 돌아가기');
  if(how==='button')await page.locator('#basketView [data-basket-return]').click();else await goBack(page,how);
  await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('team');await expect(modal).toBeVisible();await expect(page.locator('#wdTitle')).toHaveText('테스트 조직');
  await expect.poll(()=>top(line)).toBe(before);
 }
 expect(errors).toEqual([]);
});
