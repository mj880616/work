begin;
-- 20261029160000_bizreport_oneline_kind의 짝 되돌리기. 칸 검사를 여덟 값으로 되돌리고 이번 기록 1행만 지운다.
-- 한 줄 업데이트(oneline)가 하나라도 저장돼 있으면 멈춘다. 기록을 지우거나 칸을 몰래 바꿔 통과시키지 않는다.
-- 그런 경우: ① docs/20261029160000_bizreport_oneline_kind.preserve.sql(id만 읽기)을 SQL Editor에서 실행해 결과를 보관
--   ② 화면을 한 줄 업데이트 없는 판으로 되돌림 ③ 그 기록을 어떻게 할지(다른 칸으로 바꾸기 등) 명진이 정해 별도 승인 SQL로 한 뒤 이 파일을 다시 실행.
-- 표 권한·정책·함수·다른 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261029160000' and name = 'bizreport_oneline_kind') <> 1 then
    raise exception 'BIZREPORT_ONELINE_KIND_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_meetings where activity_kind = 'oneline') then
    raise exception 'BIZREPORT_ONELINE_KIND_ROLLBACK_BLOCKED: one-line updates saved; run the preserve SQL first';
  end if;
end
$$;

alter table public.app_meetings drop constraint app_meetings_activity_kind_check;
alter table public.app_meetings
  add constraint app_meetings_activity_kind_check check (activity_kind in
    ('meeting', 'policy', 'negotiation', 'press', 'assembly', 'struggle', 'education', 'other'));

delete from supabase_migrations.schema_migrations
  where version = '20261029160000' and name = 'bizreport_oneline_kind';
commit;
