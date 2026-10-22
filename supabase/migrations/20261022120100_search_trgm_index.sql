begin;
-- SEARCH-전체검색 S-1b: 메모 표(app_notes) 검색용 pg_trgm GIN 색인 1개. 표·자료·정책·권한·함수 변경 없음.
-- 선행: 20261022120000_search_records 기록, 그리고 pg_trgm 확장이 extensions 스키마에 설치되어 있어야 한다.
--   확장 설치는 이 파일이 하지 않는다(승인형 DB workflow는 create extension을 막는다). Supabase 관례대로
--   대시보드 Database → Extensions에서 pg_trgm을 schema extensions로 켠다(별도 정지 지점). 없으면 이 파일은 멈춘다.
-- 색인 식은 app_search_records 안 notes 조건식과 같아야 색인을 쓴다(함께 바꿀 것).
-- create index는 만드는 동안 app_notes 쓰기를 잠깐 막는다(1인 사용 표, 수 초 예상). 5초 안에 잠금을 못 얻으면 멈춘다.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022120000' and name = 'search_records') <> 1
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261022120100')
     or not exists (select 1 from pg_extension e join pg_namespace s on s.oid = e.extnamespace
         where e.extname = 'pg_trgm' and s.nspname = 'extensions')
     or exists (select 1 from pg_class where relname = 'app_notes_search_trgm_idx' and relnamespace = 'public'::regnamespace)
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_notes') and not attisdropped
         and attname in ('title', 'raw_text', 'attachments')) <> 3 then
    raise exception 'SEARCH_TRGM_INDEX_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create index app_notes_search_trgm_idx on public.app_notes using gin (
  (coalesce(title, '') || ' ' || raw_text || ' ' || coalesce(jsonb_path_query_array(attachments, '$[*].ocr ? (@.state == "done").text')::text, ''))
  extensions.gin_trgm_ops);

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022120100', 'search_trgm_index', array['SEARCH S-1b: app_notes_search_trgm_idx (pg_trgm GIN, extensions schema); no table, policy, grant or function change']);
commit;
