import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// FEAT-1029묶음 ⑥ 결정 변경 이력: 원장 상세 맨 아래 접힌 '이전 결정 n ▸'(폰 412·884, PC 1440). 가상 값만.
// 사슬은 '대체됨' 기록(validity=superseded, superseded_by)을 거꾸로 따라가고, 같은 주제 결정은 따로 한 줄(이야기 화면으로).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ledger-h-user',email:'ledger-h@example.org',user_metadata:{display_name:'Ledger QA'}};
const workspace={id:'ledger-h-workspace',slug:'ledger-h',name:'웹2'};
const u=n=>`e1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const TOPIC=u(60),NOW='2026-10-29T03:00:00Z'; // 시계 고정(날짜 표시 '9.03'은 올해 기준)
const base={workspace_id:workspace.id,scope:'work',sensitivity:'S1',importance:'normal',date_end:null,date_precision:'day',date_note:'',note:'',summary:''};
const RECORDS=[
 {...base,id:u(1),kind:'decision',ledger_id:'DEC-0103',title:'가상 회의비 기준 1인 1만 5천 원',summary:'가상 식비 기준을 올림.',topic_id:TOPIC,validity:'current',date_start:'2026-10-12',created_at:'2026-10-12T01:00:00Z',superseded_by:null},
 {...base,id:u(2),kind:'decision',ledger_id:'DEC-0102',title:'가상 회의비 기준 1인 1만 원',summary:'가상 둘째 기준.',topic_id:TOPIC,validity:'superseded',date_start:'2026-09-03',created_at:'2026-09-03T01:00:00Z',superseded_by:u(1),supersede_reason:'가상 물가 반영'},
 {...base,id:u(3),kind:'decision',ledger_id:'DEC-0101',title:'가상 회의비 기준 1인 8천 원',topic_id:TOPIC,validity:'superseded',date_start:'2026-07-15',created_at:'2026-07-15T01:00:00Z',superseded_by:u(2),supersede_reason:'가상 간담회 늘어 다시 정함'},
 {...base,id:u(4),kind:'decision',ledger_id:'DEC-0201',title:'가상 주간보고 마감 목요일',topic_id:TOPIC,validity:'current',date_start:'2026-10-08',created_at:'2026-10-08T01:00:00Z',superseded_by:null},
 {...base,id:u(5),kind:'commitment',ledger_id:'COM-0301',title:'가상 기관 자료 회신 11월 5일',topic_id:null,validity:'current',date_start:'2026-10-20',created_at:'2026-10-20T01:00:00Z',counterparty:'가상 기관',commitment_status:'waiting',follow_up_on:'2026-11-05',superseded_by:null},
 {...base,id:u(6),kind:'commitment',ledger_id:'COM-0300',title:'가상 기관 자료 회신 10월 30일',topic_id:null,validity:'superseded',date_start:'2026-10-10',created_at:'2026-10-10T01:00:00Z',counterparty:'가상 기관',commitment_status:'waiting',follow_up_on:'2026-10-30',superseded_by:u(5),supersede_reason:'가상 기한 미룸'},
];

async function mockApp(page){
 const db={history:[]};
 await page.route(`${SB}/**`,async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
  if(path==='/auth/v1/token')return ok({access_token:'ledger-h-access',refresh_token:'ledger-h-refresh',expires_in:3600,expires_at:Math.floor(Date.parse(NOW)/1000)+3600,user});
  if(path==='/auth/v1/user')return ok(user);
  if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
  if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[]});
  if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(path.startsWith('/functions/v1/'))return ok({});
  if(path==='/rest/v1/rpc/app_ledger_search'){
   const a=request.postDataJSON(),words=(a.p_query||'').toLowerCase().split(/\s+/).filter(Boolean);
   const rows=RECORDS.filter(r=>(a.p_include_inactive||r.validity==='current')&&(!a.p_kinds||a.p_kinds.includes(r.kind))&&(!a.p_topic_id||r.topic_id===a.p_topic_id)
     &&words.every(w=>(r.ledger_id+' '+r.title).toLowerCase().includes(w)))
    .map(r=>({id:r.id,ledger_id:r.ledger_id,kind:r.kind,title:r.title,summary:r.summary,date_start:r.date_start,date_end:null,date_precision:'day',validity:r.validity,sensitivity:'S1',topic_name:r.topic_id?'가상 회의비':null,organizations:[],score:0}));
   return ok(rows.slice(0,a.p_limit));
  }
  if(path.startsWith('/rest/v1/rpc/'))return ok(null);
  if(path==='/rest/v1/app_ledger_records'){
   const id=url.searchParams.get('id')||'',sup=url.searchParams.get('superseded_by')||'';
   if(sup.startsWith('in.')){
    expect(url.searchParams.get('validity')).toBe('eq.superseded');
    const ids=sup.slice(4,-1).split(',');db.history.push(ids);
    return ok(RECORDS.filter(r=>r.validity==='superseded'&&ids.includes(r.superseded_by)));
   }
   if(id.startsWith('eq.'))return ok(RECORDS.filter(r=>r.id===id.slice(3)));
   if(id.startsWith('in.')){const ids=id.slice(4,-1).split(',');return ok(RECORDS.filter(r=>ids.includes(r.id)).map(({id,ledger_id,title,kind})=>({id,ledger_id,title,kind})));}
   return ok([]);
  }
  if(path==='/rest/v1/app_ledger_topics')return ok([{id:TOPIC,ledger_id:'TOP-0101',name:'가상 회의비'}]);
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
 await page.clock.setFixedTime(new Date(NOW));
 await page.goto(testOrigin+'/app/?view=ledger');
 await enterLogin(page);
 await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:10000});
 await signInWithSession(page,user.email);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
 await expect(page.locator('#ledgerBrowseRoot')).toHaveAttribute('data-ledger-browse','ready',{timeout:15000});
}
async function openRecord(page,query,id){
 await page.locator('#lbQuery').fill(query);
 await page.locator('#lbQuery').press('Enter');
 const head=page.locator(`#ledgerBrowseRoot [data-lb-action="open"][data-lb-id="${id}"]`);
 await head.click();
 await expect(page.locator(`#lbDetail-${id}`)).toBeVisible();
 return page.locator(`#lbDetail-${id}`);
}

for(const width of [412,884,1440]){
 test(`원장 상세 맨 아래 이전 결정 접기 ${width}`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});
  const db=await mockApp(page);
  await signIn(page);
  const detail=await openRecord(page,'1만 5천',u(1));
  const fold=detail.locator('details[data-lb-history]');
  await expect(fold).toHaveCount(1);
  await expect(fold).not.toHaveAttribute('open','');
  await expect(fold.locator(':scope > summary')).toHaveText('이전 결정 2 ▸');
  // 상세의 맨 마지막 칸
  expect(await detail.evaluate(el=>el.lastElementChild?.matches('details[data-lb-history]'))).toBe(true);
  // 거꾸로 두 단계 읽고, 세 번째 단계에서 끝남
  expect(db.history.slice(0,2)).toEqual([[u(1)],[u(2)]]);
  // 키보드로 펼치기
  await fold.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(fold).toHaveAttribute('open','');
  await expect(fold.locator(':scope > summary')).toHaveText('이전 결정 2 ⌄');
  const lines=fold.locator('.lb-hist-line');
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toContainText('7.15가상 회의비 기준 1인 8천 원');
  await expect(lines.nth(1)).toContainText('9.03가상 회의비 기준 1인 1만 원사유: 가상 간담회 늘어 다시 정함');
  await expect(lines.nth(2)).toContainText('10.12가상 회의비 기준 1인 1만 5천 원 지금사유: 가상 물가 반영');
  // 같은 주제 결정은 섞지 않고 따로 한 줄(지금 기록 빼고 1건)
  await expect(fold).not.toContainText('주간보고');
  const topic=fold.locator('.lb-hist-topic');
  await expect(topic).toHaveText('같은 주제 결정 1건 ›');
  // 옛 줄을 누르면 그 기록의 근거·출처가 그 자리에서(읽기만)
  await lines.nth(1).locator('summary').click();
  await expect(lines.nth(1).locator('.lb-hist-body')).toContainText('가상 둘째 기준.');
  await expect(lines.nth(1).locator('.lb-hist-body [data-wait-empty]')).toHaveText('출처 없음');
  await expect(fold).toHaveAttribute('open','');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  // 같은 주제 → 이야기 화면
  await topic.click();
  await expect(page.locator('#lbStoryTitle')).toContainText('가상 회의비');
 });
}

test('약속도 이전 기록으로 보이고, 이전 기록이 없으면 줄 없음, 다시 열면 접힌 채',async({page})=>{
 test.setTimeout(60000);
 await page.setViewportSize({width:412,height:900});
 await mockApp(page);
 await signIn(page);
 let detail=await openRecord(page,'11월 5일',u(5));
 const fold=detail.locator('details[data-lb-history]');
 await expect(fold.locator(':scope > summary')).toHaveText('이전 기록 1 ▸');
 await fold.locator(':scope > summary').click();
 await expect(fold.locator('.lb-hist-line').nth(1)).toContainText('사유: 가상 기한 미룸');
 await expect(fold.locator('.lb-hist-topic')).toHaveCount(0);
 // 닫았다 다시 열면 접힘(펼침은 저장하지 않음)
 await page.locator(`#ledgerBrowseRoot [data-lb-action="open"][data-lb-id="${u(5)}"]`).click();
 await expect(page.locator(`#lbDetail-${u(5)}`)).toHaveCount(0);
 await page.locator(`#ledgerBrowseRoot [data-lb-action="open"][data-lb-id="${u(5)}"]`).click();
 await expect(page.locator(`#lbDetail-${u(5)} details[data-lb-history]`)).not.toHaveAttribute('open','');
 // 이전 기록이 없는 결정
 detail=await openRecord(page,'주간보고',u(4));
 await expect(detail.locator('h5').first()).toBeVisible();
 await expect(detail.locator('details[data-lb-history]')).toHaveCount(0);
});
