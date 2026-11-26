// S67-53 재발 방지(사용자 11/20 "공공기관 조직 목록 … 필히 삭제", "둘 다 해"): 묶음·조직 같은 사용자 자료를 모든 작업공간에 한꺼번에 넣는 migration 금지.
// 2026-10-23 migration(20261023231500_ref_bundle_db)이 모든 작업공간에 노조식 참고 묶음 3개를 넣어, 나중에 가입한 사람과 상관없는 묶음이
// 다른 사람 계정에 남았다(정리: docs/ops/ref-bundle-seed-cleanup.*.sql). 각자 쓰는 개인 업무 앱이므로(AGENTS.md 5절) 미리 채우는 자료는 두지 않는다.
// 검사: supabase/migrations·docs/*.sql·docs/ops/*.sql의 INSERT 문 중
//   ① 원본이 public.app_workspaces(모든 작업공간)인 것, ② 원본이 app_workspace_members·auth.users이면서 cross join(같은 줄을 사람마다 곱함)인 것을 막는다.
//   예외는 아래 표(파일·대상 표·이유)에만 둔다. 새 예외는 사용자 결정과 함께 이 표에 적는다.
// 함께: 가입 함수 app_workspace_start(마지막 정의)는 작업공간·주인·프로필 말고는 넣지 않는다(새 가입자에게 조직·묶음을 미리 넣지 않음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,existsSync} from 'node:fs';

const root=new URL('../../',import.meta.url);
const dirs=['supabase/migrations/','docs/','docs/ops/'];
const files=dirs.flatMap(d=>existsSync(new URL(d,root))?readdirSync(new URL(d,root)).filter(n=>n.endsWith('.sql')).map(n=>d+n):[]).sort();
const read=path=>readFileSync(new URL(path,root),'utf8');

// 예외 표: 이미 운영에 적용된 옛 migration만. 이 파일이 넣은 줄은 S67-53 정리 SQL이 운영자 아닌 작업공간에서 지운다.
export const ALLOWED=Object.freeze([
  {file:'supabase/migrations/20261023231500_ref_bundle_db.sql',table:'app_reference_bundles',why:'REF-참고묶음 1단계(2026-10-23, 적용 끝남). 이후 같은 방식 금지 — S67-53'},
]);

