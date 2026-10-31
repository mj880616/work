import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// LEDGER-화면정리·LEDGER-수정요청(명진 요청 2026-10-24 07:17): [원장] 첫 화면과 고치기.
// 위에서부터 검색 / 조직·주제 칩(두 줄, LEDGER-첫화면정리) / 상대가 안 지킨 약속 / 지금 추적 중인 일 / 최근 자동으로 기록됨. 모든 목록은 처음 6건 + [더보기 n ▾]. 칩 → 이야기(시간순 타임라인), 줄 → 근거·출처.
// 기록 상세 ⋯ [내용 업데이트…](LEDGER-기록바로업데이트, 대상 고정)·[+ 기록하기]: 일상어 한 줄 → ai-assist ledger_fix(모의) 미리보기 → [반영] 한 번(app_apply_ledger_fix p_dry_run=false) → 옛 기록 대체됨.
// Claude 수정안 덩어리는 같은 칸에 붙여 넣어 해 보기(p_dry_run=true) → [반영]. 가져오기·후보 칸은 없다. Supabase·ai-assist는 시험 응답(가상 값만).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ledger-h-user',email:'ledger-h@example.org',user_metadata:{display_name:'Ledger QA'}};
const workspace={id:'e0000000-0000-4000-8000-0000000000bb',slug:'kptu-work',name:'웹2'};
const u=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ORG=u(50),TOPIC=u(60),SRC=u(70),NOTE=u(500),RUN=u(900);
const seoul=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const addDays=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

function records(){
 const today=seoul();
 const base={workspace_id:workspace.id,scope:'work',sensitivity:'S1',importance:'normal',validity:'current',date_end:null,date_note:'',note:'',superseded_by:null,
  counterparty:null,commitment_status:null,follow_up_on:null,event_status:null,topic_id:null,date_precision:'day',summary:''};
 return [
  {...base,id:u(1),kind:'event',ledger_id:'EVT-0901',title:'가상 나 지부 2차 교섭',summary:'2차 교섭 일정.',date_start:'2026-11-04',event_status:'tracking',topic_id:TOPIC},
  {...base,id:u(2),kind:'change',ledger_id:'CHG-0901',title:'가상 나 지부 교섭 요구안 전달',date_start:'2026-10-02',topic_id:TOPIC},
  {...base,id:u(3),kind:'commitment',ledger_id:'COM-0901',title:'가상 사측 자료 회신 약속',date_start:'2026-10-10',counterparty:'가 사측',commitment_status:'waiting',follow_up_on:addDays(today,-5)},
  {...base,id:u(4),kind:'decision',ledger_id:'DEC-0901',title:'가상 교섭 위원 확정',date_start:'2026-09-20',decision_type:'adopted',topic_id:TOPIC},
 ];
}

