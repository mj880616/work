// Fresh local PostgreSQL only. No Supabase, Edge or production credentials. All data synthetic.
// S68-27 READ-보관기록일원화 PR-1 DB(20261122230000_reading_one_store): '보관한 글'의 원본을 읽을 거리 표 하나로.
// - 승인형 workflow plan(확장 규칙)·사전 조건 멈춤·dry-run(아무것도 안 바꿈)·apply·사후 확인(개수는 숫자만)·두 번째 apply 거절.
// - 옮기기: 별표(사회운동은 옛 보관 포함) 글이 작업공간마다 자기 읽을 거리 줄로(저장 시각 = 별표 시각, 읽음, 원문 사본), 같은 주소 직접 저장 줄은 연결만,
//   두 번 돌려도 같은 결과(멱등). 옛 별표 칸·밑줄은 그대로.
// - app_reading_keep: 주인만·News 기능 키 있는 사람만·읽을 수 있는 글만. 켜기 두 번 = 한 줄, 끄기 = 줄 지우고 별표 폴더 비움, 되돌리기 = 원래 시각.
//   화면은 새 칸을 직접 넣거나 고치지 못함. 남의 작업공간 줄은 못 봄. anon 거절.
// - 폰 공유 app_news_user_save: 별표 칸 대신 읽을 거리 한 줄. 보관 기간 정리: 읽을 거리가 가리키거나 같은 주소인 글만 남김.
// - 되돌리기(SQL Editor): 이전 함수 본문·snapshot 그대로, 옮긴 줄은 남음, 다시 적용 가능.
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
import {OWNER,STRANGER,WS_A,WS_B} from './basket4-fixture.mjs';
import {setupSteps} from './reading-one-store-fixture.mjs';
import {prepareMigration,toDryRun} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const version='20261122230000',name='reading_one_store',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const fnSrc=(sql,tag,after)=>{const i=sql.indexOf('as '+tag,sql.indexOf(after))+3+tag.length;return sql.slice(i,sql.indexOf(tag,i));};
const N=n=>'31000000-0000-4000-8000-00000000000'+n,O=n=>'34000000-0000-4000-8000-00000000000'+n;
const FOLDER='32000000-0000-4000-8000-000000000001',DIRECT='33000000-0000-4000-8000-000000000001';

