-- S67-53 참고 묶음 처음 3개 정리 — 적용. ★ SQL Editor(폰 경로 C) 전용, 실행은 CC ★
-- 명진 요청(11/20 22:48·22:54 "둘 다 해"): 2026-10-23 migration(supabase/migrations/20261023231500_ref_bundle_db.sql)이 그때 있던
--   모든 작업공간에 넣은 노조식 참고 묶음 3개('공공운수노조'·'공공기관사업(본부)'·'기타 조직')를 다른 사람(테스터) 작업공간에서 지운다.
-- 무엇이 바뀌나: 운영자 허용 표(public.app_operator_features)에 없는 작업공간의 그 이름 묶음 중 연결된 기록(app_record_links.bundle_id)이
--   하나도 없는 것만 지운다. 연결이 있는 묶음은 남기고 개수만 보인다. 운영자(명진) 작업공간은 허용 표로 가려내 건드리지 않는다(계정·주소를 쓰지 않음).
-- 잘못되면: 지운 묶음이 목록에서 사라진다(붙은 소식은 없으므로 기록은 그대로).
-- 되돌리는 방법: docs/ops/ref-bundle-seed-cleanup.rollback.sql — 백업 표(ops_backup.s67_53_ref_bundle_seed)의 줄(id·workspace_id·name·sort_order·시각)을 되살린다.
-- 순서: ① precheck(ok_ 칸 모두 true, delete_targets 캡처) → ② 이 파일(새 쿼리 창, 첫 줄 begin; 마지막 줄 commit;·대상 프로젝트 확인)
--   → ③ precheck 다시(delete_targets = 0, backup_rows = ②의 deleted).
-- 왜 승인형 DB workflow가 아닌가: migration이 아니라 운영 데이터 한 번 정리이고, 백업 표를 ops_backup에 따로 남긴다(workflow 백업 이름 규칙 밖 → 매일 정리가 지우지 않음).
-- 남의 기록 안 보기(AGENTS.md 3절): 결과는 개수뿐이다. 묶음 이름 목록·작업공간·누구 것인지는 출력하지 않는다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 지우는 동안 새 연결이 붙거나 묶음이 바뀌지 않게(읽기는 막지 않음).
lock table public.app_reference_bundles, public.app_record_links in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261023231500' and name = 'ref_bundle_db') <> 1
     or to_regclass('public.app_reference_bundles') is null
     or to_regclass('public.app_record_links') is null
     or to_regclass('public.app_operator_features') is null
     or not exists (select 1 from public.app_operator_features)
     or to_regclass('ops_backup.s67_53_ref_bundle_seed') is not null then
    raise exception 'REF_BUNDLE_SEED_CLEANUP_PREREQUISITE_CHANGED: migration missing, operator table empty, or already applied; stop';
  end if;
end
$$;

create schema if not exists ops_backup;

-- 백업: 지울 줄 그대로(되살리기용).
create table ops_backup.s67_53_ref_bundle_seed as
select b.id, b.workspace_id, b.name, b.sort_order, b.created_at, b.updated_at
  from public.app_reference_bundles b
 where b.name in ('공공운수노조', '공공기관사업(본부)', '기타 조직')
   and not exists (select 1 from public.app_operator_features f where f.workspace_id = b.workspace_id)
   and not exists (select 1 from public.app_record_links l where l.bundle_id = b.id);
alter table ops_backup.s67_53_ref_bundle_seed add primary key (id);
alter table ops_backup.s67_53_ref_bundle_seed enable row level security;
revoke all on table ops_backup.s67_53_ref_bundle_seed from public, anon, authenticated, service_role;

-- 지우기: 백업한 줄만. 그사이 연결이 생긴 줄은(잠금으로 생길 수 없지만) 건너뛰고, 지운 수가 백업 수와 다르면 전체를 멈춘다.
do $$
declare v_backup bigint; v_deleted bigint;
begin
  select count(*) into v_backup from ops_backup.s67_53_ref_bundle_seed;
  with gone as (
    delete from public.app_reference_bundles b
     using ops_backup.s67_53_ref_bundle_seed k
     where b.id = k.id
       and not exists (select 1 from public.app_record_links l where l.bundle_id = b.id)
       and not exists (select 1 from public.app_operator_features f where f.workspace_id = b.workspace_id)
    returning b.id)
  select count(*) into v_deleted from gone;
  if v_deleted <> v_backup then
    raise exception 'REF_BUNDLE_SEED_CLEANUP_COUNT_MISMATCH: deleted % of %; stop', v_deleted, v_backup;
  end if;
end
$$;

-- 결과(개수만): 지운 수, 남긴 수(연결 있음), 운영자 작업공간 묶음(그대로).
select
  (select count(*) from ops_backup.s67_53_ref_bundle_seed) as deleted,
  (select count(*) from public.app_reference_bundles b
    where b.name in ('공공운수노조', '공공기관사업(본부)', '기타 조직')
      and not exists (select 1 from public.app_operator_features f where f.workspace_id = b.workspace_id)) as kept_with_links,
  (select count(*) from public.app_reference_bundles b
    where b.name in ('공공운수노조', '공공기관사업(본부)', '기타 조직')
      and exists (select 1 from public.app_operator_features f where f.workspace_id = b.workspace_id)) as operator_bundles_untouched;
commit;