async function mockApp(page,{server=true,many=false}={}){
 const db={records:records(),changes:[{record_id:u(4),action:'created',route:'auto',run_id:RUN,note:'',created_at:'2026-10-24T01:00:00Z'}],
  links:[{record_id:u(1),target_organization_id:ORG},{record_id:u(2),target_organization_id:ORG},{record_id:u(3),target_organization_id:ORG}],
  ai:[],fix:[],undo:[],search:[],posts:[]};
 // 많은 목록(LEDGER-첫화면정리): 추적 중 사건 8건 추가, 조직 14곳(긴 이름) 추가.
 const orgs=[{id:ORG,ledger_id:'ORG-0901',name:'나 지부'}];
 if(many){
  for(let i=0;i<8;i++){const b=records()[0];db.records.push({...b,id:u(2000+i),ledger_id:`EVT-09${60+i}`,title:`가상 추가 교섭 ${i+1}`,date_start:`2026-11-${String(10+i).padStart(2,'0')}`,topic_id:null});}
  for(let i=0;i<14;i++){orgs.push({id:u(3000+i),ledger_id:`ORG-09${10+i}`,name:`가상 긴 이름 노동조합 지부 ${i+1}`});db.links.push({record_id:u(2000+(i%8)),target_organization_id:u(3000+i)});}
 }
 const live=r=>['current','needs_check','fulfilled'].includes(r.validity);
 const filterRecords=url=>{
  let rows=db.records.filter(r=>r.workspace_id===workspace.id);
  const p=url.searchParams;
  const eq=(k,f)=>{const v=p.get(k);if(v&&v.startsWith('eq.'))rows=rows.filter(r=>String(f(r))===v.slice(3));};
  eq('kind',r=>r.kind);eq('commitment_status',r=>r.commitment_status);eq('event_status',r=>r.event_status);eq('scope',r=>r.scope);eq('id',r=>r.id);eq('ledger_id',r=>r.ledger_id);
  const v=p.get('validity');if(v&&v.startsWith('in.'))rows=rows.filter(r=>v.slice(4,-1).split(',').includes(r.validity));
  const lt=p.get('follow_up_on');if(lt&&lt.startsWith('lt.'))rows=rows.filter(r=>r.follow_up_on&&r.follow_up_on<lt.slice(3));
  const id=p.get('id');if(id&&id.startsWith('in.'))rows=rows.filter(r=>id.slice(4,-1).split(',').includes(r.id));
  const lid=p.get('ledger_id');if(lid&&lid.startsWith('in.'))rows=rows.filter(r=>lid.slice(4,-1).split(',').includes(r.ledger_id));
  return rows;
 };
 // 수정 요청 함수(모양: 20261024120000 + 20261024200000). replace = 새 기록 + 옛 기록 대체됨. add = 새 기록.
 const applyFix=(req,dry)=>{
  const items=[];let n=db.records.length;
  const made=[];
  for(const it of req.items){
   if(it.do==='replace'){
    const old=db.records.find(r=>r.ledger_id===it.target);
    if(!old||!live(old))return {error:'LEDGER_FIX_TARGET_INACTIVE: '+it.target};
    items.push({target:it.target,do:'replace',reason:it.reason,changes:Object.entries(it.set).filter(([k])=>!['date_precision','date_end'].includes(k)).map(([field,after])=>({field,before:old[field]??null,after}))});
    if(!dry){const fresh={...old,...it.set,id:u(100+(++n)),ledger_id:old.ledger_id.slice(0,3)+'-09'+(50+n),validity:'current'};old.validity='superseded';old.superseded_by=fresh.id;old.supersede_reason='명진 지적으로 수정: '+it.reason;db.records.push(fresh);made.push(fresh);
     db.changes.push({record_id:fresh.id,action:'created',route:'correction',note:'명진 지적으로 수정 · '+seoul(),created_at:new Date().toISOString()});}
   }else if(it.do==='add'){
    items.push({target:null,do:'add',kind:it.kind,changes:Object.entries(it.set).map(([field,after])=>({field,before:null,after}))});
    if(!dry){const fresh={...records()[0],...it.set,kind:it.kind,id:u(100+(++n)),ledger_id:'EVT-09'+(50+n),event_status:it.kind==='event'?'tracking':null,topic_id:null,date_start:it.set.date_start||null};db.records.push(fresh);made.push(fresh);
     db.changes.push({record_id:fresh.id,action:'created',route:'correction',note:'명진이 직접 기록 · '+seoul(),created_at:new Date().toISOString()});}
   }else if(it.do==='retire'){
    const old=db.records.find(r=>r.ledger_id===it.target);
    items.push({target:it.target,do:'retire',reason:it.reason,changes:[{field:'validity',before:old.validity,after:'retired'}]});
    if(!dry)old.validity='retired';
   }
  }
  return {dry_run:dry,fix_request_id:dry?null:u(800+db.fix.length),applied:items.length,items};
 };
 await page.route(`${SB}/**`,async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
  const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
  if(path==='/auth/v1/token')return ok({access_token:'ledger-h-access',refresh_token:'ledger-h-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  if(path==='/auth/v1/user')return ok(user);
  if(path==='/functions/v1/ai-assist'){
   const body=request.postDataJSON();db.ai.push(body);
   if(!server||body.kind!=='ledger_fix')return ok({ok:false,error:'unsupported_kind'},400);
   if(/모르는/.test(body.text))return ok({ok:true,kind:'ledger_fix',request:null,preview:[],question:'어느 교섭인지 알려 주세요.'});
   const fixReq={format:'kptu-ledger-fix',version:1,received_from:'user',items:body.target?[{do:'replace',target:body.target,set:{date_start:'2026-11-05',date_precision:'day',date_end:null},reason:'날짜 오기'}]
    :[{do:'add',kind:'event',set:{title:'가상 다 지부 첫 교섭',date_start:'2026-11-12',date_precision:'day',date_end:null}}]};
   const dry=applyFix(fixReq,true);
   return ok({ok:true,kind:'ledger_fix',request:fixReq,preview:dry.items,question:''});
  }
  if(path==='/functions/v1/drive-summary'){
   const action=url.searchParams.get('action');
   if(method==='GET'&&action==='ledger_status')return ok({ok:true,ledger:{state:'found',last_success_at:new Date().toISOString(),last_failure_at:null,last_failure_code:null}});
   return ok({ok:true,exported_at:new Date().toISOString(),counts:{},documents:{}});
  }
  if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
  if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[]});
  if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(path.startsWith('/functions/v1/'))return ok({});
  if(path==='/rest/v1/rpc/app_ledger_search'){
   const a=request.postDataJSON();db.search.push(a);
   let rows=db.records.filter(r=>a.p_include_inactive||live(r));
   if(a.p_topic_id)rows=rows.filter(r=>r.topic_id===a.p_topic_id);
   if(a.p_organization_id)rows=rows.filter(r=>db.links.some(l=>l.record_id===r.id&&l.target_organization_id===a.p_organization_id));
   if(a.p_query)rows=rows.filter(r=>(r.title+' '+r.summary+' '+(r.counterparty||'')).includes(a.p_query));
   return ok(rows.map(r=>({id:r.id,ledger_id:r.ledger_id,kind:r.kind,title:r.title,summary:r.summary,date_start:r.date_start,date_end:null,date_precision:r.date_precision,validity:r.validity,sensitivity:r.sensitivity,topic_name:null,organizations:[],score:0})));
  }
  if(path==='/rest/v1/rpc/app_apply_ledger_fix'){
   const a=request.postDataJSON();db.fix.push(a);
   const out=applyFix(a.p_request,a.p_dry_run);
   if(out.error)return ok({message:out.error},400);
   return ok(out);
  }
  if(path==='/rest/v1/rpc/app_undo_ledger_fix'){db.undo.push(request.postDataJSON());return ok({status:'undone'});}
  if(path.startsWith('/rest/v1/rpc/')){db.posts.push(path);return ok(null);}
  if(path==='/rest/v1/app_ledger_records'){
   const rows=filterRecords(url);
   if(url.searchParams.get('select')==='updated_at')return ok([]);
   return ok(rows);
  }
  if(path==='/rest/v1/app_ledger_links'){
   const rec=url.searchParams.get('record_id')||'',target=url.searchParams.get('target_record_id');
   if(url.searchParams.get('target_organization_id')==='not.is.null')return ok(db.links);
   if(rec.startsWith('eq.'))return ok(db.links.filter(l=>l.record_id===rec.slice(3)).map((l,i)=>({id:u(300+i),record_id:l.record_id,target_record_id:null,target_organization_id:l.target_organization_id,target_project_id:null,target_meeting_id:null,relation:'direct',note:''})));
   if(target)return ok([]);
   return ok([]);
  }
  if(path==='/rest/v1/app_ledger_record_changes'){
   const rec=url.searchParams.get('record_id')||'';
   let rows=db.changes;
   if(rec.startsWith('in.'))rows=rows.filter(c=>rec.includes(c.record_id));
   if(url.searchParams.get('route')==='eq.auto')rows=rows.filter(c=>c.route==='auto');
   return ok(rows);
  }
  if(path==='/rest/v1/app_ledger_record_sources'){
   const rec=(url.searchParams.get('record_id')||'').slice(3);
   return ok(rec===u(1)?[{id:u(80),source_id:SRC,locator:'',note:''}]:[]);
  }
  if(path==='/rest/v1/app_ledger_sources')return ok([{id:SRC,ledger_id:'SRC-0951',title:'Web2 업데이트 2026-10-24',doc_type:'internal_doc',location:`web2:basket:${NOTE}`,drive_file_id:null,source_date:'2026-10-24',sensitivity:'S1',status:'active'}]);
  if(path==='/rest/v1/app_notes'&&(url.searchParams.get('id')||'').includes(NOTE))return ok([{id:NOTE,kind:'basket',archived_at:null,journal_day:null}]);
  if(path==='/rest/v1/app_ledger_organizations')return ok(orgs);
  if(path==='/rest/v1/app_ledger_topics')return ok([{id:TOPIC,ledger_id:'TOP-0901',name:'가상 임금교섭'}]);
  if(path.startsWith('/rest/v1/app_ledger_'))return ok([]);
  if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email,workspace}]);
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
 test(`원장 첫 화면: 검색 → 조직·주제 칩 → 안 지킨 약속 → 추적 중 → 최근 자동, 가져오기·후보 칸 없음, 목록에 ID 없음 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  await expect(browse.locator('[data-lb-sec="overdue"]')).toBeVisible({timeout:15000});
  // 칸 순서(위에서부터).
  const order=await browse.locator('[data-lb-sec]').evaluateAll(els=>els.map(e=>e.dataset.lbSec));
  expect(order).toEqual(['chips','overdue','tracking','recent']);
  // 칩은 검색칸 바로 아래·'조직별·주제별' 제목 줄 없음. 칩이 적으면 [더보기]도 없다.
  expect(await browse.locator('#lbQuery').evaluate(el=>el.compareDocumentPosition(document.querySelector('[data-lb-sec="chips"]'))&Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(browse.getByText('조직별·주제별')).toHaveCount(0);
  await expect(browse.locator('[data-lb-chips] [data-chip-rows-more]')).toBeHidden();
  expect(await browse.locator('#lbQuery').evaluate(el=>el.compareDocumentPosition(document.querySelector('[data-lb-sec="overdue"]'))&Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  // 안 지킨 약속: 상대·확인일·며칠째.
  const overdue=browse.locator('[data-lb-sec="overdue"]');
  await expect(overdue).toContainText('가상 사측 자료 회신 약속');
  await expect(overdue).toContainText('가 사측');
  await expect(overdue).toContainText('5일 지남');
  await expect(browse.locator('[data-lb-sec="tracking"]')).toContainText('가상 나 지부 2차 교섭');
  await expect(browse.locator('[data-lb-type="organization"]')).toContainText('나 지부');
  await expect(browse.locator('[data-lb-type="topic"]')).toContainText('가상 임금교섭');
  const recent=browse.locator('[data-lb-sec="recent"]');
  await expect(recent).toContainText('가상 교섭 위원 확정');
  await expect(recent.locator('[data-lb-auto]')).toHaveText('자동');
  // 종류는 작은 꼬리표, 목록 줄에는 고정 ID·'현재유효'가 없다.
  await expect(browse.locator('[data-lb-sec="tracking"] .lbr-kind').first()).toHaveText('일어난 일');
  for(const head of await browse.locator('.lb-head').all())await expect(head).not.toContainText(/EVT-|CHG-|COM-|DEC-|현재유효/);
  // 가져오기·가져온 묶음·원장 후보 칸이 없다.
  await expect(page.locator('#ledgerRoot,#ledgerCandidatesRoot,#lgFile,[data-lc-shell],[data-lg-shell]')).toHaveCount(0);
  for(const text of ['원장 가져오기','원장 후보 만들기','가져온 묶음','확정'])await expect(page.locator('#ledgerView').getByRole('button',{name:text,exact:true})).toHaveCount(0);
  // 첫 화면은 검색 RPC를 부르지 않는다. 쓰기 요청도 없다.
  expect(db.search).toHaveLength(0);expect(db.fix).toHaveLength(0);expect(db.posts).toHaveLength(0);
  // [+ 기록하기]는 작은 버튼. UI-화면정리 C(B⑥): 폰은 다른 화면과 같은 동그란 [+](하단 탭 위 오른쪽에 떠 있음, 혼자 한 줄을 차지하지 않음).
  const add=browse.getByRole('button',{name:'+ 기록하기'});
  const addBox=await add.boundingBox();
  expect(addBox.height).toBeLessThanOrEqual(width<761?36:34);
  if(width<761){
   expect(await add.evaluate(b=>getComputedStyle(b).position)).toBe('fixed');
   expect(Math.abs(addBox.width-addBox.height)).toBeLessThanOrEqual(1);
   expect(addBox.x+addBox.width).toBeGreaterThan(width-40);
  }
  expect(await noSideScroll(page)).toBe(true);
 });

 test(`칩 → 이야기 시간순 타임라인(세로 선), 줄 → 근거·출처 ‹원문›, ‹ 원장으로 돌아가기 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  await browse.locator('[data-lb-type="topic"][data-lb-action="story"]').first().click();
  const story=browse.locator('[data-lb-story="topic"]');
  await expect(story).toBeVisible({timeout:10000});
  expect(db.search.at(-1)).toMatchObject({p_topic_id:TOPIC,p_organization_id:null,p_query:''});
  await expect(browse.locator('#lbStoryTitle')).toHaveText('가상 임금교섭');
  // 시간순(오래된 것 먼저): 9/20 결정 → 10/2 변화 → 11/4 사건.
  await expect(story.locator('.lbr-title')).toHaveText(['가상 교섭 위원 확정','가상 나 지부 교섭 요구안 전달','가상 나 지부 2차 교섭']);
  // 세로 선과 줄마다 점.
  const line=await story.evaluate(el=>getComputedStyle(el,'::before').width);
  expect(parseFloat(line)).toBeGreaterThan(0);
  // 줄 → 상세: 근거·출처, ‹원문›.
  await story.locator('[data-lb-row="'+u(1)+'"] [data-lb-action="open"]').click();
  const detail=browse.locator('#lbDetail-'+u(1));
  await expect(detail.locator('[data-lb-web2="basket"]')).toContainText('업데이트 · 10/24',{timeout:10000});
  await expect(detail.getByRole('button',{name:'‹원문›'})).toBeVisible();
  // 상세 안에는 고정 ID가 있다.
  await expect(detail).toContainText('EVT-0901');
  // 조직 칩도 같은 이야기 화면.
  await browse.locator('[data-lb-action="home"]').click();
  await expect(browse.locator('[data-lb-sec="overdue"]')).toBeVisible();
  await browse.locator('[data-lb-type="organization"][data-lb-action="story"]').first().click();
  await expect(browse.locator('[data-lb-story="organization"] .lbr-title')).toHaveCount(3);
  expect(db.search.at(-1)).toMatchObject({p_organization_id:ORG,p_topic_id:null});
  expect(await noSideScroll(page)).toBe(true);
 });

 test(`⋯ [고치기]: 일상어 한 줄 → 미리보기(일상어) → [반영] 한 번 → 옛 기록 대체됨·새 기록 '직접', 10초 되돌리기 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  const row=browse.locator('[data-lb-sec="tracking"] [data-lb-row="'+u(1)+'"]');
  await row.locator('[data-lb-action="open"]').click();
  const detail=browse.locator('#lbDetail-'+u(1));
  await row.locator('summary[aria-label^="기록 관리"]').click();
  await row.getByRole('menuitem',{name:'내용 업데이트…',exact:true}).click();
  const fix=page.locator('#ledgerFixRoot');
  await expect(fix).toBeVisible();
  await expect(fix.locator('#lfTitle')).toContainText('내용 업데이트 · 가상 나 지부 2차 교섭');
  await expect(fix.locator('#lfText')).toBeFocused();
  await fix.locator('#lfText').fill('나 지부 2차 교섭은 11/4가 아니라 11/5였음');
  // 미리보기 전에는 [반영]이 없다(바로 바뀌지 않음).
  await expect(fix.getByRole('button',{name:'반영',exact:true})).toHaveCount(0);
  await fix.getByRole('button',{name:'미리보기'}).click();
  const preview=fix.locator('[data-lf-preview]');
  await expect(preview).toBeVisible({timeout:10000});
  expect(db.ai.at(-1)).toEqual({kind:'ledger_fix',text:'나 지부 2차 교섭은 11/4가 아니라 11/5였음',target:'EVT-0901'});
  await expect(preview.locator('li')).toHaveText(['‘가상 나 지부 2차 교섭’: 날짜 11/4 → 11/5로 고침. 옛 기록은 대체됨으로 남김.']);
  await expect(preview).not.toContainText(/EVT-|superseded|DB/);
  await expect(preview).toContainText('직접 기록');
  expect(db.fix).toHaveLength(0);
  // 입력을 고치면 미리보기가 지워진다(다른 글로 반영되지 않게).
  await fix.locator('#lfText').press('End');await fix.locator('#lfText').type(' ');
  await expect(preview).toHaveCount(0);
  await fix.getByRole('button',{name:'미리보기'}).click();
  await expect(fix.locator('[data-lf-preview]')).toBeVisible({timeout:10000});
  // [반영] 한 번 = 미리 본 요청 그대로 p_dry_run=false 한 번.
  const apply=fix.getByRole('button',{name:'반영',exact:true});
  await apply.click();
  await expect.poll(()=>db.fix.length).toBe(1);
  expect(db.fix[0]).toEqual({p_workspace_id:workspace.id,p_dry_run:false,p_request:{format:'kptu-ledger-fix',version:1,received_from:'user',items:[{do:'replace',target:'EVT-0901',set:{date_start:'2026-11-05',date_precision:'day',date_end:null},reason:'날짜 오기'}]}});
  await expect(fix).toBeHidden();
  const notice=page.locator('[data-undo-notice]');
  await expect(notice).toContainText('원장에 반영했어요.');
  // 옛 기록은 대체됨(목록에서 빠짐), 새 기록은 '직접' 꼬리표.
  expect(db.records.find(r=>r.id===u(1)).validity).toBe('superseded');
  const fresh=browse.locator('[data-lb-sec="tracking"] [data-lb-row]').filter({hasText:'가상 나 지부 2차 교섭'});
  await expect(fresh).toHaveCount(1,{timeout:10000});
  await expect(fresh).not.toHaveAttribute('data-lb-row',u(1));
  await expect(fresh.locator('[data-lb-manual]')).toHaveText('직접');
  // 되돌리기 = app_undo_ledger_fix.
  await notice.getByRole('button',{name:'되돌리기'}).click();
  await expect.poll(()=>db.undo.length).toBe(1);
  expect(db.undo[0]).toEqual({p_fix_request_id:u(801)});
  expect(await noSideScroll(page)).toBe(true);
 });

 test(`⋯ 메뉴: 제목 줄 오른쪽 끝(빈 줄 없음) · 종류별 바로가기 · 구분선 · [틀린 기록으로 표시 ▸] 하위 목록 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  const row=browse.locator('[data-lb-sec="overdue"] [data-lb-row="'+u(3)+'"]');
  await row.locator('[data-lb-action="open"]').click();
  const kebab=row.locator('summary[aria-label^="기록 관리"]');
  await expect(kebab).toBeVisible({timeout:10000});
  // ⋯는 제목 첫 줄 안(행 머리 높이 안)에 있고, 상세 상자 맨 위에 ⋯만 있는 빈 줄이 없다(상세 첫 글이 ⋯ 줄이 아님).
  const headBox=await row.locator('.lb-head').boundingBox(),kBox=await kebab.boundingBox();
  expect(kBox.y).toBeGreaterThanOrEqual(headBox.y-1);
  expect(kBox.y+kBox.height).toBeLessThanOrEqual(headBox.y+headBox.height+6);
  expect(kBox.x+kBox.width).toBeGreaterThan(headBox.x+headBox.width-48);
  await expect(row.locator('.lb-detail summary')).toHaveCount(0);
  const detailBox=await row.locator('.lb-detail').boundingBox();
  expect(detailBox.y).toBeLessThanOrEqual(headBox.y+headBox.height+4);
  // 제목은 ⋯ 옆으로 비켜 있다(겹치지 않음).
  const titleBox=await row.locator('.lbr-title').boundingBox();
  expect(titleBox.x+titleBox.width).toBeLessThanOrEqual(kBox.x+2);
  await kebab.click();
  const menu=row.locator('.lb-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.lb-menu-item').filter({visible:true})).toHaveText(['지켜짐 · 종결','추적에서 빼기','내용 업데이트…','틀린 기록으로 표시 ▸']);
  await expect(menu.locator('.lb-menu-sep')).toHaveCount(1);
  await expect(menu.locator('.lg-danger')).toHaveCount(0);
  expect((await menu.locator('.lb-menu-item').first().boundingBox()).height).toBeLessThanOrEqual(40);
  // 하위 목록은 눌러야 보인다.
  await expect(menu.getByRole('menuitem',{name:'사실과 달라요'})).toBeHidden();
  await menu.locator('summary[data-lb-sub]').click();
  await expect(menu.getByRole('menuitem').filter({hasText:/사실과 달라요|같은 기록이 이미 있어요|원장에 둘 일이 아니에요/})).toHaveCount(3);
  expect(await noSideScroll(page)).toBe(true);
  page.once('dialog',d=>d.accept());
  await menu.getByRole('menuitem',{name:'사실과 달라요'}).click();
  await expect.poll(()=>db.fix.length).toBe(1);
  expect(db.fix[0].p_request.items).toEqual([{target:'COM-0901',do:'retire',reason:'사실과 달라요'}]);
  await expect(browse.locator('[data-lb-sec="overdue"]')).toHaveCount(0,{timeout:10000});
  // 일어난 일은 [추적 끝내기]만(약속 바로가기 없음), 변화·결정에는 바로가기가 없다.
  const ev=browse.locator('[data-lb-sec="tracking"] [data-lb-row="'+u(1)+'"]');
  await ev.locator('[data-lb-action="open"]').click();
  await ev.locator('summary[aria-label^="기록 관리"]').click();
  await expect(ev.locator('.lb-menu .lb-menu-item').filter({visible:true})).toHaveText(['추적 끝내기','내용 업데이트…','틀린 기록으로 표시 ▸']);
 });

 test(`약속 ⋯ [추적에서 빼기]: 한 줄 적고 [반영] → '상대가 안 지킨 약속'에서 바로 빠짐, 옛 기록은 대체됨으로 남고 [되돌리기] (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  const row=browse.locator('[data-lb-sec="overdue"] [data-lb-row="'+u(3)+'"]');
  await row.locator('[data-lb-action="open"]').click();
  await row.locator('summary[aria-label^="기록 관리"]').click();
  await row.getByRole('menuitem',{name:'추적에서 빼기',exact:true}).click();
  const quick=row.locator('[data-lb-quick="drop"]');
  await expect(quick).toContainText('이 약속을 추적에서 뺍니다.');
  expect(db.fix).toHaveLength(0);
  await quick.locator('[data-lb-quick-input]').fill('더 이상 추적 안 함');
  await quick.getByRole('button',{name:'반영',exact:true}).click();
  await expect.poll(()=>db.fix.length).toBe(1);
  expect(db.fix[0]).toEqual({p_workspace_id:workspace.id,p_dry_run:false,p_request:{format:'kptu-ledger-fix',version:1,received_from:'user',
   items:[{target:'COM-0901',do:'replace',set:{commitment_status:'cancelled',note:'추적에서 뺀 이유: 더 이상 추적 안 함'},reason:'추적에서 뺌 · 더 이상 추적 안 함'}]}});
  expect(db.records.find(r=>r.id===u(3)).validity).toBe('superseded');
  await expect(browse.locator('[data-lb-sec="overdue"]')).toHaveCount(0,{timeout:10000});
  const notice=page.locator('[data-undo-notice]');
  await expect(notice).toContainText('COM-0901을(를) 추적에서 뺐어요.');
  await notice.getByRole('button',{name:'되돌리기'}).click();
  await expect.poll(()=>db.undo.length).toBe(1);
  expect(await noSideScroll(page)).toBe(true);
 });

 test(`약속 ⋯ [지켜짐 · 종결](결과 비워도 됨)과 일어난 일 ⋯ [추적 끝내기]: 목록에서 바로 빠짐 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  const row=browse.locator('[data-lb-sec="overdue"] [data-lb-row="'+u(3)+'"]');
  await row.locator('[data-lb-action="open"]').click();
  await row.locator('summary[aria-label^="기록 관리"]').click();
  await row.getByRole('menuitem',{name:'지켜짐 · 종결',exact:true}).click();
  await expect(row.locator('[data-lb-quick="fulfill"]')).toContainText('이 약속을 지켜짐으로 종결합니다.');
  await row.getByRole('button',{name:'반영',exact:true}).click();
  await expect.poll(()=>db.fix.length).toBe(1);
  expect(db.fix[0].p_request.items).toEqual([{target:'COM-0901',do:'replace',set:{commitment_status:'fulfilled'},reason:'지켜져서 종결'}]);
  await expect(browse.locator('[data-lb-sec="overdue"]')).toHaveCount(0,{timeout:10000});
  const ev=browse.locator('[data-lb-sec="tracking"] [data-lb-row="'+u(1)+'"]');
  await ev.locator('[data-lb-action="open"]').click();
  await ev.locator('summary[aria-label^="기록 관리"]').click();
  await ev.getByRole('menuitem',{name:'추적 끝내기',exact:true}).click();
  await expect(ev.locator('[data-lb-quick="end"]')).toContainText('이 일의 추적을 끝냅니다.');
  await ev.getByRole('button',{name:'반영',exact:true}).click();
  await expect.poll(()=>db.fix.length).toBe(2);
  expect(db.fix[1].p_request.items).toEqual([{target:'EVT-0901',do:'replace',set:{event_status:'closed'},reason:'추적을 끝냄'}]);
  await expect(browse.locator('[data-lb-sec="tracking"]')).toHaveCount(0,{timeout:10000});
 });

 test(`⋯ [내용 업데이트…]: 대상이 그 기록으로 고정 · 상태·기한은 일상어 미리보기 · 반영 뒤 펼친 기록에 빨간 오류가 뜨지 않음 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  const row=browse.locator('[data-lb-sec="overdue"] [data-lb-row="'+u(3)+'"]');
  await row.locator('[data-lb-action="open"]').click();
  await row.locator('summary[aria-label^="기록 관리"]').click();
  await row.getByRole('menuitem',{name:'내용 업데이트…',exact:true}).click();
  const fix=page.locator('#ledgerFixRoot');
  await expect(fix.locator('#lfTitle')).toContainText('내용 업데이트 · 가상 사측 자료 회신 약속');
  // 대상이 고정: 다른 기록을 고치는 덩어리는 거절한다.
  await fix.locator('#lfText').fill(JSON.stringify({format:'kptu-ledger-fix',version:1,items:[{target:'DEC-0901',do:'retire',reason:'잘못 뽑힘'}]}));
  await fix.getByRole('button',{name:'미리보기'}).click();
  await expect(fix.locator('[data-lf-error]')).toContainText('이 기록 하나만 업데이트할 수 있어요');
  await expect(fix.getByRole('button',{name:'반영',exact:true})).toHaveCount(0);
  // 기한을 바꾸는 글 → 일상어 한 줄.
  const later=addDays(seoul(),10),laterLabel=Number(later.slice(5,7))+'/'+Number(later.slice(8,10));
  await page.route('**/functions/v1/ai-assist',async route=>{
   const body=route.request().postDataJSON();
   const req={format:'kptu-ledger-fix',version:1,received_from:'user',items:[{do:'replace',target:body.target,set:{follow_up_on:later},reason:'기한 변경'}]};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,kind:'ledger_fix',request:req,preview:[{target:body.target,do:'replace',reason:'기한 변경',changes:[{field:'follow_up_on',before:addDays(seoul(),-5),after:later}]}],question:''})});
  });
  await fix.locator('#lfText').fill('기한을 '+laterLabel+'로');
  await fix.getByRole('button',{name:'미리보기'}).click();
  await expect(fix.locator('[data-lf-preview] li')).toHaveText(['이 약속의 기한을 '+laterLabel+'로 바꿉니다. 옛 기록은 대체됨으로 남깁니다.']);
  await page.evaluate(()=>{window.__sawDetailError=false;new MutationObserver(()=>{if(document.querySelector('#ledgerBrowseRoot .lb-detail .lg-error'))window.__sawDetailError=true;}).observe(document.body,{subtree:true,childList:true});});
  await fix.getByRole('button',{name:'반영',exact:true}).click();
  await expect.poll(()=>db.fix.length).toBe(1);
  await expect(page.locator('[data-undo-notice]')).toContainText('원장에 반영했어요.');
  // 기한이 미래로 바뀌어 '안 지킨 약속'에서 빠지고, 그동안 펼친 기록 자리에 빨간 오류는 한 번도 뜨지 않았다.
  await expect(browse.locator('[data-lb-sec="overdue"]')).toHaveCount(0,{timeout:10000});
  expect(await page.evaluate(()=>window.__sawDetailError)).toBe(false);
 });

 test(`검색 결과에서 펼친 기록: [반영] 뒤 원장을 다시 읽어도 그 자리에 빨간 오류 없이 상세를 다시 읽어 보여 줌 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  await browse.locator('#lbCondBtn').click();
  await browse.locator('#lbInactive').check();
  await browse.locator('#lbQuery').fill('사측');
  await browse.locator('#lbQuery').press('Enter');
  const row=browse.locator('[data-lb-row="'+u(3)+'"]');
  await row.locator('[data-lb-action="open"]').click();
  await expect(row.locator('.lb-detail .lb-fields')).toBeVisible({timeout:10000});
  await row.locator('summary[aria-label^="기록 관리"]').click();
  await row.getByRole('menuitem',{name:'내용 업데이트…',exact:true}).click();
  const fix=page.locator('#ledgerFixRoot');
  await fix.locator('#lfText').fill('날짜를 11/5로');
  await fix.getByRole('button',{name:'미리보기'}).click();
  await expect(fix.locator('[data-lf-preview]')).toBeVisible({timeout:10000});
  await page.evaluate(()=>{window.__sawDetailError=false;new MutationObserver(()=>{if(document.querySelector('#ledgerBrowseRoot .lb-detail .lg-error'))window.__sawDetailError=true;}).observe(document.body,{subtree:true,childList:true});});
  const searches=db.search.length;
  await fix.getByRole('button',{name:'반영',exact:true}).click();
  await expect.poll(()=>db.fix.length).toBe(1);
  await expect.poll(()=>db.search.length,{timeout:10000}).toBeGreaterThan(searches);
  // 옛 기록(대체됨)은 '지난 기록도 보기' 결과에 남아 있으므로 펼친 채로 상세를 다시 읽는다.
  await expect(row.locator('.lb-detail .lb-fields')).toBeVisible({timeout:10000});
  await expect(row.locator('.lb-detail .lg-error')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__sawDetailError)).toBe(false);
  expect(await noSideScroll(page)).toBe(true);
 });
}

