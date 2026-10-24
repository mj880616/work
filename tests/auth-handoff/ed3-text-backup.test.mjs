// Fresh local PostgreSQL only. No Supabase, Google or production credentials. All data synthetic.
// ED③ 1단계 PR A: 20261024190000_ed3_text_backup through the approved DB workflow runner — a private backup table with a one-time copy of
// note·basket·diary rows and org/project record text. The owner reads only the id/time columns (the conversion button checks what is
// backed up); nobody reads the text columns or writes; the rollback stops while any row holds a format.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A,WS_B,ORG_A,ORG_B,PROJECT_A,PROJECT_B} from './basket4-fixture.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261024190000',name='ed3_text_backup',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

// The two record tables have no create table in the repository: synthetic stand-ins shaped like ed-format-columns.test.mjs
// (org updates get an updated_at column, project records do not, so both shapes of production are covered).
const recordTables=`
  create table public.app_suborganization_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, organization_id uuid not null,
    raw_text text not null check (length(raw_text) between 1 and 20000), occurred_at timestamptz, updated_at timestamptz default now());
  create table public.app_project_progress_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
    summary text check (length(summary) <= 500), effective_on date);
  ${['app_suborganization_updates','app_project_progress_updates'].map(t=>`
  alter table public.${t} enable row level security;
  create policy task12a_owner_all on public.${t} for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.${t} from public, anon, authenticated;
  grant select, insert, update, delete on public.${t} to authenticated;`).join('')}
  insert into supabase_migrations.schema_migrations(version,name) values('20261023180000','profile_view_prefs');
`;

