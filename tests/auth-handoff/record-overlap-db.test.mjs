// Fresh local PostgreSQL only. No Supabase, OpenAI or production credentials. All data synthetic (no real names).
// MTG-기록겹침거르기 1단계: 20261025190000_record_overlap_db — one table (pair verdicts), owner-only RLS, column privileges (no delete, a pair cannot move),
// the guard trigger (refs exist in the same workspace, a user verdict is never overwritten by ai/link, link needs a real link row),
// the save function (1..20 pairs, all or nothing, order fixed by the function), guarded rollback.
// Applied as written (approved DB workflow expanded rules, or SQL Editor).
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
import {fixture,OWNER,STRANGER,WS_A,WS_B,PROJECT_A,PROJECT_B,ORG_A,ORG_B,MEETING_A,MEETING_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261025190000',name='record_overlap_db',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const uid=(p,n)=>`${p}000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const MEETING_A2=uid('26',2),NOTE_BASKET=uid('27',1),NOTE_BASKET2=uid('27',2),NOTE_PLAIN=uid('27',3),NOTE_BASKET_B=uid('27',4),
 UPD_A=uid('28',1),UPD_B=uid('28',2),ORGUPD_A=uid('29',1),ORGUPD_B=uid('29',2);
const R={
 basket:'basket:'+NOTE_BASKET,basket2:'basket:'+NOTE_BASKET2,plain:'basket:'+NOTE_PLAIN,basketB:'basket:'+NOTE_BASKET_B,
 proj:'project_update:'+UPD_A,projB:'project_update:'+UPD_B,org:'org_update:'+ORGUPD_A,orgB:'org_update:'+ORGUPD_B
};
R.meeting='meeting:'+MEETING_A;R.meeting2='meeting:'+MEETING_A2;R.meetingB='meeting:'+MEETING_B;
const HASH1='0123456789abcdef',HASH2='fedcba9876543210';

// Prerequisite tables the migration only reads (their production definitions are not in the repository): the columns it needs, owner RLS like production.
const prerequisites=`
 create table public.app_notes(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), kind text not null default 'basket');
 create table public.app_project_progress_updates(id uuid primary key, project_id uuid not null references public.app_spaces(id));
 create table public.app_suborganization_updates(id uuid primary key, organization_id uuid not null references public.app_suborganizations(id));
 create table public.app_record_links(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id), note_id uuid, meeting_id uuid);
 grant select on public.app_spaces to authenticated;
 alter table public.app_spaces enable row level security;
 create policy test_owner_all on public.app_spaces for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
 alter table public.app_meetings enable row level security;
 create policy test_owner_all on public.app_meetings for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
 alter table public.app_notes enable row level security;
 create policy test_owner_all on public.app_notes for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
 alter table public.app_record_links enable row level security;
 create policy test_owner_all on public.app_record_links for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
 alter table public.app_project_progress_updates enable row level security;
 create policy test_owner_all on public.app_project_progress_updates for all to authenticated
   using (exists (select 1 from public.app_spaces s where s.id = project_id and private.app_is_workspace_owner(s.workspace_id)));
 alter table public.app_suborganization_updates enable row level security;
 create policy test_owner_all on public.app_suborganization_updates for all to authenticated
   using (exists (select 1 from public.app_suborganizations o where o.id = organization_id and private.app_is_workspace_owner(o.workspace_id)));
 insert into public.app_meetings(id,workspace_id) values ('${MEETING_A2}','${WS_A}');
 insert into public.app_notes(id,workspace_id,kind) values ('${NOTE_BASKET}','${WS_A}','basket'),('${NOTE_BASKET2}','${WS_A}','basket'),('${NOTE_PLAIN}','${WS_A}','note'),('${NOTE_BASKET_B}','${WS_B}','basket');
 insert into public.app_project_progress_updates values ('${UPD_A}','${PROJECT_A}'),('${UPD_B}','${PROJECT_B}');
 insert into public.app_suborganization_updates values ('${ORGUPD_A}','${ORG_A}'),('${ORGUPD_B}','${ORG_B}');
 insert into public.app_record_links(workspace_id,note_id,meeting_id) values ('${WS_A}','${NOTE_BASKET}','${MEETING_A}');
`;

test('record overlaps: migration, owner-only RLS, guard trigger, save function, guarded rollback',{timeout:180000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'record-overlap-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex');
 const cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();await cluster.start();
 let pool;
 try{
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const rows=(where='true',args=[])=>pool.query(`select a_ref,b_ref,verdict,decided_by,keep_ref,reason,a_hash,b_hash,model,updated_at from public.app_record_overlaps where ${where} order by a_ref,b_ref`,args).then(r=>r.rows);
  const count=async()=>(await pool.query('select count(*)::int n from public.app_record_overlaps')).rows[0].n;
  const item=(a,b,over={})=>({a_ref:a,b_ref:b,verdict:'same',decided_by:'ai',reason:'가상 같은 회의',a_hash:HASH1,b_hash:HASH2,model:'가상-모델',...over});
  const setp=(c,items,ws=WS_A)=>c.query('select public.app_record_overlap_set($1,$2::jsonb) as r',[ws,JSON.stringify(items)]).then(r=>r.rows[0].r);
  const direct=(c,a,b,over={})=>{const r={workspace_id:WS_A,verdict:'same',decided_by:'ai',...over};
   return c.query('insert into public.app_record_overlaps(workspace_id,a_ref,b_ref,verdict,decided_by,reason) values($1,$2,$3,$4,$5,$6)',[r.workspace_id,a,b,r.verdict,r.decided_by,r.reason??null]);};
  const values=rs=>Object.fromEntries(rs.map(r=>[r.item,r.value]));

  await t.test('files: expanded rules pass; one table, one policy, one trigger, two functions, no definer; no delete/anon/public/service_role; summary 3 lines',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.createdTables,['app_record_overlaps']);
    assert.deepEqual([...plan.functions].sort(),['private.app_record_overlap_guard','public.app_record_overlap_set']);
    assert.equal(plan.review.definer.length,0);assert.equal(plan.review.policies,1);assert.equal(plan.review.restrictive,0);assert.equal(plan.review.triggers,1);
   }
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.match(code,/^begin;\n/);assert.match(code,/\ncommit;\n$/);
   assert.doesNotMatch(code,/security definer|disable row level security|alter policy|drop policy|\bto (?:anon|public|service_role)\b|using \(true\)|with check \(true\)|rtw_|set_config|grant delete|grant all/i);
   assert.doesNotMatch(code,/\bgrant [^;]* to [^;]*service_role/i);
   assert.match(code,/revoke all on function private\.app_record_overlap_guard\(\) from public, anon, authenticated, service_role;/);
   assert.match(code,/revoke all on function public\.app_record_overlap_set\(uuid, jsonb\) from public, anon, service_role;\s*grant execute on function public\.app_record_overlap_set\(uuid, jsonb\) to authenticated;/);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261025190000', 'record_overlap_db'/);
   // The DB's ref pattern is written in the CHECK and the guard identically; the version file is new (no clash) and listed in the history table.
   const patterns=[...code.matchAll(/'(\^\((?:meeting\|project_update\|org_update\|basket)\):[^']+\$)'/g)].map(m=>m[1]);
   assert.equal(patterns.length,4);assert.equal(new Set(patterns).size,1);
   assert.match(await read('docs/migration-history.md'),/`20261025190000_record_overlap_db\.sql`/);
   // The decision line is recorded in the design document.
   assert.match(await read('docs/design/record-overlap.md'),/결정: 추천대로\(10\/25 16:05\)/);
  });
  const before=(await pool.query(snapshot)).rows;
  await t.test('precheck before apply is all 예',async()=>{
   for(const r of (await pool.query(precheck)).rows.filter(r=>r.item!=='recent migrations'))assert.equal(r.value,'예',r.item);
  });
  await t.test('a missing source table stops the migration before any change',async()=>{
   await pool.query('alter table public.app_record_links rename to app_record_links_away');
   await assert.rejects(pool.query(migration),/RECORD_OVERLAP_PREREQUISITE_CHANGED/);await pool.query('rollback');
   assert.equal(values((await pool.query(precheck)).rows)['source tables and columns present'],'아니오');
   await pool.query('alter table public.app_record_links_away rename to app_record_links');
   assert.equal((await pool.query("select to_regclass('public.app_record_overlaps') as t")).rows[0].t,null);
  });
  await t.test('apply once, postcheck all 예, a second apply is refused',async()=>{
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   assert.equal(await history(),1);
   await assert.rejects(pool.query(migration),/RECORD_OVERLAP_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });
  await t.test('owner: saves pairs of the four kinds; the function puts a pair in order (hashes follow); reading is by owner only',async()=>{
   const r=await owner(c=>setp(c,[
    item(R.meeting,R.basket2),                                  // reversed on purpose: meeting > basket
    item(R.meeting,R.meeting2,{verdict:'different',reason:null,a_hash:null,b_hash:null,model:null}),
    item(R.proj,R.org,{verdict:'unsure'}),                      // org_update < project_update, so reversed again
    item(R.proj,R.basket)]));
   assert.deepEqual(r,{saved:4,kept_user:0});
   const all=await rows();assert.equal(all.length,4);
   for(const x of all)assert.ok(x.a_ref<x.b_ref);
   const swapped=all.find(x=>x.a_ref===R.basket2);
   assert.equal(swapped.b_ref,R.meeting);assert.equal(swapped.a_hash,HASH2);assert.equal(swapped.b_hash,HASH1);
   assert.equal((await rows("verdict='unsure'"))[0].a_ref,R.org);
   const seen=await owner(c=>c.query('select a_ref from public.app_record_overlaps'));assert.equal(seen.rowCount,4);
  });
  await t.test('direct insert: order, shape, kind, verdict, hash, reason, keep and model rules; refs must exist in this workspace',async()=>{
   const attempt=(a,b,over,code,label)=>assert.rejects(owner(async c=>{
    const r={workspace_id:WS_A,verdict:'same',decided_by:'ai',keep_ref:null,reason:null,a_hash:null,b_hash:null,model:null,...over};
    await c.query('insert into public.app_record_overlaps(workspace_id,a_ref,b_ref,verdict,decided_by,keep_ref,reason,a_hash,b_hash,model) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
     [r.workspace_id,a,b,r.verdict,r.decided_by,r.keep_ref,r.reason,r.a_hash,r.b_hash,r.model]);}),{code},label);
   await attempt(R.meeting,R.basket,{},'23514','reversed pair');
   await attempt(R.meeting,R.meeting,{},'23514','same record');
   await attempt(R.basket,'meeting:not-a-uuid',{},'23514','bad shape');
   await attempt(R.basket,R.meeting.toUpperCase(),{},'23514','upper case');
   await attempt(R.basket,'work:'+uid('30',1),{},'23514','kind work is a later step');
   await attempt(R.basket,'call:'+uid('30',1),{},'23514','kind call is a later step');
   await attempt(R.basket,'meeting:'+uid('30',2),{},'22023','meeting does not exist');
   await attempt(R.basket,R.meetingB,{},'22023','meeting of another workspace');
   await attempt(R.basketB,R.meeting,{},'22023','basket of another workspace');
   await attempt(R.plain,R.meeting,{},'22023','a plain note is not a basket');
   await attempt(R.meeting,R.projB,{},'22023','project record of another workspace');
   await attempt(R.orgB,R.proj,{},'22023','org record of another workspace');
   await attempt(R.basket,R.org,{verdict:'maybe'},'23514','verdict');
   await attempt(R.basket,R.org,{decided_by:'robot'},'23514','decided_by');
   await attempt(R.basket,R.org,{a_hash:'xyz'},'23514','hash shape');
   await attempt(R.basket,R.org,{b_hash:'0123456789ABCDEF'},'23514','hash upper');
   await attempt(R.basket,R.org,{reason:'가'.repeat(121)},'23514','reason 121');
   await attempt(R.basket,R.org,{reason:'a\nb'},'23514','reason newline');
   await attempt(R.basket,R.org,{model:''},'23514','empty model');
   await attempt(R.basket,R.org,{model:'m'.repeat(61)},'23514','model 61');
   await attempt(R.basket,R.org,{keep_ref:R.meeting},'23514','keep is neither side');
   await attempt(R.basket,R.meeting,{decided_by:'link',verdict:'different'},'23514','link must be same');
   assert.equal(await count(),4);
   // The longest allowed values pass, and keep may be one of the two sides.
   await owner(c=>c.query("insert into public.app_record_overlaps(workspace_id,a_ref,b_ref,verdict,decided_by,keep_ref,reason,a_hash,b_hash,model) values($1,$2,$3,'same','ai',$4,$5,$6,$7,$8)",
    [WS_A,R.basket,R.org,R.org,'가'.repeat(120),HASH1,HASH2,'m'.repeat(60)]));
   assert.equal(await count(),5);
   await pool.query("delete from public.app_record_overlaps where a_ref=$1 and b_ref=$2",[R.basket,R.org]);
  });
  await t.test('link verdict: only for a basket memo and a business report that a link row joins',async()=>{
   await assert.rejects(owner(c=>setp(c,[item(R.basket2,R.meeting,{decided_by:'link',reason:null})])),{code:'22023'},'no link row');
   await assert.rejects(owner(c=>setp(c,[item(R.basket,R.meeting2,{decided_by:'link',reason:null})])),{code:'22023'},'wrong meeting');
   await assert.rejects(owner(c=>setp(c,[item(R.proj,R.meeting,{decided_by:'link',reason:null})])),{code:'22023'},'not a basket');
   const ok=await owner(c=>setp(c,[item(R.meeting,R.basket,{decided_by:'link',reason:null,a_hash:null,b_hash:null,model:null})]));
   assert.deepEqual(ok,{saved:1,kept_user:0});
   assert.equal((await rows("decided_by='link'")).length,1);
   // Refs of another workspace are refused even where a link row exists.
   await pool.query("insert into public.app_record_links(workspace_id,note_id,meeting_id) values ($1,$2,$3)",[WS_B,NOTE_BASKET_B,MEETING_B]);
   await assert.rejects(owner(c=>setp(c,[item(R.basketB,R.meetingB,{decided_by:'link',reason:null})])),{code:'22023'});
  });
  await t.test('a user verdict is never overwritten by ai or link; user may change anything; ai may refresh ai',async()=>{
   const pairBM=[R.basket2,R.meeting];
   // ai over ai: refreshed.
   const t0=(await rows('a_ref=$1 and b_ref=$2',pairBM))[0].updated_at;
   assert.deepEqual(await owner(c=>setp(c,[item(...pairBM,{verdict:'unsure',reason:'가상 새 이유'})])),{saved:1,kept_user:0});
   let row=(await rows('a_ref=$1 and b_ref=$2',pairBM))[0];assert.equal(row.verdict,'unsure');assert.ok(row.updated_at>t0,'updated_at moves');
   // user over ai.
   assert.deepEqual(await owner(c=>setp(c,[item(...pairBM,{verdict:'different',decided_by:'user',reason:null,a_hash:null,b_hash:null,model:null})])),{saved:1,kept_user:0});
   // ai (function) and ai/link (direct) cannot change it.
   assert.deepEqual(await owner(c=>setp(c,[item(...pairBM,{verdict:'same'})])),{saved:0,kept_user:1});
   assert.equal((await owner(c=>c.query("update public.app_record_overlaps set verdict='same',decided_by='ai' where a_ref=$1 and b_ref=$2",pairBM))).rowCount,0);
   assert.equal((await owner(c=>c.query("update public.app_record_overlaps set verdict='same',decided_by='link' where a_ref=$1 and b_ref=$2",pairBM))).rowCount,0);
   // The guard alone holds even when the update names a different column set (reason/model).
   assert.equal((await owner(c=>c.query("update public.app_record_overlaps set decided_by='ai',reason='가상 덮어쓰기' where a_ref=$1 and b_ref=$2",pairBM))).rowCount,0);
   row=(await rows('a_ref=$1 and b_ref=$2',pairBM))[0];
   assert.deepEqual([row.verdict,row.decided_by,row.reason],['different','user',null]);
   // The same request mixes a protected pair and a new pair: the new one is saved, the protected one reported.
   assert.deepEqual(await owner(c=>setp(c,[item(...pairBM),item(R.meeting,R.meeting2,{verdict:'same'})])),{saved:1,kept_user:1});
   assert.equal((await rows('a_ref=$1 and b_ref=$2',[R.meeting,R.meeting2]))[0].verdict,'same');
   // user over user.
   assert.deepEqual(await owner(c=>setp(c,[item(...pairBM,{verdict:'same',decided_by:'user',reason:null})])),{saved:1,kept_user:0});
   // ai cannot overwrite link; user can.
   const linked=[R.basket,R.meeting];
   assert.deepEqual(await owner(c=>setp(c,[item(...linked,{verdict:'different'})])),{saved:0,kept_user:1});
   assert.equal((await rows('a_ref=$1 and b_ref=$2',linked))[0].decided_by,'link');
   assert.deepEqual(await owner(c=>setp(c,[item(...linked,{verdict:'different',decided_by:'user',reason:null})])),{saved:1,kept_user:0});
  });
  await t.test('a pair, its workspace and its id cannot be moved or changed; no delete',async()=>{
   for(const set of ["a_ref='basket:"+NOTE_BASKET2+"'","b_ref='meeting:"+MEETING_A2+"'","workspace_id='"+WS_B+"'","id=gen_random_uuid()","created_at=now()"])
    await assert.rejects(owner(c=>c.query('update public.app_record_overlaps set '+set)),{code:'42501'},set);
   await assert.rejects(owner(c=>c.query('delete from public.app_record_overlaps')),{code:'42501'});
   await assert.rejects(owner(c=>c.query('truncate public.app_record_overlaps')),{code:'42501'});
   assert.equal((await owner(c=>c.query("update public.app_record_overlaps set reason='가상 고침' where b_ref=$1",[R.proj]))).rowCount>0,true);
  });
  await t.test('function: 1..20 pairs, shape, all or nothing',async()=>{
   const before=await count();
   await assert.rejects(owner(c=>setp(c,[])),{code:'22023'},'0 pairs');
   await assert.rejects(owner(c=>setp(c,Array.from({length:21},(_, i)=>item(R.basket,R.meeting,{reason:'n'+i})))),{code:'22023'},'21 pairs');
   await assert.rejects(owner(c=>c.query("select public.app_record_overlap_set($1,'{}'::jsonb)",[WS_A])),{code:'22023'},'object');
   await assert.rejects(owner(c=>c.query("select public.app_record_overlap_set($1,null)",[WS_A])),{code:'22023'},'null');
   await assert.rejects(owner(c=>setp(c,[1])),{code:'22023'},'not an object');
   await assert.rejects(owner(c=>setp(c,[{...item(R.basket,R.meeting),extra:'x'}])),{code:'22023'},'unknown key');
   await assert.rejects(owner(c=>setp(c,[{...item(R.basket,R.meeting),reason:5}])),{code:'22023'},'number value');
   await assert.rejects(owner(c=>setp(c,[{...item(R.basket,R.meeting),model:{a:1}}])),{code:'22023'},'object value');
   await assert.rejects(owner(c=>setp(c,[{verdict:'same',decided_by:'ai'}])),{code:'22023'},'no refs');
   await assert.rejects(owner(c=>setp(c,[item(R.basket,R.meeting,{verdict:'perhaps'})])),{code:'23514'},'verdict');
   await assert.rejects(owner(c=>c.query('select public.app_record_overlap_set(null,$1::jsonb)',[JSON.stringify([item(R.basket,R.meeting)])])),{code:'42501'},'no workspace');
   // All or nothing: a good new pair followed by a bad one saves nothing.
   await assert.rejects(owner(c=>setp(c,[item(R.org,R.meeting2,{verdict:'same'}),item(R.basket,'meeting:'+uid('30',9))])),{code:'22023'});
   assert.equal(await count(),before);
   // 20 pairs pass (the same pair repeated is fine: the last write wins).
   assert.deepEqual(await owner(c=>setp(c,Array.from({length:20},(_, i)=>item(R.org,R.meeting2,{reason:'n'+i})))),{saved:20,kept_user:0});
   assert.equal((await rows('a_ref=$1 and b_ref=$2',[R.meeting2,R.org].sort()))[0].reason,'n19');
  });
  await t.test('stranger, no-login, anon and service_role see and change nothing',async()=>{
   assert.deepEqual((await stranger(c=>c.query('select id from public.app_record_overlaps'))).rows,[]);
   assert.equal((await stranger(c=>c.query("update public.app_record_overlaps set reason='가상 남'"))).rowCount,0);
   await assert.rejects(stranger(c=>setp(c,[item(R.basket,R.meeting)])),{code:'42501'},'stranger function, my workspace');
   await assert.rejects(stranger(c=>direct(c,R.basket,R.org)),e=>['42501','22023'].includes(e.code),'stranger insert (the guard cannot see the records, or the policy refuses)');
   assert.deepEqual((await as('authenticated',null,c=>c.query('select id from public.app_record_overlaps'))).rows,[]);
   await assert.rejects(as('authenticated',null,c=>setp(c,[item(R.basket,R.meeting)])),{code:'42501'},'no login function');
   // The owner of one workspace cannot write into another workspace with refs of their own.
   await assert.rejects(owner(c=>setp(c,[item(R.basket,R.meeting)],WS_B)),{code:'42501'},'owner into another workspace');
   for(const role of ['anon','service_role']){
    await assert.rejects(as(role,null,c=>c.query('select 1 from public.app_record_overlaps')),{code:'42501'},role);
    await assert.rejects(as(role,null,c=>setp(c,[item(R.basket,R.meeting)])),{code:'42501'},role+' function');
   }
   await assert.rejects(owner(c=>c.query('select private.app_record_overlap_guard()')),{code:'42501'},'guard is not callable');
  });
  await t.test('rollback stops while a user verdict exists; otherwise restores the snapshot; re-apply works',async()=>{
   assert.ok((await rows("decided_by='user'")).length>0);
   await assert.rejects(pool.query(rollbackSQL),/RECORD_OVERLAP_ROLLBACK_BLOCKED: user verdict rows exist/);await pool.query('rollback');
   assert.equal(await history(),1);
   await pool.query("delete from public.app_record_overlaps where decided_by='user'");
   assert.ok(await count()>0,'ai and link rows remain and are allowed to go');
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
   await pool.query(migration);assert.equal(await history(),1);
   for(const r of (await pool.query(postcheck)).rows)assert.equal(r.ok,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster.stop();
 }
});
