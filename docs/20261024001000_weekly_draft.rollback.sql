begin;
-- 20261024001000_weekly_draft의 짝 되돌리기. 검사 조건·칸 둘(새 칸의 권한도 함께 사라짐)과 이번 기록 1행만 지운다.
-- 임시저장본(draft)이 들어 있는 행이 하나라도 있으면 멈춘다(화면에서 임시저장한 뒤). 값을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 draft를 캡처해 보관하고 복구 계획을 따로 세운다(임시저장은 고치던 중인 초안이므로 확정본 파일·요청 줄 items에는 영향이 없다).
-- 기존 표·정책·다른 칸 권한에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_weekly_exec_requests in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261024001000' and name = 'weekly_draft') <> 1 then
    raise exception 'WEEKLY_DRAFT_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_weekly_exec_requests where draft is not null) then
    raise exception 'WEEKLY_DRAFT_ROLLBACK_BLOCKED: saved drafts exist; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_weekly_exec_requests
  drop constraint app_weekly_exec_requests_draft_check,
  drop column draft_saved_at,
  drop column draft;

delete from supabase_migrations.schema_migrations
  where version = '20261024001000' and name = 'weekly_draft';
commit;
