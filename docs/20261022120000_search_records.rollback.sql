begin;
-- 20261022120000_search_records의 짝 되돌리기. 검색 함수 1개와 이번 기록 1행만 지운다. 표·자료·정책·권한은 그대로다.
-- 짝 색인 migration(20261022120100_search_trgm_index)이 적용되어 있으면 그 rollback을 먼저 한다(아래 확인에서 멈춤).
-- 승인형 DB workflow rollback 모드 또는 SQL Editor(폰 경로 C). 화면(S-3)이 이 함수를 쓰기 시작한 뒤라면 검색칸만 오류가 난다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022120000' and name = 'search_records') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261022120100') then
    raise exception 'SEARCH_RECORDS_ROLLBACK_BLOCKED: migration record differs or index migration still applied';
  end if;
end
$$;

drop function public.app_search_records(text, text[], integer, integer, text);

delete from supabase_migrations.schema_migrations
  where version = '20261022120000' and name = 'search_records';
commit;
