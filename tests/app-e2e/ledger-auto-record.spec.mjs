import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// LEDGER-자동기록 3단계(앱): 재료 저장 → 10분 묶어 ai-assist {kind:"ledger_auto"} 한 번(모의 서버) → 원장 목록에 '자동' 꼬리표·확인필요
// → 근거 ‹원문› → 상세 ⋯ [이번 자동 기록 취소](app_auto_ledger_undo). 맨 위 Claude용 사본 상태 한 줄, [지금 Drive로 내보내기] 버튼 없음.
// 서버가 배포 전(unsupported_kind)이면 저장은 그대로 되고 한 번만 묻고 조용히 멈춘다. Supabase는 시험 응답(가상 값만).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ledger-a-user',email:'ledger-a@example.org',user_metadata:{display_name:'Ledger QA'}};
const workspace={id:'e0000000-0000-4000-8000-0000000000aa',slug:'kptu-work',name:'웹2'};
const u=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NOTE=u(500),RUN=u(900),SRC=u(70);
const WAIT=10*60*1000;

async function mockApp(page,{server=true}={}){
 const db={records:[],changes:[],ai:[],saves:[],undo:[],exports:[]};
 await page.route(`${SB}/**`,async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
  const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
  if(path==='/auth/v1/token')return ok({access_token:'ledger-a-access',refresh_token:'ledger-a-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  if(path==='/auth/v1/user')return ok(user);
  if(path==='/functions/v1/ai-assist'){
   db.ai.push(request.postData());
   if(!server)return ok({ok:false,error:'unsupported_kind',message:'x'},400);
   const body=request.postDataJSON();
   if(body.kind!=='ledger_auto')return ok({ok:false,error:'unsupported_kind'},400);
   if(db.records.length)return ok({ok:true,kind:'ledger_auto',skipped:true,partial:false});
   const at=new Date().toISOString();
   db.records.push({id:u(1),workspace_id:workspace.id,kind:'commitment',ledger_id:'COM-0951',title:'가상 기관 자료 회신 약속',summary:'가 지부에 다음 주까지 자료 회신.',scope:'work',sensitivity:'S1',validity:'needs_check',
    date_start:'2026-10-24',date_end:null,date_precision:'day',date_note:'',counterparty:'가상 기관',commitment_status:'waiting',follow_up_on:null,note:'',superseded_by:null,updated_at:at,created_at:at});
   db.changes.push({record_id:u(1),action:'created',route:'auto',run_id:RUN,note:'',created_at:at});
   return ok({ok:true,kind:'ledger_auto',run_id:RUN,sources_seen:1,records_new:1,changes_linked:0,sources_added:0,needs_check:1,skipped:0,excluded:0,partial:false});
  }
  if(path==='/functions/v1/drive-summary'){
   const action=url.searchParams.get('action');
   if(method==='GET'&&action==='ledger_status')return ok({ok:true,ledger:{state:'found',last_success_at:'2026-10-20T05:20:00.000Z',last_failure_at:null,last_failure_code:null}});
   if(method==='POST'&&action==='ledger_export'){db.exports.push(1);return ok({ok:true,exported_at:new Date().toISOString(),counts:{app_ledger_records:1}});}
   return ok({ok:true,updated_at:new Date().toISOString(),documents:{}});
  }
  if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
  if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[]});
  if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(path.startsWith('/functions/v1/'))return ok({});
  if(path==='/rest/v1/rpc/app_ledger_search'){
   return ok(db.records.filter(r=>r.validity!=='retired'||request.postDataJSON().p_include_inactive).map(r=>({id:r.id,ledger_id:r.ledger_id,kind:r.kind,title:r.title,summary:r.summary,date_start:r.date_start,date_end:null,
    date_precision:r.date_precision,validity:r.validity,sensitivity:r.sensitivity,topic_name:null,organizations:[],score:0})));
  }
  if(path==='/rest/v1/rpc/app_auto_ledger_undo'){
   const a=request.postDataJSON();db.undo.push(a);
   for(const r of db.records)if(db.changes.some(c=>c.record_id===r.id&&c.run_id===a.p_run_id))r.validity='retired';
   return ok({run_id:a.p_run_id,status:'undone',records_retired:1,sources_unlinked:0,needs_check_restored:0});
  }
  if(path.startsWith('/rest/v1/rpc/'))return ok(null);
  if(path==='/rest/v1/app_notes'&&method!=='GET'){db.saves.push(request.postDataJSON());return ok([{id:NOTE,workspace_id:workspace.id,kind:'basket',raw_text:'가상 업데이트',created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]);}
  if(path==='/rest/v1/app_notes'&&(url.searchParams.get('id')||'').includes(NOTE))return ok([{id:NOTE,kind:'basket',archived_at:null,journal_day:null}]);
  if(path==='/rest/v1/app_ledger_record_changes'){
   const rec=url.searchParams.get('record_id')||'';
   return ok(db.changes.filter(c=>!rec||rec.includes(c.record_id)));
  }
  if(path==='/rest/v1/app_ledger_records'){
   const id=url.searchParams.get('id')||'';
   if(id.startsWith('eq.'))return ok(db.records.filter(r=>r.id===id.slice(3)));
   if(id.startsWith('in.')){const ids=id.slice(4,-1).split(',');return ok(db.records.filter(r=>ids.includes(r.id)&&(url.searchParams.get('kind')!=='eq.commitment'||r.kind==='commitment')).map(({id,ledger_id,title,kind})=>({id,ledger_id,title,kind})));}
   if(url.searchParams.get('select')==='updated_at')return ok(db.records.slice(-1).map(r=>({updated_at:r.updated_at})));
   return ok([]);
  }
  if(path==='/rest/v1/app_ledger_record_sources'){
   const rec=(url.searchParams.get('record_id')||'').slice(3);
   return ok(rec===u(1)?[{id:u(80),source_id:SRC,locator:'',note:''}]:[]);
  }
  if(path==='/rest/v1/app_ledger_sources')return ok([{id:SRC,ledger_id:'SRC-0951',title:'Web2 업데이트 2026-10-24',doc_type:'internal_doc',location:`web2:basket:${NOTE}`,drive_file_id:null,source_date:'2026-10-24',sensitivity:'S1',status:'active'}]);
  if(path.startsWith('/rest/v1/app_ledger_'))return ok([]);
  if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email,workspace}]);
  if(path==='/rest/v1/app_workspaces')return ok([workspace]);
  if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'Ledger QA',job_title:''}]);
  if(path.startsWith('/rest/v1/'))return ok([]);
  return ok({});
 });
 return db;
}
async function signIn(page,view='ledger'){
 await page.clock.install();
 await page.goto(testOrigin+'/app/?view='+view);
 await enterLogin(page);
 await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:10000});
 await signInWithSession(page,user.email);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
 await page.waitForFunction(()=>!!window.KPTULedgerAuto,null,{timeout:15000});
}
// 업데이트 저장(바구니와 같은 저장 경로: 공용 runtime의 POST app_notes → kptu:api-saved).
const saveUpdate=page=>page.evaluate(ws=>window.KPTURuntime.api('/rest/v1/app_notes',{method:'POST',prefer:'return=representation',body:{workspace_id:ws,raw_text:'가상 업데이트'}}),workspace.id);
const autoCalls=db=>db.ai.filter(b=>b&&JSON.parse(b).kind==='ledger_auto');
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);

