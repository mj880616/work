begin;
-- MULTI-노조사용자 단계 ① DB (명진 10/29 07:27 D2 '모두 추천대로'): 통화·텔레그램은 운영자(명진) 작업공간에서만 서버가 허용한다.
-- 설계: docs/design/multi-user-audit.md 3절. 판정은 서버 허용 표 하나 + 판정 함수 하나. 클라이언트가 보낸 user_id·workspace_id는 믿지 않는다(auth.uid()와 서버 표만 본다).
-- 새 표 public.app_operator_features(workspace_id, feature): RLS 켬, 정책 없음, anon·authenticated·service_role 표 권한 없음.
--   → 화면·API로는 읽지도 쓰지도 못한다. 행은 이 파일(아래 넣기)과 SQL Editor·승인형 DB workflow로만 넣는다. 행을 넣는 RPC는 만들지 않는다(본인이 원해도 켜 주지 않음).
--   feature 값은 'calls'(통화)·'telegram'(텔레그램) 둘뿐.
-- 새 함수 넷(모두 SECURITY DEFINER, 빈 search_path, PUBLIC·anon 실행권 없음):
--   private.app_workspace_has_feature(p_workspace, p_feature)  판정 함수. 로그인한 본인이 그 작업공간의 owner이고 허용 행이 있을 때만 참. authenticated만 실행(정책 안에서 씀).
--   public.app_my_features()                                     화면·Edge용. 내가 owner인 작업공간의 기능 키 목록만 돌려준다(인자 없음). authenticated만.
--   public.app_operator_feature_workspace(p_feature)             수집 서버(service_role)용. 그 기능이 허용된 작업공간이 정확히 하나면 그 id, 아니면 null. service_role만.
--   private.app_operator_feature_guard()                          트리거 함수. 아무도 직접 못 부른다.
-- 통화·텔레그램 표 13개에:
--   restrictive 읽기 정책 op_feature_read(authenticated): 기존 소유자 정책 위에 '그 작업공간에 기능이 허용됨'을 더 요구한다. 기존 정책은 그대로(권한을 넓히지 않고 좁히기만).
--   BEFORE INSERT OR UPDATE 트리거 trg_op_feature_guard: 허용 행이 없는 작업공간에는 어떤 역할로도(화면 RPC·service_role 수집기 포함) 줄을 넣거나 고치지 못한다.
--     DEFINER RPC는 RLS를 거치지 않으므로 함수 20개를 하나씩 고치는 대신 쓰기 길목인 표에서 막는다(함수 본문은 한 글자도 바꾸지 않음).
--     허용 없는 작업공간에는 통화·텔레그램 줄이 생길 수 없으므로, 소유자 확인 뒤 줄을 읽는 DEFINER RPC들도 빈 결과만 얻는다.
--   app_feed_items·app_feed_days는 source 칸('call'→calls, 'telegram'→telegram)으로, 나머지는 표마다 정해진 기능으로 판정.
-- 허용 행 넣기(명진 화면이 끊기지 않게 같은 트랜잭션에서): 고정 id·이름·메일을 쓰지 않는다.
--   '지금 통화·텔레그램 자료가 들어 있는 작업공간'(소식·하루 숫자·통화 개인 상자·텔레그램 개인 하루 표 기준)이 정확히 하나이고 그 작업공간의 owner 행이 정확히 하나일 때만 그 작업공간에 2행을 넣는다.
--   소유자 행만으로 고르지 않는 이유: 운영에 예전 작업공간의 owner 행이 남아 있을 수 있어서(설계 2.1). 조건이 어긋나면 멈추고 아무것도 바꾸지 않는다.
-- 안 하는 것: 기존 표·칸·정책·권한·함수 본문 변경, 기존 줄 변경·삭제, anon·PUBLIC 권한, RLS 약화, rtw_* 객체, 가입 열기·작업공간 만들기(단계 ②).
-- 앞 단계: 20261028030000(tg_room_day_context)까지 통화·텔레그램 migration이 모두 적용돼 있어야 한다.
-- 짝: docs/20261029090000_operator_features.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029090000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261028030000' and name = 'tg_room_day_context') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261027200000' and name = 'tg_summary_edit') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_workspace_members') is null
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_feed_days') is null
     or to_regclass('public.app_call_personal') is null
     or to_regclass('public.app_call_edits') is null
     or to_regclass('public.app_call_edit_history') is null
     or to_regclass('public.app_tg_personal_days') is null
     or to_regclass('public.app_tg_senders') is null
     or to_regclass('public.app_tg_day_senders') is null
     or to_regclass('public.app_feed_folders') is null
     or to_regclass('public.app_feed_rooms') is null
     or to_regclass('public.app_feed_room_days') is null
     or to_regclass('public.app_feed_summary_edits') is null
     or to_regclass('public.app_feed_summary_edit_history') is null
     or to_regclass('public.app_operator_features') is not null
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is not null
     or to_regprocedure('public.app_my_features()') is not null
     or to_regprocedure('public.app_operator_feature_workspace(text)') is not null
     or to_regprocedure('private.app_operator_feature_guard()') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'OPERATOR_FEATURES_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from (
        select workspace_id from public.app_feed_items
        union select workspace_id from public.app_feed_days
        union select workspace_id from public.app_call_personal
        union select workspace_id from public.app_tg_personal_days) s) <> 1 then
    raise exception 'OPERATOR_FEATURES_SEED_WORKSPACE_NOT_SINGLE; stop';
  end if;
  if (select count(*) from public.app_workspace_members m
        where m.role = 'owner'
          and m.workspace_id = (select s.workspace_id from (
                select workspace_id from public.app_feed_items
                union select workspace_id from public.app_feed_days
                union select workspace_id from public.app_call_personal
                union select workspace_id from public.app_tg_personal_days) s)) <> 1 then
    raise exception 'OPERATOR_FEATURES_SEED_OWNER_NOT_SINGLE; stop';
  end if;
