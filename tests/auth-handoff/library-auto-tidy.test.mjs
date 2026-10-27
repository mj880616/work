// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// LIB-자동정리: 20261022212757_library_auto_tidy — backup table, attempt record, apply/revert functions, through the approved
// DB workflow runner: dry-run, apply, one transaction (backup + change + attempt), user fields refused, owner RLS, revert that skips
// fields the person changed afterwards, guarded rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261022212757',name='library_auto_tidy',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// Production-like app_documents after 20261022100000 (field_origin with its check), owner RLS, anon revoked.
const documents=`
  create table public.app_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.app_workspaces(id),
    project_id uuid,organization_id uuid,title text,category text,source text,document_date date,file_name text,visibility text default 'private',
    classification_note text,extracted_text text,extraction_status text default 'pending',extraction_error text,extracted_at timestamptz,
    field_origin jsonb not null default '{}'::jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),
    constraint app_documents_field_origin_check check (jsonb_typeof(field_origin) = 'object'
      and (field_origin - array['title', 'category', 'source', 'document_date']) = '{}'::jsonb
      and not jsonb_path_exists(field_origin, 'strict $.* ? (@.type() != "string")')
      and not jsonb_path_exists(field_origin, 'strict $.* ? (@ != "ai" && @ != "user")')));
  alter table public.app_documents enable row level security;
  create policy task12a_owner_all on public.app_documents for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_documents from anon;
  revoke truncate, references, trigger on public.app_documents from authenticated;
  insert into supabase_migrations.schema_migrations(version,name) values('20261022100000','library_ai_fill');
`;