test('[+ 기록하기]: 일상어 → 새 기록 미리보기 → 반영 / Claude 수정안 덩어리는 같은 칸에서 해 보기 → 반영 / 알아듣지 못하면 되묻기 (phone 390px)',async({page})=>{
 test.setTimeout(90000);
 await page.setViewportSize({width:390,height:900});
 const db=await mockApp(page);
 await signIn(page);
 const browse=page.locator('#ledgerBrowseRoot');
 await browse.getByRole('button',{name:'+ 기록하기'}).click();
 const fix=page.locator('#ledgerFixRoot');
 await expect(fix.locator('#lfTitle')).toHaveText('기록하기');
 // 되묻기: 서버가 request 없이 question만 주면 [반영] 없이 한 줄.
 await fix.locator('#lfText').fill('모르는 그거 틀렸어');
 await fix.getByRole('button',{name:'미리보기'}).click();
 await expect(fix.locator('[data-lf-note]')).toHaveText('어느 교섭인지 알려 주세요.');
 await expect(fix.getByRole('button',{name:'반영',exact:true})).toHaveCount(0);
 // 새 기록.
 await fix.locator('#lfText').fill('다 지부 첫 교섭 11/12');
 await fix.getByRole('button',{name:'미리보기'}).click();
 await expect(fix.locator('[data-lf-preview] li')).toHaveText(['새 기록(일어난 일) ‘가상 다 지부 첫 교섭’ · 날짜 11/12 넣음.']);
 expect(db.ai.at(-1)).toEqual({kind:'ledger_fix',text:'다 지부 첫 교섭 11/12'});
 await fix.getByRole('button',{name:'반영',exact:true}).click();
 await expect.poll(()=>db.fix.length).toBe(1);
 expect(db.fix[0].p_request.items[0].do).toBe('add');
 await expect(browse.locator('[data-lb-sec="tracking"]')).toContainText('가상 다 지부 첫 교섭',{timeout:10000});
 // Claude 수정안 덩어리: 서버 AI 없이 DB 해 보기(p_dry_run=true) → 미리보기 → 반영.
 await browse.getByRole('button',{name:'+ 기록하기'}).click();
 const block={format:'kptu-ledger-fix',version:1,items:[{target:'DEC-0901',do:'retire',reason:'잘못 뽑힌 결정'}]};
 const aiBefore=db.ai.length;
 await fix.locator('#lfText').fill(JSON.stringify(block));
 await fix.getByRole('button',{name:'미리보기'}).click();
 await expect(fix.locator('[data-lf-preview] li')).toHaveText(['‘가상 교섭 위원 확정’을(를) 틀린 기록으로 폐기(지우지 않음).']);
 await expect(fix.locator('[data-lf-preview]')).toContainText('Claude 수정안');
 expect(db.ai.length).toBe(aiBefore);
 expect(db.fix.at(-1)).toEqual({p_workspace_id:workspace.id,p_dry_run:true,p_request:{received_from:'claude_chat',...block}});
 await fix.getByRole('button',{name:'반영',exact:true}).click();
 await expect.poll(()=>db.fix.at(-1).p_dry_run).toBe(false);
 expect(db.records.find(r=>r.ledger_id==='DEC-0901').validity).toBe('retired');
 // 깨진 덩어리는 일상어 이유만, 요청 없음.
 await browse.getByRole('button',{name:'+ 기록하기'}).click();
 const n=db.fix.length;
 await fix.locator('#lfText').fill('{"format":"x"');
 await fix.getByRole('button',{name:'미리보기'}).click();
 await expect(fix.locator('[data-lf-error]')).toContainText('Claude 수정안 모양이 아니에요');
 expect(db.fix.length).toBe(n);
 // Esc로 닫는다.
 await fix.locator('#lfText').press('Escape');
 await expect(fix).toBeHidden();
 expect(await noSideScroll(page)).toBe(true);
});

