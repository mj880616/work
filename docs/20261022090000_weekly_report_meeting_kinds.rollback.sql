begin;
-- 20261022090000_weekly_report_meeting_kinds의 짝 되돌리기. 검사 조건·칸 하나와 이번 기록 1행만 지운다.
-- 어떤 프로필의 목록이 기본값과 다르면(사용자가 화면에서 "올림" 표시를 바꾼 뒤) 멈춘다. 목록을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 화면을 되돌리고(표시 바꾸기 없음 = 예전처럼 모든 회의를 올림), 목록을 캡처해 보관한 뒤 복구 계획을 따로 세운다.
-- 기존 표·정책·권한에는 손대지 않는다.
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
