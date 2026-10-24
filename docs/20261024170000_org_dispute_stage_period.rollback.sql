begin;
-- 20261024170000_org_dispute_stage_period의 짝 되돌리기(SQL Editor 경로 전용).
-- 고치기 좁히기 정책 → 네 칸의 고치기 열 권한·새 칸 넣기 권한 회수 → 검사·칸 삭제 → 이번 기록 1행 삭제. 이력 줄 자체·다른 정책·다른 권한에는 손대지 않는다.
-- 끝 날짜가 든 이력 줄이 하나라도 있으면 멈춘다(값을 지워서 통과시키지 않는다). 그때는 먼저 아래 select로 보관하고 명진 확인 뒤 따로 계획한다:
--   select id, organization_id, stage_name, stage_date, end_date from public.app_suborganization_dispute_stages where end_date is not null;
-- 고치기로 바뀐 줄(단계·날짜)은 고친 값 그대로 남는다(되돌리기는 이전 값을 알 수 없다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_suborganization_dispute_stages in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261024170000' and name = 'org_dispute_stage_period') <> 1 then
    raise exception 'ORG_DISPUTE_STAGE_PERIOD_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_suborganization_dispute_stages where end_date is not null) then
    raise exception 'ORG_DISPUTE_STAGE_PERIOD_ROLLBACK_BLOCKED: end dates exist; preserve and plan recovery';
  end if;
end
$$;

drop policy dispute_stage_history_stage_ws_update on public.app_suborganization_dispute_stages;
revoke update (stage_id, stage_name, stage_date, end_date) on table public.app_suborganization_dispute_stages from authenticated;
revoke insert (end_date) on table public.app_suborganization_dispute_stages from authenticated;
alter table public.app_suborganization_dispute_stages
  drop constraint app_suborganization_dispute_stages_end_date_check,
  drop column end_date;

delete from supabase_migrations.schema_migrations
  where version = '20261024170000' and name = 'org_dispute_stage_period';
commit;
