begin;
-- 20261029040000_journal_next_week_sheets의 짝 되돌리기. 새 표 1개(정책 포함)와 이번 기록 1행만 지운다.
-- 지워지는 것은 '다음 주 준비 한 장' 사본뿐이다. 원본(Google Tasks·Calendar·원장·챙길 것·회의)은 건드리지 않는다.
-- 지우기 전에 ai-assist를 next_week_sheet 이전 판으로 되돌린다(화면은 표가 없으면 [다음 주] 칸에 "준비 중" 한 줄만 보임).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261029040000' and name = 'journal_next_week_sheets') <> 1 then
    raise exception 'JOURNAL_NEXT_WEEK_SHEETS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_journal_next_week_sheets;

delete from supabase_migrations.schema_migrations
  where version = '20261029040000' and name = 'journal_next_week_sheets';
commit;
