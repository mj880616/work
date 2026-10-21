import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// AI-서버연동 S7-c: [원장] 화면의 원장 후보 칸과 원장 목록·검색 칸. Supabase·ai-assist는 시험 상태로 대신한다(가상 값만).
// 후보: [원장 후보 만들기](ai-assist kind만) → [확정](확정 RPC, p_edit 없음) / [고쳐서 확정](p_edit) / [버림](대기 후보 상태만).
// 목록·검색: 검색 RPC(기본 업무만) → 걸러보기 → 행 상세(칸·출처·연결). 표·함수가 없으면 두 칸 모두 조용히 숨는다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ledger-c-user',email:'ledger-c@example.org',user_metadata:{display_name:'Ledger QA'}};
const workspace={id:'ledger-c-workspace',slug:'ledger-c',name:'웹2'};
const ZERO='00000000-0000-0000-0000-000000000000';
const u=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ORG=u(50),TOPIC=u(60),SRC=u(70);

function records(){
 return [
  {id:u(1),workspace_id:workspace.id,kind:'event',ledger_id:'EVT-0901',title:'가상 노선 교섭',summary:'가 지부 교섭 진행.',scope:'work',topic_id:TOPIC,sensitivity:'S1',importance:'high',validity:'current',
   date_start:'2026-09-01',date_end:null,date_precision:'month',date_note:'2026-09',event_status:'tracking',note:'',superseded_by:null},
  {id:u(2),workspace_id:workspace.id,kind:'change',ledger_id:'CHG-0901',title:'가상 교섭 2차 일정 확정',summary:'2차 교섭 날짜 확정.',scope:'work',topic_id:null,sensitivity:'S2',importance:'normal',validity:'current',
   date_start:'2026-10-20',date_end:null,date_precision:'day',date_note:'',note:'가상 비고',superseded_by:null},
  {id:u(3),workspace_id:workspace.id,kind:'commitment',ledger_id:'COM-0901',title:'가상 기관 자료 회신',summary:'',scope:'work',topic_id:null,sensitivity:'S1',importance:'normal',validity:'current',
   date_start:null,date_end:null,date_precision:'unknown',date_note:'',counterparty:'가상 기관',commitment_status:'waiting',follow_up_on:'2026-10-01',note:'',superseded_by:null},
  {id:u(4),workspace_id:workspace.id,kind:'event',ledger_id:'EVT-0905',title:'가상 관심 소식',summary:'업무 밖 소식.',scope:'interest',topic_id:null,sensitivity:'S0',importance:'low',validity:'current',
   date_start:null,date_end:null,date_precision:'unknown',date_note:'',event_status:'watching',note:'',superseded_by:null}
 ];
}
function candidates(){
 return [
  {id:u(101),origin:'web2_ai',status:'pending',action:'new',kind:'event',target_record_id:null,title:'가 지부 임금교섭 시작.',sensitivity:'S1',dedup_key:'web2:basket:x:a',import_id:null,created_at:'2026-10-21T01:00:00Z',
   payload:{record:{summary:'가 지부와 임금교섭 시작 합의.',date_start:'2026-10-20',date_precision:'day'},sources:[{new:{title:'Web2 업데이트 2026-10-20',doc_type:'internal_doc',location:'web2:basket:x',source_date:'2026-10-20'}}],links:[{target_organization:'ORG-0901',relation:'direct'}],origin_ref:{kind:'basket',id:u(900),day:'2026-10-20'}}},
  {id:u(102),origin:'web2_ai',status:'pending',action:'new',kind:'commitment',target_record_id:null,title:'상대 자료 제공 약속.',sensitivity:'S1',dedup_key:'web2:meeting:y:b',import_id:null,created_at:'2026-10-21T00:59:00Z',
   payload:{record:{summary:'다음 주까지 자료 제공.'},sources:[],links:[{target_meeting_id:u(901)}],origin_ref:{kind:'meeting',id:u(901),day:'2026-10-20'}}},
  {id:u(103),origin:'claude_import',status:'pending',action:'new',kind:'change',target_record_id:null,title:'가상 깨진 연결 후보',sensitivity:'S1',dedup_key:null,import_id:u(800),created_at:'2026-10-20T00:00:00Z',
   payload:{record:{summary:'없는 사건에 소속.'},links:[{target_record:'EVT-0999',relation:'belongs_to'}]}}
 ];
}

