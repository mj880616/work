// UI-앱안알림 4·5단계(S47-40): Edge phone-push 사용자 입구 notices·opened·recent + 공용 '보낼 일' 목록(done-items.ts).
// 네트워크 없음: Supabase는 모두 지어낸 응답이다. migration 20261101210000_push_log_notices의 칸(shown_at·opened_at, status 'shown')을 흉내 낸다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const H=await import('../../supabase/functions/phone-push/handler.ts');
const D=await import('../../supabase/functions/phone-push/done-items.ts');

const SB='https://synthetic.supabase.test',SERVICE='synthetic-service-role-key',ANON='synthetic-anon-key';
const WS='a0000000-0000-4000-8000-000000000001',WS2='a0000000-0000-4000-8000-000000000002';
const USER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const JWT_OK='synthetic.user.jwt-owner-0001',JWT_STRANGER='synthetic.user.jwt-stranger-01';
const FN='https://synthetic.supabase.test/functions/v1/phone-push';
// 2026-11-06(금) 16:00 서울 = 07:00Z. 다음 주 월요일 = 2026-11-09, 기록 날 = 2026-11-06.
const FRI_16=Date.parse('2026-11-06T07:00:00Z'),FRI_14=Date.parse('2026-11-06T05:00:00Z'),SUN=Date.parse('2026-11-08T12:00:00Z'),MON=Date.parse('2026-11-09T01:00:00Z');
const reply=(status,body)=>new Response(body===undefined?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const eq=v=>v?.replace(/^eq\./,'');
const inl=v=>v?.replace(/^in\.\(|\)$/g,'').split(',').map(x=>x.replace(/^"|"$/g,''));

function harness({now=FRI_16,log=[],sheets={},env={},sheetFail=false,jobs=[],jobFail=false}={}){
 const state={log:log.map(r=>({...r})),calls:[]};
 const fetcher=async(url,init={})=>{
  const u=new URL(url),method=init.method??'GET',q=u.searchParams;
  if(u.pathname==='/auth/v1/user'){
   const a=init.headers?.Authorization;
   return a===`Bearer ${JWT_OK}`?reply(200,{id:USER}):a===`Bearer ${JWT_STRANGER}`?reply(200,{id:STRANGER}):reply(401,{});
  }
  const table=u.pathname.slice('/rest/v1/'.length),body=init.body?JSON.parse(init.body):undefined;
  state.calls.push({method,table,query:decodeURIComponent(u.search),apikey:init.headers.apikey,auth:init.headers.Authorization,body});
  if(table==='app_journal_next_week_sheets'){
   // 사용자 로그인 그대로(owner RLS) 읽는다: anon 열쇠 + 사용자 JWT, 읽기만.
   assert.equal(init.headers.apikey,ANON);assert.equal(method,'GET');
   assert.ok([`Bearer ${JWT_OK}`,`Bearer ${JWT_STRANGER}`].includes(init.headers.Authorization));
   if(sheetFail)return reply(500,{});
   const ws=eq(q.get('workspace_id')),week=eq(q.get('week_start'));
   return reply(200,(sheets[ws]||[]).includes(week)?[{week_start:week}]:[]);
  }
  if(table==='app_meeting_transcribe_jobs'){
   // S48-19 회의 요약: 사용자 로그인 그대로(owner RLS) 끝난 시각만 읽는다.
   assert.equal(init.headers.apikey,ANON);assert.equal(method,'GET');
   assert.ok([`Bearer ${JWT_OK}`,`Bearer ${JWT_STRANGER}`].includes(init.headers.Authorization));
   assert.equal(q.get('select'),'finished_at');assert.equal(q.get('status'),'eq.done');assert.equal(q.get('meeting_id'),'is.null');assert.equal(q.get('trashed_at'),'is.null');
   assert.equal(q.get('order'),'finished_at.desc');assert.equal(q.get('limit'),'1');
   if(jobFail)return reply(500,{});
   const ws=eq(q.get('workspace_id')),since=q.get('finished_at').replace(/^gte\./,'');
   const rows=jobs.filter(j=>j.workspace_id===ws&&j.status==='done'&&!j.meeting_id&&!j.trashed_at&&j.finished_at>=since).sort((a,b)=>b.finished_at.localeCompare(a.finished_at)).slice(0,1);
   return reply(200,rows.map(j=>({finished_at:j.finished_at})));
  }
  assert.equal(init.headers.apikey,SERVICE);
  assert.ok(['app_workspace_members','app_push_log'].includes(table),'only owner lookup + log: '+table);
  if(table==='app_workspace_members'){const uid=eq(q.get('user_id'));return reply(200,uid===USER?[{workspace_id:WS}]:uid===STRANGER?[{workspace_id:WS2}]:[]);}
  const ws=method==='POST'?body.workspace_id:eq(q.get('workspace_id'));
  assert.ok(ws===WS||ws===WS2,'log calls always scoped to a workspace');
  const match=r=>r.workspace_id===ws&&(!q.get('kind')||(q.get('kind').startsWith('in.')?inl(q.get('kind')).includes(r.kind):r.kind===eq(q.get('kind'))))
   &&(!q.get('ref_key')||(q.get('ref_key').startsWith('in.')?inl(q.get('ref_key')).includes(r.ref_key):r.ref_key===eq(q.get('ref_key'))))
   &&(!q.get('day')||r.day===eq(q.get('day')))&&(q.get('opened_at')!=='is.null'||!r.opened_at)&&(q.get('shown_at')!=='is.null'||!r.shown_at)
   &&(!q.get('sent_at')||r.sent_at>=q.get('sent_at').replace(/^gte\./,''));
  if(method==='GET'){
   const rows=state.log.filter(match).sort((a,b)=>b.sent_at.localeCompare(a.sent_at));
   return reply(200,rows);
  }
  if(method==='POST'){
   assert.equal(q.get('on_conflict'),'workspace_id,kind,ref_key,day');
   assert.match(init.headers.Prefer,/ignore-duplicates/);
   if(!state.log.some(r=>r.workspace_id===body.workspace_id&&r.kind===body.kind&&r.ref_key===body.ref_key&&r.day===body.day))state.log.push({sent_at:new Date(now).toISOString(),opened_at:null,...body});
   return new Response(null,{status:201,headers:{'content-length':'0'}});
  }
  if(method==='PATCH'){
   const hit=state.log.filter(match);for(const r of hit)Object.assign(r,body);
   return (init.headers.Prefer||'').includes('representation')?reply(200,hit.map(r=>({day:r.day}))):new Response(null,{status:204});
  }
  throw new Error('unexpected '+method+' '+table);
 };
 const handler=H.createPhonePushHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,SUPABASE_ANON_KEY:ANON,PHONE_PUSH_CRON_SECRET:'synthetic-phone-push-cron-secret-0123456789',...env})[n],fetch:fetcher,now:()=>now,log:()=>{}});
 const user=(action,body={},jwt=JWT_OK)=>handler(new Request(`${FN}?action=${action}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt}`},body:JSON.stringify(body)}));
 return {state,user};
}
const row=(o)=>({workspace_id:WS,status:'sent',shown_at:null,opened_at:null,sent_at:'2026-11-06T06:20:00.000Z',...o});

