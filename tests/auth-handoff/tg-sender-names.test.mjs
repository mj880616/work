// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// TG-발언자이름 1단계: 20261026190000_tg_sender_names - sender names live in two new owner-read-only tables (hashed key only, no raw number);
// four definer functions are the only writers (upsert: service_role only; set_name/merge/forget: owner).
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
const version='20261026190000',name='tg_sender_names',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const MISSING='99999999-9999-4999-8999-999999999999';
const ROOM='room_fake_1',ROOM2='room_fake_2',DAY='2026-10-23',DAY2='2026-10-24';
const K1='a1b2c3d4e5f60718293a4b5c6d7e8f90',K2='0123456789abcdef0123456789abcdef';

test('tg sender names: person table and room/day link table are owner-read-only, four definer functions write them; rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tg-sender-names-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query('revoke usage on schema private from service_role');
  await pool.query('grant select on public.app_spaces to authenticated');
  await pool.query('alter table public.app_spaces enable row level security');
  await pool.query('create policy fake_owner_read on public.app_spaces for select to authenticated using (private.app_is_workspace_owner(workspace_id))');
  for(const f of ['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const upsert=(ws,room,day,list)=>server(c=>c.query('select public.app_tg_senders_upsert($1,$2,$3,$4::jsonb) r',[ws,room,day,JSON.stringify(list)])).then(r=>r.rows[0].r);
  const setName=(room,day,label,name)=>owner(c=>c.query('select public.app_tg_sender_set_name($1,$2,$3,$4) r',[room,day,label,name])).then(r=>r.rows[0].r);
  const people=async()=>(await pool.query('select * from public.app_tg_senders order by created_at,id')).rows;
  const link=async(room,day,label)=>(await pool.query('select * from public.app_tg_day_senders where room_key=$1 and day=$2 and label=$3',[room,day,label])).rows[0];
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; two new tables, four definer functions; grants are exactly the planned ones; summary 3 lines; rollback guarded',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual([...plan.functions].sort(),['public.app_tg_sender_forget','public.app_tg_sender_merge','public.app_tg_sender_set_name','public.app_tg_senders_upsert']);
    assert.deepEqual([...plan.review.definer].sort(),[...plan.functions].sort());
    assert.deepEqual(plan.createdTables.sort(),['app_tg_day_senders','app_tg_senders']);
    assert.equal(plan.review.triggers,0);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant select on table public.app_tg_senders to authenticated;','grant select on table public.app_tg_day_senders to authenticated;','grant execute on function public.app_tg_senders_upsert(uuid, text, date, jsonb) to service_role;','grant execute on function public.app_tg_sender_set_name(text, date, text, text) to authenticated;','grant execute on function public.app_tg_sender_merge(uuid, uuid) to authenticated;','grant execute on function public.app_tg_sender_forget(uuid) to authenticated;']);
   assert.doesNotMatch(code,/alter table public\.app_feed_items|alter policy|drop policy|create trigger|create or replace|rtw_|disable row level security|\bto (anon|public)\b/i);
   assert.doesNotMatch(code,/telegram_user|phone|sender_number/i);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261026190000', 'tg_sender_names'/);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);assert.match(rollbackSQL,/TG_SENDER_NAMES_ROLLBACK_BLOCKED/);
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
  await t.test('upsert: a keyed person is created once and follows across days and rooms; no raw number anywhere; existing links are kept',async()=>{
   const r1=await upsert(WS_A,ROOM,DAY,[{label:'A',key:K1,name:'가상 홍길동'},{label:'B',key:K2,name:'가상 김영희',self:true},{label:'C',name:'가상 채널'}]);
   assert.deepEqual(r1,{ok:true,people:3,linked:3,conflicts:0});
   const r2=await upsert(WS_A,ROOM2,DAY2,[{label:'B',key:K1,name:'가상 새이름'}]);
   assert.deepEqual(r2,{ok:true,people:1,linked:1,conflicts:0});
   const a=await link(ROOM,DAY,'A'),b=await link(ROOM2,DAY2,'B');
   assert.equal(a.sender_id,b.sender_id,'same key, same person');
   const ps=await people();assert.equal(ps.length,3);
   const p1=ps.find(p=>p.id===a.sender_id);assert.equal(p1.sender_key,K1);assert.equal(p1.auto_name,'가상 새이름');assert.equal(p1.name,null);assert.equal(p1.is_self,false);
   assert.equal(ps.find(p=>p.sender_key===K2).is_self,true);
   assert.equal(ps.find(p=>p.sender_key===null).auto_name,'가상 채널');
   assert.deepEqual(Object.keys(ps[0]).sort(),['auto_name','created_at','id','is_self','name','sender_key','updated_at','workspace_id']);
   // same request again: nothing new
   const again=await upsert(WS_A,ROOM,DAY,[{label:'A',key:K1,name:'가상 홍길동'},{label:'B',key:K2},{label:'C',name:'가상 채널'}]);
   assert.deepEqual(again,{ok:true,people:2,linked:0,conflicts:0});assert.equal((await people()).length,3);
   // a different person claims an existing label: link kept, conflict counted
   const clash=await upsert(WS_A,ROOM,DAY,[{label:'A',key:K2}]);
   assert.deepEqual(clash,{ok:true,people:1,linked:0,conflicts:1});assert.equal((await link(ROOM,DAY,'A')).sender_id,a.sender_id);
   // self flag is not unset by a report without it
   await upsert(WS_A,ROOM,DAY,[{label:'B',key:K2,name:'가상 김영희'}]);
   assert.equal((await people()).find(p=>p.sender_key===K2).is_self,true);
  });
  await t.test('set_name: manual name wins and is never overwritten by the collector; keyless labels get a new person for that room and day only; empty text clears',async()=>{
   const a=await link(ROOM,DAY,'A');
   const r=await setName(ROOM,DAY,'A','  가상 직접이름  ');
   assert.equal(r.changed,true);assert.equal(r.name,'가상 직접이름');assert.equal(r.keyed,true);assert.equal(r.id,a.sender_id);
   await upsert(WS_A,ROOM2,DAY2,[{label:'B',key:K1,name:'가상 또바뀜'}]);
   const p=(await people()).find(x=>x.id===a.sender_id);assert.equal(p.name,'가상 직접이름');assert.equal(p.auto_name,'가상 또바뀜');
   assert.equal((await setName(ROOM,DAY,'A','가상 직접이름')).changed,false);
   const n=(await people()).length;
   const fresh=await setName('room_fake_3',DAY,'A','가상 지난소식');
   assert.equal(fresh.changed,true);assert.equal(fresh.keyed,false);assert.equal((await people()).length,n+1);
   assert.equal((await link('room_fake_3',DAY,'A')).sender_id,fresh.id);assert.equal(await link('room_fake_3',DAY2,'A'),undefined);
   assert.equal((await setName('room_fake_3',DAY,'A','')).changed,true);
   assert.equal((await pool.query('select name from public.app_tg_senders where id=$1',[fresh.id])).rows[0].name,null);
   assert.equal((await setName('room_fake_4',DAY,'A',null)).changed,false);
   assert.equal((await people()).length,n+1,'clearing a name with no link creates nobody');
  });
  await t.test('bad input is refused: labels, keys, names, lists, unknown fields, unknown workspace',async()=>{
   const bad=[[[{label:'a'}],/TG_SENDER_LABEL/],[[{label:'ABCD'}],/TG_SENDER_LABEL/],[[{label:'A'},{label:'A'}],/TG_SENDER_LABEL/],[[{label:'A',key:'XYZ'}],/TG_SENDER_KEY/],[[{label:'A',key:'ABCDEF0123456789ABCDEF'}],/TG_SENDER_KEY/],[[{label:'A',key:'1234567890123'}],/TG_SENDER_KEY/],[[{label:'A',name:'가'.repeat(41)}],/TG_SENDER_NAME/],[[{label:'A',name:'가\n나'}],/TG_SENDER_NAME/],[[{label:'A',name:5}],/TG_SENDER_NAME/],[[{label:'A',self:'yes'}],/TG_SENDER_SELF/],[[{label:'A',phone:'01000000000'}],/TG_SENDER_ITEM/],[['A'],/TG_SENDER_ITEM/],[Array.from({length:41},(_,i)=>({label:'A'+(i<26?String.fromCharCode(65+i):'A'),name:'x'})),/TG_SENDER_(LIST|LABEL)/]];
   for(const [list,re] of bad)await assert.rejects(upsert(WS_A,ROOM,DAY,list),re,JSON.stringify(list).slice(0,60));
   await assert.rejects(server(c=>c.query("select public.app_tg_senders_upsert($1,$2,$3,'{}'::jsonb)",[WS_A,ROOM,DAY])),/TG_SENDER_LIST/);
   await assert.rejects(upsert(WS_A,'bad room',DAY,[]),/TG_SENDER_ARGS/);
   await assert.rejects(upsert(MISSING,ROOM,DAY,[]),/TG_SENDER_WORKSPACE/);
   for(const [args,re] of [[[ 'bad room',DAY,'A','가'],/TG_SENDER_ARGS/],[[ROOM,DAY,'a','가'],/TG_SENDER_ARGS/],[[ROOM,DAY,'A','가'.repeat(41)],/TG_SENDER_NAME/],[[ROOM,DAY,'A','가\t나'],/TG_SENDER_NAME/]])
    await assert.rejects(owner(c=>c.query('select public.app_tg_sender_set_name($1,$2,$3,$4)',args)),re,JSON.stringify(args));
  });
  await t.test('merge moves links and keeps the first name and the key; forget removes the person and its links; strangers cannot touch anything',async()=>{
   const hand=await setName('room_fake_5',DAY,'A','가상 합칠사람');
   const keyedLink=await link(ROOM,DAY,'A');
   const linksBefore=(await pool.query('select count(*)::int n from public.app_tg_day_senders')).rows[0].n;
   await assert.rejects(stranger(c=>c.query('select public.app_tg_sender_merge($1,$2)',[hand.id,keyedLink.sender_id])),/TG_SENDER_NOT_FOUND/);
   await assert.rejects(stranger(c=>c.query('select public.app_tg_sender_forget($1)',[hand.id])),/TG_SENDER_NOT_FOUND/);
   const mineBefore=(await pool.query('select count(*)::int n from public.app_tg_senders where workspace_id=$1',[WS_A])).rows[0].n;
   const theirs=await stranger(c=>c.query("select public.app_tg_sender_set_name($1,$2,'A','가상 남의이름') r",[ROOM,DAY])).then(r=>r.rows[0].r);
   assert.notEqual(theirs.id,keyedLink.sender_id,'a stranger names only their own workspace');
   assert.equal((await pool.query('select workspace_id from public.app_tg_senders where id=$1',[theirs.id])).rows[0].workspace_id,WS_B);
   assert.equal((await pool.query('select count(*)::int n from public.app_tg_senders where workspace_id=$1',[WS_A])).rows[0].n,mineBefore);
   assert.equal((await link(ROOM,DAY,'A')).sender_id,keyedLink.sender_id);
   await assert.rejects(owner(c=>c.query('select public.app_tg_sender_merge($1,$1)',[hand.id])),/TG_SENDER_ARGS/);
   await assert.rejects(owner(c=>c.query('select public.app_tg_sender_merge($1,$2)',[hand.id,MISSING])),/TG_SENDER_NOT_FOUND/);
   const m=await owner(c=>c.query('select public.app_tg_sender_merge($1,$2) r',[hand.id,keyedLink.sender_id])).then(r=>r.rows[0].r);
   assert.equal(m.moved,1);
   assert.equal((await link('room_fake_5',DAY,'A')).sender_id,keyedLink.sender_id);
   assert.equal((await pool.query('select count(*)::int n from public.app_tg_senders where id=$1',[hand.id])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_tg_day_senders')).rows[0].n,linksBefore);
   const kept=(await people()).find(p=>p.id===keyedLink.sender_id);assert.equal(kept.name,'가상 직접이름');assert.equal(kept.sender_key,K1);
   // keyless target takes over the key of the merged-away person
   const bare=await setName('room_fake_6',DAY,'A','');const solo=await setName('room_fake_6',DAY,'B','가상 키없음');
   const into=await owner(c=>c.query('select public.app_tg_sender_merge($1,$2) r',[keyedLink.sender_id,solo.id])).then(r=>r.rows[0].r);
   assert.equal(into.id,solo.id);
   const heir=(await people()).find(p=>p.id===solo.id);assert.equal(heir.sender_key,K1);assert.equal(heir.name,'가상 키없음');
   const f=await owner(c=>c.query('select public.app_tg_sender_forget($1) r',[solo.id])).then(r=>r.rows[0].r);
   assert.ok(f.removed_links>=3);
   assert.equal((await pool.query('select count(*)::int n from public.app_tg_day_senders where sender_id=$1',[solo.id])).rows[0].n,0);
   await assert.rejects(owner(c=>c.query('select public.app_tg_sender_forget($1)',[solo.id])),/TG_SENDER_NOT_FOUND/);
   assert.equal(bare.changed,false);
  });
  await t.test('other workspaces are separate: same key in another workspace is another person; owner sees only own rows',async()=>{
   await upsert(WS_B,ROOM,DAY,[{label:'A',key:K2,name:'가상 다른작업공간'}]);
   assert.equal((await pool.query('select count(*)::int n from public.app_tg_senders where sender_key=$1',[K2])).rows[0].n,2);
   const mine=(await owner(c=>c.query('select workspace_id from public.app_tg_senders'))).rows;
   assert.ok(mine.length>0);assert.ok(mine.every(r=>r.workspace_id===WS_A));
   const theirs=(await stranger(c=>c.query('select workspace_id from public.app_tg_senders'))).rows;
   assert.ok(theirs.length>=2&&theirs.every(r=>r.workspace_id===WS_B));
   assert.ok((await owner(c=>c.query('select * from public.app_tg_day_senders'))).rows.every(r=>r.workspace_id===WS_A));
  });
  await t.test('nobody writes the new tables directly; anon and service_role cannot read them; anon cannot run any of the four functions; service_role only the upsert',async()=>{
   const one=(await people())[0];
   for(const sql of ["insert into public.app_tg_senders(workspace_id) values('"+WS_A+"')","update public.app_tg_senders set name='x'","delete from public.app_tg_senders","insert into public.app_tg_day_senders(workspace_id,room_key,day,label,sender_id) values('"+WS_A+"','r','2026-10-23','A','"+one.id+"')","update public.app_tg_day_senders set label='B'","delete from public.app_tg_day_senders"])
    await assert.rejects(owner(c=>c.query(sql)),{code:'42501'},sql);
   for(const tbl of ['app_tg_senders','app_tg_day_senders']){
    await assert.rejects(as('anon','',c=>c.query('select * from public.'+tbl)),{code:'42501'});
    await assert.rejects(server(c=>c.query('select * from public.'+tbl)),{code:'42501'});
    await assert.rejects(server(c=>c.query("insert into public.app_tg_senders(workspace_id) values('"+WS_A+"')")),{code:'42501'});
   }
   for(const [role,sql,args] of [['anon',"select public.app_tg_senders_upsert($1,'r','2026-10-23','[]')",[WS_A]],['anon',"select public.app_tg_sender_set_name('r','2026-10-23','A','x')",[]],['anon','select public.app_tg_sender_merge($1,$1)',[one.id]],['anon','select public.app_tg_sender_forget($1)',[one.id]],['authenticated',"select public.app_tg_senders_upsert($1,'r','2026-10-23','[]')",[WS_A]],['service_role',"select public.app_tg_sender_set_name('r','2026-10-23','A','x')",[]],['service_role','select public.app_tg_sender_merge($1,$1)',[one.id]],['service_role','select public.app_tg_sender_forget($1)',[one.id]]])
    await assert.rejects(as(role,role==='authenticated'?OWNER:'',c=>c.query(sql,args)),{code:'42501'},role+' '+sql);
  });
  await t.test('the feed table keeps its grants and text: this migration never touched raw_text or its policies',async()=>{
   const post=values(await readOnly(precheck)),pre=values(beforeCheck);
   assert.equal(post['feed table grants policies hash'],pre['feed table grants policies hash']);
   assert.equal(post['feed items rows'],pre['feed items rows']);
  });
  await t.test('rollback is refused while names exist, then restores the snapshot after they are emptied; re-apply works',async()=>{
   const blocked=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/TG_SENDER_NAMES_ROLLBACK_BLOCKED/);await c.query('rollback');}finally{c.release();}};
   await blocked();
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1,'nothing changed');
   await pool.query('delete from public.app_tg_day_senders');await pool.query('delete from public.app_tg_senders');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   const gone=(await pool.query("select to_regclass('public.app_tg_senders') a,to_regclass('public.app_tg_day_senders') b,to_regprocedure('public.app_tg_senders_upsert(uuid,text,date,jsonb)') f1,to_regprocedure('public.app_tg_sender_set_name(text,date,text,text)') f2,to_regprocedure('public.app_tg_sender_merge(uuid,uuid)') f3,to_regprocedure('public.app_tg_sender_forget(uuid)') f4")).rows[0];
   assert.deepEqual(Object.values(gone),[null,null,null,null,null,null]);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
