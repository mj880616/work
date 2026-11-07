// Fresh local PostgreSQL only. No Supabase or production credentials. All data synthetic (no real titles).
// S52-38 NEWS-글자표기깨짐 DB(20261108010000_feed_entity_text_fix): 이미 저장된 News·사회운동 글 글자의 'quot;'·'&amp;quot;'·'#39;' 같은 표기를
// 수집기 공용 글자 풀기(_shared/html-entities.ts decodeText)와 같은 규칙으로 글자로 바꾼다.
// - 승인형 workflow 실행기(dry-run·apply)로 돌린다. 확인 SQL은 건수·예/아니오·해시만 내보낸다.
// - SQL 규칙 89단계 = TS 목록(BARE_NAMED·BARE_NUMERIC)에서 만든 순서, SQL 결과 = decodeText 결과(지어낸 글자 묶음).
// - 고친 칸 밖의 칸·행 수·사진 주소는 그대로. 옛 값은 비공개 표에만. 20000칸 넘으면 멈춤. 되돌리기는 옛 값 복원 + 표·기록 삭제.
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
const E=await import('../../supabase/functions/_shared/html-entities.ts');
const version='20261108010000',name='feed_entity_text_fix',stem=version+'_'+name;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const root=new URL('../../',import.meta.url).pathname;
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];

const prerequisites=`
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;
  grant service_role to postgres;
  create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id),
    raw_text text not null, kind text not null default 'note', metadata jsonb not null default '{}'::jsonb, deleted_at timestamptz);
  alter table public.app_notes enable row level security;
  revoke all on table public.app_notes from public, anon, authenticated, service_role;`;
const EARLIER=['20261031230000_outside_statements','20261101233000_news_clipping','20261106050000_feed_bodies'];

