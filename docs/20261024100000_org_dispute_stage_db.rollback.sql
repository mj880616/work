begin;
-- 20261024100000_org_dispute_stage_db의 짝 되돌리기(SQL Editor 경로 전용: 함수·표 삭제는 workflow rollback 허용 목록 밖).
-- 단계 목록 또는 단계 이력 줄이 하나라도 있으면 멈춘다. 그때는 아래 순서로 한다:
--   1) docs/20261024100000_org_dispute_stage_db.preserve.sql을 SQL Editor에서 실행해 결과(단계 목록 + 조직별 이력)를 보관한다.
--   2) 명진 확인 뒤, 두 표의 줄 삭제(이력 먼저, 단계 다음)를 따로 승인받아 실행한다.
--   3) 그 다음에 이 파일을 실행한다.
-- 순서: 삭제 함수 → 좁히기 정책 둘 → 이력 표 → 단계 표 → 기록 1행 삭제. 담당조직 표·기존 정책·권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261024100000' and name = 'org_dispute_stage_db') <> 1 then
    raise exception 'ORG_DISPUTE_STAGE_DB_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_suborganization_dispute_stages)
     or exists (select 1 from public.app_dispute_stages) then
    raise exception 'ORG_DISPUTE_STAGE_DB_ROLLBACK_BLOCKED: stage or history rows exist; preserve and delete them first with separate approval';
  end if;
end
$$;

-- 두 표의 좁히기 정책이 서로를 참조하고 이력 표가 단계 표를 참조하므로 정책 둘을 먼저 지운다.
drop function public.app_dispute_stage_delete(uuid, boolean);
drop policy dispute_stage_history_stage_ws on public.app_suborganization_dispute_stages;
drop policy dispute_stages_keep_default_and_used on public.app_dispute_stages;
drop table public.app_suborganization_dispute_stages;
drop table public.app_dispute_stages;

delete from supabase_migrations.schema_migrations where version = '20261024100000' and name = 'org_dispute_stage_db';
commit;
