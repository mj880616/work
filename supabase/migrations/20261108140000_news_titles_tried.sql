begin;
-- S54-16 SRV-낭비줄이기 ④(CC 조사 11/08): 뉴스 제목 번역(news-feed runTitles)이 번역을 못 받은 같은 외국어 기사를
-- 2일(TITLE_WINDOW_DAYS) 동안 매시간 다시 AI에 보낸다(실패 표시 없음). 시도 시각을 남겨 같은 줄은 하루 1~2번만 다시 보내게 한다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: public.app_news_items에 칸 1개 title_tried_at timestamptz null. 기존 줄은 null로 시작한다.
--   AI가 답했는데 그 줄의 제목·소개 번역이 다 오지 않았을 때만 서버(news-feed, service role의 기존 표 단위 update 권한)가 시각을 적는다.
--   translated_at(번역을 채운 시각, 하루 상한을 세는 칸)과 뜻이 섞이지 않게 따로 둔다.
-- 권한: 새 grant·revoke·정책·함수·트리거 없음. authenticated는 기존 표 단위 select + owner 정책(news_items_owner_all)으로
--   자기 작업공간 줄만 읽고, 이 칸을 넣거나 고칠 권한은 없다(칸 단위 update는 starred_at·folder_id·hidden_at·updated_at뿐, 그대로). anon·PUBLIC 권한 없음(그대로).
-- 안 하는 것: 기존 칸·검사·정책·권한·트리거·함수·색인 변경, 기존 줄 내용 변경, 다른 표, rtw_* 객체.
-- 짝: docs/20261108140000_news_titles_tried.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261108140000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261101233000' and name = 'news_clipping') <> 1
     or to_regclass('public.app_news_items') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_news_items') and attname = 'title_tried_at' and not attisdropped)
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_news_items') and relrowsecurity)
     or has_table_privilege('anon', 'public.app_news_items', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.app_news_items', 'insert,update,delete')
     or has_any_column_privilege('anon', 'public.app_news_items', 'select,insert,update,references') then
    raise exception 'NEWS_TITLES_TRIED_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_news_items add column title_tried_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.app_news_items'::regclass and attname = 'title_tried_at' and not attisdropped
                   and atttypid = 'timestamptz'::regtype and not attnotnull and attacl is null and not atthasdef)
     or exists (select 1 from public.app_news_items where title_tried_at is not null)
     or not has_column_privilege('authenticated', 'public.app_news_items', 'title_tried_at', 'select')
     or has_column_privilege('authenticated', 'public.app_news_items', 'title_tried_at', 'insert,update')
     or has_any_column_privilege('anon', 'public.app_news_items', 'select,insert,update,references')
     or not has_column_privilege('service_role', 'public.app_news_items', 'title_tried_at', 'select,update') then
    raise exception 'NEWS_TITLES_TRIED_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261108140000', 'news_titles_tried', array['NEWS titles retry: app_news_items adds nullable timestamptz title_tried_at (time the server last asked AI for a title/summary translation that did not fully come back); written only by the news-feed server path; no grant, revoke, policy, function, trigger, index or row change']);
commit;