for(const [name,width] of [['PC',1280],['phone',390]]){
 test(`원장 자동 기록: 저장 → 10분 뒤 한 번 → '자동'·확인필요 → ‹원문› → 이번 자동 기록 취소 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  await expect(page.locator('#ledgerView')).toBeVisible({timeout:15000});
  // 맨 위 상태 한 줄, 내보내기 버튼·칸 없음.
  const line=page.locator('#ledgerExportRoot [data-le-line]');
  await expect(line).toHaveAttribute('data-le-line','ok',{timeout:15000});
  await expect(line).toContainText('Claude용 사본');
  await expect(page.getByRole('button',{name:'지금 Drive로 내보내기'})).toHaveCount(0);
  await expect(page.locator('[data-le-action="export"]')).toHaveCount(0);
  const order=await page.evaluate(()=>[...document.querySelector('#ledgerView .lg-root').children].map(e=>e.id));
  expect(order[0]).toBe('ledgerExportRoot');

  await saveUpdate(page);
  expect(db.saves).toHaveLength(1);
  await page.clock.fastForward(WAIT-1000);
  expect(autoCalls(db)).toHaveLength(0);
  await page.clock.fastForward(1000);
  await expect.poll(()=>autoCalls(db).length,{timeout:10000}).toBe(1);
  expect(JSON.parse(autoCalls(db)[0])).toEqual({kind:'ledger_auto'});

  const row=page.locator('[data-lb-row]').filter({hasText:'COM-0951'});
  await expect(row).toBeVisible({timeout:10000});
  await expect(row.locator('[data-lb-auto]')).toHaveText('자동');
  await expect(row).toContainText('확인필요');
  await row.locator('[data-lb-action="open"]').click();
  const detail=row.locator('.lb-detail');
  await expect(detail.locator('[data-lb-web2="basket"]')).toContainText('업데이트 · 10/24',{timeout:10000});
  await expect(detail.getByRole('button',{name:'‹원문›'})).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);

  await detail.locator('summary[aria-label^="기록 관리"]').click();
  page.once('dialog',d=>d.accept());
  await detail.getByRole('button',{name:'이번 자동 기록 취소'}).click();
  await expect.poll(()=>db.undo.length).toBe(1);
  expect(db.undo[0]).toEqual({p_run_id:RUN});
  await expect(page.locator('[data-lb-notice]')).toContainText('이번 자동 기록을 취소했어요');
  await expect(page.locator('[data-lb-row]').filter({hasText:'COM-0951'})).toHaveCount(0,{timeout:10000});
  // 원장이 바뀌어 사본 갱신이 10분 뒤 한 번 예약된다.
  await page.clock.fastForward(WAIT+1000);
  await expect.poll(()=>db.exports.length,{timeout:10000}).toBeGreaterThanOrEqual(1);
 });
}

test('원장 자동 기록: ‹원문›을 누르면 그 업데이트가 열린다',async({page})=>{
 test.setTimeout(90000);
 const db=await mockApp(page);
 await signIn(page);
 await saveUpdate(page);
 await page.clock.fastForward(WAIT);
 await expect.poll(()=>autoCalls(db).length,{timeout:10000}).toBe(1);
 const row=page.locator('[data-lb-row]').filter({hasText:'COM-0951'});
 await row.locator('[data-lb-action="open"]').click();
 await row.getByRole('button',{name:'‹원문›'}).click();
 await expect(page.locator('#basketView')).toBeVisible({timeout:15000});
});

test('원장 자동 기록: 서버 배포 전이면 저장은 그대로, 한 번만 묻고 조용히 멈춤',async({page})=>{
 test.setTimeout(90000);
 const db=await mockApp(page,{server:false});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await signIn(page,'home');
 await saveUpdate(page);
 await page.clock.fastForward(WAIT);
 await expect.poll(()=>autoCalls(db).length,{timeout:10000}).toBe(1);
 await saveUpdate(page);
 expect(db.saves).toHaveLength(2);
 await page.clock.fastForward(WAIT*4);
 expect(autoCalls(db)).toHaveLength(1);
 await expect(page.locator('.kptu-undo-notice, [role="alert"]:has-text("원장")')).toHaveCount(0);
 expect(errors).toEqual([]);
});