test('ed3 text backup: dry-run, apply copies every row, owner reads ids only, nobody reads text or writes, guarded rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ed3-backup-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(`create table public.app_documents(id uuid primary key,workspace_id uuid);alter table public.app_spaces add column owner_id uuid default '${OWNER}',add column name text,add column parent_id uuid,add column status text default 'active',add column metadata jsonb default '{"project_system":"v2"}';grant select,update on public.app_spaces to authenticated;alter table public.app_spaces enable row level security;create policy synthetic_spaces_owner on public.app_spaces for all to authenticated using(private.app_is_workspace_owner(workspace_id)) with check(private.app_is_workspace_owner(workspace_id));`);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql','20261013034836_basket_photo_ocr_db.sql','20261017052234_journal_memo_notes_kind.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(recordTables);
  await pool.query(await read('supabase/migrations/20261023233000_ed_format_columns.sql'));
  // Rows: markdown note, plain note, basket, diary (private), work line (not backed up), a second workspace's note, org update, project record.
  const md='## 회의\n\n- 사측 안 **제시**\n\n| 칸 | 칸 |\n|---|---|\n| 1 | 2 |';
  const ins=async(sql,args)=>(await pool.query(sql,args)).rows[0].id;
  const ids={
   mdNote:await ins("insert into public.app_notes(workspace_id,kind,title,raw_text,metadata) values($1,'note','마크다운',$2,'{\"markdown\":true,\"folder\":\"교섭\"}') returning id",[WS_A,md]),
   plainNote:await ins("insert into public.app_notes(workspace_id,kind,title,raw_text,metadata) values($1,'note','쓴 그대로','2026.10.21. 교섭\n1. 첫째','{\"markdown\":false}') returning id",[WS_A]),
   basket:await ins("insert into public.app_notes(workspace_id,raw_text) values($1,'바구니 원문') returning id",[WS_A]),
   diary:await ins("insert into public.app_notes(workspace_id,kind,journal_day,raw_text,ai_export_allowed) values($1,'diary','2026-10-05','일기 원문',false) returning id",[WS_A]),
   work:await ins("insert into public.app_notes(workspace_id,kind,journal_day,raw_text) values($1,'work','2026-10-05','옛 한 줄') returning id",[WS_A]),
   otherNote:await ins("insert into public.app_notes(workspace_id,kind,title,raw_text) values($1,'note','남의 노트','남의 글') returning id",[WS_B]),
   org:await ins("insert into public.app_suborganization_updates(workspace_id,organization_id,raw_text) values($1,$2,'조직 기록') returning id",[WS_A,ORG_A]),
   orgB:await ins("insert into public.app_suborganization_updates(workspace_id,organization_id,raw_text) values($1,$2,'남의 조직 기록') returning id",[WS_B,ORG_B]),
   project:await ins("insert into public.app_project_progress_updates(workspace_id,project_id,summary) values($1,$2,'프로젝트 기록') returning id",[WS_A,PROJECT_A]),
   projectB:await ins("insert into public.app_project_progress_updates(workspace_id,project_id,summary) values($1,$2,'남의 프로젝트') returning id",[WS_B,PROJECT_B]),
  };
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql');
  const query=async(sql,options={})=>{const c=await pool.connect();try{if(options.readOnly)await c.query('begin read only');const r=await c.query(sql);if(options.readOnly)await c.query('commit');return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const plan=(mode,run)=>prepareMigration({mode,version,runId:run,root});
  const run=(mode,id)=>runMigrationPlan(plan(mode,id),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const v=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const sourceHash=async()=>(await pool.query("select md5(string_agg(to_jsonb(n)::text,E'\\n' order by n.id)) h from public.app_notes n")).rows[0].h;
  const before=(await pool.query(snapshot)).rows,beforeCheck=(await pool.query(precheck)).rows,beforeHash=await sourceHash();

  await t.test('plan uses the expanded single-approval flow; precheck reports the pre-apply state',()=>{
   for(const mode of ['apply','dry-run']){const p=plan(mode,'1');assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.createdTables,['app_ed3_text_backups']);assert.equal(p.summaryLines.length,3);}
   const p=v(beforeCheck);
   for(const k of ['new migration absent','backup table absent','format columns migration','three doc columns','no formatted rows yet','owner check function','every record has its organization or project'])assert.equal(p[k],'예',k);
   assert.deepEqual([p['note rows'],p['basket rows'],p['diary rows'],p['org update rows'],p['project record rows']],['3','1','1','2','2']);
  });
  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9801');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual((await pool.query(precheck)).rows,beforeCheck);assert.equal(await sourceHash(),beforeHash);
  });
  await t.test('prerequisite changes stop the migration without any change',async()=>{
   const attempts=[
    [`update public.app_notes set doc='{"v":"ed1","doc":{"content":[]}}' where id='${ids.plainNote}'`,`update public.app_notes set doc=null where id='${ids.plainNote}'`],
    [`update public.app_project_progress_updates set doc='{"v":"ed1","doc":{"content":[]}}' where id='${ids.project}'`,`update public.app_project_progress_updates set doc=null where id='${ids.project}'`],
    ["delete from supabase_migrations.schema_migrations where version='20261023233000'","insert into supabase_migrations.schema_migrations(version,name) values('20261023233000','ed_format_columns')"],
    ['create table public.app_ed3_text_backups(x int)','drop table public.app_ed3_text_backups'],
   ];
   for(const [breakIt,fixIt] of attempts){
    await pool.query(breakIt);
    try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/ED3_TEXT_BACKUP_PREREQUISITE_CHANGED/,breakIt);await c.query('rollback');}finally{c.release();}}
    finally{await pool.query(fixIt);}
   }
   // A record whose organization is gone would not be copied: the postcheck count stops the whole apply.
   await pool.query("alter table public.app_suborganization_updates disable row level security");
   await pool.query("insert into public.app_suborganization_updates(id,workspace_id,organization_id,raw_text) values('29000000-0000-4000-8000-000000000001',$1,'29000000-0000-4000-8000-0000000000ff','고아 기록')",[WS_A]);
   await pool.query("alter table public.app_suborganization_updates enable row level security");
   try{const c=await pool.connect();try{await assert.rejects(c.query(migration),/ED3_TEXT_BACKUP_POSTCHECK_FAILED/);await c.query('rollback');}finally{c.release();}}
   finally{await pool.query("delete from public.app_suborganization_updates where id='29000000-0000-4000-8000-000000000001'");}
   assert.deepEqual((await pool.query(snapshot)).rows,before);
  });
  await t.test('apply copies every note·basket·diary row and every record exactly, work lines excluded, source rows unchanged',async()=>{
   const apply=await run('apply','9802');assert.equal(apply.ok,true,apply.summary);assert.doesNotMatch(apply.summary.split('사후 검사:')[1]||'',/아니오/);
   const post=v((await pool.query(postcheck)).rows);
   for(const k of ['table and history agree','RLS enabled','one owner read policy','anon has no table or column privilege','no PUBLIC grant','nobody can read the text columns','nobody can write'])assert.equal(post[k],'예',k);
   assert.deepEqual((await pool.query('select source,count(*)::int n from public.app_ed3_text_backups group by source order by source')).rows.map(r=>r.source+'='+r.n),['basket=1','diary=1','note=3','org_update=2','project_record=2']);
   for(const k of ['note rows','basket rows','diary rows','org update rows','project record rows'])assert.equal(post[k],v(beforeCheck)[k],k);
   assert.equal(await sourceHash(),beforeHash,'source rows unchanged');
   const rows=(await pool.query('select * from public.app_ed3_text_backups')).rows,by=Object.fromEntries(rows.map(r=>[r.row_id,r]));
   assert.equal(by[ids.mdNote].raw_text,md);assert.deepEqual(by[ids.mdNote].metadata,{markdown:true,folder:'교섭'});assert.equal(by[ids.mdNote].source,'note');
   const note=(await pool.query('select updated_at from public.app_notes where id=$1',[ids.mdNote])).rows[0];assert.equal(by[ids.mdNote].row_updated_at.getTime(),note.updated_at.getTime());
   assert.equal(by[ids.diary].raw_text,'일기 원문');assert.equal(by[ids.diary].source,'diary');
   assert.equal(by[ids.work],undefined,'work lines are not backed up');
   assert.equal(by[ids.org].raw_text,'조직 기록');assert.equal(by[ids.org].workspace_id,WS_A);assert.ok(by[ids.org].row_updated_at);
   assert.equal(by[ids.project].raw_text,'프로젝트 기록');assert.equal(by[ids.project].row_updated_at,null);assert.equal(by[ids.projectB].workspace_id,WS_B);
   assert.equal(by[ids.otherNote].workspace_id,WS_B);
  });
  await t.test('owner reads only id/time columns of their own workspace; text columns, writes, stranger, anon and service_role refused',async()=>{
   const cols='id,workspace_id,source,row_id,row_updated_at,backed_up_at';
   const mine=(await as('authenticated',OWNER,c=>c.query(`select ${cols} from public.app_ed3_text_backups`))).rows;
   assert.equal(mine.length,6);assert.ok(mine.every(r=>r.workspace_id===WS_A));
   assert.equal((await as('authenticated',STRANGER,c=>c.query(`select ${cols} from public.app_ed3_text_backups`))).rows.length,3,'stranger sees only their own workspace rows');
   for(const col of ['raw_text','metadata','*'])await assert.rejects(as('authenticated',OWNER,c=>c.query(`select ${col} from public.app_ed3_text_backups`)),{code:'42501'},col);
   await assert.rejects(as('authenticated',OWNER,c=>c.query(`insert into public.app_ed3_text_backups(workspace_id,source,row_id) values($1,'note',$2)`,[WS_A,ids.mdNote])),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("update public.app_ed3_text_backups set row_updated_at=now()")),{code:'42501'});
   await assert.rejects(as('authenticated',OWNER,c=>c.query("delete from public.app_ed3_text_backups")),{code:'42501'});
   await assert.rejects(as('anon','',c=>c.query('select id from public.app_ed3_text_backups')),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query('select raw_text from public.app_ed3_text_backups')),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query('select id from public.app_ed3_text_backups')),{code:'42501'});
  });
  await t.test('rollback refuses while any row holds a format and keeps the backup',async()=>{
   await pool.query(`update public.app_notes set doc='{"v":"ed1","doc":{"content":[]}}',raw_text='회의' where id=$1`,[ids.mdNote]);
   // The workflow refuses a table drop: this rollback is SQL Editor only (phone path C), like share_page_media.
   assert.throws(()=>plan('rollback','9803'),/rejected/);
   const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/ED3_TEXT_BACKUP_ROLLBACK_BLOCKED: formatted rows exist/);await c.query('rollback');}finally{c.release();}
   assert.equal((await pool.query('select raw_text from public.app_ed3_text_backups where row_id=$1',[ids.mdNote])).rows[0].raw_text,md);
   // Row-level restore (설계 4.1-4) brings the original back; then the rollback can run.
   await pool.query(`update public.app_notes n set doc=null,raw_text=b.raw_text from public.app_ed3_text_backups b where b.row_id=n.id and b.source=n.kind and n.id=$1`,[ids.mdNote]);
   assert.equal((await pool.query('select raw_text from public.app_notes where id=$1',[ids.mdNote])).rows[0].raw_text,md);
  });
  await t.test('rollback removes the table and record once every format is empty; re-apply works',async()=>{
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regclass('public.app_ed3_text_backups') r")).rows[0].r,null);
   assert.equal(v((await pool.query(postcheck)).rows)['table and history agree'],'예');
   const again=await run('apply','9805');assert.equal(again.ok,true,again.summary);
  });
 }finally{
  if(pool)await pool.end();await cluster.stop().catch(()=>{});
 }
});