test('library auto tidy: dry-run, apply, one-transaction backup, user fields refused, owner RLS, revert, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'library-auto-tidy-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(documents);
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const snapshot=await read('docs/'+stem+'.snapshot.sql'),precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const doc=async(ws,over={})=>(await pool.query(`insert into public.app_documents(workspace_id,title,category,source,document_date,file_name,field_origin)
    values($1,$2,$3,$4,$5,$6,$7::jsonb) returning id`,[ws,over.title??'251020_요구안',over.category??'기타',over.source??null,over.document_date??null,'251020_요구안.hwpx',JSON.stringify(over.field_origin??{})])).rows[0].id;
  const D1=await doc(WS_A),D2=await doc(WS_A,{title:'고친 제목',field_origin:{title:'user'}}),D3=await doc(WS_B),D4=await doc(WS_A);
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const stamp=async id=>(await pool.query('select updated_at::text t from public.app_documents where id=$1',[id])).rows[0].t;
  const row=async id=>(await pool.query('select title,category,source,document_date::text as document_date,field_origin from public.app_documents where id=$1',[id])).rows[0];
  const apply=(sub,batch,items)=>as('authenticated',sub,c=>c.query('select public.app_library_auto_tidy_apply($1,$2::jsonb) r',[batch,JSON.stringify(items)])).then(r=>r.rows[0].r);
  const revert=(sub,batch)=>as('authenticated',sub,c=>c.query('select public.app_library_auto_tidy_revert($1) r',[batch])).then(r=>r.rows[0].r);
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows;

  await t.test('files: read-only checks, three-line summary, expanded approved workflow accepts the file',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,[]);}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   assert.match(summary[0],/손으로 넣지 않은 칸/);assert.match(summary[0],/75개/);assert.match(summary[1],/되돌릴 수 있/);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level|\bto (anon|public|service_role)\b|information_schema|rtw_|drop policy|alter policy/i);
   assert.doesNotMatch(precheck+postcheck,/information_schema/);
  });
  await t.test('precheck before apply',()=>{
   const v=Object.fromEntries(beforeCheck.map(r=>[r.item,r.value]));
   for(const k of ['new migration absent','library ai fill recorded','tidy backups table absent','tidy attempts table absent','tidy apply function absent','tidy revert function absent','field origin column present','documents RLS enabled','authenticated can update documents','owner check function','workspaces table'])assert.equal(v[k],'예',k);
   assert.equal(v['documents rows'],'4');
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await runMigrationPlan(plan('dry-run','9601'),query,{saveSnapshot:async()=>{}});assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);
  });
  await t.test('apply passes postcheck; existing document values unchanged',async()=>{
   const saved=new Map();const result=await runMigrationPlan(plan('apply','9602'),query,{saveSnapshot:async(file,body)=>{saved.set(file,body);}});assert.equal(result.ok,true,result.summary);
   assert.doesNotMatch(result.summary.split('사후 확인')[1]??'',/\| 아니오 \|/);
   assert.equal(await history(),1);
   assert.deepEqual(await row(D1),{title:'251020_요구안',category:'기타',source:null,document_date:null,field_origin:{}});
   await assert.rejects(pool.query(migration),/LIBRARY_AUTO_TIDY_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  const B1=randomUUID();
  await t.test('apply function: backup rows + changed fields + ai record + attempt, all in one call',async()=>{
   const r=await apply(OWNER,B1,[{document_id:D1,updated_at:await stamp(D1),changes:{title:'2026년 임금교섭 요구안',category:'교섭',document_date:'2026-10-20'}}]);
   assert.deepEqual(r,{documents:1,fields:3,moved:0});
   assert.deepEqual(await row(D1),{title:'2026년 임금교섭 요구안',category:'교섭',source:null,document_date:'2026-10-20',field_origin:{title:'ai',category:'ai',document_date:'ai'}});
   const backups=(await pool.query('select field,old_value,old_origin,new_value,reverted_at from public.app_library_tidy_backups where batch_id=$1 order by field',[B1])).rows;
   assert.deepEqual(backups.map(b=>[b.field,b.old_value,b.old_origin,b.new_value,b.reverted_at]),[
    ['category','기타',null,'교섭',null],['document_date',null,null,'2026-10-20',null],['title','251020_요구안',null,'2026년 임금교섭 요구안',null]]);
   assert.equal((await pool.query('select changed from public.app_library_tidy_attempts where document_id=$1',[D1])).rows[0].changed,3);
  });
  await t.test('one transaction: a user field anywhere in the call rolls back every backup and change of that call',async()=>{
   const b=randomUUID();
   await assert.rejects(apply(OWNER,b,[{document_id:D4,updated_at:await stamp(D4),changes:{title:'바꿈'}},{document_id:D2,updated_at:await stamp(D2),changes:{title:'덮어쓰기'}}]),{code:'42501'});
   assert.equal((await pool.query('select count(*)::int n from public.app_library_tidy_backups where batch_id=$1',[b])).rows[0].n,0);
   assert.equal((await row(D4)).title,'251020_요구안');assert.equal((await row(D2)).title,'고친 제목');
   assert.equal((await pool.query('select count(*)::int n from public.app_library_tidy_attempts where document_id in ($1,$2)',[D2,D4])).rows[0].n,0);
  });
  await t.test('input is validated in the database (shape, field names, length, markup, date range, size)',async()=>{
   const s=await stamp(D4);
   for(const items of [[],[{document_id:D4,updated_at:s,changes:{project_id:'x'}}],[{document_id:D4,updated_at:s,changes:{title:'<b>x</b>'}}],
     [{document_id:D4,updated_at:s,changes:{title:'x'.repeat(121)}}],[{document_id:D4,updated_at:s,changes:{source:'x'.repeat(61)}}],
     [{document_id:D4,updated_at:s,changes:{document_date:'1970-01-01'}}],[{document_id:D4,updated_at:s,changes:{document_date:'2999-01-01'}}],
     [{document_id:D4,updated_at:s,changes:{title:1}}],[{document_id:D4,updated_at:s,changes:{},extra:1}],
     Array.from({length:11},()=>({document_id:D4,updated_at:s,changes:{}}))])
    await assert.rejects(apply(OWNER,randomUUID(),items),{code:'22023'},JSON.stringify(items).slice(0,80));
  });
  await t.test('a moved row (updated_at changed since read) is skipped and nothing is backed up; empty changes record the attempt only',async()=>{
   const b=randomUUID();
   assert.deepEqual(await apply(OWNER,b,[{document_id:D4,updated_at:'2000-01-01T00:00:00Z',changes:{title:'바꿈'}}]),{documents:0,fields:0,moved:1});
   assert.equal((await row(D4)).title,'251020_요구안');
   assert.deepEqual(await apply(OWNER,b,[{document_id:D4,updated_at:await stamp(D4),changes:{}}]),{documents:0,fields:0,moved:0});
   assert.equal((await pool.query('select changed from public.app_library_tidy_attempts where document_id=$1',[D4])).rows[0].changed,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_library_tidy_backups where batch_id=$1',[b])).rows[0].n,0);
  });
  await t.test('owner only: a stranger cannot apply to, read or revert another workspace; anon has nothing',async()=>{
   assert.deepEqual(await apply(STRANGER,randomUUID(),[{document_id:D1,updated_at:await stamp(D1),changes:{source:'x'}}]),{documents:0,fields:0,moved:1});
   assert.deepEqual(await revert(STRANGER,B1),{reverted:0,skipped:0});
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select * from public.app_library_tidy_backups'))).rowCount,0);
   assert.equal((await as('authenticated',STRANGER,c=>c.query('select * from public.app_library_tidy_attempts'))).rowCount,0);
   // Inserting directly for another workspace's document is refused by the policy.
   await assert.rejects(as('authenticated',OWNER,c=>c.query('insert into public.app_library_tidy_attempts(document_id,workspace_id,batch_id) values($1,$2,$3)',[D3,WS_A,randomUUID()])),{code:'42501'});
   for(const sql of ['select * from public.app_library_tidy_backups','select * from public.app_library_tidy_attempts',`select public.app_library_auto_tidy_revert('${B1}')`])
    await assert.rejects(as('anon','',c=>c.query(sql)),{code:'42501'},sql);
   // The owner cannot rewrite or delete backup values directly.
   await assert.rejects(as('authenticated',OWNER,c=>c.query('update public.app_library_tidy_backups set old_value=$1 where batch_id=$2',['x',B1])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query('delete from public.app_library_tidy_backups where batch_id=$1',[B1])),{code:'42501'});
  });
  await t.test('revert: only fields still holding the AI value go back (value and origin); a field the person changed afterwards is skipped',async()=>{
   // The person corrects the category after the tidy (the edit screen marks it user).
   await as('authenticated',OWNER,c=>c.query(`update public.app_documents set category='정책',field_origin=field_origin||'{"category":"user"}'::jsonb where id=$1`,[D1]));
   assert.deepEqual(await revert(OWNER,B1),{reverted:2,skipped:1});
   assert.deepEqual(await row(D1),{title:'251020_요구안',category:'정책',source:null,document_date:null,field_origin:{category:'user'}});
   assert.equal((await pool.query('select count(*)::int n from public.app_library_tidy_backups where batch_id=$1 and reverted_at is null',[B1])).rows[0].n,1);
   assert.deepEqual(await revert(OWNER,B1),{reverted:0,skipped:1});
   // The attempt record stays, so the same document is not sent to AI again.
   assert.equal((await pool.query('select count(*)::int n from public.app_library_tidy_attempts where document_id=$1',[D1])).rows[0].n,1);
  });
  await t.test('rollback refuses while an unreverted backup exists; after all are reverted it restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/LIBRARY_AUTO_TIDY_ROLLBACK_BLOCKED: unreverted backups exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   // The skipped backup is the person's own correction: mark it handled as the CC procedure would after keeping a capture.
   await pool.query('update public.app_library_tidy_backups set reverted_at=now() where reverted_at is null');
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows.filter(r=>r.kind!=='documents column'||r.name!=='updated_at'),before.filter(r=>r.kind!=='documents column'||r.name!=='updated_at'));
   const after=Object.fromEntries((await pool.query(postcheck)).rows.map(r=>[r.item,r.value]));
   assert.equal(after['objects and history agree'],'예');
   await pool.query(migration);assert.equal(await history(),1);
  });
 }finally{
  await closePool(pool);await cluster.stop().catch(()=>{});
 }
});
