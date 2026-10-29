import test from 'node:test';
import assert from 'node:assert/strict';

// JOURNAL-챙길것 1단계 / AI-서버연동 S5: the screen side (app/todo-radar-data.js). Synthetic IDs and text only.
const mod=await import('../app/todo-radar-data.js');
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(over={})=>({id:id(1),kind:'request',summary:'A 사업장 자료 회신.',due:null,source_kind:'basket',source_id:id(2),source_day:'2026-10-21',evidence:'근거',project_id:null,organization_id:null,status:'open',task_id:null,created_at:'2026-10-21T01:00:00Z',decided_at:null,...over});
function fakeRt({api,epoch=1}={}){
  const calls=[];
  return {calls,rt:{config:{url:'https://fixture.invalid',key:'anon-fixture'},context:{read:()=>({user:{id:'u'},workspace:{id:'w'}})},
    session:{ensure:async()=>true,read:()=>({access_token:'token-fixture'}),epoch:()=>epoch},
    api:async(path,opts={})=>{calls.push({path,opts});return api(path,opts);}}};
}
const reply=(status,body)=>async()=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('findTodos sends only {kind,mode} with the signed-in token, and reads counts and promises',async()=>{
  const seen=[];const {rt}=fakeRt();
  const promise={summary:'상대 측 자료 송부.',due:null,evidence:'보내기로 함',source_kind:'meeting',source_id:id(3),source_day:'2026-10-20'};
  const r=await mod.findTodos('again',{rt,online:()=>true,fetcher:async(url,init)=>{seen.push({url,init});return new Response(JSON.stringify({ok:true,kind:'todo_radar',added:2,found:2,partial:true,checked_at:'x',promises:[promise,{summary:'<bad>',source_kind:'x'}]}));}});
  assert.deepEqual(r,{ok:true,skipped:false,added:2,checkedAt:null,partial:true,promises:[promise]});
  assert.equal(seen[0].url,'https://fixture.invalid/functions/v1/ai-assist');
  assert.deepEqual(JSON.parse(seen[0].init.body),{kind:'todo_radar',mode:'again'});
  assert.equal(seen[0].init.headers.Authorization,'Bearer token-fixture');
  assert.equal((await mod.findTodos('now',{rt})).code,'invalid_request');
});

test('findTodos: skipped, not deployed, limits and odd answers map to plain words',async()=>{
  const {rt}=fakeRt();const ask=(f,opts={})=>mod.findTodos('auto',{rt,online:()=>true,fetcher:f,...opts});
  assert.deepEqual(await ask(reply(200,{ok:true,kind:'todo_radar',skipped:true,checked_at:'2026-10-21T01:00:00Z',partial:true})),{ok:true,skipped:true,checkedAt:'2026-10-21T01:00:00Z',partial:true});
  const missing=await ask(reply(404,{code:'NOT_FOUND'}));assert.equal(missing.code,'not_ready');assert.match(missing.message,/준비 중/);
  assert.equal((await ask(async()=>{throw new TypeError('Failed to fetch');})).code,'not_ready');
  assert.match((await ask(reply(429,{ok:false,error:'daily_limit'}))).message,/횟수/);
  assert.match((await ask(reply(409,{ok:false,error:'in_progress'}))).message,/찾는 중/);
  assert.equal((await ask(reply(200,{ok:true,kind:'link_summary',summary:'x'}))).code,'ai_invalid_response');
  assert.equal((await ask(reply(200,{ok:true,kind:'todo_radar',added:-1,promises:[]}))).code,'ai_invalid_response');
  const odd=await ask(reply(400,{ok:false,error:'__proto__',message:'<b>원문</b>'}));assert.equal(odd.code,'internal_error');assert.doesNotMatch(odd.message,/원문/);
});

test('reads use owner workspace, only open rows on home, and hide quietly when the table is missing',async()=>{
  const {rt,calls}=fakeRt({api:async()=>[row(),{...row(),id:'x'},row({id:id(9),kind:'promise'})]});
  const open=await mod.readOpenCandidates(rt);
  assert.deepEqual(open.rows.map(r=>r.id),[id(1)],'malformed rows are skipped, never rendered raw');
  assert.match(calls[0].path,/^\/rest\/v1\/app_todo_candidates\?workspace_id=eq\.w&status=eq\.open&/);
  const week=await mod.readWeekCandidates('2026-10-19','2026-10-25',rt);assert.equal(week.ok,true);
  assert.match(calls[1].path,/source_day=gte\.2026-10-19&source_day=lte\.2026-10-25/);
  const err=Object.assign(new Error('Could not find the table public.app_todo_candidates in the schema cache'),{status:404});
  const {rt:gone}=fakeRt({api:async()=>{throw err;}});
  assert.deepEqual(await mod.readOpenCandidates(gone),{missing:true});
  const {rt:down}=fakeRt({api:async()=>{throw Object.assign(new Error('x'),{status:500});}});
  assert.deepEqual(await mod.readOpenCandidates(down),{ok:false});
});

