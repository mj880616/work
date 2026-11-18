// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic (made-up names).
// COLLAB-묶인사람끼리공유 1단계 DB(20261118110000_collab_groups): 묶음·멤버·초대 링크·같은 이름 요청.
// 지키는 것: 표 직접 접근 0(RLS 켬·정책 0·API 권한 0), 함수는 authenticated만·auth.uid() 필수, 남의 묶음 읽기·쓰기 거절,
// 관리자 아닌 사람의 초대 링크·요청 수락·내보내기·넘기기 거절(결정 ⑥⑦), 같은 이름 요청은 있든 없든 같은 응답·하루 3번,
// 초대 링크 원문 저장 안 함·틀림/지남/다 씀/꺼짐 같은 거절, 기존 owner 경계 무변경, 되돌리기 뒤 카탈로그 원래대로.
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
import {fixture,OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261118110000',name='collab_groups',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const USER_C='20000000-0000-4000-8000-000000000003',USER_D='20000000-0000-4000-8000-000000000004',USER_E='20000000-0000-4000-8000-000000000005';
const NO_WS='20000000-0000-4000-8000-000000000009',NO_NAME='20000000-0000-4000-8000-000000000008';
const WS_C='21000000-0000-4000-8000-000000000003',WS_D='21000000-0000-4000-8000-000000000004',WS_E='21000000-0000-4000-8000-000000000005',WS_N='21000000-0000-4000-8000-000000000008';
// 운영과 같은 모양의 프로필 표(owner 정책) — 이 migration은 읽기만 한다.
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  insert into supabase_migrations.schema_migrations(version,name) values ('20261115223000','profile_union_department');
  create table public.app_profiles(user_id uuid primary key,display_name text,job_title text,union_name text,department_name text);
  alter table public.app_profiles enable row level security;
  revoke all on table public.app_profiles from public, anon, authenticated, service_role;
  grant select, insert, update on table public.app_profiles to authenticated;
  create policy task12a_owner_all on public.app_profiles for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  insert into public.app_workspaces values ('${WS_C}'),('${WS_D}'),('${WS_E}'),('${WS_N}');
  insert into public.app_workspace_members values ('${WS_C}','${USER_C}','owner'),('${WS_D}','${USER_D}','owner'),('${WS_E}','${USER_E}','owner'),('${WS_N}','${NO_NAME}','owner');
  insert into public.app_profiles(user_id,display_name,job_title) values
    ('${OWNER}','  가상  관리자 ','부장'),('${STRANGER}','가상 남','국장'),('${USER_C}','가상 셋',null),('${USER_D}','가상 넷','간사'),('${USER_E}','가상 다섯','차장'),('${NO_NAME}','   ',null);
  revoke usage on schema private from service_role;`;

test('collab groups db: plan, dry-run, apply, closed tables, admin-only invite/request, same-name privacy, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'collab-groups-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,sql,params=[]){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await c.query(sql,params);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const rpc=(sub,fn,args=[])=>as('authenticated',sub,`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as r`,args).then(r=>r[0].r);
  const refuse=async(p,msg)=>{await assert.rejects(p,e=>{assert.equal(e.message,msg);return true;});};
  const groups=sub=>rpc(sub,'app_collab_my_groups');
  const create=(sub,kind,u,d,agree=true)=>rpc(sub,'app_collab_group_create',[kind,u,d,agree]);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);
  const publicFns=['app_collab_group_create(text,text,text,boolean)','app_collab_invite_create(uuid)','app_collab_invite_revoke_all(uuid)','app_collab_invite_peek(text)','app_collab_invite_accept(text,boolean)','app_collab_request_decide(uuid,boolean)','app_collab_my_groups()','app_collab_leave(uuid)','app_collab_member_remove(uuid)','app_collab_admin_move(uuid)'];
  const tables=['app_collab_groups','app_collab_members','app_collab_invites','app_collab_join_requests','app_collab_join_attempts','app_collab_member_log'];

  await t.test('files: expanded rules, 13 functions, only authenticated execute grants, no existing table touched, summary 3 lines',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   const plan=prepareMigration({mode:'apply',version,runId:'1',root});
   assert.equal(plan.rules,'expanded');
   assert.equal([...plan.functions].length,13);
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.equal(grants.length,10);
   for(const g of grants)assert.match(g,/^grant execute on function public\.app_collab_[a-z_]+\([a-z, ]*\) to authenticated;$/);
   // 기존 표·옛 협업 구조를 바꾸거나 되살리지 않는다. 정책을 만들지 않는다.
   assert.doesNotMatch(code,/alter table public\.app_(workspace|profiles|workspaces)|create policy|app_invites|app_event_attendees|app_project_members|insert into public\.app_workspace_members|update public\.app_workspace_members|rtw_|\bto (anon|public)\b/i);
   // 함수는 workspace·user id를 입력으로 받지 않는다.
   for(const m of code.matchAll(/create function (public|private)\.app_collab_\w+\(([^)]*)\)/g))assert.doesNotMatch(m[2],/workspace|user/i,m[0]);
   // 공개 함수마다 auth.uid() 확인과 DEFINER·빈 search_path.
   const bodies=code.split(/create function /).slice(1);
   for(const b of bodies.filter(b=>b.startsWith('public.'))){assert.match(b,/security definer\s+set search_path = ''/);assert.match(b,/COLLAB_AUTH_REQUIRED/);}
   for(const b of bodies.filter(b=>b.startsWith('private.')))assert.match(b,/security invoker\s+set search_path = ''/);
   assert.doesNotMatch(rollbackSQL.replace(/--.*$/gm,''),/app_profiles|app_workspace|truncate|cascade|grant /i);
  });
  await t.test('precheck yes, dry-run changes nothing, apply passes postcheck, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9982');assert.equal(apply.ok,true,apply.summary);
   const post=await readOnly(postcheck);
   for(const r of post)if(r.item!=='existing owner boundary hash')assert.equal(r.ok,'예',r.item);
   assert.equal(post.find(r=>r.item==='existing owner boundary hash').ok,beforeCheck.find(r=>r.item==='existing owner boundary hash').value);
   assert.equal((await run('apply','9983')).ok,false);
  });
  await t.test('tables closed to every API role; functions not executable by anon or service_role; no login refused',async()=>{
   for(const tb of tables){
    for(const role of ['authenticated','anon']){
     await assert.rejects(as(role,OWNER,`select count(*) from public.${tb}`),/permission denied/);
     await assert.rejects(as(role,OWNER,`delete from public.${tb} where true`),/permission denied/);
    }
   }
   await assert.rejects(as('authenticated',OWNER,"insert into public.app_collab_members(group_id,user_id,workspace_id,member_role,display_name) values (gen_random_uuid(),$1,$2,'admin','x')",[OWNER,WS_A]),/permission denied/);
   for(const fn of publicFns){
    const [{anon,svc,auth}]=(await pool.query(`select has_function_privilege('anon','public.${fn}','execute') anon,has_function_privilege('service_role','public.${fn}','execute') svc,has_function_privilege('authenticated','public.${fn}','execute') auth`)).rows;
    assert.deepEqual([anon,svc,auth],[false,false,true],fn);
   }
   for(const fn of ['app_collab_clean_name(text)','app_collab_my_workspace()','app_collab_my_role(uuid)'])
    assert.equal((await pool.query(`select has_function_privilege('authenticated','private.${fn}','execute') a`)).rows[0].a,false,fn);
   await assert.rejects(as('anon','',"select public.app_collab_my_groups()"),/permission denied/);
   await refuse(rpc('','app_collab_my_groups'),'COLLAB_AUTH_REQUIRED');
   await refuse(create('',"dept",'가상노조','정책실'),'COLLAB_AUTH_REQUIRED');
  });

  let deptA,unionA;
  await t.test('create: consent, profile name, name shape, workspace required; cleaned names; creator is the one admin',async()=>{
   await refuse(create(OWNER,'dept','가상노조','정책실',false),'COLLAB_CONSENT_REQUIRED');
   await refuse(create(NO_NAME,'dept','가상노조','정책실'),'COLLAB_PROFILE_NAME_REQUIRED');
   await refuse(create(NO_WS,'dept','가상노조','정책실'),'COLLAB_WORKSPACE_REQUIRED');
   await refuse(create(OWNER,'dept','가상노조',''),'COLLAB_NAME_INVALID');
   await refuse(create(OWNER,'union','가상노조','정책실'),'COLLAB_NAME_INVALID');
   await refuse(create(OWNER,'team','가상노조','정책실'),'COLLAB_NAME_INVALID');
   await refuse(create(OWNER,'dept','가'.repeat(61),'정책실'),'COLLAB_NAME_INVALID');
   await refuse(create(OWNER,'dept','가상\u0007노조','정책실'),'COLLAB_NAME_INVALID');
   assert.equal(await create(OWNER,'dept','  가상노조 ','정책   실'),'COLLAB_GROUP_CREATED');
   assert.equal(await create(OWNER,'union','가상노조',null),'COLLAB_GROUP_CREATED');
   const mine=await groups(OWNER);
   assert.equal(mine.length,2);
   [deptA,unionA]=mine;
   assert.deepEqual([deptA.kind,deptA.union_name,deptA.dept_name,deptA.my_role],['dept','가상노조','정책 실','admin']);
   assert.deepEqual([unionA.kind,unionA.dept_name],['union',null]);
   assert.deepEqual(deptA.members.map(m=>[m.name,m.title,m.role,m.me]),[['가상 관리자','부장','admin',true]]);
   assert.deepEqual(deptA.requests,[]);assert.equal(deptA.invites_live,0);
   // 돌려주는 칸에 user_id·workspace_id 없음.
   assert.doesNotMatch(JSON.stringify(mine),new RegExp(`${OWNER}|${WS_A}|user_id|workspace_id|name_key|created_by`));
   assert.deepEqual(await groups(STRANGER),[]);
  });

  let requestC;
  await t.test('same name: identical answer whether a group exists or not; only that group admin sees the request; requester cannot read it',async()=>{
   const exists=await create(USER_C,'dept','가상 노조','정책실'),fresh=await create(USER_D,'dept','다른노조','다른실');
   assert.equal(Buffer.compare(Buffer.from(exists),Buffer.from(fresh)),0);
   const adminView=(await groups(OWNER)).find(g=>g.id===deptA.id);
   assert.equal(adminView.requests.length,1);
   requestC=adminView.requests[0].id;
   assert.deepEqual([adminView.requests[0].name,adminView.requests[0].title],['가상 셋',null]);
   assert.equal((await groups(OWNER)).find(g=>g.id===unionA.id).requests.length,0);
   const cView=await groups(USER_C);
   assert.equal(cView.length,1);assert.deepEqual(cView[0].requests,[]);
   assert.doesNotMatch(JSON.stringify(cView),/가상 관리자|부장/);
   assert.deepEqual((await groups(USER_D))[0].requests,[]);
   // 이름 비교는 띄어쓰기를 무시하지만 종류(부서/노조)는 섞지 않는다.
   assert.equal((await pool.query("select count(*)::int n from public.app_collab_join_requests")).rows[0].n,1);
  });
  await t.test('daily limit: 4th create within 24h answers the same and creates nothing',async()=>{
   assert.equal(await create(USER_E,'dept','가상노조','정책실'),'COLLAB_GROUP_CREATED');
   assert.equal(await create(USER_E,'union','이름하나',null),'COLLAB_GROUP_CREATED');
   assert.equal(await create(USER_E,'union','이름둘',null),'COLLAB_GROUP_CREATED');
   const counts=async()=>(await pool.query("select (select count(*) from public.app_collab_groups)::int g,(select count(*) from public.app_collab_join_requests)::int r")).rows[0];
   const c0=await counts();
   assert.equal(await create(USER_E,'dept','가상노조','정책실'),'COLLAB_GROUP_CREATED');
   assert.deepEqual(await counts(),c0);
   assert.equal((await groups(USER_E)).length,3);
   assert.equal((await pool.query("select count(*)::int n from public.app_collab_join_requests where requester_user_id=$1",[USER_E])).rows[0].n,2);
  });
  await t.test('request decide: stranger, requester and plain member refused; admin accepts; solo source group merged; sibling requests expire',async()=>{
   await refuse(rpc(STRANGER,'app_collab_request_decide',[requestC,true]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(USER_C,'app_collab_request_decide',[requestC,true]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(OWNER,'app_collab_request_decide',['29000000-0000-4000-8000-000000000001',true]),'COLLAB_ADMIN_REQUIRED');
   assert.equal(await rpc(OWNER,'app_collab_request_decide',[requestC,true]),'accepted');
   assert.equal(await rpc(OWNER,'app_collab_request_decide',[requestC,true]),'gone');
   const cView=await groups(USER_C);
   assert.equal(cView.length,1);assert.equal(cView[0].id,deptA.id);assert.equal(cView[0].my_role,'member');
   assert.deepEqual(cView[0].requests,[]);assert.equal(cView[0].invites_live,null);
   assert.deepEqual(cView[0].members.map(m=>m.name),['가상 관리자','가상 셋']);
   // 이제 멤버인 C도 요청 수락은 못 한다(결정 ⑥).
   const reqE=(await groups(OWNER)).find(g=>g.id===deptA.id).requests[0].id;
   await refuse(rpc(USER_C,'app_collab_request_decide',[reqE,true]),'COLLAB_ADMIN_REQUIRED');
   assert.equal(await rpc(OWNER,'app_collab_request_decide',[reqE,false]),'declined');
   // 거절된 E는 자기 새 묶음에 그대로, 요청 결과를 볼 길이 없다.
   assert.equal((await groups(USER_E)).find(g=>g.kind==='dept').members.length,1);
   assert.doesNotMatch(JSON.stringify(await groups(USER_E)),/declined|가상 관리자/);
  });

  let token;
  await t.test('invite: admin only (decision 7), raw token never stored, peek/accept, same refusal for wrong, used, expired, revoked',async()=>{
   await refuse(rpc(USER_C,'app_collab_invite_create',[deptA.id]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(STRANGER,'app_collab_invite_create',[deptA.id]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(STRANGER,'app_collab_invite_revoke_all',[deptA.id]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(USER_C,'app_collab_invite_revoke_all',[deptA.id]),'COLLAB_ADMIN_REQUIRED');
   const made=await rpc(OWNER,'app_collab_invite_create',[deptA.id]);
   token=made.token;
   assert.match(token,/^[0-9a-f]{64}$/);
   const stored=(await pool.query('select token_hash,uses_left,expires_at>now()+interval \'6 days\' as week from public.app_collab_invites')).rows;
   assert.equal(stored.length,1);assert.notEqual(stored[0].token_hash,token);assert.equal(stored[0].uses_left,1);assert.equal(stored[0].week,true);
   assert.equal((await pool.query("select count(*)::int n from public.app_collab_invites where token_hash like '%'||$1||'%'",[token.slice(0,16)])).rows[0].n,0);
   assert.equal((await groups(OWNER)).find(g=>g.id===deptA.id).invites_live,1);
   const peek=await rpc(STRANGER,'app_collab_invite_peek',[token]);
   assert.deepEqual([peek.union_name,peek.dept_name,peek.admin_name,peek.admin_title,peek.member_count,peek.already_member],['가상노조','정책 실','가상 관리자','부장',2,false]);
   await refuse(rpc(STRANGER,'app_collab_invite_accept',[token,false]),'COLLAB_CONSENT_REQUIRED');
   assert.equal(await rpc(STRANGER,'app_collab_invite_accept',[token,true]),deptA.id);
   for(const bad of [token,'0'.repeat(64),'not-a-token',token.toUpperCase()]){
    await refuse(rpc(USER_D,'app_collab_invite_peek',[bad]),'COLLAB_INVITE_UNUSABLE');
    await refuse(rpc(USER_D,'app_collab_invite_accept',[bad,true]),'COLLAB_INVITE_UNUSABLE');
   }
   const late=(await rpc(OWNER,'app_collab_invite_create',[deptA.id])).token;
   await pool.query("update public.app_collab_invites set expires_at=now()-interval '1 minute' where uses_left=1 and revoked_at is null");
   await refuse(rpc(USER_D,'app_collab_invite_accept',[late,true]),'COLLAB_INVITE_UNUSABLE');
   const off=(await rpc(OWNER,'app_collab_invite_create',[deptA.id])).token;
   assert.equal(await rpc(OWNER,'app_collab_invite_revoke_all',[deptA.id]),1);
   await refuse(rpc(USER_D,'app_collab_invite_accept',[off,true]),'COLLAB_INVITE_UNUSABLE');
   assert.equal((await groups(OWNER)).find(g=>g.id===deptA.id).invites_live,0);
   assert.equal((await groups(USER_D)).some(g=>g.id===deptA.id),false);
  });
  await t.test('other group: non-members cannot read, leave, remove, move; member cannot remove or move; admin cannot remove self',async()=>{
   const view=(await groups(OWNER)).find(g=>g.id===deptA.id);
   const memberC=view.members.find(m=>m.name==='가상 셋').id,memberB=view.members.find(m=>m.name==='가상 남').id,adminMember=view.members.find(m=>m.me).id;
   assert.equal((await groups(USER_D)).some(g=>g.id===deptA.id),false);
   await refuse(rpc(USER_D,'app_collab_leave',[deptA.id]),'COLLAB_MEMBER_REQUIRED');
   await refuse(rpc(USER_D,'app_collab_member_remove',[memberC]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(USER_D,'app_collab_admin_move',[memberC]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(USER_C,'app_collab_member_remove',[memberB]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(USER_C,'app_collab_admin_move',[memberC]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(USER_C,'app_collab_member_remove',[adminMember]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(OWNER,'app_collab_member_remove',[adminMember]),'COLLAB_SELF_NOT_ALLOWED');
   // 남의 묶음 관리자가 다른 묶음 멤버를 가리켜도 거절.
   const dGroup=(await groups(USER_D))[0];
   await refuse(rpc(USER_D,'app_collab_member_remove',[memberC]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(OWNER,'app_collab_member_remove',[dGroup.members[0].id]),'COLLAB_ADMIN_REQUIRED');
   await refuse(rpc(OWNER,'app_collab_invite_create',[dGroup.id]),'COLLAB_ADMIN_REQUIRED');
   assert.equal(await rpc(OWNER,'app_collab_member_remove',[memberB]),'removed');
   assert.equal((await groups(STRANGER)).length,0);
  });
  await t.test('leave and admin move: admin must hand over first; one admin; last member leaving deletes the group; log has no content',async()=>{
   await refuse(rpc(OWNER,'app_collab_leave',[deptA.id]),'COLLAB_ADMIN_MUST_MOVE');
   const memberC=(await groups(OWNER)).find(g=>g.id===deptA.id).members.find(m=>m.name==='가상 셋').id;
   assert.equal(await rpc(OWNER,'app_collab_admin_move',[memberC]),'moved');
   const v=(await groups(USER_C)).find(g=>g.id===deptA.id);
   assert.equal(v.my_role,'admin');assert.deepEqual(v.members.map(m=>m.role).sort(),['admin','member']);
   await refuse(rpc(OWNER,'app_collab_invite_create',[deptA.id]),'COLLAB_ADMIN_REQUIRED');
   assert.equal(await rpc(OWNER,'app_collab_leave',[deptA.id]),'left');
   assert.equal(await rpc(USER_C,'app_collab_leave',[deptA.id]),'group_deleted');
   assert.equal((await pool.query('select count(*)::int n from public.app_collab_groups where id=$1',[deptA.id])).rows[0].n,0);
   const cols=(await pool.query("select array_agg(attname::text order by attnum) c from pg_attribute where attrelid='public.app_collab_member_log'::regclass and attnum>0 and not attisdropped")).rows[0].c;
   assert.deepEqual(cols,['id','group_id','user_id','event','at']);
  });
  await t.test('one accept closes sibling requests from the same create; stale (14 days) requests are gone',async()=>{
   assert.equal(await create(STRANGER,'union','형제 노조',null),'COLLAB_GROUP_CREATED');
   assert.equal(await create(USER_D,'union','형제노조',null),'COLLAB_GROUP_CREATED');
   assert.equal(await create(OWNER,'union','형제노조 ',null),'COLLAB_GROUP_CREATED');
   const sGroup=(await groups(STRANGER)).find(g=>g.union_name==='형제 노조'),dGroup=(await groups(USER_D)).find(g=>g.union_name==='형제노조');
   const fromOwner=sGroup.requests.find(r=>r.name==='가상 관리자'),fromD=sGroup.requests.find(r=>r.name==='가상 넷');
   assert.ok(fromOwner&&fromD);
   assert.equal(dGroup.requests.length,1);
   assert.equal(await rpc(STRANGER,'app_collab_request_decide',[fromOwner.id,true]),'accepted');
   assert.deepEqual((await groups(USER_D)).find(g=>g.id===dGroup.id).requests,[]);
   assert.equal((await pool.query("select status from public.app_collab_join_requests where group_id=$1",[dGroup.id])).rows[0].status,'expired');
   assert.equal(await rpc(USER_D,'app_collab_request_decide',[dGroup.requests[0].id,true]),'gone');
   // 관리자 본인이 만든 새 노조 묶음(혼자)은 합쳐져 사라지고, 형제 묶음에는 멤버로 들어간다.
   const oUnions=(await groups(OWNER)).filter(g=>g.kind==='union').map(g=>[g.union_name,g.my_role]).sort();
   assert.deepEqual(oUnions,[['가상노조','admin'],['형제 노조','member']]);
   await pool.query("update public.app_collab_join_requests set created_at=now()-interval '15 days' where id=$1",[fromD.id]);
   assert.equal((await groups(STRANGER)).find(g=>g.id===sGroup.id).requests.length,0);
   assert.equal(await rpc(STRANGER,'app_collab_request_decide',[fromD.id,true]),'gone');
   assert.equal((await groups(USER_D)).some(g=>g.id===sGroup.id),false);
  });
  await t.test('existing owner boundary untouched: owner policies, grants and owner function same as before apply',async()=>{
   const now=(await pool.query(snapshot)).rows.filter(r=>!['collab table','collab function','history'].includes(r.kind));
   assert.deepEqual(now,before.filter(r=>!['collab table','collab function','history'].includes(r.kind)));
   assert.equal((await pool.query("select count(*)::int n from public.app_workspace_members where role<>'owner'")).rows[0].n,0);
  });
  await t.test('rollback restores the catalog snapshot',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   for(const r of await readOnly(precheck))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
