begin;
-- 20261022120100_search_trgm_index의 짝 되돌리기. 색인 1개와 이번 기록 1행만 지운다. 자료·표·함수는 그대로다(검색은 느려질 뿐 동작).
-- pg_trgm 확장은 남겨 둔다(다른 곳이 쓸 수 있고 남겨도 해가 없음. 지우려면 대시보드에서 따로 판단).
-- 승인형 DB workflow rollback 모드 또는 SQL Editor(폰 경로 C).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022120100' and name = 'search_trgm_index') <> 1 then
    raise exception 'SEARCH_TRGM_INDEX_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop index public.app_notes_search_trgm_idx;

delete from supabase_migrations.schema_migrations
  where version = '20261022120100' and name = 'search_trgm_index';
commit;
