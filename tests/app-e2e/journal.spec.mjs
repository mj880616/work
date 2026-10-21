import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { testOrigin } from './helpers/test-origin.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// JOURNAL-일지 2단계: [일정] [달력|할 일|일지|일기] → [일지]. The clock is 2026-10-06 10:00 KST (Tuesday); the week is
// 10/5(월)~10/11(일). The mock keeps one app_notes store, honours PostgREST filters and the database's work-line rules
// (JOURNAL-오늘한줄목록, 20261020051027: one row a day — 409; raw_text = 1~50 lines joined by "\n", each 1~300 characters,
// no empty line, no attachments; oneLine:true is the rule before that change), and lets each material source fail on its own.
// JOURNAL-일지카드정리: an update is saved in one of three places (basket row, organization record, project record); the mock
// keeps all three plus the meetings, honouring the same filters, so 조직 소식 and 회의·행사 결과 read what the screen asks for.
// JOURNAL-주간보고허브 1단계: project records are 프로젝트 소식 (by project name), and the mock also keeps documents
// (자료실 새 자료, by created_at), share pages (공유 페이지, by updated_at) and pending Google tasks (할 일 예정, by due).
const at='2026-10-06T00:30:00Z';
const GREETING='안녕하세요 위원장님\n다음 주 일정 공유드립니다\n출처: 가상 소식지';
function store(){
 return [
  {id:'b1',workspace_id:'w',kind:'basket',title:null,journal_day:null,raw_text:'현장 간담회 메모\n둘째 줄',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'b2',workspace_id:'w',kind:'basket',title:null,journal_day:null,raw_text:GREETING,occurred_at:'2026-10-06T00:20:00Z',created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'b0',workspace_id:'w',kind:'basket',title:null,journal_day:null,raw_text:'지난주 메모',occurred_at:'2026-09-29T01:00:00Z',created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'n1',workspace_id:'w',kind:'note',title:'교섭 정리 노트',journal_day:null,raw_text:'본문',occurred_at:at,created_at:at,updated_at:'2026-10-06T00:40:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'k5',workspace_id:'w',kind:'work',title:null,journal_day:'2026-10-05',raw_text:'월요일 한 줄',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'k0',workspace_id:'w',kind:'work',title:null,journal_day:'2026-09-30',raw_text:'지난주 수요일',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'d1',workspace_id:'w',kind:'diary',title:null,journal_day:'2026-10-06',raw_text:'일기 JOURNAL_SECRET',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:false,attachments:[],metadata:{}},
 ];
}
function validWork(row,oneLine){
 if(typeof row.raw_text!=='string'||(row.attachments||[]).length||!row.journal_day||/\r/.test(row.raw_text))return false;
 if(oneLine)return !/\n/.test(row.raw_text)&&[...row.raw_text.trim()].length>=1&&[...row.raw_text.trim()].length<=300;
 const lines=row.raw_text.split('\n');
 return lines.length<=50&&lines.every(l=>l.trim()&&[...l].length<=300);
}
const others=()=>({
 orgs:[{id:'o1',workspace_id:'w',name:'가상 노동조합'},{id:'o2',workspace_id:'w',name:'나 지역 모임'}],
 links:[{id:'l1',workspace_id:'w',note_id:'b2',status:'confirmed',organization_id:'o1',project_id:null,meeting_id:null,document_id:null,summary:null,organization:{name:'가상 노동조합'}}],
 orgUpdates:[
  {id:'u1',organization_id:'o2',occurred_at:'2026-10-06T02:00:00Z',raw_text:'조직 화면에서 쓴 업데이트\n둘째 줄',detail_text:null},
  {id:'u0',organization_id:'o2',occurred_at:'2026-10-06T15:00:00Z',raw_text:'수요일 0시 기록',detail_text:null},
 ],
 progress:[{id:'p1',project_id:'p',summary:'진행상황 업데이트',effective_on:'2026-10-06',created_at:'2026-10-06T03:00:00Z'}],
 spaces:[{id:'p',workspace_id:'w',name:'가상 사업'}],
 meetings:[
  {id:'m1',workspace_id:'w',title:'가상 기자회견',series_name:'가상 기자회견',round_no:null,meeting_at:'2026-10-06T05:00:00Z'},
  {id:'m2',workspace_id:'w',title:'운영위원회',series_name:'운영위원회',round_no:3,meeting_at:'2026-10-08T01:00:00Z'},
 ],
 docs:[
  {id:'doc1',workspace_id:'w',title:'가상 교섭 요구안',file_name:'a.pdf',category:'교섭자료',meeting_id:null,created_at:'2026-10-06T01:00:00Z'},
  {id:'doc2',workspace_id:'w',title:'운영위 3차 자료',file_name:'b.hwp',category:'회의',meeting_id:'m2',created_at:'2026-10-08T02:00:00Z'},
  {id:'doc9',workspace_id:'w',title:'다음 주 자료',file_name:'c.pdf',category:'교육',meeting_id:null,created_at:'2026-10-11T15:00:00Z'},
 ],
 shares:[
  {id:'sp1',workspace_id:'w',title:'가상 안내 페이지',status:'published',updated_at:'2026-10-06T04:00:00Z'},
  {id:'sp0',workspace_id:'w',title:'지난주 페이지',status:'draft',updated_at:'2026-09-30T04:00:00Z'},
 ],
});
// ORG-담당13기준: the organization read also asks for my assignment rows; o1·o2 are mine. outside:true adds two organizations
// that are not mine (one active and unassigned, one assigned but inactive), each with a Tuesday record (fake names only).
async function fixture(page,{width=390,height=900,fail={},oneLine=false,doneServer='old',outside=false}={}){
 const rows=store(),writes=[],reads=[],errors=[],taskCalls=[],more=others();
 more.assignees=['o1','o2'].map(organization_id=>({organization_id,user_id:'home-test'}));
 if(outside){
  more.orgs.push({id:'o3',workspace_id:'w',name:'다 바깥 모임',active:true},{id:'o4',workspace_id:'w',name:'라 쉬는 모임',active:false});
  more.assignees.push({organization_id:'o4',user_id:'home-test'});
  more.orgUpdates.push({id:'u3',organization_id:'o3',occurred_at:'2026-10-06T03:00:00Z',raw_text:'바깥 모임 기록\n둘째 줄',detail_text:null},
   {id:'u4',organization_id:'o4',occurred_at:'2026-10-06T04:00:00Z',raw_text:'쉬는 모임 기록',detail_text:null});
 }
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await page.setViewportSize({width,height});
 await openHome(page);
 const match=(row,q)=>{
  for(const [k,v] of q.entries()){
   if(['select','order','limit','offset'].includes(k))continue;
   const [op,...rest]=v.split('.'),val=rest.join('.'),cell=String(row[k]);
   if(op==='eq'&&cell!==val)return false;
   if(op==='gte'&&!(cell>=val))return false;
   if(op==='lte'&&!(cell<=val))return false;
   if(op==='lt'&&!(cell<val))return false;
   if(op==='in'&&!val.slice(1,-1).split(',').map(decodeURIComponent).includes(cell))return false;
  }
  return true;
 };
 const instants=(row,q)=>{const copy={...row};for(const k of ['occurred_at','meeting_at','created_at','updated_at'])if(q.has(k)&&row[k])copy[k]=new Date(row[k]).toISOString();return copy;};
 // Only the journal's reads (when) are answered here; other screens' reads of the same table fall back to the home mock.
 const table=(name,list,key,when)=>page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+name,async r=>{
  const q=new URL(r.request().url()).searchParams;
  if(r.request().method()!=='GET'||!when(q))return r.fallback();
  reads.push({table:name,...Object.fromEntries([...q.entries()].map(([k])=>[k,q.getAll(k).join('&')]))});
  if(key&&fail[key])return r.fulfill({status:500,json:{message:'QA failure'}});
  // Every filter must hold for every value given (gte & lt on one column).
  const hit=list.filter(row=>[...q.keys()].every(k=>['select','order','limit','offset'].includes(k)||q.getAll(k).every(v=>match(instants(row,q),new URLSearchParams([[k,v]])))));
  const offset=Number(q.get('offset')||0),limit=Number(q.get('limit')||1000);
  return r.fulfill({json:hit.slice(offset,offset+limit)});
 });
 await table('app_suborganizations',more.orgs,null,q=>q.get('select')==='id,name,active');
 await table('app_suborganization_assignees',more.assignees,null,q=>q.get('select')==='organization_id'&&q.has('user_id'));
 await table('app_record_links',more.links,'memos',q=>q.has('note_id'));
 await table('app_suborganization_updates',more.orgUpdates,'orgUpdates',q=>q.has('occurred_at'));
 await table('app_project_progress_updates',more.progress,'progress',q=>q.has('effective_on'));
 await table('app_spaces',more.spaces,null,q=>q.get('select')==='id,name'&&q.has('id'));
 await table('app_meetings',more.meetings,'meetings',q=>q.has('meeting_at'));
 await table('app_documents',more.docs,'documents',q=>q.has('created_at'));
 await table('app_share_pages',more.shares,'sharePages',q=>q.has('updated_at'));
 // updated_at filters come as ISO instants; compare them as instants.
 const norm=(row,q)=>{const copy={...row};if(q.has('updated_at'))copy.updated_at=new Date(row.updated_at).toISOString();return copy;};
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
  if(method==='GET'){
   reads.push(Object.fromEntries([...q.entries()].map(([k])=>[k,q.getAll(k).join('&')])));
   if(fail.notes&&q.get('kind')==='eq.note')return r.fulfill({status:500,json:{message:'QA failure'}});
   if(fail.memos&&q.get('kind')==='eq.basket')return r.fulfill({status:500,json:{message:'QA failure'}});
   return r.fulfill({json:rows.filter(row=>match(norm(row,q),q)).slice(Number(q.get('offset')||0))});
  }
  if(method==='POST'){
   const body=req.postDataJSON();writes.push({method,body});
   const row={id:'k-new-'+writes.length,title:null,occurred_at:at,created_at:at,updated_at:'2026-10-06T01:00:0'+writes.length+'Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...body};
   if(rows.some(x=>x.kind===row.kind&&x.journal_day===row.journal_day))return r.fulfill({status:409,json:{code:'23505',message:'duplicate key'}});
   if(row.kind==='work'&&!validWork(row,oneLine))return r.fulfill({status:400,json:{code:'23514'}});
   rows.push(row);return r.fulfill({status:201,json:[row]});
  }
  if(method==='PATCH'){
   const body=req.postDataJSON();writes.push({method,query:Object.fromEntries(q),body});
   const hit=rows.filter(row=>match(row,q));
   for(const row of hit){const next={...row,...body};if(next.kind==='work'&&!validWork(next,oneLine))return r.fulfill({status:400,json:{code:'23514'}});Object.assign(row,next);}
   return r.fulfill({json:hit});
  }
  if(method==='DELETE'){
   writes.push({method,query:Object.fromEntries(q)});
   const hit=rows.filter(row=>match(row,q));
   for(const row of hit)rows.splice(rows.indexOf(row),1);
   return r.fulfill({json:hit});
  }
  return r.fulfill({status:500,json:{}});
 });
 const sources={events:!fail.events,tasks:!fail.tasks};
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/google-calendar',async r=>{
  const a=new URL(r.request().url()).searchParams.get('action');
  if(a!=='events')return r.fallback();
  if(!sources.events)return r.fulfill({status:500,json:{error:'QA failure'}});
  return r.fulfill({json:{events:[
   {id:'all',title:'여러 날 일정',allDay:true,start:'2026-10-05',end:'2026-10-08',calendarId:'c'},
   {id:'am',title:'오전 일정',start:'2026-10-06T10:00:00+09:00',end:'2026-10-06T11:00:00+09:00',calendarId:'c'},
   {id:'fri',title:'금요일 일정',start:'2026-10-09T15:00:00+09:00',end:'2026-10-09T16:00:00+09:00',calendarId:'c'},
  ]}});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/google-tasks',async r=>{
  const a=new URL(r.request().url()).searchParams.get('action');
  if(a!=='tasks')return r.fallback();
  if(!sources.tasks)return r.fulfill({status:500,json:{error:'QA failure'}});
  const asked=new URL(r.request().url()).searchParams.get('completed_days');taskCalls.push(asked);
  const base=[
   {id:'t-done',title:'보도자료 배포',status:'completed',completed:'2026-10-06T00:10:00Z',taskListId:'@default'},
   {id:'t-open',title:'남은 할 일',status:'needsAction',due:'2026-10-07',taskListId:'@default'},
   {id:'t-today',title:'오늘 마감 할 일',status:'needsAction',due:'2026-10-06T00:00:00.000Z',taskListId:'@default'},
  ];
  // doneServer 'old' = the Edge before JOURNAL-끝낸할일범위: ignores completed_days, answers the last 3 days, no echo.
  if(doneServer!=='new')return r.fulfill({json:{tasks:base,needs_reconnect:false}});
  // 'new' = the widened Edge: the last completed_days days from 2026-10-06 10:00 KST (01:00Z), capped at 8, echoed back.
  const days=Math.min(Number(asked)||3,8),since=Date.parse('2026-10-06T01:00:00Z')-days*86400000;
  const more=[
   {id:'t-prev',title:'지난주 수요일에 끝냄',status:'completed',completed:'2026-09-30T05:00:00Z',taskListId:'@default'},
   {id:'t-sunday',title:'지난 일요일에 끝냄',status:'completed',completed:'2026-10-04T05:00:00Z',taskListId:'@default'},
   {id:'t-too-old',title:'너무 오래전',status:'completed',completed:'2026-09-26T05:00:00Z',taskListId:'@default'},
  ];
  return r.fulfill({json:{tasks:[...base,...more].filter(t=>t.status!=='completed'||Date.parse(t.completed)>=since),needs_reconnect:false,completed_days:days}});
 });
 return {rows,writes,reads,errors,taskCalls,more,heal:key=>{sources[key]=true;delete fail[key];}};
}
async function openJournal(page,width){
 if(width<=760){
  await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.locator('#calendarView .schedule-switch [data-view="journal"]').click();
 }else await page.locator('.app-nav [data-view="journal"]').click();
 await expect(page.locator('#journalView')).toBeVisible();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 5일 ~ 11일');
}
const date=(page,day)=>page.locator(`#journalRoot [data-journal-date="${day}"]`);
const items=page=>page.locator('#journalRoot [data-journal-lines] > li');
// The saved lines' own text (on a PC each line also holds [수정][삭제]).
const lineTexts=page=>page.locator('#journalRoot [data-journal-lines] > li > [data-journal-edit]');
const work=(f,day)=>f.rows.find(r=>r.kind==='work'&&r.journal_day===day);
const group=(page,key)=>page.locator(`#journalRoot [data-journal-group="${key}"]`);

