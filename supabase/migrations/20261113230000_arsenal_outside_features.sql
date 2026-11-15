begin;
-- MULTI-처음쓰는사람 ③(docs/design/new-user-start.md 2-1·4절): 아스날·News는 운영자(명진) 작업공간에만(명진 11/13 15:26 "내 계정에만").
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 DB 적용이 먼저, 메뉴에서 빼는 화면 PR이 나중(거꾸로면 명진 메뉴에서도 잠깐 사라짐).
--
--  1) 운영자 기능 키에 'arsenal'(아스날)·'outside'(News)를 더한다(검사 지우고 같은 이름으로 다시 만듦 — 앞 단계 20261113160000_ai_user_cap의 키 일곱은 그대로).
--  2) 허용 행은 '통화(calls)가 허용된 작업공간이 정확히 하나일 때'만 그 작업공간에 키마다 1행 넣는다(고정 id·이름·메일 없음, dev_inbox·family·ai_no_cap과 같은 방식).
--     화면은 app_my_features() 답으로 메뉴 목록에서 뺀다(새 함수 없음 — 기존 함수가 허용 표를 그대로 읽는다).
-- 권한: 바꾸지 않는다. app_operator_features는 RLS 켬·정책 없음·API 역할 권한 없음 그대로. 새 표·함수·정책·트리거·권한 없음.
-- 안 하는 것: 기존 허용 행·함수·정책·권한 변경, 앱 표(뉴스·아스날 자료) 변경, rtw_* 객체.
-- 짝: docs/20261113230000_arsenal_outside_features.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261113230000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261113160000' and name = 'ai_user_cap') <> 1
     or to_regclass('public.app_operator_features') is null
     or to_regprocedure('public.app_my_features()') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''ai_no_cap''' and pg_get_constraintdef(oid) !~ '''(arsenal|outside)''') <> 1
     or exists (select 1 from public.app_operator_features
                 where feature not in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap')) then
    raise exception 'ARSENAL_OUTSIDE_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from public.app_operator_features where feature = 'calls') <> 1 then
    raise exception 'ARSENAL_OUTSIDE_SEED_WORKSPACE_NOT_SINGLE; stop';
  end if;
end
$$;

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside'));
insert into public.app_operator_features (workspace_id, feature)
  select f.workspace_id, k.feature from public.app_operator_features f
   cross join (values ('arsenal'), ('outside')) as k(feature)
   where f.feature = 'calls';

-- 사후 확인: 운영자 표는 RLS 켜짐·정책 없음·authenticated·anon·service_role·PUBLIC 권한 없음 그대로,
-- arsenal·outside 행은 각각 calls 행과 같은 작업공간 1행. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_operator_features'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from public.app_operator_features where feature = 'arsenal') <> 1
     or (select count(*) from public.app_operator_features where feature = 'outside') <> 1
     or (select count(*) from public.app_operator_features d join public.app_operator_features c
           on c.workspace_id = d.workspace_id and c.feature = 'calls' where d.feature in ('arsenal', 'outside')) <> 2 then
    raise exception 'ARSENAL_OUTSIDE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261113230000', 'arsenal_outside_features', array['MULTI-처음쓰는사람 ③: operator features arsenal and outside added to app_operator_features_feature_check and seeded only for the single calls workspace; no grants, policies, functions or table changes']);
commit;
