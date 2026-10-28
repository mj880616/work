begin;
-- FEAT-1029묶음 ⑤ 1단계 DB(docs/design/feature-bundle-1029.md 5.2~5.4절, 명진 결정 10/29 5-①·5-②·5-③):
-- 텔레그램에서 '나한테 온 요청'을 챙길 것 후보로 올릴 수 있게 한다.
--  1) 후보 표 출처 종류 검사(app_todo_candidates_source_kind_check)에 'telegram'을 더한다. 기존 6개 출처는 그대로다.
--  2) 서버(collector-feed, service_role)가 후보 한 줄을 넣는 함수 1개:
--     public.app_todo_candidate_from_telegram(p_workspace, p_feed_item, p_summary, p_evidence, p_due) -> text('added'|'exists')
--     - 후보 표는 service_role에 권한이 없으므로(20261021075034) 표 권한을 넓히지 않고 이 함수만 service_role에 연다.
--     - 그 작업공간의 텔레그램 소식(지우지 않은 것)이 있어야 넣는다. 출처 날짜·조직은 소식 줄에서 읽는다(서버가 정하지 못함).
--     - 늘 kind=request, status=open으로 넣는다. 할 일로 넣기·무시는 명진이 화면에서 누른다(자동 할 일 없음).
--     - 같은 소식은 한 번만(dedupe_key = 'tg:' || 소식 id, 기존 유일 열쇠). 다시 오면 'exists'.
--     - 요약 1~100자·근거 200자 이하·제어문자 없음(표 검사와 같음)을 먼저 확인한다.
-- SECURITY DEFINER, 빈 search_path, 실행권은 service_role만(PUBLIC·anon·authenticated 회수).
-- 안 하는 것: 표 grant·정책 변경, 소식 표 변경, 기존 후보 줄 변경, 새 표, rtw_* 객체.
-- 앞 단계: 20261021075034(todo_radar_candidates)·20261024140000(call_tg_feed)이 먼저 적용돼 있어야 한다.
-- 짝: docs/20261029120000_todo_candidates_telegram.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 검사식을 바꾸는 동안 다른 저장이 끼어들지 않게 쓰기만 잠근다(읽기는 그대로).
lock table public.app_todo_candidates in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029120000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261021075034' and name = 'todo_radar_candidates') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024140000' and name = 'call_tg_feed') <> 1
     or to_regclass('public.app_todo_candidates') is null
     or to_regclass('public.app_feed_items') is null
     or to_regprocedure('public.app_todo_candidate_from_telegram(uuid,uuid,text,text,date)') is not null
     -- 지금 검사식이 앞 단계 그대로(6개 출처)여야 한다.
     or (select count(*) from pg_constraint where conrelid = to_regclass('public.app_todo_candidates')
         and conname = 'app_todo_candidates_source_kind_check'
         and pg_get_constraintdef(oid) like '%basket%' and pg_get_constraintdef(oid) like '%project_update%'
         and pg_get_constraintdef(oid) not like '%telegram%') <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_todo_candidates')) <> 1 then
    raise exception 'TODO_TG_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_todo_candidates drop constraint app_todo_candidates_source_kind_check;
alter table public.app_todo_candidates add constraint app_todo_candidates_source_kind_check check (
  source_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update', 'telegram'));

create function public.app_todo_candidate_from_telegram(p_workspace uuid, p_feed_item uuid, p_summary text, p_evidence text, p_due date)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day date;
  v_org uuid;
  v_summary text := pg_catalog.btrim(coalesce(p_summary, ''));
  v_evidence text := pg_catalog.btrim(coalesce(p_evidence, ''));
  v_id uuid;
begin
  if p_workspace is null or p_feed_item is null
     or pg_catalog.char_length(v_summary) not between 1 and 100 or v_summary ~ '[[:cntrl:]]'
     or pg_catalog.char_length(v_evidence) > 200 or v_evidence ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'TODO_TG_ARGS';
  end if;
  select i.day, i.organization_id into v_day, v_org
    from public.app_feed_items i
    where i.id = p_feed_item and i.workspace_id = p_workspace and i.source = 'telegram' and i.hidden_at is null;
  if v_day is null then
    raise exception using errcode = '22023', message = 'TODO_TG_SOURCE';
  end if;
  insert into public.app_todo_candidates (workspace_id, kind, summary, due, source_kind, source_id, source_day, evidence, dedupe_key, organization_id)
    values (p_workspace, 'request', v_summary, p_due, 'telegram', p_feed_item, v_day, v_evidence, 'tg:' || p_feed_item::text, v_org)
    on conflict (workspace_id, dedupe_key) do nothing
    returning id into v_id;
  return case when v_id is null then 'exists' else 'added' end;
end
$$;

revoke all on function public.app_todo_candidate_from_telegram(uuid, uuid, text, text, date) from public, anon, authenticated, service_role;
grant execute on function public.app_todo_candidate_from_telegram(uuid, uuid, text, text, date) to service_role;

do $$
begin
  if (select count(*) from pg_constraint where conrelid = 'public.app_todo_candidates'::regclass
      and conname = 'app_todo_candidates_source_kind_check' and pg_get_constraintdef(oid) like '%telegram%' and convalidated) <> 1
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_todo_candidate_from_telegram(uuid,uuid,text,text,date)')
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=')
     or not has_function_privilege('service_role', 'public.app_todo_candidate_from_telegram(uuid,uuid,text,text,date)', 'execute')
     or has_function_privilege('anon', 'public.app_todo_candidate_from_telegram(uuid,uuid,text,text,date)', 'execute')
     or has_function_privilege('authenticated', 'public.app_todo_candidate_from_telegram(uuid,uuid,text,text,date)', 'execute')
     or has_any_column_privilege('service_role', 'public.app_todo_candidates'::regclass, 'select,insert,update,references')
     or has_any_column_privilege('anon', 'public.app_todo_candidates'::regclass, 'select,insert,update,references')
     or (select count(*) from pg_policy where polrelid = 'public.app_todo_candidates'::regclass) <> 1 then
    raise exception 'TODO_TG_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029120000', 'todo_candidates_telegram', array['FEAT-1029 5: app_todo_candidates source_kind check adds telegram; SECURITY DEFINER function app_todo_candidate_from_telegram (empty search_path, service_role execute only, inserts one open request candidate from a non-hidden telegram feed item, dedupe tg:<id>); no table grants or policies changed, no new tables']);
commit;
