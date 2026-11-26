// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic.
// S68-46 UPDATE-소식자동(20261123150000): 새 개발 기록이 배포되면 서버가 이용자 '업데이트 소식'으로 자동으로 보낸다. 운영자는 거두기·다시 보내기.
// - 승인형 DB workflow 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 이전 묶음에 파일 이름이 없으면(옛 빌드) 아무것도 안 보낸다. 그다음부터 새 파일만 한 개씩, 같은 파일은 다시 안 보낸다(거둔 것·옛 커밋 재배포 포함).
// - 같은 날 기록이 늦게 merge되어 순번이 밀려도 파일 이름으로 가린다. 모양이 틀린 기록은 건너뛰고, 20개 넘게 한꺼번에 새로 보이면 하나도 안 보낸다.
// - 다시 보내기는 운영자만(다른 이용자·비로그인·service_role 거절). 이용자는 읽기만, 기록 파일 이름·자동 여부는 이용자에게 안 간다.
// - 되돌리기는 함수 둘을 이전 본문으로, 새 칸·새 함수·기록 1행을 지우고 보낸 소식은 남긴다.
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
const version='20261123150000',name='update_news_auto',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const prerequisites=`
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
const BEFORE=['20261024140000_call_tg_feed','20261024210000_feed_item_guard_public','20261025200000_call_personal_box',
 '20261025210000_feed_item_archive','20261026120000_call_user_edit','20261026190000_tg_sender_names','20261027010000_tg_room_day_group',
 '20261027030000_tg_sender_names_read','20261027200000_tg_summary_edit','20261028030000_tg_room_day_context','20261029090000_operator_features'];
const SHA='0123456789abcdef0123456789abcdef01234567';
// 가상 기록. file이 있으면 이 변경 뒤 빌드가 만든 묶음, 없으면 옛 빌드 묶음.
const note=(v,file,changes=[`${v} 바뀐 점`],checks=['확인할 것'])=>({v,...(file?{file}:{}),date:'2026-11-23',changes,checks});
const bundle=notes=>({schema:1,current:notes[0]?.v??null,notes});

test('update news auto: new release notes become news once, old ones stay, operator withdraws and resends, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'update-news-auto-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  await pool.query(`create table public.app_documents(id uuid primary key, workspace_id uuid not null, file_id text, extraction_status text, extracted_text text);
   alter table public.app_documents enable row level security;
   create policy fake_docs_owner on public.app_documents for select to authenticated using (private.app_is_workspace_owner(workspace_id));
   grant select on public.app_documents to authenticated;`);
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:una1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  for(const f of ['20261031120000_gdrive_photo_index','20261102160000_cloud_files_index','20261103100000_dev_inbox_feature','20261115190000_release_notes_store'])await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const updateNews=await read('supabase/migrations/20261115200000_update_news.sql');
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const guardFails=async pattern=>{const c=await pool.connect();try{await assert.rejects(c.query(migration),pattern);await c.query('rollback');}finally{c.release();}};
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),server=fn=>as('service_role','',fn),anon=fn=>as('anon','',fn);
  const put=async notes=>(await server(c=>c.query('select public.app_release_notes_put($1::jsonb,$2) r',[JSON.stringify(bundle(notes)),SHA]))).rows[0].r;

  await t.test('guard: stops without changes before the update news step is applied',async()=>{
   await guardFails(/UPDATE_NEWS_AUTO_PREREQUISITE_CHANGED/);
   await pool.query(updateNews);
  });
  // 적용 전: 운영 같은 상태 — 옛 빌드 묶음이 저장돼 있고, 손으로 보낸 소식 하나와 시작 날짜가 있다.
  const OLD=[note('11/23-2',null),note('11/23-1',null)];
  assert.equal((await put(OLD)).count,2);
  const manual=(await owner(c=>c.query("select public.app_update_news_save(null,null,array['손으로 보낸 소식'],array['11/23-1']) id"))).rows[0].id;
  await owner(c=>c.query("select public.app_update_news_set_start('2026-11-10')"));

  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))if(/^(예|아니오)$/.test(r.value))assert.equal(r.value,'예',r.item);};
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: rules pass, summary 3 lines, no fixed id, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run'])assert.equal(prepareMigration({mode,version,runId:'1',root}).flow,'full');
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b(?!\.)|disable row level security|create policy|rtw_|create temporary/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   assert.equal(v['dev_inbox rows'],'1');assert.equal(v['news rows'],'1');
   const dry=await run('dry-run','9961');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9962');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9963')).ok,false);
  });

  const list=async who=>(await who(c=>c.query('select public.app_update_news_list() l'))).rows[0].l;
  const admin=async()=>(await owner(c=>c.query('select public.app_update_news_admin() a'))).rows[0].a;
  const autoRows=async()=>(await pool.query('select lines,sources,source_files,sent_by,title,withdrawn_at from public.app_update_news where auto order by sent_at')).rows;

  await t.test('old records stay: the first bundle with file names after an old-build bundle sends nothing',async()=>{
   const r=await put([note('11/23-3','20261123-1200-c'),note('11/23-2','20261123-1100-b'),note('11/23-1','20261123-1000-a')]);
   assert.equal(r.auto,0);assert.equal(r.count,3);
   assert.equal((await autoRows()).length,0);
   assert.deepEqual((await list(stranger)).map(n=>n.id),[manual]);
  });

  await t.test('a new record after deploy becomes one news each, changes only, sender is the operator; same bundle again sends nothing',async()=>{
   const r=await put([note('11/23-5','20261123-1400-e',['다섯째 줄 하나','다섯째 줄 둘']),note('11/23-4','20261123-1300-d'),note('11/23-3','20261123-1200-c'),note('11/23-2','20261123-1100-b'),note('11/23-1','20261123-1000-a')]);
   assert.equal(r.auto,2);
   const rows=await autoRows();
   assert.deepEqual(rows.map(x=>x.source_files),[['20261123-1300-d'],['20261123-1400-e']]);
   assert.deepEqual(rows.map(x=>x.sources),[['11/23-4'],['11/23-5']]);
   assert.deepEqual(rows[1].lines,['다섯째 줄 하나','다섯째 줄 둘'],"'확인할 것' is left out");
   assert.ok(rows.every(x=>x.sent_by===OWNER&&x.title===null&&x.withdrawn_at===null));
   const seen=await list(stranger);
   assert.equal(seen.length,3);
   assert.deepEqual(seen[0].lines,['다섯째 줄 하나','다섯째 줄 둘'],'newest first');
   for(const item of seen)for(const key of ['sources','source_files','auto'])assert.equal(Object.hasOwn(item,key),false,'users do not get record names');
   assert.equal((await put([note('11/23-5','20261123-1400-e'),note('11/23-4','20261123-1300-d'),note('11/23-3','20261123-1200-c')])).auto,0);
  });

  await t.test('operator withdraws and resends; users, anon and server cannot resend',async()=>{
   const a=await admin();
   const d=a.items.find(i=>i.source_files?.[0]==='20261123-1300-d');
   assert.equal(d.auto,true);assert.deepEqual(d.sources,['11/23-4']);
   assert.equal(a.items.find(i=>i.id===manual).auto,false);
   for(const fn of [stranger,anon,server])await assert.rejects(fn(c=>c.query('select public.app_update_news_resend($1)',[d.id])),{code:'42501'});
   assert.equal((await owner(c=>c.query('select public.app_update_news_resend($1) r',[d.id]))).rows[0].r,false,'not withdrawn yet');
   assert.equal((await owner(c=>c.query('select public.app_update_news_withdraw($1) w',[d.id]))).rows[0].w,true);
   assert.equal((await list(stranger)).some(n=>n.id===d.id),false);
   // 거둔 기록은 다음 배포(그 파일이 빠졌다 다시 들어와도)에서 다시 나가지 않는다.
   assert.equal((await put([note('11/23-3','20261123-1200-c')])).auto,0);
   assert.equal((await put([note('11/23-5','20261123-1400-e'),note('11/23-4','20261123-1300-d'),note('11/23-3','20261123-1200-c')])).auto,0);
   assert.equal((await list(stranger)).some(n=>n.id===d.id),false);
   assert.equal((await owner(c=>c.query('select public.app_update_news_resend($1) r',[d.id]))).rows[0].r,true);
   assert.equal((await owner(c=>c.query('select public.app_update_news_resend($1) r',[d.id]))).rows[0].r,false);
   assert.equal((await list(stranger)).some(n=>n.id===d.id),true);
   for(const fn of [owner,stranger,server,anon])await assert.rejects(fn(c=>c.query('select private.app_update_news_auto(null,null)')),{code:'42501'});
   for(const fn of [owner,stranger,anon])await assert.rejects(fn(c=>c.query('select public.app_release_notes_put($1::jsonb,$2)',[JSON.stringify(bundle([])),SHA])),{code:'42501'});
  });

  await t.test('a late-merged record shifts the day numbers: only that file goes out, under its own number',async()=>{
   const r=await put([note('11/23-6','20261123-1400-e'),note('11/23-5','20261123-1300-d'),note('11/23-4','20261123-1230-late',['늦게 들어온 기록']),note('11/23-3','20261123-1200-c')]);
   assert.equal(r.auto,1);
   const late=(await autoRows()).at(-1);
   assert.deepEqual(late.source_files,['20261123-1230-late']);assert.deepEqual(late.sources,['11/23-4']);assert.deepEqual(late.lines,['늦게 들어온 기록']);
  });

  const base=[note('11/23-6','20261123-1400-e'),note('11/23-5','20261123-1300-d'),note('11/23-4','20261123-1230-late'),note('11/23-3','20261123-1200-c')];
  await t.test('malformed records are skipped; more than 20 new at once sends none',async()=>{
   const r=await put([note('11/24-3','20261124-0900-ok'),note('nope','20261124-0800-badv'),note('11/24-1','20261124-0700-long',['가'.repeat(201)]),
    {v:'11/24-4',file:'20261124-1000-num',date:'2026-11-24',changes:[1],checks:[]},note('11/24-5','../x'),...base]);
   assert.equal(r.auto,1);
   assert.deepEqual((await autoRows()).at(-1).source_files,['20261124-0900-ok']);
   const many=Array.from({length:21},(_,i)=>note(`11/25-${i+1}`,`20261125-${String(1000+i)}-m`));
   const flood=await put([...many,note('11/24-3','20261124-0900-ok'),...base]);
   assert.equal(flood.auto,-21);
   assert.equal((await autoRows()).length,4,"d·e·late·ok 넷 그대로");
  });

  await t.test('no operator: nothing is sent; no start date: today is set so auto news is visible',async()=>{
   await pool.query("delete from public.app_operator_features where feature='dev_inbox'");
   assert.equal((await put([note('11/26-1','20261126-0900-x'),note('11/24-3','20261124-0900-ok'),...base])).auto,0);
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'dev_inbox')",[WS_A]);
   await pool.query('delete from public.app_update_news_start');
   assert.equal((await put([note('11/26-2','20261126-1000-y'),note('11/26-1','20261126-0900-x'),note('11/24-3','20261124-0900-ok'),...base])).auto,1);
   const start=(await pool.query("select start_on::text d, start_on=(now() at time zone 'Asia/Seoul')::date today from public.app_update_news_start")).rows[0];
   assert.equal(start.today,true);
   assert.ok((await list(stranger)).length>=1);
  });

  await t.test('tables: no API role can read or write them directly',async()=>{
   for(const fn of [owner,stranger,server,anon]){
    await assert.rejects(fn(c=>c.query('select * from public.app_update_news')),{code:'42501'});
    await assert.rejects(fn(c=>c.query("update public.app_update_news set withdrawn_at=null where true")),{code:'42501'});
   }
  });

  await t.test('rollback restores the two functions and removes the new parts; sent news stay',async()=>{
   const count=(await pool.query('select count(*)::int n from public.app_update_news')).rows[0].n;
   await pool.query(rollbackSQL);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   assert.equal((await pool.query('select count(*)::int n from public.app_update_news')).rows[0].n,count);
   assert.equal((await put([note('11/27-1','20261127-0900-z')])).auto,undefined,'old function again');
   assert.equal((await pool.query("select to_regprocedure('public.app_update_news_resend(uuid)') f")).rows[0].f,null);
   assert.equal((await pool.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[version])).rows[0].n,0);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