test('[무시] and [되돌리기] are guarded by the current status',async()=>{
  const {rt,calls}=fakeRt({api:async(path,opts)=>[{id:id(1),status:opts.body.status}]});
  assert.equal(await mod.dismissCandidate(id(1),rt,new Date('2026-10-21T02:00:00Z')),true);
  assert.match(calls[0].path,/id=eq\.c0000000-0000-4000-8000-000000000001&workspace_id=eq\.w&status=eq\.open/);
  assert.deepEqual(calls[0].opts.body,{status:'dismissed',decided_at:'2026-10-21T02:00:00.000Z'});
  assert.equal(await mod.reopenCandidate(id(1),rt),true);
  assert.match(calls[1].path,/status=eq\.dismissed/);assert.deepEqual(calls[1].opts.body,{status:'open',decided_at:null});
  const {rt:none}=fakeRt({api:async()=>[]});assert.equal(await mod.dismissCandidate(id(1),none),false,'already handled elsewhere');
});

test('[할 일로] uses the existing Google task create once, links the source place, then marks the candidate',async()=>{
  const c=row({source_kind:'meeting',source_id:id(5),project_id:id(6),organization_id:id(7)});
  const {rt,calls}=fakeRt({api:async(path,opts)=>path.includes('google-tasks')?{ok:true,task:{id:'g1',taskListId:'@default',title:opts.body.title}}:[{id:c.id,status:'tasked'}]});
  const r=await mod.candidateToTask(c,{title:'  자료 회신  ',due:'2026-10-24'},{rt});
  assert.equal(r.status,'done');assert.equal(r.task.id,'g1');
  assert.equal(calls[0].path,'/functions/v1/google-tasks?action=create');
  assert.deepEqual(calls[0].opts.body,{action:'create',task_id:null,title:'자료 회신',notes:'',due:'2026-10-24',links:[{project_id:id(6)},{organization_id:id(7)},{meeting_id:id(5)}]});
  assert.equal(calls[0].opts.expectedSessionEpoch,1);
  assert.match(calls[1].path,/status=eq\.open/);assert.equal(calls[1].opts.body.status,'tasked');assert.equal(calls[1].opts.body.task_id,'g1');
  assert.equal(calls.length,2,'a meeting source writes nothing else');
});

test('[할 일로] from an update also lists the task on that update (existing metadata.tasks path)',async()=>{
  const c=row();
  const {rt,calls}=fakeRt({api:async(path,opts)=>{
    if(path.includes('google-tasks'))return {ok:true,task:{id:'g2',taskListId:'@default',title:'자료 회신'}};
    if(path.includes('app_todo_candidates'))return [{id:c.id,status:'tasked'}];
    if(opts.method==='PATCH')return [{id:c.source_id,updated_at:'u',metadata:opts.body.metadata}];
    return [{id:c.source_id,updated_at:'u',metadata:{}}];
  }});
  const r=await mod.candidateToTask(c,{title:'자료 회신',due:''},{rt});
  assert.equal(r.status,'done');assert.equal(r.recorded,true);
  assert.ok(calls.some(x=>x.path.startsWith('/rest/v1/app_notes?id=eq.'+c.source_id)&&x.opts.method==='PATCH'));
});

test('[할 일로] never creates twice: lost answer is unknown, server refusal is failed, mark failure is reported',async()=>{
  const c=row({source_kind:'note'});
  {const {rt,calls}=fakeRt({api:async()=>{throw new TypeError('network');}});
   assert.equal((await mod.candidateToTask(c,{title:'x'},{rt})).status,'unknown');assert.equal(calls.length,1);}
  {const {rt}=fakeRt({api:async()=>{throw Object.assign(new Error('x'),{status:401});}});
   const r=await mod.candidateToTask(c,{title:'x'},{rt});assert.equal(r.status,'failed');assert.equal(r.code,'session_required');}
  {const {rt}=fakeRt({api:async path=>path.includes('google-tasks')?{ok:true,task:{id:'g3'}}:[]});
   const r=await mod.candidateToTask(c,{title:'x'},{rt});assert.equal(r.status,'marked_failed');assert.equal(r.task.id,'g3');}
});

