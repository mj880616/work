// Fresh local PostgreSQL only (embedded, isolated). Fake rtw_* rows only. No Supabase, Google or production credentials.
// RTW-노트일원화 ④: dry-run -> apply -> re-run (0 added) -> check -> guarded revert for docs/design/sql/rtw-note-copy-*.sql.
// The Supabase SQL Editor keeps neither temp tables nor an open transaction between statements (checked by hand), so each draft must be ONE statement.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {fixture,OWNER,STRANGER,WS_A} from './basket4-fixture.mjs';
import {ME,FRIEND,ID,rtwSchema,rtwData,EXPECTED} from './rtw-note-copy-fixture.mjs';
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const FILES={dry:'docs/design/sql/rtw-note-copy-1-dry-run.sql',apply:'docs/design/sql/rtw-note-copy-2-apply.sql',check:'docs/design/sql/rtw-note-copy-3-check.sql',revert:'docs/design/sql/rtw-note-copy-4-revert.sql'};
for(const key of Object.keys(process.env))if(key.startsWith('PG'))delete process.env[key];
const strip=sql=>sql.split('\n').filter(l=>!/^\s*--/.test(l)).join('\n');
const bodyOf=sql=>sql.slice(sql.indexOf('-- ==== 본문 시작'),sql.indexOf('-- ==== 본문 끝 ====')+'-- ==== 본문 끝 ===='.length);

// Splits a script into top-level statements the way a plain parser would: skips -- comments, '...' / E'...' strings, "..." identifiers and $tag$...$tag$ bodies.
const statements=sql=>{
 const out=[];let cur='',i=0;const n=sql.length;
 while(i<n){
  const ch=sql[i],two=sql.slice(i,i+2);
  if(two==='--'){const e=sql.indexOf('\n',i);i=e<0?n:e;continue;}
  if(ch==="'"){const esc=/[eE]$/.test(cur)&&!/\w[eE]$/.test(cur);let j=i+1;for(;j<n;j++){if(esc&&sql[j]==='\\'){j++;continue;}if(sql[j]==="'"){if(sql[j+1]==="'"){j++;continue;}break;}}cur+=sql.slice(i,j+1);i=j+1;continue;}
  if(ch==='"'){const j=sql.indexOf('"',i+1);cur+=sql.slice(i,j+1);i=j+1;continue;}
  if(ch==='$'){const m=/^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i,i+40));if(m){const e=sql.indexOf(m[0],i+m[0].length);assert.ok(e>0,'unterminated dollar quote');cur+=sql.slice(i,e+m[0].length);i=e+m[0].length;continue;}}
  if(ch===';'){if(cur.trim())out.push(cur.trim());cur='';i++;continue;}
  cur+=ch;i++;
 }
 if(cur.trim())out.push(cur.trim());return out;
};

