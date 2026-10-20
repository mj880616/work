import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { testOrigin } from './helpers/test-origin.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// JOURNAL-일지 2단계: [일정] [달력|할 일|일지|일기] → [일지]. The clock is 2026-10-06 10:00 KST (Tuesday); the week is
// 10/5(월)~10/11(일). The mock keeps one app_notes store, honours PostgREST filters and the database's work-line rules
// (one line, 1~300 characters, no attachments, one per day — 409), and lets each material source fail on its own.
const at='2026-10-06T00:30:00Z';
function store(){
 return [
  {id:'b1',workspace_id:'w',kind:'basket',title:null,journal_day:null,raw_text:'현장 간담회 메모\n둘째 줄',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'b0',workspace_id:'w',kind:'basket',title:null,journal_day:null,raw_text:'지난주 메모',occurred_at:'2026-09-29T01:00:00Z',created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'n1',workspace_id:'w',kind:'note',title:'교섭 정리 노트',journal_day:null,raw_text:'본문',occurred_at:at,created_at:at,updated_at:'2026-10-06T00:40:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'k5',workspace_id:'w',kind:'work',title:null,journal_day:'2026-10-05',raw_text:'월요일 한 줄',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'k0',workspace_id:'w',kind:'work',title:null,journal_day:'2026-09-30',raw_text:'지난주 수요일',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'d1',workspace_id:'w',kind:'diary',title:null,journal_day:'2026-10-06',raw_text:'일기 JOURNAL_SECRET',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:false,attachments:[],metadata:{}},
 ];
}
function validWork(row){
 return typeof row.raw_text==='string'&&!/[\r\n]/.test(row.raw_text)&&[...row.raw_text.trim()].length>=1&&[...row.raw_text.trim()].length<=300&&!(row.attachments||[]).length&&!!row.journal_day;
}
async function fixture(page,{width=390,height=900,fail={}}={}){
 const rows=store(),writes=[],reads=[],errors=[];
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
  }
  return true;
 };
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
   if(row.kind==='work'&&!validWork(row))return r.fulfill({status:400,json:{code:'23514'}});
   rows.push(row);return r.fulfill({status:201,json:[row]});
  }
  if(method==='PATCH'){
   const body=req.postDataJSON();writes.push({method,query:Object.fromEntries(q),body});
   const hit=rows.filter(row=>match(row,q));
   for(const row of hit){const next={...row,...body};if(next.kind==='work'&&!validWork(next))return r.fulfill({status:400,json:{code:'23514'}});Object.assign(row,next);}
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
  return r.fulfill({json:{tasks:[
   {id:'t-done',title:'보도자료 배포',status:'completed',completed:'2026-10-06T00:10:00Z',taskListId:'@default'},
   {id:'t-open',title:'남은 할 일',status:'needsAction',due:'2026-10-07',taskListId:'@default'},
  ],needs_reconnect:false}});
 });
 return {rows,writes,reads,errors,heal:key=>{sources[key]=true;delete fail[key];}};
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
const group=(page,key)=>page.locator(`#journalRoot [data-journal-group="${key}"]`);

