import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {validateExpanded} from '../../scripts/ops/db-migration-expanded.mjs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// FILES-클라우드탐색기 ② DB(docs/design/files-explorer.md 3절·4.1절). 정적 검사만 한다:
// 새 표 셋 RLS, 화면은 owner + files 허용일 때 items·stars 읽기만, 쓰기는 service_role만, anon·PUBLIC 없음, 기존 표 권한을 넓히지 않음.
const V='20261102160000',N='cloud_files_index';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const sql=read(`supabase/migrations/${V}_${N}.sql`);
const code=sql.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').replace(/\s+/g,' ').toLowerCase();
const TABLES=['app_cloud_sync','app_cloud_items','app_cloud_stars'];
const FNS=['public.app_cloud_list(text, text)','public.app_cloud_trail(text, text)','public.app_cloud_find(text, text, integer)'];
const OWNER="using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'files'));";

test('three new tables, RLS on, everything revoked first',()=>{
  for(const t of TABLES){
    assert.match(code,new RegExp(`create table public\\.${t} \\(`));
    assert.ok(code.includes(`alter table public.${t} enable row level security;`),`${t} RLS`);
    assert.ok(code.includes(`revoke all on table public.${t} from public, anon, authenticated, service_role;`),`${t} revoke`);
  }
  assert.ok(!/disable row level security|no force row level security/.test(code));
});

test('screen reads items and stars only through owner + files feature policy (select, authenticated)',()=>{
  assert.ok(code.includes(`create policy cloud_items_owner_read on public.app_cloud_items for select to authenticated ${OWNER}`));
  assert.ok(code.includes(`create policy cloud_stars_owner_read on public.app_cloud_stars for select to authenticated ${OWNER}`));
  assert.equal((code.match(/create policy /g)||[]).length,2,'sync 표·기존 표에는 정책 없음');
  assert.ok(!/create policy [^;]*app_cloud_sync/.test(code));
  assert.ok(!/using \(true\)|with check \(true\)/.test(code));
});

test('grants: authenticated select on items·stars only; service_role four on new tables; no anon/PUBLIC; no existing table',()=>{
  const grants=[...code.matchAll(/grant [^;]*;/g)].map(m=>m[0]);
  assert.deepEqual(grants.filter(g=>/ on table /.test(g)).sort(),[
    'grant select on table public.app_cloud_items to authenticated;',
    'grant select on table public.app_cloud_stars to authenticated;',
    'grant select, insert, update, delete on table public.app_cloud_items to service_role;',
    'grant select, insert, update, delete on table public.app_cloud_stars to service_role;',
    'grant select, insert, update, delete on table public.app_cloud_sync to service_role;',
  ].sort());
  for(const g of grants){
    assert.ok(!/\banon\b|to public\b|with grant option/.test(g),g);
    assert.ok(!/app_operator_features|app_documents/.test(g),`기존 표 권한 추가 금지: ${g}`);
  }
});

test('read functions are SECURITY INVOKER with fixed search_path; PUBLIC/anon revoked before granting authenticated',()=>{
  assert.ok(!/security definer/.test(code));
  assert.equal((code.match(/security invoker set search_path = ''/g)||[]).length,3);
  for(const f of FNS){
    const rv=code.indexOf(`revoke all on function ${f} from public, anon, authenticated, service_role;`);
    const gr=code.indexOf(`grant execute on function ${f} to authenticated;`);
    assert.ok(rv>0&&gr>rv,`${f} 회수 뒤 부여`);
  }
  assert.ok(!/\bexecute format|\bexecute '|\bexecute v_/.test(code),'동적 실행 없음');
});

test('find: bounded query/limit, literal ILIKE, only ready library text (F7), shelves recent·big·starred (F9)',()=>{
  assert.match(code,/message = 'cloud_find_bad_query'/);
  assert.match(code,/v_limit < 1 or v_limit > 300/);
  assert.ok(code.includes("p_shelf not in ('recent', 'big', 'starred')"));
  assert.ok(code.includes("replace(pg_catalog.replace(pg_catalog.replace(x.w, '\\', '\\\\'), '%', '\\%'), '_', '\\_')"));
  assert.ok(code.includes("case when doc.extraction_status = 'ready' then doc.extracted_text end"));
});

test('folder count = direct files only (F3); root items have parent_id null; trashed hidden',()=>{
  assert.ok(code.includes('c.parent_id = i.item_id and not c.is_folder and not c.trashed'));
  assert.ok(code.includes('i.parent_id is not distinct from p_parent_id and not i.trashed'));
});

test('feature key files: check extended and seeded only for the gdrive_photos (= calls) workspace',()=>{
  assert.ok(code.includes("check (feature in ('calls', 'telegram', 'gdrive_photos', 'files'));"));
  assert.ok(code.includes("insert into public.app_operator_features (workspace_id, feature) select f.workspace_id, 'files' from public.app_operator_features f where f.feature = 'gdrive_photos';"));
  assert.match(code,/raise exception 'cloud_files_seed_workspace_not_single; stop'/);
  assert.match(code,/raise exception 'cloud_files_prerequisite_changed; stop'/);
  assert.match(code,/raise exception 'cloud_files_postcheck_failed; stop'/);
  assert.ok(!/\b[0-9a-f]{8}-[0-9a-f]{4}-/.test(code),'고정 작업공간 id 금지');
  assert.ok(!code.includes('rtw_'));
});

test('no file body column: index holds list metadata only',()=>{
  const items=code.match(/create table public\.app_cloud_items \(([^;]*)\);/)[1];
  assert.ok(!/content|body|text_body|extracted|download|token/.test(items));
});

test('history row last before single commit; expanded rules accept; workflow plan runs full flow',()=>{
  const t=code.trim();
  assert.ok(t.startsWith('begin;'));
  assert.match(t,new RegExp(`insert into supabase_migrations\\.schema_migrations \\(version, name, statements\\) values \\('${V}', '${N}', array\\[[^\\]]*\\]\\); commit;$`));
  assert.equal((t.match(/\bcommit;/g)||[]).length,1);
  const r=validateExpanded(sql,{version:V,name:N});
  assert.equal(r.review.definer.length,0);
  assert.equal(r.review.policies,2);
  const plan=prepareMigration({mode:'apply',version:V,runId:'1',root:new URL('.',root).pathname});
  assert.equal(plan.flow,'full');
  assert.equal(plan.rules,'expanded');
});

test('pair files: precheck expects zero files rows; rollback drops exactly what was made',()=>{
  for(const s of ['precheck.sql','snapshot.sql','postcheck.sql','rollback.sql','summary.md'])
    assert.ok(existsSync(new URL(`docs/${V}_${N}.${s}`,root)),`짝 파일 ${s} 없음`);
  assert.match(read(`docs/${V}_${N}.precheck.sql`),/^-- expect: files rows = 0$/m);
  const rb=read(`docs/${V}_${N}.rollback.sql`).replace(/\s+/g,' ').toLowerCase();
  for(const f of FNS)assert.ok(rb.includes(`drop function ${f};`),f);
  for(const t of TABLES)assert.ok(rb.includes(`drop table public.${t};`),t);
  assert.ok(rb.includes("delete from public.app_operator_features where feature = 'files';"));
  assert.ok(rb.includes("check (feature in ('calls', 'telegram', 'gdrive_photos'));"));
  assert.ok(rb.includes(`where version = '${V}' and name = '${N}';`));
  assert.equal((rb.match(/\bdrop /g)||[]).length,7);
});
