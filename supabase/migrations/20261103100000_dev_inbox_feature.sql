begin;
-- S48-49 주간보고 개발 후보 → 'Web2 요청함' 전달 DB (WEEKLY-개발후보연결 D2, 명진 결정 11/03 09:37 "모두 추천대로").
-- 설계: docs/design/weekly-draft-feedback.md 25.2 추천안(가). 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다.
--
--  1) 운영자 기능 키에 'dev_inbox'를 더한다(검사 지우고 같은 이름으로 다시 만듦 — 앞 단계 20261102160000_cloud_files_index의 키 넷은 그대로).
--  2) 허용 행은 '통화(calls)가 허용된 작업공간이 정확히 하나일 때'만 그 작업공간에 1행 넣는다. 고정 id·이름·메일을 쓰지 않는다.
--     Edge document-actions action=dev-inbox가 이 키(내 기능 목록 + 그 기능의 작업공간이 정확히 하나이고 내 작업공간)를 확인한 뒤에만
--     요청함 문서(Drive 토큰은 프로젝트 전체 1개 = 명진 계정)에 쓴다. 다른 작업공간(노조 사람)의 [만들기]는 자기 작업공간에만 남는다.
-- 권한: 바꾸지 않는다. app_operator_features는 RLS 켬·정책 없음·API 역할 권한 없음 그대로. 새 표·함수·정책·트리거·권한 없음.
-- 안 하는 것: 기존 허용 행·함수·정책·권한 변경, 앱 표 변경.
-- 짝: docs/20261103100000_dev_inbox_feature.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261103100000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261102160000' and name = 'cloud_files_index') <> 1
     or to_regclass('public.app_operator_features') is null
     or to_regprocedure('public.app_my_features()') is null
     or to_regprocedure('public.app_operator_feature_workspace(text)') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''files''' and pg_get_constraintdef(oid) !~ 'dev_inbox') <> 1
     or exists (select 1 from public.app_operator_features where feature not in ('calls', 'telegram', 'gdrive_photos', 'files')) then
    raise exception 'DEV_INBOX_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from public.app_operator_features where feature = 'calls') <> 1 then
    raise exception 'DEV_INBOX_SEED_WORKSPACE_NOT_SINGLE; stop';
  end if;
end
$$;

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox'));
insert into public.app_operator_features (workspace_id, feature)
  select f.workspace_id, 'dev_inbox' from public.app_operator_features f where f.feature = 'calls';

-- 사후 확인: 운영자 표는 RLS 켜짐·정책 없음·authenticated·anon·service_role·PUBLIC 권한 없음 그대로,
-- dev_inbox 행은 calls 행과 같은 작업공간 1행. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_operator_features'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from public.app_operator_features where feature = 'dev_inbox') <> 1
     or (select count(*) from public.app_operator_features d join public.app_operator_features c
           on c.workspace_id = d.workspace_id and c.feature = 'calls' where d.feature = 'dev_inbox') <> 1 then
    raise exception 'DEV_INBOX_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261103100000', 'dev_inbox_feature', array['S48-49 WEEKLY-개발후보연결 D2: operator feature dev_inbox added to app_operator_features_feature_check and seeded only for the single calls workspace; no grants, policies, functions or table changes']);
commit;
