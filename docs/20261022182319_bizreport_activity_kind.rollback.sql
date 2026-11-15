begin;
-- 20261022182319_bizreport_activity_kind의 짝 되돌리기. 검사 조건·칸 하나와 이번 기록 1행만 지운다.
-- '회의'가 아닌 칸으로 저장된 기록이 하나라도 있으면(화면에서 칸을 고른 뒤) 멈춘다. 칸 정보를 지워서 통과시키지 않는다.
-- 그런 경우: ① docs/20261022182319_bizreport_activity_kind.preserve.sql(id, activity_kind만 읽기)을 SQL Editor에서 실행해 결과를 보관
--   ② 화면을 칸 없는 판으로 되돌림 ③ 칸을 '회의'로 되돌리는 쓰기는 커맨드센터가 별도로 승인한 SQL로만 한 뒤 이 파일을 다시 실행.
-- 기존 표·정책·권한·다른 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022182319' and name = 'bizreport_activity_kind') <> 1 then
    raise exception 'BIZREPORT_ACTIVITY_KIND_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_meetings where activity_kind <> 'meeting') then
    raise exception 'BIZREPORT_ACTIVITY_KIND_ROLLBACK_BLOCKED: non-meeting kinds saved; run the preserve SQL first';
  end if;
end
$$;

alter table public.app_meetings
  drop constraint app_meetings_activity_kind_check,
  drop column activity_kind;

delete from supabase_migrations.schema_migrations
  where version = '20261022182319' and name = 'bizreport_activity_kind';
commit;
