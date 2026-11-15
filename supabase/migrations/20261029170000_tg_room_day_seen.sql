begin;
-- TG-요청강조·안본것 2/3 DB (요청함 10/29 10:04 3번, 명진 10:06 '추천대로'): 텔레그램 소식의 방·날을 '봤음'으로 서버에 남긴다(기기 저장 금지).
-- 새 표를 만들지 않고 이미 있는 방·날 표 public.app_feed_room_days(20261027010000)에 칸 하나를 더한다:
--   seen_at timestamptz (null = 아직 안 열어 봄). 화면은 '그 방·날의 마지막 소식 시각(last_at) > seen_at'이면 안 본 것으로 본다(새 소식이 오면 다시 안 본 것).
--   이 표에는 이미 소유자 읽기 정책(feed_room_days_owner_read) + 운영자 판정 restrictive 읽기 정책(op_feature_read, 'telegram')과
--   넣기·고치기 트리거(trg_op_feature_guard, 'telegram')가 걸려 있어 새 칸도 같은 판정을 받는다(정책·트리거·권한은 바꾸지 않음).
--   표 권한은 authenticated 읽기뿐(표 단위 select라 새 칸도 읽힘), 쓰기 권한은 없고 쓰기는 아래 DEFINER 함수로만 한다.
-- 새 함수 하나(SECURITY DEFINER, 빈 search_path, PUBLIC·anon·service_role 실행권 없음, authenticated만):
--   public.app_feed_room_day_seen(p_room_key, p_day) -> jsonb {ok, room_key, day, seen_at}
--   - 작업공간은 로그인한 본인이 owner인 하나(private.app_feed_owner_workspace, 클라이언트가 보낸 id를 믿지 않음).
--   - 그 작업공간에 텔레그램 기능이 허용돼 있어야 한다(private.app_workspace_has_feature, 트리거도 한 번 더 막음).
--   - 그 방·날의 지우지 않은 텔레그램 소식이 있어야 한다(없는 방·날 지어내기 방지).
--   - 줄이 없으면 seen_at만 든 줄을 넣고(요약 묶음은 빈 배열 기본값), 있으면 seen_at만 지금으로 고친다(요약·숨김·updated_at은 그대로).
-- 안 하는 것: 새 표, 기존 정책·권한·트리거·함수 변경, 기존 줄 내용 변경, anon·PUBLIC 권한, RLS 약화, rtw_* 객체, 옛 소식을 한꺼번에 '봤음'으로 바꾸기.
-- 앞 단계: 20261027010000(tg_room_day_group)·20261029090000(operator_features)이 먼저 적용돼 있어야 한다.
-- 짝: docs/20261029170000_tg_room_day_seen.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029170000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261027010000' and name = 'tg_room_day_group') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or to_regclass('public.app_feed_room_days') is null
     or to_regclass('public.app_feed_items') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_feed_room_days') and attname = 'seen_at' and not attisdropped)
     or to_regprocedure('public.app_feed_room_day_seen(text,date)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_feed_owner_workspace()') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_workspace_has_feature(uuid,text)') and prosecdef)
     or (select count(*) from pg_trigger where tgrelid = to_regclass('public.app_feed_room_days') and tgname = 'trg_op_feature_guard' and not tgisinternal and tgenabled <> 'D') <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_feed_room_days') and polname = 'op_feature_read' and not polpermissive) <> 1 then
    raise exception 'TG_SEEN_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_feed_room_days add column seen_at timestamptz;

create function public.app_feed_room_day_seen(p_room_key text, p_day date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ws uuid;
  v_at timestamptz := pg_catalog.now();
begin
  if p_room_key is null or p_day is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TGDG_ARGS';
  end if;
  ws := private.app_feed_owner_workspace();
  if not private.app_workspace_has_feature(ws, 'telegram') then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_room_days:' || ws::text, 0));
  if not exists (select 1 from public.app_feed_items i
                  where i.workspace_id = ws and i.source = 'telegram' and i.room_key = p_room_key and i.day = p_day and i.hidden_at is null) then
    raise exception using errcode = 'P0002', message = 'TGDG_NOT_FOUND';
  end if;
  insert into public.app_feed_room_days as d (workspace_id, room_key, day, seen_at)
  values (ws, p_room_key, p_day, v_at)
  on conflict (workspace_id, room_key, day) do update set seen_at = excluded.seen_at
    where d.seen_at is null or d.seen_at < excluded.seen_at;
  return pg_catalog.jsonb_build_object('ok', true, 'room_key', p_room_key, 'day', p_day, 'seen_at', v_at);
end
$$;

revoke all on function public.app_feed_room_day_seen(text, date) from public, anon, authenticated, service_role;
grant execute on function public.app_feed_room_day_seen(text, date) to authenticated;

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.app_feed_room_days'::regclass and attname = 'seen_at' and not attisdropped
                   and atttypid = 'timestamptz'::regtype and not attnotnull)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_feed_room_day_seen(text,date)')
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=')
     or not has_function_privilege('authenticated', 'public.app_feed_room_day_seen(text,date)', 'execute')
     or has_function_privilege('anon', 'public.app_feed_room_day_seen(text,date)', 'execute')
     or has_function_privilege('service_role', 'public.app_feed_room_day_seen(text,date)', 'execute')
     or has_any_column_privilege('anon', 'public.app_feed_room_days'::regclass, 'select,insert,update,references')
     or has_any_column_privilege('authenticated', 'public.app_feed_room_days'::regclass, 'insert,update,references')
     or (select count(*) from pg_trigger where tgrelid = 'public.app_feed_room_days'::regclass and tgname = 'trg_op_feature_guard' and not tgisinternal and tgenabled <> 'D') <> 1 then
    raise exception 'TG_SEEN_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029170000', 'tg_room_day_seen', array['TG seen 2/3: app_feed_room_days adds nullable column seen_at; SECURITY DEFINER function app_feed_room_day_seen(text,date) (empty search_path, authenticated execute only, owner workspace from auth.uid(), telegram operator feature required, existing non-hidden telegram item required, upserts seen_at only); existing owner/restrictive policies and op-feature guard trigger cover the column; no new tables, no policy/grant/trigger changes']);
commit;
