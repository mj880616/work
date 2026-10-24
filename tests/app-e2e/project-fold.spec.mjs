import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';
// PRJ-목록접어두기 (2026-10-24 요청함 15:00 명진 승인 시안): 잘 안 여는 프로젝트를 목록 맨 아래 '▸ 접어 둔 것 n' 한 줄로 접는다.
// 저장은 기존 app_spaces.metadata.folded(소유자 PATCH, DB 변경 없음) — 폰·PC 같게. 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at=n=>`2026-09-0${n}T00:00:00Z`;
const spaces=[
 {id:'pb',workspace_id:'w',owner_id:'home-test',name:'합성 조직 사업',status:'active',sort_order:30,created_at:at(3),metadata:{project_system:'v2',color:'blue'}},
 {id:'pa',workspace_id:'w',owner_id:'home-test',name:'합성 정책 사업',status:'active',sort_order:10,created_at:at(1),metadata:{project_system:'v2',color:'green'}},
 {id:'pc',workspace_id:'w',owner_id:'home-test',name:'합성 하위 토론회',parent_id:'pa',status:'active',sort_order:20,created_at:at(2),metadata:{project_system:'v2'}},
 {id:'pg',workspace_id:'w',owner_id:'home-test',name:'합성 하위 설명회',parent_id:'pa',status:'active',sort_order:60,created_at:at(6),metadata:{project_system:'v2'}},
 {id:'pd',workspace_id:'w',owner_id:'home-test',name:'합성 세부 사안',parent_id:'pc',status:'active',sort_order:25,created_at:at(2),metadata:{project_system:'v2'}},
 {id:'pe',workspace_id:'w',owner_id:'home-test',name:'합성 교섭 사업',status:'active',sort_order:40,created_at:at(4),metadata:{project_system:'v2',color:'orange'}},
];
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
const menu=page=>page.locator('#ps3FoldMenu');
// Wait until the previous menu is fully closed (it closes through history), then right-click; retry once the list has re-rendered under the pointer.
const openMenu=async(page,id)=>{await expect(menu(page)).toBeHidden();await expect(async()=>{await row(page,id).click({button:'right'});await expect(menu(page)).toBeVisible({timeout:700})}).toPass({timeout:10000})};
const optionIds=page=>page.evaluate(()=>{const d=document.createElement('select');d.innerHTML=KPTUProjectCatalog.options('',false);return [...d.options].map(o=>({v:o.value,dim:o.classList.contains('kptu-folded-option')}))});
const foldWrites=state=>state.writes.map(w=>[w.id,w.body.metadata.folded===true]);

test('PC 1280: right-click folds a project to the bottom line, opens dimmed, and 다시 위로 returns it; saved on the server',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'projects');await expectProjectTitle(page,'합성 정책 사업');
 await expect(page.locator('#projectGrid .ps3-plist .ps3-fold')).toHaveCount(0);
 await openMenu(page,'pe');
 await expect(menu(page).locator('button')).toHaveText(['아래로 접기']);
 await menu(page).locator('[data-ps3-fold-action="fold"]').click();
 await expect.poll(()=>foldWrites(state)).toEqual([['pe',true]]);
 expect(state.writes[0].owner).toBe('eq.home-test');
 expect(state.writes[0].body.metadata).toEqual({project_system:'v2',color:'orange',folded:true});
 await expect(page.locator('.ps3-fold-label')).toHaveText('접어 둔 것 1');
 await expect(page.locator('.ps3-fold-names')).toHaveText('· 합성 교섭 사업');
 await expect(row(page,'pe')).toBeHidden();
 // The list keeps every project: the folded one only moved to the bottom group.
 expect((await listIds(page)).sort()).toEqual(['pa','pb','pc','pd','pe','pg']);
 await page.locator('.ps3-fold-summary').click();
 await expect(row(page,'pe')).toBeVisible();
 expect(Number(await row(page,'pe').evaluate(el=>getComputedStyle(el.closest('.ps3-fold-body')).opacity))).toBeLessThan(1);
 // Pick lists (연결 고르기) keep it, at the bottom and dimmed.
 expect(await optionIds(page)).toEqual([{v:'pa',dim:false},{v:'pc',dim:false},{v:'pd',dim:false},{v:'pg',dim:false},{v:'pb',dim:false},{v:'pe',dim:true}]);
 await row(page,'pe').click();await expectProjectTitle(page,'합성 교섭 사업');
 // The detail ⋯ menu offers 다시 위로 for the same project.
 await openMenu(page,'pe');
 await menu(page).locator('[data-ps3-fold-action="unfold"]').click();
 await expect.poll(()=>foldWrites(state)).toEqual([['pe',true],['pe',false]]);
 expect(state.writes[1].body.metadata).toEqual({project_system:'v2',color:'orange'});
 await expect(page.locator('#projectGrid .ps3-plist .ps3-fold')).toHaveCount(0);
 expect(await listIds(page)).toEqual(['pa','pc','pd','pg','pb','pe']);
 expect(errors).toEqual([]);
});

