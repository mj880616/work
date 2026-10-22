import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// PRJ-3단(docs/design/project-3-levels.md, 2026-10-21 승인: 최대 3단). 2단 제한은 화면에만 있었다(사실). 이제 화면이 3단(상위 → 하위 → 그 아래)까지
// 허용하고 4단 이상·자기 자신·자기 아래로 옮기기는 화면에서 막는다(DB 트리거는 이번에 넣지 않음). 깊어진 단계 표시: 프로젝트 목록 들여쓰기 트리,
// 3단 상세는 하위 칸 없음, 기록할 곳 창은 검색으로 걸러질 때만 "1단 › 2단", 자료실 "세부" 줄에 2·3단 함께(큰 프로젝트를 고르면 아래 자료도 함께).
// 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z';
const spaces=[
 {id:'pa',workspace_id:'w',owner_id:'home-test',name:'합성 정책 사업',status:'active',sort_order:10,metadata:{project_system:'v2',color:'green'}},
 {id:'pc',workspace_id:'w',owner_id:'home-test',name:'합성 하위 토론회',parent_id:'pa',status:'active',sort_order:20,metadata:{project_system:'v2'}},
 {id:'pd',workspace_id:'w',owner_id:'home-test',name:'합성 세부 사안',parent_id:'pc',status:'active',sort_order:25,metadata:{project_system:'v2'}},
 {id:'pb',workspace_id:'w',owner_id:'home-test',name:'합성 조직 사업',status:'active',sort_order:30,metadata:{project_system:'v2',color:'blue'}},
 {id:'pe',workspace_id:'w',owner_id:'home-test',name:'합성 교섭 사업',status:'active',sort_order:40,metadata:{project_system:'v2',color:'orange'}},
 {id:'pf',workspace_id:'w',owner_id:'home-test',name:'합성 교섭 준비',parent_id:'pe',status:'active',sort_order:50,metadata:{project_system:'v2'}}
];
const docs=[['d-a','pa','합성 큰 자료'],['d-c','pc','합성 하위 자료'],['d-d','pd','합성 사안 자료'],['d-b','pb','합성 다른 자료']].map(([id,project_id,title])=>({id,workspace_id:'w',project_id,title,category:'정책자료',tags:[],created_at:stamp,document_date:'2026-09-15'}));
async function fixture(page,{width=1280}={}){
 await page.setViewportSize({width,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const state={spaces:structuredClone(spaces),writes:[]};
 await page.route(SB+'/rest/v1/app_spaces**',route=>{
  const req=route.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='PATCH'){const id=q.get('id').slice(3),row=state.spaces.find(x=>x.id===id),body=req.postDataJSON();state.writes.push({method:'PATCH',id,body});Object.assign(row,body);return route.fulfill({json:[row]})}
  if(req.method()==='POST'){const body=req.postDataJSON(),row={...body,id:'p-new-'+state.spaces.length,created_at:stamp,updated_at:stamp};state.writes.push({method:'POST',body});state.spaces.push(row);return route.fulfill({json:[row]})}
  if(q.get('select')?.includes('milestones:'))return route.fulfill({json:state.spaces.map(x=>({id:x.id,milestones:[]}))});
  return route.fulfill({json:state.spaces});
 });
 await page.route(SB+'/rest/v1/app_project_modules**',route=>{const req=route.request();if(req.method()!=='POST')return route.fulfill({json:[]});return route.fulfill({json:req.postDataJSON().map((x,i)=>({...x,id:'m-'+i}))})});
 await page.route(SB+'/rest/v1/app_documents?**',route=>{const q=new URL(route.request().url()).searchParams,pid=q.get('project_id');return route.fulfill({json:pid?.startsWith('eq.')?docs.filter(d=>d.project_id===pid.slice(3)):pid?.startsWith('in.(')?docs.filter(d=>pid.slice(4,-1).split(',').includes(d.project_id)):docs})});
 // The home read its own projects at sign-in; read again with these routes.
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 return {state,errors};
}
const title=page=>page.locator('#ps3Title');
const row=(page,id)=>page.locator(`#projectGrid .ps3-plist [data-ps3-project="${id}"]`);
const pad=el=>el.evaluate(n=>parseFloat(getComputedStyle(n).paddingLeft));
const size=el=>el.evaluate(n=>parseFloat(getComputedStyle(n.querySelector('.kptu-list-name')).fontSize));
const parentValues=page=>page.locator('#ps3CreateParent option').evaluateAll(xs=>xs.map(x=>x.value));
async function openEdit(page,id){
 await row(page,id).click();await expect(page.locator('#ps3Body')).toHaveAttribute('data-project',id);
 const more=page.locator('#ps3Menu details.ps3-more');await more.locator('summary').click();await more.locator('[data-ps3-edit-project]').click();
 await expect(page.locator('#ps3CreateModal')).toBeVisible();
}
// A parent the list does not offer, forced into the select (a stale or crafted choice): the save is refused before any write.
async function forceParent(page,id){await page.locator('#ps3CreateParent').evaluate((el,v)=>{el.add(new Option('강제 선택',v));el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))},id)}

