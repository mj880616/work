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
async function fixture(page,{width,tables=true}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await openHome(page);
 const db={stages:defaultStageRows(),history:[],rpc:[],patches:[],seq:0};
 const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return json(route,id?orgs.filter(o=>'eq.'+o.id===id):orgs)});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return json(route,q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner})))});
 for(const t of ['app_suborganization_updates','app_notes','app_record_links'])await page.route(SB+`/rest/v1/${t}?**`,route=>json(route,[]));
 const current=orgId=>db.history.filter(h=>h.organization_id===orgId).sort((a,b)=>b.stage_date.localeCompare(a.stage_date)||b.created_at.localeCompare(a.created_at))[0];
 await page.route(/\/rest\/v1\/app_dispute_stages(\?|$)/,async route=>{
  const req=route.request(),url=new URL(req.url());
  if(!tables)return json(route,{code:'PGRST205',message:'Could not find the table in the schema cache'},404);
  if(req.method()==='GET')return json(route,db.stages);
  if(req.method()==='POST'){const b=req.postDataJSON();db.stages.push({id:'stage-new-'+(++db.seq),is_default:false,is_struggle:false,is_ending:false,created_at:'2026-10-06T00:00:00Z',...b});return json(route,[],201)}
  if(req.method()==='PATCH'){const id=url.searchParams.get('id').slice(3),b=req.postDataJSON();db.patches.push({id,...b});Object.assign(db.stages.find(s=>s.id===id),b);return json(route,[],204)}
  return route.continue();
 });
 await page.route(/\/rest\/v1\/app_suborganization_dispute_stages(\?|$)/,async route=>{
  const req=route.request(),url=new URL(req.url());
  if(!tables)return json(route,{message:'x'},404);
  if(req.method()==='GET')return json(route,db.history);
  if(req.method()==='POST'){const b=req.postDataJSON();db.history.push({id:'h-'+(++db.seq),created_at:`2026-10-06T00:00:${String(db.seq).padStart(2,'0')}Z`,...b});return json(route,[],201)}
  if(req.method()==='DELETE'){const id=url.searchParams.get('id').slice(3);db.history=db.history.filter(h=>h.id!==id);return json(route,[],204)}
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
 if(width<1024)await row(page,id).click();
 else await row(page,id).click();
 await expect(page.locator('#wdModal')).toBeVisible();await expect(page.locator('#wdTitle')).toHaveText(orgs.find(o=>o.id===id).name);
}
const stageSelect=page=>page.locator('#wdStage [data-stage-select]');

for(const width of [390,1280])test(`단계 저장·이력·목록 꼬리표 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width});
 await openOrg(page,'oa',width);
 const line=page.locator('#wdStage');
 await expect(line).toContainText('쟁의 단계');await expect(stageSelect(page)).toHaveValue('stage-1');
 await expect(line.locator('[data-stage-save]')).toBeDisabled();
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
 await expect(line.locator('[data-stage-save]')).toBeDisabled();
 expect(db.history).toHaveLength(1);expect(db.history[0].stage_date).toBe('2026-10-03');
 // 끝남: 이번 주(10.5~10.11)에 끝나면 꼬리표, 지난 주에 끝난 건 없음
 await stageSelect(page).selectOption({label:'협약체결'});await line.locator('[data-stage-date]').fill('2026-10-05');await line.locator('[data-stage-save]').click();
 await expect(line.locator('summary')).toHaveText('단계 이력 2');
 await expect(row(page,'oa').locator('.so-stage-tag')).toHaveText('협약체결');await expect(row(page,'oa').locator('.so-stage-tag')).toHaveClass(/is-end/);
 await stageSelect(page).selectOption({label:'종료'});await line.locator('[data-stage-date]').fill('2026-10-02');await line.locator('[data-stage-save]').click();
 await expect(line.locator('summary')).toHaveText('단계 이력 3');
 await expect(row(page,'oa').locator('.so-stage-tag')).toHaveCount(0);
 await line.locator('summary').click();
 await expect(line.locator('details')).toContainText('10.2 종료');await expect(line.locator('details')).toContainText('10.5 협약체결');await expect(line.locator('details')).toContainText('10.3 쟁의발생 결의');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`쟁의 단계 관리: 추가·이름·투쟁 중·순서·지우기(기본 단계로 이동) ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width});
 await openOrg(page,'oa',width);
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
 await openOrg(page,'oa',width);
 await expect(page.locator('#wdStage [data-stage-preparing]')).toHaveText('준비 중');
 await expect(page.locator('#wdStage select')).toHaveCount(0);
 await expect(page.locator('#soOrganizationList .so-stage-tag')).toHaveCount(0);await expect(row(page,'ob')).toBeVisible();
 await page.locator('#soTeamMore').click();await page.locator('#soTeamMenu [data-so-stage-manage]').click();
 await expect(page.locator('#soStageBody [data-stage-preparing]')).toBeVisible();
 expect(errors).toEqual([]);
});
