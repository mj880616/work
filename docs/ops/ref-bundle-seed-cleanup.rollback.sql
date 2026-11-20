-- S67-53 참고 묶음 처음 3개 정리 — 되돌리기. ★ SQL Editor(폰 경로 C) 전용 ★ 새 쿼리 창에서 실행(첫 줄 begin; 마지막 줄 commit;·대상 프로젝트 확인).
-- 무엇: apply가 남긴 백업 표(ops_backup.s67_53_ref_bundle_seed)의 줄을 같은 id·workspace_id·name·sort_order·시각으로 되살린다.
--   그 작업공간이 아직 있고, 같은 id나 같은 작업공간·같은 이름 묶음이 없을 때만 넣는다(이름 겹침 규칙 app_reference_bundles_name_unique).
--   백업 표는 지우지 않는다(정리는 확인 뒤 따로: drop table ops_backup.s67_53_ref_bundle_seed;).
-- 결과는 개수만(되살린 수, 건너뛴 수). 이름·작업공간은 출력하지 않는다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_reference_bundles in share row exclusive mode;

do $$
begin
  if to_regclass('ops_backup.s67_53_ref_bundle_seed') is null or to_regclass('public.app_reference_bundles') is null then
    raise exception 'REF_BUNDLE_SEED_ROLLBACK_NO_BACKUP: apply did not run or the backup is gone; stop';
  end if;
end
$$;

with back as (
  insert into public.app_reference_bundles (id, workspace_id, name, sort_order, created_at, updated_at)
  select k.id, k.workspace_id, k.name, k.sort_order, k.created_at, k.updated_at
    from ops_backup.s67_53_ref_bundle_seed k
   where exists (select 1 from public.app_workspaces w where w.id = k.workspace_id)
     and not exists (select 1 from public.app_reference_bundles b where b.id = k.id or (b.workspace_id = k.workspace_id and b.name = k.name))
  returning id)
select (select count(*) from back) as restored,
       (select count(*) from ops_backup.s67_53_ref_bundle_seed) - (select count(*) from back) as skipped;
commit;
