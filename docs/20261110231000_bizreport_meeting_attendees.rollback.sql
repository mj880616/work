begin;
-- 20261110231000_bizreport_meeting_attendees의 짝 되돌리기. 이번에 만든 것만 지운다: 검사 1개·칸 1개(attendees)·이번 기록 1행.
-- 기존 표·정책·권한·다른 칸·사업 보고 내용에는 손대지 않는다.
-- 참석인원을 적은 보고가 하나라도 있으면(화면이 쓰기 시작한 뒤) 멈춘다. 지워서 통과시키지 않는다.
-- 그런 경우: ① docs/20261110231000_bizreport_meeting_attendees.preserve.sql(id·참석인원만 읽기)을 SQL Editor에서 실행해 결과를 저장소 밖에 보관
--   ② 화면을 참석인원 칸이 없는 판으로 되돌림(화면은 칸이 없으면 참석인원 줄을 숨긴다) ③ 그 값을 비우는 쓰기는 커맨드센터가 별도로 승인한 SQL로만 한 뒤 이 파일을 다시 실행.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261110231000' and name = 'bizreport_meeting_attendees') <> 1 then
    raise exception 'BIZREPORT_MEETING_ATTENDEES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_meetings where attendees is not null) then
    raise exception 'BIZREPORT_MEETING_ATTENDEES_ROLLBACK_BLOCKED: reports with attendees; run the preserve SQL first';
  end if;
end
$$;

alter table public.app_meetings drop constraint app_meetings_attendees_length_check;
alter table public.app_meetings drop column attendees;

delete from supabase_migrations.schema_migrations
  where version = '20261110231000' and name = 'bizreport_meeting_attendees';
commit;
