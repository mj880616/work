begin;
-- HWP-노조서식분류 ④(요청함 11/16 07:26, 명진): [노조 서식으로 만들기]의 상급단체 전용 문서 규칙(ai-assist hwp_convert 프롬프트)은
-- 서버 허용 표에 있는 작업공간에만 쓴다. 나머지 작업공간은 같은 기능을 '노동조합 문서' 일반 규칙으로 쓴다(올린 서식 파일의 스타일을 따름).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
--  1) 운영자 기능 키에 'ppwu_forms'를 더한다(검사 지우고 같은 이름으로 다시 만듦 — 앞 단계 20261113230000의 키 아홉은 그대로).
--  2) 허용 행은 넣지 않는다. 누구에게 줄지는 커맨드센터가 SQL로만 넣는다(이름·메일·고정 id를 저장소에 쓰지 않음).
--     Edge(ai-assist)는 기존 app_my_features() 답으로 판정한다(새 함수 없음). 행이 없으면 모두 일반 규칙(닫힌 쪽).
-- 권한: 바꾸지 않는다. app_operator_features는 RLS 켬·정책 없음·API 역할 권한 없음 그대로. 새 표·함수·정책·트리거·권한 없음.
-- 안 하는 것: 기존 허용 행·함수·정책·권한 변경, 앱 표 변경, rtw_* 객체.
-- 짝: docs/20261116030000_ppwu_forms_feature.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261116030000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261113230000' and name = 'arsenal_outside_features') <> 1
     or to_regclass('public.app_operator_features') is null
     or to_regprocedure('public.app_my_features()') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''outside''' and pg_get_constraintdef(oid) !~ '''ppwu_forms''') <> 1
     or exists (select 1 from public.app_operator_features
                 where feature not in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside')) then
    raise exception 'PPWU_FORMS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms'));

-- 사후 확인: 운영자 표는 RLS 켜짐·정책 없음·authenticated·anon·service_role·PUBLIC 권한 없음 그대로, ppwu_forms 행은 아직 0. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_operator_features'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or exists (select 1 from public.app_operator_features where feature = 'ppwu_forms') then
    raise exception 'PPWU_FORMS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261116030000', 'ppwu_forms_feature', array['HWP-노조서식분류: operator feature key ppwu_forms added to app_operator_features_feature_check; no allow rows, grants, policies, functions or table changes']);
commit;
