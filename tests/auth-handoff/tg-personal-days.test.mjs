// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic (no real names, rooms or numbers).
// TG-개인대화 1단계: 20261025030000_tg_personal_days — app_tg_personal_days (room-day AI summary, no raw text column), owner-only RLS for authenticated,
// column grants (authenticated: pin/hide; service_role: insert + duplicate-check columns), no trigger, guarded rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {trackPool,closePool} from './pg-close.mjs';
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261025030000',name='tg_personal_days',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const ROW={day:'2026-10-24',room_key:'room-p1',room_label:'가상 개인방',one_line:'가상: 주말 약속과 선물 이야기',
 remember:['[확정] 다음 달 3일이 기념일','[확인] 병원 예약은 불분명'],todo:['[예정] 선물 미리 주문하기'],message_count:42,
 source_ref:'tgp:room-p1:2026-10-24',drive_url:'https://drive.google.com/drive/folders/fakefolder001',model:'fake-model',judged_at:'2026-10-25T00:10:00Z'};
const COLS=['workspace_id','day','room_key','room_label','one_line','remember','todo','message_count','source_ref','drive_url','model','judged_at'];

test('tg personal days: migration, owner-only RLS, column grants, no raw text, guarded rollback',{timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tg-personal-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);
  // Hosted service_role has no USAGE on schema private: prove the insert path needs no private function or name resolution.
  await pool.query('revoke usage on schema private from service_role');
  const migration=await read('supabase/migrations/'+stem+'.sql'),rollbackSQL=await read('docs/'+stem+'.rollback.sql');
  const precheck=await read('docs/'+stem+'.precheck.sql'),postcheck=await read('docs/'+stem+'.postcheck.sql'),snapshot=await read('docs/'+stem+'.snapshot.sql');
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  // What collector-feed will send (service role, duplicates ignored).
  const put=(c,row,over={})=>{const r={workspace_id:WS_A,...row,...over};const cols=COLS.filter(k=>k in r);
   return c.query(`insert into public.app_tg_personal_days(${cols.join(',')}) values(${cols.map((k,i)=>['remember','todo'].includes(k)?`$${i+1}::jsonb`:`$${i+1}`).join(',')}) on conflict do nothing`,
    cols.map(k=>['remember','todo'].includes(k)?JSON.stringify(r[k]):r[k]));};
  const count=async()=>(await pool.query('select count(*)::int n from public.app_tg_personal_days')).rows[0].n;

  await t.test('files: read-only checks, three-line summary, expanded approved workflow accepts the file, no anon/PUBLIC, no raw column',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
   }
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   assert.match(rollbackSQL,/SQL Editor\(폰 경로 C\) 전용/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/delete from public|update public|truncate|cascade|grant |policy/i);
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/security definer|disable row level|to anon|to public|rtw_|grant delete|grant all|drop policy|alter policy|with grant option|create trigger|create function/i);
   assert.doesNotMatch(code.replace(/private\.app_is_workspace_owner/g,''),/private\./);
   assert.doesNotMatch(code,/raw_|app_feed_items|app_feed_days|search_records/i);
   assert.equal((code.match(/create policy [a-z_]+ on public\.app_tg_personal_days for all to authenticated/g)||[]).length,1);
   assert.match(code,/revoke all on table public\.app_tg_personal_days from public, anon, authenticated, service_role;/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261025030000', 'tg_personal_days'/);
  });
  await t.test('isolation: search_records and ai-assist sources never mention the personal table',async()=>{
   const dirs=['supabase/migrations','supabase/functions/ai-assist'];
   for(const d of dirs)for(const f of await readdir(new URL('../../'+d,import.meta.url))){
    if(f===stem+'.sql'||!/\.(sql|ts|js|mjs)$/.test(f))continue;
    assert.doesNotMatch(await read(d+'/'+f),/app_tg_personal/,d+'/'+f);
   }
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck before apply is all 예',async()=>{
   for(const r of (await pool.query(precheck)).rows.filter(r=>r.item!=='recent migrations'))assert.equal(r.value,'예',r.item);
  });
  await t.test('apply once, postcheck all 예, a second apply is refused',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(),1);
   await assert.rejects(pool.query(migration),/TG_PERSONAL_DAYS_PREREQUISITE_CHANGED/);await pool.query('rollback');
   const cols=(await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='app_tg_personal_days'")).rows.map(r=>r.column_name);
   assert.equal(cols.some(c=>/raw|text|body|message$/.test(c)),false,'no raw conversation column: '+cols.join(','));
  });
  await t.test('server: inserts a room-day once without private schema access; cannot update, delete, pin, hide or read content',async()=>{
   await server(c=>put(c,ROW));
   await server(c=>put(c,ROW,{one_line:'다른 요약'}));
   await server(c=>put(c,ROW,{source_ref:'tgp:room-p1:other'}));
   assert.equal(await count(),1,'same source_ref or same room-day is stored once');
   assert.equal((await pool.query('select one_line from public.app_tg_personal_days')).rows[0].one_line,ROW.one_line);
   assert.equal((await server(c=>c.query('select source_ref,room_key,day from public.app_tg_personal_days where workspace_id=$1',[WS_A]))).rowCount,1);
   await assert.rejects(server(c=>c.query('select one_line from public.app_tg_personal_days')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select remember from public.app_tg_personal_days')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select * from public.app_tg_personal_days')),{code:'42501'});
   await assert.rejects(server(c=>c.query("insert into public.app_tg_personal_days(workspace_id,day,room_key,room_label,one_line,source_ref,pinned_at) values($1,'2026-10-23','room-p1','가상','요약','tgp:x1',now())",[WS_A])),{code:'42501'});
   await assert.rejects(server(c=>c.query("insert into public.app_tg_personal_days(workspace_id,day,room_key,room_label,one_line,source_ref,hidden_at) values($1,'2026-10-23','room-p1','가상','요약','tgp:x2',now())",[WS_A])),{code:'42501'});
   await assert.rejects(server(c=>c.query("update public.app_tg_personal_days set one_line='x'")),{code:'42501'});
   await assert.rejects(server(c=>c.query("delete from public.app_tg_personal_days")),{code:'42501'});
  });
  await t.test('shape rules: lengths, arrays, control characters, refs, drive link, counts',async()=>{
   const bad=[
    [{one_line:''},'empty one line'],[{one_line:'   '},'blank one line'],[{one_line:'가'.repeat(201)},'201 one line'],[{one_line:'a\nb'},'newline one line'],
    [{room_label:'a\u0007'},'control label'],[{room_label:'가'.repeat(101)},'101 label'],[{room_key:'room p'},'bad room key'],
    [{remember:['a',1]},'number item'],[{remember:Array.from({length:11},(_,i)=>'p'+i)},'11 remember'],[{remember:['  ']},'blank item'],
    [{remember:['가'.repeat(151)]},'151 item'],[{remember:{a:'b'}},'object remember'],[{todo:['a\tb\u0001']},'control item'],
    [{todo:Array.from({length:11},(_,i)=>'t'+i)},'11 todo'],[{todo:['가'.repeat(151)]},'151 todo'],
    [{message_count:5001},'5001 count'],[{message_count:-1},'negative count'],[{source_ref:'tgp:a b'},'bad ref'],[{drive_url:'http://example.com/x'},'not drive'],
   ];
   for(const [over,label] of bad)await assert.rejects(server(c=>put(c,ROW,{day:'2026-10-20',room_key:over.room_key||'room-q',source_ref:'tgp:shape:'+label.replace(/ /g,'-'),...over})),{code:/^(23514|23502)$/},label);
   assert.equal(await count(),1);
   await server(c=>put(c,ROW,{day:'2026-10-21',source_ref:'tgp:edge',remember:['가'.repeat(150)],todo:Array.from({length:10},(_,i)=>'t'+i),one_line:'가'.repeat(200)}));
   assert.equal(await count(),2,'edge sizes are allowed');
   await assert.rejects(server(c=>put(c,ROW,{day:'2026-10-22',source_ref:'tgp:nolabel',room_label:null})),{code:'23502'});
   await pool.query("delete from public.app_tg_personal_days where source_ref='tgp:edge'");
  });
  await t.test('owner: reads, pins and hides only; cannot insert, delete, edit content or change workspace',async()=>{
   assert.equal((await owner(c=>c.query('select id,one_line,remember,todo from public.app_tg_personal_days'))).rowCount,1);
   assert.equal((await owner(c=>c.query("update public.app_tg_personal_days set pinned_at=now(),updated_at=now()"))).rowCount,1);
   assert.equal((await owner(c=>c.query("update public.app_tg_personal_days set hidden_at=now()"))).rowCount,1);
   await assert.rejects(owner(c=>c.query("update public.app_tg_personal_days set one_line='바꾸기'")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_tg_personal_days set remember='[]'::jsonb")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_tg_personal_days set todo='[]'::jsonb")),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_tg_personal_days set workspace_id=$1",[WS_B])),{code:'42501'});
   await assert.rejects(owner(c=>put(c,ROW,{source_ref:'tgp:own',day:'2026-10-19'})),{code:'42501'});
   await assert.rejects(owner(c=>c.query('delete from public.app_tg_personal_days')),{code:'42501'});
   const row=(await pool.query('select pinned_at,hidden_at from public.app_tg_personal_days')).rows[0];
   assert.ok(row.pinned_at&&row.hidden_at);
  });
  await t.test('stranger and anon see and change nothing',async()=>{
   assert.equal((await stranger(c=>c.query('select id from public.app_tg_personal_days'))).rowCount,0);
   assert.equal((await stranger(c=>c.query("update public.app_tg_personal_days set pinned_at=null"))).rowCount,0);
   await assert.rejects(anon(c=>c.query('select id from public.app_tg_personal_days')),{code:'42501'});
   await assert.rejects(as('public_probe','',c=>c.query('select id from public.app_tg_personal_days')),{code:'42501'});
   // Work feed tables stay invisible to the personal path and vice versa: the personal table is not part of any existing table.
   assert.equal((await pool.query("select count(*)::int n from pg_depend d join pg_class c on c.oid=d.refobjid where d.classid='pg_constraint'::regclass and c.relname='app_tg_personal_days' and d.objid in (select oid from pg_constraint where contype='f' and conrelid<>'public.app_tg_personal_days'::regclass)")).rows[0].n,0,'no other table points at it');
  });
  await t.test('rollback stops while rows exist; after cleanup it restores the snapshot; re-apply works',async()=>{
   await assert.rejects(pool.query(rollbackSQL),/TG_PERSONAL_DAYS_ROLLBACK_BLOCKED: personal summary rows exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   await pool.query('delete from public.app_tg_personal_days where id is not null');
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   await pool.query(migration);assert.equal(await history(),1);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
