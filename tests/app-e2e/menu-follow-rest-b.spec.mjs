import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';
// MENU-자리나머지(S61-15) 둘째 묶음: 가족 기억할 것 줄 ⋯, 사업영역 줄 메뉴, 업무 기록 창(기록 ⋯·잊지 말기 기록 ⋯)을 연 채
// 그 칸이 다시 그려져도(그 화면의 실제 다시 그리기 길) 메뉴는 같은 칸의 새 ⋯ 옆에 붙어 있고 항목을 누르면 그 칸에 대해 실행된다.
// 칸이 없어지면 메뉴는 닫힌다(공용 anchored-menu keepMenus). 가짜 서버만(이름·글 모두 지어낸 것). 사진: MENU_FOLLOW_SHOTS 폴더가 있으면 남긴다.
const SHOTS=process.env.MENU_FOLLOW_SHOTS||'';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const shot=async(page,name)=>{if(!SHOTS)return;mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:`${SHOTS}/${name}.png`});};
const kind=width=>width<761?`phone-${width}`:`pc-${width}`;

// 지금 그 칸에 표시를 달고 화면을 다시 그리게 한 뒤, 표시 없는 새 칸이 그려질 때까지 기다린다(정말 다시 그려졌는지).
async function redraw(trigger,fire){
  await trigger.evaluate(el=>{el.dataset.oldDraw='1';});
  await fire();
  await expect(trigger).toBeVisible();
  await expect(trigger).not.toHaveAttribute('data-old-draw','1');
}
// 메뉴 상자가 그 칸 바로 옆(위·아래 24px 안)에 있는지.
async function nextTo(panel,trigger){
  const p=await panel.boundingBox(),t=await trigger.boundingBox();
  return Math.min(Math.abs(p.y-(t.y+t.height)),Math.abs(p.y+p.height-t.y))<24;
}
// PC 우클릭 메뉴: 누른 자리(at)에 붙으므로 다시 그린 뒤에도 같은 자리(4px 안)인지.
async function samePlace(page,panel,before){
  await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  const after=await panel.boundingBox();
  return Math.abs(after.x-before.x)+Math.abs(after.y-before.y)<4;
}
const watchErrors=page=>{const errors=[];page.on('pageerror',e=>errors.push(e.message));return errors;};

