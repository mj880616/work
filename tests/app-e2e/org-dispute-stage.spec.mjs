import {test,expect} from '@playwright/test';
import {openHome,defaultStageRows} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// ORG-쟁의단계 화면(2026-10-24 명진 결정): 조직 상세 '쟁의 단계' 한 줄(선택·달력 날짜·저장)과 접힌 단계 이력, 목록 꼬리표(투쟁 중·이번 주 끝남),
// 담당조직 화면 ⋯ › 쟁의 단계 관리(추가·이름 바꾸기·투쟁 중 켬/끔·순서·지우기 → 기본 단계로 이동). 서버는 가짜(저장 흐름만 확인). 이름은 모두 합성 값.
// 시계는 2026-10-06(화)로 고정 → 이번 주는 10.5~10.11.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const orgs=[
 {id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp},
 {id:'ob',workspace_id:'w',name:'합성 나 지부',active:true,created_by:owner,updated_at:stamp}
];
async function fixture(page,{width,tables=true,seeded=true,period=true}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await openHome(page);
 const db={stages:seeded?defaultStageRows():[],history:[],rpc:[],patches:[],hpatches:[],hdeletes:[],hposts:[],seq:0};
 const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return json(route,id?orgs.filter(o=>'eq.'+o.id===id):orgs)});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return json(route,q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner})))});
 for(const t of ['app_suborganization_updates','app_notes','app_record_links'])await page.route(SB+`/rest/v1/${t}?**`,route=>json(route,[]));
 const current=orgId=>db.history.filter(h=>h.organization_id===orgId).sort((a,b)=>b.stage_date.localeCompare(a.stage_date)||b.created_at.localeCompare(a.created_at))[0];
 await page.route(/\/rest\/v1\/app_dispute_stages(\?|$)/,async route=>{
  const req=route.request(),url=new URL(req.url());
  if(!tables)return json(route,{code:'PGRST205',message:'Could not find the table in the schema cache'},404);
  if(req.method()==='GET')return json(route,db.stages);
  if(req.method()==='POST'){for(const b of [].concat(req.postDataJSON()))db.stages.push({id:'stage-new-'+(++db.seq),is_default:false,is_struggle:false,is_ending:false,created_at:'2026-10-06T00:00:00Z',...b});return json(route,[],201)}
  if(req.method()==='PATCH'){const id=url.searchParams.get('id').slice(3),b=req.postDataJSON();db.patches.push({id,...b});Object.assign(db.stages.find(s=>s.id===id),b);return json(route,[])}
  return route.continue();
 });
 await page.route(/\/rest\/v1\/app_suborganization_dispute_stages(\?|$)/,async route=>{
  const req=route.request(),url=new URL(req.url());
  if(!tables)return json(route,{message:'x'},404);
  // DB 20261024180000 적용 전: end_date 칸이 없으면 PostgREST는 400(42703).
  const noEnd=()=>json(route,{code:'42703',message:'column app_suborganization_dispute_stages.end_date does not exist'},400);
  if(req.method()==='GET'){if(!period&&/end_date/.test(url.searchParams.get('select')||''))return noEnd();return json(route,period?db.history:db.history.map(({end_date,...h})=>h))}
  if(req.method()==='POST'){const b=req.postDataJSON();db.hposts.push(b);if(!period&&'end_date' in b)return noEnd();if(b.end_date&&b.end_date<b.stage_date)return json(route,{code:'23514',message:'violates check constraint'},400);db.history.push({id:'h-'+(++db.seq),created_at:`2026-10-06T00:00:${String(db.seq).padStart(2,'0')}Z`,end_date:null,...b});return json(route,[],201)}
  if(req.method()==='PATCH'){if(!period)return noEnd();const id=url.searchParams.get('id').slice(3),b=req.postDataJSON();db.hpatches.push({id,...b});const h=db.history.find(x=>x.id===id);if(!h)return json(route,[]);Object.assign(h,b);return json(route,[h])}
  if(req.method()==='DELETE'){const id=url.searchParams.get('id').slice(3),gone=db.history.filter(h=>h.id===id);db.hdeletes.push(id);db.history=db.history.filter(h=>h.id!==id);return json(route,gone)}
  return route.continue();
 });
 await page.route(SB+'/rest/v1/rpc/app_dispute_stage_delete',async route=>{
  const b=route.request().postDataJSON();db.rpc.push(b);
  const stage=db.stages.find(s=>s.id===b.p_stage_id);
  if(!stage)return json(route,{ok:false,error:'STAGE_MISSING',moved:0});
  if(stage.is_default)return json(route,{ok:false,error:'DEFAULT_STAGE',moved:0});
  const at=orgs.map(o=>o.id).filter(id=>current(id)?.stage_id===stage.id);
  if(at.length&&!b.p_move_organizations)return json(route,{ok:false,error:'ORGS_AT_STAGE',moved:0,count:at.length,organization_ids:at});
  const base=db.stages.find(s=>s.is_default);
  for(const id of at)db.history.push({id:'h-'+(++db.seq),organization_id:id,stage_id:base.id,stage_name:base.name,stage_date:'2026-10-06',created_at:`2026-10-06T01:00:${String(db.seq).padStart(2,'0')}Z`});
  db.stages=db.stages.filter(s=>s.id!==stage.id);db.history.forEach(h=>{if(h.stage_id===stage.id)h.stage_id=null});
  return json(route,{ok:true,moved:at.length});
 });
 return {f,db,errors};
}
const row=(page,id)=>page.locator(`#soOrganizationList [data-so-org="${id}"]`);
async function openOrg(page,id,width){
 await clickView(page,'team');
 if(width<761)await row(page,id).click();
 else await row(page,id).click();
 await expect(page.locator('#wdModal')).toBeVisible();await expect(page.locator('#wdTitle')).toHaveText(orgs.find(o=>o.id===id).name);
}
const stageSelect=page=>page.locator('#wdStage [data-stage-select]');