test('draft check, decision 5 title filter, and the ledger text for a counterpart promise',()=>{
  assert.equal(mod.validateTaskDraft({title:' '}),'할 일 제목을 써 주세요.');
  assert.match(mod.validateTaskDraft({title:'가'.repeat(201)}),/200자/);
  assert.match(mod.validateTaskDraft({title:'a',due:'10/24'}),/기한/);
  assert.equal(mod.validateTaskDraft({title:'a',due:'2026-10-24'}),'');
  const rows=[row({id:id(1),summary:'A 사업장 자료 회신.'}),row({id:id(2),summary:'B 회의 참석'})];
  assert.deepEqual(mod.notPlanned(rows,['a 사업장  자료회신','다른 일']).map(r=>r.id),[id(2)]);
  const text=mod.ledgerRequestText({summary:'상대 측 자료 송부.',due:'2026-10-28',evidence:'보내기로 함',source_kind:'meeting',source_day:'2026-10-20'});
  assert.match(text,/^쓰기요청\n/);assert.match(text,/약속\(상대·제3자\)/);assert.match(text,/사업 보고 2026-10-20/);
  assert.doesNotMatch(text,/[0-9a-f]{8}-[0-9a-f]{4}/,'no internal ids in the copied text');
});

test('JOURNAL-챙길것화면: home read (open + handled since), ✓ due rule, ✎ due choices, short date',async()=>{
  const {rt,calls}=fakeRt({api:async()=>[row(),row({id:id(3),status:'dismissed',decided_at:'2026-10-21T01:00:00Z'})]});
  const r=await mod.readHomeCandidates('2026-10-20T15:00:00.000Z',rt);
  assert.equal(r.ok,true);assert.equal(r.rows.length,2);
  assert.match(calls[0].path,/^\/rest\/v1\/app_todo_candidates\?workspace_id=eq\.w&or=/);
  assert.equal(decodeURIComponent(calls[0].path.match(/&or=([^&]+)/)[1]),'(status.eq.open,decided_at.gte."2026-10-20T15:00:00.000Z")');
  assert.deepEqual(await mod.readHomeCandidates('not a date',rt),{ok:false});
  assert.equal(mod.HOME_ROWS,4);
  assert.equal(mod.quickDue(row({due:'2026-10-23'}),'2026-10-21'),'2026-10-23');
  assert.equal(mod.quickDue(row({due:null}),'2026-10-21'),'2026-10-21');
  assert.deepEqual(mod.dueChoices(row({due:'2026-10-23'}),'2026-10-21','2026-10-22').map(o=>[o.key,o.label,o.due]),
    [['today','오늘','2026-10-21'],['tomorrow','내일','2026-10-22'],['suggested','제안 기한 10.23','2026-10-23'],['none','기한 없음','']]);
  assert.deepEqual(mod.dueChoices(row(),'2026-10-21','2026-10-22').map(o=>o.key),['today','tomorrow','none']);
  assert.equal(mod.dotDay('2026-10-09'),'10.9');assert.equal(mod.dotDay('2026-10-23T00:00:00.000Z'),'10.23');assert.equal(mod.dotDay(''),'');
});

// MTG-후속할일후보: 사업 보고 하나 뽑기(screen side). Synthetic IDs only.
test('findMeetingTodos sends only {kind,mode,meeting_id} and reads the added count',async()=>{
  const seen=[];const {rt}=fakeRt();
  const meeting=id(40).toUpperCase().replace(/-/g,m=>m);
  const r=await mod.findMeetingTodos(meeting,{rt,online:()=>true,fetcher:async(url,init)=>{seen.push({url,init});return new Response(JSON.stringify({ok:true,kind:'todo_radar',added:2,found:2,partial:false,checked_at:null,promises:[]}),{status:200});}});
  assert.deepEqual(r,{ok:true,added:2});
  assert.deepEqual(JSON.parse(seen[0].init.body),{kind:'todo_radar',mode:'meeting',meeting_id:id(40)});
  assert.equal(seen[0].init.headers.Authorization,'Bearer token-fixture');
  for(const bad of ['',null,'x',id(40)+'x'])assert.equal((await mod.findMeetingTodos(bad,{rt})).code,'invalid_request');
});

test('findMeetingTodos: limits, a missing meeting and odd answers map to plain words',async()=>{
  const {rt}=fakeRt();const ask=f=>mod.findMeetingTodos(id(40),{rt,online:()=>true,fetcher:f});
  assert.match((await ask(reply(429,{ok:false,error:'daily_limit'}))).message,/횟수/);
  assert.match((await ask(reply(404,{ok:false,error:'not_found'}))).message,/찾거나 열 수 없어요/);
  assert.match((await ask(reply(409,{ok:false,error:'in_progress'}))).message,/찾는 중/);
  assert.equal((await ask(reply(200,{ok:true,kind:'todo_radar',added:-1}))).code,'ai_invalid_response');
  assert.equal((await ask(reply(200,{ok:true,kind:'todo_radar',added:'2'}))).code,'ai_invalid_response');
  assert.equal((await ask(async()=>{throw new TypeError('Failed to fetch');})).code,'not_ready');
});

