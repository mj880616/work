begin;
-- 20261028191500_bizreport_area_next_plan의 짝 되돌리기(SQL Editor 전용: drop policy는 승인형 workflow rollback 허용 목록 밖).
-- 좁히기 정책·칸 두 개(외래키·검사 포함)와 이번 기록 1행만 지운다. 기존 표·정책·권한·다른 칸·사업 보고 내용에는 손대지 않는다.
-- 꼬리표나 다음 할 일이 하나라도 저장돼 있으면(화면이 쓰기 시작한 뒤) 멈춘다. 지워서 통과시키지 않는다.
-- 그런 경우: ① docs/20261028191500_bizreport_area_next_plan.preserve.sql을 SQL Editor에서 실행해 결과를 저장소 밖에 보관
--   ② 화면을 이 칸을 쓰지 않는 판으로 되돌림 ③ 두 칸을 비우는 쓰기는 커맨드센터가 별도로 승인한 SQL로만 한 뒤 이 파일을 다시 실행.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261028191500' and name = 'bizreport_area_next_plan') <> 1 then
    raise exception 'BIZREPORT_AREA_NEXT_PLAN_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_meetings where business_area_id is not null or next_plan is not null) then
    raise exception 'BIZREPORT_AREA_NEXT_PLAN_ROLLBACK_BLOCKED: values saved; run the preserve SQL first';
  end if;
end
$$;

drop policy app_meetings_business_area_ws on public.app_meetings;
alter table public.app_meetings
  drop constraint app_meetings_next_plan_check,
  drop constraint app_meetings_business_area_id_fkey,
  drop column next_plan,
  drop column business_area_id;

delete from supabase_migrations.schema_migrations
  where version = '20261028191500' and name = 'bizreport_area_next_plan';
commit;