for(const width of [390,1280]){
 test(`[업무일지] 이번 주 날짜 줄·한 줄 쓴 날 초록 점·오늘 고름, 그날 재료(일정·끝낸 할 일·조직 소식·회의·행사 결과) ${width}`,async({page})=>{
  const f=await fixture(page,{width});await openJournal(page,width);
  const row=page.locator('#journalRoot [data-journal-date]');
  await expect(row).toHaveCount(7);
  await expect(row.locator('.journal-weekday')).toHaveText(['월','화','수','목','금','토','일']);
  await expect(row.locator('.journal-num')).toHaveText(['5','6','7','8','9','10','11']);
  // 7칸이 한 줄(폰에서도).
  const ys=await row.evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().y)));expect(new Set(ys).size).toBe(1);
  await expect(date(page,'2026-10-06')).toHaveAttribute('aria-current','date');
  await expect(date(page,'2026-10-06')).toHaveAttribute('aria-pressed','true');
  // J4 ①: 한 줄을 쓴 날만 점(재료가 있는 오늘·일기가 있는 오늘은 점 없음). 색은 업무일지 초록.
  await expect(date(page,'2026-10-05').locator('[data-journal-dot]')).toBeVisible();
  await expect(page.locator('#journalRoot [data-journal-dot]')).toHaveCount(1);
  await expect(date(page,'2026-10-05')).toHaveAttribute('aria-label','10월 5일 월요일, 한 줄 있음');
  const green=await page.evaluate(()=>{const e=document.createElement('span');e.style.backgroundColor='var(--ds-kind-journal-ink)';document.body.append(e);const c=getComputedStyle(e).backgroundColor;e.remove();return c;});
  expect(await date(page,'2026-10-05').locator('[data-journal-dot]').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(green);
  // 고른 날: 맨 위 "오늘 한 줄" 입력칸, 그 아래 재료.
  await expect(page.locator('#journalRoot [data-journal-day-title]')).toHaveText('10월 6일 화요일');
  const input=page.locator('#journalRoot [data-journal-input]');
  await expect(input).toHaveValue('');await expect(input).toBeEnabled();
  expect(await page.evaluate(()=>{const l=document.querySelector('[data-journal-line]').getBoundingClientRect(),m=document.querySelector('[data-journal-materials]').getBoundingClientRect();return l.bottom<=m.top;})).toBe(true);
  await expect(group(page,'events').locator('li')).toHaveText(['종일 여러 날 일정','10:00 오전 일정']);
  await expect(group(page,'tasks').locator('li')).toHaveText(['보도자료 배포']);
  // JOURNAL-일지카드정리: 아래 칸은 네 개, '고친 노트'는 없다. JOURNAL-주간보고허브: 그 뒤에 네 칸이 더 붙는다.
  await expect(page.locator('#journalRoot [data-journal-group] > h4')).toHaveText(['일정','끝낸 할 일','조직 소식','회의·행사 결과','프로젝트 소식','할 일 예정','자료실 새 자료','공유 페이지']);
  // 이 날은 빈 묶음이 없어 '기록 없는 묶음' 줄도 없다.
  await expect(page.locator('#journalRoot [data-journal-empty]')).toHaveCount(0);
  await expect(page.locator('#journalRoot')).not.toContainText('고친 노트');await expect(page.locator('#journalRoot')).not.toContainText('교섭 정리 노트');
  // 조직 소식: 그날 업데이트(조직으로 보낸 바구니 업데이트·조직 화면 기록·미분류)를 조직 이름별로, 미분류는 맨 아래.
  await expect(group(page,'orgs').locator('[data-journal-org] > .journal-org-name')).toHaveText(['가상 노동조합','나 지역 모임','미분류']);
  await expect(group(page,'orgs').locator('[data-journal-org="가상 노동조합"] li')).toHaveText(['안녕하세요 위원장님']);
  await expect(group(page,'orgs').locator('[data-journal-org="나 지역 모임"] li')).toHaveText(['조직 화면에서 쓴 업데이트']);
  await expect(group(page,'orgs').locator('[data-journal-org="미분류"] li')).toHaveText(['현장 간담회 메모']);
  // 업데이트 하나는 한 항목: 본문 둘째 줄·'출처:' 줄은 항목이 되지 않는다.
  await expect(group(page,'orgs').locator('li')).toHaveCount(3);
  // JOURNAL-주간보고허브: 프로젝트 기록은 조직 소식 '미분류'가 아니라 프로젝트 소식의 프로젝트 이름 아래.
  await expect(group(page,'projects').locator('[data-journal-org] > .journal-org-name')).toHaveText(['가상 사업']);
  await expect(group(page,'projects').locator('[data-journal-org="가상 사업"] li')).toHaveText(['진행상황 업데이트']);
  await expect(group(page,'orgs')).not.toContainText('진행상황 업데이트');
  // 할 일 예정(마감일 기준), 자료실 새 자료(그날 올린 것, 분류 표시), 공유 페이지(그날 고친 것).
  await expect(group(page,'due').locator('li')).toHaveText(['오늘 마감 할 일']);
  await expect(group(page,'docs').locator('li')).toHaveText(['[교섭] 가상 교섭 요구안']);
  await expect(group(page,'shares').locator('li')).toHaveText(['가상 안내 페이지 · 게시']);
  await expect(group(page,'orgs')).not.toContainText('출처: 가상 소식지');await expect(group(page,'orgs')).not.toContainText('둘째 줄');
  // 회의·행사 결과: 그날(meeting_at) 회의 행.
  await expect(group(page,'meetings').locator('li')).toHaveText(['14:00 가상 기자회견']);
  // 일기는 업무일지 재료가 아니다.
  await expect(page.locator('#journalRoot')).not.toContainText('JOURNAL_SECRET');
  // 다른 날을 누르면 그날 한 줄 목록·재료. 예전 하루 한 줄 기록은 그날 첫 줄로 입력칸 아래에 보이고, 입력칸은 비어 있다.
  await expect(items(page)).toHaveCount(0);
  await date(page,'2026-10-05').click();
  await expect(input).toHaveValue('');await expect(lineTexts(page)).toHaveText(['월요일 한 줄']);
  await expect(page.locator('#journalRoot [data-journal-save]')).toHaveText('저장');
  expect(await page.evaluate(()=>{const f=document.querySelector('[data-journal-line]').getBoundingClientRect(),l=document.querySelector('[data-journal-lines]').getBoundingClientRect(),m=document.querySelector('[data-journal-materials]').getBoundingClientRect();return f.bottom<=l.top&&l.bottom<=m.top;})).toBe(true);
  await expect(group(page,'events').locator('li')).toHaveText(['종일 여러 날 일정']);
  // JOURNAL-주간보고허브: 빈 묶음은 상자 없이 맨 아래 한 줄로 접힌다(화면 순서대로 이름).
  await expect(page.locator('#journalRoot [data-journal-group] > h4')).toHaveText(['일정']);
  await expect(group(page,'orgs')).toHaveCount(0);await expect(group(page,'meetings')).toHaveCount(0);
  await expect(page.locator('#journalRoot [data-journal-empty]')).toHaveText('기록 없는 묶음: 끝낸 할 일, 조직 소식, 회의·행사 결과, 프로젝트 소식, 할 일 예정, 자료실 새 자료, 공유 페이지');
  await expect(page.locator('#journalRoot')).not.toContainText('없어요.');
  // 목요일: 회의 결과(차수까지), 그날 올린 회의자료.
  await date(page,'2026-10-08').click();await expect(group(page,'meetings').locator('li')).toHaveText(['10:00 운영위원회 3차']);
  await expect(group(page,'docs').locator('li')).toHaveText(['[회의] 운영위 3차 자료 · 회의자료']);
  // 수요일 0시(한국 시간)의 조직 기록은 화요일이 아니라 수요일. 마감이 수요일인 할 일은 수요일 예정.
  await date(page,'2026-10-07').click();await expect(group(page,'orgs').locator('li')).toHaveText(['수요일 0시 기록']);
  await expect(group(page,'due').locator('li')).toHaveText(['남은 할 일']);
  // 다음 주 월요일 0시(한국 시간)에 올린 자료는 이번 주 일요일에 오지 않는다.
  await date(page,'2026-10-11').click();await expect(group(page,'docs')).toHaveCount(0);
  await expect(page.locator('#journalRoot [data-journal-empty]')).toContainText('자료실 새 자료');
  // app_notes 읽기는 모두 종류를 가린다(일지 한 줄은 kind=work, 업데이트는 basket). 노트(note)는 더 읽지 않는다.
  expect(f.reads.filter(q=>!q.table).every(q=>/^eq\.(work|basket)$/.test(q.kind||''))).toBe(true);
  // 조직·회의 읽기는 이 업무 공간·이번 주(한국 시간)로 가린다.
  expect(f.reads.find(q=>q.table==='app_suborganization_updates')).toMatchObject({organization_id:'in.(o1,o2)',occurred_at:'gte.2026-10-04T15:00:00.000Z&lt.2026-10-11T15:00:00.000Z'});
  expect(f.reads.find(q=>q.table==='app_meetings')).toMatchObject({workspace_id:'eq.w',meeting_at:'gte.2026-10-04T15:00:00.000Z&lt.2026-10-11T15:00:00.000Z'});
  // 자료실·공유 페이지 읽기도 이 업무 공간·이번 주로 가리고, 칸을 줄이고(본문·블록 없음) 개수를 제한한다.
  expect(f.reads.find(q=>q.table==='app_documents')).toMatchObject({workspace_id:'eq.w',created_at:'gte.2026-10-04T15:00:00.000Z&lt.2026-10-11T15:00:00.000Z',select:'id,title,file_name,category,meeting_id,created_at',limit:'300'});
  expect(f.reads.find(q=>q.table==='app_share_pages')).toMatchObject({workspace_id:'eq.w',updated_at:'gte.2026-10-04T15:00:00.000Z&lt.2026-10-11T15:00:00.000Z',select:'id,title,status,updated_at',limit:'300'});
  expect(f.reads.find(q=>q.table==='app_project_progress_updates')).toMatchObject({effective_on:'gte.2026-10-05&lte.2026-10-11'});
  expect(f.reads.find(q=>q.kind==='eq.work')).toMatchObject({journal_day:'gte.2026-10-05&lte.2026-10-11'});
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
  // 가로 넘침 없음.
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}

