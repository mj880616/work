// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real titles).
// S50-26 OUTSIDE-노동묶음·정돈 '옛 글 다시 정돈' DB(20261105200000_outside_title_retidy): 이미 들어간 사회운동 Now 글 제목을
// 수집기 정돈 함수(_shared/outside-tidy.ts tidyTitle, 나누기·자르기 없이)와 같은 규칙으로 다시 맞춘다.
// - 승인형 workflow 실행기(dry-run·apply)로 돌린다. 확인 SQL은 건수·예/아니오·해시만 내보낸다.
// - 새 제목이 tidyTitle(제목, 카탈로그 단체 이름, {split:false}).title과 글자 그대로 같다(SQL 단체 이름표 = 카탈로그).
// - 제목 밖의 칸·문장 표·행 수는 그대로. 옛 제목은 비공개 표에만. 3000건 넘으면 멈춤. 되돌리기는 옛 제목 복원 + 표·기록 삭제.
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
import {prepareMigration,checkSQL} from '../../scripts/ops/db-migration-plan.mjs';
import {runMigrationPlan} from '../../scripts/ops/db-migration-run.mjs';
const T=await import('../../supabase/functions/_shared/outside-tidy.ts');
const {OUTSIDE_CATALOG}=await import('../../supabase/functions/_shared/outside-catalog.ts');
const version='20261105200000',name='outside_title_retidy',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;

// [단체 열쇠, 지어낸 제목]. 고칠 것과 그대로 둘 것이 섞여 있다(기대값은 수집기 정돈 함수가 정한다).
const CASES=[
 ['kctu','[성명] 가상 노동법 개악 규탄'],['kptu','【보도자료】 가상 지부 출범 (2026.10.31)'],['ws','[노동자연대 성명] 가상 파업을 지지한다'],
 ['ws','노동자연대 학생그룹 성명: 가상 등록금 인상 반대'],['laborparty','[성명] 가상 지역 공공의료를 지켜라 – 노동당'],['pssp','가상 공공부문 구조조정 반대 2026-10-31'],
 ['kctu','[단독] 가상 기사'],['kctu','[주간홍보] 가상 일정'],['kctu','가상 A - B'],['kctu','[성명]'],['kctu','[성명]x'],['kctu','[ 논 평 ] 가상 제목 [브리핑]'],
 ['jinboparty','[진보당 논평] 가상 반대 (10.31)'],['kgreens','성명: 가상 녹색 전환'],['kgreens','가상 기후정의 행진 | 녹색당'],['kmwu','[기자회견] [성명] 가상 이중 꼬리표'],
 ['jacobin','A Fictional Strike Wave - Jacobin'],['labornotes','Fictional organizing | Labor Notes'],['kfsu','가상   빈칸  많은   제목'],['hakbi','(2026. 10. 31.) 가상 날짜 머리'],
 ['platformc','[플랫폼C 논평] 가상 플랫폼 노동'],['socialism','〈성명〉 가상 전진'],['kctu','가상 제목 (공동성명)'],['kctu','가상 제목 2026년 10월 31일'],['kctu','[입장문] 가상 입장'],
 ['kctu','가상 일반 제목 그대로'],['nocatalog','[성명] 카탈로그 밖 단체'],['justice','[브리핑] 가상 대변인 브리핑'],['leftall','「선언」 가상 선언문'],['kptu','[공공운수노조] 가상 기사'],
 ['socialist','제목 없음 · 원문 링크'],['kctu','가상 (괄호) 가운데 제목'],['kgreens','녹색당 논평 - 가상 개발 반대'],
];
const nameOf=k=>OUTSIDE_CATALOG.find(s=>s.key===k)?.name??'';
const want=([k,t])=>t==='제목 없음 · 원문 링크'?t:T.tidyTitle(t,nameOf(k),{split:false}).title;

