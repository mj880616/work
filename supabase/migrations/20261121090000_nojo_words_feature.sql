begin;
-- S67-62 바탕 낱말 묶음(명진 11/21 07:55 결정): 운영 빌드가 WORK ON 얼굴(girok 낱말)이 된 뒤에도, 고른 사람은 노동조합+ 낱말 전체를
-- 바탕으로 쓴다(그 위에 고친 이름 15칸). 고르는 길은 서버 허용 표뿐이다(화면에서 고르는 메뉴 없음 — 미리 만든 묶음을 남에게 보이지 않는다).
-- 화면은 기존 app_my_features() 답에 'nojo_words'가 있으면 바탕을 노동조합+ 낱말로 쓴다(app/brand/custom-words-model.mjs WORD_BASE_FEATURES).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
--  1) 운영자 기능 키에 'nojo_words'를 더한다(검사 지우고 같은 이름으로 다시 만듦 — 앞 단계 20261116030000의 키 열은 그대로).
--  2) 허용 행은 넣지 않는다. 누구에게 줄지는 커맨드센터가 SQL로만 넣는다(docs/ops/nojo-words-operator.*.sql — 이름·메일·고정 id를 저장소에 쓰지 않음).
-- 권한: 바꾸지 않는다. app_operator_features는 RLS 켬·정책 없음·API 역할 권한 없음 그대로. 새 표·함수·정책·트리거·권한 없음.
-- 안 하는 것: 기존 허용 행·함수·정책·권한 변경, 앱 표 변경, rtw_* 객체.
-- 짝: docs/20261121090000_nojo_words_feature.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261121090000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261116030000' and name = 'ppwu_forms_feature') <> 1
     or to_regclass('public.app_operator_features') is null
     or to_regprocedure('public.app_my_features()') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''ppwu_forms''' and pg_get_constraintdef(oid) !~ '''nojo_words''') <> 1
     or exists (select 1 from public.app_operator_features
                 where feature not in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms')) then
    raise exception 'NOJO_WORDS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words'));

-- 사후 확인: 운영자 표는 RLS 켜짐·정책 없음·authenticated·anon·service_role·PUBLIC 권한 없음 그대로, nojo_words 행은 아직 0. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_operator_features'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or exists (select 1 from public.app_operator_features where feature = 'nojo_words') then
    raise exception 'NOJO_WORDS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261121090000', 'nojo_words_feature', array['S67-62: operator feature key nojo_words (word base set) added to app_operator_features_feature_check; no allow rows, grants, policies, functions or table changes']);
commit;
