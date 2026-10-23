import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {csvFiles,xlsxBytes} from '../ledger-import-fixture.mjs';

// AI-서버연동 S7-b: [원장] 화면. 사이드바·메뉴 판 [원장](?view=ledger). 원장 표가 없으면 "원장 표 준비 전"만,
// 있으면 올리기 → 검사 요약 → 대응표 확인 → 해 보기 → 적용 → 숫자 확인 → 되돌리기·확인. 시트는 합성(09xx ID, 가상 이름).
// Supabase는 시험 상태로 대신한다. RPC로 가는 내용에 파일 원문(머리줄·민감 제외 행)이 없는지도 본다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ledger-import-user',email:'ledger-import@example.org',user_metadata:{display_name:'Ledger QA'}};
const workspace={id:'ledger-import-workspace',slug:'ledger-import',name:'웹2'};
const ZERO='00000000-0000-0000-0000-000000000000';
const KINDS=['event','change','decision','evidence','commitment'];

function countsOf(payload){
 return {topics:payload.topics.length,organizations:payload.organizations.length,sources:payload.sources.length,records:payload.records.length,
  records_by_kind:Object.fromEntries(KINDS.map(k=>[k,payload.records.filter(r=>r.kind===k).length]).filter(([,n])=>n)),
  record_sources:payload.record_sources.length,links:payload.links.length,links_to_records:payload.links.filter(l=>l.target_record).length,
  links_to_organizations:payload.links.filter(l=>l.target_organization).length,legacy_write_requests:payload.legacy_write_requests.length,modified:0};
}

async function mockApp(page,{tables=true,functions=true}={}){
 const db={imports:[],rpc:[]};
 await page.route(`${SB}/**`,async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
  const missing=()=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST205',message:'Could not find the table in the schema cache'})});
  if(path==='/auth/v1/token')return ok({access_token:'ledger-access',refresh_token:'ledger-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  if(path==='/auth/v1/user')return ok(user);
  if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
  if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[]});
  if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(path.startsWith('/functions/v1/'))return ok({});
  if(path.startsWith('/rest/v1/rpc/app_import_ledger_')){
   if(!tables||!functions)return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST202',message:'Could not find the function'})});
   const body=request.postDataJSON(),name=path.split('/').at(-1);
   db.rpc.push({name,body:request.postData()});
   if(name==='app_import_ledger_counts'){
    const found=db.imports.find(i=>i.import_id===body.p_import_id);
    return ok(body.p_import_id===ZERO||!found?null:found);
   }
   if(name==='app_import_ledger_apply'){
    const file=body.p_file;
    if(db.imports.some(i=>i.sha===file.sha256&&i.status!=='reverted'))return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'23505',message:'LEDGER_IMPORT_DUPLICATE_FILE: this file was already imported'})});
    const counts=countsOf(file);
    if(body.p_dry_run)return ok({...counts,import_id:null,status:'dry_run',dry_run:true,registered_prefixes:Object.entries(file.id_prefixes).map(([s,p])=>s+':'+p)});
    const row={...counts,import_id:'imp-'+(db.imports.length+1),id:'imp-'+(db.imports.length+1),label:file.label,status:'applied',source_kind:file.source_kind,created_at:new Date().toISOString(),decided_at:null,file:{...counts,report:file.report},row_counts:{report:file.report},sha:file.sha256};
    db.imports.unshift(row);
    return ok(row);
   }
   const row=db.imports.find(i=>i.import_id===body.p_import_id);
   if(!row||row.status!=='applied')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'LEDGER_IMPORT_NOT_OPEN'})});
   if(name==='app_import_ledger_confirm')row.status='confirmed';
   if(name==='app_import_ledger_revert'){row.status='reverted';for(const k of ['topics','organizations','sources','records','record_sources','links','links_to_records','links_to_organizations','legacy_write_requests'])row[k]=0;row.records_by_kind={};}
   row.decided_at=new Date().toISOString();
   return ok(row);
  }
  if(path.startsWith('/rest/v1/rpc/'))return ok(null);
  if(path.startsWith('/rest/v1/app_ledger_')){
   if(!tables)return missing();
   if(path==='/rest/v1/app_ledger_imports'&&url.searchParams.get('select')!=='id')return ok(db.imports.map(({id,label,status,source_kind,created_at,decided_at,row_counts})=>({id,label,status,source_kind,created_at,decided_at,row_counts})));
   return ok([]);
  }
  if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
  if(path==='/rest/v1/app_workspaces')return ok([workspace]);
  if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'Ledger QA',job_title:''}]);
  if(path.startsWith('/rest/v1/'))return ok([]);
  return ok({});
 });
 return db;
}