test('done-items: next week is due from Friday 15:00 Seoul through Sunday only; ref and log day are fixed',()=>{
 assert.deepEqual(D.nextWeekDue(FRI_16),{week:'2026-11-09',day:'2026-11-06'});
 assert.deepEqual(D.nextWeekDue(Date.parse('2026-11-07T14:59:00Z')),{week:'2026-11-09',day:'2026-11-06'}); // 일 23:59 서울
 assert.deepEqual(D.nextWeekDue(SUN),{week:'2026-11-09',day:'2026-11-06'});
 assert.equal(D.nextWeekDue(FRI_14),null);assert.equal(D.nextWeekDue(MON),null);
 assert.equal(D.nextWeekDue(Date.parse('2026-11-08T15:00:00Z')),null); // 월 00:00 서울
 assert.equal(D.openPath('next_week','w2026-11-09'),'/work/app/?view=home&mode=week&notice=next_week.w2026-11-09');
 assert.equal(D.openPath('quiet_digest','2026-11-06'),'/work/app/?notice=quiet_digest.2026-11-06');
 for(const k of D.NOTICE_LOG_KINDS)assert.match(D.openPath(k,'x:1'),/^\/work\/app\/\?[A-Za-z0-9_=&%.-]+$/,k);
});

test('notices: shows next week once per item, logs shown_at on a bar-only row, reads the sheet with the user login only',async()=>{
 const h=harness();
 const r=await h.user('notices');assert.equal(r.status,200);
 const out=await r.json();
 assert.deepEqual(out,{ok:true,items:[{kind:'next_week',ref_key:'w2026-11-09',open:'/work/app/?view=home&mode=week&notice=next_week.w2026-11-09'}]});
 assert.equal(h.state.log.length,1);
 assert.deepEqual({...h.state.log[0],sent_at:undefined},{workspace_id:WS,kind:'next_week',ref_key:'w2026-11-09',day:'2026-11-06',status:'shown',shown_at:new Date(FRI_16).toISOString(),opened_at:null,sent_at:undefined});
 // 두 번째 부름: 줄은 그대로 뜨되 기록은 한 줄 그대로.
 assert.equal((await (await h.user('notices')).json()).items.length,1);assert.equal(h.state.log.length,1);
 const sheetCall=h.state.calls.find(c=>c.table==='app_journal_next_week_sheets');
 assert.equal(sheetCall.auth,`Bearer ${JWT_OK}`);assert.match(sheetCall.query,new RegExp(`workspace_id=eq.${WS}&week_start=eq.2026-11-09`));
 // 응답·기록에 제목·본문 없음.
 assert.doesNotMatch(JSON.stringify(h.state.log),/title|body|다음 주/);
});