for(const width of [390,1280])test(`단계 저장·이력·목록 꼬리표 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width});
 await openOrg(page,'oa',width);
 const line=page.locator('#wdStage');
 await expect(line).toContainText('쟁의 단계');await expect(stageSelect(page)).toHaveValue('stage-1');
 await expect(line.locator('[data-stage-save]')).toBeHidden();
 // 이름 줄 바로 아래, 기록 입력보다 위
 const y=await line.evaluate(el=>el.getBoundingClientRect().top),yi=await page.locator('#wdInbox').evaluate(el=>el.getBoundingClientRect().top);expect(y).toBeLessThan(yi);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await stageSelect(page).selectOption({label:'쟁의발생 결의'});
 await expect(line.locator('[data-stage-date]')).toHaveValue('2026-10-06');
 await line.locator('[data-stage-date]').fill('2026-10-02');
 await line.locator('[data-stage-save]').click();
 await expect(line.locator('[data-stage-msg]')).toHaveText('저장했어요.');
 expect(db.history).toHaveLength(1);expect(db.history[0]).toMatchObject({organization_id:'oa',stage_id:'stage-3',stage_name:'쟁의발생 결의',stage_date:'2026-10-02'});
 await expect(line.locator('summary')).toHaveText('단계 이력 1');
 await expect(row(page,'oa').locator('.so-stage-tag')).toHaveText('쟁의발생 결의');await expect(row(page,'ob').locator('.so-stage-tag')).toHaveCount(0);
 // 같은 단계를 다시 저장하면 날짜만 고친 것(줄이 늘지 않음)
 await line.locator('[data-stage-date]').fill('2026-10-03');await line.locator('[data-stage-save]').click();
 // 저장이 끝날 때까지(새 줄 넣기 → 옛 줄 지우기 → 다시 읽기) 기다린 뒤 다음 조작을 한다. 끝나기 전에 고르면 다시 그리기가 고른 값을 덮는다(기존 시험의 간헐 실패 원인).
 await expect(line.locator('[data-stage-msg]')).toHaveText('저장했어요.');await expect(line.locator('[data-stage-save]')).toBeHidden();
 expect(db.history).toHaveLength(1);expect(db.history[0].stage_date).toBe('2026-10-03');
 // 끝남: 이번 주(10.5~10.11)에 끝나면 꼬리표, 지난 주에 끝난 건 없음
 await stageSelect(page).selectOption({label:'협약체결'});await line.locator('[data-stage-date]').fill('2026-10-05');await line.locator('[data-stage-save]').click();
 await expect(line.locator('[data-stage-msg]')).toHaveText('저장했어요.');
 await expect(line.locator('summary')).toHaveText('단계 이력 2');
 await expect(row(page,'oa').locator('.so-stage-tag')).toHaveText('협약체결');await expect(row(page,'oa').locator('.so-stage-tag')).toHaveClass(/is-end/);
 await line.locator('[data-stage-date]').fill('2026-10-04');await line.locator('[data-stage-save]').click(); // 지난 주로 고치면 꼬리표가 빠짐
 await expect(line.locator('summary')).toHaveText('단계 이력 2');
 await expect(row(page,'oa').locator('.so-stage-tag')).toHaveCount(0);
 await line.locator('summary').click();
 await expect(line.locator('details')).toContainText('10.4 협약체결');await expect(line.locator('details')).toContainText('10.3 쟁의발생 결의');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`쟁의 단계 관리: 추가·이름·투쟁 중·순서·지우기(기본 단계로 이동) ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width});
 await clickView(page,'team');
 await page.locator('#soTeamMore').click();
 await page.locator('#soTeamMenu [data-so-stage-manage]').click();
 const dlg=page.locator('#soStageModal');await expect(dlg).toBeVisible();
 await expect(dlg.locator('.stg-row')).toHaveCount(11);
 await expect(dlg.locator('.stg-row').first()).toContainText('교섭 시작 전');await expect(dlg.locator('.stg-row').first()).toContainText('기본');
 // 기본 단계는 이름 바꾸기만
 await dlg.locator('.stg-row').first().locator('[data-stg-more]').click();
 await expect(dlg.locator('.stg-row').first().locator('.stg-sub button')).toHaveText(['이름 바꾸기']);
 await dlg.locator('.stg-row').first().locator('[data-stg-more]').click();
 // 추가
 await dlg.locator('[data-stg-add]').click();await dlg.locator('[data-stg-add-input]').fill('교섭 중');await dlg.locator('[data-stg-add-form] button[type=submit]').click();
 await expect(dlg.locator('[data-stg-msg]')).toContainText('같은 이름');
 await dlg.locator('[data-stg-add-input]').fill('합성 새 단계');await dlg.locator('[data-stg-add-form] button[type=submit]').click();
 await expect(dlg.locator('.stg-row')).toHaveCount(12);
 const added=dlg.locator('.stg-row').last();await expect(added).toContainText('합성 새 단계');
 // 투쟁 중 켬 → 끝남 켬(투쟁 중은 같은 저장에서 꺼짐)
 await added.locator('[data-stg-flag="struggle"]').click();await expect(added.locator('[data-stg-flag="struggle"]')).toHaveAttribute('aria-pressed','true');
 await added.locator('[data-stg-more]').click();await added.locator('[data-stg-menu]').click();
 await expect(added.locator('[data-stg-flag="ending"]')).toHaveAttribute('aria-pressed','true');await expect(added.locator('[data-stg-flag="struggle"]')).toHaveAttribute('aria-pressed','false');
 expect(db.stages.at(-1)).toMatchObject({is_struggle:false,is_ending:true});
 // 이름 바꾸기
 await added.locator('[data-stg-more]').click();await added.locator('[data-stg-rename]').click();
 await added.locator('[data-stg-rename-input]').fill('합성 바뀐 단계');await added.locator('[data-stg-rename-form] button[type=submit]').click();
 await expect(dlg.locator('.stg-row').last()).toContainText('합성 바뀐 단계');
 // 순서: 위 화살표로 한 칸 위로, 그리고 끌어서 맨 위 바로 아래로
 await dlg.locator('.stg-row').last().locator('[data-stg-grip]').focus();await page.keyboard.press('ArrowUp');
 await expect(dlg.locator('.stg-row').nth(10)).toContainText('합성 바뀐 단계');
 const grip=await dlg.locator('.stg-row').nth(10).locator('[data-stg-grip]').boundingBox(),target=await dlg.locator('.stg-row').nth(1).boundingBox();
 await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
 await page.mouse.move(grip.x+grip.width/2,target.y+4,{steps:12});await page.mouse.up();
 await expect(dlg.locator('.stg-row').nth(1)).toContainText('합성 바뀐 단계');
 await expect(dlg.locator('.stg-row').first()).toContainText('교섭 시작 전');
 expect(db.stages.filter(s=>s.name==='합성 바뀐 단계')[0].sort_order).toBe(2);
 // 조직 하나를 이 단계에 두고 지우기: 알림 → 기본 단계로 이동
 db.history.push({id:'hx',organization_id:'oa',stage_id:db.stages.find(s=>s.name==='합성 바뀐 단계').id,stage_name:'합성 바뀐 단계',stage_date:'2026-10-04',created_at:'2026-10-04T00:00:00Z'});
 await dlg.locator('button[aria-label="닫기"]').click();
 await page.locator('#soTeamMore').click();await page.locator('#soTeamMenu [data-so-stage-manage]').click();
 const again=page.locator('#soStageModal').locator('.stg-row',{hasText:'합성 바뀐 단계'});await expect(again).toBeVisible();
 await again.locator('[data-stg-more]').click();await again.locator('[data-stg-delete]').click();
 await expect(again.locator('.stg-confirm')).toContainText('합성 가 지부 1곳이 이 단계예요.');await expect(again.locator('.stg-confirm')).toContainText('교섭 시작 전');
 expect(db.rpc).toEqual([]);
 await again.locator('[data-stg-delete-yes]').click();
 await expect(page.locator('#soStageModal .stg-row')).toHaveCount(11);
 expect(db.rpc).toEqual([{p_stage_id:expect.any(String),p_move_organizations:true}]);
 expect(db.history.at(-1)).toMatchObject({organization_id:'oa',stage_name:'교섭 시작 전',stage_id:'stage-1'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

test('조직이 없는 단계를 지울 때는 알림 없이 한 번 확인 뒤 지움(기본 단계 지우기 불가)',async({page})=>{
 const {db}=await fixture(page,{width:390});
 await clickView(page,'team');await page.locator('#soTeamMore').click();await page.locator('#soTeamMenu [data-so-stage-manage]').click();
 const dlg=page.locator('#soStageModal'),second=dlg.locator('.stg-row').nth(1);
 await second.locator('[data-stg-more]').click();await second.locator('[data-stg-delete]').click();
 await expect(second.locator('.stg-confirm')).toContainText('‘교섭 중’ 단계를 지울까요?');
 await second.locator('[data-stg-cancel]').click();await expect(dlg.locator('.stg-row')).toHaveCount(11);expect(db.rpc).toEqual([]);
 await second.locator('[data-stg-more]').click();await second.locator('[data-stg-delete]').click();await second.locator('[data-stg-delete-yes]').click();
 await expect(dlg.locator('.stg-row')).toHaveCount(10);expect(db.rpc).toEqual([{p_stage_id:'stage-2',p_move_organizations:false}]);
});

for(const width of [390,1280])test(`표가 아직 없을 때는 '준비 중' 한 줄이고 화면은 그대로 ${width}px`,async({page})=>{
 const {errors}=await fixture(page,{width,tables:false});
 await clickView(page,'team');
 await page.locator('#soTeamMore').click();await page.locator('#soTeamMenu [data-so-stage-manage]').click();
 await expect(page.locator('#soStageBody [data-stage-preparing]')).toBeVisible();
 await page.locator('#soStageModal button[aria-label="닫기"]').click();await expect(page.locator('#soStageModal')).toBeHidden();
 await openOrg(page,'oa',width);
 await expect(page.locator('#wdStage [data-stage-preparing]')).toHaveText('준비 중');
 await expect(page.locator('#wdStage select')).toHaveCount(0);
 await expect(page.locator('#soOrganizationList .so-stage-tag')).toHaveCount(0);
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`기본 단계가 아직 없을 때: 보기만 해서는 쓰지 않고, 저장할 때 11개가 채워진다 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width,seeded:false});
 await openOrg(page,'oa',width);
 await expect(page.locator('#wdStage [data-stage-select] option')).toHaveCount(11);
 await expect(stageSelect(page)).toHaveValue('seed:교섭 시작 전');
 expect(db.stages).toEqual([]);
 await stageSelect(page).selectOption({label:'쟁의발생 결의'});
 await page.locator('#wdStage [data-stage-save]').click();
 await expect(page.locator('#wdStage [data-stage-msg]')).toHaveText('저장했어요.');
 expect(db.stages).toHaveLength(11);expect(db.stages[0]).toMatchObject({name:'교섭 시작 전',is_default:true});
 expect(db.history).toHaveLength(1);expect(db.history[0]).toMatchObject({stage_name:'쟁의발생 결의',stage_id:db.stages[2].id});
 await expect(row(page,'oa').locator('.so-stage-tag')).toHaveText('쟁의발생 결의');
 expect(errors).toEqual([]);
});
test('기본 단계가 없을 때 관리 창을 처음 열면 11개를 채운다',async({page})=>{
 const {db}=await fixture(page,{width:390,seeded:false});
 await clickView(page,'team');expect(db.stages).toEqual([]);
 await page.locator('#soTeamMore').click();await page.locator('#soTeamMenu [data-so-stage-manage]').click();
 await expect(page.locator('#soStageModal .stg-row')).toHaveCount(11);expect(db.stages[0]).toMatchObject({is_default:true});
});

// ORG-쟁의단계 다듬기(2026-10-24 11:05~11:08): ① 단계 기간(끝 날짜) ② 이력 한 줄 고치기·지우기 ③ 화면 전체 ⋯는 제목 '담당조직' 줄 오른쪽.
for(const width of [390,1280])test(`단계 기간 저장: [~ 끝 날짜] → 이력 '11.3 ~ 11.5', 끝 < 시작은 저장 전에 막음 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width});
 await openOrg(page,'oa',width);
 const line=page.locator('#wdStage');
 await expect(line.locator('[data-stage-end]')).toHaveCount(0);
 await stageSelect(page).selectOption({label:'파업 찬반투표'});
 await line.locator('[data-stage-date]').fill('2026-10-05');
 await line.locator('[data-stage-end-open]').click();
 await expect(line.locator('[data-stage-end]')).toBeFocused();
 await expect(stageSelect(page)).toHaveValue('stage-6');await expect(line.locator('[data-stage-date]')).toHaveValue('2026-10-05');
 await line.locator('[data-stage-end]').fill('2026-10-04');
 await line.locator('[data-stage-save]').click();
 await expect(line.locator('[data-stage-msg]')).toHaveText('끝 날짜는 시작 날짜와 같거나 뒤여야 해요.');
 expect(db.history).toEqual([]);
 await line.locator('[data-stage-end]').fill('2026-10-07');
 await line.locator('[data-stage-save]').click();
 await expect(line.locator('[data-stage-msg]')).toHaveText('저장했어요.');
 expect(db.history).toHaveLength(1);expect(db.history[0]).toMatchObject({stage_name:'파업 찬반투표',stage_date:'2026-10-05',end_date:'2026-10-07'});
 await expect(line.locator('[data-stage-end]')).toHaveValue('2026-10-07');
 await line.locator('summary').click();
 await expect(line.locator('[data-stage-hrow] .wd-stage-htext')).toHaveText(['10.5 ~ 10.7 파업 찬반투표']);
 // 끝 날짜 없이 저장하면 하루(end_date 보내지 않음)
 await stageSelect(page).selectOption({label:'쟁의중'});await line.locator('[data-stage-date]').fill('2026-10-08');await line.locator('[data-stage-end]').fill('');
 await line.locator('[data-stage-save]').click();await expect(line.locator('[data-stage-msg]')).toHaveText('저장했어요.');
 expect(db.history[1]).toMatchObject({stage_name:'쟁의중',stage_date:'2026-10-08',end_date:null});
 await expect(line.locator('[data-stage-hrow] .wd-stage-htext').first()).toHaveText('10.8 쟁의중');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`이력 한 줄 ⋯ → 고치기(단계·날짜·끝 날짜)·지우기(한 번 더 확인), 현재 단계 다시 계산 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width});
 db.history.push({id:'h-a',organization_id:'oa',stage_id:'stage-2',stage_name:'교섭 중',stage_date:'2026-09-20',end_date:null,created_at:'2026-09-20T00:00:00Z'},
  {id:'h-b',organization_id:'oa',stage_id:'stage-3',stage_name:'쟁의발생 결의',stage_date:'2026-10-02',end_date:null,created_at:'2026-10-02T00:00:00Z'});
 await openOrg(page,'oa',width);
 const line=page.locator('#wdStage');
 await expect(stageSelect(page)).toHaveValue('stage-3');await expect(row(page,'oa').locator('.so-stage-tag')).toHaveText('쟁의발생 결의');
 await line.locator('summary').click();
 const rowB=line.locator('[data-stage-hrow="h-b"]');
 await rowB.locator('[data-stage-hmore]').click();
 await expect(rowB.locator('.wd-stage-hsub button')).toHaveText(['고치기','지우기']);
 // 고치기: 끝 < 시작은 막고, 바르게 고치면 PATCH 한 번
 await rowB.locator('[data-stage-hedit]').click();
 await expect(rowB.locator('[data-stage-hselect]')).toBeFocused();
 await rowB.locator('[data-stage-hselect]').selectOption({label:'파업 찬반투표'});
 await rowB.locator('[data-stage-hdate]').fill('2026-10-03');await rowB.locator('[data-stage-hend]').fill('2026-10-01');
 await rowB.locator('button[type=submit]').click();
 await expect(line.locator('[data-stage-msg]')).toHaveText('끝 날짜는 시작 날짜와 같거나 뒤여야 해요.');expect(db.hpatches).toEqual([]);
 await rowB.locator('[data-stage-hend]').fill('2026-10-05');await rowB.locator('button[type=submit]').click();
 await expect(line.locator('[data-stage-msg]')).toHaveText('이력을 고쳤어요.');
 expect(db.hpatches).toEqual([{id:'h-b',stage_id:'stage-6',stage_name:'파업 찬반투표',stage_date:'2026-10-03',end_date:'2026-10-05'}]);
 await expect(line.locator('[data-stage-hrow="h-b"] .wd-stage-htext')).toHaveText('10.3 ~ 10.5 파업 찬반투표');
 await expect(stageSelect(page)).toHaveValue('stage-6');await expect(row(page,'oa').locator('.so-stage-tag')).toHaveText('파업 찬반투표');
 await expect(line.locator('details')).toHaveAttribute('open','');
 // 지우기: 확인 단계 → 취소하면 그대로, 확인하면 DELETE 한 번, 현재 단계는 남은 최신 줄(교섭 중)
 await line.locator('[data-stage-hrow="h-b"] [data-stage-hmore]').click();await line.locator('[data-stage-hrow="h-b"] [data-stage-hdel]').click();
 await expect(line.locator('[data-stage-hrow="h-b"] .stg-confirm')).toContainText('이 줄을 지울까요?');
 await line.locator('[data-stage-hrow="h-b"] [data-stage-hcancel]').click();expect(db.hdeletes).toEqual([]);
 await line.locator('[data-stage-hrow="h-b"] [data-stage-hmore]').click();await line.locator('[data-stage-hrow="h-b"] [data-stage-hdel]').click();
 await line.locator('[data-stage-hrow="h-b"] [data-stage-hdel-yes]').click();
 await expect(line.locator('[data-stage-msg]')).toHaveText('이력 한 줄을 지웠어요.');
 expect(db.hdeletes).toEqual(['h-b']);
 await expect(stageSelect(page)).toHaveValue('stage-2');await expect(row(page,'oa').locator('.so-stage-tag')).toHaveCount(0);
 await expect(line.locator('summary')).toHaveText('단계 이력 1');
 // 마지막 줄까지 지우면 기본 단계(교섭 시작 전)
 await line.locator('[data-stage-hrow="h-a"] [data-stage-hmore]').click();await line.locator('[data-stage-hrow="h-a"] [data-stage-hdel]').click();await line.locator('[data-stage-hrow="h-a"] [data-stage-hdel-yes]').click();
 await expect(stageSelect(page)).toHaveValue('stage-1');await expect(line.locator('details')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`끝 날짜 칸이 아직 없을 때(DB 적용 전): 읽기·하루짜리 저장은 그대로, 끝 날짜·고치기는 저장 시 안내 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width,period:false});
 db.history.push({id:'h-a',organization_id:'oa',stage_id:'stage-3',stage_name:'쟁의발생 결의',stage_date:'2026-10-02',created_at:'2026-10-02T00:00:00Z'});
 await openOrg(page,'oa',width);
 const line=page.locator('#wdStage');
 await expect(stageSelect(page)).toHaveValue('stage-3');
 await expect(line.locator('[data-stage-end-open]')).toBeVisible(); // 숨기지 않음
 await stageSelect(page).selectOption({label:'파업 찬반투표'});await line.locator('[data-stage-end-open]').click();await line.locator('[data-stage-end]').fill('2026-10-09');
 await line.locator('[data-stage-save]').click();
 await expect(line.locator('[data-stage-msg]')).toContainText('아직 준비 중');expect(db.history).toHaveLength(1);
 await line.locator('[data-stage-end]').fill('');await line.locator('[data-stage-save]').click();
 await expect(line.locator('[data-stage-msg]')).toHaveText('저장했어요.');expect(db.history).toHaveLength(2);expect('end_date' in db.hposts.at(-1)).toBe(false);
 await line.locator('summary').click();
 await line.locator('[data-stage-hrow="h-a"] [data-stage-hmore]').click();await line.locator('[data-stage-hrow="h-a"] [data-stage-hedit]').click();
 await expect(line.locator('[data-stage-msg]')).toContainText('아직 준비 중');await expect(line.locator('[data-stage-hform]')).toHaveCount(0);
 expect(db.hpatches).toEqual([]);
 expect(errors).toEqual([]);
});

