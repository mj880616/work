import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// AI-서버연동 S7-c: [원장] 화면의 원장 후보 칸과 원장 목록·검색 칸. Supabase·ai-assist는 시험 상태로 대신한다(가상 값만).
// 후보: [원장 후보 만들기](ai-assist kind만) → [확정](확정 RPC, p_edit 없음) / [고쳐서 확정](p_edit) / [버림](대기 후보 상태만).
// 목록·검색: 검색 RPC(기본 업무만) → 걸러보기 → 행 상세(칸·출처·연결). 표·함수가 없으면 두 칸 모두 조용히 숨는다.
// LEDGER-확정되돌리기: 확정 직후 [되돌리기](10초)·최근 확정 ⋯ [확정 취소](취소 RPC). 취소 함수가 없으면 두 버튼과 최근 확정 칸만 숨는다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ledger-c-user',email:'ledger-c@example.org',user_metadata:{display_name:'Ledger QA'}};
const workspace={id:'ledger-c-workspace',slug:'ledger-c',name:'웹2'};
const ZERO='00000000-0000-0000-0000-000000000000';
const u=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ORG=u(50),TOPIC=u(60),SRC=u(70);

function records(){
 return [
  {id:u(1),workspace_id:workspace.id,kind:'event',ledger_id:'EVT-0901',title:'가상 노선 교섭',summary:'가 지부 교섭 진행. (계속추적=아니오, 상태=종료)',scope:'work',topic_id:TOPIC,sensitivity:'S1',importance:'high',validity:'current',
   date_start:'2026-09-01',date_end:null,date_precision:'month',date_note:'2026-09',event_status:'tracking',note:'',superseded_by:null},
  {id:u(2),workspace_id:workspace.id,kind:'change',ledger_id:'CHG-0901',title:'가상 교섭 2차 일정 확정',summary:'2차 교섭 날짜 확정.',scope:'work',topic_id:null,sensitivity:'S2',importance:'normal',validity:'current',
   date_start:'2026-10-20',date_end:null,date_precision:'day',date_note:'',note:'가상 비고',superseded_by:null},
  {id:u(3),workspace_id:workspace.id,kind:'commitment',ledger_id:'COM-0901',title:'가상 기관 자료 회신',summary:'가상 기관 자료 회신.',scope:'work',topic_id:null,sensitivity:'S1',importance:'normal',validity:'current',
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

async function mockApp(page,{ready=true,undo=false}={}){
 const db={records:records(),candidates:candidates(),search:[],confirm:[],patch:[],ai:[],queue:[],undo:[]};
 // 확정 뒤 손으로 고친 기록을 가리키는 확정 후보(취소는 거절된다).
 if(undo)db.candidates.push({id:u(105),origin:'web2_ai',status:'confirmed',action:'new',kind:'event',target_record_id:null,title:'가상 고친 뒤 후보',sensitivity:'S1',dedup_key:null,import_id:null,
  created_at:'2026-10-19T00:00:00Z',decided_at:'2026-10-19T01:00:00Z',result_record_id:u(1),payload:{}});
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
   const ledger_id=c.kind==='commitment'?'COM-0902':c.id===u(101)&&db.undo.length?'EVT-0911':'EVT-0910';
   c.result_record_id=u(10+db.records.length);c.decided_at=new Date().toISOString();
   db.records.push({id:u(10+db.records.length),workspace_id:workspace.id,kind:c.kind,ledger_id,title:a.p_edit?.title||c.title,summary:'',scope:'work',topic_id:null,sensitivity:'S1',importance:'normal',validity:'current',date_start:null,date_end:null,date_precision:'unknown',date_note:'',note:''});
   return ok({candidate_id:c.id,status:'confirmed',action:'new',record_id:u(99),ledger_id,sources_added:1,links_added:1});
  }
  if(path==='/rest/v1/rpc/app_unconfirm_ledger_candidate'){
   if(!undo)return noFn();
   const a=request.postDataJSON();
   if(a.p_candidate_id===ZERO)return fail(400,'LEDGER_UNDO_NOT_FOUND');
   db.undo.push(a);
   const c=db.candidates.find(x=>x.id===a.p_candidate_id);
   if(!c||c.status!=='confirmed')return fail(400,'LEDGER_UNDO_NOT_CONFIRMED: only a confirmed candidate can be undone');
   if(c.id===u(105))return fail(400,'LEDGER_UNDO_RECORD_CHANGED: the record was edited after confirmation');
   const rec=db.records.find(r=>r.id===c.result_record_id);
   Object.assign(c,{status:'pending',result_record_id:null,decided_at:null});
   if(rec)rec.validity='retired';
   return ok({candidate_id:c.id,status:'pending',action:'new',record_id:rec?.id,ledger_id:rec?.ledger_id,record_retired:true,target_restored:false,sources_unlinked:1,links_removed:1,sources_retired:1});
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
   const st=(url.searchParams.get('status')||'eq.pending').slice(3);
   return ok(db.candidates.filter(c=>c.status===st));
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

for(const [name,width] of [['PC',1280],['phone',390]]){
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
  await expect(browse.locator('[data-lb-row="'+u(1)+'"]')).toContainText('2026.09');
  // 종류: 약속만. 조건은 처음에 접혀 있어 [조건 ▾]를 먼저 연다.
  await browse.locator('#lbCondBtn').click();
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
  await browse.locator('#lbQuery').press('Enter');
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

 test(`원장 목록·검색: 검색칸 하나만 보이고 Enter로 찾고, 조건은 접힘·칩·✕ 해제, 종류 칩은 쉬운 이름(값 불변)과 툴팁 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  await expect(browse).toHaveAttribute('data-ledger-browse','ready',{timeout:15000});
  const box=l=>l.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}});
  // 1. 검색칸 하나만 늘 보인다. 큰 [찾기] 버튼은 없고, '찾을 말' 라벨은 읽기 도구용으로만 남는다. 조건은 접혀 있고 걸린 조건 칩도 없다.
  await expect(browse.locator('#lbQuery')).toBeVisible();
  await expect(browse.locator('#lbForm button[type="submit"]')).toHaveCount(0);
  await expect(browse.getByRole('button',{name:'찾기',exact:true})).toHaveCount(0);
  await expect(browse.locator('label.lb-search .lg-sr')).toHaveText('찾을 말');
  await expect(browse.locator('#lbCond')).toBeHidden();
  await expect(browse.locator('#lbCondBtn')).toHaveAttribute('aria-expanded','false');
  await expect(browse.locator('.lb-tag')).toHaveCount(0);
  const search=await box(browse.locator('#lbQuery'));
  expect(search.h).toBeLessThanOrEqual(34);
  // Enter = 찾기.
  const before=db.search.length;
  await browse.locator('#lbQuery').fill('2차');
  await browse.locator('#lbQuery').press('Enter');
  await expect(browse.locator('[data-lb-row]')).toHaveCount(1);
  expect(db.search.length).toBeGreaterThan(before);
  expect(db.search.at(-1).p_query).toBe('2차');
  await browse.locator('#lbQuery').fill('');
  await browse.locator('#lbQuery').press('Enter');
  await expect(browse.locator('[data-lb-row]')).toHaveCount(3);

  // 2. [조건 ▾]를 열면 종류·기간·조직·주제·범위·지난 기록이 보인다.
  await browse.locator('#lbCondBtn').click();
  await expect(browse.locator('#lbCondBtn')).toHaveAttribute('aria-expanded','true');
  await expect(browse.locator('#lbCond')).toBeVisible();
  // 3. 종류 칩: 화면 이름만 쉬운 말, 값(value)과 RPC 인자는 그대로. 작은 칩(높이 28 안팎).
  const names={event:'일어난 일',change:'바뀐 점',decision:'정한 것',evidence:'근거',commitment:'약속'};
  for(const [value,label] of Object.entries(names)){
   const chip=browse.locator(`label.lb-chip:has(input[value="${value}"])`);
   await expect(chip).toHaveText(label);
   await expect(chip.locator('input')).toHaveAttribute('name','lbKind');
   expect((await box(chip)).h).toBeLessThanOrEqual(30);
   expect((await chip.getAttribute('title'))||'').not.toBe('');
  }
  await expect(browse.locator('label.lb-chip')).toHaveCount(5);
  await expect(browse.locator('#lbCond')).not.toContainText('변화기록');
  await browse.locator('label.lb-chip:has(input[value="event"])').click();
  await expect(browse.locator('input[name="lbKind"][value="event"]')).toBeChecked();
  expect(db.search.at(-1).p_kinds).toEqual(['event']);
  // 눌린 칩은 계정 색으로 칠해진다(안 눌린 칩과 배경이 다르다).
  const bg=l=>l.evaluate(el=>getComputedStyle(el).backgroundColor);
  expect(await bg(browse.locator('label.lb-chip:has(input[value="event"])'))).not.toBe(await bg(browse.locator('label.lb-chip:has(input[value="change"])')));
  // 걸린 조건 칩 + ✕ 해제.
  const tag=browse.locator('.lb-tag');
  await expect(tag).toHaveCount(1);
  await expect(tag).toContainText('일어난 일');
  await expect(tag).toContainText('✕');
  await tag.click();
  await expect(tag).toHaveCount(0);
  await expect(browse.locator('input[name="lbKind"][value="event"]')).not.toBeChecked();
  await expect.poll(()=>db.search.at(-1).p_kinds).toBe(null);
  // 기간 칩: 시작·끝 날짜(달력 입력)를 넣으면 한 칩으로 보이고 ✕로 함께 풀린다. 조직도 칩.
  const year=new Date().getFullYear();
  await browse.locator('#lbFrom').fill(`${year}-10-01`);
  await browse.locator('#lbTo').fill(`${year}-10-22`);
  await expect(tag).toHaveText(/10\.01~10\.22/);
  await expect.poll(()=>db.search.at(-1)).toMatchObject({p_date_from:`${year}-10-01`,p_date_to:`${year}-10-22`});
  await expect(browse.locator('#lbFrom')).toHaveAttribute('type','date');
  await browse.locator('#lbOrg').selectOption(ORG);
  await expect(browse.locator('.lb-tag')).toHaveCount(2);
  await browse.locator('.lb-tag',{hasText:'~'}).click();
  await expect(browse.locator('#lbFrom')).toHaveValue('');
  await expect.poll(()=>db.search.at(-1)).toMatchObject({p_date_from:null,p_date_to:null,p_organization_id:ORG});
  await expect(browse.locator('.lb-tag')).toHaveCount(1);
  // 4. 범위 표시는 업무만 / 전체(값 work/all), '지난 기록도 보기' 작은 체크, '조건 지우기' 작은 글자 버튼.
  await expect(browse.locator('#lbScope option')).toHaveText(['업무만','전체','관심만']);
  await expect(browse.locator('#lbScope option').nth(1)).toHaveAttribute('value','all');
  await expect(browse.locator('label.lb-check')).toHaveText('지난 기록도 보기');
  const check=await box(browse.locator('#lbInactive'));
  expect(check.w).toBeLessThanOrEqual(16);
  await browse.locator('#lbInactive').check();
  expect(db.search.at(-1).p_include_inactive).toBe(true);
  await expect(browse.locator('.lb-tag',{hasText:'지난 기록 포함'})).toHaveCount(1);
  const clear=browse.locator('[data-lb-action="clear"]');
  await expect(clear).toHaveText('조건 지우기');
  expect((await box(clear)).h).toBeLessThanOrEqual(30);
  // 5. 날짜·선택 칸은 낮다(32px 안팎).
  expect((await box(browse.locator('#lbFrom'))).h).toBeLessThanOrEqual(34);
  expect((await box(browse.locator('#lbOrg'))).h).toBeLessThanOrEqual(34);
  await clear.click();
  await expect(browse.locator('.lb-tag')).toHaveCount(0);
  expect(db.search.at(-1)).toMatchObject({p_kinds:null,p_organization_id:null,p_include_inactive:false,p_scope:'work'});
  // 키보드: 종류 칩에 초점이 가면 한 줄 설명이 보인다(마우스는 title).
  await browse.locator('input[name="lbKind"][value="decision"]').focus();
  await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
  const hint=await browse.locator('label.lb-chip:has(input[value="decision"])').evaluate(el=>getComputedStyle(el,'::before').content);
  expect(hint).toContain('채택·기각·보류');
  expect(await noSideScroll(page)).toBe(true);
  await browse.locator('#lbCondBtn').click();
  await expect(browse.locator('#lbCond')).toBeHidden();
 });

 test(`원장 목록·검색: 결과 줄은 종류 꼬리표·제목·날짜, 요지가 제목과 같으면 요지 줄 생략, 기계식 표기 없음, ID·상태 꼬리표 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});
  await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  await expect(browse).toHaveAttribute('data-ledger-browse','ready',{timeout:15000});
  const row=id=>browse.locator('[data-lb-row="'+id+'"]');
  // 개수: '최근 N건'은 한 번에 가져오는 수 이상일 때만, 아니면 실제 건수.
  await expect(browse.locator('#lbStatus')).toHaveText('3건');
  // 종류 꼬리표는 화면 이름, 데이터 값(data-lb-kind)은 그대로.
  await expect(row(u(1)).locator('.lbr-kind')).toHaveText('일어난 일');
  await expect(row(u(1))).toHaveAttribute('data-lb-kind','event');
  await expect(row(u(2)).locator('.lbr-kind')).toHaveText('바뀐 점');
  await expect(row(u(3)).locator('.lbr-kind')).toHaveText('약속');
  const color=l=>l.evaluate(el=>getComputedStyle(el).color+'|'+getComputedStyle(el).backgroundColor);
  const tones=new Set([await color(row(u(1)).locator('.lbr-kind')),await color(row(u(2)).locator('.lbr-kind')),await color(row(u(3)).locator('.lbr-kind'))]);
  expect(tones.size).toBe(3);
  // 날짜는 짧게(올해면 MM.DD), 전체 표기는 툴팁.
  await expect(row(u(2)).locator('.lbr-date')).toHaveText(/^(\d\d\.)?10\.20$/);
  await expect(row(u(2)).locator('.lbr-date')).toHaveAttribute('title','2026-10-20');
  // 기계식 표기 '(계속추적=아니오, 상태=종료)'는 글에서 빼고 상태만 작은 꼬리표로.
  await expect(row(u(1))).not.toContainText('계속추적');
  await expect(row(u(1)).locator('.lb-state')).toHaveText('종료');
  await expect(row(u(1)).locator('.lbr-summary')).toHaveText('가 지부 교섭 진행.');
  // 요지가 제목과 같은 문장이면 요지 줄(글)이 없다. 다른 요지는 있다.
  await expect(row(u(3)).locator('.lbr-summary')).toHaveText('');
  await expect(row(u(2)).locator('.lbr-summary')).toHaveText('2차 교섭 날짜 확정.');
  // S2 꼬리표.
  await expect(row(u(2)).locator('.lb-state')).toHaveText('S2 교섭·전략');
  if(width>=1000){
   // PC: 둘째 줄 요지, ID는 오른쪽 끝에 작고 흐리게.
   await expect(row(u(1)).locator('.lbr-id')).toBeVisible();
   await expect(row(u(1)).locator('.lbr-id')).toHaveText('EVT-0901');
   const id=await row(u(1)).locator('.lbr-id').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.lb-head').getBoundingClientRect();return {right:r.right,head:p.right,size:parseFloat(getComputedStyle(el).fontSize)}});
   expect(id.head-id.right).toBeLessThan(12);expect(id.size).toBeLessThanOrEqual(12);
  }else{
   // 폰: 요지·ID는 줄을 눌러 펼칠 때만.
   await expect(row(u(1)).locator('.lbr-summary')).toBeHidden();
   await expect(row(u(1)).locator('.lbr-id')).toBeHidden();
   await row(u(1)).locator('[data-lb-action="open"]').click();
   await expect(browse.locator('#lbDetail-'+u(1))).toContainText('EVT-0901');
   await expect(browse.locator('#lbDetail-'+u(1))).toContainText('가 지부 교섭 진행.');
  }
  // 줄은 낮다(PC 2줄·폰 1줄). 가로 넘침 없음.
  const h=await row(u(3)).evaluate(el=>el.getBoundingClientRect().height);
  expect(h).toBeLessThanOrEqual(width>=1000?56:46);
  expect(await noSideScroll(page)).toBe(true);
 });
}

test('원장 화면의 다른 칸(후보)의 버튼·입력칸도 같은 작은 기준 (PC 1440px)',async({page})=>{
 test.setTimeout(60000);
 await page.setViewportSize({width:1440,height:900});
 await mockApp(page);
 await signIn(page);
 const box=page.locator('#ledgerCandidatesRoot');
 await expect(box).toHaveAttribute('data-ledger-candidates','ready',{timeout:15000});
 const h=l=>l.evaluate(el=>el.getBoundingClientRect().height);
 for(const sel of ['[data-lc-action="make"]','[data-lc-row="'+u(101)+'"] [data-lc-action="confirm"]','[data-lc-row="'+u(101)+'"] [data-lc-action="edit"]','[data-lc-row="'+u(101)+'"] [data-lc-action="discard"]'])
  expect(await h(box.locator(sel))).toBeLessThanOrEqual(34);
 // 문구는 그대로.
 await expect(box.locator('[data-lc-action="make"]')).toHaveText('원장 후보 만들기');
 await expect(box.locator('[data-lc-row="'+u(101)+'"] [data-lc-action="edit"]')).toHaveText('고쳐서 확정');
 await box.locator('[data-lc-row="'+u(101)+'"] [data-lc-action="edit"]').click();
 const form=box.locator('form[data-lc-form]');
 expect(await h(form.locator('[name="title"]'))).toBeLessThanOrEqual(34);
 expect(await h(form.locator('[name="sensitivity"]'))).toBeLessThanOrEqual(34);
 expect(await h(form.locator('[data-lc-action="save"]'))).toBeLessThanOrEqual(34);
});

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
 // 취소 함수가 없으면(운영 미적용) [되돌리기]·최근 확정 칸이 없다.
 await expect(box.locator('[data-lc-undo-offer]')).toHaveCount(0);
 await expect(box.locator('[data-lc-confirmed-box]')).toHaveCount(0);

 // 후보 칸 종류 이름은 화면에서만 쉬운 말(LEDGER-후보칸이름). 툴팁은 설명, 확정 때 보내는 값은 원래 종류.
 await expect(box.locator('[data-lc-row="'+u(101)+'"] .lg-pill').first()).toHaveText('일어난 일');
 await expect(box.locator('[data-lc-row="'+u(101)+'"] .lg-pill').first()).toHaveAttribute('title','추적할 일 하나(원장의 사건)');
 await expect(box.locator('[data-lc-row="'+u(102)+'"] .lg-pill').first()).toHaveText('약속');
 await expect(box.locator('[data-lc-row="'+u(103)+'"] .lg-pill').first()).toHaveText('바뀐 점');

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
 await expect(form).toHaveAttribute('aria-label','약속 후보 고치기');
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

for(const [name,width] of [['phone',390],['PC',1440]]){
 test(`확정 되돌리기: 확정 직후 [되돌리기] → 대기로, 10초 뒤 버튼이 사라지고 최근 확정 ⋯ [확정 취소], 거절은 이유를 보인다 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page,{undo:true});
  const dialogs=[];
  page.on('dialog',dialog=>{dialogs.push(dialog.message());dialog.accept();});
  await signIn(page);
  const box=page.locator('#ledgerCandidatesRoot');
  await expect(box).toHaveAttribute('data-ledger-candidates','ready',{timeout:15000});
  await expect(box.locator('[data-lc-confirmed-box] > summary')).toContainText('최근 확정 1건');

  // [확정] → [되돌리기]: 취소 RPC 한 번, 후보는 대기 목록으로 돌아온다.
  await box.locator('[data-lc-row="'+u(101)+'"] [data-lc-action="confirm"]').click();
  await expect(box).toContainText('EVT-0910(으)로 원장에 넣었습니다.');
  const offer=box.locator('[data-lc-undo-offer] [data-lc-action="undo"]');
  await expect(offer).toBeVisible();
  await offer.click();
  await expect(box).toContainText('EVT-0910 확정을 취소했습니다. 후보는 대기로 돌아갔습니다.');
  expect(db.undo.at(-1)).toEqual({p_candidate_id:u(101)});
  await expect(box.locator('[data-lc-row="'+u(101)+'"]')).toHaveCount(1);
  await expect(box.locator('[data-lc-undo-offer]')).toHaveCount(0);
  expect(dialogs).toEqual([]);

  // 다시 확정 → 10초 안에 누르지 않으면 [되돌리기]가 사라진다. 최근 확정 칸의 ⋯ 안 [확정 취소]로는 계속 할 수 있다.
  await box.locator('[data-lc-row="'+u(101)+'"] [data-lc-action="confirm"]').click();
  await expect(box).toContainText('EVT-0911(으)로 원장에 넣었습니다.');
  await expect(box.locator('[data-lc-undo-offer]')).toHaveCount(1);
  await expect(box.locator('[data-lc-undo-offer]')).toHaveCount(0,{timeout:15000});
  const recent=box.locator('[data-lc-confirmed-box]');
  await expect(recent.locator(':scope > summary')).toContainText('최근 확정 2건');
  await recent.locator(':scope > summary').click();
  const item=recent.locator('[data-lc-confirmed="'+u(101)+'"]');
  await expect(item).toContainText('EVT-0911');
  await expect(item).toContainText('확정됨');
  await expect(item.locator('.lg-pill').first()).toHaveText('일어난 일');
  await expect(item.locator('.lg-pill').first()).toHaveAttribute('title','추적할 일 하나(원장의 사건)');
  // ⋯는 키보드로 연다(Enter).
  await item.locator('.lc-more summary').focus();
  await page.keyboard.press('Enter');
  await expect(item.locator('[data-lc-action="undo-ask"]')).toBeVisible();
  await item.locator('[data-lc-action="undo-ask"]').click();
  await expect(box).toContainText('EVT-0911 확정을 취소했습니다.');
  expect(dialogs.at(-1)).toContain('EVT-0911 확정을 취소할까요?');
  expect(db.undo.at(-1)).toEqual({p_candidate_id:u(101)});
  await expect(box.locator('[data-lc-row="'+u(101)+'"]')).toHaveCount(1);

  // 거절(확정 뒤 기록을 고침): 이유를 보이고 확정 항목은 그대로 남는다.
  const kept=box.locator('[data-lc-confirmed="'+u(105)+'"]');
  if(!(await box.locator('[data-lc-confirmed-box]').evaluate(el=>el.open)))await box.locator('[data-lc-confirmed-box] > summary').click();
  await kept.locator('.lc-more summary').click();
  await kept.locator('[data-lc-action="undo-ask"]').click();
  await expect(box.locator('[data-lc-error]')).toContainText('확정 뒤 이 기록(또는 출처·연결)을 고쳐서 취소할 수 없습니다.');
  await expect(box.locator('[data-lc-confirmed="'+u(105)+'"]')).toHaveCount(1);
  expect(await noSideScroll(page)).toBe(true);
 });
}