test('readMeetingCandidates reads only that meeting\'s rows from the same table; no meeting id reads nothing; a missing table hides quietly',async()=>{
  const {rt,calls}=fakeRt({api:async()=>[row({source_kind:'meeting',source_id:id(40)}),{...row(),id:'x'}]});
  const r=await mod.readMeetingCandidates(id(40).toUpperCase(),rt);
  assert.equal(r.ok,true);assert.equal(r.rows.length,1);
  assert.match(calls[0].path,/\/rest\/v1\/app_todo_candidates\?workspace_id=eq\.w&source_kind=eq\.meeting&source_id=eq\./);
  assert.ok(calls[0].path.includes('source_id=eq.'+id(40)),'lower-case id');
  const none=fakeRt({api:async()=>{throw new Error('must not read');}});
  assert.deepEqual(await mod.readMeetingCandidates('',none.rt),{ok:true,rows:[]});assert.equal(none.calls.length,0);
  const missing=fakeRt({api:async()=>{const e=new Error('relation does not exist');e.status=404;throw e;}});
  assert.deepEqual(await mod.readMeetingCandidates(id(40),missing.rt),{missing:true});
});

test('the 사업 보고 window uses the 정리함 list part and the existing task path; nothing is kept in the browser',async()=>{
  const {readFile}=await import('node:fs/promises');
  const read=name=>readFile(new URL(`../app/${name}`,import.meta.url),'utf8');
  const [box,inbox,detail,css]=await Promise.all([read('meeting-todo-candidates.js'),read('inbox-todos.js'),read('meeting-round-detail.js'),read('meeting-ui.css')]);
  assert.match(box,/mountInboxTodos\(host,/);assert.match(box,/findMeetingTodos\(id\)/);
  // [할 일로] is the inbox's own: the one Google task create path, then the row is marked.
  assert.match(inbox,/candidateToTask\(c, draft\)/);assert.doesNotMatch(box,/createGoogleTask|candidateToTask|app_todo_candidates/);
  // The button never creates a task: it only asks the server for candidates, then tells the lists to read again.
  assert.match(box,/kptu:todo-radar-changed/);
  assert.match(detail,/id="mrdMakeTodos"/);assert.match(detail,/mountMeetingTodos\(/);assert.match(detail,/mrdTodos\?\.open\(\)/);assert.match(detail,/mrdTodos\?\.close\(\)/);
  assert.match(css,/\.mrd-make-todos\{/);
  const store=['local','Storage'].join(''),session=['session','Storage'].join(''),idb=['indexed','DB'].join('');
  for(const text of [box,inbox])assert.doesNotMatch(text,new RegExp([store,session,idb].join('|')));
  assert.doesNotMatch(css.slice(css.indexOf('MTG-후속할일후보')),/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
});

test('task_due: the handled row keeps the due it was put in with (saved on the candidate, null = no due)',async()=>{
  // reads ask for the column and keep a well-formed date; a malformed one is skipped, never rendered raw
  const {rt,calls}=fakeRt({api:async()=>[row({status:'tasked',task_id:'g1',decided_at:'2026-10-27T01:00:00Z',task_due:'2026-10-30'}),row({id:id(8),task_due:'abc'}),row({id:id(9)})]});
  const read=await mod.readOpenCandidates(rt);
  assert.match(calls[0].path,/select=[^&]*,task_id,task_due,created_at/);
  assert.deepEqual(read.rows.map(r=>[r.id,r.task_due]),[[id(1),'2026-10-30'],[id(9),undefined]]);
  // [할 일로] with a due writes it with the mark, in the same PATCH
  {const {rt:w,calls:c}=fakeRt({api:async path=>path.includes('google-tasks')?{ok:true,task:{id:'g1'}}:[{id:id(1),status:'tasked'}]});
   assert.equal((await mod.candidateToTask(row({source_kind:'note'}),{title:'x',due:'2026-10-24'},{rt:w,now:()=>new Date('2026-10-27T01:00:00Z')})).status,'done');
   const patch=c.find(x=>x.path.includes('app_todo_candidates'));
   assert.deepEqual(patch.opts.body,{status:'tasked',task_id:'g1',decided_at:'2026-10-27T01:00:00.000Z',task_due:'2026-10-24'});}
  // no due (or a malformed one) writes null, so a tasked row never holds a bad date
  {const {rt:w,calls:c}=fakeRt({api:async path=>path.includes('google-tasks')?{ok:true,task:{id:'g2'}}:[{id:id(1),status:'tasked'}]});
   await mod.candidateToTask(row({source_kind:'note'}),{title:'x',due:''},{rt:w});
   assert.equal(c.find(x=>x.path.includes('app_todo_candidates')).opts.body.task_due,null);}
  {const {rt:w,calls:c}=fakeRt({api:async()=>[{id:id(1),status:'tasked'}]});
   assert.equal(await mod.markTasked(id(1),'g3',w,new Date('2026-10-27T01:00:00Z'),'내일'),true);
   assert.equal(c[0].opts.body.task_due,null);
   await mod.markTasked(id(1),'g3',w,new Date('2026-10-27T01:00:00Z'),'2026-10-31');assert.equal(c[1].opts.body.task_due,'2026-10-31');}
});

test('task_due: both lists read the saved due first and keep it when marking again',async()=>{
  const {readFile}=await import('node:fs/promises');
  const read=name=>readFile(new URL(`../app/${name}`,import.meta.url),'utf8');
  const [radar,inbox]=await Promise.all([read('todo-radar.js'),read('inbox-todos.js')]);
  assert.match(radar,/function taskedDue\(c\) \{\n    if \(c\.task_due\) return c\.task_due;/);
  assert.match(inbox,/const due = c\.task_due \? dotDay\(c\.task_due\)/);
  // a failed mark keeps the chosen due for the retry, and a successful one fills the row at once
  assert.match(radar,/markTasked\(c\.id, taskId, rt, new Date\(\), shared\.dueOf\.get\(c\.id\) \|\| null\)/);
  assert.match(inbox,/markTasked\(c\.id, taskId, rt, new Date\(\), dues\.get\(c\.id\) \|\| null\)/);
  assert.match(radar,/c\.task_due = draft\.due \|\| null/);assert.match(inbox,/c\.task_due = draft\.due \|\| null/);
});

test('FEAT-1029 ⑤ telegram candidates: one feed read adds the room; a failed read keeps the rows; source words',async()=>{
  const tgRow=row({id:id(20),source_kind:'telegram',source_id:id(21),summary:'가상 자료 보내기'});
  const {rt,calls}=fakeRt({api:async path=>path.includes('app_feed_items')
    ?[{id:id(21),room_key:'-100123',room_label:' 가상 간부방 '},{id:id(99),room_key:'bad key!',room_label:'x'}]
    :[row(),tgRow]});
  const r=await mod.readOpenCandidates(rt);
  assert.equal(r.ok,true);assert.equal(r.rows.length,2);
  assert.deepEqual(r.rows[1].tg,{room_key:'-100123',room_label:'가상 간부방'});
  assert.equal(r.rows[0].tg,undefined);
  const feed=calls.find(c=>c.path.includes('app_feed_items')).path;
  assert.match(feed,/workspace_id=eq\.w&source=eq\.telegram&id=in\.\(c0000000-0000-4000-8000-000000000021\)&select=id,room_key,room_label/);
  assert.equal(mod.sourceText(r.rows[1]),'텔레그램 · 가상 간부방');
  assert.equal(mod.sourceText(r.rows[0]),'업데이트');
  assert.equal(mod.sourceText({source_kind:'telegram'}),'텔레그램');
  assert.equal(mod.validCandidate(tgRow),true);
  // no telegram row → no feed read
  const plain=fakeRt({api:async()=>[row()]});await mod.readHomeCandidates('2026-10-21T00:00:00Z',plain.rt);
  assert.ok(!plain.calls.some(c=>c.path.includes('app_feed_items')));
  // the feed read failing leaves the candidates as they are
  const failing=fakeRt({api:async path=>{if(path.includes('app_feed_items'))throw Object.assign(new Error('x'),{status:500});return [{...tgRow,tg:undefined}];}});
  const w=await mod.readWeekCandidates('2026-10-19','2026-10-25',failing.rt);
  assert.equal(w.ok,true);assert.equal(w.rows.length,1);assert.equal(mod.sourceText(w.rows[0]),'텔레그램');
  const inbox=fakeRt({api:async path=>path.includes('app_feed_items')?[{id:id(21),room_key:'r1',room_label:'방'}]:[tgRow]});
  const ib=await mod.readInboxCandidates(inbox.rt);
  assert.ok(ib.rows.every(x=>x.tg?.room_key==='r1'));
});
