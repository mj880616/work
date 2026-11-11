// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real meeting, file or account names).
// S58-11 REC-한회의로잇기 PR-1(20261111142100_meeting_join_jobs): 잇기 작업 표 + 서버 전용 함수 2개.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예·기존 표 해시 그대로.
// - 표: 그 작업공간 owner만 읽음(다른 작업공간 0줄, anon 거절, 화면은 쓰기 못 함). service_role은 정한 칸만 넣고 고침, 지우기 없음.
// - 함수: anon·authenticated는 실행 못 함. service_role이 불러도 함수가 owner·작업공간·휴지통·[회의] 칸·글 그대로인지를 다시 본다.
// - apply: 녹음 잇기(자료 행을 DB 행에서 직접 만듦)·보고 합치기(자료·할 일 연결 옮기고 없어지는 보고는 휴지통). 어긋나면 보고는 그대로.
// - undo: before/joined는 회의 결과만 오가고 사람이 고친 글은 보관, all은 통째로(조건이 어긋나면 거절).
// - 되돌리기(SQL Editor 전용)는 진행 중 작업이 있으면 멈추고, 없으면 함수 둘·표·기록을 지우고 다시 적용할 수 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261111142100',name='meeting_join_jobs',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const sha=text=>createHash('sha256').update(text??'','utf8').digest('hex');
const uuid=n=>`26000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// 가상 보고: T(이을 보고)·S(없어질 보고)·T2·OTHER(다른 작업공간)·ORGK([회의]가 아닌 칸)
const T=uuid(1),S=uuid(2),T2=uuid(3),OTHER=uuid(4),ORGK=uuid(5),T3=uuid(6);
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  alter table public.app_meetings add column project_id uuid, add column transcript_text text, add column notes text,
    add column activity_kind text not null default 'meeting', add column deleted_at timestamptz,
    add column updated_at timestamptz not null default '2026-01-01T00:00:00Z';
  alter table public.app_meetings enable row level security;
  create policy task12a_owner_all on public.app_meetings for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create table public.app_documents(id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.app_workspaces(id), project_id uuid,
    meeting_id uuid references public.app_meetings(id) on delete set null, title text not null, category text, source text,
    document_date date, description text, tags text[] default '{}', drive_url text, file_id text, file_name text, mime_type text,
    file_size bigint, visibility text not null default 'private', uploaded_by uuid, auto_classified boolean default false);
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  create table public.app_record_links(id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.app_workspaces(id), google_task_id text, google_tasklist_id text, note_id uuid,
    meeting_id uuid references public.app_meetings(id) on delete cascade,
    constraint app_record_links_unique unique nulls not distinct (google_task_id, note_id, meeting_id));
  alter table public.app_record_links enable row level security;
  create policy record_links_owner_all on public.app_record_links for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_meetings, public.app_documents, public.app_record_links from anon, service_role;`;
const BEFORE=['20261029071500_meeting_transcribe_jobs','20261029200000_meeting_recordings','20261103170000_meeting_server_jobs','20261111010000_meeting_server_job_fail_log'];

