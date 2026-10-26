import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// MTG-기록겹침거르기 5단계: [원장] 화면 "겹친 기록 n건" 칸(ledger-merge.js). 같은 일로 판정된 두 원문이 원장의 서로 다른 두 기록에 걸려 있으면
// 한 줄로 합치자고 보이고, [합치기] → 해 보기 → [반영] → [합침 취소]까지 기존 수정 요청 함수 둘로만 간다. Supabase는 시험 상태로 대신한다(가상 값만).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ledger-m-user',email:'ledger-m@example.org',user_metadata:{display_name:'Ledger QA'}};
const workspace={id:'ledger-m-workspace',slug:'ledger-m',name:'웹2'};
const u=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const MEETING=u(1),UPDATE=u(2),FIX=u(900);

function mockDb(){
 return {
  records:[
   {id:u(11),ledger_id:'EVT-0901',kind:'event',title:'가상 철도 파업 출정 기자회견',validity:'current'},
   {id:u(12),ledger_id:'EVT-0902',kind:'event',title:'철도 파업 출정 기자회견 진행',validity:'current'},
  ],
  sources:[
   {id:u(21),ledger_id:'SRC-0901',location:`web2:meeting:${MEETING}`,status:'active'},
   {id:u(22),ledger_id:'SRC-0902',location:`web2:project_update:${UPDATE}`,status:'active'},
  ],
  links:[{record_id:u(11),source_id:u(21)},{record_id:u(12),source_id:u(22)}],
  applied:false,dry:[],real:[],undo:[],
 };
}
async function mockApp(page,db){
 await page.route(`${SB}/**`,async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
  const inList=name=>{const v=url.searchParams.get(name)||'';return v.startsWith('in.(')?v.slice(4,-1).split(','):null;};
  if(path==='/auth/v1/token')return ok({access_token:'ledger-m-access',refresh_token:'ledger-m-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  if(path==='/auth/v1/user')return ok(user);
  if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
  if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[]});
  if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(path.startsWith('/functions/v1/'))return ok({});
  if(path==='/rest/v1/rpc/app_apply_ledger_fix'){
   const body=request.postDataJSON();
   const items=body.p_request.items.map(i=>({target:i.target,do:i.do,reason:i.reason,changes:[]}));
   if(body.p_dry_run){db.dry.push(body);return ok({dry_run:true,fix_request_id:null,applied:items.length,items});}
   db.real.push(body);db.applied=true;db.records[1].validity='retired';db.request=body.p_request;
   return ok({dry_run:false,fix_request_id:FIX,applied:items.length,items});
  }
  if(path==='/rest/v1/rpc/app_undo_ledger_fix'){
   db.undo.push(request.postDataJSON());db.applied=false;db.records[1].validity='current';
   return ok({fix_request_id:FIX,status:'undone',records_retired:0,targets_restored:1,sources_unlinked:1});
  }
  if(path==='/rest/v1/rpc/app_ledger_search')return ok([]);
  if(path.startsWith('/rest/v1/rpc/'))return ok(null);
  if(path==='/rest/v1/app_record_overlaps')return ok([{a_ref:`meeting:${MEETING}`,b_ref:`project_update:${UPDATE}`,verdict:'same',decided_by:'ai'}]);
  if(path==='/rest/v1/app_ledger_sources'){
   const ids=inList('id'),locs=inList('location');
   return ok(db.sources.filter(s=>(ids?ids.includes(s.id):true)&&(locs?locs.includes(decodeURIComponent(s.location)):true)));
  }
  if(path==='/rest/v1/app_ledger_record_sources'){
   const sids=inList('source_id'),rids=inList('record_id');
   return ok(db.links.filter(l=>(sids?sids.includes(l.source_id):true)&&(rids?rids.includes(l.record_id):true)));
  }
  if(path==='/rest/v1/app_ledger_records'){
   const ids=inList('id'),ledger=inList('ledger_id');
   if(ids)return ok(db.records.filter(r=>ids.includes(r.id)&&r.validity!=='retired'));
   if(ledger)return ok(db.records.filter(r=>ledger.includes(r.ledger_id)).map(({ledger_id,title})=>({ledger_id,title})));
   return ok([]);
  }
  if(path==='/rest/v1/app_ledger_fix_requests')return ok(db.applied?[{id:FIX,applied_at:'2026-10-26T01:00:00Z',request:db.request}]:[]);
  if(path.startsWith('/rest/v1/app_ledger_'))return ok([]);
  if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
  if(path==='/rest/v1/app_workspaces')return ok([workspace]);
  if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'Ledger QA',job_title:''}]);
  if(path.startsWith('/rest/v1/'))return ok([]);
  return ok({});
 });
}
async function signIn(page){
 await page.goto(testOrigin+'/app/?view=ledger');
 await enterLogin(page);
 await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:10000});
 await signInWithSession(page,user.email);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
 await expect(page.locator('#ledgerView')).toBeVisible({timeout:15000});
}

