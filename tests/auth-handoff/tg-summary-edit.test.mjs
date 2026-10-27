// Fresh local PostgreSQL only. No Supabase, Google, OpenAI or production credentials. All data synthetic.
// TG-요약고치기 1단계: 20261027200000_tg_summary_edit - user-edited telegram summaries (one item line, or a room-day summary) live in two new owner-read-only tables;
// one owner-checked definer function is the only writer; the AI-written columns (app_feed_items.summary, app_feed_room_days.parts) are never touched.
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
const version='20261027200000',name='tg_summary_edit',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const MISSING='99999999-9999-4999-8999-999999999999';
const R1='room_fake_1',D1='2026-10-24',D2='2026-10-25';
const part=(batch,at,over={})=>({batch,first_at:at,headline:'가상 한 줄',lines:['가상 첫째','가상 둘째'],...over});

test('tg summary edit: user values live in separate owner-read-only tables, one owner-checked function writes them, AI columns stay; rollback guarded',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tg-summary-edit-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  for(const f of ['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025210000_feed_item_archive','20261027010000_tg_room_day_group'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  let seq=0;
  const item=async(ws,room,day,over={})=>(await pool.query('insert into public.app_feed_items(workspace_id,source,day,occurred_at,room_key,room_label,title,summary,raw_count,source_ref) values($1,\'telegram\',$2,$3,$4,$5,$6,$7,$8,$9) returning id',
   [ws,day,over.at||day+'T03:00:00Z',room,'가상 방','가상 소식',over.summary??'가상 요약',2,'tg:fake:'+(++seq)])).rows[0].id;
  const iA=await item(WS_A,R1,D1),iB=await item(WS_B,'room_fake_b',D1);
  const iCall=(await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call',$2,'2026-10-23T03:00:00Z','가상 통화','가상 통화 요약','call:fake:1') returning id",[WS_A,D1])).rows[0].id;
  await server(c=>c.query("select public.app_feed_room_touch($1,$2,$3,$4,$5)",[WS_A,R1,'가상 방','group','fake_room1']));
  await pool.query("insert into public.app_feed_room_days(workspace_id,room_key,day,parts) values($1,$2,$3,$4::jsonb)",[WS_A,R1,D1,JSON.stringify([part('b2','2026-10-24T05:00:00Z',{headline:'',lines:['가상 셋째']}),part('b1','2026-10-24T01:00:00Z')])]);
  const aiItem=async()=>(await pool.query('select summary,title,points from public.app_feed_items where id=$1',[iA])).rows[0];
  const aiParts=async()=>(await pool.query('select parts from public.app_feed_room_days where workspace_id=$1 and room_key=$2 and day=$3',[WS_A,R1,D1])).rows[0].parts;
  const editItem=(id,patch)=>owner(c=>c.query('select public.app_feed_summary_edit($1,null,null,$2::jsonb) r',[id,JSON.stringify(patch)])).then(r=>r.rows[0].r);
  const editDay=(room,day,patch)=>owner(c=>c.query('select public.app_feed_summary_edit(null,$1,$2,$3::jsonb) r',[room,day,JSON.stringify(patch)])).then(r=>r.rows[0].r);
  const before=(await pool.query(snapshot)).rows;
  const aiBefore={item:await aiItem(),parts:await aiParts()};
  const beforeCheck=await readOnly(precheck);

  await t.test('files: expanded rules pass; two new tables, one definer function; no grant on the existing tables; summary 3 lines; rollback guarded',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL,migration])assert.doesNotMatch(sql.replace(/--.*$/gm,''),/information_schema/i);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.functions,['public.app_feed_summary_edit']);
    assert.deepEqual(plan.review.definer,['public.app_feed_summary_edit']);
    assert.deepEqual(plan.createdTables.sort(),['app_feed_summary_edit_history','app_feed_summary_edits']);
    assert.equal(plan.review.triggers,0);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   const grants=[...code.matchAll(/^grant [^;]*;/gim)].map(m=>m[0].replace(/\s+/g,' '));
   assert.deepEqual(grants,['grant select on table public.app_feed_summary_edits to authenticated;','grant select on table public.app_feed_summary_edit_history to authenticated;','grant execute on function public.app_feed_summary_edit(uuid, text, date, jsonb) to authenticated;']);
   assert.doesNotMatch(code,/grant [^;]*(app_feed_items|app_feed_room_days)/i);
   assert.doesNotMatch(code,/alter table public\.app_feed_(items|room_days)|alter policy|drop policy|create trigger|create or replace|rtw_|disable row level security|\bto (anon|public)\b/i);
   assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261027200000', 'tg_summary_edit'/);
   assert.match(rollbackSQL,/SQL Editor 경로 전용/);assert.match(rollbackSQL,/TG_SUMMARY_EDIT_ROLLBACK_BLOCKED/);
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
  await t.test('owner edits one item line: AI summary stays, history keeps the AI value, same value twice writes no history, reset brings the AI value back',async()=>{
   const r1=await editItem(iA,{summary:'손으로 고친 요약함.'});
   assert.equal(r1.ok,true);assert.equal(r1.changed,true);assert.equal(r1.target,'item:'+iA);assert.equal(r1.vals.summary,'손으로 고친 요약함.');
   assert.deepEqual((await aiItem()),aiBefore.item);
   const h=(await pool.query("select field,old_value,new_value from public.app_feed_summary_edit_history where target=$1",['item:'+iA])).rows;
   assert.deepEqual(h,[{field:'summary',old_value:'가상 요약',new_value:'손으로 고친 요약함.'}]);
   assert.equal((await editItem(iA,{summary:'손으로 고친 요약함.'})).changed,false);
   assert.equal((await pool.query('select count(*)::int n from public.app_feed_summary_edit_history where target=$1',['item:'+iA])).rows[0].n,1);
   await editItem(iA,{summary:'  다시 고침함.  '});
   assert.equal((await pool.query('select vals->>$2 v from public.app_feed_summary_edits where target=$1',['item:'+iA,'summary'])).rows[0].v,'다시 고침함.');
   const reset=await editItem(iA,{reset:['summary']});assert.deepEqual(reset.vals,{});
   assert.deepEqual((await aiItem()),aiBefore.item);
   const last=(await pool.query("select old_value,new_value from public.app_feed_summary_edit_history where target=$1 order by edited_at desc,id limit 1",['item:'+iA])).rows[0];
   assert.equal(last.new_value,'가상 요약');
  });
  await t.test('owner edits a room-day summary: parts stay, the AI base is the parts joined in first_at order, headline and lines are separate fields',async()=>{
   const r=await editDay(R1,D1,{lines:['손 첫째','손 둘째','손 셋째'],headline:'손으로 쓴 한 줄'});
   assert.equal(r.target,'day:'+R1+'|'+D1);assert.deepEqual(r.vals.lines,['손 첫째','손 둘째','손 셋째']);assert.equal(r.vals.headline,'손으로 쓴 한 줄');
   assert.deepEqual(await aiParts(),aiBefore.parts);
   const h=Object.fromEntries((await pool.query("select field,old_value,new_value from public.app_feed_summary_edit_history where target=$1",['day:'+R1+'|'+D1])).rows.map(x=>[x.field,x]));
   assert.deepEqual(h.lines.old_value,['가상 첫째','가상 둘째','가상 셋째'],'묶음 b1(이른 시각) 줄 뒤에 b2 줄');
   assert.equal(h.headline.old_value,'가상 한 줄');
   const only=await editDay(R1,D1,{reset:['headline']});assert.deepEqual(Object.keys(only.vals),['lines']);
   assert.equal((await editDay(R1,D1,{headline:''})).vals.headline,'');
   const all=await editDay(R1,D1,{reset:['headline','lines']});assert.deepEqual(all.vals,{});
   assert.deepEqual(await aiParts(),aiBefore.parts);
  });
  await t.test('AI keeps adding: a later part, a later item and a trashed day do not touch the user values',async()=>{
   await editItem(iA,{summary:'고친 요약 유지함.'});await editDay(R1,D1,{lines:['고친 줄']});
   await server(c=>c.query('select public.app_feed_room_day_add($1,$2,$3,$4::jsonb)',[WS_A,R1,D1,JSON.stringify(part('b3','2026-10-24T09:00:00Z',{headline:'다른 한 줄',lines:['새 묶음 줄']}))]));
   await item(WS_A,R1,D1);
   await owner(c=>c.query('select public.app_feed_room_day_set($1,$2,$3)',[R1,D1,'trashed']));
   const e=Object.fromEntries((await pool.query('select target,vals from public.app_feed_summary_edits').then(r=>r.rows.map(x=>[x.target,x.vals]))));
   assert.equal(e['item:'+iA].summary,'고친 요약 유지함.');assert.deepEqual(e['day:'+R1+'|'+D1].lines,['고친 줄']);
   assert.equal((await aiParts()).length,3);
   await owner(c=>c.query('select public.app_feed_room_day_set($1,$2,$3)',[R1,D1,'active']));
   assert.equal((await editItem(iA,{reset:['summary']})).changed,true);
   await editDay(R1,D1,{reset:['lines']});
  });
  await t.test('bad input, wrong target, other workspace, calls, strangers, anon and service_role are refused',async()=>{
   const bad=(fn,patch,re)=>assert.rejects(fn(patch),re,JSON.stringify(patch));
   for(const [p,re] of [[{bogus:1},/TGSE_FIELD/],[{headline:'가'},/TGSE_FIELD/],[{lines:['가']},/TGSE_FIELD/],[{summary:''},/TGSE_SUMMARY/],[{summary:'가'.repeat(401)},/TGSE_SUMMARY/],[{summary:'가\n나'},/TGSE_SUMMARY/],[{summary:1},/TGSE_SUMMARY/],[{reset:['lines']},/TGSE_FIELD/],[{reset:'summary'},/TGSE_RESET/],[{reset:[1]},/TGSE_RESET/]])await bad(x=>editItem(iA,x),p,re);
   for(const [p,re] of [[{summary:'가'},/TGSE_FIELD/],[{headline:'가'.repeat(61)},/TGSE_HEADLINE/],[{headline:'가\n'},/TGSE_HEADLINE/],[{headline:3},/TGSE_HEADLINE/],[{lines:[]},/TGSE_LINES/],[{lines:Array(13).fill('가')},/TGSE_LINES/],[{lines:['  ']},/TGSE_LINES/],[{lines:['가'.repeat(151)]},/TGSE_LINES/],[{lines:[1]},/TGSE_LINES/],[{lines:'가'},/TGSE_LINES/]])await bad(x=>editDay(R1,D1,x),p,re);
   await assert.rejects(owner(c=>c.query("select public.app_feed_summary_edit($1,null,null,'[]'::jsonb)",[iA])),/TGSE_PATCH/);
   await assert.rejects(owner(c=>c.query("select public.app_feed_summary_edit($1,$2,$3,'{\"summary\":\"가\"}'::jsonb)",[iA,R1,D1])),/TGSE_ARGS/);
   await assert.rejects(owner(c=>c.query("select public.app_feed_summary_edit(null,$1,null,'{}'::jsonb)",[R1])),/TGSE_ARGS/);
   await assert.rejects(owner(c=>c.query("select public.app_feed_summary_edit(null,'bad room',$1,'{}'::jsonb)",[D1])),/TGSE_ARGS/);
   await assert.rejects(editItem(MISSING,{summary:'가'}),/TGSE_NOT_FOUND/);
   await assert.rejects(editItem(iCall,{summary:'가'}),/TGSE_NOT_FOUND/,'통화 줄은 이 함수 대상이 아니다(app_call_edit)');
   await assert.rejects(editItem(iB,{summary:'가'}),/TGSE_NOT_FOUND/,'다른 작업공간');
   await assert.rejects(editDay('room_nope',D1,{lines:['가']}),/TGSE_NOT_FOUND/);
   await assert.rejects(editDay(R1,D2,{lines:['가']}),/TGSE_NOT_FOUND/);
   await assert.rejects(stranger(c=>c.query("select public.app_feed_summary_edit($1,null,null,'{\"summary\":\"x\"}')",[iA])),/TGSE_NOT_FOUND/);
   await assert.rejects(stranger(c=>c.query("select public.app_feed_summary_edit(null,$1,$2,'{\"lines\":[\"x\"]}')",[R1,D1])),/TGDG_NOT_FOUND|TGSE_NOT_FOUND/);
   await assert.rejects(as('anon','',c=>c.query("select public.app_feed_summary_edit($1,null,null,'{}')",[iA])),{code:'42501'});
   await assert.rejects(server(c=>c.query("select public.app_feed_summary_edit($1,null,null,'{}')",[iA])),{code:'42501'});
  });
  await t.test('nobody writes the new tables directly; the owner reads them; strangers, anon and service_role see nothing',async()=>{
   await editItem(iA,{summary:'읽기 확인함.'});
   for(const sql of ["insert into public.app_feed_summary_edits(workspace_id,target) values('"+WS_A+"','item:"+MISSING+"')","update public.app_feed_summary_edits set vals='{}'","delete from public.app_feed_summary_edits","insert into public.app_feed_summary_edit_history(workspace_id,target,field) values('"+WS_A+"','item:"+MISSING+"','summary')","update public.app_feed_summary_edit_history set field='summary'","delete from public.app_feed_summary_edit_history"])
    await assert.rejects(owner(c=>c.query(sql)),{code:'42501'},sql);
   assert.ok((await owner(c=>c.query('select * from public.app_feed_summary_edits'))).rows.length>=1);
   assert.ok((await owner(c=>c.query('select * from public.app_feed_summary_edit_history'))).rows.length>=1);
   assert.equal((await stranger(c=>c.query('select * from public.app_feed_summary_edits'))).rows.length,0);
   assert.equal((await stranger(c=>c.query('select * from public.app_feed_summary_edit_history'))).rows.length,0);
   await assert.rejects(as('anon','',c=>c.query('select * from public.app_feed_summary_edits')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select * from public.app_feed_summary_edits')),{code:'42501'});
   await assert.rejects(server(c=>c.query('select * from public.app_feed_summary_edit_history')),{code:'42501'});
  });
  await t.test('the existing tables keep their grants: still no direct summary or parts write for the owner',async()=>{
   await assert.rejects(owner(c=>c.query("update public.app_feed_items set summary='직접' where id=$1",[iA])),{code:'42501'});
   await assert.rejects(owner(c=>c.query("update public.app_feed_room_days set parts='[]'")),{code:'42501'});
  });
  await t.test('rollback is refused while user edits exist, then restores the snapshot after they are emptied; re-apply works',async()=>{
   const blocked=async()=>{const c=await pool.connect();try{await assert.rejects(c.query(rollbackSQL),/TG_SUMMARY_EDIT_ROLLBACK_BLOCKED/);await c.query('rollback');}finally{c.release();}};
   await blocked();
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1,'nothing changed');
   await pool.query('delete from public.app_feed_summary_edits');await pool.query('delete from public.app_feed_summary_edit_history');
   await pool.query(rollbackSQL);
   assert.equal((await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
   assert.equal((await pool.query("select to_regclass('public.app_feed_summary_edits') a,to_regprocedure('public.app_feed_summary_edit(uuid,text,date,jsonb)') f")).rows[0].a,null);
   await pool.query(migration);
   for(const r of (await pool.query(postcheck)).rows)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
