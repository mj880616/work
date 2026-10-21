import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { testOrigin } from './helpers/test-origin.mjs';
import { servePagesCors } from './helpers/hwp-editor.mjs';
import { readFileSync } from 'node:fs';
import { zlib, SAMPLE } from '../../scripts/weekly-hwpx/cli.mjs';
import { makeFakeReport } from '../../scripts/weekly-hwpx/fixture.mjs';
import { openHwpx, packHwpx, validateHwpx, readXml } from '../../app/weekly-hwpx/hwpx.mjs';
import { extractBlankTemplate } from '../../app/weekly-hwpx/template.mjs';
import { buildReport, readReport, CHANGED_COLOR } from '../../app/weekly-hwpx/report.mjs';
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
 const rows=store(),writes=[],reads=[],errors=[],taskCalls=[],calendarReads=[],more=others();
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
  if(a==='status')return fail.calendarNames?r.fulfill({status:500,json:{error:'QA failure'}}):r.fulfill({json:{connected:true,enabled:true,selected:['c','p1','p2'],calendars:[{id:'c',summary:'가상 업무'},{id:'p1',summary:'명진승지'},{id:'p2',summary:'Arsenal  명진'}]}});
  if(a!=='events')return r.fallback();
  const q=new URL(r.request().url()).searchParams;calendarReads.push([q.get('timeMin'),q.get('timeMax')]);
  if(!sources.events||(fail.upcoming&&q.get('timeMin')!==new Date('2026-10-05T00:00:00+09:00').toISOString()))return r.fulfill({status:500,json:{error:'QA failure'}});
  // WEEKLY-주요일정: the two weeks after the shown week (10/12~10/25) hold a meeting, a several-day event, a vacation and one
  // marked 일기 (left out); 10/27 is in the two weeks after 10/12's week only. The answer honours timeMin/timeMax like Google.
  const instant=v=>Date.parse(/T/.test(v)?v:v+'T00:00:00+09:00'),min=Date.parse(q.get('timeMin')),max=Date.parse(q.get('timeMax'));
  return r.fulfill({json:{events:[
   {id:'all',title:'여러 날 일정',allDay:true,start:'2026-10-05',end:'2026-10-08',calendarId:'c'},
   {id:'am',title:'오전 일정',start:'2026-10-06T10:00:00+09:00',end:'2026-10-06T11:00:00+09:00',calendarId:'c'},
   {id:'fri',title:'금요일 일정',start:'2026-10-09T15:00:00+09:00',end:'2026-10-09T16:00:00+09:00',calendarId:'c'},
   {id:'next',title:'가상 다음 주 회의',location:'가상 회의실',start:'2026-10-13T10:30:00+09:00',end:'2026-10-13T11:30:00+09:00',calendarId:'c'},
   {id:'camp',title:'가상 수련회',allDay:true,start:'2026-10-14',end:'2026-10-16',calendarId:'c'},
   {id:'leave',title:'연차',allDay:true,start:'2026-10-23',end:'2026-10-24',calendarId:'c'},
   {id:'diary',title:'일기 쓰는 날',start:'2026-10-20T20:00:00+09:00',end:'2026-10-20T21:00:00+09:00',calendarId:'c'},
   {id:'mine',title:'가상 개인 약속',start:'2026-10-14T19:00:00+09:00',end:'2026-10-14T20:00:00+09:00',calendarId:'p1'},
   {id:'match',title:'가상 아스날 경기',start:'2026-10-17T21:00:00+09:00',end:'2026-10-17T23:00:00+09:00',calendarId:'p2'},
   {id:'third',title:'가상 셋째 주 집회',start:'2026-10-27T14:00:00+09:00',end:'2026-10-27T15:00:00+09:00',calendarId:'c'},
  ].filter(e=>!q.has('timeMin')||(instant(e.start)<max&&instant(e.end)>min))}});
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
 return {rows,writes,reads,errors,taskCalls,calendarReads,more,heal:key=>{sources[key]=true;delete fail[key];}};
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
  await expect(page.locator('#journalRoot [data-journal-empty]')).toHaveCount(0); // JOURNAL-다듬기: '기록 없는 묶음' 줄은 없다.
  await expect(page.locator('#journalRoot')).not.toContainText('없어요.');
  // 목요일: 회의 결과(차수까지), 그날 올린 회의자료.
  await date(page,'2026-10-08').click();await expect(group(page,'meetings').locator('li')).toHaveText(['10:00 운영위원회 3차']);
  await expect(group(page,'docs').locator('li')).toHaveText(['[회의] 운영위 3차 자료 · 회의자료']);
  // 수요일 0시(한국 시간)의 조직 기록은 화요일이 아니라 수요일. 마감이 수요일인 할 일은 수요일 예정.
  await date(page,'2026-10-07').click();await expect(group(page,'orgs').locator('li')).toHaveText(['수요일 0시 기록']);
  await expect(group(page,'due').locator('li')).toHaveText(['남은 할 일']);
  // 다음 주 월요일 0시(한국 시간)에 올린 자료는 이번 주 일요일에 오지 않는다.
  await date(page,'2026-10-11').click();await expect(group(page,'docs')).toHaveCount(0);
  await expect(page.locator('#journalRoot [data-journal-empty]')).toHaveCount(0);
  // app_notes 읽기는 모두 종류를 가린다(일지 한 줄은 kind=work, 업데이트는 basket). 노트(note)는 '노트로 옮긴 업데이트' 표시가 있는 것만,
  // id·제목·날·표시만 읽는다(본문 raw_text·다른 metadata 없음).
  const noteReads=f.reads.filter(q=>!q.table&&q.kind==='eq.note');
  expect(noteReads).toHaveLength(1);
  expect(noteReads[0]).toMatchObject({'metadata->>moved_from_update_at':'not.is.null',select:'id,title,occurred_at,moved_at:metadata->>moved_from_update_at'});
  expect(f.reads.filter(q=>!q.table&&q.kind!=='eq.note').every(q=>/^eq\.(work|basket)$/.test(q.kind||''))).toBe(true);
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
 // 제목·선택은 누르자마자 바뀌고 그 주 읽기 요청은 그 뒤에 도착한다: 요청이 온 것을 기다린다.
 await expect.poll(()=>f.reads.some(q=>q.kind==='eq.work'&&q.journal_day==='gte.2026-10-12&lte.2026-10-18')).toBe(true);
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

