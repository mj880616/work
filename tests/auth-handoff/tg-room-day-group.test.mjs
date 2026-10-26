// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// TG-방날짜묶기 1단계: 20261027010000_tg_room_day_group - folders, room state and day summaries live in three new owner-read-only tables;
// definer functions are the only writers (room_touch / room_day_add: service_role only; room_set / room_day_set / folder_*: owner); one invoker list function.
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
const version='20261027010000',name='tg_room_day_group',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const MISSING='99999999-9999-4999-8999-999999999999';
const R1='room_fake_1',R2='room_fake_2',RB='room_fake_b',D1='2026-10-23',D2='2026-10-24',D3='2026-10-25';
const FUNCTIONS=['private.app_feed_owner_workspace','public.app_feed_folder_create','public.app_feed_folder_delete','public.app_feed_folder_rename','public.app_feed_room_day_add','public.app_feed_room_day_lines','public.app_feed_room_day_set','public.app_feed_room_set','public.app_feed_room_touch'];
const part=(batch,over={})=>({batch,first_at:'2026-10-24T01:00:00Z',headline:'가상 한 줄',lines:['가상 첫째','가상 둘째','가상 셋째'],...over});

test('tg room/day group: three owner-read-only tables, definer writers, invoker list function; guarded rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tg-room-day-group-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  for(const f of ['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025210000_feed_item_archive'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  // synthetic feed rows (inserted as the table owner; the collector's own insert path is covered by call-tg-feed.test.mjs)
  let seq=0;
  const item=(ws,room,day,over={})=>pool.query('insert into public.app_feed_items(workspace_id,source,day,occurred_at,room_key,room_label,title,summary,raw_count,source_ref,hidden_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
   [ws,'telegram',day,over.at||day+'T03:00:00Z',room,over.label||'가상 방 '+room,'가상 소식','가상 요약',over.raw??2,'tg:fake:'+(++seq),over.hidden||null]);
  await item(WS_A,R1,D1,{raw:5,at:D1+'T02:00:00Z',label:'가상 방 옛이름'});await item(WS_A,R1,D1,{raw:3,at:D1+'T05:00:00Z',label:'가상 방 새이름'});await item(WS_A,R1,D1,{raw:9,hidden:'2026-10-24T00:00:00Z'});
  await item(WS_A,R1,D2,{raw:4});await item(WS_A,R2,D1,{raw:7});await item(WS_A,R2,D2,{raw:1,hidden:'2026-10-24T00:00:00Z'});await item(WS_B,RB,D1,{raw:6});
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,source_ref) values($1,'call',$2,'2026-10-23T03:00:00Z','가상 통화','call:fake:1')",[WS_A,D1]);
  const before=(await pool.query(snapshot)).rows;
  const beforeCheck=await readOnly(precheck);
  const lines=(fn,a,b)=>fn(c=>c.query('select room_key,room_label,day::text,last_at::text,item_count,raw_count,headline,part_count,chat_kind,chat_username,folder_id,archived_at is not null as archived,day_hidden_at is not null as day_hidden from public.app_feed_room_day_lines($1,$2)',[a,b])).then(r=>r.rows);
  const touch=(ws,room,label,kind,user)=>server(c=>c.query('select public.app_feed_room_touch($1,$2,$3,$4,$5) r',[ws,room,label,kind,user])).then(r=>r.rows[0].r);
  const dayAdd=(ws,room,day,p)=>server(c=>c.query('select public.app_feed_room_day_add($1,$2,$3,$4::jsonb) r',[ws,room,day,JSON.stringify(p)])).then(r=>r.rows[0].r);
  const roomSet=(fn,room,folder,arch)=>fn(c=>c.query('select public.app_feed_room_set($1,$2,$3) r',[room,folder,arch])).then(r=>r.rows[0].r);
  const daySet=(fn,room,day,state)=>fn(c=>c.query('select public.app_feed_room_day_set($1,$2,$3) r',[room,day,state])).then(r=>r.rows[0].r);
  const folderCreate=(fn,nm)=>fn(c=>c.query('select public.app_feed_folder_create($1) r',[nm])).then(r=>r.rows[0].r);
  const roomRow=async(ws,room)=>(await pool.query('select * from public.app_feed_rooms where workspace_id=$1 and room_key=$2',[ws,room])).rows[0];
  const dayRow=async(ws,room,day)=>(await pool.query('select parts,hidden_at from public.app_feed_room_days where workspace_id=$1 and room_key=$2 and day=$3',[ws,room,day])).rows[0];

  await t.test('files: expanded rules pass; three new tables, eight definer functions plus one invoker; grants are exactly the planned ones; summary 3 lines; rollback guarded',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual([...plan.functions].sort(),FUNCTIONS);
    assert.deepEqual([...plan.review.definer].sort(),FUNCTIONS.filter(f=>f!=='public.app_feed_room_day_lines'));
    assert.deepEqual(plan.createdTables.sort(),['app_feed_folders','app_feed_room_days','app_feed_rooms']);
    assert.equal(plan.review.triggers,0);assert.equal(plan.review.policies,3);assert.equal(plan.review.restrictive,0);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const text=summary.trim().split('\n');
   assert.equal(text.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(text[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant select on table public.app_feed_folders to authenticated;','grant select on table public.app_feed_rooms to authenticated;','grant select on table public.app_feed_room_days to authenticated;','grant execute on function public.app_feed_room_touch(uuid, text, text, text, text) to service_role;','grant execute on function public.app_feed_room_day_add(uuid, text, date, jsonb) to service_role;','grant execute on function public.app_feed_room_set(text, uuid, boolean) to authenticated;','grant execute on function public.app_feed_room_day_set(text, date, text) to authenticated;','grant execute on function public.app_feed_folder_create(text) to authenticated;','grant execute on function public.app_feed_folder_rename(uuid, text) to authenticated;','grant execute on function public.app_feed_folder_delete(uuid) to authenticated;','grant execute on function public.app_feed_room_day_lines(date, date) to authenticated;']);
   assert.doesNotMatch(code,/alter table public\.app_feed_items|alter policy|drop policy|create trigger|create or replace|create (or replace )?view|rtw_|disable row level security|\bto (anon|public)\b/i);
   assert.equal([...code.matchAll(/^security definer$/gim)].length,8);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261027010000', 'tg_room_day_group'/);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);assert.match(rollbackSQL,/TG_ROOM_DAY_GROUP_ROLLBACK_BLOCKED/);
  });
  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(beforeCheck);
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['feed telegram rows'],'7');assert.equal(v['feed telegram rooms'],'3');assert.equal(v['feed items rows'],'8');
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
  await t.test('room_touch: server creates the room row from existing feed rows only, never overwrites a known value with an empty one, never touches folder or archive',async()=>{
   assert.deepEqual(await touch(WS_A,R1,'가상 방 이름','group','fake_room1'),{ok:true,changed:true});
   let r=await roomRow(WS_A,R1);assert.equal(r.room_label,'가상 방 이름');assert.equal(r.chat_kind,'group');assert.equal(r.chat_username,'fake_room1');assert.equal(r.folder_id,null);assert.equal(r.archived_at,null);
   assert.deepEqual(await touch(WS_A,R1,'가상 방 이름','group','fake_room1'),{ok:true,changed:false});
   assert.deepEqual(await touch(WS_A,R1,null,null,null),{ok:true,changed:false});
   r=await roomRow(WS_A,R1);assert.equal(r.chat_username,'fake_room1');assert.equal(r.room_label,'가상 방 이름');
   assert.equal((await touch(WS_A,R1,'가상 새 이름',null,null)).changed,true);assert.equal((await roomRow(WS_A,R1)).chat_kind,'group');
   await assert.rejects(touch(WS_A,'room_fake_none','x',null,null),/TGDG_NO_ROOM/);
   await assert.rejects(touch(WS_A,RB,'x',null,null),/TGDG_NO_ROOM/,'a room of another workspace is not a room here');
   await assert.rejects(touch(WS_A,R1,'x','supergroup',null),/TGDG_CHAT_KIND/);
   for(const u of ['ab','1abcde','has space','한글아이디','a'.repeat(33)])await assert.rejects(touch(WS_A,R1,'x',null,u),/TGDG_CHAT_USERNAME/,u);
   await assert.rejects(touch(WS_A,'bad key!','x',null,null),/TGDG_ARGS/);
   await assert.rejects(touch(MISSING,R1,'x',null,null),/TGDG_WORKSPACE/);
   await assert.rejects(touch(WS_A,R1,'가상\n줄바꿈',null,null),/TGDG_LABEL/);
   await touch(WS_A,R2,'가상 둘째 방','user',null);await touch(WS_B,RB,'가상 남의 방','channel','fake_chan');
  });
  await t.test('day_add: one part per batch, idempotent, validated, order kept, delete mark survives',async()=>{
   assert.deepEqual(await dayAdd(WS_A,R1,D1,part('b1',{open_ref:'12345'})),{ok:true,added:true});
   assert.deepEqual(await dayAdd(WS_A,R1,D1,part('b1',{headline:'가상 다른 글'})),{ok:true,added:false});
   assert.deepEqual(await dayAdd(WS_A,R1,D1,part('b2',{first_at:'2026-10-23T09:00:00+09:00',headline:'',lines:['가상 하나']})),{ok:true,added:true});
   let row=await dayRow(WS_A,R1,D1);assert.equal(row.parts.length,2);assert.equal(row.hidden_at,null);
   assert.deepEqual(Object.keys(row.parts[0]).sort(),['batch','first_at','headline','lines','open_ref']);
   assert.equal(row.parts[0].first_at,'2026-10-24T01:00:00Z');assert.equal(row.parts[1].first_at,'2026-10-23T00:00:00Z','normalized to UTC');
   assert.equal(row.parts[1].open_ref,undefined);
   const bad=async(p,re)=>assert.rejects(dayAdd(WS_A,R1,D1,p),re,JSON.stringify(p));
   await bad(part('b3',{extra:1}),/TGDG_PART\b/);await bad({...part('b3'),batch:undefined},/TGDG_PART_BATCH/);await bad(part('bad batch!'),/TGDG_PART_BATCH/);
   await bad(part('b3',{first_at:'어제'}),/TGDG_PART_TIME/);await bad(part('b3',{first_at:'2026-10-23'}),/TGDG_PART_TIME/);
   await bad(part('b3',{headline:'가'.repeat(61)}),/TGDG_PART_HEADLINE/);await bad(part('b3',{headline:5}),/TGDG_PART_HEADLINE/);await bad(part('b3',{headline:'가\n나'}),/TGDG_PART_HEADLINE/);
   await bad(part('b3',{lines:[]}),/TGDG_PART_LINES/);await bad(part('b3',{lines:['1','2','3','4','5']}),/TGDG_PART_LINES/);await bad(part('b3',{lines:['가'.repeat(101)]}),/TGDG_PART_LINES/);
   await bad(part('b3',{lines:['가\u0007나']}),/TGDG_PART_LINES/);await bad(part('b3',{lines:[1,2]}),/TGDG_PART_LINES/);await bad(part('b3',{lines:['   ']}),/TGDG_PART_LINES/);
   await bad(part('b3',{open_ref:'a b'}),/TGDG_PART_OPEN_REF/);await bad(part('b3',{open_ref:7}),/TGDG_PART_OPEN_REF/);
   await assert.rejects(dayAdd(WS_A,R1,D3,part('b1')),/TGDG_NO_ROOM_DAY/);await assert.rejects(dayAdd(WS_A,RB,D1,part('b1')),/TGDG_NO_ROOM_DAY/);
   await assert.rejects(server(c=>c.query("select public.app_feed_room_day_add($1,$2,$3,'[]'::jsonb)",[WS_A,R1,D1])),/TGDG_PART/);
   assert.equal((await dayRow(WS_A,R1,D1)).parts.length,2,'rejected parts changed nothing');
   // 50 parts at most
   for(let i=0;i<48;i++)await dayAdd(WS_A,R1,D1,part('f'+i));
   assert.equal((await dayRow(WS_A,R1,D1)).parts.length,50);
   await assert.rejects(dayAdd(WS_A,R1,D1,part('f-over')),/TGDG_PARTS_FULL/);
   // trashed day stays trashed when a late part arrives
   await daySet(owner,R2,D1,'trashed');
   assert.deepEqual(await dayAdd(WS_A,R2,D1,part('late')),{ok:true,added:true});
   row=await dayRow(WS_A,R2,D1);assert.notEqual(row.hidden_at,null);assert.equal(row.parts.length,1);
   await daySet(owner,R2,D1,'active');
  });
  await t.test('room_set and day_set: owner only, full state, same workspace only, nothing invented',async()=>{
   const f=await folderCreate(owner,'가상 폴더');
   assert.equal(f.ok,true);
   const set1=await roomSet(owner,R1,f.id,false);assert.equal(set1.changed,true);
   let r=await roomRow(WS_A,R1);assert.equal(r.folder_id,f.id);assert.equal(r.archived_at,null);
   assert.equal((await roomSet(owner,R1,f.id,false)).changed,false);
   assert.equal((await roomSet(owner,R1,f.id,true)).changed,true);
   const stamp=(await roomRow(WS_A,R1)).archived_at;assert.notEqual(stamp,null);
   assert.equal((await roomSet(owner,R1,f.id,true)).changed,false);
   assert.equal((await roomRow(WS_A,R1)).archived_at.getTime(),stamp.getTime(),'archive time is kept');
   assert.equal((await roomSet(owner,R1,null,false)).changed,true);r=await roomRow(WS_A,R1);assert.equal(r.folder_id,null);assert.equal(r.archived_at,null);
   assert.equal((await roomSet(owner,R1,f.id,true)).changed,true);
   // a room that never had a state row gets one (R2 was touched; a fresh one is created from feed rows)
   await pool.query('delete from public.app_feed_rooms where room_key=$1 and workspace_id=$2',[R2,WS_A]);
   assert.equal((await roomSet(owner,R2,null,true)).changed,true);assert.equal((await roomRow(WS_A,R2)).room_label,'가상 방 '+R2);
   assert.equal((await roomSet(owner,R2,null,false)).changed,true);
   await assert.rejects(roomSet(owner,'room_fake_none',null,false),/TGDG_NOT_FOUND/);
   await assert.rejects(roomSet(owner,RB,null,false),/TGDG_NOT_FOUND/,'owner cannot name the stranger\'s room');
   await assert.rejects(roomSet(owner,R1,MISSING,false),/TGDG_NOT_FOUND/);
   await assert.rejects(roomSet(owner,'bad key!',null,false),/TGDG_ARGS/);await assert.rejects(roomSet(owner,R1,null,null),/TGDG_ARGS/);
   const theirs=await folderCreate(stranger,'가상 남의 폴더');
   await assert.rejects(roomSet(owner,R1,theirs.id,false),/TGDG_NOT_FOUND/,'a folder of another workspace is not accepted');
   await assert.rejects(roomSet(stranger,R1,theirs.id,false),/TGDG_NOT_FOUND/,'a stranger cannot touch the owner\'s room');
   assert.equal((await roomSet(stranger,RB,theirs.id,true)).changed,true);
   assert.equal((await roomRow(WS_A,R1)).archived_at.getTime()>0,true);
   // day_set
   assert.equal((await daySet(owner,R1,D2,'trashed')).changed,true);assert.equal((await daySet(owner,R1,D2,'trashed')).changed,false);
   assert.notEqual((await dayRow(WS_A,R1,D2)).hidden_at,null);assert.deepEqual((await dayRow(WS_A,R1,D2)).parts,[]);
   assert.equal((await daySet(owner,R1,D2,'active')).changed,true);assert.equal((await dayRow(WS_A,R1,D2)).hidden_at,null);
   assert.equal((await daySet(owner,R1,D2,'active')).changed,false);
   await assert.rejects(daySet(owner,R1,D3,'trashed'),/TGDG_NOT_FOUND/);await assert.rejects(daySet(owner,RB,D1,'trashed'),/TGDG_NOT_FOUND/);
   await assert.rejects(daySet(owner,R1,D2,'deleted'),/TGDG_ARGS/);await assert.rejects(daySet(owner,R1,D2,null),/TGDG_ARGS/);
   await assert.rejects(daySet(stranger,R1,D1,'trashed'),/TGDG_NOT_FOUND/);
   assert.equal((await pool.query("select count(*)::int n from public.app_feed_items where hidden_at is not null")).rows[0].n,2,'the day delete does not touch feed rows');
  });
  await t.test('folders: create, rename, delete release the rooms; names and limits',async()=>{
   const a=await folderCreate(owner,'  가상 둘째  ');assert.equal(a.name,'가상 둘째');
   await assert.rejects(folderCreate(owner,'가상 둘째'),/TGDG_FOLDER_NAME_TAKEN/);
   for(const bad of ['','   ',null,'가'.repeat(21),'가\n나'])await assert.rejects(folderCreate(owner,bad),/TGDG_FOLDER_NAME/,String(bad));
   const rn=await owner(c=>c.query('select public.app_feed_folder_rename($1,$2) r',[a.id,'가상 이름바꿈'])).then(r=>r.rows[0].r);assert.equal(rn.changed,true);
   assert.equal((await owner(c=>c.query('select public.app_feed_folder_rename($1,$2) r',[a.id,'가상 이름바꿈'])).then(r=>r.rows[0].r)).changed,false);
   await assert.rejects(owner(c=>c.query('select public.app_feed_folder_rename($1,$2)',[a.id,'가상 폴더'])),/TGDG_FOLDER_NAME_TAKEN/);
   await assert.rejects(owner(c=>c.query('select public.app_feed_folder_rename($1,$2)',[MISSING,'가상 새']),),/TGDG_NOT_FOUND/);
   const theirs=(await pool.query('select id from public.app_feed_folders where workspace_id=$1',[WS_B])).rows[0].id;
   await assert.rejects(owner(c=>c.query('select public.app_feed_folder_rename($1,$2)',[theirs,'가상 훔침'])),/TGDG_NOT_FOUND/);
   await assert.rejects(owner(c=>c.query('select public.app_feed_folder_delete($1)',[theirs])),/TGDG_NOT_FOUND/);
   assert.equal((await pool.query('select name from public.app_feed_folders where id=$1',[theirs])).rows[0].name,'가상 남의 폴더');
   await roomSet(owner,R2,a.id,false);
   const items=(await pool.query('select count(*)::int n from public.app_feed_items')).rows[0].n;
   const del=await owner(c=>c.query('select public.app_feed_folder_delete($1) r',[a.id])).then(r=>r.rows[0].r);assert.equal(del.rooms_released,1);
   assert.equal((await roomRow(WS_A,R2)).folder_id,null);assert.equal((await pool.query('select count(*)::int n from public.app_feed_folders where id=$1',[a.id])).rows[0].n,0);
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_items')).rows[0].n,items,'rooms, items and summaries stay');
   assert.ok(await dayRow(WS_A,R1,D1));
   await assert.rejects(owner(c=>c.query('select public.app_feed_folder_delete($1)',[a.id])),/TGDG_NOT_FOUND/);
   // 30 folders at most per workspace
   const have=(await pool.query('select count(*)::int n from public.app_feed_folders where workspace_id=$1',[WS_A])).rows[0].n;
   for(let i=have;i<30;i++)await folderCreate(owner,'가상 '+i);
   await assert.rejects(folderCreate(owner,'가상 초과'),/TGDG_FOLDER_LIMIT/);
   assert.equal((await folderCreate(stranger,'가상 남의 둘째')).ok,true,'the limit is per workspace');
   const order=(await pool.query('select sort_order from public.app_feed_folders where workspace_id=$1 order by created_at,id',[WS_A])).rows.map(r=>r.sort_order);
   assert.deepEqual(order,[...order].sort((x,y)=>x-y));assert.equal(new Set(order).size,order.length);
  });
  await t.test('room_day_lines: one line per room and day, only days with a visible item, summary headline, state columns, own workspace only, range checked',async()=>{
   await pool.query('delete from public.app_feed_room_days where workspace_id=$1 and room_key=$2 and day=$3',[WS_A,R1,D1]);
   await dayAdd(WS_A,R1,D1,part('l-late',{first_at:'2026-10-23T08:00:00Z',headline:'가상 늦은 글'}));await dayAdd(WS_A,R1,D1,part('l-empty',{first_at:'2026-10-23T01:00:00Z',headline:''}));await dayAdd(WS_A,R1,D1,part('l-early',{first_at:'2026-10-23T03:00:00Z',headline:'가상 이른 글'}));
   await touch(WS_A,R1,null,'group','fake_room1');
   const rows=await lines(owner,D1,D3);
   assert.equal(rows[0].day,D2);assert.deepEqual(rows.slice(1).map(r=>r.day),[D1,D1]);
   assert.equal(rows.length,3,'R2 on D2 has only a hidden item and is absent; the stranger and the call item never appear');
   assert.ok(rows.every(r=>r.room_key!==RB));
   const l1=rows.find(r=>r.room_key===R1&&r.day===D1);
   assert.equal(l1.item_count,2);assert.equal(l1.raw_count,8,'hidden items are not counted');assert.equal(l1.headline,'가상 이른 글','earliest part with text');assert.equal(l1.part_count,3);
   assert.equal(l1.chat_kind,'group');assert.equal(l1.chat_username,'fake_room1');assert.equal(l1.archived,true);assert.equal(l1.day_hidden,false);
   const l2=rows.find(r=>r.room_key===R2&&r.day===D1);assert.equal(l2.headline,'가상 한 줄');assert.equal(l2.part_count,1);assert.equal(l2.archived,false);assert.equal(l2.folder_id,null);
   assert.ok(rows.findIndex(r=>r.day===D2)<rows.findIndex(r=>r.day===D1),'newest day first');
   await daySet(owner,R2,D1,'trashed');assert.equal((await lines(owner,D1,D1)).find(r=>r.room_key===R2).day_hidden,true);await daySet(owner,R2,D1,'active');
   assert.deepEqual((await lines(owner,D2,D2)).map(r=>r.room_key),[R1]);assert.deepEqual(await lines(owner,D3,D3),[]);
   // a room without a state row still shows (label from the newest item)
   await pool.query('delete from public.app_feed_rooms where workspace_id=$1 and room_key=$2',[WS_A,R2]);
   const bare=(await lines(owner,D1,D1)).find(r=>r.room_key===R2);assert.equal(bare.room_label,'가상 방 '+R2);assert.equal(bare.chat_kind,null);
   // an item hidden afterwards drops the line once nothing visible is left
   await pool.query("update public.app_feed_items set hidden_at=now() where workspace_id=$1 and room_key=$2 and day=$3",[WS_A,R2,D1]);
   assert.equal((await lines(owner,D1,D1)).some(r=>r.room_key===R2),false);
   const mine=await lines(stranger,D1,D3);assert.deepEqual(mine.map(r=>r.room_key),[RB]);assert.equal(mine[0].chat_username,'fake_chan');assert.equal(mine[0].archived,true);
   for(const [a,b] of [[null,D1],[D1,null],[D2,D1],['2026-01-01','2026-12-31']])await assert.rejects(lines(owner,a,b),/TGDG_RANGE/,String(a)+String(b));
   assert.equal((await lines(owner,'2026-07-25',D3)).length,2,'93 days is allowed');
  });
  await t.test('nobody writes the new tables directly; anon and service_role cannot read them; anon runs nothing; each role runs only its own functions',async()=>{
   const f=(await pool.query('select id from public.app_feed_folders where workspace_id=$1 limit 1',[WS_A])).rows[0].id;
   const ins=["insert into public.app_feed_folders(workspace_id,name) values('"+WS_A+"','x')","insert into public.app_feed_rooms(workspace_id,room_key) values('"+WS_A+"','x')","insert into public.app_feed_room_days(workspace_id,room_key,day) values('"+WS_A+"','x','2026-10-23')"];
   const mods=["update public.app_feed_folders set name='x'","update public.app_feed_rooms set archived_at=now()","update public.app_feed_room_days set hidden_at=now()","delete from public.app_feed_folders","delete from public.app_feed_rooms","delete from public.app_feed_room_days"];
   for(const sql of [...ins,...mods]){await assert.rejects(owner(c=>c.query(sql)),{code:'42501'},sql);await assert.rejects(server(c=>c.query(sql)),{code:'42501'},sql);await assert.rejects(anon(c=>c.query(sql)),{code:'42501'},sql);}
   for(const tbl of ['app_feed_folders','app_feed_rooms','app_feed_room_days']){await assert.rejects(anon(c=>c.query('select * from public.'+tbl)),{code:'42501'});await assert.rejects(server(c=>c.query('select * from public.'+tbl)),{code:'42501'});}
   const own=(await owner(c=>c.query('select workspace_id from public.app_feed_folders'))).rows;assert.ok(own.length>0&&own.every(r=>r.workspace_id===WS_A));
   const theirs=(await stranger(c=>c.query('select workspace_id from public.app_feed_rooms union all select workspace_id from public.app_feed_room_days'))).rows;assert.ok(theirs.length>0&&theirs.every(r=>r.workspace_id===WS_B));
   const calls={
    touch:["select public.app_feed_room_touch($1,'r',null,null,null)",[WS_A]],add:["select public.app_feed_room_day_add($1,'r','2026-10-23','{}')",[WS_A]],
    set:["select public.app_feed_room_set('r',null,false)",[]],dayset:["select public.app_feed_room_day_set('r','2026-10-23','active')",[]],
    fcreate:["select public.app_feed_folder_create('x')",[]],frename:["select public.app_feed_folder_rename($1,'x')",[f]],fdelete:["select public.app_feed_folder_delete($1)",[f]],
    lines:["select * from public.app_feed_room_day_lines('2026-10-23','2026-10-24')",[]],helper:['select private.app_feed_owner_workspace()',[]]};
   for(const [k,[sql,args]] of Object.entries(calls)){
    await assert.rejects(anon(c=>c.query(sql,args)),{code:'42501'},'anon '+k);
    if(['set','dayset','fcreate','frename','fdelete','lines','helper'].includes(k)||k==='touch'||k==='add')await assert.rejects(k==='touch'||k==='add'?owner(c=>c.query(sql,args)):server(c=>c.query(sql,args)),{code:'42501'},(k==='touch'||k==='add'?'authenticated ':'service_role ')+k);
   }
   await assert.rejects(owner(c=>c.query(calls.helper[0])),{code:'42501'},'authenticated helper');
  });
  await t.test('the feed table keeps its grants, rows and text; only an index was added',async()=>{
   const post=values(await readOnly(precheck)),pre=values(beforeCheck);
   for(const k of ['feed table grants policies hash','feed items rows','feed telegram rows','feed telegram rooms','feed items archived rows'])assert.equal(post[k],pre[k]===undefined?post[k]:pre[k],k);
   assert.equal((await pool.query("select count(*)::int n from public.app_feed_items where raw_text is not null")).rows[0].n,0);
  });
  await t.test('rollback is refused while rows exist, then restores the snapshot after they are emptied; re-apply works',async()=>{
   const blocked=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/TG_ROOM_DAY_GROUP_ROLLBACK_BLOCKED/);await c.query('rollback');}finally{c.release();}};
   await blocked();
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1,'nothing changed');
   await pool.query('delete from public.app_feed_room_days');await blocked();await pool.query('delete from public.app_feed_rooms');await blocked();await pool.query('delete from public.app_feed_folders');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   const gone=(await pool.query("select to_regclass('public.app_feed_folders') a,to_regclass('public.app_feed_rooms') b,to_regclass('public.app_feed_room_days') c,to_regclass('public.app_feed_items_tg_room_day_idx') d,to_regprocedure('private.app_feed_owner_workspace()') e,to_regprocedure('public.app_feed_room_touch(uuid,text,text,text,text)') f,to_regprocedure('public.app_feed_room_day_add(uuid,text,date,jsonb)') g,to_regprocedure('public.app_feed_room_set(text,uuid,boolean)') h,to_regprocedure('public.app_feed_room_day_set(text,date,text)') i,to_regprocedure('public.app_feed_folder_create(text)') j,to_regprocedure('public.app_feed_folder_rename(uuid,text)') k,to_regprocedure('public.app_feed_folder_delete(uuid)') l,to_regprocedure('public.app_feed_room_day_lines(date,date)') m")).rows[0];
   assert.deepEqual(Object.values(gone),Array(13).fill(null));
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
