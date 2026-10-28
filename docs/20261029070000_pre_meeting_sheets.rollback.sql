begin;
-- 20261029070000_pre_meeting_sheets의 짝 되돌리기. 새 표 1개(색인·정책·트리거 포함)·트리거 함수 1개와 이번 기록 1행만 지운다.
-- 지워지는 것은 '교섭·회의 전 한 장' 사본뿐이다. 원본(Google Calendar·원장·회의·통화·자료)은 건드리지 않는다.
-- 지우기 전에 ai-assist를 pre_meeting_sheet 이전 판으로 되돌린다(화면은 표가 없으면 여는 줄에 "준비 중" 한 줄만 보임).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261029070000' and name = 'pre_meeting_sheets') <> 1 then
    raise exception 'PRE_MEETING_SHEETS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_pre_meeting_sheets;
drop function private.app_pre_meeting_sheets_guard();

delete from supabase_migrations.schema_migrations
  where version = '20261029070000' and name = 'pre_meeting_sheets';
commit;
