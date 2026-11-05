begin;
-- S50-3 FAMILY-잊지말기 DB: 가족 1명의 텔레그램 대화·통화에서 AI가 뽑은 '잊지 말기' 한 줄을 담는 새 표. 설계 docs/design/tg-personal.md 4절(11/04 개정).
-- 앱·Edge·Apps Script 변경은 이 migration에 없다(Edge collector-feed는 이 DB 적용 뒤 배포).
--
-- 무엇:
--   1) 운영자 기능 키에 'family'를 더한다(검사를 지우고 같은 이름으로 다시 만듦 — 앞 단계 20261103100000_dev_inbox_feature의 키 다섯은 그대로).
--      허용 행은 '통화(calls)가 허용된 작업공간이 정확히 하나일 때'만 그 작업공간에 1행. 고정 id·이름·메일을 쓰지 않는다.
--   2) 새 표 public.app_family_notes: 뽑은 한 줄(150자)·말한 때(60자)·종류·확정 정도·출처(telegram/call)·그 날·Drive 링크·상태. 대화 원문 칸이 없다.
--      RLS 켬. 정책: 소유자 읽기·소유자 고치기(authenticated만, private.app_is_workspace_owner) + restrictive 읽기(운영자 기능 family).
--      authenticated: 읽기 + status·decided_at·done_at·updated_at 고치기만(넣기·지우기 없음).
--      service_role: 칸별 넣기 + 여덟 칸 읽기(중복 확인·다시 제안 막기·알림 세기)만(고치기·지우기 없음).
--   3) 새 트리거 함수 private.app_family_feature_guard()(SECURITY DEFINER, 빈 search_path, 실행권 전부 회수) + BEFORE INSERT OR UPDATE 트리거:
--      family가 허용되지 않은 작업공간에는 어떤 역할로도 줄을 넣거나 고치지 못한다(통화·텔레그램 표 12개와 같은 방식).
-- 안 하는 것: 기존 표·칸·정책·권한·함수 본문 변경(운영자 표의 검사 제약만 키 하나 더해 다시 만듦), 기존 줄 변경·삭제, anon·PUBLIC 권한, RLS 약화, rtw_* 객체,
--   폰 알림 종류 추가(화면·알림 PR에서 따로), 옛 개인 방 하루 요약 표(20261025030000, 운영 미적용·적용 계획 없음).
-- 짝: docs/20261105100000_family_notes.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261105100000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261103100000' and name = 'dev_inbox_feature') <> 1
     or to_regclass('public.app_family_notes') is not null
     or to_regprocedure('private.app_family_feature_guard()') is not null
     or to_regclass('public.app_operator_features') is null
     or to_regclass('public.app_workspaces') is null
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''dev_inbox''' and pg_get_constraintdef(oid) !~ '''family''') <> 1
     or exists (select 1 from public.app_operator_features where feature not in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox')) then
    raise exception 'FAMILY_NOTES_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from public.app_operator_features where feature = 'calls') <> 1 then
    raise exception 'FAMILY_NOTES_SEED_WORKSPACE_NOT_SINGLE; stop';
  end if;
end
$$;

-- 1) 운영자 기능 키 family + 운영자(calls) 작업공간 1행.
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family'));
insert into public.app_operator_features (workspace_id, feature)
  select f.workspace_id, 'family' from public.app_operator_features f where f.feature = 'calls';

-- 2) 잊지 말기 표. 원문 칸 없음. [×]도 줄을 지우지 않고 dismissed로 남긴다(같은 제안을 다시 띄우지 않는 재료).
create table public.app_family_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  kind text not null,
  body text not null,
  said_when text,
  firmness text not null default 'planned',
  origin text not null,
  origin_day date not null,
  drive_url text,
  source_ref text not null,
  status text not null default 'new',
  decided_at timestamptz,
  done_at timestamptz,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_family_notes_ref_unique unique (workspace_id, source_ref),
  constraint app_family_notes_kind_check check (kind in ('plan', 'ask', 'like', 'dislike', 'date', 'gift', 'remind')),
  constraint app_family_notes_body_check check (char_length(body) between 1 and 150 and body !~ '[[:cntrl:]]'),
  constraint app_family_notes_said_when_check check (said_when is null or (char_length(said_when) between 1 and 60 and said_when !~ '[[:cntrl:]]')),
  constraint app_family_notes_firmness_check check (firmness in ('firm', 'planned', 'unclear')),
  constraint app_family_notes_origin_check check (origin in ('telegram', 'call')),
  constraint app_family_notes_drive_url_check check (drive_url is null or (char_length(drive_url) <= 500 and drive_url ~ '^https://(drive|docs)\.google\.com/[A-Za-z0-9_./?=&%-]+$')),
  constraint app_family_notes_source_ref_check check (source_ref ~ '^fam:(tg|call):[A-Za-z0-9_.:-]{1,190}$'),
  constraint app_family_notes_status_check check (status in ('new', 'kept', 'tasked', 'scheduled', 'dismissed')),
  constraint app_family_notes_decided_check check ((status = 'new') = (decided_at is null)),
  constraint app_family_notes_done_check check (done_at is null or kind in ('plan', 'ask', 'remind')),
  constraint app_family_notes_model_check check (model is null or char_length(model) <= 80)
);
create index app_family_notes_status_idx on public.app_family_notes (workspace_id, status, created_at desc);
create index app_family_notes_day_idx on public.app_family_notes (workspace_id, origin_day desc);
alter table public.app_family_notes enable row level security;
revoke all on table public.app_family_notes from public, anon, authenticated, service_role;
create policy app_family_notes_owner_select on public.app_family_notes
  for select to authenticated using (private.app_is_workspace_owner(workspace_id));
create policy app_family_notes_owner_update on public.app_family_notes
  for update to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy op_feature_read on public.app_family_notes as restrictive for select to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'family'));
grant select on table public.app_family_notes to authenticated;
grant update (status, decided_at, done_at, updated_at) on table public.app_family_notes to authenticated;
grant insert (workspace_id, kind, body, said_when, firmness, origin, origin_day, drive_url, source_ref, model) on table public.app_family_notes to service_role;
grant select (id, workspace_id, kind, body, origin_day, source_ref, status, created_at) on table public.app_family_notes to service_role;

-- 3) 쓰기 길목: family 허용이 없는 작업공간에는 어떤 역할로도 넣거나 고치지 못한다.
create function private.app_family_feature_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.app_operator_features f
                  where f.workspace_id = new.workspace_id and f.feature = 'family') then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  return new;
end
$$;
revoke all on function private.app_family_feature_guard() from public, anon, authenticated, service_role;
create trigger trg_family_feature_guard before insert or update on public.app_family_notes
  for each row execute function private.app_family_feature_guard();

-- 마지막 확인: 어긋나면 전체 취소.
do $$
begin
  if not exists (select 1 from pg_class where oid = 'public.app_family_notes'::regclass and relrowsecurity and not relforcerowsecurity)
     or (select count(*) from pg_policy where polrelid = 'public.app_family_notes'::regclass) <> 3
     or (select count(*) from pg_policy where polrelid = 'public.app_family_notes'::regclass and polroles = array['authenticated'::regrole]::oid[]) <> 3
     or (select count(*) from pg_policy where polrelid = 'public.app_family_notes'::regclass and not polpermissive) <> 1
     or exists (select 1 from pg_class where oid = 'public.app_family_notes'::regclass and coalesce(relacl::text, '') ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_family_notes'::regclass and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_family_notes', 'insert')
     or has_table_privilege('authenticated', 'public.app_family_notes', 'delete')
     or has_column_privilege('authenticated', 'public.app_family_notes', 'body', 'update')
     or has_column_privilege('authenticated', 'public.app_family_notes', 'workspace_id', 'update')
     or not has_column_privilege('authenticated', 'public.app_family_notes', 'status', 'update')
     or has_any_column_privilege('service_role', 'public.app_family_notes', 'update')
     or has_table_privilege('service_role', 'public.app_family_notes', 'delete')
     or has_column_privilege('service_role', 'public.app_family_notes', 'status', 'insert')
     or has_column_privilege('service_role', 'public.app_family_notes', 'drive_url', 'select')
     or not has_column_privilege('service_role', 'public.app_family_notes', 'source_ref', 'select')
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_family_feature_guard()') and prosecdef
         and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 1
     or has_function_privilege('authenticated', to_regprocedure('private.app_family_feature_guard()'), 'execute')
     or has_function_privilege('service_role', to_regprocedure('private.app_family_feature_guard()'), 'execute')
     or (select count(*) from pg_trigger where tgrelid = 'public.app_family_notes'::regclass and not tgisinternal) <> 1
     or (select count(*) from public.app_operator_features where feature = 'family') <> 1
     or (select count(*) from public.app_operator_features d join public.app_operator_features c
           on c.workspace_id = d.workspace_id and c.feature = 'calls' where d.feature = 'family') <> 1
     or exists (select 1 from pg_policy where polrelid = 'public.app_operator_features'::regclass)
     or has_table_privilege('authenticated', 'public.app_operator_features', 'select,insert,update,delete')
     or has_table_privilege('service_role', 'public.app_operator_features', 'select,insert,update,delete') then
    raise exception 'FAMILY_NOTES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261105100000', 'family_notes', array['S50-3 FAMILY-잊지말기 DB: operator feature family added to app_operator_features_feature_check and seeded only for the single calls workspace; new table app_family_notes (one extracted line per item, no raw text column; owner select/update policies and restrictive op_feature_read for authenticated; authenticated select + update of status/decided_at/done_at/updated_at only; service_role column insert + eight-column select only); new SECURITY DEFINER trigger function private.app_family_feature_guard (empty search_path, nobody executes) blocking writes outside family workspaces; no anon/PUBLIC, no change to existing policies, grants, functions or rows']);
commit;
