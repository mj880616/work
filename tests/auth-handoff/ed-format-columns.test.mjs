// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// ED③-1 DB: 20261023233000_ed_format_columns through the approved DB workflow runner — a `doc jsonb` column + CHECK on
// app_notes, app_suborganization_updates and app_project_progress_updates. Existing rows stay as they are, the owner RLS
// and table grants are untouched, and the rollback stops while any row holds a format.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {fixture,OWNER,STRANGER,WS_A,ORG_A,PROJECT_A} from './basket4-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261023233000',name='ed_format_columns',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// The two record tables have no create table in the repository migrations: synthetic stand-ins with a text column that has
// a length limit, RLS, an owner policy and table-level grants for authenticated only (anon revoked), like production's shape.
const recordTables=`
  create table public.app_suborganization_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, organization_id uuid not null,
    raw_text text not null check (length(raw_text) between 1 and 20000), occurred_at timestamptz);
  create table public.app_project_progress_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
    summary text check (length(summary) <= 500), effective_on date);
  ${['app_suborganization_updates','app_project_progress_updates'].map(t=>`
  alter table public.${t} enable row level security;
  create policy task12a_owner_all on public.${t} for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.${t} from public, anon, authenticated;
  grant select, insert, update, delete on public.${t} to authenticated;`).join('')}
  insert into supabase_migrations.schema_migrations(version,name) values('20261023180000','profile_view_prefs');
`;
const TABLES=[
 {label:'notes',table:'app_notes',text:'raw_text',insert:`insert into public.app_notes(workspace_id,kind,title,raw_text) values('${WS_A}','note','노트','본문') returning id`},
 {label:'org updates',table:'app_suborganization_updates',text:'raw_text',insert:`insert into public.app_suborganization_updates(workspace_id,organization_id,raw_text) values('${WS_A}','${ORG_A}','조직 기록') returning id`},
 {label:'project records',table:'app_project_progress_updates',text:'summary',insert:`insert into public.app_project_progress_updates(workspace_id,project_id,summary) values('${WS_A}','${PROJECT_A}','프로젝트 기록') returning id`},
];
const docOf=text=>({v:'ed1',doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}});

