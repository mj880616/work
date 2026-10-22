-- 초안(DRAFT) — 적용·실행 금지. 20261022090000_weekly_report_meeting_kinds.sql의 짝 되돌리기. 검사 조건·칸 하나만 지운다.
-- 사용자가 목록을 기본값에서 바꾼 뒤라면 멈춘다(목록을 지워서 통과시키지 않는다). 그 경우 먼저 화면을 되돌리고 목록을 캡처·보관한다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022090000' and name = 'weekly_report_meeting_kinds') <> 1 then
    raise exception 'WEEKLY_MEETING_KINDS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles
      where weekly_hidden_meeting_kinds is distinct from array['궤도집행국회의', '본부집행위']::text[]) then
    raise exception 'WEEKLY_MEETING_KINDS_ROLLBACK_BLOCKED: list edited; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_profiles
  drop constraint app_profiles_weekly_hidden_meeting_kinds_check,
  drop column weekly_hidden_meeting_kinds;

delete from supabase_migrations.schema_migrations
  where version = '20261022090000' and name = 'weekly_report_meeting_kinds';
commit;
