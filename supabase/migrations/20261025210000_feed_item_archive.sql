begin;
-- TG-카드밀기 1단계 DB (명진 결정 2026-10-25 19:56: 텔레그램 소식 카드를 밀어 [보관]·[삭제]).
-- 텔레그램 소식(app_feed_items, source='telegram') 한 줄이 가질 수 있는 상태를 셋으로 나눈다.
--   보통(archived_at, hidden_at 모두 비어 있음) / 보관(archived_at 있음, 소식 맨 위 '보관함'에서 다시 보고 되살림) /
--   삭제(hidden_at 있음 = 휴지통, 되살리기만 가능. 이 표에는 행 삭제 권한이 없고 자동 비우기도 없다).
-- 기존 hidden_at(지우기)은 그대로 '삭제' 표시로 쓴다. 새로 생기는 것은 칸 하나, 색인 하나, 함수 하나뿐이다.
--  1) 새 칸 app_feed_items.archived_at(보관한 시각). 기본값 없음, 기존 줄은 모두 비어 있다.
--  2) 상태를 바꾸는 함수 app_feed_set_state(p_id, p_state): p_state는 active·archived·trashed.
--     로그인한 소유자(private.app_is_workspace_owner)만, 텔레그램 줄만. 한 트랜잭션에서 archived_at과 hidden_at을 함께 맞춘다
--     (보관→삭제, 삭제→보관 같은 이동에서 두 칸이 동시에 차는 일이 없게). 새 칸의 쓰기 권한을 authenticated에 따로 주지 않는다
--     (기존 표에 권한 추가 없음: 쓰기는 이 함수로만). 이 파일은 기존 표의 grant·정책·CHECK·트리거를 바꾸지 않는다.
-- 서버 입구 collector-feed(service_role)는 새 칸을 넣지도 읽지도 못한다(칸 권한 그대로). 통화(call) 줄에는 이 함수가 거절한다.
-- anon·PUBLIC 권한 없음. 함수는 SECURITY DEFINER, 빈 search_path, 실행은 authenticated만.
-- 적용: 승인형 DB workflow(확장 규칙 — 칸 추가·색인·함수) 또는 SQL Editor(폰 경로 C). 되돌리기는 SQL Editor 전용.
-- 짝: docs/20261025210000_feed_item_archive.{precheck,snapshot,postcheck,rollback}.sql·.summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025210000')
     or to_regclass('public.app_feed_items') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_feed_items')
         and attname = 'archived_at' and not attisdropped)
     or to_regclass('public.app_feed_items_archived_idx') is not null
     or to_regprocedure('public.app_feed_set_state(uuid,text)') is not null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_feed_items')
         and attname = 'hidden_at' and not attisdropped)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'FEED_ITEM_ARCHIVE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_feed_items add column archived_at timestamptz;

create index app_feed_items_archived_idx on public.app_feed_items(workspace_id, source, archived_at desc)
  where archived_at is not null;

create function public.app_feed_set_state(p_id uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.app_feed_items%rowtype;
begin
  if p_state is null or p_state not in ('active', 'archived', 'trashed') then
    raise exception using errcode = '22023', message = 'FEED_STATE_TARGET';
  end if;
  select * into f from public.app_feed_items i where i.id = p_id for update;
  if not found or not private.app_is_workspace_owner(f.workspace_id) then
    raise exception using errcode = 'P0002', message = 'FEED_NOT_FOUND';
  end if;
  if f.source <> 'telegram' then
    raise exception using errcode = '23514', message = 'FEED_STATE_TELEGRAM_ONLY';
  end if;
  update public.app_feed_items i
     set archived_at = case when p_state = 'archived' then coalesce(f.archived_at, pg_catalog.now()) else null end,
         hidden_at = case when p_state = 'trashed' then coalesce(f.hidden_at, pg_catalog.now()) else null end,
         updated_at = pg_catalog.now()
   where i.id = f.id and i.workspace_id = f.workspace_id
  returning * into f;
  return pg_catalog.jsonb_build_object('ok', true, 'id', f.id, 'state', p_state,
    'archived_at', f.archived_at, 'hidden_at', f.hidden_at, 'updated_at', f.updated_at);
end
$$;
revoke all on function public.app_feed_set_state(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.app_feed_set_state(uuid, text) to authenticated;

-- 사후 확인: 새 칸은 비어 있고 기본값 없음, 함수는 DEFINER·빈 search_path·authenticated만 실행, authenticated와 service_role은
-- 새 칸을 직접 쓰지 못함, anon·PUBLIC 권한 없음. 다르면 전체 취소.
do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_feed_items')
         and attname = 'archived_at' and not attisdropped and not attnotnull and not atthasdef and atttypid = 'timestamptz'::regtype)
     or exists (select 1 from public.app_feed_items where archived_at is not null)
     or has_column_privilege('authenticated', 'public.app_feed_items', 'archived_at', 'update')
     or has_column_privilege('authenticated', 'public.app_feed_items', 'archived_at', 'insert')
     or has_column_privilege('service_role', 'public.app_feed_items', 'archived_at', 'insert')
     or has_column_privilege('service_role', 'public.app_feed_items', 'archived_at', 'update')
     or has_column_privilege('service_role', 'public.app_feed_items', 'archived_at', 'select')
     or has_column_privilege('anon', 'public.app_feed_items', 'archived_at', 'select')
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_feed_items')
         and attname = 'archived_at' and attacl is not null)
     or not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.app_feed_set_state(uuid,text)')
         and p.prosecdef and p.proconfig = array['search_path=""'])
     or not has_function_privilege('authenticated', 'public.app_feed_set_state(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.app_feed_set_state(uuid,text)', 'execute')
     or has_function_privilege('service_role', 'public.app_feed_set_state(uuid,text)', 'execute')
     or exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.app_feed_set_state(uuid,text)')
         and coalesce(p.proacl::text, '') ~ '(^|[{,])=') then
    raise exception 'FEED_ITEM_ARCHIVE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261025210000', 'feed_item_archive', array['TG-카드밀기 1단계: app_feed_items.archived_at 칸 + 색인, app_feed_set_state(uuid,text) (SECURITY DEFINER, 빈 search_path, 소유자 확인, 텔레그램 줄만, authenticated만 실행), 기존 grant·정책·CHECK·트리거 변경 없음']);
commit;