for(const width of [390,900,1280])test(`화면 전체 ⋯(담당조직 메뉴)는 제목 '담당조직' 줄 오른쪽(PC는 목록 칸 맨 위 줄 오른쪽 끝), 목록 HTML 안에 없음 ${width}px`,async({page})=>{
 const {errors}=await fixture(page,{width});
 await clickView(page,'team');
 const more=page.locator('#soTeamMore');await expect(more).toBeVisible();await expect(more).toHaveCount(1);
 await expect(page.locator('#soOrganizationList #soTeamMore, .so-group-card #soTeamMore')).toHaveCount(0);
 const m=await more.boundingBox(),group=await page.locator('#soOrganizationList .so-group-heading').first().boundingBox();
 if(width<761)expect(m.y+m.height).toBeLessThanOrEqual(group.y); // 묶음 머리줄보다 위
 if(width<=760){
  // 폰: 위 머리줄의 화면 이름 "담당조직"과 같은 줄, 오른쪽 끝
  const name=await page.locator('.mobile-shell-header [data-mobile-view-name]').boundingBox();
  expect(Math.abs((m.y+m.height/2)-(name.y+name.height/2))).toBeLessThanOrEqual(6);
  expect(m.x).toBeGreaterThan(name.x+name.width);
 }else{
  const title=page.locator('#soTeamHead .so-team-title');await expect(title).toHaveText('담당조직');
  // UI-화면정리 B ①: PC(1024px~)는 위쪽 경로 줄이 화면 이름을 맡아 본문 큰 제목은 읽기 프로그램용(잘라 숨김), 중간 폭은 제목 줄 그대로.
  if(width>=761){
   await expect(title).toHaveCSS('clip','rect(0px, 0px, 0px, 0px)');
   // UI-전수디자인점검 F07: PC는 ⋯ 하나만 담은 빈 줄이 없다. ⋯는 목록 칸 맨 위 줄(첫 묶음 머리줄) 오른쪽 끝, 'N곳'과 겹치지 않음, 오른쪽 상세 칸은 목록과 같은 높이에서 시작.
   const list=await page.locator('#soOrganizationList').boundingBox(),pane=await page.locator('#wdDetailPane').boundingBox(),count=await page.locator('#soOrganizationList .so-group-count').first().boundingBox();
   expect(Math.abs((m.y+m.height/2)-(group.y+group.height/2))).toBeLessThanOrEqual(3);
   expect(m.x+m.width).toBeLessThanOrEqual(list.x+list.width+1);expect(m.x).toBeGreaterThan(list.x+list.width/2);
   expect(count.x+count.width).toBeLessThanOrEqual(m.x);
   expect(Math.abs(pane.y-list.y)).toBeLessThanOrEqual(1);
  }else{
   await expect(title).toBeVisible();const t=await title.boundingBox();expect(Math.abs((m.y+m.height/2)-(t.y+t.height/2))).toBeLessThanOrEqual(6);
   const list=await page.locator('#soOrganizationList').boundingBox();expect(m.x+m.width).toBeGreaterThan(list.x+list.width-1); // 목록 칸 밖(화면 오른쪽)
  }
 }
 await more.click();await expect(page.locator('#soTeamMenu [data-so-stage-manage]')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});
