begin;
-- TG-발언자이름 결정 3 변경(10/27): 서버(collector-feed)가 AI 재료에 보낸 사람 표시 이름을 넣으려고 그 방·그날 라벨별 이름을 읽어야 한다.
-- 두 표는 service_role 표 권한이 없으므로(20261026190000) 표 권한을 넓히지 않고, 읽기 전용 함수 하나만 service_role에 연다.
--   public.app_tg_sender_names_for_day(p_workspace, p_room_key, p_day) -> jsonb 배열 [{label, name, is_self}]
--   name = 명진이 붙인 이름(app_tg_senders.name, 없으면 null), is_self = 본인 표시. 자동 이름(auto_name)·열쇠(sender_key)·사람 id는 돌려주지 않는다.
-- SECURITY DEFINER, 빈 search_path, 실행권은 service_role만(PUBLIC·anon·authenticated 회수). 읽기만 하고 아무것도 쓰지 않는다.
-- 안 하는 것: 표 grant·정책 변경, 기존 함수 변경, 표 생성, 기존 줄 변경, rtw_* 객체.
-- 앞 단계: 20261026190000(tg_sender_names)이 먼저 적용돼 있어야 한다.
-- 짝: docs/20261027030000_tg_sender_names_read.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261027030000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261026190000' and name = 'tg_sender_names') <> 1
     or to_regclass('public.app_tg_senders') is null
     or to_regclass('public.app_tg_day_senders') is null
     or to_regprocedure('public.app_tg_sender_names_for_day(uuid,text,date)') is not null then
    raise exception 'TG_SENDER_NAMES_READ_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create function public.app_tg_sender_names_for_day(p_workspace uuid, p_room_key text, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_workspace is null or p_day is null or p_room_key is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TG_SENDER_ARGS';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('label', l.label, 'name', s.name, 'is_self', s.is_self) order by l.label)
    from public.app_tg_day_senders l
    join public.app_tg_senders s on s.workspace_id = l.workspace_id and s.id = l.sender_id
    where l.workspace_id = p_workspace and l.room_key = p_room_key and l.day = p_day
  ), '[]'::jsonb);
end
$$;

revoke all on function public.app_tg_sender_names_for_day(uuid, text, date) from public, anon, authenticated, service_role;
grant execute on function public.app_tg_sender_names_for_day(uuid, text, date) to service_role;

do $$
begin
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_tg_sender_names_for_day(uuid,text,date)')
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=')
     or not has_function_privilege('service_role', 'public.app_tg_sender_names_for_day(uuid,text,date)', 'execute')
     or has_function_privilege('anon', 'public.app_tg_sender_names_for_day(uuid,text,date)', 'execute')
     or has_function_privilege('authenticated', 'public.app_tg_sender_names_for_day(uuid,text,date)', 'execute') then
    raise exception 'TG_SENDER_NAMES_READ_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261027030000', 'tg_sender_names_read', array['TG-발언자이름 결정 3 변경: read-only SECURITY DEFINER function app_tg_sender_names_for_day (empty search_path, service_role execute only, returns label/hand name/is_self for one room and day); no table grants or policies changed, no new tables']);
commit;