async function mockApp(page,{ready=true}={}){
 const db={records:records(),candidates:candidates(),search:[],confirm:[],patch:[],ai:[],queue:[]};
 await page.route(`${SB}/**`,async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
  const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
  const missing=()=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST205',message:'Could not find the table in the schema cache'})});
  const noFn=()=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST202',message:'Could not find the function'})});
  const fail=(status,message)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({message})});
  if(path==='/auth/v1/token')return ok({access_token:'ledger-c-access',refresh_token:'ledger-c-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  if(path==='/auth/v1/user')return ok(user);
  if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
  if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[]});
  if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(path==='/functions/v1/ai-assist'){
   const body=request.postDataJSON();db.ai.push(request.postData());
   if(body.kind!=='ledger_candidates')return ok({ok:false,error:'unsupported_kind'},400);
   db.candidates.unshift({...candidates()[0],id:u(104),title:'AI가 새로 찾은 가상 결정.',kind:'decision',created_at:'2026-10-21T02:00:00Z'});
   return ok({ok:true,kind:'ledger_candidates',added:1,found:1,excluded:1,partial:false,checked_at:new Date().toISOString()});
  }
  if(path.startsWith('/functions/v1/'))return ok({});
  if(path==='/rest/v1/rpc/app_import_ledger_counts')return ok(null);
  if(path==='/rest/v1/rpc/app_ledger_search'){
   if(!ready)return noFn();
   const a=request.postDataJSON();db.search.push(a);
   const words=a.p_query.toLowerCase().split(/\s+/).filter(Boolean);
   const rows=db.records.filter(r=>(a.p_scope===null||r.scope===a.p_scope)&&(!a.p_kinds||a.p_kinds.includes(r.kind))
     &&(!a.p_organization_id||r.id===u(1))&&words.every(w=>(r.ledger_id+' '+r.title+' '+r.summary).toLowerCase().includes(w)))
    .map(r=>({id:r.id,ledger_id:r.ledger_id,kind:r.kind,title:r.title,summary:r.summary,date_start:r.date_start,date_end:r.date_end,date_precision:r.date_precision,
     validity:r.validity,sensitivity:r.sensitivity,topic_name:r.topic_id?'가상 주제':null,organizations:r.id===u(1)?['가 지부']:[],score:0}));
   return ok(rows.slice(0,a.p_limit));
  }
  if(path==='/rest/v1/rpc/app_confirm_ledger_candidate'){
   if(!ready)return noFn();
   const a=request.postDataJSON();
   if(a.p_candidate_id===ZERO)return fail(400,'LEDGER_CANDIDATE_NOT_FOUND');
   db.confirm.push(a);
   const c=db.candidates.find(x=>x.id===a.p_candidate_id);
   if(!c||c.status!=='pending')return fail(500,'LEDGER_CANDIDATE_DECIDED: this candidate was already confirmed or discarded');
   if(c.id===u(103))return fail(409,'LEDGER_CANDIDATE_BROKEN_REF: record EVT-0999');
   if(c.kind==='commitment'&&!a.p_edit?.payload?.record?.counterparty)return fail(400,'LEDGER_CANDIDATE_BAD_RECORD: app_ledger_records_commitment_check');
   c.status='confirmed';
   const ledger_id=c.kind==='commitment'?'COM-0902':'EVT-0910';
   db.records.push({id:u(10+db.records.length),workspace_id:workspace.id,kind:c.kind,ledger_id,title:a.p_edit?.title||c.title,summary:'',scope:'work',topic_id:null,sensitivity:'S1',importance:'normal',validity:'current',date_start:null,date_end:null,date_precision:'unknown',date_note:'',note:''});
   return ok({candidate_id:c.id,status:'confirmed',action:'new',record_id:u(99),ledger_id,sources_added:1,links_added:1});
  }
  if(path==='/rest/v1/rpc/app_queue_ledger_candidates'){
   if(!ready)return noFn();
   const a=request.postDataJSON();
   if(a.p_workspace_id===ZERO)return fail(403,'LEDGER_QUEUE_NOT_OWNER');
   db.queue.push(request.postData());
   const n=a.p_file.candidates.length;
   if(!a.p_dry_run)for(const [i,c] of a.p_file.candidates.entries())db.candidates.push({id:u(200+i),origin:'claude_import',status:'pending',action:c.action||'new',kind:c.kind,target_record_id:null,title:c.title,sensitivity:c.sensitivity||'S1',dedup_key:null,import_id:u(801),created_at:'2026-10-19T00:00:00Z',payload:c.payload||{}});
   return ok({import_id:a.p_dry_run?null:u(801),status:a.p_dry_run?'dry_run':'confirmed',dry_run:a.p_dry_run,candidates:n,added:n,skipped:0});
  }
  if(path.startsWith('/rest/v1/rpc/'))return ok(null);
  if(path==='/rest/v1/app_ledger_candidates'){
   if(method==='PATCH'){
    const body=request.postDataJSON();db.patch.push({query:decodeURIComponent(url.search),body});
    const ids=(url.searchParams.get('id')||'').replace(/^in\.\(|\)$/g,'').split(',');
    const hit=db.candidates.filter(c=>ids.includes(c.id)&&c.status==='pending');
    for(const c of hit)Object.assign(c,body);
    return ok(hit.map(c=>({id:c.id,status:c.status})));
   }
   return ok(db.candidates.filter(c=>c.status==='pending'));
  }
  if(path==='/rest/v1/app_ledger_records'){
   const id=url.searchParams.get('id')||'';
   if(id.startsWith('eq.'))return ok(db.records.filter(r=>r.id===id.slice(3)));
   if(id.startsWith('in.')){const ids=id.slice(4,-1).split(',');return ok(db.records.filter(r=>ids.includes(r.id)).map(({id,ledger_id,title,kind})=>({id,ledger_id,title,kind})));}
   return ok([]);
  }
  if(path==='/rest/v1/app_ledger_organizations')return ok([{id:ORG,ledger_id:'ORG-0901',name:'가 지부'}]);
  if(path==='/rest/v1/app_ledger_topics')return ok([{id:TOPIC,ledger_id:'TOP-0901',name:'가상 주제'}]);
  if(path==='/rest/v1/app_ledger_record_sources'){
   const rec=(url.searchParams.get('record_id')||'').slice(3);
   return ok(rec===u(2)?[{id:u(80),source_id:SRC,locator:'2쪽',note:''}]:[]);
  }
  if(path==='/rest/v1/app_ledger_sources')return ok([{id:SRC,ledger_id:'SRC-0901',title:'가상 공문',doc_type:'official_letter',location:'https://example.org/virtual-letter',drive_file_id:null,source_date:'2026-10-19',sensitivity:'S1',status:'active'}]);
  if(path==='/rest/v1/app_ledger_links'){
   const rec=url.searchParams.get('record_id'),target=url.searchParams.get('target_record_id');
   if(rec===`eq.${u(2)}`)return ok([{id:u(81),record_id:u(2),target_record_id:u(1),target_organization_id:null,target_project_id:null,target_meeting_id:null,relation:'belongs_to',note:''},
     {id:u(82),record_id:u(2),target_record_id:null,target_organization_id:ORG,target_project_id:null,target_meeting_id:null,relation:'direct',note:''}]);
   if(target===`eq.${u(1)}`)return ok([{id:u(81),record_id:u(2),target_record_id:u(1),relation:'belongs_to',note:''}]);
   return ok([]);
  }
  if(path.startsWith('/rest/v1/app_ledger_'))return ok([]);
  if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
  if(path==='/rest/v1/app_workspaces')return ok([workspace]);
  if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'Ledger QA',job_title:''}]);
  if(path.startsWith('/rest/v1/'))return ok([]);
  return ok({});
 });
 return db;
}
async function signIn(page){
 await page.goto(testOrigin+'/app/?view=ledger');
 await enterLogin(page);
 await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:10000});
 await signInWithSession(page,user.email);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
 await expect(page.locator('#ledgerView')).toBeVisible({timeout:15000});
}
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);