// ---------- 가족 · 기억할 것 줄 ⋯ (family-remind.js) ----------
const FAM='a0000000-0000-4000-8000-000000000002';
const N=n=>`b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const P=text=>({type:'paragraph',attrs:{style:'body2'},content:text?[{type:'text',text}]:[]});
const DOC=(...lines)=>({v:'ed1',doc:{type:'doc',content:lines.map(P)}});
const LINES=['☐ 예시: 서류 챙기기','☐ 예시: 화분 물 주기','☐ 예시: 선물 고르기','☐ 예시: 날짜 다시 보기'];
const LIST=()=>({id:N(2),workspace_id:'w',kind:'note',title:'잊지 말기',attachments:[],created_at:'2026-10-01T00:00:00Z',archived_at:null,raw_text:LINES.join('\n'),doc:DOC(...LINES),updated_at:'2026-10-04T00:00:00Z',ai_export_allowed:false,metadata:{family_list:true,folder_id:FAM,folder:'가족'}});
const eqv=v=>v?.replace(/^eq\./,'');
async function familyFixture(page,width){
  await page.setViewportSize({width,height:860});
  const errors=watchErrors(page),rows=[LIST()],posts=[];
  await openHome(page,{beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&['/rest/v1/app_todo_candidates','/rest/v1/app_feed_items','/rest/v1/app_journal_memorable','/rest/v1/app_record_links','/rest/v1/app_note_comments'].includes(u.pathname),r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/ai-assist',r=>r.fulfill({json:{ok:true,skipped:'fresh'}}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',r=>r.fulfill({json:[{id:FAM,parent_id:null,name:'가족',sort_order:1,created_at:'2026-10-01T00:00:00Z'}]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      const hit=row=>(!q.get('kind')||row.kind===eqv(q.get('kind')))&&(!q.get('id')||row.id===eqv(q.get('id')))&&(!q.get('metadata->>family_list')||row.metadata?.family_list===true)&&(!q.get('metadata->>family_past')||row.metadata?.family_past===true);
      if(req.method()==='POST'){const body=req.postDataJSON(),row={id:N(90+posts.length),attachments:[],archived_at:null,metadata:{},...body,updated_at:'2026-10-06T01:00:00Z'};posts.push(body);rows.push(row);return r.fulfill({status:201,json:[row]});}
      if(req.method()==='PATCH'){const body=req.postDataJSON(),list=rows.filter(hit);list.forEach(row=>Object.assign(row,body));return r.fulfill({json:list});}
      return r.fulfill({json:rows.filter(hit)});
    });
  }});
  await expect(page.locator('#homeView [data-home-summary]')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-fam-remind] .fam-remind-text')).toHaveCount(3);
  return {errors,rows,posts};
}
const familyChanged=page=>()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:family-remind-changed')));

for(const width of [412,1280])test.describe(`다시 그려도 메뉴 자리(둘째 묶음) ${width}`,()=>{
  test('가족 기억할 것 줄 ⋯: 연 채 다시 읽어 그려도 같은 줄 옆에 붙고 [과거 기록으로]가 그 줄에 대해 실행된다',async({page})=>{
    const {errors,posts}=await familyFixture(page,width);
    const host=page.locator('#basketView [data-fam-remind]'),more=host.locator('[data-fam-more]').nth(1),panel=page.locator('#familyRemindMenu');
    await more.click();
    await expect(panel).toBeVisible();
    await redraw(more,familyChanged(page));
    await expect(panel).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded','true');
    expect(await nextTo(panel,more)).toBe(true);
    await shot(page,`${kind(width)}-family-remind-menu-kept`);
    await panel.locator('[data-fam-menu="past"]').click();
    await expect.poll(()=>posts.length).toBe(1);
    expect(posts[0].raw_text).toBe(`10/6 · ${LINES[1]}`);
    expect(errors).toEqual([]);
  });

  test('업무 기록 창 기록 ⋯·잊지 말기 기록 ⋯: 연 채 기록 칸이 다시 그려져도 같은 기록 옆에 붙고 항목이 실행된다',async({page})=>{
    const {errors}=await orgFixture(page,width);
    await clickView(page,'team');
    if(width<761)await page.locator('#soOrganizationList [data-so-org="oa"]').click();
    await expect(page.locator('#wdTitle')).toHaveText('합성 가 지부');
    const modal=page.locator('#wdModal');
    // 1) 기록 ⋯ → 기록 칸 전체 다시 그리기(다른 화면의 기록 바뀜 알림 → 다시 읽기).
    const rec=modal.locator('[data-wd-up="u-0"]'),upMore=rec.locator('[data-wd-up-menu]'),upPanel=page.locator('#wdUpMenu');
    await rec.scrollIntoViewIfNeeded();
    await upMore.click();
    await expect(upPanel).toBeVisible();
    await redraw(upMore,()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:record-window-changed',{detail:{source:'other'}}))));
    await expect(upPanel).toBeVisible();
    await expect(upMore).toHaveAttribute('aria-expanded','true');
    expect(await nextTo(upPanel,upMore)).toBe(true);
    await shot(page,`${kind(width)}-org-record-menu-kept`);
    await upPanel.getByRole('button',{name:'수정',exact:true}).click();
    await expect(rec.locator('[data-wd-up-input]')).toBeFocused();
    await rec.locator('[data-wd-up-cancel]').click();await expect(rec.locator('[data-wd-up-edit]')).toHaveCount(0);
    // 2) 잊지 말기 기록 ⋯ → 그 줄만 다시 그리기(요약 이름 바뀜 알림, wdPatchLinks).
    await modal.locator('[data-wd-log-older]:not([open]) > summary').click();
    const link=modal.locator('[data-basket-link="l-o"]'),linkMore=link.locator('[data-basket-link-menu]'),linkPanel=page.locator('#basketLinkMenu');
    await link.scrollIntoViewIfNeeded();
    await linkMore.click();
    await expect(linkPanel).toBeVisible();
    await redraw(linkMore,()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:record-lines-renamed',{detail:{links:[{id:'l-o',before:'합성 조직 연결 요약',summary:'합성 조직 연결 요약 2'}]}}))));
    await expect(link).toContainText('합성 조직 연결 요약 2');
    await expect(linkPanel).toBeVisible();
    await expect(linkMore).toHaveAttribute('aria-expanded','true');
    expect(await nextTo(linkPanel,linkMore)).toBe(true);
    await linkPanel.getByRole('button',{name:'요약 수정',exact:true}).click();
    await expect(link.locator('[data-link-summary-input]')).toBeFocused();
    expect(errors).toEqual([]);
  });
});

// ---------- 업무 기록 창(workplace-detail.js) 가짜 서버 ----------
const stamp='2026-09-15T01:00:00Z',owner='home-test';
const orgNote={id:'10000000-0000-4000-8000-0000000000bb',workspace_id:'w',kind:'basket',occurred_at:stamp,updated_at:stamp,raw_text:'합성 조직 정리함 원문',ai_export_allowed:true,archived_at:null,attachments:[]};
const orgs=[{id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp},{id:'ob',workspace_id:'w',name:'합성 나 지부',active:true,created_by:owner,updated_at:stamp}];
const day=i=>`2026-09-${String(30-i).padStart(2,'0')}T0${i%10}:00:00Z`;
async function orgFixture(page,width){
  await page.setViewportSize({width,height:800});
  const errors=watchErrors(page);
  await openHome(page);
  const updates=Array.from({length:12},(_,i)=>({id:'u-'+i,organization_id:'oa',raw_text:'합성 기록 '+i,detail_text:null,occurred_at:day(i)}));
  const links=[{id:'l-o',workspace_id:'w',note_id:orgNote.id,project_id:null,organization_id:'oa',status:'confirmed',summary:'합성 조직 연결 요약'}];
  const list=(route,rows)=>{const q=new URL(route.request().url()).searchParams;const o=Number(q.get('offset')||0);return route.fulfill({json:rows.slice(o,o+Number(q.get('limit')||rows.length||1))})};
  await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const id=new URL(route.request().url()).searchParams.get('id');return route.fulfill({json:id?orgs.filter(o=>'eq.'+o.id===id):orgs})});
  await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner}))})});
  await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>{const id=new URL(route.request().url()).searchParams.get('organization_id')||'';return list(route,updates.filter(u=>id==='eq.'+u.organization_id||id.startsWith('in.(')&&id.slice(4,-1).split(',').includes(u.organization_id)))});
  await page.route(SB+'/rest/v1/app_notes?**',route=>list(route,[orgNote]));
  await page.route(SB+'/rest/v1/app_record_links?**',route=>{
    const q=new URL(route.request().url()).searchParams;if(q.has('google_task_id'))return route.fulfill({json:[]});
    let rows=links;const v=q.get('organization_id');if(v?.startsWith('in.('))rows=rows.filter(x=>v.slice(4,-1).split(',').includes(x.organization_id));else if(q.get('project_id')?.startsWith('in.('))rows=[];
    return list(route,rows.map(row=>({...row,note:orgNote,organization:{name:orgs.find(o=>o.id===row.organization_id)?.name||''},project:null})));
  });
  return {errors};
}

// ---------- 사업영역 줄 메뉴(project-system-v3.js renderGrid) — PC 우클릭 ----------
const at=n=>`2026-09-0${n}T00:00:00Z`;
const spaces=[
  {id:'pa',workspace_id:'w',owner_id:'home-test',name:'합성 정책 사업',status:'active',sort_order:10,created_at:at(1),metadata:{project_system:'v2',color:'green'}},
  {id:'pb',workspace_id:'w',owner_id:'home-test',name:'합성 조직 사업',status:'active',sort_order:30,created_at:at(3),metadata:{project_system:'v2',color:'blue'}},
  {id:'pe',workspace_id:'w',owner_id:'home-test',name:'합성 교섭 사업',status:'active',sort_order:40,created_at:at(4),metadata:{project_system:'v2',color:'orange'}},
];
async function projectFixture(page){
  await page.setViewportSize({width:1280,height:800});
  const errors=watchErrors(page);
  await openHome(page);
  const state={spaces:structuredClone(spaces),writes:[]};
  await page.route(SB+'/rest/v1/app_spaces**',route=>{
    const req=route.request(),q=new URL(req.url()).searchParams;
    if(req.method()==='PATCH'){const id=q.get('id').slice(3),body=req.postDataJSON();state.writes.push({id,body});const row=state.spaces.find(x=>x.id===id);Object.assign(row,body);return route.fulfill({json:[row]});}
    if(q.get('select')?.includes('milestones:'))return route.fulfill({json:state.spaces.map(x=>({id:x.id,milestones:[]}))});
    return route.fulfill({json:state.spaces});
  });
  await page.route(SB+'/rest/v1/app_project_modules**',route=>route.fulfill({json:[]}));
  await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
  await clickView(page,'projects');
  await page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]').click();await expectProjectTitle(page,'합성 정책 사업');
  return {state,errors};
}
const psRow=(page,id)=>page.locator(`#projectGrid .ps3-plist [data-ps3-project="${id}"]`);
const projectsShown=page=>()=>page.evaluate(()=>window.KPTUProjects.shown());

