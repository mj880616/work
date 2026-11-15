begin;
-- CALL-TG 보정: collector-feed(service_role)가 app_feed_items에 넣을 때 운영 DB가 `42501 permission denied for schema private`로 거절하는 문제.
-- 원인(운영 로그 2026-10-24 15:53:21Z + 저장소 확인): 넣기 트리거 함수 private.app_feed_item_guard()가 private.app_space_in_workspace()를 이름으로 불러
--   schema private의 이름 해석(USAGE)이 필요한데, service_role에는 schema private USAGE가 없다(authenticated에만 있음). 로컬 시험 틀은 둘 다에 USAGE를 줘서 못 잡았다.
--   트리거 발화 자체는 schema USAGE가 필요 없다(함수는 OID로 부른다). 막히는 곳은 함수 안의 private.* 호출뿐이다.
-- 고침(권한 확대 없음): 트리거 함수 하나를 같은 서명으로 교체한다. 다른 private 함수를 부르지 않고 같은 검사를 public 표를 직접 읽어 한다.
--   INVOKER·search_path 빈칸 유지, 실행권은 그대로(모두 회수). schema private USAGE를 service_role에 주지 않는다. 표·정책·칸 권한 변경 없음.
--   검사 내용은 그대로: 전문(raw_text)은 비우기만, 연결한 조직·프로젝트(project_id·suggested_project_id·organization_id)는 같은 작업공간만.
--   service_role은 RLS를 건너뛰고, 두 역할 모두 app_spaces(id, workspace_id)·app_suborganizations(id, workspace_id) 칸 읽기 권한이 필요하다(사전·사후 확인에 넣음).
--   authenticated는 이제 RLS가 걸린 읽기로 확인한다(owner 본인 작업공간 행만 보임 — 다른 작업공간 연결 거절은 그대로).
-- collector-feed가 쓰는 표 전체 확인: 다른 private.* 호출 트리거·기본값은 없다(app_feed_days는 트리거·함수 기본값 없음, app_feed_items 트리거는 이 하나뿐).
-- 적용: 승인형 DB workflow(확장 규칙, 함수 1개 교체) 또는 SQL Editor(폰 경로 C). 되돌리기는 짝 rollback(SQL Editor).
-- 짝: docs/20261024210000_feed_item_guard_public.{precheck,snapshot,postcheck,rollback}.sql·.summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 앞 단계가 없거나, 이미 적용됐거나, 함수·권한이 예상 모양이 아니면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024210000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024140000' and name = 'call_tg_feed') <> 1
     or to_regclass('public.app_feed_items') is null
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_feed_item_guard()')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc like '%private.app_space_in_workspace%') <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_feed_items'::regclass and not tgisinternal and tgname = 'app_feed_items_guard') <> 1
     or not has_column_privilege('service_role', 'public.app_spaces', 'id', 'select')
     or not has_column_privilege('service_role', 'public.app_spaces', 'workspace_id', 'select')
     or not has_column_privilege('service_role', 'public.app_suborganizations', 'id', 'select')
     or not has_column_privilege('service_role', 'public.app_suborganizations', 'workspace_id', 'select')
     or not has_column_privilege('authenticated', 'public.app_spaces', 'id', 'select')
     or not has_column_privilege('authenticated', 'public.app_spaces', 'workspace_id', 'select')
     or not has_column_privilege('authenticated', 'public.app_suborganizations', 'id', 'select')
     or not has_column_privilege('authenticated', 'public.app_suborganizations', 'workspace_id', 'select') then
    raise exception 'FEED_GUARD_PUBLIC_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 같은 검사, private 호출 없음. 연결이 없으면(null) 통과, 있으면 같은 작업공간 표 행이 있어야 통과.
create or replace function private.app_feed_item_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if tg_op = 'UPDATE' and new.raw_text is distinct from old.raw_text and new.raw_text is not null then
    raise exception using errcode = '23514', message = 'FEED_RAW_TEXT_CLEAR_ONLY: the stored copy can only be cleared';
  end if;
  if (new.project_id is not null and not exists (
       select 1 from public.app_spaces s
       where s.id = new.project_id and s.workspace_id = new.workspace_id))
     or (new.suggested_project_id is not null and not exists (
       select 1 from public.app_spaces s
       where s.id = new.suggested_project_id and s.workspace_id = new.workspace_id))
     or (new.organization_id is not null and not exists (
       select 1 from public.app_suborganizations o
       where o.id = new.organization_id and o.workspace_id = new.workspace_id)) then
    raise exception using errcode = '23514', message = 'FEED_LINK_SCOPE: linked organization or project must be in the same workspace';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_feed_item_guard() from public, anon, authenticated, service_role;

-- 마지막 확인: 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_proc where oid = to_regprocedure('private.app_feed_item_guard()')
      and not prosecdef and proconfig = array['search_path=""'] and prosrc not like '%private.%'
      and coalesce(proacl::text, '') !~ '(^|[{,])(anon|authenticated|service_role)?=') <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_feed_items'::regclass and not tgisinternal and tgname = 'app_feed_items_guard') <> 1 then
    raise exception 'FEED_GUARD_PUBLIC_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024210000', 'feed_item_guard_public', array['CALL-TG 보정: private.app_feed_item_guard() replaced in place — same checks via public tables, no private.* calls (service_role has no schema private USAGE), SECURITY INVOKER, empty search_path, no grants changed']);
commit;
