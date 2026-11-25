// Fresh local PostgreSQL only. No Supabase, Edge or production credentials. All data synthetic.
// S70-16 UI-고른글메뉴·형광펜 DB(20261125113000_news_highlights_marks): 밑줄 표에 모양(mark_kind)·색(mark_color) 칸.
// - 승인형 DB workflow 규칙(새 칸 권한)을 통과하고, apply 뒤 사후 확인이 모두 예. 앞 단계(20261125010000 brief)가 없으면 멈춘다.
// - 옛 밑줄 행은 그대로(두 칸 비움). 형광 줄은 색 다섯 중 하나·메모 없음. 모양은 못 고치고 색만 고친다.
// - 권한을 넓히지 않는다: 자기 작업공간 주인만 넣고 읽고 고친다. 남의 작업공간 주인은 내 형광을 못 보고 못 고친다. 익명·service_role은 못 본다.
// - 되돌리기는 형광 줄만 지우고 칸·제약·칸 권한·기록을 원래대로(지금까지의 밑줄은 그대로).
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
import {askSchema,askChain} from './ask-web2-fixture.mjs';
import {prepareMigration,toDryRun,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261125113000',name='news_highlights_marks',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;
const SRC='31000000-0000-4000-8000-000000000001';
const BEFORE=['20261029061500_ask_web2.sql','20261108070000_news_highlights.sql','20261115194000_news_highlights_note.sql','20261122100000_reading_items.sql'];

test('news highlights marks: color highlight columns, owner only, no wider privileges, guarded rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'news-hl-marks-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false,max:8}));
  await pool.query(fixture);await pool.query(prerequisites);await pool.query(askSchema);
  for(const file of [...askChain,...BEFORE])await pool.query(await read('supabase/migrations/'+file));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  async function as(role,user,fn){const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);if(user)await c.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user]);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn);
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const cols='workspace_id,source_type,source_id,quote,quote_prefix,quote_suffix,memo,source_title,source_media,source_date,source_url';
  const addOld=(user,ws)=>as('authenticated',user,c=>c.query(`insert into public.app_news_highlights(${cols}) values($1,'brief',$2,'옛 밑줄','앞','뒤','메모',null,null,null,null) returning id`,[ws,SRC]).then(r=>r.rows[0].id));
  const addPen=(user,ws,color,memo=null,kind='highlight')=>as('authenticated',user,c=>c.query(`insert into public.app_news_highlights(${cols},mark_kind,mark_color) values($1,'brief',$2,'칠한 문장','앞','뒤',$4,null,null,null,null,$5,$3) returning id`,[ws,SRC,color,memo,kind]).then(r=>r.rows[0].id));
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};

  await t.test('guard: stops without changes before the brief step (20261125010000)',async()=>{
   await guardFails(/NEWS_HIGHLIGHTS_MARKS_PREREQUISITE_CHANGED/);
   await pool.query(await read('supabase/migrations/20261125010000_news_highlights_brief.sql'));
  });
  const oldId=await addOld(OWNER,WS_A);
  const before=(await pool.query(snapshot)).rows,beforeCheck=await readOnly(precheck);

  await t.test('files: rules pass (new column grants), summary 3 lines, no policies/functions/tables',()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');
    assert.deepEqual(plan.newColumnGrantTables,['app_news_highlights']);
    assert.deepEqual([...plan.createdTables],[]);
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/create (or replace )?(function|policy|trigger|table)|drop policy|disable row level security|security definer|rtw_|app_collab|\bto (anon|public|service_role)\b|using \(true\)|with check \(true\)/i);
   assert.match(code,/commit;\s*$/);
  });
  await t.test('precheck yes, apply passes postcheck, old underline untouched, second apply refused',async()=>{
   for(const r of beforeCheck)if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);
   await pool.query(migration);
   await allYes(postcheck);
   const old=(await pool.query('select quote,memo,mark_kind,mark_color from public.app_news_highlights where id=$1',[oldId])).rows[0];
   assert.deepEqual(old,{quote:'옛 밑줄',memo:'메모',mark_kind:null,mark_color:null});
   await guardFails(/NEWS_HIGHLIGHTS_MARKS_PREREQUISITE_CHANGED/);
  });
  let pen;
  await t.test('owner paints, recolors and erases; shape checks; kind fixed; others blocked',async()=>{
   pen=await addPen(OWNER,WS_A,'green');
   await owner(c=>c.query("update public.app_news_highlights set mark_color='pink',updated_at=now() where id=$1",[pen]));
   assert.equal((await owner(c=>c.query('select mark_color from public.app_news_highlights where id=$1',[pen]))).rows[0].mark_color,'pink');
   for(const color of ['red','',null,'YELLOW'])await assert.rejects(addPen(OWNER,WS_A,color),{code:'23514'},String(color));
   await assert.rejects(addPen(OWNER,WS_A,'blue','메모'),{code:'23514'},'highlight has no memo');
   await assert.rejects(addPen(OWNER,WS_A,'blue',null,'line'),{code:'23514'},'unknown kind');
   await assert.rejects(owner(c=>c.query("update public.app_news_highlights set mark_color='blue' where id=$1",[oldId])),{code:'23514'},'old underline gets no color alone');
   await assert.rejects(owner(c=>c.query("update public.app_news_highlights set mark_kind=null where id=$1",[pen])),/permission denied/);
   await assert.rejects(owner(c=>c.query("update public.app_news_highlights set mark_color=null where id=$1",[pen])),{code:'23514'});
   // 남의 작업공간: 내 형광을 못 보고 못 고치고, 내 작업공간에 칠하지도 못한다.
   assert.equal((await stranger(c=>c.query('select id from public.app_news_highlights where id=$1',[pen]))).rowCount,0);
   assert.equal((await stranger(c=>c.query("update public.app_news_highlights set mark_color='yellow' where id=$1",[pen]))).rowCount,0);
   assert.equal((await stranger(c=>c.query('delete from public.app_news_highlights where id=$1',[pen]))).rowCount,0);
   await assert.rejects(addPen(STRANGER,WS_A,'yellow'),/row-level security/);
   const theirs=await addPen(STRANGER,WS_B,'orange');
   assert.deepEqual((await owner(c=>c.query('select id from public.app_news_highlights where id=$1',[theirs]))).rows,[]);
   await assert.rejects(as('anon','',c=>c.query('select mark_color from public.app_news_highlights')),/permission denied/);
   await assert.rejects(as('service_role','',c=>c.query('select mark_color from public.app_news_highlights')),/permission denied/);
   const gone=await addPen(OWNER,WS_A,'yellow');
   assert.equal((await owner(c=>c.query('delete from public.app_news_highlights where id=$1',[gone]))).rowCount,1);
  });
  await t.test('rollback: only highlight rows go; columns, check, grants and record back; old underline kept',async()=>{
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   const left=(await pool.query('select id,quote from public.app_news_highlights order by quote')).rows;
   assert.deepEqual(left.map(r=>r.id),[oldId]);
   await pool.query(migration);
   await allYes(postcheck);
  });
 }finally{
  await closePool(pool);
  await cluster?.stop();
 }
});
