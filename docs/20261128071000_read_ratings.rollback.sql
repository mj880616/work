begin;
-- 20261128071000_read_ratings의 짝 되돌리기. 새 표 1개(검사·정책·색인 포함)와 이번 기록 1행만 지운다.
-- 주의: 남긴 👍·👎 평가도 함께 사라진다(되살릴 수 없음). 글·저장한 글·숨김 표시는 그대로 남는다.
-- 지우기 전에 화면을 이 표를 쓰지 않는 이전 판으로 되돌린다(ai-assist는 표가 없으면 평가 없이 지금처럼 고른다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261128071000' and name = 'read_ratings') <> 1 then
    raise exception 'READ_RATINGS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_read_ratings;

delete from supabase_migrations.schema_migrations
  where version = '20261128071000' and name = 'read_ratings';
commit;
