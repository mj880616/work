begin;
-- TODO-내일만 3(10/29 커맨드센터 확인: app_tg_senders에 is_self=true 줄 0개): 텔레그램 보낸 사람 이름표에서 "이 사람이 나"를 직접 표시하는 길.
-- 사실: is_self는 지금까지 수집기(저장소 밖)가 메시지 json에 sender_is_self를 적어야만 채워졌다(app_tg_senders_upsert). 화면에서 고칠 길은 없었다.
-- 이 migration은 화면용 함수 1개만 만든다. 기존 표·칸·정책·권한·함수·자료는 바꾸지 않는다.
--   app_tg_sender_set_self(p_id uuid, p_self boolean) -> jsonb {ok, changed, id, is_self, keyed}
--   로그인한 본인이 소유자인 작업공간의 사람 한 줄의 is_self만 바꾼다(merge·forget과 같은 소유자 확인). 다른 칸은 손대지 않는다.
--   SECURITY DEFINER, 빈 search_path, 실행권 authenticated만(PUBLIC·anon·service_role 회수).
-- 서버(collector-feed)는 이미 app_tg_sender_names_for_day의 is_self로 '나'를 가려 '내가 부탁한 일'을 챙길 것 후보에서 뺀다. 이 표시가 그 재료가 된다.
-- 안 하는 것: 표 권한·정책·RLS 변경, 기존 함수 교체, 기존 줄 변경, anon·PUBLIC 권한, rtw_* 객체.
-- 앞 단계: 20261026190000(tg_sender_names)이 적용돼 있어야 한다.
-- 짝: docs/20261029233000_tg_sender_set_self.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029233000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261026190000' and name = 'tg_sender_names') <> 1
     or to_regclass('public.app_tg_senders') is null
     or to_regprocedure('public.app_tg_sender_set_self(uuid,boolean)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'TG_SENDER_SELF_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create function public.app_tg_sender_set_self(p_id uuid, p_self boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  n integer;
begin
  if p_id is null or p_self is null then
    raise exception using errcode = '22023', message = 'TG_SENDER_ARGS';
  end if;
  select s.workspace_id into ws from public.app_tg_senders s where s.id = p_id;
  if ws is null or not private.app_is_workspace_owner(ws) then
    raise exception using errcode = 'P0002', message = 'TG_SENDER_NOT_FOUND';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_tg_senders:' || ws::text, 0));
  update public.app_tg_senders s set is_self = p_self, updated_at = pg_catalog.now()
    where s.id = p_id and s.workspace_id = ws and s.is_self is distinct from p_self;
  get diagnostics n = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'changed', n > 0, 'id', p_id, 'is_self', p_self,
    'keyed', (select s.sender_key is not null from public.app_tg_senders s where s.id = p_id and s.workspace_id = ws));
end
$$;

revoke all on function public.app_tg_sender_set_self(uuid, boolean) from public, anon, service_role;
grant execute on function public.app_tg_sender_set_self(uuid, boolean) to authenticated;

do $$
begin
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_tg_sender_set_self(uuid,boolean)')
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=')
     or not has_function_privilege('authenticated', 'public.app_tg_sender_set_self(uuid,boolean)', 'execute')
     or has_function_privilege('anon', 'public.app_tg_sender_set_self(uuid,boolean)', 'execute')
     or has_function_privilege('service_role', 'public.app_tg_sender_set_self(uuid,boolean)', 'execute') then
    raise exception 'TG_SENDER_SELF_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029233000', 'tg_sender_set_self', array['TODO-내일만 3: SECURITY DEFINER function app_tg_sender_set_self (empty search_path, authenticated execute only with workspace owner check inside, PUBLIC/anon/service_role revoked) that changes only is_self of one app_tg_senders row; no table grants, policies or existing functions changed, no rows changed']);
commit;
