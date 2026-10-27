import {showBasketRow} from './helpers/basket-more.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UPD-요약부품통일 A·C: 업데이트 [연결하기]에서 참고 묶음에도 [AI 요약], 사진·파일 업데이트에는 [요약해서 기록으로].
// ai-assist·Supabase는 모두 가짜. 합성 ID·글만 쓴다.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-24T01:00:00Z';
const n='10000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001',o='30000000-0000-4000-8000-000000000001',b='50000000-0000-4000-8000-000000000001';
const AI_TEXT='합성 공문 11월 3일 교섭 예정, 참석 5명.';
const resourceNoise=text=>/Failed to load resource|net::ERR_FAILED/.test(text);
const ocr=(text,state='done')=>({state,attempt_id:'90000000-0000-4000-8000-000000000001',original_file_id:'photo1',cleanup_state:state==='reading'?'none':'deleted',...(state==='reading'?{}:{temp_document_id:'tmp1',text})});
const photo=(i,o)=>({drive_file_id:'photo'+i,file_name:`사진${i}.jpg`,mime_type:'image/jpeg',size_bytes:10,ocr:{...o,original_file_id:'photo'+i}});

async function fixture(page,{note:over={},docs=[],brief=[]}={}){
 await openHome(page);const errors=[],calls=[],ai=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!resourceNoise(e.text()))errors.push(e.text());});
 const note={id:n,workspace_id:'w',kind:'basket',occurred_at:stamp,updated_at:stamp,raw_text:'합성 소식 본문',ai_export_allowed:true,archived_at:null,attachments:[],...over};
 const tables={app_notes:[note],app_suborganizations:[{id:o,workspace_id:'w',name:'합성 한빛지부',active:true}],app_suborganization_assignees:[{organization_id:o,user_id:'home-test'}],
  app_spaces:[{id:p,workspace_id:'w',owner_id:'home-test',name:'합성 교섭',status:'active',metadata:{project_system:'v2'}}],app_suborganization_updates:[],
  app_reference_bundles:[{id:b,workspace_id:'w',name:'철도 안전',sort_order:10,created_at:stamp}],app_documents:docs,app_document_ai_index:brief};
 for(const [table,items] of Object.entries(tables))await page.route(SB+'/rest/v1/'+table+'?**',route=>{
  const q=new URL(route.request().url()).searchParams;let rows=items;
  for(const key of ['id','organization_id','document_id']){const filter=q.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
  return route.fulfill({json:rows});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',route=>route.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',route=>{const body=route.request().postDataJSON();calls.push(body);return route.fulfill({json:{ok:true,created:body.p_targets.length,existing:0}});});
 const queue=[];
 await page.route(SB+'/functions/v1/ai-assist',route=>{
  if(route.request().method()!=='POST')return route.fulfill({status:204});
  ai.push(route.request().postDataJSON());
  const next=queue.shift()||{status:200,json:{ok:true,kind:'link_summary',summary:AI_TEXT}};
  return route.fulfill({status:next.status,json:next.json});
 });
 return {calls,ai,errors,queue};
}
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);}else await locator.click();}
async function openLink(page,width){
 await page.evaluate(()=>window.KPTURouter.go('basket'));await showBasketRow(page,n);
 await tap(page,page.locator(`[data-basket-row="${n}"]`),width);
 const detail=page.locator('[data-basket-detail]');
 await tap(page,detail.getByRole('button',{name:/연결하기|자료로 넣기/}).first(),width);
 return detail;
}
async function pick(page,detail,kind,name,width){
 await tap(page,detail.locator(`[data-manual-pick="${kind}"]`),width);
 const sheet=page.locator('#basketLinkChoiceSheet');await expect(sheet).toBeVisible();
 await tap(page,sheet.getByRole('button',{name,exact:true}),width);
 const save=sheet.getByRole('button',{name:/^저장/});if(await save.isVisible().catch(()=>false))await tap(page,save,width);
 await expect(sheet).toBeHidden();
}
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280])test(`A: 참고 묶음 요약 칸에도 [AI 요약] — 빈 칸은 바로 채우고 [연결]이 저장 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page),detail=await openLink(page,width);
 await pick(page,detail,'reference','철도 안전',width);
 const key=`reference:${b}`,box=detail.locator(`[data-manual-summary="${key}"]`);
 await expect(box).toHaveValue('');
 await tap(page,detail.locator(`[data-manual-ai-run="${key}"]`),width);
 await expect(box).toHaveValue(AI_TEXT);
 expect(f.ai).toEqual([{kind:'link_summary',note_id:n,target_kind:'reference',target_id:b}]);
 expect(f.calls).toEqual([]);expect(await noWideScroll(page)).toBe(true);
 await tap(page,detail.getByRole('button',{name:'연결',exact:true}),width);await expect(detail.locator('[data-basket-status]')).toContainText('1곳에 연결했어요.');
 expect(f.calls[0].p_targets).toEqual([{kind:'reference',target_id:b,reason:'직접 연결',summary:AI_TEXT}]);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`C: 사진 여러 장 업데이트 → [요약해서 기록으로] 한 번으로 기록 칸에 채우고, 다시 눌러도 AI는 한 번 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const f=await fixture(page,{note:{raw_text:'',attachments:[photo(1,ocr('공문 1쪽')),photo(2,ocr('공문 2쪽'))]}}),detail=await openLink(page,width);
 await pick(page,detail,'organization','합성 한빛지부',width);
 const key=`organization:${o}`,run=detail.locator(`[data-manual-files-run="${key}"]`);
 await expect(run).toHaveText('요약해서 기록으로');
 // 글 없이 사진만 있는 업데이트: 처음엔 [자료로 넣기]만(기록 끔). 버튼을 누르면 기록이 켜지고 칸이 채워진다.
 await tap(page,run,width);
 const box=detail.locator(`[data-manual-summary="${key}"]`);await expect(box).toHaveValue(AI_TEXT);
 expect(f.ai).toEqual([{kind:'link_summary',note_id:n,use:'files',target_kind:'organization',target_id:o}]);
 if(width===390)await page.screenshot({path:test.info().outputPath('files-summary-390.png'),fullPage:true});
 await box.fill('사용자가 고친 기록');
 await tap(page,detail.locator(`[data-manual-files-run="${key}"]`),width);
 await expect(detail.locator('[data-manual-files-proposal]')).toContainText(AI_TEXT);await expect(box).toHaveValue('사용자가 고친 기록');
 expect(f.ai).toHaveLength(1);expect(await noWideScroll(page)).toBe(true);
 await tap(page,detail.getByRole('button',{name:'연결',exact:true}),width);
 await expect.poll(()=>f.calls.length).toBe(1);
 expect(f.calls[0].p_targets).toEqual([{kind:'organization',target_id:o,reason:'직접 연결',summary:'사용자가 고친 기록'}]);
 expect(f.errors).toEqual([]);
});

