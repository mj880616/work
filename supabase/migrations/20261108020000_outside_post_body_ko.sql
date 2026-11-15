begin;
-- S52-36 NEWS-바깥소식번역(명진 실기기 확인 11/08 01:36: News Jacobin 영어 기사 [원문 전체]에 [번역]이 없음).
-- 사회운동 영어 소식(app_outside_posts, lang='en')에도 뉴스 기사(app_news_items.body_ko)와 같은 [번역] 저장 칸을 둔다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: public.app_outside_posts에 칸 1개 body_ko text null + 검사 app_outside_posts_body_ko_check
--   (null이거나, 영어 글(lang='en')이고 글자 1~100000자 — app_news_items.body_ko 검사와 같은 길이). 기존 줄은 null로 시작한다.
--   채우는 것은 서버(outside-feed translate, service role의 기존 표 단위 update 권한)뿐이다. 사람이 [번역]을 누른 글만, 한 번 채우면 저장본.
-- 권한: 새 grant·revoke·정책·함수·트리거 없음. authenticated는 기존 표 단위 select + owner 정책(outside_posts_owner_select)으로
--   자기 작업공간 줄만 읽고, 이 칸을 넣거나 고칠 권한은 없다(기존 그대로). anon·PUBLIC 권한 없음(그대로).
-- 설계와 다른 점(한 줄): outside-statements 설계 2절 '외국 글 전문 번역은 저장하지 않는다'는 수집 때 이야기로 남기고,
--   사람이 누른 [번역]만 작업공간 소유자 비공개로 저장한다(뉴스 기사 [번역]과 같은 경계, S52-36 CC 지시).
-- 안 하는 것: 기존 칸·검사·정책·권한·트리거·함수 변경, 기존 줄 내용 변경, app_news_items·app_feed_bodies·app_news_days 변경, rtw_* 객체.
-- 짝: docs/20261108020000_outside_post_body_ko.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261108020000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261031230000' and name = 'outside_statements') <> 1
     or to_regclass('public.app_outside_posts') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_outside_posts') and attname = 'body_ko' and not attisdropped)
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_outside_posts') and conname = 'app_outside_posts_body_ko_check')
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_outside_posts') and relrowsecurity)
     or has_table_privilege('anon', 'public.app_outside_posts', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.app_outside_posts', 'insert,update,delete')
     or has_any_column_privilege('authenticated', 'public.app_outside_posts', 'insert,update') then
    raise exception 'OUTSIDE_POST_BODY_KO_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_outside_posts add column body_ko text;
alter table public.app_outside_posts add constraint app_outside_posts_body_ko_check
  check (body_ko is null or (lang = 'en' and char_length(body_ko) between 1 and 100000));

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.app_outside_posts'::regclass and attname = 'body_ko' and not attisdropped
                   and atttypid = 'text'::regtype and not attnotnull and attacl is null)
     or (select count(*) from pg_constraint where conrelid = 'public.app_outside_posts'::regclass and conname = 'app_outside_posts_body_ko_check'
         and contype = 'c' and convalidated) <> 1
     or exists (select 1 from public.app_outside_posts where body_ko is not null)
     or not has_column_privilege('authenticated', 'public.app_outside_posts', 'body_ko', 'select')
     or has_column_privilege('authenticated', 'public.app_outside_posts', 'body_ko', 'insert,update')
     or has_any_column_privilege('anon', 'public.app_outside_posts', 'select,insert,update,references')
     or not has_column_privilege('service_role', 'public.app_outside_posts', 'body_ko', 'select,update') then
    raise exception 'OUTSIDE_POST_BODY_KO_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261108020000', 'outside_post_body_ko', array['OUTSIDE translate: app_outside_posts adds nullable text body_ko (null, or lang en with 1..100000 chars, check app_outside_posts_body_ko_check); written only by the outside-feed translate server path; no grant, revoke, policy, function, trigger or row change']);
commit;