test('PC 1280: folding a big project folds its children with it; one child can be folded alone; the saved state survives a reload',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'projects');await expectProjectTitle(page,'합성 정책 사업');
 await openMenu(page,'pg');
 await menu(page).locator('[data-ps3-fold-action="fold"]').click();
 await expect.poll(()=>foldWrites(state)).toEqual([['pg',true]]);
 await expect(page.locator('.ps3-fold-label')).toHaveText('접어 둔 것 1');
 await openMenu(page,'pa');
 await menu(page).locator('[data-ps3-fold-action="fold"]').click();
 await expect.poll(()=>foldWrites(state)).toEqual([['pg',true],['pa',true]]);
 // Only the head names are listed; every child of 정책 사업 sits in the folded group.
 await expect(page.locator('.ps3-fold-label')).toHaveText('접어 둔 것 1');
 expect(await page.locator('#projectGrid .ps3-fold-body [data-ps3-project]').evaluateAll(xs=>xs.map(x=>x.dataset.ps3Project))).toEqual(['pa','pc','pd','pg']);
 expect((await optionIds(page)).map(o=>o.v)).toEqual(['pb','pe','pa','pc','pd','pg']);
 // A child folded only because its parent is folded has no 다시 위로 of its own (the parent brings all back).
 await page.locator('.ps3-fold-summary').click();
 await row(page,'pc').click({button:'right'});
 await expect(menu(page)).toBeHidden();
 // The server rows now carry the flag, so a reload shows the same folded list.
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 await clickView(page,'projects');
 await expect(page.locator('.ps3-fold-label')).toHaveText('접어 둔 것 1');
 expect(errors).toEqual([]);
});

test('phone 390: long press opens the menu (fold and 순서 바꾸기), a short tap still opens the project, 순서 바꾸기 is a small text button',async({page})=>{
 const {state,errors}=await fixture(page,{width:390,height:844});
 await clickView(page,'projects');
 const toggle=page.locator('#ps3OrderBtn');await expect(toggle).toHaveText('순서 바꾸기');
 expect((await toggle.boundingBox()).height).toBeLessThan(24);
 expect((await row(page,'pb').boundingBox()).height).toBeLessThanOrEqual(44);
 await row(page,'pb').dispatchEvent('pointerdown',{pointerType:'touch',clientX:50,clientY:300,button:0});
 await expect(menu(page).locator('button')).toHaveText(['아래로 접기','순서 바꾸기'],{timeout:3000});
 await menu(page).locator('[data-ps3-fold-action="fold"]').click();
 await expect.poll(()=>foldWrites(state)).toEqual([['pb',true]]);
 await expect(page.locator('.ps3-fold-label')).toHaveText('접어 둔 것 1');
 // The same long press on a moved finger (swipe) does nothing.
 await row(page,'pe').dispatchEvent('pointerdown',{pointerType:'touch',clientX:50,clientY:300,button:0});
 await row(page,'pe').dispatchEvent('pointermove',{pointerType:'touch',clientX:120,clientY:300});
 await page.waitForTimeout(700);await expect(menu(page)).toBeHidden();
 // Folded rows can be reordered among themselves in 순서 바꾸기 mode.
 await row(page,'pe').dispatchEvent('pointerdown',{pointerType:'touch',clientX:50,clientY:300,button:0});
 await menu(page).locator('[data-ps3-fold-action="fold"]').click();
 await expect.poll(()=>foldWrites(state)).toEqual([['pb',true],['pe',true]]);
 await toggle.click();await expect(toggle).toHaveText('완료');
 await page.locator('.ps3-fold-summary').click();
 await expect(page.locator('#projectGrid .ps3-fold-body [data-ps3-order-row]')).toHaveCount(2);
 await page.locator('#projectGrid .ps3-fold-body [data-ps3-order-row="pe"] [data-ps3-order-move="-1"]').click();
 await expect.poll(()=>state.writes.filter(w=>'sort_order' in w.body).map(w=>[w.id,w.body.sort_order])).toEqual([['pe',20]]);
 expect(errors).toEqual([]);
});