for(const [name,width] of [['PC',1280],['phone',390]]){
 test(`원장 겹친 기록: 보기 → 합치기(해 보기) → 반영 → 합침 취소 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});
  const db=mockDb();
  await mockApp(page,db);
  await signIn(page);
  const root=page.locator('#ledgerMergeRoot');
  await expect(root).toHaveAttribute('data-ledger-merge','ready',{timeout:15000});
  const cand=root.locator('[data-lm-group="cand"]');
  await expect(cand.locator('summary')).toHaveText('겹친 기록 1건');
  await cand.locator('summary').click();
  const item=cand.locator('[data-lm-item]');
  await expect(item).toContainText('가상 철도 파업 출정 기자회견');
  await expect(item).toContainText('철도 파업 출정 기자회견 진행');
  await expect(item).toContainText('사업 보고');
  await expect(item).toContainText('프로젝트 기록');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  // 눌러도 아직 바뀌지 않는다: 해 보기만 가고, 미리보기를 보고 [반영]해야 바뀐다.
  await item.getByRole('button',{name:'합치기'}).click();
  await expect(root.locator('[data-lm-preview]')).toContainText('근거를 더하고');
  await expect(root.locator('[data-lm-preview]')).toContainText('지우지 않아요');
  expect(db.dry).toHaveLength(1);
  expect(db.real).toHaveLength(0);
  expect(db.dry[0].p_request.items.map(i=>[i.target,i.do])).toEqual([['EVT-0901','add_source'],['EVT-0902','retire']]);
  await root.getByRole('button',{name:'반영',exact:true}).click();
  await expect(page.locator('[data-undo-notice]')).toContainText('합쳤어요.');
  expect(db.real).toHaveLength(1);
  expect(db.real[0].p_request).toEqual(db.dry[0].p_request);
  expect(db.real[0].p_dry_run).toBe(false);
  // 합치고 나면 후보는 없고 "합친 기록 1건"이 남는다.
  await expect(root.locator('[data-lm-group="cand"]')).toHaveCount(0);
  const recent=root.locator('[data-lm-group="recent"]');
  await expect(recent.locator('summary')).toHaveText('합친 기록 1건');
  await recent.locator('summary').click();
  await expect(recent).toContainText('가상 철도 파업 출정 기자회견');
  await recent.getByRole('button',{name:'합침 취소'}).click();
  await expect.poll(()=>db.undo.length).toBe(1);
  expect(db.undo[0]).toEqual({p_fix_request_id:FIX});
  await expect(root.locator('[data-lm-group="cand"] summary')).toHaveText('겹친 기록 1건');
  await expect(root.locator('[data-lm-group="recent"]')).toHaveCount(0);
 });
}

test('원장 겹친 기록: 겹침 표가 아직 없으면 칸이 조용히 숨는다',async({page})=>{
 test.setTimeout(60000);
 await page.setViewportSize({width:1280,height:900});
 const db=mockDb();
 await mockApp(page,db);
 await page.route(`${SB}/rest/v1/app_record_overlaps**`,route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST205',message:'Could not find the table in the schema cache'})}));
 await signIn(page);
 await expect(page.locator('#ledgerMergeRoot')).toHaveAttribute('data-ledger-merge','hidden',{timeout:15000});
 await expect(page.locator('#ledgerMergeRoot')).toBeHidden();
});