// [주간보고 초안 복사] (2026-10-21 사용자 승인): 날짜순이 아니라 주간보고 양식 순서(1. 요청사항 → 2. 사업 → 4. 산하 조직 →
// 5. 주요 일정 → 참고)로, [주간 정리]와 같은 묶음을 글로 복사한다.
test('[주간보고 초안 복사]: 양식 순서(1 → 2 → 4 → 5 → 참고)로 복사, 한 줄은 저장 순서대로 참고에',async({page})=>{
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
 // 5. 주요 일정은 다음 주 월요일부터 2주(10/12~10/25)를 따로 읽는다.
 await expect.poll(()=>f.calendarReads.some(([min,max])=>min===new Date('2026-10-12T00:00:00+09:00').toISOString()&&max===new Date('2026-10-26T00:00:00+09:00').toISOString())).toBe(true);
 await page.locator('#journalRoot [data-journal-copy]').click();
 await expect(page.locator('#journalRoot [data-journal-status]')).toHaveText('주간보고 양식 순서로 복사했어요.');
 const text=await page.evaluate(()=>navigator.clipboard.readText());
 const lines=text.split('\n');
 expect(lines.slice(0,2)).toEqual(['주간 업무일지 10월 5일(월) ~ 10월 11일(일)','■ 일시 : 2026년 10월 12일(월)']);
 expect(lines.filter(l=>/^(\d\. |참고$)/.test(l))).toEqual(['1. 요청사항','2. 기본·영역·의제 사업','4. 산하 조직 현황','5. 주요 일정 (10월 12일(월) ~ 10월 25일(일))','참고']);
 expect(lines.filter(l=>l.startsWith('■ '))).toEqual(['■ 일시 : 2026년 10월 12일(월)']);expect(lines.some(l=>l.startsWith('한 줄: '))).toBe(false);
 const part=title=>{const at=lines.indexOf(title);return lines.slice(at+1,lines.indexOf('',at));};
 expect(part('1. 요청사항')).toEqual(['1) 임원 일정 배정·논의 요청: (아직 재료 없음)','2) 주요 일정: (비워 둠) 본부 주요 일정 — 기자회견·주요 회의·토론회·집회·교육 등, 특정 사업장·반복 일정 제외. 자동 채우기는 나중에']);
 // 2. 사업: 프로젝트 기록(프로젝트 트리 — 이 fixture에서는 홈 모의 트리의 사업영역 한 개) → 회의·행사 결과.
 expect(part('2. 기본·영역·의제 사업')).toEqual(['1) 요약','◦ 테스트 프로젝트','- 10월 6일(화) 진행상황 업데이트','2) 세부 내용 — 회의·행사 결과','- 10월 6일(화) 14:00 가상 기자회견','- 10월 8일(목) 10:00 운영위원회 3차']);
 expect(text).not.toContain('미분류: 가상 사업');
 // 4. 산하 조직 현황: 조직 이름별, 업데이트 하나는 한 줄.
 expect(part('4. 산하 조직 현황')).toEqual(['1) 요약','◦ 가상 노동조합','- 10월 6일(화) 안녕하세요 위원장님','◦ 나 지역 모임','- 10월 6일(화) 조직 화면에서 쓴 업데이트','- 10월 7일(수) 수요일 0시 기록','◦ 미분류','- 10월 6일(화) 현장 간담회 메모']);
 // 5. 주요 일정: 다음 주 월요일부터 2주, 양식 칸 모양, 휴가는 ※ 줄, 일기 표시 일정은 없다. 이번 주 일정(하루 카드의 일정)은 없다.
 expect(part('5. 주요 일정 (10월 12일(월) ~ 10월 25일(일))')).toEqual(['- 10.13.(화) 10:30 / 가상 다음 주 회의 / 가상 회의실','- 10.14.(수) ~ 10.15.(목) 종일 / 가상 수련회','※ 휴가: 10/23(금) 연차']);
 expect(text).not.toContain('가상 개인 약속');expect(text).not.toContain('가상 아스날 경기');expect(text).not.toContain('일기 쓰는 날');expect(text).not.toContain('가상 셋째 주 집회');expect(text).not.toContain('오전 일정');
 // 참고: 한 줄(저장 순서) → 끝낸 할 일 → 할 일 예정 → 자료실 → 공유 페이지.
 expect(part('참고')).toEqual(['◦ 한 줄','- 10월 5일(월) 월요일 한 줄','- 10월 6일(화) 화요일 첫 줄','- 10월 6일(화) 화요일 둘째 줄','- 10월 8일(목) 목요일 첫 줄','- 10월 8일(목) 목요일 둘째 줄',
  '◦ 끝낸 할 일','- 10월 6일(화) 보도자료 배포','◦ 할 일 예정','- 10월 6일(화) 오늘 마감 할 일','- 10월 7일(수) 남은 할 일',
  '◦ 자료실 새 자료','- 10월 6일(화) [교섭] 가상 교섭 요구안','- 10월 8일(목) [회의] 운영위 3차 자료 · 회의자료','◦ 공유 페이지','- 10월 6일(화) 가상 안내 페이지 · 게시']);
 expect(text).not.toContain('지난주 페이지');expect(text).not.toContain('다음 주 자료');
 expect(text).not.toContain('출처: 가상 소식지');expect(text).not.toContain('바구니 업데이트');expect(text).not.toContain('고친 노트');
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
 await expect(page.locator('#journalRoot [data-journal-status]')).toHaveText('주간보고 양식 순서로 복사했어요.');
 const lines=(await page.evaluate(()=>navigator.clipboard.readText())).split('\n');
 const four=lines.indexOf('4. 산하 조직 현황'),orgLines=lines.slice(four+2,lines.indexOf('',four)).filter(l=>!l.includes('10월 7일'));
 expect(orgLines).toEqual(['◦ 가상 노동조합','- 10월 6일(화) 안녕하세요 위원장님','◦ 나 지역 모임','- 10월 6일(화) 조직 화면에서 쓴 업데이트',
  '◦ 그 외','- 10월 6일(화) 다 바깥 모임 · 바깥 모임 기록','- 10월 6일(화) 라 쉬는 모임 · 쉬는 모임 기록','◦ 미분류','- 10월 6일(화) 현장 간담회 메모']);
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
  // 빈 묶음이 접힌 날(월): 남은 칸은 그대로 2칸 줄이고, '기록 없는 묶음' 줄은 없다(JOURNAL-다듬기).
  await date(page,'2026-10-05').click();await expect(page.locator('#journalRoot [data-journal-empty]')).toHaveCount(0);await expect(page.locator('#journalRoot')).not.toContainText('기록 없는 묶음');
  const fold=await page.evaluate(()=>{const m=document.querySelector('#journalRoot [data-journal-materials]').getBoundingClientRect(),g=document.querySelector('#journalRoot [data-journal-group]').getBoundingClientRect();return {m:m.width,g:g.width};});
  expect(fold.g).toBeLessThan(fold.m*0.6);
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
 await page.locator('#journalRoot [data-journal-date="2026-10-07"]').click();await expect(page.locator('#journalRoot [data-journal-empty]')).toHaveCount(0);
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
 await expect(page.locator('#journalRoot [data-journal-empty]')).toHaveCount(0);
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
 const done=lines.indexOf('◦ 끝낸 할 일');
 expect(lines.slice(done+1,done+3)).toEqual(['- 9월 30일(수) 지난주 수요일에 끝냄','- 10월 4일(일) 지난 일요일에 끝냄']);
 // 이 주의 월요일(9/28)은 8일 창(9/29~)보다 앞이라 안내가 붙는다.
 expect(lines.some(l=>l.startsWith('※ Google 할 일은 최근 8일'))).toBe(true);
 // 이번 주는 한 주 전체가 창 안이라 안내가 없다.
 await page.locator('#journalRoot [data-journal-next]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 5일 ~ 11일');
 await page.locator('#journalRoot [data-journal-copy]').click();
 const now=(await page.evaluate(()=>navigator.clipboard.readText())).split('\n');
 expect(now.some(l=>l.startsWith('※ Google 할 일은'))).toBe(false);
});

