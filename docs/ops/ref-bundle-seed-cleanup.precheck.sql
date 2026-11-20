-- S67-53 참고 묶음 처음 3개 정리 — 사전·사후 확인(SELECT만, 개수만). CC가 SQL Editor 새 창 또는 조회 전용 MCP에서 실행한다.
-- 대상: 운영자 허용 표(public.app_operator_features)에 없는 작업공간의 app_reference_bundles 중
--   2026-10-23 migration(20261023231500_ref_bundle_db)이 모든 작업공간에 넣은 이름 3개이고 연결된 기록(app_record_links.bundle_id)이 하나도 없는 것.
-- 남의 기록 안 보기(AGENTS.md 3절): 묶음 이름·내용·작업공간·누구 것인지는 출력하지 않는다. 결과는 개수와 예/아니오뿐이다.
-- 읽는 법: ok_ 칸이 모두 true여야 apply로 간다. apply 뒤에 다시 돌리면 delete_targets = 0, backup_rows = apply가 지운 수여야 한다.
with seed(name) as (values ('공공운수노조'), ('공공기관사업(본부)'), ('기타 조직')),
seeded as (
  select b.id, b.workspace_id,
         exists (select 1 from public.app_operator_features f where f.workspace_id = b.workspace_id) as operator_ws,
         exists (select 1 from public.app_record_links l where l.bundle_id = b.id) as has_links
    from public.app_reference_bundles b
   where b.name in (select name from seed)
)
select
  (select count(*) = 1 from supabase_migrations.schema_migrations where version = '20261023231500' and name = 'ref_bundle_db') as ok_migration_applied,
  (select count(distinct workspace_id) > 0 from public.app_operator_features) as ok_operator_rows_present,
  (select count(distinct workspace_id) from public.app_operator_features) as operator_workspaces,
  (select count(*) from seeded where not operator_ws and not has_links) as delete_targets,
  (select count(distinct workspace_id) from seeded where not operator_ws and not has_links) as delete_target_workspaces,
  (select count(*) from seeded where not operator_ws and has_links) as kept_with_links,
  (select count(*) from seeded where operator_ws) as operator_bundles_untouched,
  to_regclass('ops_backup.s67_53_ref_bundle_seed') is null as ok_backup_absent,
  case when to_regclass('ops_backup.s67_53_ref_bundle_seed') is null then 0
       else (xpath('/row/n/text()', query_to_xml('select count(*) as n from ops_backup.s67_53_ref_bundle_seed', false, true, '')))[1]::text::bigint end as backup_rows,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ops_backup' and c.relname = 's67_53_ref_bundle_seed') as backup_tables;