// SQL 규칙 순서: ① '&'를 만드는 표기(amp·#38·#038) 8번 → '&' 붙은 나머지 표기 ② '&' 빠진 숫자(#38 끝) ③ '&' 빠진 이름(amp 끝).
const lastly=(list,re)=>[...list.filter(([k])=>!re.test(k)),...list.filter(([k])=>re.test(k))];
const NAMED=lastly(E.BARE_NAMED,/^amp$/),NUM=lastly(E.BARE_NUMERIC,/^#0?38$/);
const AMPS=[...E.BARE_NAMED,...E.BARE_NUMERIC].filter(([k])=>/^(amp|#0?38)$/.test(k)),REST=[...E.BARE_NAMED,...E.BARE_NUMERIC].filter(([k])=>!/^(amp|#0?38)$/.test(k));
const WANT_RULES=[...Array.from({length:8},()=>AMPS).flat().map(([k,c])=>['&(amp;)*'+k+';',c,'gi']),...REST.map(([k,c])=>['&(amp;)*'+k+';',c,'gi']),...NUM.map(([k,c])=>['(?<!&)(amp;)*'+k+';',c,'g']),...NAMED.map(([k,c])=>['(?<![A-Za-z0-9&])(amp;)*'+k+';',c,'g'])];
const rulesOf=sql=>[...sql.slice(sql.indexOf('r(ord, pat, ch, flags) as (values'),sql.indexOf('\n),\n',sql.indexOf('r(ord, pat, ch, flags) as (values'))).matchAll(/\((\d+), '((?:[^']|'')*)', '((?:[^']|'')*)', '(gi?)'\)/g)]
  .map(m=>[Number(m[1]),m[2].replace(/''/g,"'"),m[3].replace(/''/g,"'"),m[4]]);

// 지어낸 칸 값(표기 섞음). 기대값은 decodeText(바뀌지 않는 값도 섞음).
const NEWS=[
 {title:'가짜 의원 quot;성과middot;노고quot; hellip;',publisher:'가짜&amp;매체',summary:'요약 lsquo;하나rsquo;',body:'본문 &amp;quot;둘&amp;quot; 끝',body_kind:'full'},
 {title:'It#39;s a fake &amp;amp;quot;three&amp;amp;quot;',lang:'en',body:'Fake body #39;x',body_kind:'lead',title_ko:'가짜 quot;번역quot;',body_ko:'번역 본문 middot; 끝'},
 {title:'Volt; camp; 그대로 R&D'},
 {title:'[속보] 가짜, lsquo;합당론rsquo;에 quot;반찬종지quot; ldquo;끝rdquo;',ws:WS_B},
];
const OUT=[
 {source_key:'kctu',kind:'statement',lang:'ko',title:'[성명] 가짜 quot;제목quot;',summary_ko:'요약 &amp;amp;quot;셋&amp;amp;quot;'},
 {source_key:'jacobin',kind:'article',lang:'en',title:'A fake rsquo; title',title_ko:'가짜 lsquo;제목rsquo;',key_sentences:[{orig:'Fake quot;orig#39;s',ko:'가짜 quot;한국어quot;'},{orig:'plain',ko:'그대로'}]},
 {source_key:'justice',kind:'comment',lang:'ko',title:'가짜 텔레그램 소식 middot; 끝hellip;'},
 {source_key:'kptu',kind:'statement',lang:'ko',title:'가짜 그대로 제목'},
];

test('feed entity text fix: same rule as decodeText, private backup, too-many stop, rollback',{timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'feed-entity-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 try{
  await cluster.initialise();await cluster.start();pool=trackPool(new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false}));
  await pool.query(fixture);await pool.query(prerequisites);
  for(const f of EARLIER)await pool.query(await read('supabase/migrations/'+f+'.sql'));
  const migration=await read('supabase/migrations/'+stem+'.sql');
  const [precheck,postcheck,snapshot,rollbackSQL]=await Promise.all(['precheck','postcheck','snapshot','rollback'].map(k=>read('docs/'+stem+'.'+k+'.sql')));
  const readOnly=async sql=>{const c=await pool.connect();try{await c.query('begin read only');await c.query('set local role supabase_read_only_user');const r=await c.query(sql);await c.query('commit');return r.rows;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
  const query=async(sql,options={})=>{if(options.readOnly)return readOnly(sql);const c=await pool.connect();try{const r=await c.query(sql);return Array.isArray(r)?[]:r.rows;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}};
  const run=(mode,id)=>runMigrationPlan(prepareMigration({mode,version,runId:id,root}),query,{saveSnapshot:async()=>{}});
  const check=async sql=>Object.fromEntries((await readOnly(sql)).map(r=>[r.item,r.value]));
  const history=async()=>(await pool.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1 and name=$2',[version,name])).rows[0].n;
  async function as(role,sub,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[sub||'']);await c.query('set local role '+role);const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}

  let n=0;const news=[],outs=[];
  for(const x of NEWS){const o={lang:'ko',ws:WS_A,...x};news.push((await pool.query(`insert into public.app_news_items(workspace_id,lane,url,url_key,title,title_key,lang,publisher,state,summary,body,body_kind,title_ko,body_ko,translated_at)
    values ($1,'media',$2,$3,$4,'k'||$5::text,$6,$7,'ok',$8,$9,$10,$11,$12,case when $11::text is null and $12::text is null then null else now() end) returning id`,
    [o.ws,'https://example.org/n/'+(++n),'example.org/n/'+n,o.title,n,o.lang,o.publisher??null,o.summary??null,o.body??null,o.body_kind??null,o.title_ko??null,o.body_ko??null])).rows[0].id);}
  for(const x of OUT)outs.push((await pool.query(`insert into public.app_outside_posts(workspace_id,source_key,kind,lang,title,title_ko,url,summary_ko,key_sentences,has_body)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) returning id`,[WS_A,x.source_key,x.kind,x.lang,x.title,x.title_ko??null,'https://example.org/o/'+(++n),x.summary_ko??null,JSON.stringify(x.key_sentences??[]),x.lang==='ko'])).rows[0].id);
  await pool.query("insert into public.app_outside_sentences(post_id,workspace_id,lang,idx,text) values ($1,$2,'ko',0,'문장 quot;하나quot;.'),($1,$2,'ko',1,'그대로 문장.')",[outs[0],WS_A]);
  const BLOCKS=[{t:'p',text:'블록 quot;하나quot; &amp;middot; 끝'},{t:'img',src:'https://example.org/a.jpg?x=1&amp;y=2',cap:'캡션 middot;',alt:'대체 lsquo;rsquo;'},{t:'h',text:'그대로'}];
  await pool.query(`insert into public.app_feed_bodies(workspace_id,news_item_id,blocks,state,reason,rule,chars,images) values ($1,$2,$3::jsonb,'ok',null,'kctu@1',20,1),($1,$4,'[{"t":"p","text":"그대로 블록"}]','ok',null,'kctu@1',6,0)`,
   [WS_A,news[0],JSON.stringify(BLOCKS),news[2]]);

  const newsRow=async id=>(await pool.query('select title,title_ko,summary,body,body_ko,publisher,title_key from public.app_news_items where id=$1',[id])).rows[0];
  const outRow=async id=>(await pool.query('select title,title_ko,summary_ko,key_sentences from public.app_outside_posts where id=$1',[id])).rows[0];
  const D=v=>v==null?null:E.decodeText(v);
  const before=(await pool.query(snapshot)).rows;let pre;

  await t.test('files: SQL rules = TS lists, SQL result = decodeText, read-only checks, three-line summary, expanded workflow accepts the file',async()=>{
   const rules=rulesOf(migration);
   assert.deepEqual(rules.map(r=>r[0]),rules.map((_,i)=>i+1),'1부터 차례로');
   assert.deepEqual(rules.map(r=>r.slice(1)),WANT_RULES,'SQL 규칙 = TS 목록');
   assert.deepEqual(rulesOf(postcheck).map(r=>r.slice(1)),WANT_RULES,'사후 확인도 같은 규칙');
   // SQL로 지어낸 글자 묶음을 풀어 decodeText와 대조한다.
   const toks=['quot;','&quot;','&amp;quot;','&amp;amp;quot;','amp;quot;','middot;','hellip;','lsquo;','rsquo;','ldquo;','rdquo;','amp;','&amp;','lt;','gt;','&lt;','nbsp;','#39;','&#39;','&amp;#39;','#x27;','#039;','#34;','#38;','&#38;','#8216;','#8230;','#183;','bull;','ndash;','Volt;','camp;','가','a','9',' ','&','"',';','#','QUOT;','&QUOT;','&#X27;','raquo;'];
   let seed=11;const rnd=k=>{seed=(seed*1103515245+12345)%2147483648;return seed%k;};
   const cases=[];for(let i=0;i<600;i++){let s='';for(let j=0,m=1+rnd(7);j<m;j++)s+=toks[rnd(toks.length)];cases.push(s);}
   const rulesCte=migration.slice(migration.indexOf('with recursive r(ord, pat, ch, flags) as (values'),migration.indexOf('\n),\n',migration.indexOf('with recursive r('))+3);
   const got=(await pool.query(`${rulesCte}
     s(i, v) as (select i::int, v from unnest($1::text[]) with ordinality u(v, i)),
     fx(i, step, f) as (select i, 0, v from s union all select fx.i, fx.step + 1, regexp_replace(fx.f, r.pat, r.ch, r.flags) from fx join r on r.ord = fx.step + 1)
     select i, f from fx where step = (select max(ord) from r) order by i`,[cases])).rows;
   assert.equal(got.length,cases.length);
   for(const r of got)assert.equal(r.f,E.decodeText(cases[r.i-1]),cases[r.i-1]);
   for(const sql of [precheck,postcheck,snapshot])assert.equal(checkSQL(sql).baselineNull,false);
   for(const mode of ['apply','dry-run']){const p=prepareMigration({mode,version,runId:'1',root});assert.equal(p.rules,'expanded');assert.equal(p.flow,'full');
    assert.deepEqual(p.targets,['app_feed_bodies','app_news_items','app_outside_posts','app_outside_sentences']);assert.deepEqual(p.review.definer,[]);}
   const summary=(await read('docs/'+stem+'.summary.md')).trim().split('\n');
   assert.deepEqual(summary.map(l=>l.split(':')[0]),['무엇이 바뀌나','잘못되면','되돌리는 법']);
   const code=migration.replace(/--.*$/gm,'');
   assert.doesNotMatch(code,/security definer|disable row level|\bgrant\b|\bto (anon|public|authenticated|service_role)\b|create policy|create (or replace )?function|information_schema|rtw_|\bdelete\s+from\b|\btruncate\s+(table\s+)?public\b|title_key\s*=|\bchars\s*=/i);
   for(const sql of [precheck,postcheck])for(const r of await readOnly(sql))assert.match(r.value,/^(예|아니오|[0-9]+|[0-9a-f]{32})$/,r.item);
  });

  await t.test('precheck: records counts',async()=>{
   pre=await check(precheck);
   for(const k of ['prerequisite recorded','new migration absent','fix table absent','RLS enabled'])assert.equal(pre[k],'예',k);
   assert.equal(pre['anon or public table privilege'],'아니오');
   assert.ok(Number(pre['values with entity words'])>=12,pre['values with entity words']);
   assert.equal(pre['news rows'],String(NEWS.length));assert.equal(pre['outside rows'],String(OUT.length));assert.equal(pre['sentences rows'],'2');assert.equal(pre['bodies rows'],'2');
  });

  await t.test('dry-run leaves schema, rows and history unchanged',async()=>{
   const dry=await run('dry-run','9971');assert.equal(dry.ok,true,dry.summary);
   assert.deepEqual((await pool.query(snapshot)).rows,before);assert.deepEqual(await check(precheck),pre);
   assert.equal((await newsRow(news[0])).title,NEWS[0].title);assert.equal(await history(),0);
  });

  await t.test('apply: every listed column equals decodeText, other columns and image addresses unchanged, postcheck passes',async()=>{
   const keys=[];for(const id of news)keys.push((await newsRow(id)).title_key);
   const result=await run('apply','9972');assert.equal(result.ok,true,result.summary);
   assert.doesNotMatch(result.summary.split('사후 확인')[1]??'',/\| 아니오 \|/);
   assert.equal(await history(),1);
   for(const [i,x] of NEWS.entries()){const r=await newsRow(news[i]);
    for(const k of ['title','title_ko','summary','body','body_ko','publisher'])assert.equal(r[k],D(x[k]??null),`news ${i} ${k}`);
    assert.equal(r.title_key,keys[i],'title_key 그대로');}
   assert.equal((await newsRow(news[0])).title,'가짜 의원 "성과·노고" …');
   assert.equal((await newsRow(news[2])).title,NEWS[2].title,'낱말 끝·R&D 그대로');
   for(const [i,x] of OUT.entries()){const r=await outRow(outs[i]);
    for(const k of ['title','title_ko','summary_ko'])assert.equal(r[k],D(x[k]??null),`outside ${i} ${k}`);
    assert.deepEqual(r.key_sentences,(x.key_sentences??[]).map(s=>({orig:D(s.orig),ko:D(s.ko)})),`outside ${i} key_sentences`);}
   const sent=(await pool.query('select text from public.app_outside_sentences order by idx')).rows.map(r=>r.text);
   assert.deepEqual(sent,['문장 "하나".','그대로 문장.']);
   const blocks=(await pool.query('select blocks from public.app_feed_bodies where news_item_id=$1',[news[0]])).rows[0].blocks;
   assert.deepEqual(blocks,[{t:'p',text:'블록 "하나" · 끝'},{t:'img',src:BLOCKS[1].src,cap:'캡션 ·',alt:'대체 ‘’'},{t:'h',text:'그대로'}],'사진 주소(src)는 그대로');
   const fixes=(await pool.query('select tbl,col from public.app_feed_entity_fixes')).rows;
   assert.ok(fixes.length>=14,String(fixes.length));
   const post=await check(postcheck);
   for(const k of ['fix agrees with history','fix table locked','RLS still enabled','no anon or public table privilege'])assert.equal(post[k],'예',k);
   for(const k of Object.keys(pre).filter(k=>/rows$|hash$/.test(k)))assert.equal(post[k],pre[k],k);
   assert.equal((await run('apply','9973')).ok,false);
   await assert.rejects(pool.query(migration),/FEED_ENTITY_FIX_PREREQUISITE_CHANGED/);await pool.query('rollback');
  });

  await t.test('fix table: owner login, anon and service_role cannot read or write it; another login never sees other workspace rows',async()=>{
   for(const role of ['authenticated','anon','service_role'])
    await assert.rejects(as(role,OWNER,c=>c.query('select count(*) from public.app_feed_entity_fixes')),/permission denied/,role);
   await assert.rejects(as('authenticated',OWNER,c=>c.query("insert into public.app_feed_entity_fixes(tbl,row_key,col,workspace_id,old_value,new_value) values ('news','x','title',$1,'x','y')",[WS_A])),/permission denied/);
   const seen=await as('authenticated',STRANGER,c=>c.query('select count(*) filter (where workspace_id<>$1)::int other from public.app_news_items',[WS_B]));
   assert.equal(seen.rows[0].other,0);
  });

  await t.test('rollback stops when a fixed value changed again, then restores the old values',async()=>{
   await pool.query("update public.app_news_items set title='합성 다시 고친 제목' where id=$1",[news[0]]);
   await assert.rejects(pool.query(rollbackSQL),/FEED_ENTITY_FIX_ROLLBACK_BLOCKED/);await pool.query('rollback');
   await pool.query('update public.app_news_items set title=$2 where id=$1',[news[0],D(NEWS[0].title)]);
   await pool.query(rollbackSQL);
   assert.equal(await history(),0);
   assert.equal((await pool.query("select to_regclass('public.app_feed_entity_fixes') is null as gone")).rows[0].gone,true);
   for(const [i,x] of NEWS.entries()){const r=await newsRow(news[i]);for(const k of ['title','title_ko','summary','body','body_ko','publisher'])assert.equal(r[k],x[k]??null,`news ${i} ${k}`);}
   for(const [i,x] of OUT.entries()){const r=await outRow(outs[i]);assert.equal(r.title,x.title);assert.deepEqual(r.key_sentences,x.key_sentences??[]);}
   assert.deepEqual((await pool.query('select blocks from public.app_feed_bodies where news_item_id=$1',[news[0]])).rows[0].blocks,BLOCKS);
   const post=await check(postcheck);assert.equal(post['fix agrees with history'],'예');assert.equal(post['fix table locked'],'예');
   assert.deepEqual(await check(precheck),pre);
  });

  await t.test('more than 20000 values to fix: apply stops without a change',async()=>{
   await pool.query(`insert into public.app_news_items(workspace_id,lane,url,url_key,title,state)
     select $1,'media','https://example.org/many/'||g,'example.org/many/'||g,'합성 quot;제목quot; '||g,'ok' from generate_series(1,20001) g`,[WS_A]);
   assert.equal((await run('apply','9974')).ok,false);
   await assert.rejects(pool.query(migration),/FEED_ENTITY_FIX_TOO_MANY/);await pool.query('rollback');
   assert.equal(await history(),0);assert.equal((await newsRow(news[0])).title,NEWS[0].title);
   assert.equal((await pool.query("select to_regclass('public.app_feed_entity_fixes') is null as gone")).rows[0].gone,true);
  });
 }finally{await closePool(pool);await cluster.stop().catch(()=>{});}
});