for(const [name,width] of [['PC',1440],['phone',390]]){
 test(`원장 목록·검색: 기본은 업무만, 종류·범위 걸러보기, 행 상세의 근거·출처·연결 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  await expect(browse).toHaveAttribute('data-ledger-browse','ready',{timeout:15000});
  await expect(browse.locator('[data-lb-row]')).toHaveCount(3);
  expect(db.search[0]).toMatchObject({p_query:'',p_kinds:null,p_scope:'work',p_include_inactive:false,p_limit:50});
  await expect(browse.locator('[data-lb-row="'+u(4)+'"]')).toHaveCount(0);
  await expect(browse.locator('[data-lb-row="'+u(1)+'"]')).toContainText('2026-09');
  // 종류: 약속만.
  await browse.locator('input[name="lbKind"][value="commitment"]').check();
  await expect(browse.locator('[data-lb-row]')).toHaveCount(1);
  expect(db.search.at(-1).p_kinds).toEqual(['commitment']);
  await browse.locator('[data-lb-row="'+u(3)+'"] [data-lb-action="open"]').click();
  await expect(browse.locator('#lbDetail-'+u(3))).toContainText('기한 지남');
  await expect(browse.locator('#lbDetail-'+u(3))).toContainText('가상 기관');
  // 조건 지우기 → 범위 업무 + 관심.
  await browse.locator('[data-lb-action="clear"]').click();
  await browse.locator('#lbScope').selectOption('all');
  await expect(browse.locator('[data-lb-row]')).toHaveCount(4);
  expect(db.search.at(-1).p_scope).toBe(null);
  // 찾을 말 + 찾기.
  await browse.locator('#lbQuery').fill('2차');
  await browse.locator('#lbForm button[type="submit"]').click();
  await expect(browse.locator('[data-lb-row]')).toHaveCount(1);
  const head=browse.locator('[data-lb-row="'+u(2)+'"] [data-lb-action="open"]');
  await expect(head).toContainText('S2 교섭·전략');
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded','true');
  const detail=browse.locator('#lbDetail-'+u(2));
  await expect(detail.locator('[data-lb-sources] a')).toHaveAttribute('href','https://example.org/virtual-letter');
  await expect(detail.locator('[data-lb-sources]')).toContainText('근거위치 2쪽');
  await expect(detail.locator('[data-lb-links]')).toContainText('소속');
  await expect(detail.locator('[data-lb-links]')).toContainText('가 지부');
  await expect(detail).toContainText('가상 비고');
  // 연결된 기록 ID를 누르면 그 ID로 찾는다(대체·폐기·관심 포함).
  await detail.locator('[data-lb-action="find"]').click();
  await expect(browse.locator('#lbQuery')).toHaveValue('EVT-0901');
  await expect(browse.locator('[data-lb-row]')).toHaveCount(1);
  expect(db.search.at(-1)).toMatchObject({p_query:'EVT-0901',p_include_inactive:true,p_scope:null});
  expect(await noSideScroll(page)).toBe(true);
 });

 test(`원장 목록·검색: 종류·대체 보기 체크 칸은 글자와 같은 줄의 같은 크기이고 다른 칸 줄과 높이가 맞는다 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});
  await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  await expect(browse).toHaveAttribute('data-ledger-browse','ready',{timeout:15000});
  const box=l=>l.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}});
  const kinds=browse.locator('input[name="lbKind"]'),inactive=browse.locator('#lbInactive');
  expect(await kinds.count()).toBe(5);
  const inputs=[];
  for(const input of [...await kinds.all(),inactive]){
   const check=await box(input),label=await box(input.locator('xpath=ancestor::label[1]')),text=await box(input.locator('xpath=following-sibling::span'));
   // 체크 칸은 작은 정사각형(12~24px), 글자 줄과 같은 줄(세로 중심이 글자와 6px 안), 칸 안쪽에 있다.
   expect(check.w).toBeGreaterThanOrEqual(12);expect(check.w).toBeLessThanOrEqual(24);
   expect(Math.abs(check.w-check.h)).toBeLessThanOrEqual(1);
   expect(Math.abs((check.y+check.h/2)-(text.y+text.h/2))).toBeLessThanOrEqual(6);
   expect(check.y).toBeGreaterThanOrEqual(label.y-1);expect(check.y+check.h).toBeLessThanOrEqual(label.y+label.h+1);
   inputs.push({check,label});
  }
  // 모든 체크 칸 크기 통일, 글자 칸 높이 통일.
  for(const i of inputs){expect(Math.abs(i.check.w-inputs[0].check.w)).toBeLessThanOrEqual(0.5);expect(Math.abs(i.label.h-inputs[0].label.h)).toBeLessThanOrEqual(0.5)}
  // 칩 높이는 같은 줄의 작은 버튼([조건 지우기])과 같고, 대체·폐기 칩과 그 버튼은 세로 중심이 같다. 종류 다섯 개는 PC에서 한 줄.
  const clear=await box(browse.locator('[data-lb-action="clear"]'));
  expect(Math.abs(inputs[0].label.h-clear.h)).toBeLessThanOrEqual(1);
  expect(Math.abs((inputs[5].label.y+inputs[5].label.h/2)-(clear.y+clear.h/2))).toBeLessThanOrEqual(1);
  const rows=new Set(inputs.slice(0,5).map(i=>Math.round(i.label.y)));
  expect(rows.size).toBeLessThanOrEqual(width>=1000?1:2);
  // 날짜·조직 칸의 줄과 겹치지 않는다(종류 줄이 먼저, 그 아래 칸 줄).
  const from=await box(browse.locator('#lbFrom'));
  expect(Math.max(...inputs.slice(0,5).map(i=>i.label.y+i.label.h))).toBeLessThanOrEqual(from.y);
  // 체크하면 눌린 모양이 바뀌고(aria 대신 :checked), 글자를 눌러도 체크된다.
  await browse.locator('input[name="lbKind"][value="decision"]').locator('xpath=ancestor::label[1]').click();
  await expect(browse.locator('input[name="lbKind"][value="decision"]')).toBeChecked();
  await expect(browse.locator('[data-lb-shell]')).toHaveCount(1);
  expect(await noSideScroll(page)).toBe(true);
 });
}

