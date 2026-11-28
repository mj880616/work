begin;
-- BRIEF-품질올리기 ①(DB). 사용자 2026-11-28 "클로드가 해 준 게 훨씬 낫거든. 이 정도 수준으로 받긴 어려울까?" → "ㄱ / 명진 것만 잘되면 돼".
-- 무엇:
--  1) 운영자 기능 키에 'brief_plus'(브리핑 요약에 근거 위치·쟁점·문서 안 불일치·배경 지식 칸, 마지막 정리만 더 깊게)를 더한다
--     (검사 지우고 같은 이름으로 다시 만듦 — 앞 단계 20261128100000_mcp_claude_write의 키 열은 그대로).
--  2) 허용 행은 '통화(calls)가 허용된 작업공간이 정확히 하나일 때'만 그 작업공간에 1행(고정 id·이름·메일 없음, photo_content·mcp_write와 같은 방식).
-- 쓰는 곳: Edge document-actions의 브리핑 길이 로그인 토큰으로 app_my_features()를 읽어 키가 있을 때만 새 지시·새 칸을 쓴다.
--   키가 없는 작업공간은 지금과 똑같다(모델·지시·비용 그대로). 화면은 같은 답으로 '쟁점 관점' 메뉴를 그릴지만 정한다(화면 판단은 편의일 뿐).
-- 권한: 바꾸지 않는다. app_operator_features는 RLS 켬·정책 없음·API 역할 권한 없음 그대로. 새 표·함수·정책·트리거·권한 없음.
-- 안 하는 것: 기존 허용 행·함수·정책·권한 변경, 앱 표 변경, rtw_* 객체.
-- 짝: docs/20261128130000_brief_plus_feature.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261128130000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261128100000' and name = 'mcp_claude_write') <> 1
     or to_regclass('public.app_operator_features') is null
     or to_regprocedure('public.app_my_features()') is null
     or to_regprocedure('public.app_operator_feature_workspace(text)') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''mcp_write''' and pg_get_constraintdef(oid) !~ '''brief_plus''') <> 1
     or exists (select 1 from public.app_operator_features
                 where feature not in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words', 'blog', 'photo_content', 'mcp_write')) then
    raise exception 'BRIEF_PLUS_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from public.app_operator_features where feature = 'calls') <> 1 then
    raise exception 'BRIEF_PLUS_SEED_WORKSPACE_NOT_SINGLE; stop';
  end if;
end
$$;

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words', 'blog', 'photo_content', 'mcp_write', 'brief_plus'));
insert into public.app_operator_features (workspace_id, feature)
  select f.workspace_id, 'brief_plus' from public.app_operator_features f where f.feature = 'calls';

-- 사후 확인: 운영자 표는 RLS 켜짐·정책 없음·API 역할·PUBLIC 권한 없음 그대로, brief_plus 행은 calls 작업공간 하나뿐. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_operator_features'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from public.app_operator_features where feature = 'brief_plus') <> 1
     or not exists (select 1 from public.app_operator_features p join public.app_operator_features c
                     on c.workspace_id = p.workspace_id and c.feature = 'calls' where p.feature = 'brief_plus') then
    raise exception 'BRIEF_PLUS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261128130000', 'brief_plus_feature', array['BRIEF-quality: operator feature key brief_plus (brief room evidence, issues, in-document mismatches, deeper final merge) added to app_operator_features_feature_check; one allow row for the single calls workspace; no grants, policies, functions or table changes']);
commit;