test('PC 1280: the list is an indented tree to the third level; the third level has no child list and a two-step parent line',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'projects');await expect(title(page)).toHaveText('합성 정책 사업');
 await expect(page.locator('#projectGrid .ps3-plist [data-ps3-project]')).toHaveCount(6);
 await expect(row(page,'pc')).toHaveAttribute('data-ps3-depth','1');await expect(row(page,'pd')).toHaveAttribute('data-ps3-depth','2');
 // Tree order: the third level right under its parent.
 expect(await page.locator('#projectGrid .ps3-plist [data-ps3-project]').evaluateAll(xs=>xs.map(x=>x.dataset.ps3Project))).toEqual(['pa','pc','pd','pb','pe','pf']);
 expect(await pad(row(page,'pd'))).toBeGreaterThan(await pad(row(page,'pc')));expect(await pad(row(page,'pc'))).toBeGreaterThan(await pad(row(page,'pa')));
 expect(await size(row(page,'pd'))).toBeLessThan(await size(row(page,'pc')));
 // Every level under a main project shows its color in the soft tone.
 for(const id of ['pc','pd']){await expect(row(page,id).locator('.ps3-color-dot')).toHaveAttribute('data-color','green');await expect(row(page,id).locator('.ps3-color-dot')).toHaveAttribute('data-tone','soft')}
 // Second level: child list with + and the third level in it; "하위 1" in the summary.
 await row(page,'pc').click();await expect(title(page)).toHaveText('합성 하위 토론회');
 await expect(page.locator('#ps3-children [data-ps3-project="pd"]')).toBeVisible();await expect(page.locator('#ps3-children [data-ps3-child]')).toBeVisible();
 await expect(page.locator('#ps3Summary')).toContainText('하위 1');
 // Third level: no child list, no "하위", the parent line is 1단 › 2단 and each part opens that project.
 await page.locator('#ps3-children [data-ps3-project="pd"]').click();await expect(title(page)).toHaveText('합성 세부 사안');
 await expect(page.locator('#ps3-children')).toHaveCount(0);await expect(page.locator('#ps3Summary')).not.toContainText('하위');
 await expect(page.locator('#ps3Hierarchy .ps3-parent-link')).toHaveText(['← 합성 정책 사업','합성 하위 토론회']);
 await expect(page.locator('#ps3Title .ps3-color-dot')).toHaveAttribute('data-tone','soft');
 await page.locator('#ps3Hierarchy .ps3-parent-link').nth(1).click();await expect(title(page)).toHaveText('합성 하위 토론회');
 await page.locator('#ps3Hierarchy .ps3-parent-link').first().click();await expect(title(page)).toHaveText('합성 정책 사업');
 // A main project counts every level under it before delete.
 const more=page.locator('#ps3Menu details.ps3-more');await more.locator('summary').click();await more.locator('[data-ps3-delete-project]').click();
 await expect(page.locator('#ps3DeleteMessage')).toContainText('하위 프로젝트 2개');
 expect(state.writes).toEqual([]);expect(errors).toEqual([]);
});

