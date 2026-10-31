begin;
-- 20261101010000_phone_push의 짝 되돌리기. 새 표 둘·notify_prefs 칸과 검사 제약·이번 기록 1행만 되돌린다.
-- 지워지는 것: 등록된 폰 기기 토큰(앱이 다시 등록하면 생김)·보낸 알림 기록·알림 설정(종류 켜기/끄기·조용한 시간).
-- 먼저 phone-push 예약 workflow를 끄고(Actions [Disable workflow]), 화면이 알림 설정·기기 표를 부르지 않게 되돌린 뒤 실행한다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다). 기존 표·정책·함수는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261101010000' and name = 'phone_push') <> 1 then
    raise exception 'PHONE_PUSH_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_push_log;
drop table public.app_push_devices;
alter table public.app_profiles drop constraint app_profiles_notify_prefs_check;
alter table public.app_profiles drop column notify_prefs;

delete from supabase_migrations.schema_migrations
  where version = '20261101010000' and name = 'phone_push';
commit;