for(const width of [390,1280]){
 test(`오늘 한 줄 목록: 저장하면 입력칸이 비고 아래에 한 줄씩 쌓임(세 번 = 세 줄), 버튼은 늘 [저장] ${width}`,async({page})=>{
  const f=await fixture(page,{width});await openJournal(page,width);
  const input=page.locator('#journalRoot [data-journal-input]'),line=page.locator('#journalRoot [data-journal-line-status]'),save=page.locator('#journalRoot [data-journal-save]');
  await input.fill('  교섭 준비 회의 정리  ');
  await expect(page.locator('#journalRoot [data-journal-count]')).toHaveText('11/300자');
  await input.press('Enter');
  await expect(line).toHaveText('한 줄을 저장했어요.');
  await expect(input).toHaveValue('');await expect(page.locator('#journalRoot [data-journal-count]')).toHaveText('0/300자');
  await expect(lineTexts(page)).toHaveText(['교섭 준비 회의 정리']);
  await expect(save).toHaveText('저장');
  expect(f.writes[0]).toMatchObject({method:'POST',body:{workspace_id:'w',kind:'work',journal_day:'2026-10-06',raw_text:'교섭 준비 회의 정리'}});
  expect(Object.keys(f.writes[0].body).sort()).toEqual(['journal_day','kind','raw_text','workspace_id']);
  await expect(date(page,'2026-10-06').locator('[data-journal-dot]')).toBeVisible();
  await input.fill('현장 간담회 자료 공유');await save.click();
  await expect(input).toHaveValue('');
  await input.fill('보도자료 초안');await input.press('Enter');
  await expect(lineTexts(page)).toHaveText(['교섭 준비 회의 정리','현장 간담회 자료 공유','보도자료 초안']);
  await expect(save).toHaveText('저장');await expect(input).toHaveValue('');
  // 둘째·셋째 줄은 그날 행 하나를 고친다(본 판의 updated_at 조건, 종류·공간 조건 그대로).
  expect(f.writes.map(w=>w.method)).toEqual(['POST','PATCH','PATCH']);
  expect(f.writes[1].query).toMatchObject({kind:'eq.work',workspace_id:'eq.w',id:'eq.'+work(f,'2026-10-06').id});
  expect(f.writes[1].query.updated_at).toMatch(/^eq\./);
  expect(f.rows.filter(r=>r.kind==='work'&&r.journal_day==='2026-10-06')).toHaveLength(1);
  expect(work(f,'2026-10-06').raw_text).toBe('교섭 준비 회의 정리\n현장 간담회 자료 공유\n보도자료 초안');
  // 쓰던 글은 날짜를 오가도 남는다(저장 전), 목록은 그날 것만.
  await date(page,'2026-10-07').click();await expect(items(page)).toHaveCount(0);await input.fill('수요일 초안');
  await date(page,'2026-10-06').click();await expect(input).toHaveValue('');await expect(items(page)).toHaveCount(3);
  await date(page,'2026-10-07').click();await expect(input).toHaveValue('수요일 초안');
  expect(f.writes).toHaveLength(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });

 test(`줄을 누르면 그 자리에서 고치기 칸 [저장][취소][삭제]: 고치기·취소·Esc·삭제와 5초 되돌리기 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  f.rows.push({id:'k6',workspace_id:'w',kind:'work',title:null,journal_day:'2026-10-06',raw_text:'첫 줄\n둘째 줄\n셋째 줄',occurred_at:at,created_at:at,updated_at:'2026-10-06T00:50:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}});
  await openJournal(page,width);
  await expect(lineTexts(page)).toHaveText(['첫 줄','둘째 줄','셋째 줄']);
  // 줄 끝 ⋯ 메뉴·팝업 없이 줄 자체가 버튼(PC는 줄마다 [수정][삭제]가 더 있다 — 아래 PC 모양 시험).
  await expect(page.locator('#journalRoot [data-journal-lines] [data-journal-edit]')).toHaveCount(3);
  await expect(page.locator('#journalRoot [data-journal-lines] [aria-haspopup]')).toHaveCount(0);
  await expect(page.locator('#journalRoot [data-journal-lines] button:visible')).toHaveCount(width<1024?3:9);
  await page.locator('#journalRoot [data-journal-edit="1"]').click();
  const box=page.locator('#journalRoot [data-journal-edit-input]');
  await expect(box).toBeFocused();await expect(box).toHaveValue('둘째 줄');
  await expect(items(page).nth(1).getByRole('button')).toHaveText(['저장','취소','삭제']);
  await expect(page.locator('.modal:not(.hidden), [role="dialog"]:visible')).toHaveCount(0);
  // 다른 줄은 고치는 동안 눌리지 않는다.
  await expect(page.locator('#journalRoot [data-journal-edit="0"]')).toBeDisabled();
  // 취소: 그대로.
  await box.fill('바꾸다 만 글');await items(page).nth(1).getByRole('button',{name:'취소'}).click();
  await expect(lineTexts(page)).toHaveText(['첫 줄','둘째 줄','셋째 줄']);await expect(page.locator('#journalRoot [data-journal-edit="1"]')).toBeFocused();
  // Esc도 취소.
  await page.locator('#journalRoot [data-journal-edit="2"]').click();await box.fill('x');await box.press('Escape');
  await expect(lineTexts(page)).toHaveText(['첫 줄','둘째 줄','셋째 줄']);expect(f.writes).toEqual([]);
  // 고치기: 301자·줄바꿈은 그 칸에서 거절, 고친 줄은 같은 자리.
  await page.locator('#journalRoot [data-journal-edit="1"]').click();
  await box.fill('가'.repeat(301));await expect(items(page).nth(1).locator('[data-journal-edit-count]')).toHaveText('301/300자');
  await items(page).nth(1).getByRole('button',{name:'저장'}).click();
  await expect(items(page).nth(1).locator('[data-journal-edit-status]')).toHaveText('한 줄은 300자까지 쓸 수 있어요.');await expect(box).toHaveAttribute('aria-invalid','true');
  await box.fill('둘째 줄 고침');await box.press('Shift+Enter');
  await expect(items(page).nth(1).locator('[data-journal-edit-status]')).toHaveText('한 줄로 써 주세요. 줄바꿈은 넣을 수 없어요.');
  expect(f.writes).toEqual([]);
  await box.press('Enter');
  await expect(page.locator('#journalRoot [data-journal-line-status]')).toHaveText('줄을 고쳤어요.');
  await expect(lineTexts(page)).toHaveText(['첫 줄','둘째 줄 고침','셋째 줄']);
  expect(f.writes[0]).toMatchObject({method:'PATCH',query:{id:'eq.k6',kind:'eq.work',workspace_id:'eq.w',updated_at:'eq.2026-10-06T00:50:00Z'},body:{raw_text:'첫 줄\n둘째 줄 고침\n셋째 줄'}});
  // 삭제: 바로 지우고 5초 [되돌리기] 안내(앱 공용 되돌리기), 누르면 같은 자리로.
  await page.locator('#journalRoot [data-journal-edit="0"]').click();
  await items(page).nth(0).getByRole('button',{name:'삭제'}).click();
  await expect(lineTexts(page)).toHaveText(['둘째 줄 고침','셋째 줄']);
  const undo=page.locator('[data-undo-notice]');
  await expect(undo.locator('[data-undo-text]')).toHaveText('한 줄을 지웠어요.');
  await undo.getByRole('button',{name:'되돌리기'}).click();
  await expect(undo.locator('[data-undo-text]')).toHaveText('지운 줄을 되돌렸어요.');
  await expect(lineTexts(page)).toHaveText(['첫 줄','둘째 줄 고침','셋째 줄']);
  expect(work(f,'2026-10-06').raw_text).toBe('첫 줄\n둘째 줄 고침\n셋째 줄');
  // 마지막 줄까지 지우면 그날 행이 지워지고 초록 점도 사라진다.
  for(let i=0;i<3;i++){await page.locator('#journalRoot [data-journal-edit="0"]').click();await items(page).nth(0).getByRole('button',{name:'삭제'}).click();await expect(items(page)).toHaveCount(2-i);}
  await expect(page.locator('#journalRoot [data-journal-lines]')).toBeHidden();
  await expect(date(page,'2026-10-06').locator('[data-journal-dot]')).toHaveCount(0);
  expect(work(f,'2026-10-06')).toBeUndefined();
  expect(f.writes.at(-1)).toMatchObject({method:'DELETE',query:{id:'eq.k6',kind:'eq.work',workspace_id:'eq.w'}});
  expect(f.errors).toEqual([]);
 });
}

test('예전 하루 한 줄 기록은 그날 첫 줄: 아래에 새 줄을 더하면 저장 순서대로 이어짐',async({page})=>{
 const f=await fixture(page);await openJournal(page,390);
 await date(page,'2026-10-05').click();
 await expect(lineTexts(page)).toHaveText(['월요일 한 줄']);
 const input=page.locator('#journalRoot [data-journal-input]');
 await input.fill('월요일 둘째 줄');await input.press('Enter');
 await expect(lineTexts(page)).toHaveText(['월요일 한 줄','월요일 둘째 줄']);
 expect(f.writes).toEqual([expect.objectContaining({method:'PATCH',query:expect.objectContaining({id:'eq.k5'}),body:expect.objectContaining({raw_text:'월요일 한 줄\n월요일 둘째 줄'})})]);
 expect(f.errors).toEqual([]);
});

test('서버 준비(DB 적용) 전: 첫 줄은 저장, 둘째 줄은 안내와 함께 입력칸에 그대로 남음',async({page})=>{
 const f=await fixture(page,{oneLine:true});await openJournal(page,390);
 const input=page.locator('#journalRoot [data-journal-input]'),line=page.locator('#journalRoot [data-journal-line-status]');
 await input.fill('첫 줄');await input.press('Enter');
 await expect(line).toHaveText('한 줄을 저장했어요.');await expect(lineTexts(page)).toHaveText(['첫 줄']);
 await input.fill('둘째 줄');await input.press('Enter');
 await expect(line).toHaveText('두 번째 줄부터는 서버 준비가 끝난 뒤 저장할 수 있어요. 지금은 하루 한 줄만 저장돼요.');
 await expect(input).toHaveValue('둘째 줄');await expect(lineTexts(page)).toHaveText(['첫 줄']);
 expect(work(f,'2026-10-06').raw_text).toBe('첫 줄');
 // 한 줄짜리 날의 그 줄 고치기는 그대로 된다.
 await page.locator('#journalRoot [data-journal-edit="0"]').click();
 await page.locator('#journalRoot [data-journal-edit-input]').fill('첫 줄 고침');await page.locator('#journalRoot [data-journal-edit-input]').press('Enter');
 await expect(lineTexts(page)).toHaveText(['첫 줄 고침']);
 expect(f.errors).toEqual([]);
});

test('다른 기기가 먼저 쓴 날(409)은 그 행을 읽어 그 줄들 뒤에 더한다',async({page})=>{
 const f=await fixture(page);await openJournal(page,390);
 // 화면이 읽은 뒤 다른 기기가 같은 날 한 줄을 씀.
 f.rows.push({id:'k-other',workspace_id:'w',kind:'work',title:null,journal_day:'2026-10-06',raw_text:'다른 기기 한 줄',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}});
 await page.locator('#journalRoot [data-journal-input]').fill('이 기기 한 줄');
 await page.locator('#journalRoot [data-journal-save]').click();
 await expect(page.locator('#journalRoot [data-journal-line-status]')).toHaveText('한 줄을 저장했어요.');
 expect(f.writes.map(w=>w.method)).toEqual(['POST','PATCH']);
 expect(f.writes[1].query.id).toBe('eq.k-other');
 expect(f.rows.filter(r=>r.kind==='work'&&r.journal_day==='2026-10-06').map(r=>r.raw_text)).toEqual(['다른 기기 한 줄\n이 기기 한 줄']);
 await expect(lineTexts(page)).toHaveText(['다른 기기 한 줄','이 기기 한 줄']);
 // 화면이 본 뒤 다른 기기가 줄을 더해도(updated_at이 달라져 조건부 PATCH가 빈 결과) 다시 읽어 그 뒤에 더한다.
 const row=work(f,'2026-10-06');row.raw_text+='\n또 다른 기기';row.updated_at='2026-10-06T02:00:00Z';
 await page.locator('#journalRoot [data-journal-input]').fill('셋째');await page.locator('#journalRoot [data-journal-input]').press('Enter');
 await expect(lineTexts(page)).toHaveText(['다른 기기 한 줄','이 기기 한 줄','또 다른 기기','셋째']);
 expect(row.raw_text).toBe('다른 기기 한 줄\n이 기기 한 줄\n또 다른 기기\n셋째');
 expect(f.errors).toEqual([]);
});

test('줄마다 300자: 301자·줄바꿈·빈 줄은 저장하지 않고 이유를 보여 준다',async({page})=>{
 const f=await fixture(page);await openJournal(page,390);
 const input=page.locator('#journalRoot [data-journal-input]'),line=page.locator('#journalRoot [data-journal-line-status]'),save=page.locator('#journalRoot [data-journal-save]');
 await input.fill('가'.repeat(301));
 await expect(page.locator('#journalRoot [data-journal-count]')).toHaveText('301/300자');
 await expect(page.locator('#journalRoot [data-journal-count]')).toHaveClass(/over/);
 await save.click();
 await expect(line).toHaveText('한 줄은 300자까지 쓸 수 있어요.');await expect(input).toHaveAttribute('aria-invalid','true');
 await input.fill('첫 줄\n둘째 줄');
 await save.click();await expect(line).toHaveText('한 줄로 써 주세요. 줄바꿈은 넣을 수 없어요.');
 await input.fill('줄 하나');await input.press('Shift+Enter');
 await expect(line).toHaveText('한 줄로 써 주세요. 줄바꿈은 넣을 수 없어요.');await expect(input).toHaveValue('줄 하나');
 await input.fill('   ');await save.click();await expect(line).toHaveText('한 줄을 입력해 주세요.');
 expect(f.writes).toEqual([]);
 // 딱 300자는 저장된다.
 await input.fill('나'.repeat(300));await save.click();await expect(line).toHaveText('한 줄을 저장했어요.');
 expect(f.writes).toHaveLength(1);expect([...f.writes[0].body.raw_text].length).toBe(300);
 // 300자 제한은 줄마다: 둘째 줄도 300자까지.
 await input.fill('다'.repeat(300));await save.click();await expect(line).toHaveText('한 줄을 저장했어요.');
 expect(work(f,'2026-10-06').raw_text.split('\n').map(l=>[...l].length)).toEqual([300,300]);
 await input.fill('라'.repeat(301));await save.click();await expect(line).toHaveText('한 줄은 300자까지 쓸 수 있어요.');
 await expect(input).toHaveValue('라'.repeat(301));expect(f.writes).toHaveLength(2);
 expect(f.errors).toEqual([]);
});

test('주 단위 넘기기: › 다음 주, ‹‹ 지난주(그 주 한 줄 점), [이번 주]로 돌아오기',async({page})=>{
 const f=await fixture(page,{width:1280});await openJournal(page,1280);
 await page.locator('#journalRoot [data-journal-next]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 12일 ~ 18일');
 // 같은 요일(화)이 골라진다.
 await expect(date(page,'2026-10-13')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#journalRoot [data-journal-dot]')).toHaveCount(0);
 await expect(page.locator('#journalRoot [aria-current="date"]')).toHaveCount(0);
 expect(f.reads.some(q=>q.kind==='eq.work'&&q.journal_day==='gte.2026-10-12&lte.2026-10-18')).toBe(true);
 await page.locator('#journalRoot [data-journal-prev]').click();await page.locator('#journalRoot [data-journal-prev]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('9월 28일 ~ 10월 4일');
 await expect(date(page,'2026-09-30').locator('[data-journal-dot]')).toBeVisible();
 await date(page,'2026-09-29').click();
 await expect(group(page,'orgs').locator('[data-journal-org="미분류"] li')).toHaveText(['지난주 메모']);
 // 지난주 일정은 그 주 범위로 다시 읽는다.
 await date(page,'2026-09-30').click();await expect(lineTexts(page)).toHaveText(['지난주 수요일']);await expect(page.locator('#journalRoot [data-journal-input]')).toHaveValue('');
 await page.locator('#journalRoot [data-journal-today]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 5일 ~ 11일');
 await expect(date(page,'2026-10-06')).toHaveAttribute('aria-pressed','true');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('재료 일부를 못 읽어도 한 줄은 쓰고, 못 읽은 묶음만 안내·[다시 시도]',async({page})=>{
 const f=await fixture(page,{fail:{events:true,tasks:true}});await openJournal(page,390);
 await expect(group(page,'events').locator('[data-journal-failed]')).toHaveText('일정을(를) 불러오지 못했어요. 한 줄은 그대로 쓸 수 있어요.');
 await expect(group(page,'tasks').locator('[data-journal-failed]')).toBeVisible();
 // 할 일 예정은 같은 Google 할 일 읽기라 함께 실패를 알린다(빈 묶음으로 접히지 않는다).
 await expect(group(page,'due').locator('[data-journal-failed]')).toHaveText('할 일 예정을(를) 불러오지 못했어요. 한 줄은 그대로 쓸 수 있어요.');
 await expect(group(page,'orgs').locator('li')).toHaveCount(3);
 await expect(group(page,'meetings').locator('li')).toHaveText(['14:00 가상 기자회견']);
 const input=page.locator('#journalRoot [data-journal-input]');
 await expect(input).toBeEnabled();
 await input.fill('일정 없이도 한 줄');await input.press('Enter');
 await expect(page.locator('#journalRoot [data-journal-line-status]')).toHaveText('한 줄을 저장했어요.');
 expect(f.writes).toHaveLength(1);
 f.heal('events');
 await group(page,'events').locator('[data-journal-retry]').click();
 await expect(group(page,'events').locator('li')).toHaveText(['종일 여러 날 일정','10:00 오전 일정']);
 await expect(group(page,'tasks').locator('[data-journal-failed]')).toBeVisible();
 expect(f.errors).toEqual([]);
});

test('한 줄 목록을 못 읽어도 입력칸은 쓸 수 있다',async({page})=>{
 const f=await fixture(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes'&&u.searchParams.get('kind')==='eq.work'&&!u.searchParams.has('id'),async r=>{
  if(r.request().method()==='GET'&&!r.request().url().includes('journal_day=eq.'))return r.fulfill({status:500,json:{message:'QA failure'}});
  return r.fallback();
 });
 await openJournal(page,390);
 await expect(page.locator('#journalRoot [data-journal-line-status]')).toContainText('저장된 한 줄을 불러오지 못했어요');
 const input=page.locator('#journalRoot [data-journal-input]');await expect(input).toBeEnabled();
 await input.fill('그래도 남기는 한 줄');await input.press('Enter');
 await expect(page.locator('#journalRoot [data-journal-line-status]')).toHaveText('한 줄을 저장했어요.');
 expect(f.writes.filter(w=>w.method==='POST')).toHaveLength(1);
 expect(f.errors).toEqual([]);
});

test('[주간보고 초안 복사]: 날짜마다 그날 줄들을 저장 순서대로 한 줄씩 + 날짜별 재료 목록을 복사',async({page})=>{
 const f=await fixture(page,{width:1280});
 f.rows.push({id:'k8',workspace_id:'w',kind:'work',title:null,journal_day:'2026-10-08',raw_text:'목요일 첫 줄\n목요일 둘째 줄',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}});
 await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:testOrigin});
 await openJournal(page,1280);
 await expect(group(page,'events').locator('li')).toHaveCount(2);
 await expect(group(page,'tasks').locator('li')).toHaveCount(1);
 await expect(group(page,'orgs').locator('li')).toHaveCount(3);await expect(group(page,'meetings').locator('li')).toHaveCount(1);
 await expect(group(page,'docs').locator('li')).toHaveCount(1);await expect(group(page,'shares').locator('li')).toHaveCount(1);await expect(group(page,'projects').locator('li')).toHaveCount(1);
 // 오늘 줄 두 개를 더한다(저장 순서대로 복사된다).
 const input=page.locator('#journalRoot [data-journal-input]');
 await input.fill('화요일 첫 줄');await input.press('Enter');await expect(items(page)).toHaveCount(1);
 await input.fill('화요일 둘째 줄');await input.press('Enter');await expect(items(page)).toHaveCount(2);
 await page.locator('#journalRoot [data-journal-copy]').click();
 await expect(page.locator('#journalRoot [data-journal-status]')).toHaveText('이번 주 한 줄과 재료 목록을 복사했어요.');
 const text=await page.evaluate(()=>navigator.clipboard.readText());
 const lines=text.split('\n');
 expect(lines[0]).toBe('주간 업무일지 10월 5일(월) ~ 10월 11일(일)');
 expect(lines.filter(l=>l.startsWith('■ '))).toHaveLength(7);
 expect(lines.filter(l=>l.startsWith('한 줄: '))).toHaveLength(9);
 expect(lines.filter(l=>l==='한 줄: (없음)')).toHaveLength(4);
 expect(lines).toContain('한 줄: 월요일 한 줄');
 const tue=lines.indexOf('■ 10월 6일(화)'),thu=lines.indexOf('■ 10월 8일(목)');
 expect(lines.slice(tue+1,tue+3)).toEqual(['한 줄: 화요일 첫 줄','한 줄: 화요일 둘째 줄']);
 expect(lines.slice(thu+1,thu+3)).toEqual(['한 줄: 목요일 첫 줄','한 줄: 목요일 둘째 줄']);
 expect(lines).toContain('- 일정: 10:00 오전 일정');
 expect(lines).toContain('- 일정: 15:00 금요일 일정');
 expect(lines).toContain('- 끝낸 할 일: 보도자료 배포');
 // 새 칸 구성: 조직 소식은 조직 이름과 함께, 업데이트 하나는 한 줄.
 expect(lines).toContain('- 조직 소식 · 가상 노동조합: 안녕하세요 위원장님');
 expect(lines).toContain('- 조직 소식 · 나 지역 모임: 조직 화면에서 쓴 업데이트');
 expect(lines).toContain('- 조직 소식 · 미분류: 현장 간담회 메모');
 // JOURNAL-주간보고허브: 프로젝트 기록은 프로젝트 소식으로(조직 소식 미분류에 다시 나오지 않는다).
 expect(lines).toContain('- 프로젝트 소식 · 가상 사업: 진행상황 업데이트');
 expect(text).not.toContain('미분류: 가상 사업');
 expect(lines).toContain('- 조직 소식 · 나 지역 모임: 수요일 0시 기록');
 expect(lines).toContain('- 회의·행사 결과: 14:00 가상 기자회견');
 expect(lines).toContain('- 회의·행사 결과: 10:00 운영위원회 3차');
 expect(lines).toContain('- 할 일 예정: 남은 할 일');
 expect(lines).toContain('- 자료실 새 자료: [회의] 운영위 3차 자료 · 회의자료');
 expect(text).not.toContain('지난주 페이지');expect(text).not.toContain('다음 주 자료');
 expect(text).not.toContain('출처: 가상 소식지');expect(text).not.toContain('바구니 업데이트');expect(text).not.toContain('고친 노트');
 expect(lines.slice(tue+3,lines.indexOf('■ 10월 7일(수)'))).toEqual(['- 일정: 종일 여러 날 일정','- 일정: 10:00 오전 일정','- 끝낸 할 일: 보도자료 배포',
  '- 조직 소식 · 가상 노동조합: 안녕하세요 위원장님','- 조직 소식 · 나 지역 모임: 조직 화면에서 쓴 업데이트','- 조직 소식 · 미분류: 현장 간담회 메모','- 회의·행사 결과: 14:00 가상 기자회견',
  '- 프로젝트 소식 · 가상 사업: 진행상황 업데이트','- 할 일 예정: 오늘 마감 할 일','- 자료실 새 자료: [교섭] 가상 교섭 요구안','- 공유 페이지: 가상 안내 페이지 · 게시','']);
 expect(text).not.toContain('JOURNAL_SECRET');
 expect(f.writes.map(w=>w.method)).toEqual(['POST','PATCH']);expect(f.errors).toEqual([]);
});

// ORG-담당13기준: 조직 소식과 주간보고 초안은 내 담당 조직(담당 사업장 ∩ 활성)만 조직 이름별로 두고, 나머지 조직의 기록은
// 사라지지 않게 '그 외' 한 묶음(조직 이름 · 내용)으로 미분류 앞에 남긴다.
test('[업무일지] 내 담당 조직만 이름별, 담당 밖·쉬는 조직 기록은 그 외 한 묶음 — 화면과 주간보고 초안이 같다',async({page})=>{
 const f=await fixture(page,{width:390,outside:true});
 await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:testOrigin});
 await openJournal(page,390);
 await expect(group(page,'orgs').locator('[data-journal-org] > .journal-org-name')).toHaveText(['가상 노동조합','나 지역 모임','그 외','미분류']);
 await expect(group(page,'orgs').locator('[data-journal-org="그 외"] li')).toHaveText(['다 바깥 모임 · 바깥 모임 기록','라 쉬는 모임 · 쉬는 모임 기록']);
 await expect(group(page,'orgs').locator('[data-journal-org="나 지역 모임"] li')).toHaveText(['조직 화면에서 쓴 업데이트']);
 await expect(group(page,'orgs').locator('[data-journal-org="다 바깥 모임"]')).toHaveCount(0);
 await expect(group(page,'orgs').locator('[data-journal-org="라 쉬는 모임"]')).toHaveCount(0);
 // 읽기: 조직은 이 업무 공간, 담당 줄은 로그인한 나만. 기록은 담당 밖 조직 것까지 모두 읽는다(사라지지 않게).
 expect(f.reads.find(q=>q.table==='app_suborganization_assignees')).toMatchObject({user_id:'eq.home-test',select:'organization_id'});
 expect(f.reads.find(q=>q.table==='app_suborganizations')).toMatchObject({workspace_id:'eq.w',select:'id,name,active'});
 expect(f.reads.find(q=>q.table==='app_suborganization_updates')).toMatchObject({organization_id:'in.(o1,o2,o3,o4)'});
 await page.locator('#journalRoot [data-journal-copy]').click();
 await expect(page.locator('#journalRoot [data-journal-status]')).toHaveText('이번 주 한 줄과 재료 목록을 복사했어요.');
 const lines=(await page.evaluate(()=>navigator.clipboard.readText())).split('\n');
 const tue=lines.indexOf('■ 10월 6일(화)'),orgLines=lines.slice(tue,lines.indexOf('■ 10월 7일(수)')).filter(l=>l.startsWith('- 조직 소식'));
 expect(orgLines).toEqual(['- 조직 소식 · 가상 노동조합: 안녕하세요 위원장님','- 조직 소식 · 나 지역 모임: 조직 화면에서 쓴 업데이트',
  '- 조직 소식 · 그 외: 다 바깥 모임 · 바깥 모임 기록','- 조직 소식 · 그 외: 라 쉬는 모임 · 쉬는 모임 기록','- 조직 소식 · 미분류: 현장 간담회 메모']);
 expect(f.errors).toEqual([]);
});

// UI-PC업무일지폭: PC(≥1024)는 [일기]처럼 본문 폭을 다 쓴다(같은 바깥 폭 규칙 .view-wide). 폰은 그대로(가운데 760px 상한·1열).
// JOURNAL-일지카드정리(시안 확정): PC 하루 카드 아래 칸은 넓은 창에서도 2칸씩 줄. JOURNAL-주간보고허브: 8칸이면 2칸씩 네 줄.
const journalBox=page=>page.evaluate(()=>{
 const r=e=>e.getBoundingClientRect(),view=document.querySelector('#journalView'),cs=getComputedStyle(view),main=getComputedStyle(document.querySelector('main'));
 const groups=[...document.querySelectorAll('#journalRoot [data-journal-group]')].map(r);
 return {root:r(document.querySelector('#journalRoot')).width,panel:view.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),
  right:r(document.querySelector('#journalRoot')).right,copy:r(document.querySelector('#journalRoot [data-journal-copy]')).right,days:r(document.querySelector('#journalRoot [data-journal-days]')).width,
  rows:new Set(groups.map(g=>Math.round(g.y))).size,cols:new Set(groups.map(g=>Math.round(g.x))).size,
  main:{max:main.maxWidth,pl:main.paddingLeft,pr:main.paddingRight},doc:document.documentElement.scrollWidth,vw:innerWidth};
});
for(const width of [1024,1279,1280,1920]){
 test(`PC 업무일지 폭: 일기와 같은 바깥 폭, 날짜 줄·카드·[주간보고 초안 복사]가 끝까지, 하루 카드 2칸씩 줄 ${width}`,async({page})=>{
  const f=await fixture(page,{width});await openJournal(page,width);
  await expect(group(page,'meetings').locator('li')).toHaveCount(1);
  const j=await journalBox(page);
  expect(j.doc).toBeLessThanOrEqual(j.vw);
  expect(Math.abs(j.root-j.panel)).toBeLessThan(2);expect(Math.abs(j.days-j.root)).toBeLessThan(2);expect(Math.abs(j.copy-j.right)).toBeLessThan(2);
  expect(j.root).toBeGreaterThan(760);
  await expect(group(page,'shares').locator('li')).toHaveCount(1);
  const j8=await journalBox(page);
  expect(j8.cols).toBe(2);expect(j8.rows).toBe(4);
  // 순서: 일정·끝낸 할 일 / 조직 소식·회의·행사 결과 / 프로젝트 소식·할 일 예정 / 자료실 새 자료·공유 페이지.
  const pos=await page.locator('#journalRoot [data-journal-group]').evaluateAll(els=>els.map(e=>{const b=e.getBoundingClientRect();return [Math.round(b.x),Math.round(b.y)];}));
  expect(pos).toHaveLength(8);
  for(let i=0;i<8;i+=2){expect(pos[i][1]).toBe(pos[i+1][1]);expect(pos[i+1][0]).toBeGreaterThan(pos[i][0]);expect(pos[i][0]).toBe(pos[0][0]);if(i)expect(pos[i][1]).toBeGreaterThan(pos[i-2][1]);}
  // 빈 묶음이 접힌 날(월): 남은 칸은 그대로 2칸 줄, '기록 없는 묶음' 줄은 두 칸 폭 전체를 쓴다.
  await date(page,'2026-10-05').click();await expect(page.locator('#journalRoot [data-journal-empty]')).toBeVisible();
  const fold=await page.evaluate(()=>{const m=document.querySelector('#journalRoot [data-journal-materials]').getBoundingClientRect(),e=document.querySelector('#journalRoot [data-journal-empty]').getBoundingClientRect(),g=document.querySelector('#journalRoot [data-journal-group]').getBoundingClientRect();return {m:m.width,e:e.width,g:g.width,below:e.top>=g.bottom};});
  expect(Math.abs(fold.e-fold.m)).toBeLessThan(2);expect(fold.g).toBeLessThan(fold.m*0.6);expect(fold.below).toBe(true);
  await date(page,'2026-10-06').click();await expect(group(page,'shares').locator('li')).toHaveCount(1);
  // 같은 창에서 [일기]로 옮겨도 바깥 폭(본문 칸 상한·좌우 여백)과 화면 칸 폭이 같다.
  await page.locator('.app-nav [data-view="diary"]').click();await expect(page.locator('#diaryView')).toBeVisible();
  const d=await page.evaluate(()=>{const view=document.querySelector('#diaryView'),cs=getComputedStyle(view),main=getComputedStyle(document.querySelector('main'));
   return {root:document.querySelector('#diaryRoot').getBoundingClientRect().width,panel:view.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),main:{max:main.maxWidth,pl:main.paddingLeft,pr:main.paddingRight}};});
  expect(d.main).toEqual(j.main);expect(Math.abs(d.panel-j.panel)).toBeLessThan(1);expect(Math.abs(d.root-j.root)).toBeLessThan(2);
  expect(j.main.max).toBe('1920px');
  expect(f.errors).toEqual([]);
 });
}
// 제목 5개·내용·한 줄 목록의 모양(PC·폰 비교용).
const journalLook=page=>page.evaluate(()=>{
 const cs=sel=>getComputedStyle(document.querySelector(sel));
 const heads=[document.querySelector('#journalRoot [data-journal-line] label'),...document.querySelectorAll('#journalRoot [data-journal-group] > h4')].map(e=>{const c=getComputedStyle(e);return {text:e.textContent,size:c.fontSize,weight:Number(c.fontWeight)};});
 const line=cs('#journalRoot [data-journal-lines] .journal-line-text'),item=cs('#journalRoot [data-journal-group] li');
 const soft=(()=>{const e=document.createElement('span');e.style.backgroundColor='var(--ds-kind-journal-soft)';document.body.append(e);const c=getComputedStyle(e).backgroundColor;e.remove();return c;})();
 return {heads,line:{size:line.fontSize,bg:line.backgroundColor,left:line.borderLeftWidth,leftStyle:line.borderLeftStyle},item:item.fontSize,soft,
  actions:cs('#journalRoot [data-journal-lines] .journal-line-actions').display};
});
test('PC 하루 카드 모양: 제목(오늘 한 줄 + 칸 8개) 같은 크기 굵게(15px), 내용 14px, 한 줄은 상자 없는 점 목록 1280',async({page})=>{
 const f=await fixture(page,{width:1280});
 f.rows.push({id:'k6',workspace_id:'w',kind:'work',title:null,journal_day:'2026-10-06',raw_text:'첫 줄\n둘째 줄',occurred_at:at,created_at:at,updated_at:'2026-10-06T00:50:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}});
 await openJournal(page,1280);
 await expect(items(page)).toHaveCount(2);await expect(group(page,'meetings').locator('li')).toHaveCount(1);
 const look=await journalLook(page);
 expect(look.heads.map(h=>h.text)).toEqual(['오늘 한 줄','일정','끝낸 할 일','조직 소식','회의·행사 결과','프로젝트 소식','할 일 예정','자료실 새 자료','공유 페이지']);
 expect(new Set(look.heads.map(h=>h.size))).toEqual(new Set(['15px']));
 expect(look.heads.every(h=>h.weight>=600)).toBe(true);
 expect(look.line.size).toBe('14px');expect(look.item).toBe('14px');
 await page.locator('#journalRoot [data-journal-date="2026-10-07"]').click();await expect(page.locator('#journalRoot [data-journal-empty]')).toContainText('회의·행사 결과');
 expect(await page.locator('#journalRoot .journal-muted').first().evaluate(e=>getComputedStyle(e).fontSize)).toBe('14px');
 expect(await page.locator('#journalRoot [data-journal-empty]').evaluate(e=>getComputedStyle(e).fontSize)).toBe('14px');
 await page.locator('#journalRoot [data-journal-date="2026-10-06"]').click();await expect(items(page)).toHaveCount(2);
 // 초록 바탕·왼쪽 막대 없음, 줄 앞에 점.
 expect(look.line.bg).toBe('rgba(0, 0, 0, 0)');expect(look.line.bg).not.toBe(look.soft);expect(look.line.leftStyle==='none'||look.line.left==='0px').toBe(true);
 expect(await items(page).first().evaluate(e=>getComputedStyle(e,'::before').content)).toBe('"•"');
 expect(f.errors).toEqual([]);
});
test('PC 한 줄 [수정][삭제]: 마우스를 올리거나 키보드 초점일 때만 보이고, 누르면 고치기·삭제(5초 되돌리기) 1280',async({page})=>{
 const f=await fixture(page,{width:1280});
 f.rows.push({id:'k6',workspace_id:'w',kind:'work',title:null,journal_day:'2026-10-06',raw_text:'첫 줄\n둘째 줄',occurred_at:at,created_at:at,updated_at:'2026-10-06T00:50:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}});
 await openJournal(page,1280);
 await expect(lineTexts(page)).toHaveText(['첫 줄','둘째 줄']);
 const acts=i=>items(page).nth(i).locator('.journal-line-actions'),opacity=i=>acts(i).evaluate(e=>getComputedStyle(e).opacity);
 await page.mouse.move(5,5);
 expect(await opacity(0)).toBe('0');expect(await opacity(1)).toBe('0');
 await items(page).nth(1).hover();
 await expect.poll(()=>opacity(1)).toBe('1');expect(await opacity(0)).toBe('0');
 await page.mouse.move(5,5);await expect.poll(()=>opacity(1)).toBe('0');
 // 키보드: 줄 → [수정] → [삭제] 차례로 초점, 초점이 줄 안에 있으면 보인다.
 await page.locator('#journalRoot [data-journal-edit="0"]').focus();
 await expect.poll(()=>opacity(0)).toBe('1');
 await page.keyboard.press('Tab');await expect(items(page).nth(0).getByRole('button',{name:'1번째 줄 수정'})).toBeFocused();
 await page.keyboard.press('Tab');await expect(items(page).nth(0).getByRole('button',{name:'1번째 줄 삭제'})).toBeFocused();
 expect(await opacity(0)).toBe('1');
 // [수정] = 줄을 누른 것과 같은 고치기 칸.
 await page.keyboard.press('Shift+Tab');await page.keyboard.press('Enter');
 const box=page.locator('#journalRoot [data-journal-edit-input]');
 await expect(box).toBeFocused();await expect(box).toHaveValue('첫 줄');
 await box.press('Escape');await expect(page.locator('#journalRoot [data-journal-edit-input]')).toHaveCount(0);
 // [삭제] = 바로 지우고 공용 5초 [되돌리기].
 await items(page).nth(1).hover();await items(page).nth(1).getByRole('button',{name:'2번째 줄 삭제'}).click();
 await expect(items(page)).toHaveCount(1);
 expect(work(f,'2026-10-06').raw_text).toBe('첫 줄');
 const undo=page.locator('[data-undo-notice]');
 await expect(undo.locator('[data-undo-text]')).toHaveText('한 줄을 지웠어요.');
 await undo.getByRole('button',{name:'되돌리기'}).click();
 await expect(undo.locator('[data-undo-text]')).toHaveText('지운 줄을 되돌렸어요.');
 await expect(items(page)).toHaveCount(2);expect(work(f,'2026-10-06').raw_text).toBe('첫 줄\n둘째 줄');
 expect(f.writes.map(w=>w.method)).toEqual(['PATCH','PATCH']);
 expect(f.errors).toEqual([]);
});
test('폰 업무일지: 폭·1열 그대로, 모양은 PC와 같게(제목 15px 굵게, 내용 14px, 한 줄은 점 목록), [수정][삭제] 없음 390',async({page})=>{
 const f=await fixture(page,{width:390});
 f.rows.push({id:'k6',workspace_id:'w',kind:'work',title:null,journal_day:'2026-10-06',raw_text:'첫 줄',occurred_at:at,created_at:at,updated_at:'2026-10-06T00:50:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}});
 await openJournal(page,390);
 await expect(group(page,'meetings').locator('li')).toHaveCount(1);await expect(items(page)).toHaveCount(1);
 const j=await journalBox(page);
 await expect(group(page,'shares').locator('li')).toHaveCount(1);
 const j8=await journalBox(page);
 expect(j8.doc).toBeLessThanOrEqual(j8.vw);expect(j8.cols).toBe(1);expect(j8.rows).toBe(8);expect(Math.abs(j8.root-j8.panel)).toBeLessThan(2);
 const look=await journalLook(page);
 // UI-일지폰정리: 폰도 PC와 같은 모양 — 제목 9개 같은 크기(15px) 굵게, 한 줄·내용 14px, 초록 바탕·왼쪽 막대 없는 점 목록.
 expect(new Set(look.heads.map(h=>h.size))).toEqual(new Set(['15px']));
 expect(look.heads.every(h=>h.weight>=600)).toBe(true);
 expect(look.line.size).toBe('14px');expect(look.item).toBe('14px');
 expect(look.line.bg).toBe('rgba(0, 0, 0, 0)');expect(look.line.bg).not.toBe(look.soft);expect(look.line.leftStyle==='none'||look.line.left==='0px').toBe(true);
 expect(await items(page).first().evaluate(e=>getComputedStyle(e,'::before').content)).toBe('"•"');
 expect(look.actions).toBe('none');
 await expect(page.locator('#journalRoot [data-journal-lines] button:visible')).toHaveCount(1);
 expect(f.errors).toEqual([]);
});
test('조직 소식 일부 읽기 실패: 읽은 업데이트는 보이고, 못 읽은 것만 안내·[다시 시도]하면 채워진다',async({page})=>{
 const f=await fixture(page,{width:390,fail:{orgUpdates:true}});await openJournal(page,390);
 await expect(group(page,'orgs').locator('[data-journal-failed]')).toHaveText('조직 소식 일부를 불러오지 못했어요. 한 줄은 그대로 쓸 수 있어요.');
 await expect(group(page,'orgs').locator('li')).toHaveText(['안녕하세요 위원장님','현장 간담회 메모']);
 // 조직 기록 실패는 프로젝트 소식에 번지지 않는다.
 await expect(group(page,'projects').locator('li')).toHaveText(['진행상황 업데이트']);await expect(group(page,'projects').locator('[data-journal-failed]')).toHaveCount(0);
 f.heal('orgUpdates');
 await group(page,'orgs').locator('[data-journal-retry]').click();
 await expect(group(page,'orgs').locator('li')).toHaveCount(3);
 await expect(group(page,'orgs').locator('[data-journal-failed]')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});

test('JOURNAL-주간보고허브: 자료실·공유 페이지·프로젝트 기록은 묶음마다 따로 실패·[다시 시도], 실패한 빈 묶음은 접히지 않는다',async({page})=>{
 const f=await fixture(page,{width:1280,fail:{documents:true,sharePages:true,progress:true}});await openJournal(page,1280);
 for(const [key,label] of [['docs','자료실 새 자료'],['shares','공유 페이지'],['projects','프로젝트 소식']])
  await expect(group(page,key).locator('[data-journal-failed]')).toHaveText(`${label}을(를) 불러오지 못했어요. 한 줄은 그대로 쓸 수 있어요.`);
 // 다른 묶음은 그대로.
 await expect(group(page,'orgs').locator('li')).toHaveCount(3);await expect(group(page,'due').locator('li')).toHaveText(['오늘 마감 할 일']);
 // 빈 날(월)에도 실패한 묶음은 상자로 남고, '기록 없는 묶음' 줄에 들어가지 않는다.
 await date(page,'2026-10-05').click();
 await expect(group(page,'docs').locator('[data-journal-retry]')).toBeVisible();
 await expect(page.locator('#journalRoot [data-journal-empty]')).not.toContainText('자료실 새 자료');
 await expect(page.locator('#journalRoot [data-journal-empty]')).not.toContainText('공유 페이지');
 await date(page,'2026-10-06').click();
 f.heal('documents');
 await group(page,'docs').locator('[data-journal-retry]').click();
 await expect(group(page,'docs').locator('li')).toHaveText(['[교섭] 가상 교섭 요구안']);
 await expect(group(page,'shares').locator('[data-journal-failed]')).toBeVisible();
 f.heal('progress');
 await group(page,'projects').locator('[data-journal-retry]').click();
 await expect(group(page,'projects').locator('li')).toHaveText(['진행상황 업데이트']);
 await expect(group(page,'shares').locator('[data-journal-failed]')).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('[업무일지] 끝낸 할 일 범위: 넓어진 서버면 지난주 날짜(8일 안)에도 끝낸 할 일이 보이고 안내 문구가 없다',async({page})=>{
 const f=await fixture(page,{width:390,doneServer:'new'});await openJournal(page,390);
 // 한 번만 읽고, 최대 8일을 요청한다.
 await expect(group(page,'tasks').locator('li')).toHaveText(['보도자료 배포']);
 expect(f.taskCalls).toEqual(['8']);
 // 일요일(10/4)에 끝낸 할 일은 이전 주에서, 수요일(9/30)에 끝낸 것은 9/30을 고르면 보인다.
 await page.locator('#journalRoot [data-journal-prev]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('9월 28일 ~ 10월 4일');
 await date(page,'2026-09-30').click();
 await expect(group(page,'tasks').locator('li')).toHaveText(['지난주 수요일에 끝냄']);
 await date(page,'2026-10-04').click();
 await expect(group(page,'tasks').locator('li')).toHaveText(['지난 일요일에 끝냄']);
 await expect(page.locator('#journalRoot .journal-muted',{hasText:'안에 끝낸 것만'})).toHaveCount(0);
 // 8일보다 앞(9/26)은 서버가 주지 않으므로 이 날만 안내가 나온다.
 await date(page,'2026-09-28').click();
 await expect(group(page,'tasks')).toContainText('최근 8일 안에 끝낸 것만 모여요.');
 expect(f.taskCalls).toEqual(['8']);
 expect(f.errors).toEqual([]);
});

test('[업무일지] 끝낸 할 일 범위: 옛 서버(기간을 무시하고 3일만 답함)면 지금처럼 3일 + 안내, 깨지지 않는다',async({page})=>{
 const f=await fixture(page,{width:390,doneServer:'old'});await openJournal(page,390);
 await expect(group(page,'tasks').locator('li')).toHaveText(['보도자료 배포']);
 expect(f.taskCalls).toEqual(['8']);
 await page.locator('#journalRoot [data-journal-prev]').click();
 await date(page,'2026-09-30').click();
 await expect(group(page,'tasks').locator('li')).toHaveCount(0);
 await expect(group(page,'tasks')).toContainText('최근 3일 안에 끝낸 것만 모여요.');
 expect(f.errors).toEqual([]);
});

test('[주간보고 초안 복사] 끝낸 할 일: 넓어진 서버면 지난주 전체가 들어가고 3일 안내는 없다, 옛 서버면 안내가 붙는다',async({page})=>{
 const f=await fixture(page,{width:1280,doneServer:'new'});
 await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:testOrigin});
 await openJournal(page,1280);
 await expect(group(page,'tasks').locator('li')).toHaveCount(1);
 await page.locator('#journalRoot [data-journal-prev]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('9월 28일 ~ 10월 4일');
 await page.locator('#journalRoot [data-journal-copy]').click();
 await expect(page.locator('#journalRoot [data-journal-status]')).toContainText('복사했어요');
 const lines=(await page.evaluate(()=>navigator.clipboard.readText())).split('\n');
 expect(lines).toContain('- 끝낸 할 일: 지난주 수요일에 끝냄');
 expect(lines).toContain('- 끝낸 할 일: 지난 일요일에 끝냄');
 // 이 주의 월요일(9/28)은 8일 창(9/29~)보다 앞이라 안내가 붙는다.
 expect(lines.some(l=>l.startsWith('※ 끝낸 할 일은 Google 할 일에서 최근 8일'))).toBe(true);
 // 이번 주는 한 주 전체가 창 안이라 안내가 없다.
 await page.locator('#journalRoot [data-journal-next]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 5일 ~ 11일');
 await page.locator('#journalRoot [data-journal-copy]').click();
 const now=(await page.evaluate(()=>navigator.clipboard.readText())).split('\n');
 expect(now.some(l=>l.startsWith('※ 끝낸 할 일은'))).toBe(false);
});

// JOURNAL-요청표시: an update marked [임원 요청]·[논의 요청] (metadata.requests) carries the same small tags in the day card, and the
// weekly report draft starts with the two request lists ("임원 일정 배정 요청", "논의 요청"), the week's marked updates in each.
for(const width of [390,1280])test(`[업무일지] 요청 표시: 하루 카드 항목 앞 꼬리표, 초안 맨 앞 "임원 일정 배정 요청"·"논의 요청" 묶음 ${width}`,async({page},info)=>{
 const f=await fixture(page,{width});
 f.rows.find(r=>r.id==='b2').metadata={requests:['exec_schedule','discussion']};
 f.rows.find(r=>r.id==='b1').metadata={requests:['discussion'],folder:'무시되는 값'};
 await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:testOrigin});
 await openJournal(page,width);
 const orgs=group(page,'orgs');
 await expect(orgs.locator('li')).toHaveCount(3);
 const marked=orgs.locator('li[data-journal-requests]');
 await expect(marked).toHaveCount(2);
 await expect(marked.nth(0).locator('[data-request-tag]')).toHaveText(['임원 요청','논의 요청']);
 await expect(marked.nth(0)).toContainText('안녕하세요 위원장님');
 await expect(marked.nth(1).locator('[data-request-tag]')).toHaveText(['논의 요청']);
 await expect(marked.nth(1)).toContainText('현장 간담회 메모');
 // The organization's own record has no tag.
 await expect(orgs.locator('li',{hasText:'조직 화면에서 쓴 업데이트'}).locator('[data-request-tag]')).toHaveCount(0);
 await page.screenshot({path:info.outputPath(`journal-requests-${width}.png`)});
 await page.locator('#journalRoot [data-journal-copy]').click();
 await expect(page.locator('#journalRoot [data-journal-status]')).toHaveText('이번 주 한 줄과 재료 목록을 복사했어요.');
 const lines=(await page.evaluate(()=>navigator.clipboard.readText())).split('\n');
 expect(lines.slice(0,9)).toEqual(['주간 업무일지 10월 5일(월) ~ 10월 11일(일)','',
  '[임원 일정 배정 요청]','- 10월 6일(화) · 가상 노동조합: 안녕하세요 위원장님','',
  '[논의 요청]','- 10월 6일(화) · 가상 노동조합: 안녕하세요 위원장님','- 10월 6일(화): 현장 간담회 메모','']);
 expect(lines[9]).toBe('■ 10월 5일(월)');
 expect(lines).toContain('- 조직 소식 · 가상 노동조합: [임원 요청] [논의 요청] 안녕하세요 위원장님');
 expect(lines).toContain('- 조직 소식 · 미분류: [논의 요청] 현장 간담회 메모');
 expect(lines).toContain('- 조직 소식 · 나 지역 모임: 조직 화면에서 쓴 업데이트');
 // Last week's update (b0) is not in this week's lists.
 expect(lines.some(l=>l.includes('지난주 메모'))).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.errors).toEqual([]);
});