for(const width of [390,1280]){
 test(`[업무일지] 이번 주 날짜 줄·한 줄 쓴 날 초록 점·오늘 고름, 그날 재료(일정·끝낸 할 일·바구니 업데이트·고친 노트) ${width}`,async({page})=>{
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
  await expect(group(page,'memos').locator('li')).toHaveText(['현장 간담회 메모']);
  await expect(group(page,'notes').locator('li')).toHaveText(['교섭 정리 노트']);
  // 일기는 업무일지 재료가 아니다.
  await expect(page.locator('#journalRoot')).not.toContainText('JOURNAL_SECRET');
  // 다른 날을 누르면 그날 한 줄·재료.
  await date(page,'2026-10-05').click();
  await expect(input).toHaveValue('월요일 한 줄');await expect(page.locator('#journalRoot [data-journal-save]')).toHaveText('고치기');
  await expect(group(page,'events').locator('li')).toHaveText(['종일 여러 날 일정']);
  await expect(group(page,'memos')).toContainText('없어요.');
  // 읽기는 모두 종류를 가린다(일지 한 줄은 kind=work, 메모는 basket, 노트는 note).
  expect(f.reads.every(q=>/^eq\.(work|basket|note)$/.test(q.kind||''))).toBe(true);
  expect(f.reads.find(q=>q.kind==='eq.work')).toMatchObject({journal_day:'gte.2026-10-05&lte.2026-10-11'});
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
  // 가로 넘침 없음.
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}

test('오늘 한 줄: Enter로 저장 → 점이 생기고 [고치기], 다시 쓰면 같은 행을 고침(날짜당 하나)',async({page})=>{
 const f=await fixture(page);await openJournal(page,390);
 const input=page.locator('#journalRoot [data-journal-input]'),line=page.locator('#journalRoot [data-journal-line-status]');
 await input.fill('  교섭 준비 회의 정리  ');
 await expect(page.locator('#journalRoot [data-journal-count]')).toHaveText('11/300자');
 await input.press('Enter');
 await expect(line).toHaveText('한 줄을 저장했어요.');
 expect(f.writes).toHaveLength(1);
 expect(f.writes[0]).toMatchObject({method:'POST',body:{workspace_id:'w',kind:'work',journal_day:'2026-10-06',raw_text:'교섭 준비 회의 정리'}});
 expect(Object.keys(f.writes[0].body).sort()).toEqual(['journal_day','kind','raw_text','workspace_id']);
 await expect(date(page,'2026-10-06').locator('[data-journal-dot]')).toBeVisible();
 await expect(page.locator('#journalRoot [data-journal-save]')).toHaveText('고치기');
 await input.fill('교섭 준비 회의 정리, 자료 공유');
 await page.locator('#journalRoot [data-journal-save]').click();
 await expect(line).toHaveText('한 줄을 고쳤어요.');
 expect(f.writes[1]).toMatchObject({method:'PATCH',query:{kind:'eq.work',workspace_id:'eq.w'},body:{raw_text:'교섭 준비 회의 정리, 자료 공유'}});
 expect(f.writes[1].query.id).toBe('eq.'+f.rows.find(r=>r.kind==='work'&&r.journal_day==='2026-10-06').id);
 expect(f.rows.filter(r=>r.kind==='work'&&r.journal_day==='2026-10-06')).toHaveLength(1);
 // 같은 글이면 쓰지 않는다.
 await page.locator('#journalRoot [data-journal-save]').click();await expect(line).toHaveText('바뀐 내용이 없어요.');expect(f.writes).toHaveLength(2);
 // 쓰던 글은 날짜를 오가도 남는다(저장 전).
 await date(page,'2026-10-07').click();await input.fill('수요일 초안');
 await date(page,'2026-10-06').click();await expect(input).toHaveValue('교섭 준비 회의 정리, 자료 공유');
 await date(page,'2026-10-07').click();await expect(input).toHaveValue('수요일 초안');
 expect(f.writes).toHaveLength(2);expect(f.errors).toEqual([]);
});

test('다른 기기가 먼저 쓴 날(409)은 그 행을 읽어 고친다',async({page})=>{
 const f=await fixture(page);await openJournal(page,390);
 // 화면이 읽은 뒤 다른 기기가 같은 날 한 줄을 씀.
 f.rows.push({id:'k-other',workspace_id:'w',kind:'work',title:null,journal_day:'2026-10-06',raw_text:'다른 기기 한 줄',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}});
 await page.locator('#journalRoot [data-journal-input]').fill('이 기기 한 줄');
 await page.locator('#journalRoot [data-journal-save]').click();
 await expect(page.locator('#journalRoot [data-journal-line-status]')).toHaveText('한 줄을 저장했어요.');
 expect(f.writes.map(w=>w.method)).toEqual(['POST','PATCH']);
 expect(f.writes[1].query.id).toBe('eq.k-other');
 expect(f.rows.filter(r=>r.kind==='work'&&r.journal_day==='2026-10-06').map(r=>r.raw_text)).toEqual(['이 기기 한 줄']);
 expect(f.errors).toEqual([]);
});

test('301자·줄바꿈·빈 줄은 저장하지 않고 이유를 보여 준다',async({page})=>{
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
 await expect(group(page,'memos').locator('li')).toHaveText(['지난주 메모']);
 // 지난주 일정은 그 주 범위로 다시 읽는다.
 await date(page,'2026-09-30').click();await expect(page.locator('#journalRoot [data-journal-input]')).toHaveValue('지난주 수요일');
 await page.locator('#journalRoot [data-journal-today]').click();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 5일 ~ 11일');
 await expect(date(page,'2026-10-06')).toHaveAttribute('aria-pressed','true');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('재료 일부를 못 읽어도 한 줄은 쓰고, 못 읽은 묶음만 안내·[다시 시도]',async({page})=>{
 const f=await fixture(page,{fail:{events:true,tasks:true}});await openJournal(page,390);
 await expect(group(page,'events').locator('[data-journal-failed]')).toHaveText('일정을(를) 불러오지 못했어요. 한 줄은 그대로 쓸 수 있어요.');
 await expect(group(page,'tasks').locator('[data-journal-failed]')).toBeVisible();
 await expect(group(page,'memos').locator('li')).toHaveText(['현장 간담회 메모']);
 await expect(group(page,'notes').locator('li')).toHaveText(['교섭 정리 노트']);
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

test('[주간보고 초안 복사]: 이번 주 한 줄 7개 + 날짜별 재료 목록을 복사',async({page})=>{
 const f=await fixture(page,{width:1280});
 await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:testOrigin});
 await openJournal(page,1280);
 await expect(group(page,'events').locator('li')).toHaveCount(2);
 await expect(group(page,'tasks').locator('li')).toHaveCount(1);
 await expect(group(page,'memos').locator('li')).toHaveCount(1);await expect(group(page,'notes').locator('li')).toHaveCount(1);
 await page.locator('#journalRoot [data-journal-copy]').click();
 await expect(page.locator('#journalRoot [data-journal-status]')).toHaveText('이번 주 한 줄과 재료 목록을 복사했어요.');
 const text=await page.evaluate(()=>navigator.clipboard.readText());
 const lines=text.split('\n');
 expect(lines[0]).toBe('주간 업무일지 10월 5일(월) ~ 10월 11일(일)');
 expect(lines.filter(l=>l.startsWith('■ '))).toHaveLength(7);
 expect(lines.filter(l=>l.startsWith('한 줄: '))).toHaveLength(7);
 expect(lines).toContain('한 줄: 월요일 한 줄');
 expect(lines).toContain('- 일정: 10:00 오전 일정');
 expect(lines).toContain('- 일정: 15:00 금요일 일정');
 expect(lines).toContain('- 끝낸 할 일: 보도자료 배포');
 expect(lines).toContain('- 바구니 업데이트: 현장 간담회 메모');
 expect(lines).toContain('- 고친 노트: 교섭 정리 노트');
 expect(text).not.toContain('JOURNAL_SECRET');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

// UI-PC업무일지폭: PC(≥1024)는 [일기]처럼 본문 폭을 다 쓴다(같은 바깥 폭 규칙 .view-wide). 하루 카드 안 4칸은 1280px 이상 한 줄, 그보다 좁으면 2열.
// 폰은 그대로(가운데 760px 상한·1열).
const journalBox=page=>page.evaluate(()=>{
 const r=e=>e.getBoundingClientRect(),view=document.querySelector('#journalView'),cs=getComputedStyle(view),main=getComputedStyle(document.querySelector('main'));
 const groups=[...document.querySelectorAll('#journalRoot [data-journal-group]')].map(r);
 return {root:r(document.querySelector('#journalRoot')).width,panel:view.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),
  right:r(document.querySelector('#journalRoot')).right,copy:r(document.querySelector('#journalRoot [data-journal-copy]')).right,days:r(document.querySelector('#journalRoot [data-journal-days]')).width,
  rows:new Set(groups.map(g=>Math.round(g.y))).size,cols:new Set(groups.map(g=>Math.round(g.x))).size,
  main:{max:main.maxWidth,pl:main.paddingLeft,pr:main.paddingRight},doc:document.documentElement.scrollWidth,vw:innerWidth};
});
for(const [width,cols] of [[1024,2],[1279,2],[1280,4],[1920,4]]){
 test(`PC 업무일지 폭: 일기와 같은 바깥 폭, 날짜 줄·카드·[주간보고 초안 복사]가 끝까지, 하루 카드 ${cols}칸 ${width}`,async({page})=>{
  const f=await fixture(page,{width});await openJournal(page,width);
  await expect(group(page,'notes').locator('li')).toHaveCount(1);
  const j=await journalBox(page);
  expect(j.doc).toBeLessThanOrEqual(j.vw);
  expect(Math.abs(j.root-j.panel)).toBeLessThan(2);expect(Math.abs(j.days-j.root)).toBeLessThan(2);expect(Math.abs(j.copy-j.right)).toBeLessThan(2);
  expect(j.root).toBeGreaterThan(760);
  expect(j.cols).toBe(cols);expect(j.rows).toBe(4/cols);
  // 같은 창에서 [일기]로 옮겨도 바깥 폭(본문 칸 상한·좌우 여백)과 화면 칸 폭이 같다.
  await page.locator('.app-nav [data-view="diary"]').click();await expect(page.locator('#diaryView')).toBeVisible();
  const d=await page.evaluate(()=>{const view=document.querySelector('#diaryView'),cs=getComputedStyle(view),main=getComputedStyle(document.querySelector('main'));
   return {root:document.querySelector('#diaryRoot').getBoundingClientRect().width,panel:view.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),main:{max:main.maxWidth,pl:main.paddingLeft,pr:main.paddingRight}};});
  expect(d.main).toEqual(j.main);expect(Math.abs(d.panel-j.panel)).toBeLessThan(1);expect(Math.abs(d.root-j.root)).toBeLessThan(2);
  expect(j.main.max).toBe('1920px');
  expect(f.errors).toEqual([]);
 });
}
test('폰 업무일지: 폭·1열 그대로 390',async({page})=>{
 const f=await fixture(page,{width:390});await openJournal(page,390);
 await expect(group(page,'notes').locator('li')).toHaveCount(1);
 const j=await journalBox(page);
 expect(j.doc).toBeLessThanOrEqual(j.vw);expect(j.cols).toBe(1);expect(j.rows).toBe(4);expect(Math.abs(j.root-j.panel)).toBeLessThan(2);
 expect(f.errors).toEqual([]);
});