// JOURNAL-요청표시: an update marked [임원 요청]·[논의 요청] (metadata.requests) carries the same small tags in the day card, and the
// weekly report draft has no separate request lists at the top (the marked updates stay in their own groups with the tag).
for(const width of [390,1280])test(`[업무일지] 요청 표시: 하루 카드 항목 앞 꼬리표, 초안에는 요청 묶음 없음 ${width}`,async({page},info)=>{
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
 await expect(page.locator('#journalRoot [data-journal-status]')).toHaveText('주간보고 양식 순서로 복사했어요.');
 const lines=(await page.evaluate(()=>navigator.clipboard.readText())).split('\n');
 expect(lines.slice(0,4)).toEqual(['주간 업무일지 10월 5일(월) ~ 10월 11일(일)','■ 일시 : 2026년 10월 12일(월)','','1. 요청사항']);
 expect(lines.some(l=>l==='[임원 일정 배정 요청]'||l==='[논의 요청]')).toBe(false);
 expect(lines[lines.indexOf('◦ 가상 노동조합')+1]).toBe('- 10월 6일(화) [임원 요청] [논의 요청] 안녕하세요 위원장님');
 expect(lines[lines.indexOf('◦ 미분류')+1]).toBe('- 10월 6일(화) [논의 요청] 현장 간담회 메모');
 expect(lines[lines.indexOf('◦ 나 지역 모임')+1]).toBe('- 10월 6일(화) 조직 화면에서 쓴 업데이트');
 // Last week's update (b0) is not in this week's lists.
 expect(lines.some(l=>l.includes('지난주 메모'))).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.errors).toEqual([]);
});