test('notices: an item already opened (from the phone push or the bar) does not come back, on any day',async()=>{
 const h=harness({log:[row({kind:'next_week',ref_key:'w2026-11-09',day:'2026-11-06',opened_at:'2026-11-06T06:30:00Z'})]});
 assert.deepEqual((await (await h.user('notices')).json()).items,[]);
 const h2=harness({now:SUN,log:[row({kind:'next_week',ref_key:'w2026-11-09',day:'2026-11-05',opened_at:'2026-11-06T06:30:00Z'})]});
 assert.deepEqual((await (await h2.user('notices')).json()).items,[]);
});

test('notices: a push already sent for the same item gets shown_at on that same row (no second row, status kept)',async()=>{
 const h=harness({log:[row({kind:'next_week',ref_key:'w2026-11-09',day:'2026-11-06'})]});
 assert.equal((await (await h.user('notices')).json()).items.length,1);
 assert.equal(h.state.log.length,1);assert.equal(h.state.log[0].status,'sent');assert.equal(h.state.log[0].shown_at,new Date(FRI_16).toISOString());
});

test('notices: nothing before Friday 15:00, nothing when the sheet exists, nothing when the sheet read fails or no anon key',async()=>{
 for(const h of [harness({now:FRI_14}),harness({now:MON}),harness({sheets:{[WS]:['2026-11-09']}}),harness({sheetFail:true}),harness({env:{SUPABASE_ANON_KEY:undefined}})]){
  const r=await h.user('notices');assert.equal(r.status,200);
  assert.deepEqual((await r.json()).items,[]);assert.equal(h.state.log.length,0);
 }
});

test('opened: own workspace only, shaped kind and ref only, sets opened_at once',async()=>{
 const h=harness({log:[row({kind:'next_week',ref_key:'w2026-11-09',day:'2026-11-06',status:'shown',shown_at:'2026-11-06T07:00:00Z'}),
  row({workspace_id:WS2,kind:'next_week',ref_key:'w2026-11-09',day:'2026-11-06',status:'shown',shown_at:'2026-11-06T07:00:00Z'})]});
 assert.deepEqual(await (await h.user('opened',{kind:'next_week',ref_key:'w2026-11-09'})).json(),{ok:true,opened:1});
 assert.equal(h.state.log[0].opened_at,new Date(FRI_16).toISOString());assert.equal(h.state.log[1].opened_at,null);
 assert.deepEqual(await (await h.user('opened',{kind:'next_week',ref_key:'w2026-11-09'})).json(),{ok:true,opened:0});
 for(const bad of [{},{kind:'next_week'},{kind:'calendar',ref_key:'x'},{kind:'next_week',ref_key:'a b'},{kind:'next_week',ref_key:'x'.repeat(81)},
   {kind:'next_week',ref_key:'w1',workspace_id:WS2},{kind:1,ref_key:'w1'}]){
  const r=await h.user('opened',bad);assert.equal(r.status,400,JSON.stringify(bad));
 }
 // 남의 작업공간 id를 보내도 서버가 정한 자기 작업공간만 고친다.
 const s=harness({log:[row({kind:'next_week',ref_key:'w2026-11-09',day:'2026-11-06'})]});
 assert.deepEqual(await (await s.user('opened',{kind:'next_week',ref_key:'w2026-11-09'},JWT_STRANGER)).json(),{ok:true,opened:0});
 assert.equal(s.state.log[0].opened_at,null);
});

