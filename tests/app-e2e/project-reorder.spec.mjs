import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// PRJ-순서바꾸기 (2026-10-21 요청함 01:01·01:10 승인): 같은 상위 아래 형제끼리 순서를 바꾼다. PC는 프로젝트 목록에서 끌어다 놓기,
// 폰(과 PC)은 ⋯ 안 "위로·아래로". 저장은 기존 app_spaces.sort_order(소유자 PATCH, DB 변경 없음). 정한 순서는 프로젝트 화면·
// 기록할 곳·할 일 연결·업무일지·주간 정리(한글 파일)가 모두 같은 목록(project-catalog.js)에서 읽는다. 순서 규칙과 업무일지·주간 정리
// 묶음 순서는 tests/project-order.test.mjs. 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z';
const at=n=>`2026-09-0${n}T00:00:00Z`;
const spaces=[
 // Read order differs from sort_order on purpose: the screen sorts, not the read.
 {id:'pb',workspace_id:'w',owner_id:'home-test',name:'합성 조직 사업',status:'active',sort_order:30,created_at:at(3),metadata:{project_system:'v2',color:'blue'}},
 {id:'pa',workspace_id:'w',owner_id:'home-test',name:'합성 정책 사업',status:'active',sort_order:10,created_at:at(1),metadata:{project_system:'v2',color:'green'}},
 {id:'pc',workspace_id:'w',owner_id:'home-test',name:'합성 하위 토론회',parent_id:'pa',status:'active',sort_order:20,created_at:at(2),metadata:{project_system:'v2'}},
 {id:'pg',workspace_id:'w',owner_id:'home-test',name:'합성 하위 설명회',parent_id:'pa',status:'active',sort_order:60,created_at:at(6),metadata:{project_system:'v2'}},
 {id:'pd',workspace_id:'w',owner_id:'home-test',name:'합성 세부 사안',parent_id:'pc',status:'active',sort_order:25,created_at:at(2),metadata:{project_system:'v2'}},
 {id:'pe',workspace_id:'w',owner_id:'home-test',name:'합성 교섭 사업',status:'active',sort_order:40,created_at:at(4),metadata:{project_system:'v2',color:'orange'}},
];
const SHOT=process.env.PRJ_ORDER_SHOTS||'';
async function fixture(page,{width=1280,height=800,failPatch=false}={}){
 await page.setViewportSize({width,height});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const state={spaces:structuredClone(spaces),writes:[]};
 await page.route(SB+'/rest/v1/app_spaces**',route=>{
  const req=route.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='PATCH'){
   const id=q.get('id').slice(3),body=req.postDataJSON();state.writes.push({id,owner:q.get('owner_id'),body});
   if(failPatch)return route.fulfill({status:500,json:{message:'synthetic failure'}});
   const row=state.spaces.find(x=>x.id===id);Object.assign(row,body);return route.fulfill({json:[row]})
  }
  if(q.get('select')?.includes('milestones:'))return route.fulfill({json:state.spaces.map(x=>({id:x.id,milestones:[]}))});
  return route.fulfill({json:state.spaces});
 });
 await page.route(SB+'/rest/v1/app_project_modules**',route=>route.fulfill({json:[]}));
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 return {state,errors};
}
const listIds=page=>page.locator('#projectGrid .ps3-plist [data-ps3-project]').evaluateAll(xs=>xs.map(x=>x.dataset.ps3Project));
const row=(page,id)=>page.locator(`#projectGrid .ps3-plist [data-ps3-project="${id}"]`);
const title=page=>page.locator('#ps3Title');
const catalogIds=page=>page.evaluate(()=>KPTUProjectCatalog.snapshot().tree.map(x=>x.project.id));
const optionIds=page=>page.evaluate(()=>{const d=document.createElement('select');d.innerHTML=KPTUProjectCatalog.options('',false);return [...d.options].map(o=>o.value)});

test('PC 1280: drag a row onto a sibling saves sort_order and every list shows the new order; a non-sibling drop does nothing',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'projects');await expect(title(page)).toHaveText('합성 정책 사업');
 expect(await listIds(page)).toEqual(['pa','pc','pd','pg','pb','pe']);
 await expect(row(page,'pa')).toHaveAttribute('draggable','true');await expect(row(page,'pd')).not.toHaveAttribute('draggable','true');
 // 1단 교섭 사업 → before 정책 사업 (upper half of the row).
 await row(page,'pe').dragTo(row(page,'pa'),{targetPosition:{x:40,y:4}});
 await expect.poll(()=>listIds(page)).toEqual(['pe','pa','pc','pd','pg','pb']);
 expect(state.writes.map(w=>[w.id,w.body])).toEqual([['pe',{sort_order:10}],['pa',{sort_order:20}]]);
 expect(state.writes.every(w=>w.owner==='eq.home-test'&&!('parent_id' in w.body))).toBe(true);
 // 2단 설명회 → before 토론회 (siblings under 정책 사업); the 3단 사안 stays under 토론회.
 await row(page,'pg').dragTo(row(page,'pc'),{targetPosition:{x:40,y:4}});
 await expect.poll(()=>listIds(page)).toEqual(['pe','pa','pg','pc','pd','pb']);
 if(SHOT)await page.screenshot({path:SHOT+'/prj-order-pc-1280.png'});
 // Not siblings: 2단 onto 1단, and 1단 onto 2단 — nothing is written.
 const before=state.writes.length;
 await row(page,'pc').dragTo(row(page,'pb'),{targetPosition:{x:40,y:4}});
 await row(page,'pb').dragTo(row(page,'pg'),{targetPosition:{x:40,y:30}});
 await page.waitForTimeout(300);expect(state.writes.length).toBe(before);expect(await listIds(page)).toEqual(['pe','pa','pg','pc','pd','pb']);
 // The same order everywhere the catalog is read: tree, selects (자료실·회의 등), the 업무 picker.
 expect(await catalogIds(page)).toEqual(['pe','pa','pg','pc','pd','pb']);
 expect(await optionIds(page)).toEqual(['pe','pa','pg','pc','pd','pb']);
 // After a reload (the read order unchanged), the saved numbers keep the order.
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 await clickView(page,'projects');await expect.poll(()=>listIds(page)).toEqual(['pe','pa','pg','pc','pd','pb']);
 expect(errors).toEqual([]);
});

