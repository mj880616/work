begin;
-- CALL-맥락사람 DB (명진 10/26 12:35 "넓혀": 고친 사람-조직 연결을 다음 통화 요약에 자동 반영).
-- 통화 분석 스크립트의 '통화 요약용 맥락' 문서 자동 구간에 "조직 — 이름 직함" 목록을 넣기 위해, 서버 입구 collector-feed(service_role)가
-- 읽을 수 있는 가장 좁은 길을 하나 만든다: 읽기 전용 함수 하나. 표나 칸의 읽기 권한을 서버에 열지 않는다(함수가 더 좁아서 함수로 한다).
--   public.app_call_context_people(p_workspace uuid, p_limit integer default 300)
--     돌려주는 칸 넷뿐: organization_name(조직 정식 이름) · organization_aliases(조직 약칭) · counterpart(상대 글 '조직 이름 직함') · user_edited(명진이 고친 값인가).
--     번호·메모·통화 제목·요약·핵심내용·전문·드라이브 주소·통화 ID·조직 ID는 돌려주지 않는다.
--     재료: 업무 통화함 app_feed_items(source='call', 지우기 표시 없음)의 AI 값 + app_call_edits(명진이 고친 값, 있으면 그 칸은 고친 값이 앞선다).
--     개인 통화함(app_call_personal)은 읽지 않는다. 같은 (조직, 상대 글)은 한 줄로 합치고, 고친 값 → 최근 통화 순서로 p_limit(1~500)줄까지.
--     조직은 같은 작업공간의 지우지 않은·쓰는 담당조직만 이름을 붙인다(아니면 조직 칸이 비어 나온다).
--   SECURITY DEFINER, 빈 search_path, 실행은 service_role 하나뿐(anon·authenticated·PUBLIC 실행 없음). 로그인한 화면은 이 함수를 부르지 못한다.
-- 안 하는 것: 새 표·칸·정책·트리거, 기존 표(app_feed_items, app_call_personal, app_call_edits)의 권한·정책 변경, 기존 함수 교체, anon·PUBLIC 권한, RLS 약화, rtw_* 객체.
-- 앞 단계: 20261026120000(call_user_edit)가 먼저 적용돼 있어야 한다.
-- 짝: docs/20261026160000_call_context_people.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026160000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261026120000' and name = 'call_user_edit') <> 1
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_call_edits') is null
     or to_regclass('public.app_suborganizations') is null
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_suborganizations') and not attisdropped
         and attname in ('name', 'aliases', 'active', 'deleted_at')) <> 4
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_feed_items') and not attisdropped
         and attname in ('workspace_id', 'source', 'counterpart', 'organization_id', 'hidden_at', 'occurred_at')) <> 6
     or to_regprocedure('public.app_call_context_people(uuid,integer)') is not null then
    raise exception 'CALL_CONTEXT_PEOPLE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create function public.app_call_context_people(p_workspace uuid, p_limit integer default 300)
returns table (organization_name text, organization_aliases text[], counterpart text, user_edited boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with calls as (
    select
      i.occurred_at,
      case when pg_catalog.jsonb_exists(e.vals, 'counterpart') then pg_catalog.btrim(e.vals ->> 'counterpart')
           else pg_catalog.btrim(i.counterpart) end as cp,
      case when pg_catalog.jsonb_exists(e.vals, 'organization_id')
             then case when pg_catalog.jsonb_typeof(e.vals -> 'organization_id') = 'string'
                        and (e.vals ->> 'organization_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then (e.vals ->> 'organization_id')::uuid end
           else i.organization_id end as org_id,
      (pg_catalog.jsonb_exists(e.vals, 'counterpart') or pg_catalog.jsonb_exists(e.vals, 'organization_id')) as edited
    from public.app_feed_items i
    left join public.app_call_edits e on e.call_id = i.id and e.workspace_id = i.workspace_id
    where i.workspace_id = p_workspace and i.source = 'call' and i.hidden_at is null
  ),
  named as (
    select distinct on (o.id, pg_catalog.lower(c.cp))
      o.name as organization_name, o.aliases as organization_aliases, c.cp as counterpart, coalesce(c.edited, false) as user_edited, c.occurred_at
    from calls c
    left join public.app_suborganizations o
      on o.id = c.org_id and o.workspace_id = p_workspace and o.deleted_at is null and o.active is not false
    where c.cp is not null and c.cp <> ''
    order by o.id, pg_catalog.lower(c.cp), coalesce(c.edited, false) desc, c.occurred_at desc
  )
  select n.organization_name, coalesce(n.organization_aliases, '{}'::text[]), n.counterpart, n.user_edited
  from named n
  order by n.user_edited desc, n.occurred_at desc
  limit least(greatest(coalesce(p_limit, 300), 1), 500)
$$;
revoke all on function public.app_call_context_people(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.app_call_context_people(uuid, integer) to service_role;

do $$
begin
  if (select count(*) from pg_proc where oid = to_regprocedure('public.app_call_context_people(uuid,integer)')
         and prosecdef and provolatile = 's' and proconfig = array['search_path=""']
         and has_function_privilege('service_role', oid, 'execute')
         and not has_function_privilege('authenticated', oid, 'execute')
         and not has_function_privilege('anon', oid, 'execute')
         and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 1 then
    raise exception 'CALL_CONTEXT_PEOPLE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261026160000', 'call_context_people', array['CALL-맥락사람: one read-only function app_call_context_people(uuid, integer) returning organization name, aliases, counterpart text and an edited flag from business calls (user edits first); SECURITY DEFINER, empty search_path, execute to service_role only; no new table, column, policy, trigger or grant on existing tables']);
commit;