test('meeting join jobs: owner read only, service role limited columns, definer apply/undo re-check everything, rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'meeting-join-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1']});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  for(const f of BEFORE)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),anon=fn=>as('anon','',fn),service=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);};
  const one=async(sql,params=[])=>(await pool.query(sql,params)).rows[0];
  const meeting=id=>one('select title,transcript_text,notes,deleted_at,activity_kind,project_id,updated_at from public.app_meetings where id=$1',[id]);
  const jobRow=id=>one('select * from public.app_meeting_join_jobs where id=$1',[id]);
  // Edge가 하는 대로 service_role로 넣는다(정한 칸만). 요약이 끝난 것처럼 result_text는 고치기로 채운다.
  const ins=(c,j)=>c.query(`insert into public.app_meeting_join_jobs(${Object.keys(j).join(',')}) values(${Object.keys(j).map((_,i)=>'$'+(i+1)).join(',')}) returning id`,Object.values(j)).then(r=>r.rows[0].id);
  const ready=async(o,result='새 요약 글')=>{const id=await service(c=>ins(c,{workspace_id:WS_A,created_by:OWNER,status:'running',stage:'apply',...o}));
   if(result!==null)await service(c=>c.query('update public.app_meeting_join_jobs set result_text=$2 where id=$1',[id,result]));return id;};
  const apply=id=>service(c=>c.query('select public.app_meeting_join_apply($1) as r',[id])).then(r=>r.rows[0].r);
  const undo=(id,scope)=>service(c=>c.query('select public.app_meeting_join_undo($1,$2) as r',[id,scope])).then(r=>r.rows[0].r);
  const recordJob=(ws,o={})=>one(`insert into public.app_meeting_transcribe_jobs(workspace_id,created_by,status,drive_file_id,file_name,mime_type,size_bytes,meeting_id,trashed_at)
    values($1,$2,$3,$4,$5,'audio/ogg',1234,$6,$7) returning id`,[ws,ws===WS_A?OWNER:STRANGER,o.status??'done',o.file??'driveFile_0001',o.name??' 가상 녹음 .ogg',o.meeting??null,o.trashed??null]).then(r=>r.id);
  const serverJob=(ws,o={})=>one(`insert into public.app_meeting_server_jobs(workspace_id,created_by,kind,session_id,status,stage,meeting_id,opened_at)
    values($1,$2,'recording',gen_random_uuid(),$3,'done',$4,$5) returning id`,[ws,ws===WS_A?OWNER:STRANGER,o.status??'done',o.meeting??null,o.opened??null]).then(r=>r.id);
  let before;

  await t.test('files: expanded rules, pair files, summary three lines, no fixed ids, definer functions pinned',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['dry-run','apply']){const plan=prepareMigration({mode,version,runId:'1',root});assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
    assert.deepEqual(plan.review.definer,['public.app_meeting_join_apply','public.app_meeting_join_undo']);assert.deepEqual(plan.targets,[]);}
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
   assert.doesNotMatch(code,/disable row level security|\bto (anon|public)\b|rtw_|cron\.|create trigger|alter policy|drop policy/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; existing tables unchanged; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   await allYes(postcheck);
   before=(await pool.query(snapshot)).rows;
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const applied=await run('apply','9992');assert.equal(applied.ok,true,applied.summary);
   await allYes(postcheck);
   const after=values(await readOnly(postcheck));
   for(const item of ['existing tables RLS policies grants hash','existing tables column grants hash'])assert.equal(after[item],v[item],item);
   assert.equal((await run('apply','9993')).ok,false);
  });

  await pool.query(`insert into public.app_meetings(id,workspace_id,title,project_id,transcript_text,notes,activity_kind) values
    ($1,$7,'가상 회의 가',$9,'결과 가','전문 가','meeting'),($2,$7,'가상 회의 나',null,'결과 나','전문 나','meeting'),($3,$7,'가상 회의 다',null,null,'전문 다','meeting'),
    ($4,$8,'남의 회의',null,'남 결과','남 전문','meeting'),($5,$7,'가상 조직 보고',null,'결과 조','특이사항','organization'),($6,$7,'가상 회의 라',null,'결과 라','전문 라','meeting')`,
    [T,S,T2,OTHER,ORGK,T3,WS_A,WS_B,PROJECT_A]);

  await t.test('table: owner reads own rows only; stranger 0 rows; anon refused; screen cannot write; functions not callable by screen or anon',async()=>{
   const a=await service(c=>ins(c,{workspace_id:WS_A,created_by:OWNER,mode:'text',target_meeting_id:T3,source_text:'이을 글',before_result:'결과 라',before_notes:'전문 라'}));
   const b=await service(c=>ins(c,{workspace_id:WS_B,created_by:STRANGER,mode:'text',target_meeting_id:OTHER,source_text:'남의 글'}));
   assert.deepEqual((await owner(c=>c.query('select id,before_notes from public.app_meeting_join_jobs'))).rows,[{id:a,before_notes:'전문 라'}]);
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_meeting_join_jobs'))).rows,[{id:b}],'B sees only B');
   assert.deepEqual((await as('authenticated','',c=>c.query('select id from public.app_meeting_join_jobs'))).rows,[]);
   await assert.rejects(anon(c=>c.query('select id from public.app_meeting_join_jobs')),{code:'42501'});
   for(const sql of [`insert into public.app_meeting_join_jobs(workspace_id,created_by,mode,target_meeting_id) values('${WS_A}','${OWNER}','text','${T}')`,
     `update public.app_meeting_join_jobs set status='failed'`,`update public.app_meeting_join_jobs set before_result='x'`,`delete from public.app_meeting_join_jobs`])
    await assert.rejects(owner(c=>c.query(sql)),{code:'42501'},sql);
   for(const who of [owner,stranger,anon]){
    await assert.rejects(who(c=>c.query('select public.app_meeting_join_apply($1)',[a])),{code:'42501'});
    await assert.rejects(who(c=>c.query("select public.app_meeting_join_undo($1,'before')",[a])),{code:'42501'});
   }
   // 같은 보고에 진행 중은 하나. 실패로 바뀌면 다시 넣을 수 있다.
   await assert.rejects(service(c=>ins(c,{workspace_id:WS_A,created_by:OWNER,mode:'text',target_meeting_id:T3})),{code:'23505'});
   await service(c=>c.query("update public.app_meeting_join_jobs set status='failed',error_code='draft_failed',lease_until=null where id=$1",[a]));
   const again=await service(c=>ins(c,{workspace_id:WS_A,created_by:OWNER,mode:'text',target_meeting_id:T3}));
   for(const id of [again,b])await service(c=>c.query("update public.app_meeting_join_jobs set status='failed' where id=$1",[id]));
  });

  await t.test('service role: listed columns only, no delete; checks hold',async()=>{
   const a=(await one("select id from public.app_meeting_join_jobs where workspace_id=$1 limit 1",[WS_A])).id;
   await service(c=>c.query("update public.app_meeting_join_jobs set step_no=1,step_total=2,lease_until=now(),draft='{}'::jsonb,seen_at=now(),candidates_closed_at=now() where id=$1",[a]));
   for(const set of [`workspace_id='${WS_B}'`,`created_by='${STRANGER}'`,"mode='report'",`target_meeting_id='${T}'`,`source_meeting_id='${S}'`,'source_job_id=null',"source_text='x'",
     "source_record_jobs='{}'","source_result_sha=null","source_notes_sha=null","before_result='x'","before_notes='x'",'applied_at=now()',"moved='{}'::jsonb","kept_result='x'",'undone_at=now()','created_at=now()'])
    await assert.rejects(service(c=>c.query(`update public.app_meeting_join_jobs set ${set}`)),{code:'42501'},set);
   await assert.rejects(service(c=>c.query('delete from public.app_meeting_join_jobs')),{code:'42501'});
   for(const o of [{id:uuid(99)},{applied_at:new Date().toISOString()},{moved:'{}'},{kept_result:'x'},{undone_at:new Date().toISOString()}])
    await assert.rejects(service(c=>ins(c,{workspace_id:WS_A,created_by:OWNER,mode:'text',target_meeting_id:T2,...o})),{code:'42501'},Object.keys(o)[0]);
   for(const [o,label] of [[{mode:'merge'},'mode'],[{status:'bogus'},'status'],[{stage:'combine'},'stage'],[{source_result_sha:'ABC'},'sha'],[{source_meeting_id:T2},'target is the source'],
     [{source_record_jobs:Array.from({length:21},(_,i)=>uuid(500+i))},'21 record jobs'],[{transcript_text:'가'.repeat(1000001)},'long text'],[{summary_parts:'{}'},'parts shape']])
    await assert.rejects(service(c=>ins(c,{workspace_id:WS_A,created_by:OWNER,mode:'text',target_meeting_id:T2,...o})),{code:'23514'},label);
   await assert.rejects(service(c=>c.query("update public.app_meeting_join_jobs set error_code='Has Caps' where id=$1",[a])),{code:'23514'});
  });

  await t.test('apply (recording join): waits for its turn, re-checks the report, builds the file row itself, applies once',async()=>{
   const rec=await recordJob(WS_A),sj=await serverJob(WS_A);
   const base={mode:'job',target_meeting_id:T,source_job_id:sj,source_record_jobs:[rec],before_result:'결과 가',before_notes:'전문 가',transcript_text:'전문 가\n― 이어서 ―\n새 전문',summary_parts:'[{"n":1}]'};
   // 차례가 아니면(요약 단계·넣을 글 없음) 아무것도 안 한다.
   const early=await service(c=>ins(c,{workspace_id:WS_A,created_by:OWNER,...base,status:'running',stage:'summary'}));
   assert.deepEqual(await apply(early),{applied:false,found:true,status:'running',stage:'summary',applied_at:null});
   assert.equal((await apply(uuid(404))).found,false);
   await service(c=>c.query("update public.app_meeting_join_jobs set stage='apply' where id=$1",[early]));
   assert.equal((await apply(early)).applied,false,'no result text yet');
   assert.equal((await meeting(T)).transcript_text,'결과 가');
   await service(c=>c.query("update public.app_meeting_join_jobs set result_text='새 요약 글' where id=$1",[early]));
   const j=early;
   // 그 사이 사람이 보고를 고쳤으면 잇지 않는다(보고·작업 행 그대로).
   await pool.query("update public.app_meetings set notes='사람이 고친 전문' where id=$1",[T]);
   await assert.rejects(apply(j),/JOIN_REPORT_CHANGED/);
   assert.equal((await meeting(T)).notes,'사람이 고친 전문');assert.equal((await jobRow(j)).applied_at,null);
   await pool.query("update public.app_meetings set notes='전문 가' where id=$1",[T]);
   // 휴지통·[회의]가 아닌 칸·만든 사람이 더는 owner가 아님.
   await pool.query('update public.app_meetings set deleted_at=now() where id=$1',[T]);
   await assert.rejects(apply(j),/JOIN_REPORT_GONE/);
   await pool.query("update public.app_meetings set deleted_at=null,activity_kind='organization' where id=$1",[T]);
   await assert.rejects(apply(j),/JOIN_REPORT_CHANGED/);
   await pool.query("update public.app_meetings set activity_kind='meeting' where id=$1",[T]);
   await pool.query("update public.app_workspace_members set role='member' where workspace_id=$1",[WS_A]);
   await assert.rejects(apply(j),/JOIN_REPORT_GONE/);
   await pool.query("update public.app_workspace_members set role='owner' where workspace_id=$1",[WS_A]);
   // 붙일 녹음이 휴지통이면 멈춘다(보고 그대로).
   await pool.query('update public.app_meeting_transcribe_jobs set trashed_at=now() where id=$1',[rec]);
   await assert.rejects(apply(j),/JOIN_SOURCE_GONE/);
   await pool.query('update public.app_meeting_transcribe_jobs set trashed_at=null where id=$1',[rec]);
   assert.equal((await meeting(T)).transcript_text,'결과 가');
   assert.equal((await one('select count(*)::int as n from public.app_documents')).n,0);

   const stamp=(await meeting(T)).updated_at;
   const done=await apply(j);
   assert.equal(done.applied,true);assert.equal(done.status,'done');
   const m=await meeting(T);
   assert.deepEqual([m.title,m.transcript_text,m.notes,m.deleted_at,m.project_id],['가상 회의 가','새 요약 글','전문 가\n― 이어서 ―\n새 전문',null,PROJECT_A]);
   assert.ok(m.updated_at>stamp,'updated_at moves to the server clock');
   const docs=(await pool.query('select * from public.app_documents')).rows;
   assert.equal(docs.length,1);
   assert.deepEqual([docs[0].workspace_id,docs[0].project_id,docs[0].meeting_id,docs[0].title,docs[0].category,docs[0].tags,docs[0].drive_url,docs[0].file_id,docs[0].file_name,docs[0].mime_type,Number(docs[0].file_size),docs[0].visibility,docs[0].uploaded_by,docs[0].auto_classified],
    [WS_A,PROJECT_A,T,'가상 녹음',  '회의자료',['회의자료','회의녹음'],'https://drive.google.com/file/d/driveFile_0001/view','driveFile_0001',' 가상 녹음 .ogg','audio/ogg',1234,'private',OWNER,false]);
   assert.equal((await one('select meeting_id from public.app_meeting_transcribe_jobs where id=$1',[rec])).meeting_id,T);
   const s1=await one('select meeting_id,opened_at from public.app_meeting_server_jobs where id=$1',[sj]);
   assert.equal(s1.meeting_id,T);assert.ok(s1.opened_at);
   const row=await jobRow(j);
   assert.deepEqual([row.status,row.stage,row.summary_parts,row.source_text,row.before_result,row.before_notes,row.result_text],['done','done',[],null,'결과 가','전문 가','새 요약 글']);
   assert.ok(row.applied_at&&row.finished_at);
   assert.deepEqual(row.moved,{docs_made:[docs[0].id],record_jobs_linked:[rec],server_job_linked:true,server_job_opened:true,docs:[],links:[],server_jobs:[],record_jobs:[]});
   // 두 번 불러도 한 번만.
   assert.equal((await apply(j)).applied,false);
   assert.equal((await one('select count(*)::int as n from public.app_documents')).n,1);
   // 같은 녹음 결과는 다시 이을 수 없다(끝난 작업이 있는 동안).
   await assert.rejects(ready({...base,target_meeting_id:T2,before_result:null,before_notes:'전문 다'}),{code:'23505'});

   // 회의 결과만 오간다. 사람이 고친 글은 보관하고 두 원본은 그대로.
   assert.deepEqual(await undo(j,'before'),{scope:'before',undone:false,kept:false});
   assert.deepEqual([(await meeting(T)).transcript_text,(await meeting(T)).notes],['결과 가','전문 가\n― 이어서 ―\n새 전문']);
   assert.deepEqual(await undo(j,'joined'),{scope:'joined',undone:false,kept:false});
   assert.equal((await meeting(T)).transcript_text,'새 요약 글');
   await pool.query("update public.app_meetings set transcript_text='사람이 고친 결과' where id=$1",[T]);
   assert.deepEqual(await undo(j,'before'),{scope:'before',undone:false,kept:true});
   const kept=await jobRow(j);
   assert.deepEqual([kept.kept_result,kept.before_result,kept.result_text,kept.status,kept.undone_at],['사람이 고친 결과','결과 가','새 요약 글','done',null]);
   await assert.rejects(undo(j,'bogus'),/JOIN_NOT_APPLIED/);
   await assert.rejects(undo(early===j?uuid(404):early,'before'),/JOIN_NOT_APPLIED/);

   // 통째로: 전문을 사람이 고쳤으면 거절, 아니면 두 글·자료 행·녹음 연결을 합치기 전으로.
   await pool.query("update public.app_meetings set notes=notes||' 덧붙임' where id=$1",[T]);
   await assert.rejects(undo(j,'all'),/JOIN_REPORT_CHANGED/);
   await pool.query("update public.app_meetings set notes='전문 가\n― 이어서 ―\n새 전문' where id=$1",[T]);
   await pool.query('update public.app_meetings set deleted_at=now() where id=$1',[T]);
   await assert.rejects(undo(j,'all'),/JOIN_REPORT_GONE/);
   await pool.query('update public.app_meetings set deleted_at=null where id=$1',[T]);
   assert.deepEqual(await undo(j,'all'),{scope:'all',undone:true,kept:false});
   assert.deepEqual([(await meeting(T)).transcript_text,(await meeting(T)).notes],['결과 가','전문 가']);
   assert.equal((await one('select count(*)::int as n from public.app_documents')).n,0);
   assert.equal((await one('select meeting_id from public.app_meeting_transcribe_jobs where id=$1',[rec])).meeting_id,null);
   assert.deepEqual(await one('select meeting_id,opened_at from public.app_meeting_server_jobs where id=$1',[sj]),{meeting_id:null,opened_at:null});
   const gone=await jobRow(j);assert.equal(gone.status,'undone');assert.ok(gone.undone_at);
   await assert.rejects(undo(j,'all'),/JOIN_NOT_APPLIED/);
   await assert.rejects(undo(j,'before'),/JOIN_NOT_APPLIED/);
   assert.equal((await apply(j)).applied,false,'an undone job is never applied again');

   // 되돌린 녹음 결과는 다시 이을 수 있다. 이미 다른 보고에 붙은 녹음·남의 작업공간 녹음은 거절.
   const j2=await ready({...base,summary_parts:'[]'});
   await pool.query('update public.app_meeting_transcribe_jobs set meeting_id=$2 where id=$1',[rec,T2]);
   await assert.rejects(apply(j2),/JOIN_ALREADY_JOINED/);
   await pool.query('update public.app_meeting_transcribe_jobs set meeting_id=null where id=$1',[rec]);
   await pool.query('update public.app_meeting_server_jobs set meeting_id=$2 where id=$1',[sj,T2]);
   await assert.rejects(apply(j2),/JOIN_ALREADY_JOINED/);
   await pool.query('update public.app_meeting_server_jobs set meeting_id=null where id=$1',[sj]);
   assert.equal((await one('select count(*)::int as n from public.app_documents')).n,0,'a refused apply leaves no file row');
   await service(c=>c.query("update public.app_meeting_join_jobs set status='failed',error_code='already_joined' where id=$1",[j2]));
   const foreign=await recordJob(WS_B,{file:'driveFile_0002'});
   const j3=await ready({mode:'text',target_meeting_id:T,source_record_jobs:[foreign],before_result:'결과 가',before_notes:'전문 가',transcript_text:'전문 가\n― 이어서 ―\n붙인 글'});
   await assert.rejects(apply(j3),/JOIN_SOURCE_GONE/);
   await service(c=>c.query("update public.app_meeting_join_jobs set status='failed' where id=$1",[j3]));
   // 다른 작업공간의 보고를 가리키는 작업 행은 적용되지 않는다(없는 것과 구분 안 됨).
   const j4=await ready({mode:'text',target_meeting_id:OTHER,before_result:'남 결과',before_notes:'남 전문',transcript_text:'남 전문\n― 이어서 ―\n글'});
   await assert.rejects(apply(j4),/JOIN_REPORT_GONE/);
   assert.equal((await meeting(OTHER)).transcript_text,'남 결과');
   await service(c=>c.query("update public.app_meeting_join_jobs set status='failed' where id=$1",[j4]));
   // 글 잇기(text): 이미 그 보고에 붙은 녹음은 건너뛰고, 서버 정리 작업은 건드리지 않는다.
   await pool.query('update public.app_meeting_transcribe_jobs set meeting_id=$2 where id=$1',[rec,T]);
   const j5=await ready({mode:'text',target_meeting_id:T,source_text:'붙인 글',source_record_jobs:[rec],before_result:'결과 가',before_notes:'전문 가',transcript_text:'전문 가\n― 이어서 ―\n붙인 글'},'글 요약');
   assert.equal((await apply(j5)).applied,true);
   assert.equal((await one('select count(*)::int as n from public.app_documents')).n,0);
   assert.deepEqual((await jobRow(j5)).moved.record_jobs_linked,[]);
   assert.equal((await one('select meeting_id from public.app_meeting_server_jobs where id=$1',[sj])).meeting_id,null);
   assert.deepEqual(await undo(j5,'all'),{scope:'all',undone:true,kept:false});
   assert.equal((await one('select meeting_id from public.app_meeting_transcribe_jobs where id=$1',[rec])).meeting_id,T,'undo leaves a link it did not make');
   await pool.query('update public.app_meeting_transcribe_jobs set meeting_id=null where id=$1',[rec]);
  });

  await t.test('apply (report merge): moves files and task links, trashes the absorbed report, undo all restores both',async()=>{
   const d1=(await one(`insert into public.app_documents(workspace_id,meeting_id,title) values($1,$2,'가상 자료') returning id`,[WS_A,S])).id;
   const dT=(await one(`insert into public.app_documents(workspace_id,meeting_id,title) values($1,$2,'가 자료') returning id`,[WS_A,T])).id;
   const l1=(await one(`insert into public.app_record_links(workspace_id,google_task_id,google_tasklist_id,meeting_id) values($1,'task_only_s','list',$2) returning id`,[WS_A,S])).id;
   const l2=(await one(`insert into public.app_record_links(workspace_id,google_task_id,google_tasklist_id,meeting_id) values($1,'task_both','list',$2) returning id`,[WS_A,S])).id;
   const lT=(await one(`insert into public.app_record_links(workspace_id,google_task_id,google_tasklist_id,meeting_id) values($1,'task_both','list',$2) returning id`,[WS_A,T])).id;
   const sjS=await serverJob(WS_A,{meeting:S,opened:new Date().toISOString()}),recS=await recordJob(WS_A,{file:'driveFile_0003',meeting:S});
   const base={mode:'report',target_meeting_id:T,source_meeting_id:S,source_result_sha:sha('결과 나'),source_notes_sha:sha('전문 나'),before_result:'결과 가',before_notes:'전문 가',transcript_text:'전문 가\n― 이어서 ―\n전문 나'};
   // 없어질 보고의 글이 시작 때와 다르면 멈춘다.
   const bad=await ready({...base,source_notes_sha:sha('다른 글')});
   await assert.rejects(apply(bad),/JOIN_SOURCE_CHANGED/);
   assert.equal((await meeting(S)).deleted_at,null);assert.equal((await meeting(T)).transcript_text,'결과 가');
   await service(c=>c.query("update public.app_meeting_join_jobs set status='failed',error_code='source_changed' where id=$1",[bad]));
   const j=await ready(base,'합친 요약');
   await pool.query('update public.app_meetings set deleted_at=now() where id=$1',[S]);
   await assert.rejects(apply(j),/JOIN_SOURCE_GONE/);
   await pool.query('update public.app_meetings set deleted_at=null where id=$1',[S]);
   assert.equal((await apply(j)).applied,true);
   assert.deepEqual([(await meeting(T)).transcript_text,(await meeting(T)).notes],['합친 요약','전문 가\n― 이어서 ―\n전문 나']);
   const s=await meeting(S);assert.ok(s.deleted_at,'absorbed report goes to the trash, not deleted');assert.deepEqual([s.transcript_text,s.notes],['결과 나','전문 나']);
   const where=async(table,id)=>(await one(`select meeting_id from public.${table} where id=$1`,[id])).meeting_id;
   assert.deepEqual([await where('app_documents',d1),await where('app_documents',dT),await where('app_record_links',l1),await where('app_record_links',l2),await where('app_record_links',lT)],[T,T,T,S,T]);
   assert.deepEqual([await where('app_meeting_server_jobs',sjS),await where('app_meeting_transcribe_jobs',recS)],[T,T]);
   assert.deepEqual((await jobRow(j)).moved,{docs_made:[],record_jobs_linked:[],server_job_linked:false,server_job_opened:false,docs:[d1],links:[l1],server_jobs:[sjS],record_jobs:[recS]});

   // 그 뒤에 같은 보고로 또 이었으면 앞 것은 통째로 못 되돌린다(뒤 것부터).
   const later=await ready({mode:'text',target_meeting_id:T,before_result:'합친 요약',before_notes:'전문 가\n― 이어서 ―\n전문 나',transcript_text:'전문 가\n― 이어서 ―\n전문 나\n― 이어서 ―\n글'},'셋 요약');
   assert.equal((await apply(later)).applied,true);
   await assert.rejects(undo(j,'all'),/JOIN_REPORT_CHANGED/);
   assert.deepEqual(await undo(later,'all'),{scope:'all',undone:true,kept:false});
   // 옮긴 자료가 더는 그 보고에 없거나, 없어진 보고를 따로 되살렸으면 거절.
   await pool.query('update public.app_documents set meeting_id=null where id=$1',[d1]);
   await assert.rejects(undo(j,'all'),/JOIN_SOURCE_GONE/);
   await pool.query('update public.app_documents set meeting_id=$2 where id=$1',[d1,T]);
   await pool.query('update public.app_meetings set deleted_at=null where id=$1',[S]);
   await assert.rejects(undo(j,'all'),/JOIN_SOURCE_GONE/);
   await pool.query('update public.app_meetings set deleted_at=now() where id=$1',[S]);
   assert.deepEqual(await undo(j,'before'),{scope:'before',undone:false,kept:false});
   assert.deepEqual(await undo(j,'all'),{scope:'all',undone:true,kept:false});
   assert.deepEqual([(await meeting(T)).transcript_text,(await meeting(T)).notes,(await meeting(S)).deleted_at],['결과 가','전문 가',null]);
   assert.deepEqual([await where('app_documents',d1),await where('app_documents',dT),await where('app_record_links',l1),await where('app_record_links',l2),await where('app_record_links',lT)],[S,T,S,S,T]);
   assert.deepEqual([await where('app_meeting_server_jobs',sjS),await where('app_meeting_transcribe_jobs',recS)],[S,S]);
   assert.ok((await one('select opened_at from public.app_meeting_server_jobs where id=$1',[sjS])).opened_at,'undo keeps what apply did not set');

   // 합친 뒤 없어진 보고를 영구 삭제해도 막히지 않고(재료 칸만 빔), 고른 보고를 영구 삭제하면 그 잇기 작업 행도 없어진다.
   const k=await ready(base,'다시 합친 요약');
   assert.equal((await apply(k)).applied,true);
   await pool.query('delete from public.app_meetings where id=$1',[S]);
   assert.deepEqual([(await jobRow(k)).source_meeting_id,(await jobRow(k)).status],[null,'done']);
   await assert.rejects(undo(k,'all'),/JOIN_SOURCE_GONE/);
   await pool.query('delete from public.app_record_links where meeting_id=$1',[T]);
   await pool.query('update public.app_documents set meeting_id=null where meeting_id=$1',[T]);
   await pool.query('update public.app_meeting_server_jobs set meeting_id=null where meeting_id=$1',[T]);
   await pool.query('update public.app_meeting_transcribe_jobs set meeting_id=null where meeting_id=$1',[T]);
   await pool.query('delete from public.app_meetings where id=$1',[T]);
   assert.equal((await one('select count(*)::int as n from public.app_meeting_join_jobs where target_meeting_id=$1',[T])).n,0);
  });

  await t.test('rollback (SQL Editor) stops while a join runs; otherwise drops functions, table and the record; re-apply works',async()=>{
   const running=await ready({mode:'text',target_meeting_id:T2,before_notes:'전문 다',transcript_text:'전문 다\n― 이어서 ―\n글'});
   await assert.rejects(pool.query(rollbackSQL),/MEETING_JOIN_JOBS_ROLLBACK_BLOCKED: join job in progress/);
   assert.ok((await pool.query("select to_regclass('public.app_meeting_join_jobs') is not null as ok")).rows[0].ok);
   await service(c=>c.query("update public.app_meeting_join_jobs set status='failed' where id=$1",[running]));
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select to_regclass('public.app_meeting_join_jobs') is null and to_regprocedure('public.app_meeting_join_apply(uuid)') is null and to_regprocedure('public.app_meeting_join_undo(uuid,text)') is null as gone")).rows[0].gone,true);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   const again=await run('apply','9994');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
