begin;
-- TG-방고정 1/2 DB (요청함 10/30 05:35, 시안 A 확정): 텔레그램 소식의 방을 '고정'해 목록 맨 위 칸에 늘 두는 것을 서버에 남긴다(기기 저장 금지).
-- 새 표를 만들지 않고 이미 있는 방 표 public.app_feed_rooms(20261027010000, 폴더·보관을 두는 곳)에 칸 하나를 더한다:
--   pinned_at timestamptz (null = 고정 안 함). 고정한 시각이 곧 고정 순서다(먼저 고정한 방이 위). 보관한 방은 화면이 고정 칸에서 뺀다.
--   이 표에는 이미 소유자 읽기 정책(feed_rooms_owner_read) + 운영자 판정 restrictive 읽기 정책(op_feature_read, 'telegram')과
--   넣기·고치기 트리거(trg_op_feature_guard, 'telegram')가 걸려 있어 새 칸도 같은 판정을 받는다(정책·트리거·권한은 바꾸지 않음).
--   표 권한은 authenticated 읽기뿐(표 단위 select라 새 칸도 읽힘), 쓰기 권한은 없고 쓰기는 아래 DEFINER 함수로만 한다.
-- 새 함수 하나(SECURITY DEFINER, 빈 search_path, PUBLIC·anon·service_role 실행권 없음, authenticated만):
--   public.app_feed_room_pin(p_room_key, p_pinned) -> jsonb {ok, changed, room_key, pinned_at}
--   - 작업공간은 로그인한 본인이 owner인 하나(private.app_feed_owner_workspace, 클라이언트가 보낸 id를 믿지 않음).
--   - 그 작업공간에 텔레그램 기능이 허용돼 있어야 한다(private.app_workspace_has_feature, 트리거도 한 번 더 막음).
--   - 그 방의 텔레그램 소식이 있어야 한다(없는 방 지어내기 방지). 보관한 방은 고정하지 않는다(TGPIN_ARCHIVED). 고정은 20곳까지(TGPIN_LIMIT).
--   - 고정: 이미 고정이면 그대로(순서 유지), 아니면 지금 시각. 풀기: null. 방 줄이 없으면 고정할 때만 줄을 만든다(이름은 최근 소식의 방 이름).
--   - pinned_at과 updated_at만 바꾼다(폴더·보관·이름은 그대로).
-- 안 하는 것: 새 표, 기존 정책·권한·트리거·함수 변경(app_feed_room_set 포함), 기존 줄 내용 변경, anon·PUBLIC 권한, RLS 약화, rtw_* 객체.
-- 앞 단계: 20261027010000(tg_room_day_group)·20261029090000(operator_features)이 먼저 적용돼 있어야 한다.
-- 짝: docs/20261030060000_tg_room_pin.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261030060000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261027010000' and name = 'tg_room_day_group') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or to_regclass('public.app_feed_rooms') is null
     or to_regclass('public.app_feed_items') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_feed_rooms') and attname = 'pinned_at' and not attisdropped)
     or to_regprocedure('public.app_feed_room_pin(text,boolean)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_feed_owner_workspace()') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_workspace_has_feature(uuid,text)') and prosecdef)
     or (select count(*) from pg_trigger where tgrelid = to_regclass('public.app_feed_rooms') and tgname = 'trg_op_feature_guard' and not tgisinternal and tgenabled <> 'D') <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_feed_rooms') and polname = 'op_feature_read' and not polpermissive) <> 1 then
    raise exception 'TG_PIN_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_feed_rooms add column pinned_at timestamptz;

create function public.app_feed_room_pin(p_room_key text, p_pinned boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ws uuid;
  lbl text;
  cur public.app_feed_rooms;
  want timestamptz;
  changed boolean := false;
begin
  if p_room_key is null or p_pinned is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TGDG_ARGS';
  end if;
  ws := private.app_feed_owner_workspace();
  if not private.app_workspace_has_feature(ws, 'telegram') then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_rooms:' || ws::text, 0));
  select i.room_label into lbl from public.app_feed_items i
    where i.workspace_id = ws and i.source = 'telegram' and i.room_key = p_room_key
    order by i.occurred_at desc limit 1;
  if not found then
    raise exception using errcode = 'P0002', message = 'TGDG_NOT_FOUND';
  end if;
  select * into cur from public.app_feed_rooms r where r.workspace_id = ws and r.room_key = p_room_key;
  if p_pinned then
    if cur.archived_at is not null then
      raise exception using errcode = '22023', message = 'TGPIN_ARCHIVED';
    end if;
    want := coalesce(cur.pinned_at, pg_catalog.now());
    if cur.pinned_at is null and (select count(*) from public.app_feed_rooms r
         where r.workspace_id = ws and r.pinned_at is not null and r.archived_at is null) >= 20 then
      raise exception using errcode = '22023', message = 'TGPIN_LIMIT';
    end if;
  end if;
  if cur.room_key is null then
    if p_pinned then
      insert into public.app_feed_rooms (workspace_id, room_key, room_label, pinned_at) values (ws, p_room_key, lbl, want);
      changed := true;
    end if;
  elsif cur.pinned_at is distinct from want then
    update public.app_feed_rooms r set pinned_at = want, updated_at = pg_catalog.now()
      where r.workspace_id = ws and r.room_key = p_room_key;
    changed := true;
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'changed', changed, 'room_key', p_room_key, 'pinned_at', want);
end
$$;

revoke all on function public.app_feed_room_pin(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.app_feed_room_pin(text, boolean) to authenticated;

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.app_feed_rooms'::regclass and attname = 'pinned_at' and not attisdropped
                   and atttypid = 'timestamptz'::regtype and not attnotnull)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_feed_room_pin(text,boolean)')
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=')
     or not has_function_privilege('authenticated', 'public.app_feed_room_pin(text,boolean)', 'execute')
     or has_function_privilege('anon', 'public.app_feed_room_pin(text,boolean)', 'execute')
     or has_function_privilege('service_role', 'public.app_feed_room_pin(text,boolean)', 'execute')
     or has_any_column_privilege('anon', 'public.app_feed_rooms'::regclass, 'select,insert,update,references')
     or has_any_column_privilege('authenticated', 'public.app_feed_rooms'::regclass, 'insert,update,references')
     or (select count(*) from pg_trigger where tgrelid = 'public.app_feed_rooms'::regclass and tgname = 'trg_op_feature_guard' and not tgisinternal and tgenabled <> 'D') <> 1 then
    raise exception 'TG_PIN_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261030060000', 'tg_room_pin', array['TG room pin 1/2: app_feed_rooms adds nullable column pinned_at (pin time = pin order); SECURITY DEFINER function app_feed_room_pin(text,boolean) (empty search_path, authenticated execute only, owner workspace from auth.uid(), telegram operator feature required, existing telegram room required, archived rooms refused, at most 20 pins, changes pinned_at and updated_at only); existing owner/restrictive policies and op-feature guard trigger cover the column; no new tables, no policy/grant/trigger changes']);
commit;