test('C: 사진 글자를 읽는 중이면 버튼 대신 "글자 읽는 중", 글자가 없으면 버튼 없음',async({page})=>{
 const f=await fixture(page,{note:{raw_text:'본문',attachments:[photo(1,ocr('1쪽')),photo(2,ocr('','reading'))]}}),detail=await openLink(page,1280);
 await pick(page,detail,'project','합성 교섭',1280);
 const key=`project:${p}`;
 await expect(detail.locator(`[data-manual-target="${key}"] [data-manual-files-status]`)).toHaveText('글자 읽는 중');
 await expect(detail.locator(`[data-manual-files-run="${key}"]`)).toHaveCount(0);
 expect(f.ai).toEqual([]);expect(f.errors).toEqual([]);
});

test('C: 사진이 없는 글 업데이트에는 [요약해서 기록으로]가 없다',async({page})=>{
 const f=await fixture(page),detail=await openLink(page,1280);
 await pick(page,detail,'organization','합성 한빛지부',1280);
 await expect(detail.locator('[data-manual-files-run]')).toHaveCount(0);
 await expect(detail.locator(`[data-manual-ai-run="organization:${o}"]`)).toBeVisible();
 expect(f.errors).toEqual([]);
});

test('C·③: 한글 파일 하나가 이미 자료이고 올릴 때 만든 요약이 있으면 AI 없이 그 요약을 칸에 넣는다',async({page})=>{
 const doc='60000000-0000-4000-8000-000000000001';
 const f=await fixture(page,{note:{raw_text:'',attachments:[{drive_file_id:'hwp1',file_name:'공문.hwp',mime_type:'application/x-hwp',size_bytes:10}]},
  docs:[{id:doc,workspace_id:'w',title:'공문',project_id:null,organization_id:null,file_id:'hwp1',category:null}],
  brief:[{document_id:doc,content_hash:'b1:'+'a'.repeat(32),summary:'자료 올릴 때 만든 요약.'}]}),detail=await openLink(page,1280);
 await pick(page,detail,'organization','합성 한빛지부',1280);
 await detail.locator(`[data-manual-files-run="organization:${o}"]`).click();
 await expect(detail.locator(`[data-manual-summary="organization:${o}"]`)).toHaveValue('자료 올릴 때 만든 요약.');
 expect(f.ai).toEqual([]);expect(f.errors).toEqual([]);
});

test('C: 읽은 글자가 없다는 서버 답은 칸을 그대로 두고 한 줄 안내',async({page})=>{
 const f=await fixture(page,{note:{raw_text:'',attachments:[{drive_file_id:'pdf1',file_name:'스캔.pdf',mime_type:'application/pdf',size_bytes:10}]}}),detail=await openLink(page,1280);
 await pick(page,detail,'organization','합성 한빛지부',1280);
 f.queue.push({status:422,json:{ok:false,error:'no_file_text'}});
 await detail.locator(`[data-manual-files-run="organization:${o}"]`).click();
 await expect(detail.locator(`[data-manual-target="organization:${o}"] [data-manual-files-status]`)).toHaveText('요약할 글자가 없어요. 직접 써 주세요.');
 await expect(detail.locator(`[data-manual-summary="organization:${o}"]`)).toHaveValue('');
 expect(f.errors).toEqual([]);
});