end
$$;

create table public.app_operator_features (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  feature text not null,
  created_at timestamptz not null default now(),
  constraint app_operator_features_pkey primary key (workspace_id, feature),
  constraint app_operator_features_feature_check check (feature in ('calls', 'telegram'))
);
alter table public.app_operator_features enable row level security;
revoke all on table public.app_operator_features from public, anon, authenticated, service_role;

create function private.app_workspace_has_feature(p_workspace uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_workspace is not null
     and p_feature is not null
     and private.app_is_workspace_owner(p_workspace)
     and exists (select 1 from public.app_operator_features f
                  where f.workspace_id = p_workspace and f.feature = p_feature)
$$;

create function public.app_my_features()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(distinct f.feature order by f.feature), '{}'::text[])
    from public.app_operator_features f
   where private.app_is_workspace_owner(f.workspace_id)
$$;

create function public.app_operator_feature_workspace(p_feature text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when pg_catalog.count(*) = 1 then pg_catalog.min(f.workspace_id::text)::uuid end
    from public.app_operator_features f
   where f.feature = p_feature
$$;

create function private.app_operator_feature_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  need text;
begin
  if tg_argv[0] = 'by_source' then
    need := case new.source when 'call' then 'calls' when 'telegram' then 'telegram' end;
  else
    need := tg_argv[0];
  end if;
  if need is null or not exists (select 1 from public.app_operator_features f
                                  where f.workspace_id = new.workspace_id and f.feature = need) then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  return new;
end
$$;

revoke all on function private.app_workspace_has_feature(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.app_my_features() from public, anon, authenticated, service_role;
revoke all on function public.app_operator_feature_workspace(text) from public, anon, authenticated, service_role;
revoke all on function private.app_operator_feature_guard() from public, anon, authenticated, service_role;
grant execute on function private.app_workspace_has_feature(uuid, text) to authenticated;
grant execute on function public.app_my_features() to authenticated;
grant execute on function public.app_operator_feature_workspace(text) to service_role;

insert into public.app_operator_features (workspace_id, feature)
select w.workspace_id, f.feature
  from (select distinct s.workspace_id from (
          select workspace_id from public.app_feed_items
          union select workspace_id from public.app_feed_days
          union select workspace_id from public.app_call_personal
          union select workspace_id from public.app_tg_personal_days) s) w
 cross join (values ('calls'), ('telegram')) as f(feature)
 where (select count(*) from public.app_workspace_members m
         where m.workspace_id = w.workspace_id and m.role = 'owner') = 1;

do $$
begin
  if (select count(*) from public.app_operator_features) <> 2
     or (select count(distinct workspace_id) from public.app_operator_features) <> 1 then
    raise exception 'OPERATOR_FEATURES_SEED_FAILED; stop';
  end if;
end
$$;

create policy op_feature_read on public.app_feed_items as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, case source when 'call' then 'calls' when 'telegram' then 'telegram' end));
create policy op_feature_read on public.app_feed_days as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, case source when 'call' then 'calls' when 'telegram' then 'telegram' end));
create policy op_feature_read on public.app_call_personal as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'calls'));
create policy op_feature_read on public.app_call_edits as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'calls'));
create policy op_feature_read on public.app_call_edit_history as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'calls'));
create policy op_feature_read on public.app_tg_personal_days as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'telegram'));
create policy op_feature_read on public.app_tg_senders as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'telegram'));
create policy op_feature_read on public.app_tg_day_senders as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'telegram'));
create policy op_feature_read on public.app_feed_folders as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'telegram'));
create policy op_feature_read on public.app_feed_rooms as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'telegram'));
create policy op_feature_read on public.app_feed_room_days as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'telegram'));
create policy op_feature_read on public.app_feed_summary_edits as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'telegram'));
create policy op_feature_read on public.app_feed_summary_edit_history as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'telegram'));