test('ed format columns: dry-run, apply, owner-only writes, shape CHECK, guarded rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ed-format-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(`create table public.app_documents(id uuid primary key,workspace_id uuid);alter table public.app_spaces add column owner_id uuid default '${OWNER}',add column name text,add column parent_id uuid,add column status text default 'active',add column metadata jsonb default '{"project_system":"v2"}';grant select,update on public.app_spaces to authenticated;alter table public.app_spaces enable row level security;create policy synthetic_spaces_owner on public.app_spaces for all to authenticated using(private.app_is_workspace_owner(workspace_id)) with check(private.app_is_workspace_owner(workspace_id));`);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql','20261013034836_basket_photo_ocr_db.sql','20261017052234_journal_memo_notes_kind.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(recordTables);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  // Existing rows in all three tables (every note kind included; the diary row stays private).
  const ids={};
  await pool.query("insert into public.app_notes(workspace_id,raw_text) values($1,'바구니 원문')",[WS_A]);
  await pool.query("insert into public.app_notes(workspace_id,kind,journal_day,raw_text,ai_export_allowed) values($1,'diary','2026-10-05','일기',false)",[WS_A]);
  await pool.query("insert into public.app_notes(workspace_id,kind,journal_day,raw_text) values($1,'work','2026-10-05','옛 한 줄')",[WS_A]);
  for(const x of TABLES)ids[x.table]=(await pool.query(x.insert)).rows[0].id;
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const saved=new Map(),saveSnapshot=async(file,body)=>{saved.set(file,body);};
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const rowsHash=async()=>Object.fromEntries(await Promise.all(TABLES.map(async x=>[x.table,(await pool.query(`select md5(string_agg((to_jsonb(n)-'doc')::text,E'\\n' order by n.id)) h from public.${x.table} n`)).rows[0].h])));
  const write=(x,sub,id,value)=>as('authenticated',sub,c=>c.query(`update public.${x.table} set doc=$1::jsonb where id=$2`,[value===null?null:JSON.stringify(value),id]));
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const dataHash=await (async()=>JSON.stringify(await rowsHash()))();

  await t.test('precheck reports the expected pre-apply state and records the production shape',()=>{
   const p=v(beforeCheck);
   for(const k of ['prerequisite recorded','new migration absent','three tables exist','text columns are text','RLS enabled on all three','authenticated can read insert update on all three','notes one owner policy','org updates owner policy'])assert.equal(p[k],'예',k);
   for(const k of ['anon or public table privilege','anon or public policy'])assert.equal(p[k],'아니오',k);
   assert.deepEqual([p['doc column count'],p['doc check count'],p['notes rows'],p['org updates rows'],p['project records rows']],['0','0','4','1','1']);
   // Length limits of the production text columns are read into the precheck (the repository has no definition for two of them).
   assert.match(p['org updates text column length limits'],/20000/);assert.match(p['project records text column length limits'],/500/);
   for(const x of TABLES)for(const k of ['text column length limits','all constraints hash','columns hash','policies count','policies hash','owner RLS grants hash','column grants hash','triggers count','triggers hash','indexes hash'])assert.ok(p[x.label+' '+k]!==undefined,x.label+' '+k);
   const snap=before.map(r=>r.kind+':'+r.name+':'+r.definition).join('\n');
   assert.match(snap,/constraint:org updates [^:]*:c:validated=true:CHECK .*20000/);assert.match(snap,/constraint:project records [^:]*:c:validated=true:CHECK .*500/);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9701');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);assert.equal(JSON.stringify(await rowsHash()),dataHash);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    ['grant select on public.app_notes to anon','revoke select on public.app_notes from anon'],
    ['grant select on public.app_project_progress_updates to anon','revoke select on public.app_project_progress_updates from anon'],
    ["create policy synthetic_anon on public.app_suborganization_updates for select to anon using (true)",'drop policy synthetic_anon on public.app_suborganization_updates'],
    ['alter table public.app_project_progress_updates disable row level security','alter table public.app_project_progress_updates enable row level security'],
    ['revoke update on public.app_suborganization_updates from authenticated','grant update on public.app_suborganization_updates to authenticated'],
    ['alter table public.app_notes add column doc jsonb','alter table public.app_notes drop column doc'],
    ["delete from supabase_migrations.schema_migrations where version='20261023180000'","insert into supabase_migrations.schema_migrations(version,name) values('20261023180000','profile_view_prefs')"],
   ];
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{
     const c=await pool.connect();try{await assert.rejects(c.query(migration),/ED_FORMAT_COLUMNS_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}
    }finally{await pool.query(fixIt);}
   }
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply passes postcheck; rows, other columns, constraints, grants, policies, triggers and indexes unchanged',async()=>{
   const apply=await run('apply','9702');assert.equal(apply.ok,true,apply.summary);assert.doesNotMatch(apply.summary.split('사후 검사:')[1]||'',/아니오/);
   const post=(await pool.query(postcheck)).rows,pre=(await pool.query(precheck)).rows;
   assert.ok(post.filter(r=>/^(예|아니오)$/.test(r.value)).every(r=>r.value==='예'),'postcheck 예/아니오 items');
   assert.equal(JSON.stringify(await rowsHash()),dataHash,'existing rows unchanged');
   for(const r of post.filter(r=>!/^(예|아니오)$/.test(r.value)))assert.equal(r.value,v(beforeCheck)[r.item],r.item);
   assert.equal(v(pre)['doc column count'],'3');assert.equal(v(pre)['doc check count'],'3');
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2",[version,name])).rows[0].n,1);
   for(const x of TABLES)assert.equal((await pool.query(`select count(*)::int n from public.${x.table} where doc is not null`)).rows[0].n,0);
  });
  await t.test('the owner saves a format with the text in one write; others and anon cannot; text limits still hold',async()=>{
   for(const x of TABLES){
    const id=ids[x.table];
    assert.equal((await as('authenticated',OWNER,c=>c.query(`update public.${x.table} set doc=$1::jsonb,${x.text}=$2 where id=$3`,[JSON.stringify(docOf('굵은 글')),'굵은 글',id]))).rowCount,1,x.label);
    const row=(await pool.query(`select doc,${x.text} as text from public.${x.table} where id=$1`,[id])).rows[0];
    assert.deepEqual(row.doc,docOf('굵은 글'));assert.equal(row.text,'굵은 글');
    assert.equal((await write(x,STRANGER,id,docOf('남의 서식'))).rowCount,0,x.label+' stranger cannot write');
    assert.deepEqual((await pool.query(`select doc from public.${x.table} where id=$1`,[id])).rows[0].doc,docOf('굵은 글'));
    await assert.rejects(as('anon','',c=>c.query(`select doc from public.${x.table} limit 1`)),{code:'42501'},x.label+' anon');
    assert.equal((await as('authenticated',STRANGER,c=>c.query(`select doc from public.${x.table}`))).rowCount,0,x.label+' stranger sees nothing');
    assert.equal((await write(x,OWNER,id,null)).rowCount,1,x.label+' back to plain');
   }
   // The existing text-length checks are unchanged.
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_suborganization_updates set raw_text=$1 where id=$2",['가'.repeat(20001),ids.app_suborganization_updates])),{code:'23514'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_project_progress_updates set summary=$1 where id=$2",['가'.repeat(501),ids.app_project_progress_updates])),{code:'23514'});
  });
  await t.test('the CHECK accepts only {"v":"ed1","doc":{"content":[…]}} up to 1 MiB (a rejection, never an error, also for missing inner keys)',async()=>{
   const bad=[[],'x',1,true,{},{v:'ed1'},{v:'ed1',doc:null},{v:'ed1',doc:{}},{v:'ed1',doc:[]},{v:'ed1',doc:{content:{}}},{v:'ed1',doc:{content:'x'}},{v:'ed1',doc:{content:null}},
    {v:'ed2',doc:{content:[]}},{v:1,doc:{content:[]}},{doc:{content:[]}},{V:'ed1',doc:{content:[]}}];
   const ok=[{v:'ed1',doc:{content:[]}},{v:'ed1',doc:{type:'doc',content:[{type:'paragraph'}]},extra:1},docOf('한글 😀 text')];
   for(const x of TABLES){
    const id=ids[x.table];
    for(const value of bad)await assert.rejects(write(x,OWNER,id,value),{code:'23514'},x.label+' '+JSON.stringify(value));
    for(const value of ok){assert.equal((await write(x,OWNER,id,value)).rowCount,1,x.label+' '+JSON.stringify(value).slice(0,60));}
    // The 1 MiB limit counts bytes of the stored text: exactly the limit passes, one more byte is refused; multibyte letters count by bytes.
    const overhead=(await pool.query("select octet_length(($1::jsonb)::text) n",[JSON.stringify({v:'ed1',doc:{content:['']}})])).rows[0].n;
    const exact={v:'ed1',doc:{content:['a'.repeat(1048576-overhead)]}},over={v:'ed1',doc:{content:['a'.repeat(1048576-overhead+1)]}};
    assert.equal((await write(x,OWNER,id,exact)).rowCount,1,x.label+' exactly 1 MiB');
    await assert.rejects(write(x,OWNER,id,over),{code:'23514'},x.label+' 1 MiB + 1');
    await assert.rejects(write(x,OWNER,id,{v:'ed1',doc:{content:['한'.repeat(Math.floor((1048576-overhead)/3)+1)]}}),{code:'23514'},x.label+' multibyte');
    assert.equal((await write(x,OWNER,id,null)).rowCount,1);
   }
   // A new row can carry a format from the start.
   assert.equal((await as('authenticated',OWNER,c=>c.query("insert into public.app_notes(workspace_id,kind,title,raw_text,doc) values($1,'note','새 서식 노트','글자',$2::jsonb)",[WS_A,JSON.stringify(docOf('글자'))]))).rowCount,1);
   await pool.query("delete from public.app_notes where title='새 서식 노트'");
  });
  await t.test('rollback refuses while any row holds a format, in every table, and keeps it',async()=>{
   for(const x of TABLES){
    assert.equal((await write(x,OWNER,ids[x.table],docOf('보관할 서식'))).rowCount,1);
    const result=await run('rollback','9703');assert.equal(result.ok,false,result.summary);
    const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/ED_FORMAT_COLUMNS_ROLLBACK_BLOCKED: formatted rows exist/);await c.query('rollback');}finally{c.release();}
    assert.deepEqual((await pool.query(`select doc from public.${x.table} where id=$1`,[ids[x.table]])).rows[0].doc,docOf('보관할 서식'));
    assert.equal((await write(x,OWNER,ids[x.table],null)).rowCount,1);
   }
  });
  await t.test('rollback restores the original schema once every format is empty; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
   const again=await run('apply','9705');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