// ---- B①: 사업 보고 수정 창 — 연결한 곳마다 요약 칸 + [AI 요약](재료 = 이 사업 보고 본문), 저장은 [수정 저장] ----
import {signInWithSession} from './helpers/session-login.mjs';
import {openMeetingResult,mrdMenu} from './helpers/meeting-open.mjs';
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const MID='70000000-0000-4000-8000-000000000001',PROJ='70000000-0000-4000-8000-000000000002',LINK='70000000-0000-4000-8000-000000000003';
const meeting={id:MID,workspace_id:'meeting-ws',project_id:PROJ,title:'궤도협의회',series_name:'궤도협의회',round_no:3,meeting_at:'2026-10-20T05:00:00Z',
 notes:'',decisions:null,transcript_text:'1. 11월 총회 개최 예정(미확정).',created_by:'meeting-user',updated_at:'2026-10-20T06:00:00Z'};
async function meetingFixture(page,{linkSummary=null}={}){
 const sets=[],ai=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(`${SB}/**`,async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
  const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
  if(path==='/auth/v1/token')return ok({access_token:'meeting-access',refresh_token:'meeting-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'meeting-user'}});
  if(path==='/auth/v1/user')return ok({id:'meeting-user',email:'meeting@example.org'});
  if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'meeting-ws',user_id:'meeting-user',role:'owner',workspace:{id:'meeting-ws',name:'QA'}}]);
  if(path==='/rest/v1/app_workspaces')return ok([{id:'meeting-ws',name:'QA'}]);
  if(path==='/rest/v1/app_spaces')return ok([{id:PROJ,workspace_id:'meeting-ws',name:'합성 교섭',parent_id:null,status:'active',owner_id:'meeting-user',metadata:{project_system:'v2'},sort_order:10}]);
  if(path==='/rest/v1/app_meetings'){if(method==='PATCH')return ok([{...meeting,updated_at:'2026-10-24T01:00:00Z'}]);return ok([meeting]);}
  if(path==='/rest/v1/app_record_links'){
   if(url.searchParams.get('source_meeting_id')?.startsWith('eq.'))return ok([{id:LINK,project_id:PROJ,organization_id:null,summary:linkSummary}]);
   if(url.searchParams.get('select')==='source_meeting_id')return ok([]);
   return ok([{id:LINK,source_meeting_id:MID,project_id:PROJ,organization_id:null,summary:linkSummary}]);
  }
  if(path==='/rest/v1/rpc/app_meeting_set_links'){sets.push(req.postDataJSON());return ok({ok:true,created:0,existing:1,removed:0,updated_at:'2026-10-24T01:00:01Z'});}
  if(path==='/functions/v1/ai-assist'){if(method!=='POST')return route.fulfill({status:204});ai.push(req.postDataJSON());return ok({ok:true,kind:'link_summary',summary:'궤도협의회 3차, 11월 총회 개최 예정(미확정).'});}
  if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
  if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
  if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(path.startsWith('/rest/v1/rpc/'))return ok(null);
  if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
  return ok({});
 });
 await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(`${BASE}/app/?view=meetings`)}`);
 await signInWithSession(page,'meeting@example.org');
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
 return {sets,ai,errors};
}
for(const width of [390,1280])test(`B①: 사업 보고 연결 곳마다 요약 칸 — [AI 요약]이 빈 칸을 채우고 [수정 저장]이 그 곳 요약으로 저장 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await meetingFixture(page);
 await openMeetingResult(page,MID);await mrdMenu(page,'edit');
 const box=page.locator(`[data-report-summary-input="project:${PROJ}"]`);await expect(box).toBeVisible();await expect(box).toHaveValue('');
 await page.locator(`[data-report-ai-run="project:${PROJ}"]`).click();
 await expect(box).toHaveValue('궤도협의회 3차, 11월 총회 개최 예정(미확정).');
 expect(f.ai).toEqual([{kind:'link_summary',meeting_id:MID,target_kind:'project',target_id:PROJ}]);
 if(width===390)await page.screenshot({path:test.info().outputPath('report-summary-390.png')});
 expect(f.sets).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await box.fill('고친 요약');await page.locator('#mrdSaveEdit').click();
 await expect.poll(()=>f.sets.length).toBe(1);
 expect(f.sets[0].p_targets).toEqual([{kind:'project',target_id:PROJ,summary:'고친 요약'}]);
 expect(f.errors).toEqual([]);
});
test('B①: 저장된 요약은 칸에 그대로 보이고, 고치지 않고 저장하면 연결 저장을 다시 보내지 않는다',async({page})=>{
 const f=await meetingFixture(page,{linkSummary:'이미 보낸 요약'});
 await openMeetingResult(page,MID);await mrdMenu(page,'edit');
 await expect(page.locator(`[data-report-summary-input="project:${PROJ}"]`)).toHaveValue('이미 보낸 요약');
 await page.locator('#mrdSaveEdit').click();await expect(page.locator('#mrdEditor')).toBeHidden();
 expect(f.sets).toEqual([]);expect(f.ai).toEqual([]);expect(f.errors).toEqual([]);
});