test('recent: last 7 days, sent or shown only, newest first, kind/ref/time/open only',async()=>{
 const h=harness({log:[
  row({kind:'test',ref_key:'t1',day:'2026-11-06',sent_at:'2026-11-06T06:00:00.000Z'}),
  row({kind:'next_week',ref_key:'w2026-11-09',day:'2026-11-06',status:'shown',shown_at:'2026-11-06T06:10:00Z',opened_at:'2026-11-06T06:11:00Z',sent_at:'2026-11-06T06:10:00.000Z'}),
  row({kind:'task_due',ref_key:'task-1',day:'2026-11-06',status:'held_quiet',sent_at:'2026-11-06T05:00:00.000Z'}),
  row({kind:'morning',ref_key:'2026-11-05',day:'2026-11-05',status:'failed',sent_at:'2026-11-05T05:00:00.000Z'}),
  row({kind:'evening',ref_key:'2026-10-28',day:'2026-10-28',sent_at:'2026-10-28T09:00:00.000Z'}),
  row({workspace_id:WS2,kind:'test',ref_key:'t9',day:'2026-11-06',sent_at:'2026-11-06T06:30:00.000Z'}),
 ]});
 const out=await (await h.user('recent')).json();
 assert.deepEqual(out,{ok:true,items:[
  {kind:'next_week',ref_key:'w2026-11-09',at:'2026-11-06T06:10:00.000Z',opened:true,pushed:false,open:'/work/app/?view=home&mode=week&notice=next_week.w2026-11-09'},
  {kind:'test',ref_key:'t1',at:'2026-11-06T06:00:00.000Z',opened:false,pushed:true,open:'/work/app/?view=profile&notice=test.t1'},
 ]});
 const call=h.state.calls.find(c=>c.table==='app_push_log');
 assert.match(call.query,/sent_at=gte\.2026-10-30T07:00:00\.000Z/);assert.match(call.query,/limit=50/);
 assert.equal((await h.user('recent',{workspace_id:WS2})).status,400);
});

test('new actions keep the user entrance: login required, owner only, no cron key',async()=>{
 const h=harness();
 for(const a of ['notices','opened','recent']){
  const r=await h.user(a,a==='opened'?{kind:'next_week',ref_key:'w1'}:{},'synthetic.user.jwt-unknown-00');
  assert.equal(r.status,401,a);
 }
 const handler=H.createPhonePushHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,PHONE_PUSH_CRON_SECRET:'synthetic-phone-push-cron-secret-0123456789'})[n],fetch:async()=>{throw new Error('no call')},now:()=>FRI_16,log:()=>{}});
 for(const a of ['notices','opened','recent']){
  const r=await handler(new Request(`${FN}?action=${a}`,{method:'POST',headers:{'x-phone-push-cron-secret':'synthetic-phone-push-cron-secret-0123456789'},body:'{}'}));
  assert.equal(r.status,400,a);
 }
});

test('source: done-items is the one list; handler logs no notice content; docs list the new actions',()=>{
 const handler=readFileSync(new URL('../../supabase/functions/phone-push/handler.ts',import.meta.url),'utf8');
 const done=readFileSync(new URL('../../supabase/functions/phone-push/done-items.ts',import.meta.url),'utf8');
 assert.match(handler,/from "\.\/done-items\.ts"/);
 assert.doesNotMatch(handler,/app_journal_next_week_sheets/,'materials are read only in done-items.ts');
 assert.doesNotMatch(done,/console\.|title|body/);
 const doc=readFileSync(new URL('../../docs/web2-env6b-edge-source.md',import.meta.url),'utf8');
 assert.match(doc,/`notices`·`opened`·`recent`/);
});