test('PC 1280: a third level is made from the second level’s +; the parent list offers only the first two levels',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'projects');await row(page,'pf').click();await expect(title(page)).toHaveText('합성 교섭 준비');
 await page.locator('#ps3-children [data-ps3-child]').click();await expect(page.locator('#ps3CreateModal')).toBeVisible();
 await expect(page.locator('#ps3CreateParent')).toHaveValue('pf');
 // First and second levels, in tree order; never a third level (that would make a fourth).
 expect(await parentValues(page)).toEqual(['','pa','pc','pb','pe','pf']);
 expect(await page.locator('#ps3CreateParent option[value="pc"]').getAttribute('data-depth')).toBe('1');
 await page.locator('#ps3CreateName').fill('합성 교섭 사안');await page.locator('#ps3CreateSave').click();
 await expect.poll(()=>state.writes.filter(x=>x.method==='POST').length).toBe(1);
 expect(state.writes[0].body.parent_id).toBe('pf');
 await expect(title(page)).toHaveText('합성 교섭 사안');await expect(page.locator('#ps3-children')).toHaveCount(0);
 await expect(row(page,'p-new-6')).toHaveAttribute('data-ps3-depth','2');
 expect(errors).toEqual([]);
});

test('PC 1280: moves that would make a fourth level or a cycle are not offered and are refused on save',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'projects');await expect(title(page)).toHaveText('합성 정책 사업');
 // A main project with two levels under it can go nowhere but the top.
 await openEdit(page,'pa');expect(await parentValues(page)).toEqual(['']);
 // Under its own grandchild (a cycle): refused, nothing written.
 await forceParent(page,'pd');await page.locator('#ps3CreateSave').click();
 await expect(page.locator('#ps3CreateStatus')).toHaveText('자기 자신이나 그 아래 프로젝트 밑으로는 옮길 수 없어요.');
 await page.locator('[data-ps3-close="ps3CreateModal"]').click();await expect(page.locator('#ps3CreateModal')).toBeHidden();
 // A main project with one level under it: only under another main project (it becomes 2단 + 3단).
 await openEdit(page,'pe');expect(await parentValues(page)).toEqual(['','pa','pb']);
 await forceParent(page,'pc');await page.locator('#ps3CreateSave').click();
 await expect(page.locator('#ps3CreateStatus')).toHaveText('프로젝트는 3단까지만 둘 수 있어요.');
 await page.locator('[data-ps3-close="ps3CreateModal"]').click();
 // A third level keeps its parent; it may move up to the top or under another first or second level.
 await openEdit(page,'pd');await expect(page.locator('#ps3CreateParent')).toHaveValue('pc');expect(await parentValues(page)).toEqual(['','pa','pc','pb','pe','pf']);
 await forceParent(page,'pd');await page.locator('#ps3CreateSave').click();
 await expect(page.locator('#ps3CreateStatus')).toHaveText('자기 자신이나 그 아래 프로젝트 밑으로는 옮길 수 없어요.');
 expect(state.writes).toEqual([]);
 // An allowed move: a project with no children goes under a second level and becomes the third level.
 await page.locator('[data-ps3-close="ps3CreateModal"]').click();
 await openEdit(page,'pb');expect(await parentValues(page)).toEqual(['','pa','pc','pe','pf']);
 await page.locator('#ps3CreateParent').selectOption('pc');await page.locator('#ps3CreateSave').click();
 await expect.poll(()=>state.writes.map(x=>[x.method,x.id,x.body.parent_id])).toEqual([['PATCH','pb','pc']]);
 await expect(row(page,'pb')).toHaveAttribute('data-ps3-depth','2');expect(errors).toEqual([]);
});

