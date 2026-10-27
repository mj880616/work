begin;
-- TG-1시간수집 1단계 DB (명진 10/28 00:51 "추천대로"): 텔레그램 소식을 1시간마다 보내면서 '그날 요약'은 그때까지 모인 소식으로 다시 쓴다.
-- 서버(collector-feed)는 새 메시지에서만 소식을 고르고, 그 방·그날 앞서 저장된 소식(제목·요약)을 재료에 붙여 그날 요약을 다시 쓴다.
-- 소식 표는 service_role에 제목·요약 읽기 권한이 없으므로(20261024140000) 표 권한을 넓히지 않고, 읽기 전용 함수 하나만 service_role에 연다.
--   public.app_feed_room_day_context(p_workspace, p_room_key, p_day) -> jsonb 배열 [{at, title, summary}]
--   텔레그램 소식 중 그 방·그날 것, 지운(hidden_at) 소식은 빼고, 시각 순 앞 40개. summary는 앞 200자까지만. 원문·조직·프로젝트·ID는 돌려주지 않는다.
-- SECURITY DEFINER, 빈 search_path, 실행권은 service_role만(PUBLIC·anon·authenticated 회수). 읽기만 하고 아무것도 쓰지 않는다.
-- 안 하는 것: 표 grant·정책 변경, 기존 함수 변경, 표 생성, 기존 줄 변경, rtw_* 객체.
-- 앞 단계: 20261024140000(call_tg_feed)이 먼저 적용돼 있어야 한다.
-- 짝: docs/20261028030000_tg_room_day_context.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028030000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024140000' and name = 'call_tg_feed') <> 1
     or to_regclass('public.app_feed_items') is null
     or to_regprocedure('public.app_feed_room_day_context(uuid,text,date)') is not null then
    raise exception 'TG_ROOM_DAY_CONTEXT_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create function public.app_feed_room_day_context(p_workspace uuid, p_room_key text, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_workspace is null or p_day is null or p_room_key is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TG_CONTEXT_ARGS';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('at', x.occurred_at, 'title', x.title, 'summary', pg_catalog.left(x.summary, 200)) order by x.occurred_at, x.id)
    from (
      select i.id, i.occurred_at, i.title, i.summary
      from public.app_feed_items i
      where i.workspace_id = p_workspace and i.source = 'telegram' and i.room_key = p_room_key and i.day = p_day and i.hidden_at is null
      order by i.occurred_at, i.id
      limit 40
    ) x
  ), '[]'::jsonb);
end
$$;

revoke all on function public.app_feed_room_day_context(uuid, text, date) from public, anon, authenticated, service_role;
grant execute on function public.app_feed_room_day_context(uuid, text, date) to service_role;

do $$
begin
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_feed_room_day_context(uuid,text,date)')
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=')
     or not has_function_privilege('service_role', 'public.app_feed_room_day_context(uuid,text,date)', 'execute')
     or has_function_privilege('anon', 'public.app_feed_room_day_context(uuid,text,date)', 'execute')
     or has_function_privilege('authenticated', 'public.app_feed_room_day_context(uuid,text,date)', 'execute') then
    raise exception 'TG_ROOM_DAY_CONTEXT_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261028030000', 'tg_room_day_context', array['TG-1시간수집: read-only SECURITY DEFINER function app_feed_room_day_context (empty search_path, service_role execute only, returns time/title/summary of non-hidden telegram items for one room and day, 40 max); no table grants or policies changed, no new tables']);
commit;