async function signIn(page,view){
 await page.goto(testOrigin+'/app/?view='+view);
 await enterLogin(page);
 await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:10000});
 await signInWithSession(page,user.email);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
}
const csvUploads=()=>csvFiles().map(f=>({name:f.name,mimeType:'text/csv',buffer:Buffer.from(f.bytes)}));
const summaryRow=(page,tab)=>page.locator(`[data-lg-summary] tr[data-lg-tab="${tab}"] td`);

for(const [name,width] of [['PC',1440],['phone',390]]){
 test(`원장 표가 없으면 [원장]은 "원장 표 준비 전"만 보인다; 사이드바·메뉴 판 [원장] 입구 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});
  await mockApp(page,{tables:false});
  // PROFILE-1: [원장]은 프로필 계정 칸이 아니라 사이드바(PC)·[메뉴] 판(폰)에서 연다.
  await signIn(page,'profile');
  await expect(page.locator('#profileView')).toBeVisible({timeout:15000});
  await expect(page.locator('#psLedgerEntry')).toHaveCount(0);
  await expect(page.locator('#profileView').getByRole('button',{name:'원장'})).toHaveCount(0);
  await page.evaluate(()=>window.KPTURouter.go('home'));
  await expect(page.locator('#homeView')).toBeVisible({timeout:15000});
  if(width>=1024)await page.locator('#appView>.app-nav').getByRole('button',{name:'원장',exact:true}).click();
  else{await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu nav').getByRole('button',{name:'원장',exact:true}).click()}
  await expect(page.locator('#ledgerView')).toBeVisible({timeout:15000});
  await expect(page).toHaveURL(/view=ledger/);
  await expect(page.locator('[data-ledger-notice="not-ready"]')).toContainText('원장 표 준비 전');
  await expect(page.locator('#lgFile')).toHaveCount(0);
  await expect(page.locator('#ledgerRoot [data-lg-action]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.goBack();
  await expect(page.locator('#homeView')).toBeVisible();
 });

 test(`올리기 → 검사 요약 → 대응표 확인 → 해 보기 → 적용 → 숫자 확인 → 되돌리기 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  page.on('dialog',dialog=>dialog.accept());
  await signIn(page,'ledger');
  await expect(page.locator('#ledgerView')).toBeVisible({timeout:15000});
  await expect(page.locator('#ledgerRoot')).toHaveAttribute('data-ledger-state','ready');
  await expect(page.locator('[data-lg-imports]')).toHaveCount(0);

  await page.locator('#lgFile').setInputFiles(csvUploads());
  await expect(page.locator('[data-lg-verdict="ok"]')).toBeVisible();
  await expect(page.locator('#lgLabel')).toHaveValue(/^시트 가져오기 \d{4}-\d{2}-\d{2}$/);
  // 사건: 시트 3행 = 넣을 2 + 민감 제외 1. 조직연결: 민감 사건에 걸린 연결 1행 제외.
  await expect(summaryRow(page,'event')).toHaveText(['3','2','1','0']);
  await expect(summaryRow(page,'org_link')).toHaveText(['3','2','1','0']);
  await expect(summaryRow(page,'source')).toHaveText(['3','2','1','0']);
  await expect(page.locator('[data-lg-issues="excluded"] [data-lg-reason="s3"]')).toContainText('2건');
  await expect(page.locator('[data-lg-issues="error"]')).toHaveCount(0);
  await expect(page.locator('#lgResult')).toContainText('검색인덱스(L2)');
  await expect(page.locator('[data-lg-prefixes]')).toContainText('사건 EVT(새로 등록)');

  // 대응표: 애매한 값(분야 "가상 철도")은 ⚠로 열려 있다. 고르면 다시 검사.
  const mapping=page.locator('[data-lg-mapping]');
  await expect(mapping).toHaveAttribute('open','');
  const topic=page.locator('select[data-lg-map-field="topic"][data-lg-map-raw="가상 철도"]');
  await expect(topic).toHaveValue('');
  await topic.selectOption('TOP-0901');
  await expect(page.locator('select[data-lg-map-field="topic"][data-lg-map-raw="가상 철도"]')).toHaveValue('TOP-0901');
  const apply=page.locator('[data-lg-action="apply"]'),dry=page.locator('[data-lg-action="dry"]');
  await expect(apply).toBeDisabled();

  await dry.click();
  await expect(page.locator('[data-lg-dry]')).toBeVisible();
  await expect(page.locator('[data-lg-dry] tbody th').filter({hasText:'일어난 일'})).toHaveCount(1);
  await expect(page.locator('[data-lg-dry] tbody th').filter({hasText:'정한 것'})).toHaveCount(1);
  await expect(page.locator('#lgLive')).toContainText('DB에는 아무것도 남지 않았습니다');
  await expect(apply).toBeDisabled();
  await page.locator('#lgMappingOk').check();
  await expect(apply).toBeEnabled();
  // 대응표를 바꾸면 해 보기를 다시 해야 한다.
  await page.locator('select[data-lg-map-field="importance"][data-lg-map-raw="높음"]').selectOption('very_high');
  await expect(page.locator('[data-lg-dry]')).toHaveCount(0);
  await expect(page.locator('#lgMappingOk')).not.toBeChecked();
  await dry.click();
  await expect(page.locator('[data-lg-dry]')).toBeVisible();
  await page.locator('#lgMappingOk').check();
  await apply.click();

  const check=page.locator('[data-lg-check="applied"]');
  await expect(check).toBeVisible();
  await expect(check.locator('tr[data-lg-tab="event"] td')).toHaveText(['3','2','1','0','맞음']);
  await expect(check.locator('[data-lg-numbers] tbody tr')).toHaveCount(10);
  await expect(check.locator('td:has-text("다름")')).toHaveCount(0);
  await expect(page.locator('[data-lg-import][data-lg-status="applied"]')).toHaveCount(1);
  await expect(page.locator('[data-lg-result]')).toHaveCount(0);
  await expect(check.locator('[data-lg-action="confirm"]')).toBeEnabled();

  await check.locator('[data-lg-action="revert"]').click();
  await expect(page.locator('[data-lg-check="reverted"]')).toBeVisible();
  await expect(page.locator('[data-lg-check="reverted"] [data-lg-action]')).toHaveCount(0);
  // 되돌린 묶음은 "다름"이 아니라 "되돌림"으로 보이고, 같은 파일을 다시 해 볼 수 있다.
  await expect(page.locator('[data-lg-check="reverted"] td:has-text("다름")')).toHaveCount(0);
  await expect(page.locator('[data-lg-check="reverted"] tr[data-lg-tab="event"] td').last()).toHaveText('되돌림');
  await page.locator('#lgFile').setInputFiles(csvUploads());
  await expect(page.locator('[data-lg-verdict="ok"]')).toBeVisible();
  await page.locator('[data-lg-action="dry"]').click();
  await expect(page.locator('[data-lg-dry]')).toBeVisible();
  await expect(page.locator('[data-lg-error]')).toHaveCount(0);
  await expect(page.locator('[data-lg-import][data-lg-status="reverted"]')).toHaveCount(1);

  // RPC로 간 것은 검사를 통과한 행뿐: 머리줄·가져오지 않는 칸·민감 제외 행·가져오지 않는 탭 내용이 없다.
  const sent=db.rpc.filter(r=>r.name==='app_import_ledger_apply');
  expect(sent.length).toBe(4);
  for(const r of sent){
   for(const text of ['신문반영일','"가상 민감 사건"','가상 민감 메모','EVT-0903','SRC-0903','계속추적','검색인덱스'])expect(r.body).not.toContain(text);
  }
  const final=JSON.parse(sent[2].body);
  expect(final.p_dry_run).toBe(false);
  expect(final.p_file.records.find(x=>x.ledger_id==='EVT-0901')).toMatchObject({topic:'TOP-0901',importance:'very_high',event_status:'tracking',date_precision:'month',date_start:'2026-03-01'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 });
}

test('xlsx 한 개도 같은 검사; 같은 파일을 다시 적용하면 DB가 거절한 이유를 보여 준다; 확인하면 잠긴다',async({page})=>{
 test.setTimeout(90000);
 await page.setViewportSize({width:1440,height:900});
 await mockApp(page);
 page.on('dialog',dialog=>dialog.accept());
 await signIn(page,'ledger');
 await expect(page.locator('#ledgerRoot')).toHaveAttribute('data-ledger-state','ready',{timeout:15000});
 const upload=()=>page.locator('#lgFile').setInputFiles({name:'가상 원장.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(xlsxBytes())});
 await upload();
 await expect(page.locator('[data-lg-verdict="ok"]')).toBeVisible();
 await expect(summaryRow(page,'decision')).toHaveText(['2','2','0','0']);
 await page.locator('[data-lg-action="dry"]').click();
 await page.locator('#lgMappingOk').check();
 await page.locator('[data-lg-action="apply"]').click();
 await expect(page.locator('[data-lg-check="applied"]')).toBeVisible();
 await page.locator('[data-lg-check="applied"] [data-lg-action="confirm"]').click();
 await expect(page.locator('[data-lg-check="confirmed"]')).toBeVisible();
 await expect(page.locator('[data-lg-check="confirmed"] [data-lg-action]')).toHaveCount(0);
 await upload();
 await expect(page.locator('[data-lg-verdict="ok"]')).toBeVisible();
 await page.locator('[data-lg-action="dry"]').click();
 await expect(page.locator('[data-lg-error]')).toContainText('이미 가져온 파일입니다');
});

test('검사에서 거부가 있으면 해 보기·적용을 막고 사유별 수를 보여 준다; 가져오기 기능이 없으면 그 안내만',async({page})=>{
 test.setTimeout(60000);
 await page.setViewportSize({width:1440,height:900});
 await mockApp(page);
 await signIn(page,'ledger');
 await expect(page.locator('#ledgerRoot')).toHaveAttribute('data-ledger-state','ready',{timeout:15000});
 const enc=new TextEncoder();
 const broken='ID,사건ID,제목,기준일\r\nCHG-0950,EVT-0999,가상 변화,2026-02-30\r\nCHG-0951,EVT-0999,가상 변화 둘,2026-03-01\r\n';
 await page.locator('#lgFile').setInputFiles({name:'가상 원장 - 변화기록.csv',mimeType:'text/csv',buffer:Buffer.from(enc.encode(broken))});
 await expect(page.locator('[data-lg-verdict="rejected"]')).toBeVisible();
 await expect(page.locator('[data-lg-issues="error"] [data-lg-reason="bad_date"]')).toContainText('1건');
 await expect(page.locator('[data-lg-issues="error"] [data-lg-reason="broken_ref"]')).toContainText('CHG-0951 → EVT-0999');
 await expect(page.locator('[data-lg-action="dry"]')).toBeDisabled();
 await expect(page.locator('[data-lg-action="apply"]')).toBeDisabled();

 await page.unrouteAll({behavior:'ignoreErrors'});
 await mockApp(page,{functions:false});
 await page.reload();
 await expect(page.locator('[data-ledger-notice="no-functions"]')).toContainText('가져오기 기능 준비 전',{timeout:20000});
 await expect(page.locator('#lgFile')).toHaveCount(0);
});
