// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real file, folder or account names).
// S49-26 FILES-통합 1-②(20261104120000_cloud_find_sources): [최근]·[큰 파일]·[별표]·찾기를 빠른 길(app_cloud_find_in)로.
// - 승인형 DB workflow 확장 규칙을 통과하고(dry-run은 아무것도 안 바꿈), apply 뒤 사후 확인이 모두 예.
// - 주인 검사는 처음 한 번: 본인 owner 작업공간 + files 허용일 때만, 그 작업공간 줄만. 다른 작업공간 0줄, files 없으면 0줄, anon 실행 못 함.
// - 켜진 출처(p_sources)만 서버가 거른다. 옛 서명 app_cloud_find는 두 출처 모두와 같은 답.
// - 큰 색인(작업공간 A 5만 줄 + B 2만 줄)에서 묶음 결과가 단순 SQL 정답과 같고, 출처별 새 색인을 타며, 빨리 끝난다.
// - 되돌리기(SQL Editor 전용)는 옛 함수 원문·색인·기록을 원래대로 하고 다시 적용할 수 있다.
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
const version='20261104120000',name='cloud_find_sources',stem=version+'_'+name;
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
const DOC_A='26000000-0000-4000-8000-0000000000a1';

test('cloud find sources: owner checked once, sources filtered on the server, shelf indexes, rollback restores',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'cloud-find-sources-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  // 자료실(app_documents) 최소 모양: 파일 id·읽은 글자·상태와 owner 정책(운영과 같은 경계).
  await pool.query(`create table public.app_documents(id uuid primary key, workspace_id uuid not null, file_id text, extraction_status text, extracted_text text);
   alter table public.app_documents enable row level security;
   create policy fake_docs_owner on public.app_documents for select to authenticated using (private.app_is_workspace_owner(workspace_id));
   revoke all on public.app_documents from anon;
   grant select on public.app_documents to authenticated;`);
  await pool.query("update public.app_workspaces set slug='kptu-work' where id=$1",[WS_A]);
  await pool.query("update public.app_workspaces set slug='other-work' where id=$1",[WS_B]);
  for(const f of BEFORE.slice(0,-1))await pool.query(await read('supabase/migrations/'+f+'.sql'));
  await pool.query("insert into public.app_feed_items(workspace_id,source,day,occurred_at,title,summary,source_ref) values($1,'call','2026-10-24','2026-10-24T03:00:00Z','가상 통화','가상 요약','call:cf1')",[WS_A]);
  await pool.query(await read('supabase/migrations/'+BEFORE.at(-1)+'.sql'));
  await pool.query(await read('supabase/migrations/20261031120000_gdrive_photo_index.sql'));
  await pool.query(await read('supabase/migrations/20261102160000_cloud_files_index.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const owner=fn=>as('authenticated',OWNER,fn),stranger=fn=>as('authenticated',STRANGER,fn),anon=fn=>as('anon','',fn);
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const allYes=async sql=>{for(const r of await readOnly(sql))assert.equal(r.ok,'예',r.item);};
  const findIn=(who,src,q,s,l=50)=>who(c=>c.query('select item_id,source,match_in,folder_path,starred,library_doc_id from public.app_cloud_find_in($1::text[],$2,$3,$4)',[src,q,s,l])).then(r=>r.rows);
  const findOld=(who,q,s,l=50)=>who(c=>c.query('select item_id,source,match_in,folder_path,starred,library_doc_id from public.app_cloud_find($1,$2,$3)',[q,s,l])).then(r=>r.rows);

  // 작은 가짜 색인(cloud-files-index 시험과 같은 모양).
  const item=(ws,source,id,parent,nm,folder=false,size=null,mod='2026-11-01T00:00:00Z')=>({workspace_id:ws,source,item_id:id,parent_id:parent,name:nm,is_folder:folder,
   mime:folder?null:'application/octet-stream',size_bytes:size,modified_at:mod,created_at:mod,hash:null,trashed:false});
  const insert=`insert into public.app_cloud_items(workspace_id,source,item_id,parent_id,name,is_folder,mime,size_bytes,modified_at,created_at,hash,trashed)
   select b.workspace_id,b.source,b.item_id,b.parent_id,b.name,b.is_folder,b.mime,b.size_bytes,b.modified_at,b.created_at,b.hash,b.trashed
     from json_populate_recordset(null::public.app_cloud_items,$1::json) b`;
  await pool.query(insert,[JSON.stringify([
   item(WS_A,'gd','fold_1',null,'가상폴더',true),item(WS_A,'gd','fold_2','fold_1','하위',true),
   item(WS_A,'gd','file_a','fold_2','가상_초안.pdf',false,5000,'2026-10-30T00:00:00Z'),
   item(WS_A,'gd','file_b','fold_2','회의록.docx',false,90000,'2026-11-01T00:00:00Z'),
   item(WS_A,'gd','file_t','fold_2','버린것.txt',false,1),
   item(WS_A,'gd','file_n','fold_2','날짜없음.txt',false,null,null),
   item(WS_A,'od','ODX!101',null,'사진.jpg',false,100,'2026-11-01T05:00:00Z'),
   item(WS_B,'gd','file_z',null,'남의파일.txt',false,1)])]);
  await pool.query("update public.app_cloud_items set trashed=true where item_id='file_t'");
  await pool.query("insert into public.app_cloud_stars(workspace_id,source,item_id) values($1,'gd','file_b'),($1,'od','ODX!101')",[WS_A]);
  await pool.query("insert into public.app_documents values($1,$2,'file_b','ready','가상 합의 내용')",[DOC_A,WS_A]);
  const oldAnswers={};
  for(const s of ['recent','big','starred'])oldAnswers[s]=await findOld(owner,null,s);
  oldAnswers.q1=await findOld(owner,'초안',null);oldAnswers.q2=await findOld(owner,'합의 회의록',null);
  const before=(await pool.query(snapshot)).rows;

  await t.test('files: expanded rules pass, summary 3 lines, no fixed id, snapshot reads catalogs only',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){
    const plan=prepareMigration({mode,version,runId:'1',root});
    assert.equal(plan.flow,'full');assert.equal(plan.rules,'expanded');
   }
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');
   assert.equal(lines.length,3);['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/disable row level security|\bto (anon|public)\b|rtw_|create policy|alter policy|drop policy/i);
   assert.doesNotMatch(code,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,'no fixed id in the migration');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot reads no app table');
   // 새 함수는 클라이언트가 보낸 작업공간 id를 받지 않는다(인자는 출처·찾기 말·묶음·개수뿐).
   assert.match(code,/create function public\.app_cloud_find_in\(p_sources text\[\], p_query text, p_shelf text, p_limit integer\)/);
   assert.match(code,/security definer\s+set search_path = ''/);
  });

  await t.test('precheck as the read-only role; dry-run changes nothing; apply passes postcheck; second apply refused',async()=>{
   const v=values(await readOnly(precheck));
   for(const [item,value] of Object.entries(v))if(/^(예|아니오)$/.test(value))assert.equal(value,'예',item);
   await allYes(postcheck);
   const dry=await run('dry-run','9991');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   const apply=await run('apply','9992');assert.equal(apply.ok,true,apply.summary);
   await allYes(postcheck);
   assert.equal((await run('apply','9993')).ok,false);
  });

  await t.test('same answers as before for both sources (old signature is a thin wrapper)',async()=>{
   for(const s of ['recent','big','starred']){
    assert.deepEqual(await findOld(owner,null,s),oldAnswers[s],s);
    assert.deepEqual(await findIn(owner,['od','gd'],null,s),oldAnswers[s],s);
   }
   assert.deepEqual(await findIn(owner,['gd','od'],'초안',null),oldAnswers.q1);
   assert.deepEqual(await findIn(owner,['od','gd'],'합의 회의록',null),oldAnswers.q2);
   assert.deepEqual((await findIn(owner,['od','gd'],null,'recent')).map(r=>r.item_id),['ODX!101','file_b','file_a','file_n']);
   assert.deepEqual((await findIn(owner,['od','gd'],null,'big')).map(r=>r.item_id),['file_b','file_a','ODX!101','file_n']);
   const b=(await findIn(owner,['gd'],null,'recent')).find(r=>r.item_id==='file_b');
   assert.deepEqual(b,{item_id:'file_b',source:'gd',match_in:null,folder_path:'가상폴더 › 하위',starred:true,library_doc_id:DOC_A});
  });

  await t.test('sources are filtered on the server: gd only, od only, none',async()=>{
   assert.deepEqual((await findIn(owner,['gd'],null,'recent')).map(r=>r.item_id),['file_b','file_a','file_n']);
   assert.deepEqual((await findIn(owner,['od'],null,'recent')).map(r=>r.item_id),['ODX!101']);
   assert.deepEqual((await findIn(owner,['od'],null,'starred')).map(r=>r.item_id),['ODX!101']);
   assert.deepEqual((await findIn(owner,['od'],'회의록',null)),[]);
   assert.deepEqual((await findIn(owner,['gd','gd'],null,'big')).map(r=>r.item_id),['file_b','file_a','file_n']);
   for(const s of ['recent','big','starred'])assert.deepEqual(await findIn(owner,[],null,s),[]);
   assert.deepEqual(await findIn(owner,[],'초안',null),[]);
   assert.deepEqual(await findIn(owner,['od','gd'],'버린것',null),[],'휴지통은 찾지 않음');
  });

  await t.test('bad input refused (sources, shelf, query, limit)',async()=>{
   for(const [src,q,s,l] of [[null,null,'recent',10],[['xx'],null,'recent',10],[['od','gd','od'],null,'recent',10],[['od',null],null,'recent',10],
     [['od'],null,'bogus',10],[['od'],'a','recent',10],[['od'],'a',null,0],[['od'],'a',null,301],[['od'],'x'.repeat(201),null,10],[['od'],'a\tb',null,10],[['od'],'a b c d e f g',null,10]])
    await assert.rejects(findIn(owner,src,q,s,l),{code:'22023'},JSON.stringify([src,q,s,l]));
  });

  await t.test('owner check: other workspace rows never, no files feature none, anon cannot run',async()=>{
   // 남의 작업공간 주인(B)에게 files가 없으면 0줄.
   for(const s of ['recent','big','starred'])assert.deepEqual(await findIn(stranger,['od','gd'],null,s),[]);
   assert.deepEqual(await findOld(stranger,null,'recent'),[]);
   // B에도 files를 주면 B는 자기 줄만, A는 여전히 자기 줄만.
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'files')",[WS_B]);
   assert.deepEqual((await findIn(stranger,['od','gd'],null,'recent')).map(r=>r.item_id),['file_z']);
   assert.ok(!(await findIn(owner,['od','gd'],null,'recent')).some(r=>r.item_id==='file_z'));
   assert.deepEqual(await findIn(stranger,['od','gd'],'가상',null),[]);
   await pool.query("delete from public.app_operator_features where feature='files' and workspace_id=$1",[WS_B]);
   // A에서 files를 빼면 A도 0줄.
   await pool.query("delete from public.app_operator_features where feature='files' and workspace_id=$1",[WS_A]);
   assert.deepEqual(await findIn(owner,['od','gd'],null,'recent'),[]);
   await pool.query("insert into public.app_operator_features(workspace_id,feature) values($1,'files')",[WS_A]);
   // 로그인 없음(sub 없음)·주인 행이 둘이면 0줄.
   assert.deepEqual(await findIn(fn=>as('authenticated','',fn),['od','gd'],null,'recent'),[]);
   await pool.query("insert into public.app_workspace_members values($1,$2,'owner')",[WS_B,OWNER]);
   assert.deepEqual(await findIn(owner,['od','gd'],null,'recent'),[]);
   await pool.query("delete from public.app_workspace_members where workspace_id=$1 and user_id=$2",[WS_B,OWNER]);
   await assert.rejects(anon(c=>c.query("select * from public.app_cloud_find_in(array['od'],null,'recent',10)")),{code:'42501'});
   await assert.rejects(anon(c=>c.query("select * from public.app_cloud_find(null,'recent',10)")),{code:'42501'});
   await assert.rejects(as('service_role','',c=>c.query("select * from public.app_cloud_find_in(array['od'],null,'recent',10)")),{code:'42501'});
  });

  await t.test('big index: 50k rows in A and 20k in B — shelves equal plain SQL answers, use the per-source index, finish fast',async()=>{
   await pool.query(`insert into public.app_cloud_items(workspace_id,source,item_id,parent_id,name,is_folder,mime,size_bytes,modified_at,created_at,trashed)
     select $1, case when g%3=0 then 'od' else 'gd' end, 'big_'||g, null, '가짜파일_'||g||'.bin', g%50=0, 'application/octet-stream',
       case when g%97=0 then null else (g*7919)%1000003 end,
       case when g%89=0 then null else timestamptz '2026-01-01' + ((g*104729)%31536000) * interval '1 second' end, now(), g%41=0
     from generate_series(1::bigint,50000) g`,[WS_A]);
   await pool.query(`insert into public.app_cloud_items(workspace_id,source,item_id,parent_id,name,is_folder,mime,size_bytes,modified_at,created_at,trashed)
     select $1, case when g%2=0 then 'od' else 'gd' end, 'other_'||g, null, '남의_'||g||'.bin', false, null, 2000000+g,
       timestamptz '2027-01-01' + g * interval '1 second', now(), false
     from generate_series(1,20000) g`,[WS_B]);
   await pool.query(`insert into public.app_documents select gen_random_uuid(), $1, 'big_'||g, 'ready', '가짜 글자 '||g from generate_series(1,6000) g where g%3<>0`,[WS_A]);
   await pool.query("insert into public.app_cloud_stars(workspace_id,source,item_id) select $1,case when g%3=0 then 'od' else 'gd' end,'big_'||g from generate_series(1,50000,250) g",[WS_A]);
   await pool.query('analyze public.app_cloud_items');await pool.query('analyze public.app_documents');
   const order={recent:'modified_at desc nulls last, item_id, source',big:'size_bytes desc nulls last, modified_at desc nulls last, item_id, source'};
   for(const src of [['od','gd'],['gd'],['od']]){
    for(const s of ['recent','big']){
     const want=(await pool.query(`select item_id from public.app_cloud_items where workspace_id=$1 and source=any($2) and not is_folder and not trashed order by ${order[s]} limit 200`,[WS_A,src])).rows.map(r=>r.item_id);
     const t0=Date.now();const got=await findIn(owner,src,null,s,200);const ms=Date.now()-t0;
     assert.equal(got.length,200);
     assert.deepEqual(got.map(r=>r.item_id),want,`${s} ${src}`);
     assert.ok(got.every(r=>src.includes(r.source)&&!r.item_id.startsWith('other_')),'only own workspace, only the given sources');
     assert.ok(ms<3000,`${s} ${src} took ${ms}ms`);
    }
    const stars=await findIn(owner,src,null,'starred',200);
    assert.ok(stars.length>0&&stars.every(r=>r.starred&&src.includes(r.source)));
   }
   // 찾기도 작업공간·출처 안에서만(남의 줄 0), 읽기 끝난 자료실 글자 포함.
   const hits=await findIn(owner,['gd'],'가짜 글자 1001',null,50);
   assert.ok(hits.some(r=>r.item_id==='big_1001'&&r.match_in==='text'));
   assert.ok(hits.every(r=>r.source==='gd'));
   assert.deepEqual(await findIn(owner,['od','gd'],'남의_',null,50),[]);
   // 함수 안 묶음 길과 같은 모양의 질의가 출처별 새 색인을 탄다.
   for(const [s,idx] of [['recent','app_cloud_items_recent_src_idx'],['big','app_cloud_items_big_src_idx']]){
    const plan=(await pool.query(`explain select r.item_id from unnest(array['od','gd']) s(src) cross join lateral (
      select i.item_id from public.app_cloud_items i where i.workspace_id='${WS_A}' and i.source=s.src and not i.is_folder and not i.trashed
      order by ${order[s].replace(', source','')} limit 200) r`)).rows.map(r=>r['QUERY PLAN']).join('\n');
    assert.match(plan,new RegExp(idx),plan);
    assert.doesNotMatch(plan,/Sort\b(?! Key)/,plan);
   }
   const docPlan=(await pool.query(`explain select d.id from public.app_documents d where d.workspace_id='${WS_A}' and d.file_id='big_1001'`)).rows.map(r=>r['QUERY PLAN']).join('\n');
   assert.match(docPlan,/app_documents_workspace_file_idx/,docPlan);
  });

  await t.test('rollback (SQL Editor) restores the old function, drops the new one and its indexes; re-apply works',async()=>{
   await pool.query("delete from public.app_cloud_items where item_id like 'big_%' or item_id like 'other_%'");
   await pool.query("delete from public.app_documents where file_id like 'big_%'");
   await pool.query("delete from public.app_cloud_stars where item_id like 'big_%'");
   await pool.query(rollbackSQL);
   assert.equal((await pool.query("select to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)') is null as gone")).rows[0].gone,true);
   assert.deepEqual((await pool.query(snapshot)).rows,before);
   await allYes(postcheck);
   assert.equal(values(await readOnly(precheck))['new migration absent'],'예');
   for(const s of ['recent','big','starred'])assert.deepEqual(await findOld(owner,null,s),oldAnswers[s],s);
   const again=await run('apply','9994');assert.equal(again.ok,true,again.summary);
   await allYes(postcheck);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