test('원장 후보: 만들기 → 확정 → 고쳐서 확정 → 버림, 거절은 이유를 보이고 후보를 남긴다 (phone 390px)',async({page})=>{
 test.setTimeout(90000);
 await page.setViewportSize({width:390,height:900});
 const db=await mockApp(page);
 page.on('dialog',dialog=>dialog.accept());
 await signIn(page);
 const box=page.locator('#ledgerCandidatesRoot');
 await expect(box).toHaveAttribute('data-ledger-candidates','ready',{timeout:15000});
 await expect(box.locator('[data-lc-row]')).toHaveCount(3);
 await expect(box.locator('[data-lc-row="'+u(101)+'"]')).toContainText('Web2 원래 기록: 업데이트 2026-10-20');
 await expect(box.locator('[data-lc-row="'+u(101)+'"]')).toContainText('직접관련 ORG-0901');

 // [원장 후보 만들기]: ai-assist에는 kind 하나만 간다.
 await box.locator('[data-lc-action="make"]').click();
 await expect(box).toContainText('새 원장 후보 1건을 더했어요. 민감(S3·개인정보)으로 1건은 넣지 않았어요.');
 expect(db.ai).toEqual([JSON.stringify({kind:'ledger_candidates'})]);
 await expect(box.locator('[data-lc-row]')).toHaveCount(4);

 // [확정]: 고침 없이 확정 RPC 한 번. 목록·검색 칸도 다시 읽는다.
 const searches=db.search.length;
 await box.locator('[data-lc-row="'+u(101)+'"] [data-lc-action="confirm"]').click();
 await expect(box).toContainText('EVT-0910(으)로 원장에 넣었습니다.');
 await expect(box.locator('[data-lc-row="'+u(101)+'"]')).toHaveCount(0);
 expect(db.confirm.at(-1)).toEqual({p_candidate_id:u(101),p_edit:null});
 await expect.poll(()=>db.search.length).toBeGreaterThan(searches);

 // 거절: 이유를 보이고 후보는 남는다.
 await box.locator('[data-lc-row="'+u(103)+'"] [data-lc-action="confirm"]').click();
 await expect(box.locator('[data-lc-error]')).toContainText('원장에 없는 ID를 가리킵니다. (record EVT-0999)');
 await expect(box.locator('[data-lc-row="'+u(103)+'"]')).toHaveCount(1);

 // [고쳐서 확정]: 약속은 상대측이 있어야 한다(화면이 먼저 막음) → 써 넣고 확정.
 const row=box.locator('[data-lc-row="'+u(102)+'"]');
 await row.locator('[data-lc-action="edit"]').click();
 const form=row.locator('form[data-lc-form]');
 await expect(form.locator('[name="title"]')).toBeFocused();
 await form.locator('[name="title"]').fill('가상 기관 자료 제공 약속.');
 await form.locator('[data-lc-action="save"]').click();
 await expect(form.locator('[data-lc-form-error]')).toContainText('상대측');
 await form.locator('[name="counterparty"]').fill('가상 기관');
 await form.locator('[name="follow_up_on"]').fill('2026-10-28');
 await form.locator('[name="sensitivity"]').selectOption('S2');
 await form.locator('[data-lc-action="save"]').click();
 await expect(box).toContainText('COM-0902(으)로 원장에 넣었습니다.');
 const edit=db.confirm.at(-1).p_edit;
 expect(edit.title).toBe('가상 기관 자료 제공 약속.');
 expect(edit.sensitivity).toBe('S2');
 expect(edit.payload.record).toMatchObject({summary:'다음 주까지 자료 제공.',counterparty:'가상 기관',follow_up_on:'2026-10-28',commitment_status:'waiting'});
 expect(edit.payload.links).toEqual([{target_meeting_id:u(901)}]);

 // [버림]: 이유(선택)와 함께 대기 후보만.
 await box.locator('[data-lc-row="'+u(103)+'"] [data-lc-action="discard"]').click();
 await expect(page.locator('#lcReason-'+u(103))).toBeFocused();
 await page.locator('#lcReason-'+u(103)).fill('없는 사건');
 await box.locator('[data-lc-action="discard-yes"]').click();
 await expect(box).toContainText('후보 1건을 버렸습니다.');
 expect(db.patch.at(-1).query).toContain('status=eq.pending');
 expect(db.patch.at(-1).body).toMatchObject({status:'discarded',discard_reason:'없는 사건'});
 await expect(box.locator('[data-lc-row]')).toHaveCount(1);
 expect(await noSideScroll(page)).toBe(true);
});