const stripComments=sql=>sql.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\n]*/g,' ');
// INSERT 문 하나(대상 표, 문장). 함수 본문($$ … $$) 안의 INSERT도 같은 규칙으로 본다.
export function inserts(sql){
  const out=[];const text=stripComments(sql);
  const re=/\binsert\s+into\s+((?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?[a-z_][a-z0-9_]*"?)[\s\S]*?(?:;|\$\$)/gi;
  for(const m of text.matchAll(re)){
    const name=m[1].replace(/["\s]/g,'').toLowerCase(),[schema,table]=name.includes('.')?name.split('.'):['public',name];
    out.push({schema,table,stmt:m[0]});
  }
  return out;
}
const fromAll=/\b(?:from|join)\s+(?:public\s*\.\s*)?"?app_workspaces"?(?![a-z0-9_])/i;
const fromPeople=/\b(?:from|join)\s+(?:(?:public\s*\.\s*)?"?app_workspace_members"?|auth\s*\.\s*"?users"?)(?![a-z0-9_])/i;
// 괄호 안(하위 질의·exists·values·칸 목록)을 뺀 바깥 줄기만 남긴다. 줄을 만들어 내는 원본(FROM)이 무엇인지만 보려는 것이다.
// 예: 되살리기 SQL의 'where exists (select 1 from public.app_workspaces …)'는 작업공간이 남아 있는지 확인일 뿐이라 잡지 않는다.
export function topLevel(stmt){
  let depth=0,out='';
  for(const ch of stmt){if(ch==='('){depth++;out+=' ';continue}if(ch===')'){depth=Math.max(0,depth-1);out+=' ';continue}out+=depth?' ':ch}
  return out;
}
export function broadcastInserts(sql){
  return inserts(sql).filter(i=>{if(i.schema!=='public')return false;const top=topLevel(i.stmt);return fromAll.test(top)||(fromPeople.test(top)&&/\bcross\s+join\b/i.test(top));});
}

test('검사기 자체: 모든 작업공간에 곱해 넣는 꼴은 잡고, 한 사람·자기 자료 옮기기는 잡지 않는다',()=>{
  const bad=[
    "insert into public.app_reference_bundles(workspace_id,name) select w.id, b.name from public.app_workspaces w cross join (values ('가'),('나')) b(name);",
    "insert into public.app_suborganizations (workspace_id, name) select id, '가상 조직' from public.app_workspaces;",
    'INSERT INTO app_org_groups(workspace_id,name) SELECT w.id,x.n FROM app_workspaces AS w, (VALUES (1)) x(n);',
    "insert into public.app_reference_bundles(workspace_id,name) select m.workspace_id, v.n from public.app_workspace_members m cross join (values ('가')) v(n);",
    "create function f() returns void language plpgsql as $$ begin insert into public.app_notes(workspace_id, raw_text) select w.id, '안내' from public.app_workspaces w; end $$;",
  ];
  for(const sql of bad)assert.equal(broadcastInserts(sql).length,1,sql);
  const ok=[
    "insert into public.app_workspaces (id, slug, name) values (v_id, v_slug, '내 업무');",
    "insert into public.app_workspace_members (workspace_id, user_id, role) values (v_id, v_user, 'owner');",
    "insert into public.app_feedback (user_id, workspace_id, body) values (v_user, (select m.workspace_id from public.app_workspace_members m where m.user_id = v_user limit 1), p_body);",
    "insert into public.app_business_records (workspace_id, space_id, body) select c.workspace_id, c.space_id, c.body from public.app_progress_old c;",
    "insert into supabase_migrations.schema_migrations(version, name) values ('1', 'x');",
    "-- insert into public.x select id from public.app_workspaces;\nselect 1;",
    "insert into public.app_workspaces_history select * from public.app_workspaces_old;",
    "insert into public.app_reference_bundles (id, workspace_id, name) select k.id, k.workspace_id, k.name from ops_backup.k k where exists (select 1 from public.app_workspaces w where w.id = k.workspace_id);",
    "insert into public.app_operator_features (workspace_id, feature) select w.workspace_id, f.feature from (select distinct workspace_id from public.app_feed_items) w cross join (values ('calls')) as f(feature) where (select count(*) from public.app_workspace_members m where m.workspace_id = w.workspace_id) = 1;",
  ];
  for(const sql of ok)assert.deepEqual(broadcastInserts(sql),[],sql);
});

test('migration·운영 SQL에 모든 작업공간에 사용자 자료를 한꺼번에 넣는 INSERT가 없다(예외 표 밖)',()=>{
  assert.ok(files.length>100,'SQL 파일을 찾지 못함');
  const found=[];
  for(const file of files)for(const i of broadcastInserts(read(file))){
    if(ALLOWED.some(a=>a.file===file&&a.table===i.table))continue;
    found.push(`${file} → ${i.schema}.${i.table}`);
  }
  assert.deepEqual(found,[],`모든 작업공간에 한꺼번에 넣는 INSERT(금지, 예외는 이 시험의 ALLOWED 표): ${found.join('; ')}`);
});

test('예외 표의 항목은 실제로 있고 여전히 그 꼴이다(낡은 예외를 남기지 않음)',()=>{
  for(const a of ALLOWED){
    assert.ok(existsSync(new URL(a.file,root)),a.file);
    assert.ok(broadcastInserts(read(a.file)).some(i=>i.table===a.table),`${a.file} ${a.table}: 더는 해당 없음 — 예외 표에서 빼 주세요`);
    assert.ok(a.why.length>0);
  }
});

test('가입 함수 app_workspace_start(마지막 정의)는 작업공간·주인·프로필만 넣는다',()=>{
  const defs=files.filter(f=>f.startsWith('supabase/migrations/')).filter(f=>/create\s+(?:or\s+replace\s+)?function\s+public\.app_workspace_start\s*\(/i.test(stripComments(read(f))));
  assert.ok(defs.length>0,'app_workspace_start 정의를 찾지 못함');
  const text=stripComments(read(defs.at(-1)));
  const start=text.search(/create\s+(?:or\s+replace\s+)?function\s+public\.app_workspace_start\s*\(/i);
  const open=text.indexOf('$$',start),close=text.indexOf('$$',open+2);
  assert.ok(open>start&&close>open,'함수 본문을 찾지 못함');
  const body=text.slice(open+2,close);
  const targets=[...new Set(inserts(body).map(i=>i.table))].sort();
  assert.deepEqual(targets.filter(t=>!['app_workspaces','app_workspace_members','app_profiles'].includes(t)),[],`가입 때 넣는 표: ${targets.join(', ')}`);
  assert.ok(targets.includes('app_workspaces')&&targets.includes('app_workspace_members'));
});