test('static: each draft is exactly one statement, so nothing depends on state kept between statements',async()=>{
 const sql={};for(const [k,p] of Object.entries(FILES))sql[k]=await read(p);
 for(const k of ['dry','apply','revert']){
  const st=statements(sql[k]);assert.equal(st.length,1,k+' is one statement');assert.match(st[0],/^do\s+\$\$/i,k+' is a single DO block');
  assert.equal((sql[k].match(/\$\$/g)||[]).length,2,k+' has exactly one dollar-quoted body');
 }
 const chk=statements(sql.check);assert.equal(chk.length,1);assert.match(chk[0],/^with\b/i);
 // The splitter itself must not hide extra statements: a second statement after the DO block is counted.
 assert.equal(statements(sql.apply.trimEnd()+'\nselect 1;').length,2);
 assert.equal(statements("do $$ begin perform 1; end $$; -- x; y\nselect 'a;b';").length,2);
 for(const [k,v] of Object.entries(sql))assert.doesNotMatch(v,/\b(begin|commit|rollback|savepoint|start\s+transaction|end\s+transaction)\s*;|\bset\s+(local\s+)?(lock_timeout|statement_timeout)\b/i,k+' has no transaction statements or session settings');
 // Temp tables are created and used only inside the DO body (same statement).
 for(const k of ['dry','apply']){assert.ok(/create\s+temp\s+table\s+rtw_ctx\b/i.test(sql[k]));assert.match(sql[k],/on commit drop/i);}
 assert.ok(!/create\s+temp/i.test(sql.check)&&!/create\s+temp/i.test(sql.revert));
 // Dry-run always ends in the report error (the error is the cancel); apply has no report and ends normally.
 assert.match(sql.dry,/raise exception E'RTW_COPY_DRYRUN_REPORT[\s\S]*\nend\n\$\$;\s*$/);assert.ok(!/show_as_error/.test(sql.dry));
 assert.ok(!/RTW_COPY_DRYRUN_REPORT|rtw_report/.test(sql.apply));assert.match(sql.apply.trimEnd(),/\nend\n\$\$;$/);
});

test('static: four SQL drafts keep to select/insert/delete on the allowed tables only',async()=>{
 assert.equal(ME,OWNER,'fake rtw owner is the Web2 owner of the shared fixture');
 const sql={};for(const [k,p] of Object.entries(FILES)){assert.ok(!p.includes('supabase/migrations'));sql[k]=await read(p);}
 // dry-run and apply share a byte-identical body; only head/tail differ.
 assert.ok(bodyOf(sql.dry).length>5000);assert.equal(bodyOf(sql.dry),bodyOf(sql.apply));
 const code=Object.fromEntries(Object.entries(sql).map(([k,v])=>[k,strip(v).trim()]));
 // dry-run ends only with its report error; the three writing/reading drafts hold no transaction statements (see the one-statement test).
 assert.ok(!/\bdelete\s+from/i.test(code.dry));
 for(const [k,v] of Object.entries(code)){
  assert.doesNotMatch(v,/\b(grant|revoke)\b|security\s+definer|create\s+(or\s+replace\s+)?(function|policy|trigger|view|table\s+(?!pg_temp))|create\s+(?!temp\b|temporary\b)\w+|alter\s+(table|policy|function|role|default)|drop\s+(table|function|policy|trigger|index|column|schema)|truncate|enable\s+row|disable\s+row|force\s+row/i,k);
  assert.doesNotMatch(v,/(insert\s+into|update|delete\s+from|truncate(\s+table)?|merge\s+into)\s+(only\s+)?(public\.)?rtw_(resources|notes|bookmarks|questions|topics|relations|records|writing_context|note_types|personal_mode|beta_access|feedback|ai_usage)\b/i,k+' must not write rtw_*');
  assert.doesNotMatch(v,/schema_migrations/i,k+' leaves the migration history alone (D12)');
  assert.doesNotMatch(sql[k],/[\w.+-]+@[\w-]+\.[a-z]{2,}|eyJ[\w-]{20,}|sk-[\w-]{20,}|service_role/i,k+' has no email/key/secret');
 }
 for(const k of ['dry','apply'])assert.ok(!/delete\s+from/i.test(code[k]));
 assert.ok(!/insert\s+into/i.test(code.revert)&&!/insert\s+into/i.test(code.check));
 assert.ok(/^\s*with\b[\s\S]*;\s*$/.test(code.check),'check is a single select statement');
 assert.equal((code.check.match(/;/g)||[]).length,1);
 assert.match(sql.dry+sql.apply,/RTW_COPY_STOP-01[\s\S]*RTW_COPY_STOP-24/,'STOP codes kept');
});

test('rtw note copy: dry-run, apply, re-run, check and guarded revert on fake rows',{timeout:120000},async t=>{
 const sql={};for(const [k,p] of Object.entries(FILES))sql[k]=await read(p);
 const directory=await mkdtemp(join(tmpdir(),'rtw-copy-pg-')),sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const password=randomBytes(24).toString('hex'),cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
 let pool;
 // pool.end() resolves before the sockets are really closed. Wait for every client's 'end' so cluster.stop() cannot cut a still-open connection
 // (that raced as an uncaught 'terminating connection due to administrator command'); same pattern as basket1.test.mjs.
 const clientEnds=[];
 try{
  await cluster.initialise();await cluster.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});pool.on('connect',client=>clientEnds.push(new Promise(done=>client.once('end',done))));
  await pool.query(fixture);
  for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(`create table public.app_documents(id uuid primary key,workspace_id uuid);alter table public.app_spaces add column owner_id uuid default '${OWNER}',add column name text,add column parent_id uuid,add column status text default 'active',add column metadata jsonb default '{"project_system":"v2"}';grant select,update on public.app_spaces to authenticated;alter table public.app_spaces enable row level security;create policy synthetic_spaces_owner on public.app_spaces for all to authenticated using(private.app_is_workspace_owner(workspace_id)) with check(private.app_is_workspace_owner(workspace_id));`);
  for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql','20261013034836_basket_photo_ocr_db.sql','20261017052234_journal_memo_notes_kind.sql'])await pool.query(await read('supabase/migrations/'+file));
  await pool.query(`update public.app_workspaces set slug='kptu-work' where id='${WS_A}'`);
  await pool.query(rtwSchema);await pool.query(rtwData);
  // The runner is a role that can only SELECT the rtw_* tables (like a read-only reader) but can write app_notes: proves the drafts never write rtw_*.
  await pool.query(`create role copier nologin bypassrls;grant select on all tables in schema public to copier;grant insert,update,delete on public.app_notes to copier;grant usage on schema public to copier;revoke select on public.rtw_note_types from copier`);
  // Existing Web2 rows that must never change.
  const basket=(await pool.query("insert into public.app_notes(workspace_id,raw_text) values($1,'바구니 원문') returning id",[WS_A])).rows[0].id;
  await pool.query("insert into public.app_notes(workspace_id,kind,title,raw_text) values($1,'note','직접 쓴 노트','직접 쓴 본문')",[WS_A]);
  await pool.query("insert into public.app_notes(workspace_id,kind,raw_text,journal_day,ai_export_allowed) values($1,'diary','일기 한 줄','2026-10-01',false),($1,'work','업무일지 한 줄','2026-10-01',true)",[WS_A]);
  const snapshot=async()=>({
   rtw:(await pool.query(`select md5(string_agg(t,'|' order by t)) h from (${['rtw_resources','rtw_notes','rtw_bookmarks','rtw_questions','rtw_topics','rtw_relations','rtw_records','rtw_writing_context','rtw_note_types','rtw_personal_mode'].map(n=>`select '${n}:'||x::text t from public.${n} x`).join(' union all ')}) s`)).rows[0].h,
   access:(await pool.query(`select md5(string_agg(x,'|' order by x)) h from (select 'p:'||polrelid::regclass||polname||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') x from pg_policy union all select 'c:'||oid::regclass||coalesce(relacl::text,'')||relrowsecurity::text from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace) and relkind='r' union all select 'f:'||p.oid::regprocedure||coalesce(proacl::text,'')||prosecdef::text from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace) union all select 'n:'||nspname from pg_namespace where nspname !~ '^pg_(toast_)?temp_') s`)).rows[0].h,
   others:(await pool.query("select md5(string_agg(n::text,'|' order by id::text)) h from public.app_notes n where not (metadata ? 'rtw')")).rows[0].h,
  });
  const before=await snapshot();
  // Run a draft in one session; any error rolls the (possibly aborted) transaction back like the SQL Editor would.
  const run=async(text,role='copier')=>{const c=await pool.connect();try{await c.query('set role '+role);const r=await c.query(text);return Array.isArray(r)?r:[r];}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{await c.query('reset role').catch(()=>{});c.release();}};
  const migrated=async()=>(await pool.query("select count(*)::int n from public.app_notes where metadata ? 'rtw'")).rows[0].n;
  const rows=async(text)=>{const r=await run(text);return r.at(-1).rows;};
  // The dry-run always ends with an error whose text is the report table (the error is the cancel). Parse it back into rows.
  const report=async()=>{
   let msg;try{await run(sql.dry);}catch(e){msg=e.message;}
   assert.ok(msg&&msg.startsWith('RTW_COPY_DRYRUN_REPORT (전부 취소됨, 아무것도 안 바뀜)'),'dry-run ends with the report error: '+msg);
   const lines=msg.split('\n').slice(1);assert.equal(lines[0],'구분 | 항목 | 값 | 기대·원본 | 판정');
   return Object.fromEntries(lines.slice(1).map(l=>{const m=/^(.*?) \| (.*?) \| 값 (.*?) \| 기대 (.*?) \| (.*)$/.exec(l);assert.ok(m,'report line: '+l);return [m[2],{'구분':m[1],'항목':m[2],'값':m[3],'기대·원본':m[4],'판정':m[5]}];}));
  };
  const notes=async()=>Object.fromEntries((await pool.query("select metadata->'rtw'->>'table' tbl,metadata->'rtw'->>'id' sid,n.* from public.app_notes n where metadata ? 'rtw'")).rows.map(r=>[r.sid,r]));

  await t.test('dry-run: real insert is computed, report shows counts, nothing remains',async()=>{
   const rep=await report();
   assert.equal(await migrated(),0);assert.deepEqual(await snapshot(),before);
   assert.equal(rep['만들어질 노트 합계']['값'],String(EXPECTED.total));
   assert.deepEqual(Object.values(rep).filter(x=>x['판정']==='확인 필요').map(x=>x['항목']),['200자 넘어 잘린 제목'],'only the intentionally cut 250-char title needs a look');
   assert.equal(rep['200자 넘어 잘린 제목']['값'],'1');assert.equal(rep['가장 긴 제목(자)']['값'],'200');
   assert.equal(rep['읽기 글']['값'],String(EXPECTED.resources));assert.equal(rep['독립 메모']['값'],String(EXPECTED.memos));
   assert.equal(rep['질문']['값'],'2');assert.equal(rep['글쓰기 기록']['값'],'2');assert.equal(rep['훈련 기준']['값'],'1');
   assert.equal(rep['글에 붙은 메모(나의 메모 칸)']['값'],'2');assert.equal(rep['책갈피(문장 + 글 전체)']['값'],'4');assert.equal(rep['연결(주제·질문 줄)']['값'],'6');
   assert.equal(rep['인용(>)으로 시작해 제목이 인용문인 독립 메모']['값'],'1');
   assert.equal(rep['작업공간(workspace_id) 종류 수']['값'],'1');assert.equal(rep['같은 원본이 두 번 들어간 수']['값'],'0');
   assert.equal(rep['10만 자 넘는 본문']['값'],'0');assert.equal(rep['기존 노트(바구니 등) 수 변화']['값'],'0');
   assert.equal(['1~20자','21~50자','51~100자','101~200자'].reduce((s,k)=>s+Number(rep[k]['값']),0),EXPECTED.total);
  });
  await t.test('dry-run is one statement that always ends in the report error and leaves no rows or temp tables behind',async()=>{
   const c=await pool.connect();
   try{
    await c.query('set role copier');
    await assert.rejects(c.query(sql.dry),e=>e.message.includes('RTW_COPY_DRYRUN_REPORT')&&e.message.includes('만들어질 노트 합계 | 값 '+EXPECTED.total));
    // Same session, right after the error: no copied notes, no leftover temp tables (the statement is the unit of atomicity).
    assert.equal((await c.query("select count(*)::int n from public.app_notes where metadata ? 'rtw'")).rows[0].n,0);
    assert.equal((await c.query("select count(*)::int n from pg_class where relpersistence='t' and relname like 'rtw\\_%'")).rows[0].n,0);
    // Not inside an open transaction either: nothing was left half-done for the next statement.
    assert.equal((await c.query('select txid_current_if_assigned() is null as clean')).rows[0].clean,true);
   }finally{await c.query('reset role').catch(()=>{});c.release();}
   assert.equal(await migrated(),0);assert.deepEqual(await snapshot(),before);
  });
  await t.test('stops before changing anything when a precondition differs',async()=>{
   const cases=[
    ['STOP-03',`update public.app_workspace_members set role='member' where user_id='${OWNER}';insert into public.app_workspace_members values('${WS_A}','${FRIEND}','owner')`,`delete from public.app_workspace_members where user_id='${FRIEND}';update public.app_workspace_members set role='owner' where user_id='${OWNER}'`],
    ['STOP-02',`update public.app_workspaces set slug='other' where id='${WS_A}'`,`update public.app_workspaces set slug='kptu-work' where id='${WS_A}'`],
    ['STOP-01',`delete from public.rtw_personal_mode`,`insert into public.rtw_personal_mode(id,owner_id,claimed_at) values('owner','${ME}','2026-09-01 00:00+09')`],
    ['STOP-05',`alter table public.app_notes disable row level security`,`alter table public.app_notes enable row level security`],
    ['STOP-06',`alter table public.rtw_notes rename column note_type to kind_of_note`,`alter table public.rtw_notes rename column kind_of_note to note_type`],
    ['STOP-11',`alter table public.rtw_notes drop constraint rtw_notes_resource_id_fkey;update public.rtw_notes set resource_id='30000000-0000-4000-8000-0000000000aa' where id='${ID.NB}'`,`update public.rtw_notes set resource_id='${ID.R3}' where id='${ID.NB}';alter table public.rtw_notes add foreign key(resource_id) references public.rtw_resources(id)`],
    ['STOP-12',`insert into public.rtw_bookmarks(id,owner_id,resource_id,bookmark_type,created_at,updated_at) values(gen_random_uuid(),'${ME}','${ID.R2}','mystery',now(),now())`,`delete from public.rtw_bookmarks where bookmark_type='mystery'`],
    ['STOP-13',`update public.rtw_resources set body_md=repeat('가',100001) where id='${ID.R2}'`,`update public.rtw_resources set body_md=null where id='${ID.R2}'`],
   ];
   for(const [code,breakIt,fixIt] of cases){
    await pool.query(breakIt);
    try{
     for(const k of ['dry','apply'])await assert.rejects(run(sql[k]),e=>e.message.includes('RTW_COPY_'+code),code+' '+k);
     assert.equal(await migrated(),0,code);
    }finally{await pool.query(fixIt);}
   }
   assert.deepEqual(await snapshot(),before);
  });
  await t.test('apply: notes appear with original dates, markers and the approved shapes',async()=>{
   await run(sql.apply);
   assert.equal(await migrated(),EXPECTED.total);
   const n=await notes(),all=Object.values(n);
   assert.equal(all.length,EXPECTED.total);
   assert.ok(all.every(r=>r.kind==='note'&&r.workspace_id===WS_A&&r.attachments.length===0&&r.archived_at===null&&r.ai_export_allowed===true));
   assert.ok(all.every(r=>r.title.length>=1&&r.title.length<=200&&!/[\r\n]/.test(r.title)&&r.raw_text.length<=100000));
   // friends' rows are never copied
   for(const f of [ID.RF,ID.NF,FRIEND])assert.ok(!n[f]);
   assert.ok(all.every(r=>!/지인/.test(r.title+r.raw_text)));
   // dates: created/updated kept, occurred_at = created_at
   const r1=n[ID.R1];assert.equal(r1.created_at.toISOString(),'2026-09-01T00:00:00.000Z');assert.equal(r1.updated_at.toISOString(),'2026-09-05T03:00:00.000Z');assert.equal(r1.occurred_at.toISOString(),r1.created_at.toISOString());
   assert.equal(r1.metadata.rtw.table,'rtw_resources');assert.equal(r1.metadata.rtw.id,ID.R1);assert.match(r1.metadata.rtw.migrated_at,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);assert.equal(new Date(r1.metadata.rtw.src_updated_at).toISOString(),r1.updated_at.toISOString());
   assert.deepEqual(Object.keys(r1.metadata),['rtw']);
   assert.equal(n[ID.N1].updated_at.toISOString(),'2026-09-11T00:00:00.000Z');
   // article note: header block, body as is, memos, bookmarks, footer line
   assert.equal(r1.title,'시험 글 하나');
   assert.equal(r1.raw_text,[
    '> 원문: [원문 \\[제목\\] 하나](https://example.test/a%281%29%20b) · 저자 갑 · 출처 을 · 발표 2026-09-18 · 책갈피 표시','',
    '본문 첫 줄','','본문 둘째 줄','',
    '## 나의 메모','','- [생각] 2026-09-06','','  첫 메모 첫 줄','  ## 메모 안 제목','','  마지막 줄','',
    '## 책갈피','','> 앞쪽 문장','','> 뒤쪽 문장','> 두 줄','','메모: 뒤쪽 메모','','글 전체 책갈피 메모: 글 전체 메모','',
    '주제: 주제 둘, 주제 하나 · 질문: 열린 질문입니다 둘째 줄'].join('\n'));
   const by=id=>n[id];
   assert.equal(by(ID.R2).title.length,200);assert.equal(by(ID.R2).raw_text,'');assert.match(by(ID.R2).title,/^둘째 가+$/);
   assert.equal(by(ID.R3).raw_text,['> 원문: ftp://example.test/x · 저자 병 · 책갈피 표시','','셋째 본문','','## 나의 메모','','- 2026-09-07','','  둘째 메모','','질문: 닫힌 질문'].join('\n'));
   assert.equal(by(ID.R4).title,'원문 제목 넷');assert.equal(by(ID.R4).raw_text,['> 원문: 원문 제목 넷','','넷째 본문'].join('\n'));
   // standalone memos: Web2 noteTitleFromText rule (first non-empty line, heading mark stripped, 200 chars) and a closing line
   assert.equal(by(ID.N1).title,'제목 줄이 먼저');assert.equal(by(ID.N1).raw_text,['# 제목 줄이 먼저','','독립 메모 본문','','유형: 생각 · 주제: 주제 둘'].join('\n'));
   assert.equal(by(ID.N2).title,'> 인용으로 시작');assert.equal(by(ID.N2).raw_text,['> 인용으로 시작','','내 생각','','유형: 질문'].join('\n'));
   assert.equal(by(ID.N3).title,'공백 있는 첫 줄');assert.equal(by(ID.N4).title,'(제목 없는 메모)');assert.equal(by(ID.N4).raw_text,'');
   assert.equal(by(ID.Q1).title,'열린 질문입니다 둘째 줄');assert.equal(by(ID.Q1).raw_text,['열린 질문입니다','둘째 줄','','## 현재 생각','','지금 생각은 이렇다','','상태: 열림'].join('\n'));
   assert.equal(by(ID.Q2).raw_text,['닫힌 질문','','상태: 닫힘'].join('\n'));
   assert.equal(by(ID.REC1).title,'기록 하나');assert.equal(by(ID.REC1).raw_text,['## A 처음 쓴 글','','처음 쓴 글','','## B 피드백','','피드백 글','','## C 고친 글','','고친 글','','## 배운 것','','배운 것 글','','종류: 연습 · 태그: 태그가, 태그나 · 원본 글: 시험 글 하나'].join('\n'));
   assert.equal(by(ID.REC2).title,'(제목 없는 글쓰기 기록)');assert.equal(by(ID.REC2).raw_text,['## A 처음 쓴 글','','처음만 있음','','종류: 연습'].join('\n'));
   assert.equal(by(ME).title,'글쓰기 훈련 기준');assert.equal(by(ME).raw_text,'# 훈련 기준\n\n짧게 쓴다.');
   assert.equal(by(ME).created_at.toISOString(),'2026-09-25T00:00:00.000Z');
  });
  await t.test('apply changed only app_notes: rtw tables, policies, grants, functions and other notes are identical',async()=>{
   const after=await snapshot();assert.equal(after.rtw,before.rtw);assert.equal(after.access,before.access);assert.equal(after.others,before.others);
   assert.equal((await pool.query("select count(*)::int n from public.app_notes where not (metadata ? 'rtw')")).rows[0].n,4);
   assert.equal((await pool.query("select count(*)::int n from pg_class where relpersistence='t' and relname like 'rtw\\_%'")).rows[0].n,0);
  });
  await t.test('re-run adds nothing: second apply and dry-run stop at the already-copied check',async()=>{
   for(const k of ['apply','dry'])await assert.rejects(run(sql[k]),e=>e.message.includes('RTW_COPY_STOP-04'));
   assert.equal(await migrated(),EXPECTED.total);
   // Safety net: even with that early check removed, the insert skips existing sources and the after-check cancels everything.
   const noGate=sql.apply.replace(/ {2}-- \(재실행 막기 시작\)[\s\S]*?-- \(재실행 막기 끝\)\n/,'');assert.notEqual(noGate,sql.apply);
   await assert.rejects(run(noGate),e=>e.message.includes('RTW_COPY_STOP-21'));
   assert.equal(await migrated(),EXPECTED.total);assert.equal((await pool.query('select count(distinct metadata->$1->>$2)::int n from public.app_notes where metadata ? $1',['rtw','id'])).rows[0].n,EXPECTED.total);
   assert.deepEqual(await snapshot(),{...before,others:before.others});
  });
  await t.test('check query: counts match the rtw originals, nothing missing',async()=>{
   const rep=Object.fromEntries((await rows(sql.check)).map(r=>[r['항목'],r]));
   assert.ok(Object.values(rep).every(r=>r['판정']==='OK'||r['판정']==='-'),JSON.stringify(Object.values(rep).filter(r=>r['판정']==='확인 필요')));
   assert.equal(rep['옮겨진 노트 합계']['값'],String(EXPECTED.total));assert.equal(rep['아직 안 옮겨진 읽생기 글(옮긴 뒤 새로 쓴 글 포함)']['값'],'0');
   assert.equal(rep['kind = basket']['값'],'1');assert.equal(rep['kind = note']['값'],String(EXPECTED.total+1));assert.equal(rep['kind = diary']['값'],'1');assert.equal(rep['kind = work']['값'],'1');
   // a graph-free source row written after the copy shows up as "not moved yet"
   await pool.query(`insert into public.rtw_questions(id,owner_id,body,status,created_at,updated_at) values('30000000-0000-4000-8000-0000000000b1','${ME}','나중에 쓴 질문','open',now(),now())`);
   try{const late=Object.fromEntries((await rows(sql.check)).map(r=>[r['항목'],r]));assert.equal(late['아직 안 옮겨진 읽생기 글(옮긴 뒤 새로 쓴 글 포함)']['판정'],'확인 필요');assert.equal(late['질문']['판정'],'확인 필요');}
   finally{await pool.query("delete from public.rtw_questions where id='30000000-0000-4000-8000-0000000000b1'");}
  });
  await t.test('revert refuses (and deletes nothing) when a copied note was edited, linked or changed',async()=>{
   const row=id=>`metadata->'rtw'->>'id'='${id}'`;
   const guard=async(breakIt,fixIt,pattern)=>{await pool.query(breakIt);try{await assert.rejects(run(sql.revert),e=>e.message.includes('RTW_REVERT_STOP-05')&&pattern.test(e.message));assert.equal(await migrated(),EXPECTED.total);}finally{await pool.query(fixIt);}};
   await guard(`update public.app_notes set raw_text=raw_text||' 고침',updated_at=now() where ${row(ID.R1)}`,`update public.app_notes set raw_text=replace(raw_text,' 고침',''),updated_at=(metadata->'rtw'->>'src_updated_at')::timestamptz where ${row(ID.R1)}`,/고침 1,/);
   await guard(`insert into public.app_record_links(workspace_id,note_id,project_id) select '${WS_A}',id,'22000000-0000-4000-8000-000000000001' from public.app_notes where ${row(ID.N1)}`,`delete from public.app_record_links where note_id in (select id from public.app_notes where ${row(ID.N1)})`,/연결 1\)/);
   await guard(`update public.app_notes set kind='basket',title=null where ${row(ID.Q2)}`,`update public.app_notes set kind='note',title='닫힌 질문' where ${row(ID.Q2)}`,/종류 바뀜 1,/);
   await guard(`update public.app_notes set ai_export_allowed=false where ${row(ID.N4)}`,`update public.app_notes set ai_export_allowed=true where ${row(ID.N4)}`,/기타 1,/);
   await guard(`update public.app_notes set metadata=metadata||'{"mine":1}' where ${row(ID.N3)}`,`update public.app_notes set metadata=metadata-'mine' where ${row(ID.N3)}`,/기타 1,/);
   // A foreign key from a new table to app_notes also stops the revert.
   await pool.query('create table public.zz_note_ref(note_id uuid references public.app_notes(id))');
   try{await assert.rejects(run(sql.revert),e=>e.message.includes('RTW_REVERT_STOP-04'));}finally{await pool.query('drop table public.zz_note_ref');}
   assert.equal(await migrated(),EXPECTED.total);
   // After the fixes the copied rows are untouched again.
   const rep=Object.fromEntries((await rows(sql.check)).map(r=>[r['항목'],r]));
   assert.equal(rep['옮긴 뒤 고쳐진 노트(옮긴 직후에는 0)']['값'],'0');assert.equal(rep['연결·첨부가 붙은 노트(옮긴 직후에는 0)']['값'],'0');
  });
  await t.test('revert: preview (v_preview = true) cancels everything and keeps rows; real revert removes only the copied notes; copy works again',async()=>{
   const preview=sql.revert.replace('v_preview boolean := false','v_preview boolean := true');assert.notEqual(preview,sql.revert);
   await assert.rejects(run(preview),e=>e.message.includes('RTW_REVERT_PREVIEW: 지울 수 있음 ('+EXPECTED.total+'개)'));
   assert.equal(await migrated(),EXPECTED.total);
   await run(sql.revert);assert.equal(await migrated(),0);
   const after=await snapshot();assert.deepEqual(after,before,'rtw tables, access control and the other notes are exactly as before');
   assert.equal((await pool.query("select count(*)::int n from public.app_notes where id=$1",[basket])).rows[0].n,1);
   await assert.rejects(run(sql.revert),e=>e.message.includes('RTW_REVERT_STOP-02'));
   // original rtw rows are still there, so the same SQL copies again from scratch
   await run(sql.apply);assert.equal(await migrated(),EXPECTED.total);
   await run(sql.revert);assert.equal(await migrated(),0);assert.deepEqual(await snapshot(),before);
  });
  await t.test('two windows at once: one copies, the other stops, and nothing is doubled',async()=>{
   const [a,b]=await Promise.allSettled([run(sql.apply),run(sql.apply)]);
   assert.deepEqual([a.status,b.status].sort(),['fulfilled','rejected']);
   assert.match((a.status==='rejected'?a:b).reason.message,/RTW_COPY_STOP-04|lock timeout/);
   assert.equal(await migrated(),EXPECTED.total);
   await run(sql.revert);assert.equal(await migrated(),0);assert.deepEqual(await snapshot(),before);
  });
  await t.test('one statement is all-or-nothing: an error after the inserts leaves no notes, and a 49-note copy goes in at once',async()=>{
   const failLate=sql.apply.replace(/\nend\n\$\$;\s*$/,"\n  raise exception 'FORCED_AFTER_INSERT';\nend\n$$;\n");assert.notEqual(failLate,sql.apply);
   await assert.rejects(run(failLate),e=>e.message.includes('FORCED_AFTER_INSERT'));assert.equal(await migrated(),0);assert.deepEqual(await snapshot(),before);
   // Grow the fake source to 49 notes (13 + 36 more articles), like the real 49, and copy them in one go.
   await pool.query(`insert into public.rtw_resources(id,owner_id,title,body_md,created_at,updated_at) select ('31000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${ME}','추가 글 '||g,'본문 '||g,timestamptz '2026-08-01 00:00+00'+g*interval '1 hour',timestamptz '2026-08-01 00:00+00'+g*interval '1 hour' from generate_series(1,36) g`);
   try{
    const rep=await report();assert.equal(rep['만들어질 노트 합계']['값'],'49');assert.equal(await migrated(),0);
    await run(sql.apply);assert.equal(await migrated(),49);
    await assert.rejects(run(sql.apply),e=>e.message.includes('RTW_COPY_STOP-04'));assert.equal(await migrated(),49);
    const chk=Object.fromEntries((await rows(sql.check)).map(r=>[r['항목'],r]));assert.ok(Object.values(chk).every(r=>r['판정']==='OK'||r['판정']==='-'));assert.equal(chk['옮겨진 노트 합계']['값'],'49');
    await run(sql.revert);assert.equal(await migrated(),0);
   }finally{await pool.query("delete from public.rtw_resources where id::text like '31000000-%'");}
   assert.deepEqual(await snapshot(),before);
  });
  await t.test('stops when a friend becomes the Web2 owner mismatch, and writes nothing as a non-owner role',async()=>{
   await pool.query(`update public.rtw_personal_mode set owner_id='${FRIEND}'`);
   try{await assert.rejects(run(sql.apply),e=>e.message.includes('RTW_COPY_STOP-03'));assert.equal(await migrated(),0);}
   finally{await pool.query(`update public.rtw_personal_mode set owner_id='${ME}'`);}
   // With only SELECT on app_notes (no insert/update/delete) the script cannot write at all.
   await pool.query('create role reader nologin bypassrls;grant select on all tables in schema public to reader;grant usage on schema public to reader');
   await assert.rejects(run(sql.apply,'reader'),e=>e.code==='42501');assert.equal(await migrated(),0);
  });
 }finally{
  if(pool){await pool.end();await Promise.all(clientEnds);}await cluster.stop().catch(()=>{});
 }
});
