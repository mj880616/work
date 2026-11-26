// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// CALL-맥락사람: 20261026160000_call_context_people - one read-only SECURITY DEFINER function, executable by service_role only,
// returns organization/person name text from business calls (user edits first); nothing else leaves the database.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261026160000',name='call_context_people',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const CALL={workspace_id:WS_A,source:'call',day:'2026-10-25',occurred_at:'2026-10-25T01:10:00Z',title:'가상 통화',raw_count:0,points:'["가상 가"]'};
const MISSING='99999999-9999-4999-8999-999999999999';
const ID=/^[0-9a-f-]{36}$/;

test('call context people: one service_role-only read function returns names of business-call counterparts, user edits first; nothing else; rollback removes only the function',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'call-context-people-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query("alter table public.app_suborganizations add column aliases text[] not null default '{}', add column active boolean not null default true, add column deleted_at timestamptz");
  await pool.query('revoke usage on schema private from service_role');
  await pool.query('grant select on public.app_spaces to authenticated');
  await pool.query('alter table public.app_spaces enable row level security');
  await pool.query('create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
  for(const f of ['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box','20261026120000_call_user_edit'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const ORG_C='23000000-0000-4000-8000-000000000003',ORG_OFF='23000000-0000-4000-8000-000000000004',ORG_DEL='23000000-0000-4000-8000-000000000005';
  await pool.query("update public.app_suborganizations set name='가상노동조합',aliases=array['가상노조','가노'] where id=$1",[ORG_A]);
  await pool.query("update public.app_suborganizations set name='남의노조' where id=$1",[ORG_B]);
  await pool.query("insert into public.app_suborganizations(id,workspace_id,name,aliases,active,deleted_at) values($1,$3,'예시지부','{}',true,null),($2,$3,'쓰지않는지부','{}',false,null),($4,$3,'휴지통지부','{}',true,now())",[ORG_C,ORG_OFF,WS_A,ORG_DEL]);
  const at=n=>`2026-10-2${n}T01:10:00Z`;
  const put=async(ref,over={})=>{const r={...CALL,source_ref:ref,...over};const cols=Object.keys(r);const x=await pool.query(`insert into public.app_feed_items(${cols.join(',')}) values(${cols.map((k,i)=>k==='points'?`$${i+1}::jsonb`:`$${i+1}`).join(',')}) returning id`,cols.map(k=>r[k]));return x.rows[0].id;};
  const edit=(id,patch)=>owner(c=>c.query('select public.app_call_edit($1,$2::jsonb) r',[id,JSON.stringify(patch)])).then(r=>r.rows[0].r);
  const people=(ws,limit)=>server(c=>limit===undefined?c.query('select * from public.app_call_context_people($1)',[ws]):c.query('select * from public.app_call_context_people($1,$2)',[ws,limit])).then(r=>r.rows);
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; one definer function, one grant to service_role only, no table, policy or trigger change; summary 3 lines; rollback shape',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.functions,['public.app_call_context_people']);
    assert.deepEqual(plan.review.definer,['public.app_call_context_people']);
    assert.deepEqual(plan.createdTables,[]);
    assert.equal(plan.review.policies,0);assert.equal(plan.review.triggers,0);assert.equal(plan.review.grants,1);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant execute on function public.app_call_context_people(uuid, integer) to service_role;']);
   assert.doesNotMatch(code,/create table|create policy|create trigger|alter table|alter policy|drop policy|create or replace|rtw_|disable row level security|\bto (anon|public|authenticated)\b/i);
   // 읽는 칸은 통화 상대·조직 연결·시각·지우기 표시와 조직 이름뿐이다(전문·요약·핵심내용·제목·주소·ID는 읽지도 않는다).
   assert.doesNotMatch(code,/\b(raw_text|drive_url|source_ref|summary|points|title|app_call_personal|app_call_edit_history|phone|memo)\b/i);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261026160000', 'call_context_people'/);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/truncate|drop table|delete from public/i);
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9972');assert.equal(apply.ok,true,apply.summary);
   const post=values(await readOnly(postcheck));
   for(const [item,value] of Object.entries(post)){
    if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
    else if(v[item]!==undefined)assert.equal(value,v[item],item);
   }
   assert.equal((await run('apply','9973')).ok,false);
  });
  await t.test('service_role gets name-level rows only: user edits first, AI values otherwise; personal box, trash, other workspace and unusable organizations left out',async()=>{
   const a=await put('call:cp1',{counterpart:'가상노동조합 홍길동 위원장',organization_id:ORG_A,occurred_at:at(1),title:'제목에 번호 010-0000-0000',summary:'요약 비공개'});
   await put('call:cp2',{counterpart:'가상노동조합 홍길동 위원장',organization_id:ORG_A,occurred_at:at(2)});
   const b=await put('call:cp3',{counterpart:'AI가 틀리게 쓴 이름',organization_id:ORG_A,occurred_at:at(3)});
   await put('call:cp4',{counterpart:'예시지부 김철수 과장',organization_id:ORG_C,occurred_at:at(4)});
   await put('call:cp5',{counterpart:'공공운수노조 이영희 팀장',organization_id:null,occurred_at:at(8)});
   await put('call:cp6',{counterpart:'쓰지않는지부 박민수',organization_id:ORG_OFF,occurred_at:at(7)});
   await put('call:cp7',{counterpart:'휴지통지부 최지우',organization_id:ORG_DEL,occurred_at:at(6)});
   await put('call:cp8',{counterpart:'지운 통화 상대',organization_id:ORG_A,occurred_at:at(9),hidden_at:'2026-10-25T00:00:00Z'});
   await put('call:cp9',{counterpart:null,organization_id:ORG_A,occurred_at:at(9)});
   await put('call:cp10',{counterpart:'남의 작업공간 상대',organization_id:ORG_B,workspace_id:WS_B,occurred_at:at(9)});
   await pool.query("insert into public.app_call_personal(workspace_id,kind,day,occurred_at,title,counterpart,source_ref) values($1,'personal','2026-10-25',$2,'가상 개인 통화','개인 통화 상대','call:cpp1')",[WS_A,at(9)]);
   await edit(b,{counterpart:'예시지부 정수진 과장',organization_id:ORG_C});
   await edit(a,{title:'제목만 고침'});
   const rows=await people(WS_A);
   assert.deepEqual(Object.keys(rows[0]).sort(),['counterpart','organization_aliases','organization_name','user_edited']);
   assert.deepEqual(rows.map(r=>[r.organization_name,r.counterpart,r.user_edited]),[
    ['예시지부','예시지부 정수진 과장',true],
    [null,'공공운수노조 이영희 팀장',false],
    [null,'쓰지않는지부 박민수',false],
    [null,'휴지통지부 최지우',false],
    ['예시지부','예시지부 김철수 과장',false],
    ['가상노동조합','가상노동조합 홍길동 위원장',false],
   ]);
   assert.deepEqual(rows.find(r=>r.organization_name==='가상노동조합').organization_aliases,['가상노조','가노']);
   const text=JSON.stringify(rows);
   assert.doesNotMatch(text,/010|비공개|제목|AI가 틀리게|지운 통화|남의|개인 통화 상대|23000000|[0-9a-f]{8}-[0-9a-f]{4}-/);
   // 고친 값은 AI 값보다 앞서고, 되돌리면(reset) AI 값이 다시 나온다. 상대 글을 비우면 그 줄은 나가지 않는다.
   await edit(b,{reset:['counterpart','organization_id']});
   assert.ok((await people(WS_A)).some(r=>r.counterpart==='AI가 틀리게 쓴 이름'&&r.user_edited===false));
   await edit(b,{counterpart:''});
   assert.ok(!(await people(WS_A)).some(r=>r.counterpart==='AI가 틀리게 쓴 이름'||r.counterpart===''));
   await edit(b,{reset:['counterpart']});
   // 조직 연결을 지운(null) 고침: 조직 칸이 비고 상대 글은 AI 값 그대로
   await edit(a,{organization_id:null});
   const unlinked=(await people(WS_A)).find(r=>r.counterpart==='가상노동조합 홍길동 위원장');
   assert.equal(unlinked.organization_name,null);assert.equal(unlinked.user_edited,true);
   await edit(a,{reset:['organization_id']});
   assert.deepEqual((await people(WS_B)).map(r=>r.counterpart),['남의 작업공간 상대']);
   assert.deepEqual(await people('99999999-9999-4999-8999-999999999999'),[]);
  });
  await t.test('p_limit is clamped to 1..500 (null and 0 count as the default and 1)',async()=>{
   assert.equal((await people(WS_A,1)).length,1);
   assert.equal((await people(WS_A,0)).length,1);
   assert.equal((await people(WS_A,null)).length,(await people(WS_A)).length);
   for(let i=0;i<30;i++)await put('call:many'+i,{counterpart:'가상노동조합 대량'+i,organization_id:ORG_A,occurred_at:at(1)});
   assert.equal((await people(WS_A,10000)).length,(await people(WS_A,500)).length);
   assert.equal((await people(WS_A,5)).length,5);
  });
  await t.test('only service_role can run it: anon, authenticated owner, stranger and PUBLIC are refused; the underlying tables stay closed to service_role',async()=>{
   for(const run of [()=>as('anon','',c=>c.query('select * from public.app_call_context_people($1)',[WS_A])),()=>owner(c=>c.query('select * from public.app_call_context_people($1)',[WS_A])),()=>stranger(c=>c.query('select * from public.app_call_context_people($1)',[WS_A])),()=>as('public_probe','',c=>c.query('select * from public.app_call_context_people($1)',[WS_A]))])
    await assert.rejects(run(),{code:'42501'});
   await assert.rejects(server(c=>c.query('select * from public.app_call_edits')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select counterpart from public.app_call_personal')),{code:'42501'});
   const acl=(await pool.query("select proacl::text a from pg_proc where oid='public.app_call_context_people(uuid,integer)'::regprocedure")).rows[0].a;
   assert.doesNotMatch(acl,/(^|[{,])=/);
   // 다른 통화 표의 권한은 이 migration 앞뒤로 같다(snapshot에서 함수 줄만 새로 생김)
   const after=(await pool.query(snapshot)).rows;
   const strip=rows=>rows.filter(r=>!(r.kind==='function'&&r.name.includes('app_call_context_people'))&&!(r.kind==='history'));
   assert.deepEqual(strip(after),strip(before));
  });
  await t.test('rollback removes only the function and the history row; running it twice is refused; re-apply works',async()=>{
   const rowsBefore=(await pool.query('select count(*)::int n from public.app_feed_items')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regprocedure('public.app_call_context_people(uuid,integer)') f")).rows[0].f,null);
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_items')).rows[0].n,rowsBefore);
   assert.equal((await pool.query('select count(*)::int n from public.app_call_edits')).rows[0].n>0,true);
   await assert.rejects(query(rollbackSQL));
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