create trigger trg_op_feature_guard before insert or update on public.app_feed_items
  for each row execute function private.app_operator_feature_guard('by_source');
create trigger trg_op_feature_guard before insert or update on public.app_feed_days
  for each row execute function private.app_operator_feature_guard('by_source');
create trigger trg_op_feature_guard before insert or update on public.app_call_personal
  for each row execute function private.app_operator_feature_guard('calls');
create trigger trg_op_feature_guard before insert or update on public.app_call_edits
  for each row execute function private.app_operator_feature_guard('calls');
create trigger trg_op_feature_guard before insert or update on public.app_call_edit_history
  for each row execute function private.app_operator_feature_guard('calls');
create trigger trg_op_feature_guard before insert or update on public.app_tg_personal_days
  for each row execute function private.app_operator_feature_guard('telegram');
create trigger trg_op_feature_guard before insert or update on public.app_tg_senders
  for each row execute function private.app_operator_feature_guard('telegram');
create trigger trg_op_feature_guard before insert or update on public.app_tg_day_senders
  for each row execute function private.app_operator_feature_guard('telegram');
create trigger trg_op_feature_guard before insert or update on public.app_feed_folders
  for each row execute function private.app_operator_feature_guard('telegram');
create trigger trg_op_feature_guard before insert or update on public.app_feed_rooms
  for each row execute function private.app_operator_feature_guard('telegram');
create trigger trg_op_feature_guard before insert or update on public.app_feed_room_days
  for each row execute function private.app_operator_feature_guard('telegram');
create trigger trg_op_feature_guard before insert or update on public.app_feed_summary_edits
  for each row execute function private.app_operator_feature_guard('telegram');
create trigger trg_op_feature_guard before insert or update on public.app_feed_summary_edit_history
  for each row execute function private.app_operator_feature_guard('telegram');

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029090000', 'operator_features', array['MULTI-노조사용자 단계 ① DB: new table app_operator_features (RLS on, no policies, no anon/authenticated/service_role privileges; seeded with calls+telegram for the single workspace that already holds call/telegram data and has exactly one owner); SECURITY DEFINER functions with empty search_path: private.app_workspace_has_feature (authenticated), public.app_my_features (authenticated), public.app_operator_feature_workspace (service_role), private.app_operator_feature_guard (trigger only, nobody executes); restrictive select policy op_feature_read (authenticated) and BEFORE INSERT OR UPDATE trigger trg_op_feature_guard on 13 call/telegram tables; no change to existing policies, grants, columns, function bodies or rows']);
commit;