test('phone 390: ⋯ 위로·아래로 move among siblings, stay open, and switch off at the ends',async({page})=>{
 const {state,errors}=await fixture(page,{width:390,height:844});
 await clickView(page,'projects');await row(page,'pb').click();await expect(title(page)).toHaveText('합성 조직 사업');
 const more=page.locator('#ps3Menu details.ps3-more');await more.locator('summary').click();
 await expect(more.locator('[data-ps3-move-project]')).toHaveText(['위로','아래로']);
 if(SHOT)await page.screenshot({path:SHOT+'/prj-order-phone-390-menu.png'});
 await more.locator('[data-ps3-move-project="-1"]').click();
 await expect.poll(()=>catalogIds(page)).toEqual(['pb','pa','pc','pd','pg','pe']);
 expect(state.writes.map(w=>[w.id,w.body.sort_order])).toEqual([['pb',10],['pa',20],['pe',30]]);
 // Still open; a second 위로 reaches the top and 위로 turns off there.
 await expect(more).toHaveAttribute('open','');await expect(more.locator('[data-ps3-move-project="-1"]')).toBeDisabled();
 await more.locator('[data-ps3-move-project="1"]').click();
 await expect.poll(()=>catalogIds(page)).toEqual(['pa','pc','pd','pg','pb','pe']);
 await more.locator('[data-ps3-move-project="1"]').click();
 await expect.poll(()=>catalogIds(page)).toEqual(['pa','pc','pd','pg','pe','pb']);
 await expect(more.locator('[data-ps3-move-project="1"]')).toBeDisabled();await expect(more.locator('[data-ps3-move-project="-1"]')).toBeEnabled();
 // A 3단 with no sibling has no 위로·아래로; the phone list rows are not draggable.
 await expect(row(page,'pa')).not.toHaveAttribute('draggable','true');
 await page.evaluate(()=>KPTUProjects.open('pd'));await expect(title(page)).toHaveText('합성 세부 사안');
 await more.locator('summary').click();await expect(more.locator('[data-ps3-move-project]')).toHaveCount(0);
 if(SHOT)await page.screenshot({path:SHOT+'/prj-order-phone-390-after.png'});
 expect(state.writes.every(w=>!('parent_id' in w.body))).toBe(true);
 expect(errors).toEqual([]);
});

test('phone 390: a failed save says so and keeps the old order',async({page})=>{
 const {state,errors}=await fixture(page,{width:390,height:844,failPatch:true});
 await clickView(page,'projects');await row(page,'pe').click();
 const more=page.locator('#ps3Menu details.ps3-more');await more.locator('summary').click();
 await more.locator('[data-ps3-move-project="-1"]').click();
 await expect(page.locator('#toast')).toHaveText('순서를 저장하지 못했어요. 다시 해 주세요.');
 expect(state.writes.length).toBe(1);expect(await catalogIds(page)).toEqual(['pa','pc','pd','pg','pb','pe']);
 expect(errors).toEqual([]);
});

const taskLinkIds=async page=>{
 await page.waitForFunction(()=>window.KPTUGoogleTasks?.openEditor);await page.evaluate(()=>window.KPTUGoogleTasks.openEditor());
 const body=page.locator('#gtEditLinkBody');await expect(body.locator('input[value^="p:"]').first()).toBeVisible();
 const ids=await body.locator('input[value^="p:"]').evaluateAll(xs=>xs.map(x=>x.value.slice(2)));
 await page.keyboard.press('Escape');await expect(body).toBeHidden();return ids;
};
test('PC 1280: 기록할 곳 (home [업데이트]) and 할 일 연결 list projects in the order set on the project screen',async({page})=>{
 const {errors}=await fixture(page);
 // 할 일 연결 read once before the move (its list is kept for the visit): it must not keep the old order.
 expect(await taskLinkIds(page)).toEqual(['pa','pc','pd','pg','pb','pe']);
 await clickView(page,'projects');await expect(title(page)).toHaveText('합성 정책 사업');
 await row(page,'pe').dragTo(row(page,'pa'),{targetPosition:{x:40,y:4}});
 await expect.poll(()=>listIds(page)).toEqual(['pe','pa','pc','pd','pg','pb']);
 await clickView(page,'home');
 const q=page.locator('#homeView [data-home-quick]');await q.locator('[data-quick-mode="update"]').click();await q.locator('[data-quick-input]').fill('QA');
 await q.locator('[data-quick-org]').click();const sheet=page.getByRole('dialog');await expect(sheet).toBeVisible();
 const ids=await sheet.locator('[data-sheet-value^="project:"]').evaluateAll(xs=>xs.map(x=>x.dataset.sheetValue.slice(8)));
 expect(ids).toEqual(['pe','pa','pc','pd','pg','pb']);
 if(SHOT)await page.screenshot({path:SHOT+'/prj-order-place-sheet-1280.png'});
 await page.keyboard.press('Escape');await expect(sheet).toBeHidden();
 expect(await taskLinkIds(page)).toEqual(['pe','pa','pc','pd','pg','pb']);
 expect(errors).toEqual([]);
});
