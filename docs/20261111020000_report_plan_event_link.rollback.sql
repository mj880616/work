begin;
-- 20261111020000_report_plan_event_link의 짝 되돌리기. 이번에 만든 것만 지운다:
--   사업 보고 표의 색인 1개·검사 3개·칸 2개(google_calendar_id·google_event_id), 새 표 app_calendar_report_plans(정책 포함), 이번 기록 1행.
-- SQL Editor 경로 전용(새 표 지우기는 workflow rollback 모드 밖). 기존 표·정책·권한·다른 칸·사업 보고 내용·Google 일정에는 손대지 않는다.
-- 일정에 이어진 보고가 하나라도 있거나 '보고할 일정' 결정 줄이 하나라도 있으면(화면이 쓰기 시작한 뒤) 멈춘다. 지워서 통과시키지 않는다.
-- 그런 경우: ① docs/20261111020000_report_plan_event_link.preserve.sql(읽기 전용)을 SQL Editor에서 실행해 결과를 저장소 밖에 보관
--   ② 화면을 이 표·칸을 쓰지 않는 판으로 되돌림 ③ 그 값을 비우는 쓰기는 커맨드센터가 별도로 승인한 SQL로만 한 뒤 이 파일을 다시 실행.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261111020000' and name = 'report_plan_event_link') <> 1
     or to_regclass('public.app_calendar_report_plans') is null then
    raise exception 'REPORT_PLAN_EVENT_LINK_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_meetings where google_event_id is not null or google_calendar_id is not null) then
    raise exception 'REPORT_PLAN_EVENT_LINK_ROLLBACK_BLOCKED: reports linked to events; run the preserve SQL first';
  end if;
  if exists (select 1 from public.app_calendar_report_plans) then
    raise exception 'REPORT_PLAN_EVENT_LINK_ROLLBACK_BLOCKED: report plan rows exist; run the preserve SQL first';
  end if;
end
$$;

drop index public.app_meetings_google_event_idx;
alter table public.app_meetings drop constraint app_meetings_google_calendar_id_check;
alter table public.app_meetings drop constraint app_meetings_google_event_id_check;
alter table public.app_meetings drop constraint app_meetings_google_link_pair_check;
alter table public.app_meetings drop column google_event_id;
alter table public.app_meetings drop column google_calendar_id;

drop table public.app_calendar_report_plans;

delete from supabase_migrations.schema_migrations
  where version = '20261111020000' and name = 'report_plan_event_link';
commit;