test('outside title retidy: same rule as the collector tidyTitle, private backup, too-many stop, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'outside-retidy-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  await pool.query(await read('supabase/migrations/20261031230000_outside_statements.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  const check=async sql=>Object.fromEntries((await readOnly(sql)).map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  let n=0;
  const post=async(k,title,ws=WS_A)=>(await pool.query(`insert into public.app_outside_posts(workspace_id,source_key,kind,lang,title,url,published_at,summary_ko,has_body)
    values ($1,$2,'statement',$3,$4,$5,'2026-10-30T01:00:00Z','합성 요약.',$6) returning id`,[ws,k,/^[A-Z]/.test(title)?'en':'ko',title,'https://example.org/r/'+(++n),!/^[A-Z]/.test(title)])).rows[0].id;
  const title=async id=>(await pool.query('select title from public.app_outside_posts where id=$1',[id])).rows[0].title;
  const ids=[];for(const [i,c] of CASES.entries())ids.push(await post(c[0],c[1],i===2?WS_B:WS_A));
  await pool.query("insert into public.app_outside_sentences(post_id,workspace_id,lang,idx,text) values ($1,$2,'ko',0,'합성 본문 문장.')",[ids[0],WS_A]);
  const change=CASES.filter(c=>want(c)!==c[1]);
  const before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: SQL name table = catalog, read-only checks, three-line summary, expanded workflow accepts the file',async()=>{
   const names=sql=>{const i=sql.indexOf('n(source_key, name) as (');assert.ok(i>=0);const j=sql.indexOf("'Socialist Worker')",i)+"'Socialist Worker')".length;
     return [...sql.slice(i,j).matchAll(/\('([a-z0-9-]+)', '([^']+)'\)/g)].map(m=>[m[1],m[2]]);};
   const table=names(migration);
   assert.deepEqual(table,OUTSIDE_CATALOG.map(s=>[s.key,s.name]),'SQL 단체 이름표는 카탈로그와 같다');
   for(const sql of [precheck,postcheck])assert.deepEqual(names(sql),table);
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_outside_posts']);assert.deepEqual(p.review.definer,[]);}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level|\bgrant\b|\bto (anon|public|authenticated|service_role)\b|create policy|create (or replace )?function|information_schema|rtw_|app_outside_sentences|app_outside_sources|app_outside_seen|\bdelete\s+from\b|\btruncate\s+(table\s+)?public\b/i);
   for(const r of await readOnly(precheck))assert.match(r.value,/^(예|아니오|[0-9]+|[0-9a-f]{32})$/,r.item);
   for(const r of await readOnly(postcheck))assert.match(r.value,/^(예|아니오|[0-9]+|[0-9a-f]{32})$/,r.item);
  });

  await t.test('precheck: records counts',async()=>{
   pre=await check(precheck);
   for(const k of ['prerequisite recorded','new migration absent','fix table absent','RLS enabled'])assert.equal(pre[k],'예',k);
   assert.equal(pre['anon or public table privilege'],'아니오');
   assert.ok(Number(pre['titles with lead kind tag'])>0);
   assert.equal(pre['posts rows'],String(CASES.length));assert.equal(pre['sentences rows'],'1');
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9961');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await check(precheck),pre);
   assert.equal(await title(ids[0]),CASES[0][1]);assert.equal(await history(),0);
  });

  await t.test('apply: titles equal the collector tidyTitle, old titles kept privately, postcheck passes',async()=>{
   const result=await run('apply','9962');assert.equal(result.ok,true,result.summary);
   assert.doesNotMatch(result.summary.split('사후 확인')[1]??'',/\| 아니오 \|/);
   assert.equal(await history(),1);
   for(const [i,c] of CASES.entries())assert.equal(await title(ids[i]),want(c),c[1]);
   // 고친 제목은 정돈 함수에 다시 넣어도 같다(수집기가 다시 고치려 들지 않음).
   for(const c of CASES)assert.equal(T.tidyTitle(want(c),nameOf(c[0]),{split:false}).title,want(c),c[1]);
   const fixes=(await pool.query('select post_id,old_title,new_title from public.app_outside_title_fixes')).rows;
   assert.equal(fixes.length,change.length);
   for(const f of fixes){const i=ids.indexOf(f.post_id);assert.equal(f.old_title,CASES[i][1]);assert.equal(f.new_title,want(CASES[i]));}
   const post=await check(postcheck);
   for(const k of ['retidy agrees with history','fix table locked','RLS still enabled','no anon or public table privilege'])assert.equal(post[k],'예',k);
   for(const k of ['posts rows','sentences rows','columns except title hash','constraints hash','policies hash','owner RLS grants hash','column grants hash','triggers hash'])assert.equal(post[k],pre[k],k);
   assert.equal((await check(precheck))['titles with lead kind tag'],'0');
   assert.equal((await run('apply','9963')).ok,false);
   await assert.rejects(pool.query(migration),/OUTSIDE_TITLE_RETIDY_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('fix table: owner login, anon and service_role cannot read or write it; another login never sees other workspace posts',async()=>{
   for(const role of ['authenticated','anon','service_role'])
    await assert.rejects(as(role,OWNER,c=>c.query('select count(*) from public.app_outside_title_fixes')),/permission denied/,role);
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_outside_title_fixes(post_id,workspace_id,old_title,new_title) values (gen_random_uuid(),$1,'x','y')",[WS_A])),/permission denied/);
   const seen=await as('authenticated',STRANGER,c=>c.query('select count(*) filter (where workspace_id<>$1)::int other from public.app_outside_posts',[WS_B]));
   assert.equal(seen.rows[0].other,0);
  });

  await t.test('rollback stops when a fixed title changed again, then restores the old titles',async()=>{
   await pool.query("update public.app_outside_posts set title='합성 다시 고친 제목' where id=$1",[ids[0]]);
   await assert.rejects(pool.query(rollbackSQL),/OUTSIDE_TITLE_RETIDY_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query('update public.app_outside_posts set title=$2 where id=$1',[ids[0],want(CASES[0])]);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.equal((await pool.query("select to_regclass('public.app_outside_title_fixes') is null as gone")).rows[0].gone,true);
   for(const [i,c] of CASES.entries())assert.equal(await title(ids[i]),c[1],c[1]);
   const post=await check(postcheck);assert.equal(post['retidy agrees with history'],'예');assert.equal(post['fix table locked'],'예');
   assert.deepEqual(await check(precheck),pre);
  });

  await t.test('more than 3000 titles to fix: apply stops without a change',async()=>{
   await pool.query(`insert into public.app_outside_posts(workspace_id,source_key,kind,lang,title,url)
     select $1,'kctu','statement','ko','[성명] 합성 제목 '||g,'https://example.org/many/'||g from generate_series(1,3000) g`,[WS_A]);
   assert.equal((await run('apply','9964')).ok,false);
   await assert.rejects(pool.query(migration),/OUTSIDE_TITLE_RETIDY_TOO_MANY/);await pool.query('rollback');
   assert.equal(await history(),0);assert.equal(await title(ids[0]),CASES[0][1]);
   assert.equal((await pool.query("select to_regclass('public.app_outside_title_fixes') is null as gone")).rows[0].gone,true);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