test('서버 배포 전이면 일상어는 준비 중 안내, Claude 덩어리 붙여 넣기는 그대로 된다 (PC 1280px)',async({page})=>{
 test.setTimeout(60000);
 await page.setViewportSize({width:1280,height:900});
 const db=await mockApp(page,{server:false});
 await signIn(page);
 const browse=page.locator('#ledgerBrowseRoot');
 await browse.getByRole('button',{name:'+ 기록하기'}).click();
 const fix=page.locator('#ledgerFixRoot');
 await fix.locator('#lfText').fill('나 지부 교섭 날짜 고침');
 await fix.getByRole('button',{name:'미리보기'}).click();
 await expect(fix.locator('[data-lf-error]')).toContainText('아직 준비 중');
 expect(db.fix).toHaveLength(0);
 await fix.locator('#lfText').fill(JSON.stringify({format:'kptu-ledger-fix',version:1,items:[{target:'EVT-0901',do:'replace',set:{summary:'고친 요지'},reason:'요지 보충'}]}));
 await fix.getByRole('button',{name:'미리보기'}).click();
 await expect(fix.locator('[data-lf-preview] li')).toHaveText(['‘가상 나 지부 2차 교섭’: 요지 ‘2차 교섭 일정.’ → ‘고친 요지’로 고침. 옛 기록은 대체됨으로 남김.']);
});

