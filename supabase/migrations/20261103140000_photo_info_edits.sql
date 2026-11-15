begin;
-- S48-60 PHOTO-정보고치기(요청함 11/03 00:29, 명진 결정 E1·E2): 웹2에서 고친 사진 정보(찍은 시각·위치)의 되돌리기 기록 새 표 1개.
--   app_photo_info_edits: 한 줄 = 고친 사진 한 장. 묶음(batch_id) + 출처('phone') + 사진 열쇠('ms:<번호>') + 앞·뒤 시각·위치 + 되돌린 시각.
--   [되돌리기] = 그 묶음의 앞 값으로 폰 사진을 다시 고친 뒤 undone_at을 적는다. 사진 이름·내용은 넣지 않는다.
-- 위치는 민감하므로 작업공간 주인만 읽는다(private.app_is_workspace_owner, 정책 하나 — app_photo_tags와 같은 모양).
--   authenticated: 읽기·넣기(값 칸만, id·created_at·undone_at 제외)·고치기(undone_at만). 지우기 없음.
--   anon·PUBLIC·service_role: 없음(Edge는 이 표를 읽지 않는다).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
-- 안 하는 것: 함수·트리거·기존 표·기존 자료 변경, 읽생기 표.
-- 짝: docs/20261103140000_photo_info_edits.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261103140000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_photo_info_edits') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'PHOTO_INFO_EDITS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_photo_info_edits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  batch_id uuid not null,
  source text not null,
  item_key text not null,
  before_taken timestamptz,
  after_taken timestamptz,
  loc_changed boolean not null default false,
  before_lat double precision,
  before_lon double precision,
  after_lat double precision,
  after_lon double precision,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  constraint app_photo_info_edits_source_check check (source in ('phone')),
  constraint app_photo_info_edits_key_check check (char_length(item_key) between 1 and 300),
  constraint app_photo_info_edits_before_loc_check check (
    (before_lat is null and before_lon is null)
    or (before_lat is not null and before_lon is not null and before_lat between -90 and 90 and before_lon between -180 and 180)),
  constraint app_photo_info_edits_after_loc_check check (
    (after_lat is null and after_lon is null)
    or (after_lat is not null and after_lon is not null and after_lat between -90 and 90 and after_lon between -180 and 180)),
  constraint app_photo_info_edits_changed_check check (
    loc_changed or (after_taken is not null and before_taken is distinct from after_taken)),
  constraint app_photo_info_edits_loc_check check (
    loc_changed or (after_lat is null and after_lon is null))
);
create index app_photo_info_edits_ws_idx on public.app_photo_info_edits(workspace_id, created_at desc);
create index app_photo_info_edits_batch_idx on public.app_photo_info_edits(workspace_id, batch_id);

alter table public.app_photo_info_edits enable row level security;
revoke all on table public.app_photo_info_edits from public, anon, authenticated, service_role;

grant select on table public.app_photo_info_edits to authenticated;
grant insert (workspace_id, batch_id, source, item_key, before_taken, after_taken, loc_changed, before_lat, before_lon, after_lat, after_lon)
  on table public.app_photo_info_edits to authenticated;
grant update (undone_at) on table public.app_photo_info_edits to authenticated;

create policy photo_info_edits_owner_all on public.app_photo_info_edits for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐·authenticated 정책 하나, anon·PUBLIC·service_role 권한 없음, 지우기 없음, 고치기는 undone_at만. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_photo_info_edits'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('service_role', t, 'select,insert,update,references')
     or not has_table_privilege('authenticated', t, 'select')
     or has_table_privilege('authenticated', t, 'insert,update,delete,truncate,references,trigger')
     or not has_column_privilege('authenticated', t, 'item_key', 'insert')
     or has_column_privilege('authenticated', t, 'id', 'insert')
     or has_column_privilege('authenticated', t, 'undone_at', 'insert')
     or has_column_privilege('authenticated', t, 'created_at', 'insert')
     or not has_column_privilege('authenticated', t, 'undone_at', 'update')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update')
     or has_column_privilege('authenticated', t, 'before_taken', 'update')
     or has_column_privilege('authenticated', t, 'after_lat', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid])) then
    raise exception 'PHOTO_INFO_EDITS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261103140000', 'photo_info_edits', array['S48-60 PHOTO-정보고치기: app_photo_info_edits (owner RLS, no anon/PUBLIC/service_role, no delete, update undone_at only)']);
commit;
