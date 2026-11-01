// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real titles or summaries).
// S47-42 OUTSIDE-요약실패정리 DB(20261101210000_outside_summary_fail_clear): 사회운동 Now 글 중 요약이 AI '재료 없음' 안내 문장인 글만 요약을 비운다.
// - 승인형 workflow 실행기(dry-run·apply)로 돌리고, 사전 확인의 비울 수가 규칙대로 나온다.
// - 고르는 규칙이 수집기 검사 목록(_shared/ai-model.ts AI_NO_MATERIAL_PATTERNS)과 같은 판정이다(실제 요약은 그대로).
// - 요약·핵심 문장 밖의 칸·문장 표·다른 작업공간 줄 수는 그대로. 옛 요약은 비공개 표에만. 150건 넘으면 멈춤. 되돌리기는 옛 요약 복원 + 표·기록 삭제.
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
const model=await import('../../supabase/functions/_shared/ai-model.ts');
const version='20261101210000',name='outside_summary_fail_clear',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;`;

// 안내 문장(비울 것): tests/ai-tone.test.mjs와 같은 목록 + 빈칸·줄바꿈이 섞인 꼴. 실제 요약(남길 것)도 같은 목록 + 비슷한 낱말이 든 요약.
const BAD=['요약할 수 없음.','본문이 제공되지 않아 요약할 수 없음.','요약 불가함.','요약이 어려움.','기사 본문이 없음.','본문 내용이 확인되지 않음.',
 '원문이 제공되지 않음.','제목만으로는 내용 파악 어려움.','요약할 내용이 없음.','The article body was not provided, so it cannot be summarized.','No content provided.',
 '제공된 내용은 제목과 작성일뿐이라 본문이 없음.','본문이\n제공되지 않아   요약할 수 없음.','The text was unavailable; it CANNOT BE SUMMARIZED.'];
const OK=['가상 정부 대책에 실질 내용이 없어 비판함.','노동법 개악 규탄 입장 밝힘.','단체가 기사 내용을 반박함.','교섭 결과 확인 필요함.',
 '가상 단체가 요약 보고서를 냄.','The union says the plan cannot be justified.','합성 성명: 임금 교섭 결렬 규탄함.'];

test('outside summary fail clear: notices only, same rule as the collector, private backup, too-many stop, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'outside-fail-clear-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
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
  const KEY=[{orig:'Synthetic key sentence.',ko:'합성 핵심 문장.'}];
  const post=async(p)=>(await pool.query(`insert into public.app_outside_posts(workspace_id,source_key,kind,lang,title,title_ko,url,published_at,summary_ko,key_sentences,has_body)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) returning id`,[p.ws??WS_A,p.lang==='en'?'jacobin':'kctu',p.lang==='en'?'article':'statement',p.lang??'ko',
    '[성명] 합성 제목 '+(++n),p.lang==='en'?'합성 한국어 제목':null,'https://example.org/a/'+n,'2026-10-30T01:00:00Z',p.summary??null,JSON.stringify(p.key??[]),p.lang!=='en'&&!!p.body])).rows[0].id;
  const row=async id=>(await pool.query('select summary_ko s,key_sentences k from public.app_outside_posts where id=$1',[id])).rows[0];
  const isEn=s=>/^[A-Za-z]/.test(s);

  // 수집기 검사 목록과 같은 판정이 기준: 목록이 안내 문장으로 보면 비울 것, 아니면 남길 것.
  for(const s of BAD)assert.equal(model.aiSaysNoMaterial(s),true,s);
  for(const s of OK)assert.equal(model.aiSaysNoMaterial(s),false,s);
  const CLEAR={},KEEP={};
  for(const [i,s] of BAD.entries())CLEAR[s]=await post({summary:s,lang:isEn(s)?'en':'ko',key:isEn(s)&&i%2?KEY:[],body:!isEn(s),ws:i===3?WS_B:WS_A});
  for(const s of OK)KEEP[s]=await post({summary:s,lang:isEn(s)?'en':'ko',key:isEn(s)?KEY:[],body:!isEn(s)});
  const empty=await post({});
  const sentencePost=CLEAR[BAD[1]];
  await pool.query('insert into public.app_outside_sentences(post_id,workspace_id,lang,idx,text) values ($1,$2,$3,0,$4)',[sentencePost,WS_A,'ko','합성 본문 문장.']);
  const enBad=BAD.filter(isEn),enKeyBad=BAD.filter((s,i)=>isEn(s)&&i%2);
  const before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: read-only checks, three-line summary, expanded workflow accepts the file and backs up app_outside_posts',async()=>{
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');assert.deepEqual(p.targets,['app_outside_posts']);assert.deepEqual(p.review.definer,[]);}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level|\bgrant\b|\bto (anon|public|authenticated|service_role)\b|create policy|create (or replace )?function|information_schema|rtw_|app_outside_sentences|app_outside_sources|app_outside_seen/i);
   for(const sql of [precheck,postcheck,snapshot,rollbackSQL])assert.doesNotMatch(sql,/information_schema/i);
   // 공개 저장소: 확인 SQL은 요약·제목을 결과로 내보내지 않는다(건수·예/아니오·해시만).
   for(const r of await readOnly(precheck))assert.match(r.value,/^(예|아니오|[0-9]+|[0-9a-f]{32})$/,r.item);
   for(const r of await readOnly(postcheck))assert.match(r.value,/^(예|아니오|[0-9]+|[0-9a-f]{32})$/,r.item);
   // 고르는 규칙은 migration·사전·사후 확인에서 글자 그대로 같다.
   const rule=s=>s.match(/regexp_replace\(p\.summary_ko, '\\s\+', ' ', 'g'\) ~\*? '(?:[^']|'')*'/g);
   assert.equal(rule(migration).length,4);
   for(const sql of [precheck,postcheck])assert.deepEqual(rule(sql),rule(migration).slice(0,2));
   assert.deepEqual(rule(migration).slice(2),rule(migration).slice(0,2));
  });

  await t.test('precheck: counts match the collector rule',async()=>{
   pre=await check(precheck);
   for(const k of ['prerequisite recorded','new migration absent','fix table absent','RLS enabled'])assert.equal(pre[k],'예',k);
   assert.equal(pre['anon or public table privilege'],'아니오');
   assert.equal(pre['summaries to clear'],String(BAD.length));
   assert.equal(pre['en summaries to clear'],String(enBad.length));
   assert.equal(pre['summaries to clear with key sentences'],String(enKeyBad.length));
   assert.equal(pre['posts with summary'],String(BAD.length+OK.length));
   assert.equal(pre['posts rows'],String(BAD.length+OK.length+1));assert.equal(pre['sentences rows'],'1');
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9951');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await check(precheck),pre);
   assert.equal((await row(CLEAR[BAD[0]])).s,BAD[0]);assert.equal(await history(),0);
  });

  await t.test('apply: only notice summaries are emptied, old values kept privately, postcheck passes',async()=>{
   const result=await run('apply','9952');assert.equal(result.ok,true,result.summary);
   assert.doesNotMatch(result.summary.split('사후 확인')[1]??'',/\| 아니오 \|/);
   assert.equal(await history(),1);
   for(const s of BAD){const r=await row(CLEAR[s]);assert.equal(r.s,null,s);assert.deepEqual(r.k,[],s);}
   for(const s of OK){const r=await row(KEEP[s]);assert.equal(r.s,s,s);assert.deepEqual(r.k,isEn(s)?KEY:[],s);}
   assert.equal((await row(empty)).s,null);
   assert.equal((await pool.query('select count(*)::int n from public.app_outside_sentences where post_id=$1',[sentencePost])).rows[0].n,1);
   const fixes=(await pool.query('select post_id,old_summary_ko,old_key_sentences from public.app_outside_summary_fixes')).rows;
   assert.equal(fixes.length,BAD.length);
   for(const f of fixes){const s=BAD.find(b=>CLEAR[b]===f.post_id);assert.equal(f.old_summary_ko,s);}
   const post=await check(postcheck);
   for(const k of ['clear agrees with history','fix table locked','RLS still enabled','no anon or public table privilege'])assert.equal(post[k],'예',k);
   for(const k of ['posts rows','sentences rows','other columns hash','constraints hash','policies hash','owner RLS grants hash','column grants hash','triggers hash'])assert.equal(post[k],pre[k],k);
   const again=await check(precheck);assert.equal(again['summaries to clear'],'0');assert.equal(again['posts with summary'],String(OK.length));
   assert.equal((await run('apply','9953')).ok,false);
   await assert.rejects(pool.query(migration),/OUTSIDE_SUMMARY_FAIL_CLEAR_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('fix table: owner login, anon and service_role cannot read or write it; another login never sees other workspace posts',async()=>{
   for(const role of ['authenticated','anon','service_role'])
    await assert.rejects(as(role,OWNER,c=>c.query('select count(*) from public.app_outside_summary_fixes')),/permission denied/,role);
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_outside_summary_fixes(post_id,workspace_id,old_summary_ko,old_key_sentences) values (gen_random_uuid(),$1,'x','[]')",[WS_A])),/permission denied/);
   const seen=await as('authenticated',STRANGER,c=>c.query('select count(*)::int n,count(*) filter (where workspace_id<>$1)::int other from public.app_outside_posts',[WS_B]));
   assert.equal(seen.rows[0].other,0);assert.ok(seen.rows[0].n<=1);
  });

  await t.test('rollback stops when a cleared summary was filled again, then restores the old summaries',async()=>{
   await pool.query("update public.app_outside_posts set summary_ko='합성 새 요약.' where id=$1",[CLEAR[BAD[0]]]);
   await assert.rejects(pool.query(rollbackSQL),/OUTSIDE_SUMMARY_FAIL_CLEAR_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query('update public.app_outside_posts set summary_ko=null where id=$1',[CLEAR[BAD[0]]]);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.equal((await pool.query("select to_regclass('public.app_outside_summary_fixes') is null as gone")).rows[0].gone,true);
   for(const [i,s] of BAD.entries()){const r=await row(CLEAR[s]);assert.equal(r.s,s,s);assert.deepEqual(r.k,isEn(s)&&i%2?KEY:[],s);}
   const post=await check(postcheck);assert.equal(post['clear agrees with history'],'예');assert.equal(post['fix table locked'],'예');
   assert.deepEqual(await check(precheck),pre);
  });

  await t.test('more than 150 notices: precheck out of range and apply stops without a change',async()=>{
   for(let i=0;i<150-BAD.length+1;i++)await post({summary:'본문이 제공되지 않아 요약할 수 없음. '+i});
   const v=await check(precheck);assert.equal(v['summaries to clear'],'151');
   assert.equal((await run('apply','9954')).ok,false);
   await assert.rejects(pool.query(migration),/OUTSIDE_SUMMARY_FAIL_CLEAR_TOO_MANY/);await pool.query('rollback');
   assert.equal(await history(),0);assert.equal((await row(CLEAR[BAD[0]])).s,BAD[0]);
   assert.equal((await pool.query("select to_regclass('public.app_outside_summary_fixes') is null as gone")).rows[0].gone,true);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