test('phone 390: the same tree, and the third level opens in the dialog without a child list',async({page})=>{
 const {errors}=await fixture(page,{width:390});
 await clickView(page,'projects');await expect(row(page,'pd')).toBeVisible();
 // The list may be redrawn once after the read; compare on the drawn rows.
 await expect.poll(async()=>await pad(row(page,'pd'))-await pad(row(page,'pc'))).toBeGreaterThan(0);
 await row(page,'pd').click();await expect(title(page)).toHaveText('합성 세부 사안');
 await expect(page.locator('#ps3DetailModal')).toHaveAttribute('aria-modal','true');await expect(page.locator('#ps3-children')).toHaveCount(0);
 await expect(page.locator('#ps3Hierarchy .ps3-parent-link')).toHaveText(['← 합성 정책 사업','합성 하위 토론회']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
});

for(const width of [1280,390])test(`${width}: the record-place sheet shows "1단 › 2단" on a third-level row only while searching`,async({page})=>{
 const {errors}=await fixture(page,{width});
 const q=page.locator('#homeView [data-home-quick]');await q.locator('[data-quick-mode="update"]').click();
 await q.locator('[data-quick-org]').click();const sheet=page.getByRole('dialog');await expect(sheet).toBeVisible();
 const deep=sheet.locator('[data-sheet-projects] [data-sheet-value="project:pd"]');await expect(deep).toHaveAttribute('data-depth','2');
 await expect(deep.locator('.home-choice-path')).toHaveCount(0);await expect(deep).toHaveText('합성 세부 사안');
 await expect(sheet.locator('[data-sheet-projects] [data-sheet-value="project:pc"] .home-choice-path')).toHaveCount(0);
 if(width<761){await expect(sheet.getByRole('searchbox')).toBeHidden();expect(errors).toEqual([]);return}
 const search=sheet.getByRole('searchbox',{name:'조직·프로젝트 이름 검색'});await search.fill('사안');
 await expect(deep).toBeVisible();await expect(deep.locator('.home-choice-path')).toBeVisible();await expect(deep.locator('.home-choice-path')).toHaveText('합성 정책 사업 › 합성 하위 토론회');
 await expect(sheet.locator('[data-sheet-projects] [data-sheet-value="project:pc"]')).toBeHidden();
 // The search matches names only: a parent's name does not bring up its third level.
 await search.fill('토론회');await expect(sheet.locator('[data-sheet-projects] [data-sheet-value="project:pc"]')).toBeVisible();await expect(deep).toBeHidden();
 await search.fill('');await expect(deep.locator('.home-choice-path')).toHaveCount(0);await expect(deep).toHaveText('합성 세부 사안');
 // UPD-여러곳고르기: a press marks the row; [저장] keeps it and closes the sheet.
 await deep.click();await expect(deep).toHaveAttribute('aria-pressed','true');await sheet.getByRole('button',{name:'저장',exact:true}).click();await expect(sheet).toBeHidden();await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 합성 세부 사안');
 expect(errors).toEqual([]);
});

// LIB-토글트리: 자료실의 "세부" 칩 줄은 트리가 대신한다. 1단 → 2단 → 3단 토글 안에 그 단의 자료가 들고, 1단 자료 수는 아래 단까지 센다.
// 다른 화면이 프로젝트로 걸러 열면(PRJ-3단 결정 2) 그 프로젝트와 아래 단 자료가 보인다.
test('PC 1280: the library tree nests the second and third levels; a project opened from elsewhere shows the documents of the levels under it',async({page})=>{
 const {errors}=await fixture(page);
 await clickView(page,'library');
 const shown=()=>page.locator('#documentList [data-lu-document]').evaluateAll(xs=>xs.map(x=>x.dataset.luDocument).sort());
 await expect(page.locator('#documentList [data-lu-document]')).toHaveCount(4);
 const head=key=>page.locator(`#documentList details[data-lu-node="${key}"] > summary`);
 await expect(head('p:pa').locator('.lu-node-count')).toHaveText('3');
 await head('p:pa').click();await head('p:pc').click();await head('p:pd').click();
 await expect(page.locator('#documentList details[data-lu-node="p:pa"] details[data-lu-node="p:pc"] details[data-lu-node="p:pd"] [data-lu-document="d-d"]')).toBeVisible();
 await expect(head('p:pc').locator('.lu-node-count')).toHaveText('2');
 const focus=async id=>page.evaluate(id=>{document.querySelector('#documentProject').value=id;window.KPTULibrary.render()},id);
 await focus('pa');await expect.poll(shown).toEqual(['d-a','d-c','d-d']);
 await focus('pc');await expect.poll(shown).toEqual(['d-c','d-d']);
 await focus('pd');await expect.poll(shown).toEqual(['d-d']);await expect(page.locator('[data-lu-document="d-d"]')).toBeVisible();
 await expect(page.locator('#documentProject').getByRole('radio')).toHaveText(['전체','합성 하위 토론회 › 합성 세부 사안']);
 await page.locator('#documentProject [data-filter-value="all"]').click();await expect.poll(shown).toEqual(['d-a','d-b','d-c','d-d']);
 expect(errors).toEqual([]);
});