test('READ one store: plan, guard, dry-run, apply, move once per workspace, keep RPC, phone save, retention, rollback',{timeout:300000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'reading-one-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();
  pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  for(const sql of await setupSteps(read))await pool.query(sql);
  const retention=await read('supabase/migrations/20261120130000_news_outside_retention.sql'),userSave=await read('supabase/migrations/20261115230000_news_user_save.sql');
  const oldSrc={news:fnSrc(retention,'$prune$','create or replace function public.app_news_prune'),out:fnSrc(retention,'$oprune$','create function public.app_outside_prune'),
   save:fnSrc(userSave,'$$','create function public.app_news_user_save')};
  const src=async sig=>(await pool.query(`select prosrc from pg_proc where oid='${sig}'::regprocedure`)).rows[0].prosrc;
  assert.equal(await src('public.app_news_prune(timestamptz,integer)'),oldSrc.news,'시험 바탕 = 저장소 원문 판');

  // ---- 합성 자료(제목·내용은 가짜).
  const q=(sql,p)=>pool.query(sql,p);
  await q(`insert into public.app_news_articles(id,origin,lane,url,url_key,title,publisher,state) values
   ($1,'site','media','https://news.example.org/a/1','news.example.org/a/1','합성 기사 1','합성매체','ok'),
   ($2,'site','media','https://news.example.org/a/2','news.example.org/a/2','합성 기사 2',null,'ok'),
   ($3,'site','media','https://news.example.org/a/3','news.example.org/a/3','합성 기사 3',null,'ok'),
   ($4,'site','media','https://news.example.org/a/4','news.example.org/a/4','합성 기사 4',null,'ok'),
   ($5,'user','channel','https://news.example.org/a/5','news.example.org/a/5','합성 기사 5',null,'ok'),
   ($6,'user','channel','https://news.example.org/a/6','news.example.org/a/6','합성 기사 6',null,'ok'),
   ($7,'tg_scrap','channel','https://news.example.org/a/7','news.example.org/a/7','합성 기사 7',null,'ok'),
   ($8,'site','media','https://news.example.org/a/8','news.example.org/a/8','합성 기사 8',null,'ok')`,[N(1),N(2),N(3),N(4),N(5),N(6),N(7),N(8)]);
  await q(`insert into public.app_news_article_bodies(article_id,blocks,state,chars) values
   ($1,'[{"t":"h","text":"소제목"},{"t":"p","text":"첫 문단"},{"t":"p","text":"둘째 문단"}]'::jsonb,'ok',11),($2,'[{"t":"p","text":"리드만"}]'::jsonb,'lead',3)`,[N(1),N(3)]);
  await q('insert into public.app_news_folders(id,workspace_id,name) values ($1,$2,$3)',[FOLDER,WS_A,'합성 폴더']);
  await q(`insert into public.app_news_marks(workspace_id,article_id,starred_at,folder_id) values
   ($1,$3,'2026-11-01T00:00:00Z',$7),($1,$4,'2026-11-02T00:00:00Z',null),($2,$5,'2026-11-03T00:00:00Z',null),($1,$6,'2026-11-05T00:00:00Z',null)`,
   [WS_A,WS_B,N(1),N(2),N(3),N(5),FOLDER]);
  await q('insert into public.app_news_marks(workspace_id,article_id,hidden_at) values ($1,$2,now())',[WS_A,N(4)]);
  await q("insert into public.app_news_reads(workspace_id,article_id,read_at) values ($1,$2,'2026-11-01T01:00:00Z')",[WS_A,N(1)]);
  await q("insert into public.app_reading_items(id,workspace_id,url,title,saved_at) values ($1,$2,'https://news.example.org/a/2','직접 저장','2026-10-01T00:00:00Z')",[DIRECT,WS_A]);
  await q(`insert into public.app_outside_articles(id,source_key,kind,lang,title,url,published_at,fetched_at) values
   ($1,'kctu','statement','ko','합성 성명 1','https://union.example.org/s/1',now(),now()),($2,'kctu','statement','ko','합성 성명 2','https://union.example.org/s/2',now(),now()),
   ($3,'kctu','statement','ko','합성 성명 3','https://union.example.org/s/3',now(),now()),($4,'kctu','statement','ko','합성 성명 4','https://union.example.org/s/4',now(),now())`,[O(1),O(2),O(3),O(4)]);
  await q("insert into public.app_outside_article_sentences(article_id,idx,text) values ($1,0,'문장 하나'),($1,1,'문장 둘')",[O(2)]);
  await q("insert into public.app_outside_article_marks(workspace_id,article_id,starred_at) values ($1,$2,'2026-11-10T00:00:00Z'),($1,$3,'2026-11-11T00:00:00Z')",[WS_A,O(1),O(2)]);
  await q("insert into public.app_outside_article_marks(workspace_id,article_id,archived_at) values ($1,$2,'2026-11-12T00:00:00Z')",[WS_B,O(3)]);
  await q("insert into public.app_news_highlights(workspace_id,source_type,source_id,quote) values ($1,'news',$2,'합성 밑줄'),($1,'outside',$3,'합성 밑줄')",[WS_A,N(1),O(1)]);

  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL,summary]=await Promise.all(['precheck.sql','postcheck.sql','snapshot.sql','rollback.sql','summary.md'].map(k=>read('docs/'+stem+'.'+k)));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
  const values=rows=>Object.fromEntries(rows.map(r=>[r.item,r.value]));
  const history=async()=>(await q('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  const rows=async()=>(await q(`select workspace_id::text ws, url, title, site, origin, news_article_id::text news, outside_article_id::text outside, saved_at, read_at, body, body_state,
    body_at is not null as body_at from public.app_reading_items order by workspace_id, url`)).rows;
  const keep=(sub,ws,source,article,on,at=null)=>as('authenticated',sub,async c=>(await c.query('select public.app_reading_keep($1,$2,$3,$4,$5) r',[ws,source,article,on,at])).rows[0].r);
  const marks=async()=>(await q('select workspace_id::text ws, article_id::text a, starred_at, folder_id::text f, hidden_at from public.app_news_marks order by 1,2')).rows;
  const before=(await q(snapshot)).rows,marks0=await marks();let pre;

  await t.test('files: expanded full flow, three-line summary, no anon/PUBLIC/rtw, rollback is SQL Editor only and carries the earlier bodies',async()=>{
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');
    assert.deepEqual([...p.targets].sort(),['app_news_marks','app_reading_items'],'백업 대상: 칸을 더하는 표와 검사를 지우는 표');}
   assert.throws(()=>prepareMigration({mode:'rollback',version,runId:'1',root}));
   assert.match(toDryRun(migration),/rollback;\s*$/);
   const lines=summary.trim().split('\n');assert.equal(lines.length,3);
   ['무엇이 바뀌나:','잘못되면:','되돌리는 법:'].forEach((p,i)=>assert.ok(lines[i].startsWith(p)));
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/\bto (anon|public)\b|disable row level|rtw_|create policy|drop policy|app_feed_items|app_family|app_tg_|app_call_/i);
   assert.doesNotMatch(code,/grant [^;]* on table/i,'표 권한은 그대로');
   assert.match(code,/grant execute on function public\.app_reading_keep\(uuid, text, uuid, boolean, timestamptz\) to authenticated;/);
   const top=code.replace(/\$\$[\s\S]*?\$\$|\$prune\$[\s\S]*?\$prune\$|\$oprune\$[\s\S]*?\$oprune\$/g,'');
   assert.doesNotMatch(top,/delete from public\./i,'최상위에서 줄을 지우지 않음(끄기의 지우기는 함수 안)');
   assert.doesNotMatch(top,/update public\.app_news_marks|update public\.app_outside_article_marks|update public\.app_news_highlights/i,'옛 별표 칸·밑줄은 고치지 않음');
   for(const s of Object.values(oldSrc))assert.ok(rollbackSQL.includes(s),'되돌리기에 이전 본문 그대로');
   assert.doesNotMatch(snapshot,/from public\./i,'snapshot은 앱 표를 읽지 않음');
  });

  await t.test('precheck before apply: all 예, counts recorded',async()=>{
   pre=values(await readOnly(precheck));
   for(const [k,v] of Object.entries(pre))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   assert.equal(pre['news stars'],'4');assert.equal(pre['outside saves'],'3');assert.equal(pre['reading rows'],'1');assert.equal(pre['news highlights'],'1');
  });

  await t.test('guard stops when a function changed, a column exists or a record is missing',async()=>{
   for(const change of [
    `create or replace function public.app_news_prune(p_now timestamptz, p_limit integer) returns integer language plpgsql security definer set search_path = '' as $f$ begin return 0; end $f$`,
    'alter table public.app_reading_items add column origin text',
    `delete from supabase_migrations.schema_migrations where version='20261122100000'`,
   ]){
    const c=await pool.connect();
    try{await c.query('begin');await c.query(change);
     await assert.rejects(c.query(migration.replace(/^begin;/,'').replace(/commit;\s*$/,'')),/READING_ONE_STORE_PREREQUISITE_CHANGED/,change);}
    finally{await c.query('rollback');c.release();}
   }
   assert.equal(await history(),0);
  });

  await t.test('dry-run leaves catalog, rows and marks unchanged',async()=>{
   const dry=await run('dry-run','9981');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await q(snapshot)).rows,before);assert.deepEqual(values(await readOnly(precheck)),pre);
   assert.equal(await history(),0);assert.equal((await rows()).length,1);assert.deepEqual(await marks(),marks0);
  });

  await t.test('apply: postcheck passes with counts only; second apply refused',async()=>{
   const result=await run('apply','9982');assert.equal(result.ok,true,result.summary);
   const post=values(await readOnly(postcheck));
   for(const [k,v] of Object.entries(post))assert.match(v,/^(예|아니오|\d+)$/,k+': 사후 확인은 예/아니오·개수만');
   for(const [k,v] of Object.entries(pre))assert.match(v,/^(예|아니오|\d+|[0-9a-z_:/ ]+)$/,k);
   for(const [k,v] of Object.entries(post))if(/^(예|아니오)$/.test(v))assert.equal(v,'예',k);
   for(const k of ['news stars','outside saves','news highlights','outside highlights','reading highlights'])assert.equal(post[k],pre[k],k+' 그대로');
   assert.equal(post['reading rows from news'],'3');assert.equal(post['reading rows from outside'],'3');
   assert.equal(post['reading rows linked to news'],'4');assert.equal(post['reading rows linked to outside'],'3');assert.equal(post['reading rows now'],'7');
   assert.equal((await run('apply','9983')).ok,false);
   await assert.rejects(q(migration),/READING_ONE_STORE_PREREQUISITE_CHANGED/);await q('rollback');
  });

  await t.test('moved rows: own workspace only, star time, read time, body copy, same-url direct row linked, old marks and highlights untouched',async()=>{
   const r=await rows(),by=u=>r.find(x=>x.url===u);
   const n1=by('https://news.example.org/a/1');
   assert.equal(n1.ws,WS_A);assert.equal(n1.origin,'news');assert.equal(n1.news,N(1));assert.equal(n1.site,'합성매체');assert.equal(n1.title,'합성 기사 1');
   assert.equal(n1.saved_at.toISOString(),'2026-11-01T00:00:00.000Z');assert.equal(n1.read_at.toISOString(),'2026-11-01T01:00:00.000Z');
   assert.equal(n1.body,'소제목\n\n첫 문단\n\n둘째 문단');assert.equal(n1.body_state,'ok');assert.equal(n1.body_at,true);
   const d=by('https://news.example.org/a/2');assert.equal(d.origin,'direct');assert.equal(d.news,N(2));assert.equal(d.title,'직접 저장','같은 주소 직접 저장 줄은 연결만');
   assert.equal(r.filter(x=>x.url==='https://news.example.org/a/2').length,1);
   const n3=by('https://news.example.org/a/3');assert.equal(n3.ws,WS_B,'B의 별표는 B의 줄');assert.equal(n3.body,'리드만');assert.equal(n3.body_state,'paywall');
   const n5=by('https://news.example.org/a/5');assert.equal(n5.body_state,'pending');assert.equal(n5.body,null);assert.equal(n5.body_at,false);
   assert.equal(by('https://news.example.org/a/4'),undefined,'숨김만 한 글은 보관 아님');
   const o2=by('https://union.example.org/s/2');assert.equal(o2.origin,'outside');assert.equal(o2.outside,O(2));assert.equal(o2.body,'문장 하나 문장 둘');
   const o3=by('https://union.example.org/s/3');assert.equal(o3.ws,WS_B);assert.equal(o3.saved_at.toISOString(),'2026-11-12T00:00:00.000Z','옛 보관 시각');
   assert.deepEqual(await marks(),marks0,'옛 별표·폴더·숨김 칸 그대로');
   assert.equal((await q("select count(*)::int n from public.app_news_highlights where source_type in ('news','outside')")).rows[0].n,2,'밑줄 그대로');
  });

  await t.test('move is idempotent: running the move part again changes nothing',async()=>{
   const once=await rows();
   const part=migration.slice(migration.indexOf('-- ===== 옮기기 시작'),migration.indexOf('-- ===== 옮기기 끝'));
   await q(part);await q(part);
   assert.deepEqual(await rows(),once);
  });

  await t.test('owner only: stranger sees only own rows, cannot write the new columns directly; anon refused',async()=>{
   const seen=await as('authenticated',STRANGER,async c=>(await c.query('select workspace_id::text ws from public.app_reading_items')).rows);
   assert.ok(seen.length>0&&seen.every(x=>x.ws===WS_B),'남의 작업공간 줄은 안 보임');
   for(const sql of [`insert into public.app_reading_items(workspace_id,url,origin) values ('${WS_A}','https://x.example.org/1','news')`,
    `insert into public.app_reading_items(workspace_id,url,news_article_id) values ('${WS_A}','https://x.example.org/1','${N(8)}')`,
    `update public.app_reading_items set news_article_id='${N(8)}' where workspace_id='${WS_A}'`])
    await assert.rejects(as('authenticated',OWNER,c=>c.query(sql)),{code:'42501'},sql);
   await assert.rejects(as('anon','',c=>c.query('select public.app_reading_keep($1,$2,$3,$4,$5)',[WS_A,'news',N(8),true,null])),{code:'42501'});
   for(const fn of ["private.app_reading_keep_row('"+WS_A+"','news','"+N(8)+"',null)","private.app_reading_body('news','"+N(8)+"')"])
    for(const role of ['authenticated','service_role'])await assert.rejects(as(role,OWNER,c=>c.query('select '+fn)),{code:'42501'},role+' '+fn);
  });

  await t.test('keep RPC: feature key required, on twice = one row, off removes and clears folder, undo keeps the original time, unreadable articles refused',async()=>{
   await assert.rejects(keep(OWNER,WS_A,'news',N(8),true),{code:'42501',message:'READINGKEEP_UNAVAILABLE'},'News 기능 키 없음');
   await q("insert into public.app_operator_features(workspace_id,feature) values ($1,'outside')",[WS_A]);
   await assert.rejects(keep(STRANGER,WS_A,'news',N(8),true),{code:'42501',message:'READINGKEEP_OWNER'});
   await assert.rejects(keep(OWNER,WS_A,'paper',N(8),true),{code:'22023',message:'READINGKEEP_ARGS'});
   await assert.rejects(keep(OWNER,WS_A,'news',N(8),false,'2026-11-01T00:00:00Z'),{code:'22023',message:'READINGKEEP_ARGS'});
   await assert.rejects(keep(OWNER,WS_A,'news','31000000-0000-4000-8000-000000000099',true),{code:'22023',message:'READINGKEEP_ARTICLE'});
   const a=await keep(OWNER,WS_A,'news',N(8),true),b=await keep(OWNER,WS_A,'news',N(8),true);
   assert.equal(a.created,true);assert.equal(b.created,false);assert.equal(a.id,b.id);
   assert.equal((await q('select count(*)::int n from public.app_reading_items where news_article_id=$1',[N(8)])).rows[0].n,1);
   assert.equal((await q('select origin from public.app_reading_items where id=$1',[a.id])).rows[0].origin,'news');
   // 끄기: 줄 지움 + 별표 폴더 비움(옛 별표 칸은 그대로).
   const off=await keep(OWNER,WS_A,'news',N(1),false);
   assert.equal(off.removed,1);assert.equal(new Date(off.saved_at).toISOString(),'2026-11-01T00:00:00.000Z');
   const m1=(await marks()).find(x=>x.ws===WS_A&&x.a===N(1));assert.equal(m1.f,null);assert.ok(m1.starred_at,'옛 별표 칸은 원본이 아니므로 그대로');
   assert.equal((await keep(OWNER,WS_A,'news',N(1),false)).removed,0,'두 번 끄기 = 0');
   const back=await keep(OWNER,WS_A,'news',N(1),true,off.saved_at);
   assert.equal(new Date(back.saved_at).toISOString(),'2026-11-01T00:00:00.000Z','되돌리기 = 원래 시각');
   // 사회운동 켜기·끄기.
   const o4=await keep(OWNER,WS_A,'outside',O(4),true);assert.equal(o4.created,true);
   assert.equal((await keep(OWNER,WS_A,'outside',O(4),false)).removed,1);
   // 읽을 수 없는 글: 남이 직접 넣은 기사(내 표시 없음), 채널 스크랩(텔레그램 운영자 아님).
   await assert.rejects(keep(OWNER,WS_A,'news',N(6),true),{code:'42501',message:'READINGKEEP_UNAVAILABLE'});
   await q("delete from public.app_operator_features where workspace_id=$1 and feature='telegram'",[WS_A]);
   await assert.rejects(keep(OWNER,WS_A,'news',N(7),true),{code:'42501',message:'READINGKEEP_UNAVAILABLE'});
   await q("insert into public.app_operator_features(workspace_id,feature) values ($1,'telegram')",[WS_A]);
   // News 기능이 없는 B: 직접 저장은 그대로 되고 보관 함수만 거절.
   await assert.rejects(keep(STRANGER,WS_B,'news',N(8),true),{code:'42501',message:'READINGKEEP_UNAVAILABLE'});
   await as('authenticated',STRANGER,c=>c.query("insert into public.app_reading_items(workspace_id,url,title) values ($1,'https://b.example.org/1','B 직접')",[WS_B]));
  });

  await t.test('phone save (service_role): reading row instead of a star, mark kept for visibility, same call twice = one row',async()=>{
   const save=()=>as('service_role','',async c=>(await c.query('select public.app_news_user_save($1,$2,$3,$4) r',[WS_A,'https://news.example.org/a/3','news.example.org/a/3',null])).rows[0].r);
   const s1=await save(),s2=await save();
   assert.equal(s1.found,true);assert.ok(s1.reading_id);assert.equal(s1.reading_id,s2.reading_id);
   const m=(await marks()).find(x=>x.ws===WS_A&&x.a===N(3));assert.ok(m,'표시 줄(읽기용)');assert.equal(m.starred_at,null,'별표 칸은 안 씀');assert.equal(m.hidden_at,null);
   assert.equal((await q('select count(*)::int n from public.app_reading_items where workspace_id=$1 and news_article_id=$2',[WS_A,N(3)])).rows[0].n,1);
   await assert.rejects(as('authenticated',OWNER,c=>c.query('select public.app_news_user_save($1,$2,$3,$4)',[WS_A,'https://news.example.org/a/3','news.example.org/a/3',null])),{code:'42501'});
  });

  await t.test('retention keeps only articles a reading row points at or shares an address with',async()=>{
   await q("insert into public.app_news_articles(id,origin,lane,url,url_key,title,state,created_at) values ($1,'site','media','https://news.example.org/a/9','news.example.org/a/9','합성 기사 9','ok',now()-interval '10 days')",[N(9)]);
   await q("insert into public.app_reading_items(workspace_id,url) values ($1,'https://news.example.org/a/9')",[WS_B]);
   await q(`insert into public.app_news_articles(id,origin,lane,url,url_key,title,state,created_at) values ('31000000-0000-4000-8000-000000000010','site','media','https://news.example.org/a/10','news.example.org/a/10','합성 기사 10','ok',now()-interval '10 days')`);
   await q("update public.app_news_articles set created_at=now()-interval '10 days'");
   await q("update public.app_outside_articles set fetched_at=now()-interval '1 year'");
   // 옛 별표만 있고 읽을 거리에서 뺀 글(N2의 직접 줄을 지움) → 이제 지워질 수 있다.
   await q('delete from public.app_reading_items where id=$1',[DIRECT]);
   await as('service_role','',c=>c.query('select public.app_news_prune(now(),5000), public.app_outside_prune(now(),5000)'));
   const left=new Set((await q('select id::text id from public.app_news_articles')).rows.map(x=>x.id));
   for(const k of [1,3,5,8,9])assert.ok(left.has(N(k)),'남김 '+k);
   for(const k of [2,4])assert.ok(!left.has(N(k)),'지움 '+k);
   assert.ok(!left.has('31000000-0000-4000-8000-000000000010'));
   const oleft=new Set((await q('select id::text id from public.app_outside_articles')).rows.map(x=>x.id));
   for(const k of [1,2,3])assert.ok(oleft.has(O(k)),'사회운동 남김 '+k);assert.ok(!oleft.has(O(4)),'뺀 글은 지움');
  });

  await t.test('rollback (SQL Editor) restores the earlier bodies and catalog, keeps moved rows; re-apply works',async()=>{
   const kept=(await q('select count(*)::int n from public.app_reading_items')).rows[0].n;
   await q(rollbackSQL);
   assert.equal(await history(),0);
   assert.equal(await src('public.app_news_prune(timestamptz,integer)'),oldSrc.news);
   assert.equal(await src('public.app_outside_prune(timestamptz,integer)'),oldSrc.out);
   assert.equal(await src('public.app_news_user_save(uuid,text,text,jsonb)'),oldSrc.save);
   assert.deepEqual((await q(snapshot)).rows,before);
   assert.equal((await q('select count(*)::int n from public.app_reading_items')).rows[0].n,kept,'옮긴 줄은 남음');
   await q("update public.app_news_marks set folder_id=null where folder_id is not null and starred_at is null");
   const again=await run('apply','9984');assert.equal(again.ok,true,again.summary);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