// JOURNAL-주간보고허브 2단계: [하루 | 주간 정리]. [주간 정리] shows the same week's reads in the weekly report form's order
// (1. 요청사항 box with no material yet → 2. 요약 표(사업영역 → 세부 과제, 3단 = "세부과제 › 사안: 내용")·회의·행사 결과 →
// 4. 산하 조직 현황 → 참고). The project tree comes from the project catalog (app_spaces select=*); fake names only.
const weeklyTree=[
 {id:'wa',name:'사업영역 가',parent_id:null,status:'active',sort_order:1,metadata:{project_system:'v2'}},
 {id:'wa1',name:'세부 과제 가-1',parent_id:'wa',status:'active',sort_order:1},
 {id:'wa1x',name:'사안 가-1-ㄱ',parent_id:'wa1',status:'active',sort_order:1},
 {id:'wa2',name:'세부 과제 가-2',parent_id:'wa',status:'active',sort_order:2},
 {id:'wb',name:'사업영역 나',parent_id:null,status:'active',sort_order:2,metadata:{project_system:'v2'}},
 {id:'wb1',name:'세부 과제 나-1',parent_id:'wb',status:'active',sort_order:1},
];
async function weeklyFixture(page,options={}){
 const f=await fixture(page,options);
 f.more.spaces.push(...weeklyTree.map(({id,name})=>({id,workspace_id:'w',name})));
 // Records out of tree order (나 before 가, 2단 after its 3단) so the order on screen is the tree's.
 f.more.progress.push(
  {id:'p2',project_id:'wb1',summary:'나-1 월요일 기록',effective_on:'2026-10-05',created_at:'2026-10-05T03:00:00Z'},
  {id:'p3',project_id:'wa1x',summary:'사안 수요일 기록',effective_on:'2026-10-07',created_at:'2026-10-07T03:00:00Z'},
  {id:'p4',project_id:'wa1',summary:'가-1 목요일 기록',effective_on:'2026-10-08',created_at:'2026-10-08T03:00:00Z'},
  {id:'p5',project_id:'wa2',summary:'가-2 화요일 기록',effective_on:'2026-10-06',created_at:'2026-10-06T04:00:00Z'},
 );
 // A note moved from the basket ([노트로 옮기기]) shows on the day card but is not weekly material.
 f.rows.push({id:'n-moved',workspace_id:'w',kind:'note',title:'옮긴 합성 노트',journal_day:null,raw_text:'본문',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],moved_at:'2026-10-07T00:00:00.000Z',metadata:{moved_from_update_at:'2026-10-07T00:00:00.000Z'}});
 const catalog={fail:!!options.failCatalog};
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_spaces',async r=>{
  const q=new URL(r.request().url()).searchParams;
  if(r.request().method()!=='GET'||q.get('select')!=='*')return r.fallback();
  if(catalog.fail)return r.fulfill({status:500,json:{message:'QA failure'}});
  return r.fulfill({json:weeklyTree.map(p=>({...p,workspace_id:'w',owner_id:'home-test',created_at:at}))});
 });
 return {...f,catalog};
}
const weekly=(page,key)=>page.locator(`#journalRoot [data-journal-weekly="${key}"]`);
async function openWeekly(page){
 await page.locator('#journalRoot [data-journal-mode="week"]').click();
 await expect(page.locator('#journalRoot [data-journal-mode="week"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#journalRoot [data-journal-weekly-root]')).toBeVisible();
}
for(const width of [390,1440])test(`[주간 정리] 탭: 상집보고 순서(1. 요청사항 재료 없음·주요 일정 안내 → 2. 요약 표·회의 → 4. 조직 → 5. 주요 일정 2주 → 참고), 하루 카드로 돌아오기 ${width}`,async({page},info)=>{
 const f=await weeklyFixture(page,{width});
 await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:testOrigin});
 await openJournal(page,width);
 await expect(page.locator('#journalRoot [data-journal-mode]')).toHaveText(['하루','주간 정리']);
 await expect(page.locator('#journalRoot [data-journal-mode="day"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#journalRoot [data-journal-weekly-root]')).toBeHidden();
 // 하루 카드에는 옮긴 노트가 보인다(주간 정리에는 없다).
 await expect(page.locator('#journalRoot')).toContainText('옮긴 합성 노트');
 await openWeekly(page);
 await expect(page.locator('#journalRoot [data-journal-days]')).toBeHidden();
 await expect(page.locator('#journalRoot [data-journal-day]')).toBeHidden();
 await expect(page.locator('#journalRoot [data-journal-weekly-title]')).toHaveText('주간 정리 · 10월 5일 월요일 ~ 10월 11일 일요일');
 await expect(page.locator('#journalRoot [data-journal-weekly-chapter] > h4')).toHaveText(['1. 요청사항','2. 기본·영역·의제 사업','4. 산하 조직 현황','5. 주요 일정','참고 — 보고서 칸 밖 재료']);
 // ■ 일시 = 상집 보고일(보고 있는 주의 다음 월요일) — 한글 파일·초안 복사와 같은 날짜.
 await expect(page.locator('#journalRoot [data-journal-weekly-date]')).toHaveText('■ 일시 : 2026년 10월 12일(월) (상집 보고일)');
 // 1. 요청사항: 자리만, 입력칸·버튼 없음. 2) 주요 일정(본부 주요 일정)은 뜻만 한 줄로 알린다.
 await expect(weekly(page,'ask').locator('h5')).toHaveText('1) 임원 일정 배정·논의 요청');
 await expect(weekly(page,'hq-schedule').locator('h5')).toHaveText('2) 주요 일정');
 await expect(weekly(page,'hq-schedule').locator('[data-journal-weekly-guide]')).toHaveText('본부 주요 일정 — 기자회견·주요 회의·토론회·집회·교육 등, 특정 사업장·반복 일정 제외. 자동 채우기는 나중에');
 await expect(weekly(page,'hq-schedule').locator('li,table')).toHaveCount(0);
 await expect(weekly(page,'ask').locator('[data-journal-weekly-no-material]')).toHaveText('아직 재료 없음');
 await expect(page.locator('#journalRoot [data-journal-weekly-chapter="requests"]').locator('input,textarea,button,select')).toHaveCount(0);
 // 2. 요약: 사업영역 → 세부 과제 순서는 프로젝트 트리 그대로. 사업영역 칸은 세로로 합친다.
 const summary=weekly(page,'summary');
 await expect(summary.locator('tbody tr')).toHaveCount(3);
 expect(await summary.locator('tbody tr').evaluateAll(rows=>rows.map(r=>[r.dataset.journalArea,r.dataset.journalTask]))).toEqual([
  ['사업영역 가','세부 과제 가-1'],['사업영역 가','세부 과제 가-2'],['사업영역 나','세부 과제 나-1']]);
 await expect(summary.locator('th.journal-weekly-area')).toHaveText(['사업영역 가','사업영역 나']);
 await expect(summary.locator('th.journal-weekly-area').first()).toHaveAttribute('rowspan','2');
 // 한 세부 과제 칸 안: 2단 기록 먼저, 그 아래 사안(3단)은 "세부과제 › 사안: 내용".
 const a1=summary.locator('tr[data-journal-task="세부 과제 가-1"] .journal-weekly-progress li');
 await expect(a1).toHaveText(['10월 8일(목)가-1 목요일 기록','10월 7일(수)세부 과제 가-1 › 사안 가-1-ㄱ: 사안 수요일 기록']);
 // 트리 밖 프로젝트(가상 사업)는 표 아래 이름별로 남는다.
 await expect(summary.locator('[data-journal-weekly-others] [data-journal-org="가상 사업"] li')).toHaveText(['10월 6일(화)진행상황 업데이트']);
 // 회의·행사 결과는 회의 날짜 기준.
 await expect(weekly(page,'meetings').locator('li')).toHaveText(['10월 6일(화)14:00 가상 기자회견','10월 8일(목)10:00 운영위원회 3차']);
 // 4. 산하 조직 현황: 조직 순서(이름 있는 조직 → 미분류), 프로젝트 기록은 없다.
 await expect(weekly(page,'orgs').locator('[data-journal-org] > .journal-org-name')).toHaveText(['가상 노동조합','나 지역 모임','미분류']);
 await expect(weekly(page,'orgs')).not.toContainText('진행상황 업데이트');
 // 5. 주요 일정: 다음 주 월요일부터 2주(10/12~10/25), 일 | 시간/내용/장소 | 참석자, 휴가는 표 아래 ※ 줄, 일기 표시 일정은 없다.
 const cal=weekly(page,'calendar');
 await expect(cal.locator('h5')).toHaveText('10월 12일(월) ~ 10월 25일(일) · 다음 주 월요일부터 2주');
 await expect(cal.locator('thead th')).toHaveText(['일','시간/내용/장소','참석자']);
 await expect(cal.locator('tbody th')).toHaveText(['10.13.(화)','10.14.(수) ~ 10.15.(목)']);
 await expect(cal.locator('tbody .journal-weekly-what')).toHaveText(['10:30 / 가상 다음 주 회의 / 가상 회의실','종일 / 가상 수련회']);
 await expect(cal.locator('[data-journal-weekly-vacation]')).toHaveText('※ 휴가: 10/23(금) 연차');
 await expect(cal).not.toContainText('가상 개인 약속');await expect(cal).not.toContainText('가상 아스날 경기');await expect(cal).toContainText('명진승지·arsenal 명진 달력');await expect(cal).not.toContainText('일기 쓰는 날');await expect(cal).not.toContainText('가상 셋째 주 집회');
 // 참고: 한 줄·끝낸 할 일·할 일 예정·자료실·공유 페이지(기록 있는 것만 상자), 이번 주 일정·옮긴 노트·일기는 없다.
 await expect(page.locator('#journalRoot [data-journal-weekly-chapter="notes"] [data-journal-weekly] > h5')).toHaveText(['한 줄','끝낸 할 일','할 일 예정','자료실 새 자료','공유 페이지']);
 await expect(page.locator('#journalRoot [data-journal-weekly-chapter="notes"]')).not.toContainText('오전 일정');
 await expect(weekly(page,'note-lines').locator('li')).toHaveText(['10월 5일(월)월요일 한 줄']);
 await expect(page.locator('#journalRoot [data-journal-weekly-root]')).not.toContainText('옮긴 합성 노트');
 await expect(page.locator('#journalRoot [data-journal-weekly-root]')).not.toContainText('JOURNAL_SECRET');
 await expect(page.locator('#journalRoot [data-journal-weekly-root]')).not.toContainText('다음 주 자료');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`weekly-tab-${width}.png`),fullPage:true});
 // [주간보고 초안 복사]는 주간 정리에서도 그대로(같은 글).
 await page.locator('#journalRoot [data-journal-copy]').click();
 await expect(page.locator('#journalRoot [data-journal-status]')).toHaveText('주간보고 양식 순서로 복사했어요.');
 const lines=(await page.evaluate(()=>navigator.clipboard.readText())).split('\n');
 expect(lines.slice(0,4)).toEqual(['주간 업무일지 10월 5일(월) ~ 10월 11일(일)','■ 일시 : 2026년 10월 12일(월)','','1. 요청사항']);
 // 화면과 같은 묶음·순서: 사업영역 → 세부 과제(트리 순서), 5. 주요 일정 표 줄.
 const sum=lines.indexOf('1) 요약');
 expect(lines.slice(sum+1,sum+5)).toEqual(['◦ 사업영역 가','- 10월 8일(목) 세부 과제 가-1: 가-1 목요일 기록','- 10월 7일(수) 세부 과제 가-1 › 사안 가-1-ㄱ: 사안 수요일 기록','- 10월 6일(화) 세부 과제 가-2: 가-2 화요일 기록']);
 expect(lines).toContain('- 10월 5일(월) 세부 과제 나-1: 나-1 월요일 기록');
 expect(lines).toContain('- 10.13.(화) 10:30 / 가상 다음 주 회의 / 가상 회의실');
 // [하루]로 돌아오면 날짜 줄·하루 카드 그대로.
 await page.locator('#journalRoot [data-journal-mode="day"]').click();
 await expect(page.locator('#journalRoot [data-journal-weekly-root]')).toBeHidden();
 await expect(page.locator('#journalRoot [data-journal-day-title]')).toHaveText('10월 6일 화요일');
 await expect(group(page,'orgs').locator('li')).toHaveCount(3);
 await expect(page.locator('#journalRoot [data-journal-input]')).toBeEnabled();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('[주간 정리] 주 넘기기: 빈 주는 칸마다 빈 안내, [이번 주]로 돌아오면 다시 채워진다',async({page})=>{
 const f=await weeklyFixture(page,{width:1280});await openJournal(page,1280);
 await openWeekly(page);
 await expect(weekly(page,'summary').locator('tbody tr')).toHaveCount(3);
 await page.locator('#journalRoot [data-journal-next]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 12일 ~ 18일');
 await expect(page.locator('#journalRoot [data-journal-weekly-title]')).toHaveText('주간 정리 · 10월 12일 월요일 ~ 10월 18일 일요일');
 // 탭은 주간 정리 그대로.
 await expect(page.locator('#journalRoot [data-journal-days]')).toBeHidden();
 await expect(weekly(page,'summary').locator('[data-journal-weekly-empty]')).toHaveText('이 주 프로젝트 기록이 없어요.');
 await expect(weekly(page,'summary').locator('table')).toHaveCount(0);
 await expect(weekly(page,'meetings').locator('[data-journal-weekly-empty]')).toHaveText('이 주 회의·행사가 없어요.');
 await expect(weekly(page,'orgs').locator('[data-journal-weekly-empty]')).toHaveText('이 주 조직 소식이 없어요.');
 await expect(weekly(page,'ask').locator('[data-journal-weekly-no-material]')).toHaveText('아직 재료 없음');
 // 참고: 다음 주 자료(10/12 0시 KST)만 상자, 나머지는 '기록 없는 묶음' 한 줄.
 await expect(weekly(page,'note-docs').locator('li')).toHaveText(['10월 12일(월)[교육] 다음 주 자료']);
 await expect(page.locator('#journalRoot [data-journal-weekly-quiet-notes]')).toHaveText('기록 없는 묶음: 한 줄, 끝낸 할 일, 공유 페이지');
 // 5. 주요 일정은 그 주 다음 월요일부터 2주(10/19~11/1)로 다시 읽는다.
 await expect(weekly(page,'calendar').locator('h5')).toHaveText('10월 19일(월) ~ 11월 1일(일) · 다음 주 월요일부터 2주');
 await expect(page.locator('#journalRoot [data-journal-weekly-date]')).toHaveText('■ 일시 : 2026년 10월 19일(월) (상집 보고일)');
 await expect(weekly(page,'calendar').locator('tbody th')).toHaveText(['10.27.(화)']);
 await expect(weekly(page,'calendar').locator('[data-journal-weekly-vacation]')).toHaveText('※ 휴가: 10/23(금) 연차');
 await page.locator('#journalRoot [data-journal-prev]').click();await page.locator('#journalRoot [data-journal-prev]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('9월 28일 ~ 10월 4일');
 await expect(weekly(page,'orgs').locator('[data-journal-org="미분류"] li')).toHaveText(['9월 29일(화)지난주 메모']);
 await expect(weekly(page,'note-lines').locator('li')).toHaveText(['9월 30일(수)지난주 수요일']);
 await page.locator('#journalRoot [data-journal-today]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 5일 ~ 11일');
 await expect(weekly(page,'summary').locator('tbody tr')).toHaveCount(3);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('[주간 정리] 일부 읽기 실패: 못 읽은 칸만 안내·[다시 시도], 프로젝트 순서를 못 읽으면 이름별로 보인다',async({page})=>{
 const fail={},f=await weeklyFixture(page,{width:390,fail});
 // The reads fail from the journal on (the home and the calendar read projects and meetings at start-up).
 await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();await expect(page.locator('#calendarView')).toBeVisible();
 Object.assign(fail,{orgUpdates:true,meetings:true,upcoming:true});f.catalog.fail=true;
 await page.locator('#calendarView .schedule-switch [data-view="journal"]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 5일 ~ 11일');
 await openWeekly(page);
 await expect(weekly(page,'orgs').locator('[data-journal-failed]')).toHaveText('조직 소식 일부를 불러오지 못했어요.');
 // 바구니에서 온 조직 소식은 그대로 보인다.
 await expect(weekly(page,'orgs').locator('[data-journal-org] > .journal-org-name')).toHaveText(['가상 노동조합','미분류']);
 await expect(weekly(page,'meetings').locator('[data-journal-failed]')).toHaveText('회의·행사 결과을(를) 불러오지 못했어요.');
 await expect(weekly(page,'summary')).toContainText('프로젝트 순서를 불러오지 못해 프로젝트 이름별로 보여요.');
 await expect(weekly(page,'summary').locator('table')).toHaveCount(0);
 await expect(weekly(page,'summary').locator('[data-journal-weekly-others] [data-journal-org]')).toHaveCount(5);
 // 2주 달력 읽기도 제 칸만 실패. 다른 칸은 그대로.
 await expect(weekly(page,'calendar').locator('[data-journal-failed]')).toHaveText('달력 일정을(를) 불러오지 못했어요.');
 await expect(weekly(page,'note-lines').locator('li')).toHaveCount(1);
 await expect(weekly(page,'note-lines').locator('[data-journal-failed]')).toHaveCount(0);
 f.heal('orgUpdates');f.catalog.fail=false;
 await weekly(page,'orgs').locator('[data-journal-weekly-retry]').click();
 await expect(weekly(page,'orgs').locator('[data-journal-org] > .journal-org-name')).toHaveText(['가상 노동조합','나 지역 모임','미분류']);
 await expect(weekly(page,'orgs').locator('[data-journal-failed]')).toHaveCount(0);
 await weekly(page,'summary').locator('[data-journal-weekly-retry]').click();
 await expect(weekly(page,'summary').locator('tbody tr')).toHaveCount(3);
 f.heal('upcoming');
 await weekly(page,'calendar').locator('[data-journal-weekly-retry]').click();
 await expect(weekly(page,'calendar').locator('tbody th')).toHaveText(['10.13.(화)','10.14.(수) ~ 10.15.(목)']);
 await expect(weekly(page,'meetings').locator('[data-journal-failed]')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

// UI-화면점검 ④: 업무일지 위 조작 줄 — [하루|주간 정리]·‹ ›·[이번 주]·[주간보고 초안 복사]가 하나의 작은 버튼 기준(--ds-compact-*: 높이 32px·13px·500)을 쓴다.
for(const width of [390,1280])test(`업무일지 위 조작 줄: 버튼 높이·굵기·글자 크기가 하나의 작은 버튼 기준 ${width}`,async({page})=>{
 const f=await fixture(page,{width});
 await openJournal(page,width);
 const metrics=await page.evaluate(()=>{
  const token=n=>{const e=document.createElement('i');e.style.cssText=`display:block;height:var(${n})`;document.body.append(e);const v=e.getBoundingClientRect().height;e.remove();return v};
  const root=document.querySelector('#journalRoot'),pick=s=>[...root.querySelectorAll(s)].filter(b=>b.getBoundingClientRect().width>0).map(b=>{const r=(b.matches('[data-journal-mode]')?b.parentElement:b).getBoundingClientRect(),c=getComputedStyle(b);return {name:(b.getAttribute('aria-label')||b.textContent).trim(),h:Math.round(r.height*10)/10,size:c.fontSize,weight:Number(c.fontWeight)}});
  return {compact:token('--ds-compact-height'),bar:pick('.journal-head [data-journal-mode],.journal-head [data-journal-prev],.journal-head [data-journal-next],.journal-head [data-journal-today],.journal-head [data-journal-copy]')};
 });
 expect(metrics.bar.map(b=>b.name)).toEqual(['하루','주간 정리','이전 주','다음 주','이번 주','주간보고 초안 복사']);
 for(const b of metrics.bar){expect(b.h,`${b.name} 높이`).toBe(metrics.compact);expect(b.size,`${b.name} 글자`).toBe('13px');expect(b.weight,`${b.name} 굵기`).toBe(500)}
 expect(f.errors).toEqual([]);
});

// WEEKLY-한글초안 2단계: [주간 정리] → [주간보고 한글 파일 만들기]. 지난주 팀 확정본(합성 .hwpx: 저장소 rhwp 빈 문서 → 가짜 양식 → 합성 글)을
// 자료실 "주간보고 확정본"(document-actions hwp-open) 또는 기기 파일에서 열고, 내 줄·내 담당 조직 줄만 고칠 칸으로 보이고, 이번 주 기록을 줄 옆에
// [붙이기]로 더한 뒤 .hwpx / HWP를 내려받고, [확정]하면 library-files로 자료실에 저장한다. 이름·조직은 모두 합성.
const TEAM_REPORT={
 title:'가상팀 주간보고', date:'2026년 9월 28일(월)',
 requests:[{day:'10.1.(목)',items:[{what:'10:00 / 가상 행사 / 가상 장소',who:['가상 임원']}]}],
 summary:[
  {area:['사업영역 가'],rows:[{task:['세부 과제 가-1'],progress:['- 지난주 가-1 진행'],owner:['가상 담당']},{task:['세부 과제 가-2'],progress:['- 남의 진행'],owner:['다른 담당']}]},
  {area:['사업영역 나'],rows:[{task:['세부 과제 나-1'],progress:['- 지난주 나-1 진행'],owner:['가상 담당']}]},
 ],
 orgs:[{org:['가상 노동조합'],status:['- 지난주 조직 소식']},{org:['다 바깥 모임'],status:['- 남의 조직 소식']}],
};
const teamHwpx=()=>{const blank=extractBlankTemplate(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)),zlib)));return Buffer.from(packHwpx(buildReport(blank,TEAM_REPORT).pkg,zlib));};
function multipartBody(request){
 const type=request.headers()['content-type']||'',boundary=type.split('boundary=')[1],raw=request.postDataBuffer(),parts={};
 for(const chunk of raw.toString('latin1').split('--'+boundary).slice(1,-1)){
  const [head,...rest]=chunk.split('\r\n\r\n'),body=rest.join('\r\n\r\n').replace(/\r\n$/,'');
  const name=/name="([^"]+)"/.exec(head)?.[1],file=/filename="([^"]*)"/.exec(head)?.[1];
  parts[name]=file!==undefined?{file:Buffer.from(file,'latin1').toString('utf8'),bytes:Buffer.from(body,'latin1')}:Buffer.from(body,'latin1').toString('utf8');
 }
 return parts;
}
async function hwpxFixture(page,options={}){
 const f=await weeklyFixture(page,options),sent={open:[],library:[],other:[]},bytes=teamHwpx();
 const cors={'access-control-allow-origin':'*','access-control-expose-headers':'X-Web2-Hwp'};
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_profiles',r=>r.request().method()==='GET'?r.fulfill({json:[{display_name:'가상 담당'}]}):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganizations',r=>new URL(r.request().url()).searchParams.get('select')==='id,name,aliases,active'?r.fulfill({json:f.more.orgs.map(o=>({...o,aliases:[],active:o.active!==false}))}):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_documents',r=>{const q=new URL(r.request().url()).searchParams;if(!q.has('category'))return r.fallback();sent.other.push({category:q.get('category')});return r.fulfill({json:options.noConfirmed?[]:[{id:'doc-team',title:'가상 상집보고',file_name:'team.hwpx',created_at:at}]});});
 await page.route(SB+'/functions/v1/document-actions',r=>{
  if(r.request().method()==='OPTIONS')return r.fulfill({status:200,headers:cors});
  const body=r.request().postDataJSON();sent.open.push(body);
  return r.fulfill({status:200,headers:{...cors,'content-type':'application/octet-stream','x-web2-hwp':encodeURIComponent(JSON.stringify({source:'library',file_name:'team.hwpx',format:'hwpx',size:bytes.length,revision:'rev-1',md5:'a'.repeat(32),can_overwrite:false,shared:false}))},body:bytes});
 });
 await page.route(SB+'/functions/v1/library-files',r=>{const body=multipartBody(r.request());sent.library.push(body);return r.fulfill({headers:cors,json:{ok:true,document:{id:'doc-new',title:body.title}}});});
 await page.route(SB+'/functions/v1/ai-assist',r=>{sent.other.push({ai:true});return r.fulfill({status:500,json:{}});});
 return {...f,sent};
}
const hwpx=page=>page.locator('#journalRoot [data-journal-hwpx]');
const rowBox=(page,label)=>hwpx(page).locator('.journal-hwpx-row').filter({has:page.locator('label',{hasText:label})});
async function openDraft(page){
 await hwpx(page).locator('[data-hwpx-start]').click();
 await expect(hwpx(page).locator('#journalHwpxTitle')).toBeFocused();
 await hwpx(page).locator('[data-hwpx-library]').click();
 await expect(rowBox(page,'사업영역 가 › 세부 과제 가-1').locator('textarea')).toHaveValue('- 지난주 가-1 진행');
}
const savedReport=async download=>{const bytes=new Uint8Array(readFileSync(await download.path()));expect(validateHwpx(bytes,zlib).errors).toEqual([]);const pkg=openHwpx(bytes,zlib);return {pkg,report:readReport(pkg)};};

for(const width of [390,1280])test(`[주간보고 한글 파일 만들기]: 자료실 확정본 → 내 줄·내 담당 조직만, 이번 주 기록 붙이기 → .hwpx 받기 → [확정] 자료실 저장 ${width}`,async({page})=>{
 const f=await hwpxFixture(page,{width});
 await openJournal(page,width);await openWeekly(page);
 await openDraft(page);
 expect(f.sent.other).toEqual([{category:'eq.주간보고 확정본'}]);
 expect(f.sent.open).toEqual([{action:'hwp-open',document_id:'doc-team'}]);
 // 내 줄 2개(다른 담당의 가-2 줄은 없음), 내 담당 조직(가상 노동조합)만. 이름은 프로필에서.
 await expect(hwpx(page).locator('[data-hwpx-me]')).toHaveValue('가상 담당');
 await expect(hwpx(page).locator('[data-hwpx-date]')).toHaveValue('2026년 10월 12일(월)');
 await expect(hwpx(page).locator('[data-hwpx-part="summary"] .journal-hwpx-label')).toHaveText(['사업영역 가 › 세부 과제 가-1','사업영역 나 › 세부 과제 나-1']);
 await expect(hwpx(page).locator('[data-hwpx-part="orgs"] .journal-hwpx-label')).toHaveText(['가상 노동조합']);
 await expect(hwpx(page).locator('[data-hwpx-orgs]')).toContainText('내 담당 조직 2곳');
 // 이번 주 기록이 이름이 같은 줄 옆에. 남의 줄(가-2) 기록은 "줄을 찾지 못한 기록"으로.
 const a1=rowBox(page,'사업영역 가 › 세부 과제 가-1');
 await expect(a1.locator('[data-hwpx-material] li')).toHaveText([/가-1 목요일 기록/,/사안 가-1-ㄱ: 사안 수요일 기록/]);
 await expect(rowBox(page,'사업영역 나 › 세부 과제 나-1').locator('[data-hwpx-material] li')).toHaveText([/나-1 월요일 기록/]);
 await expect(hwpx(page).locator('[data-hwpx-unmatched]')).toContainText('가-2 화요일 기록');
 await a1.locator('[data-hwpx-material] li').first().getByRole('button',{name:/붙이기/}).click();
 await expect(a1.locator('textarea')).toHaveValue('- 지난주 가-1 진행\n- 가-1 목요일 기록');
 // 짝 없는 기록은 줄을 골라 붙인다.
 const rest=hwpx(page).locator('[data-hwpx-unmatched] li').filter({hasText:'가-2 화요일 기록'});
 await rest.locator('select').selectOption({label:'사업영역 나 › 세부 과제 나-1'});
 await rest.getByRole('button',{name:/붙이기/}).click();
 await expect(rowBox(page,'사업영역 나 › 세부 과제 나-1').locator('textarea')).toHaveValue('- 지난주 나-1 진행\n- 가-2 화요일 기록');
 await rowBox(page,'가상 노동조합').locator('textarea').fill('- 지난주 조직 소식\n- 손으로 고친 조직 소식');
 // .hwpx 받기: 규격 검사 통과, 내 줄만 채워지고 바뀐 줄만 파란 글씨, 요청 표는 확정본 그대로.
 const [download]=await Promise.all([page.waitForEvent('download'),hwpx(page).locator('[data-hwpx-build]').click()]);
 expect(download.suggestedFilename()).toBe('주간보고_20261012.hwpx');
 const {pkg,report}=await savedReport(download);
 expect(report.summary[0].rows.map(r=>r.progress)).toEqual([['- 지난주 가-1 진행','- 가-1 목요일 기록'],[]]);
 expect(report.summary[0].rows[1].owner).toEqual([]);
 expect(report.summary[1].rows[0].progress).toEqual(['- 지난주 나-1 진행','- 가-2 화요일 기록']);
 expect(report.orgs.map(o=>[o.org,o.status])).toEqual([[['가상 노동조합'],['- 지난주 조직 소식','- 손으로 고친 조직 소식']]]);
 expect(report.requests).toEqual(TEAM_REPORT.requests);
 // 5. 주요 일정 표(WEEKLY-주요일정): 다음 주 월요일부터 2주(10/12~10/25) 14일을 한 줄씩(일정 없는 날도 날짜), 여러 날 일정은 첫날 다음 줄,
 // 참석자 = 내 이름. 휴가는 표 아래 빈 줄 다음 "※ 날짜 이름 연차", 일기 표시 일정은 없다. 1. 2) 주요 일정은 비운다.
 const me=['가상 담당'];
 expect(report.calendar).toEqual([
  {day:'10.12.(월)',items:[]},{day:'10.13.(화)',items:[{what:'10:30 / 가상 다음 주 회의 / 가상 회의실',who:me}]},{day:'10.14.(수)',items:[]},
  {day:'10.14.(수) ~ 10.15.(목)',items:[{what:'종일 / 가상 수련회',who:me}]},
  ...['10.15.(목)','10.16.(금)','10.17.(토)','10.18.(일)','10.19.(월)','10.20.(화)','10.21.(수)','10.22.(목)','10.23.(금)','10.24.(토)','10.25.(일)'].map(day=>({day,items:[]}))]);
 const secText=new TextDecoder().decode(pkg.files.get('Contents/section0.xml'));
 expect(secText).toContain('<hp:t>※ 10.23.(금) 가상 담당 연차</hp:t>');
 expect(secText).not.toContain('가상 개인 약속');expect(secText).not.toContain('가상 아스날 경기');expect(secText).not.toContain('일기 쓰는 날');
 await expect(hwpx(page).locator('[data-hwpx-calendar]')).toHaveText('5. 주요 일정 표: 10월 12일(월)~10월 25일(일) 일정 2개(참석자 = 내 이름), 휴가 1개는 표 아래 ※ 줄로 채워요.');
 const header=readXml(pkg,'Contents/header.xml'),blue=new Set();
 for(const n of (function*w(x){yield x;for(const c of x.children||[])yield*w(c);})(header.root))if(n.name==='hh:charPr'&&n.attrs.textColor?.toUpperCase()===CHANGED_COLOR)blue.add(n.attrs.id);
 const sec=new TextDecoder().decode(pkg.files.get('Contents/section0.xml'));
 const runOf=text=>new RegExp(`charPrIDRef="(\\d+)"><hp:t>${text}</hp:t>`).exec(sec)?.[1];
 expect(blue.has(runOf('- 가-1 목요일 기록'))).toBe(true);
 expect(blue.has(runOf('- 지난주 가-1 진행'))).toBe(false);
 await expect(hwpx(page).locator('[data-hwpx-status]')).toContainText('바뀐 줄 3개');
 // [확정]: 한 번 묻고 library-files로 자료실에 저장(분류 "주간보고 개인본", 제목·날짜를 줘서 서버가 내용을 읽지 않음).
 page.once('dialog',d=>d.accept());
 await hwpx(page).locator('[data-hwpx-confirm]').click();
 await expect(hwpx(page).locator('[data-hwpx-status]')).toContainText('자료실에 "주간보고 개인본" 분류로 저장했어요');
 expect(f.sent.library).toHaveLength(1);
 const saved=f.sent.library[0];
 expect([saved.title,saved.category,saved.document_date,saved.file.file]).toEqual(['주간보고 2026년 10월 12일(월)','주간보고 개인본','2026-10-12','주간보고_20261012.hwpx']);
 expect(Object.keys(saved).sort()).toEqual(['category','document_date','file','title']);
 expect(validateHwpx(new Uint8Array(saved.file.bytes),zlib).errors).toEqual([]);
 await expect(hwpx(page).locator('[data-hwpx-confirm]')).toBeDisabled();
 expect(f.sent.other.filter(x=>x.ai)).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // 주가 바뀌면 초안은 닫힌다(다른 주 기록과 섞이지 않게).
 await page.locator('#journalRoot [data-journal-next]').click();
 await expect(hwpx(page).locator('.journal-hwpx-panel')).toBeHidden();
 await expect(hwpx(page).locator('[data-hwpx-status]')).toHaveText('주가 바뀌어 한글 파일 초안을 닫았어요.');
 await expect(hwpx(page).locator('[data-hwpx-start]')).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('[주간보고 한글 파일 만들기]: 자료실에 확정본이 없으면 알리고, [HWP로 받기]·기기 HWP 파일 고르기는 칸막이 편집기 엔진으로 바꾼다',async({page})=>{
 test.setTimeout(120000);
 await servePagesCors(page);
 const f=await hwpxFixture(page,{width:1280,noConfirmed:true});
 await openJournal(page,1280);await openWeekly(page);
 await hwpx(page).locator('[data-hwpx-start]').click();
 await hwpx(page).locator('[data-hwpx-library]').click();
 await expect(hwpx(page).locator('[data-hwpx-status]')).toContainText('"주간보고 확정본" 분류 자료가 없어요');
 expect(f.sent.open).toEqual([]);
 // 기기 파일(.hwpx) → 고칠 칸
 await hwpx(page).locator('[data-hwpx-file]').setInputFiles({name:'team.hwpx',mimeType:'application/octet-stream',buffer:teamHwpx()});
 await expect(rowBox(page,'사업영역 가 › 세부 과제 가-1').locator('textarea')).toHaveValue('- 지난주 가-1 진행');
 await expect(hwpx(page).locator('[data-hwpx-me]')).toHaveValue('가상 담당');
 // [HWP로 받기]: 같은 엔진이 HWP 5로 저장(OLE 머리)
 const [hwp]=await Promise.all([page.waitForEvent('download',{timeout:90000}),hwpx(page).locator('[data-hwpx-hwp]').click()]);
 expect(hwp.suggestedFilename()).toBe('주간보고_20261012.hwp');
 const hwpBytes=readFileSync(await hwp.path());
 expect([...hwpBytes.subarray(0,4)]).toEqual([0xd0,0xcf,0x11,0xe0]);
 // 그 HWP를 다시 기기 파일로: 엔진이 .hwpx로 바꾼 뒤 같은 칸
 await hwpx(page).locator('[data-hwpx-restart]').click();
 await hwpx(page).locator('[data-hwpx-file]').setInputFiles({name:'team.hwp',mimeType:'application/x-hwp',buffer:hwpBytes});
 await expect(rowBox(page,'사업영역 가 › 세부 과제 가-1').locator('textarea')).toHaveValue('- 지난주 가-1 진행',{timeout:60000});
 const [download]=await Promise.all([page.waitForEvent('download'),hwpx(page).locator('[data-hwpx-build]').click()]);
 const {report}=await savedReport(download);
 expect(report.summary[0].rows[0].progress).toEqual(['- 지난주 가-1 진행']);
 expect(f.sent.library).toEqual([]);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