for(const [name,width] of [['PC',1280],['phone',390]]){
 test(`LEDGER-첫화면정리: 칩 두 줄 + [더보기 ▾]/[접기 ▴], 목록은 처음 6건 + [더보기 n ▾] (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  await mockApp(page,{many:true});
  await signIn(page);
  const browse=page.locator('#ledgerBrowseRoot');
  const box=browse.locator('[data-lb-chips]');
  await expect(box).toBeVisible({timeout:15000});
  // UI-칩줄두줄: [더보기 ▾]/[접기 ▴]는 앱 공용 칩 줄 부품(chip-rows.js)의 버튼, 접힌 칩은 data-chip-cut.
  const toggle=box.locator('[data-chip-rows-more]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText(/더보기/);
  // 보이는 칩은 두 줄 안(칩 줄 위치가 둘뿐), [더보기]는 둘째 줄 안.
  const rows=()=>box.evaluate(el=>{const tops=[...el.children].filter(c=>c.getClientRects().length).map(c=>Math.round(c.getBoundingClientRect().top));return [...new Set(tops)].length;});
  expect(await rows()).toBeLessThanOrEqual(2);
  const hiddenCount=await box.locator('.lb-topic[data-chip-cut]').count();
  expect(hiddenCount).toBeGreaterThan(0);
  // 펼치면 전부, 접으면 다시 두 줄.
  await toggle.click();
  await expect(toggle).toHaveText(/접기/);
  await expect(box.locator('.lb-topic[data-chip-cut]')).toHaveCount(0);
  expect(await rows()).toBeGreaterThan(2);
  await toggle.click();
  await expect(box.locator('.lb-topic[data-chip-cut]')).toHaveCount(hiddenCount);
  // 화면 폭이 바뀌면 개수를 다시 계산한다(좁히면 숨는 칩이 늘거나 같다).
  await page.setViewportSize({width:width===1280?700:320,height:900});
  await expect.poll(async()=>(await rows())<=2).toBe(true);
  expect(await box.locator('.lb-topic[data-chip-cut]').count()).toBeGreaterThanOrEqual(hiddenCount);
  await page.setViewportSize({width,height:900});
  // 추적 중인 일: 9건 중 처음 6건 + [더보기 3 ▾].
  const tracking=browse.locator('[data-lb-sec="tracking"]');
  await expect(tracking.locator('[data-lb-row]')).toHaveCount(6);
  const more=tracking.locator('[data-lb-action="list-more"]');
  await expect(more).toContainText('더보기 3');
  await more.click();
  await expect(tracking.locator('[data-lb-row]')).toHaveCount(9);
  await expect(tracking.locator('[data-lb-action="list-more"]')).toHaveCount(0);
  // 칩을 누르면 이야기도 처음엔 가장 최근 6건(시간순 유지) + 위쪽 [더보기 n ▾].
  await browse.locator('[data-lb-type="organization"][data-lb-action="story"]').first().click();
  const story=browse.locator('[data-lb-story="organization"]');
  await expect(story).toBeVisible({timeout:10000});
  expect(await noSideScroll(page)).toBe(true);
 });
}