// S48-19 회의 요약 끝남: 전사 작업이 끝났는데 아직 회의에 붙지 않은 것(지난 하루) → 그 서울 날짜 한 줄.
const job=o=>({workspace_id:WS,status:'done',meeting_id:null,trashed_at:null,finished_at:'2026-11-06T06:40:00.000Z',...o});
test('done-items: meeting done item from the latest finished time, one per Seoul day, only within a day',()=>{
 assert.deepEqual(D.meetingDoneItem([{finished_at:'2026-11-06T06:40:00.000Z'}],FRI_16),{kind:'meeting_done',ref_key:'d2026-11-06',day:'2026-11-06',open:'/work/app/?view=reports&notice=meeting_done.d2026-11-06'});
 // 서울 날짜: 11/05 15:30Z = 11/06 00:30 서울.
 assert.equal(D.meetingDoneItem([{finished_at:'2026-11-05T15:30:00.000Z'}],FRI_16).ref_key,'d2026-11-06');
 for(const bad of [null,[],[{}],[{finished_at:1}],[{finished_at:'x'}],[{finished_at:'2026-11-05T06:59:00.000Z'}],[{finished_at:'2026-11-06T08:00:00.000Z'}]])
  assert.equal(D.meetingDoneItem(bad,FRI_14+2*3600000),null,JSON.stringify(bad));
});

test('notices: a finished recording not yet put into a meeting shows one meeting line; attached, failed, trashed, old or other workspace do not',async()=>{
 const h=harness({now:MON,jobs:[job({finished_at:'2026-11-09T00:20:00.000Z'}),job({finished_at:'2026-11-09T00:10:00.000Z'}),
  job({finished_at:'2026-11-09T00:50:00.000Z',meeting_id:'c0000000-0000-4000-8000-000000000001'}),job({finished_at:'2026-11-09T00:55:00.000Z',status:'failed'}),
  job({finished_at:'2026-11-09T00:56:00.000Z',trashed_at:'2026-11-09T00:57:00.000Z'}),job({workspace_id:WS2,finished_at:'2026-11-09T00:58:00.000Z'})]});
 const out=await (await h.user('notices')).json();
 assert.deepEqual(out,{ok:true,items:[{kind:'meeting_done',ref_key:'d2026-11-09',open:'/work/app/?view=reports&notice=meeting_done.d2026-11-09'}]});
 assert.equal(h.state.log.length,1);assert.equal(h.state.log[0].kind,'meeting_done');assert.equal(h.state.log[0].day,'2026-11-09');assert.equal(h.state.log[0].status,'shown');
 // 같은 날 두 번째 부름·다른 구간: 한 줄 그대로. 열면(✕ 포함) 그날은 다시 안 뜬다.
 assert.equal((await (await h.user('notices')).json()).items.length,1);assert.equal(h.state.log.length,1);
 assert.deepEqual(await (await h.user('opened',{kind:'meeting_done',ref_key:'d2026-11-09'})).json(),{ok:true,opened:1});
 assert.deepEqual((await (await h.user('notices')).json()).items,[]);
 // 응답·기록에 파일 이름·회의 제목·전사 글 없음, 읽은 칸은 끝난 시각뿐.
 assert.doesNotMatch(JSON.stringify(h.state.log),/title|file|transcript|회의/);
 assert.ok(h.state.calls.filter(c=>c.table==='app_meeting_transcribe_jobs').every(c=>c.auth===`Bearer ${JWT_OK}`&&c.apikey===ANON&&/workspace_id=eq\.a0000000-0000-4000-8000-000000000001/.test(c.query)));
});

test('notices: next week and meeting lines together; no meeting line when nothing finished, the read fails, or it is older than a day',async()=>{
 const both=await (await harness({jobs:[job({})]}).user('notices')).json();
 assert.deepEqual(both.items.map(i=>i.kind),['next_week','meeting_done']);
 for(const h of [harness({now:MON}),harness({now:MON,jobFail:true,jobs:[job({finished_at:'2026-11-09T00:20:00.000Z'})]}),harness({now:MON,jobs:[job({finished_at:'2026-11-07T23:00:00.000Z'})]})]){
  const r=await h.user('notices');assert.equal(r.status,200);assert.deepEqual((await r.json()).items,[]);assert.equal(h.state.log.length,0);
 }
});

test('notices: the stranger only sees their own workspace recordings',async()=>{
 const h=harness({now:MON,jobs:[job({finished_at:'2026-11-09T00:20:00.000Z'})]});
 assert.deepEqual((await (await h.user('notices',{},JWT_STRANGER)).json()).items,[]);
});