test('Claude 후보 파일: S3는 빼고 해 보기 → 후보로 넣기, 넣은 후보는 후보 칸에 보인다 (PC 1440px)',async({page})=>{
 test.setTimeout(60000);
 await page.setViewportSize({width:1440,height:900});
 const db=await mockApp(page);
 page.on('dialog',dialog=>dialog.accept());
 await signIn(page);
 await expect(page.locator('#ledgerRoot')).toHaveAttribute('data-ledger-state','ready',{timeout:15000});
 const file={format:'kptu-ledger-import',version:1,kind:'candidates',label:'가상 대화 이관 1',candidates:[
  {kind:'event',title:'가상 이관 사건',payload:{record:{summary:'가상 요지'}}},
  {kind:'decision',title:'가상 이관 결정',payload:{record:{decision_type:'adopted'}}},
  {kind:'event',title:'가상 민감 이관',sensitivity:'S3'}]};
 await page.locator('#lgFile').setInputFiles({name:'가상 후보.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
 const result=page.locator('[data-lg-result="candidates"]');
 await expect(result).toContainText('넣을 후보 2건');
 await expect(result).toContainText('민감 S3 1건');
 const apply=result.locator('[data-lg-action="cand-apply"]');
 await expect(apply).toBeDisabled();
 await result.locator('[data-lg-action="cand-dry"]').click();
 await expect(page.locator('[data-lg-cand-dry]')).toContainText('넣을 후보 2건');
 await page.locator('[data-lg-result="candidates"] [data-lg-action="cand-apply"]').click();
 await expect(page.locator('#lgLive')).toContainText('후보 2건을 넣었습니다');
 for(const sent of db.queue)expect(sent).not.toContain('가상 민감 이관');
 const final=JSON.parse(db.queue.at(-1));
 expect(final.p_dry_run).toBe(false);
 expect(final.p_file.candidates.map(c=>c.title)).toEqual(['가상 이관 사건','가상 이관 결정']);
 const box=page.locator('#ledgerCandidatesRoot');
 await expect(box.locator('[data-lc-origin="claude_import"]')).toHaveCount(3);
 // 묶음 대기 후보 모두 버림.
 await box.locator('[data-lc-action="discard-batch"][data-lc-import="'+u(801)+'"]').click();
 await expect(box).toContainText('후보 2건을 버렸습니다.');
 expect(db.patch.at(-1).body.discard_reason).toBe('Claude 파일 묶음 버림');
});

test('후보 표·확정 함수·검색 RPC가 없으면 후보 칸과 목록·검색 칸은 조용히 숨고, 가져오기는 그대로',async({page})=>{
 test.setTimeout(60000);
 await page.setViewportSize({width:1440,height:900});
 const db=await mockApp(page,{ready:false});
 await signIn(page);
 await expect(page.locator('#ledgerRoot')).toHaveAttribute('data-ledger-state','ready',{timeout:15000});
 await expect(page.locator('#ledgerCandidatesRoot')).toHaveAttribute('data-ledger-candidates','hidden');
 await expect(page.locator('#ledgerBrowseRoot')).toHaveAttribute('data-ledger-browse','hidden');
 await expect(page.locator('#ledgerCandidatesRoot')).toBeHidden();
 await expect(page.locator('#ledgerBrowseRoot')).toBeHidden();
 await expect(page.locator('#lgFile')).toBeVisible();
 // 후보 파일은 모양만 보고 "후보 넣기 기능 준비 전".
 await page.locator('#lgFile').setInputFiles({name:'가상 후보.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'kptu-ledger-import',version:1,kind:'candidates',candidates:[{kind:'event',title:'가상'}]}))});
 await expect(page.locator('[data-lg-cand-later]')).toBeVisible();
 await expect(page.locator('[data-lg-action="cand-apply"]')).toHaveCount(0);
 expect(db.ai.length).toBe(0);
});
