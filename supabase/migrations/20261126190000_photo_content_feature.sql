begin;
-- S71-21 PHOTO-내용찾기 ②(DB). 설계: docs/design/photo-content-search.md 4-3절·6절 ①. 명진 11/26 17:25 "추천대로"(7절 네 가지 추천안).
-- 무엇:
--  1) 운영자 기능 키에 'photo_content'(사진을 설명 낱말로 찾기)를 더한다(검사 지우고 같은 이름으로 다시 만듦 — 앞 단계 20261125113100_blog_tables의 키 열은 그대로).
--  2) 허용 행은 '통화(calls)가 허용된 작업공간이 정확히 하나일 때'만 그 작업공간에 1행(고정 id·이름·메일 없음, blog·arsenal·outside와 같은 방식).
-- 쓰는 곳: Edge gdrive-photos의 content-find 동작이 service role 함수 public.app_operator_feature_workspace('photo_content')로
--   부른 사람의 작업공간과 같은지 본다(다르면 403). 화면은 app_my_features()에 키가 있을 때만 그 동작을 부른다(화면 판단은 편의일 뿐).
-- 권한: 바꾸지 않는다. app_operator_features는 RLS 켬·정책 없음·API 역할 권한 없음 그대로. 새 표·함수·정책·트리거·권한 없음.
-- 사진 설명 글은 DB에 두지 않는다(명진 드라이브 안 시트, 설계 4절). 안 하는 것: 기존 허용 행·함수·정책·권한 변경, 앱 표 변경, rtw_* 객체.
-- 짝: docs/20261126190000_photo_content_feature.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261126190000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261125113100' and name = 'blog_tables') <> 1
     or to_regclass('public.app_operator_features') is null
     or to_regprocedure('public.app_my_features()') is null
     or to_regprocedure('public.app_operator_feature_workspace(text)') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''blog''' and pg_get_constraintdef(oid) !~ '''photo_content''') <> 1
     or exists (select 1 from public.app_operator_features
                 where feature not in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words', 'blog')) then
    raise exception 'PHOTO_CONTENT_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from public.app_operator_features where feature = 'calls') <> 1 then
    raise exception 'PHOTO_CONTENT_SEED_WORKSPACE_NOT_SINGLE; stop';
  end if;
end
$$;

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words', 'blog', 'photo_content'));
insert into public.app_operator_features (workspace_id, feature)
  select f.workspace_id, 'photo_content' from public.app_operator_features f where f.feature = 'calls';

-- 사후 확인: 운영자 표는 RLS 켜짐·정책 없음·API 역할·PUBLIC 권한 없음 그대로, photo_content 행은 calls 작업공간 하나뿐. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_operator_features'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from public.app_operator_features where feature = 'photo_content') <> 1
     or not exists (select 1 from public.app_operator_features p join public.app_operator_features c
                     on c.workspace_id = p.workspace_id and c.feature = 'calls' where p.feature = 'photo_content') then
    raise exception 'PHOTO_CONTENT_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261126190000', 'photo_content_feature', array['S71-21: operator feature key photo_content (photo search by description words) added to app_operator_features_feature_check; one allow row for the single calls workspace; no grants, policies, functions or table changes']);
commit;