test('사업영역 줄 우클릭 메뉴 PC 1280: 연 채 목록을 다시 그려도 누른 자리 그대로 · [아래로 접기]가 그 사업영역에 실행된다',async({page})=>{
  const {state,errors}=await projectFixture(page),panel=page.locator('#ps3FoldMenu');
  await expect(async()=>{await psRow(page,'pe').click({button:'right'});await expect(panel).toBeVisible({timeout:700})}).toPass({timeout:10000});
  const before=await panel.boundingBox();
  await redraw(psRow(page,'pe'),projectsShown(page));
  await expect(panel).toBeVisible();
  await expect(psRow(page,'pe')).toHaveAttribute('aria-expanded','true');
  expect(await samePlace(page,panel,before)).toBe(true);
  await shot(page,'pc-1280-project-row-menu-kept');
  await panel.locator('[data-ps3-fold-action="fold"]').click();
  await expect.poll(()=>state.writes.map(w=>[w.id,w.body.metadata?.folded===true])).toEqual([['pe',true]]);
  expect(errors).toEqual([]);
});

test('사업영역 줄 우클릭 메뉴 PC 1280: 연 채 그 사업영역이 목록에서 없어지면 메뉴가 닫힌다',async({page})=>{
  const {state,errors}=await projectFixture(page),panel=page.locator('#ps3FoldMenu');
  await expect(async()=>{await psRow(page,'pe').click({button:'right'});await expect(panel).toBeVisible({timeout:700})}).toPass({timeout:10000});
  state.spaces=state.spaces.filter(x=>x.id!=='pe');
  await projectsShown(page)();
  await expect(psRow(page,'pe')).toHaveCount(0);
  await expect(panel).toBeHidden();
  expect(state.writes).toEqual([]);
  expect(errors).toEqual([]);
});
