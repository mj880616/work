begin;
-- S54-23 FORGET-소식바로잡기 ②(요청함 11/09 01:45, 시안 docs/design/mockups/forget-news-fix.html, 명진 'ㅇ'): 잊지 말기 '소식' 줄을 AI가
-- '주간보고에 담을 만한 것'이 아니라 '명진에게 해당하는 것'으로만 고르게 바꾼다. AI는 기록마다 다섯 중 하나로 정해야만 가져오고
-- (할 일 task / 일정 event / 기억할 것 note / 조직보고 org / 사업보고 area), 줄 밑에 이유 한 줄을 보이며 맞는 버튼을 굵게 한다(누르는 건 사람).
-- 그 종류와 이유를 남길 곳이 없어, 소식 줄 하나에 한 행인 작은 표를 더한다(기존 표 app_journal_memorable의 칸·권한·정책은 건드리지 않음).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
--   app_journal_memorable_picks  memorable_id(소식 줄, 지우면 함께 지움) · workspace_id · kind · reason(1~60자) · picked_at.
--     소식 줄 하나에 한 행(기본 키 memorable_id). 행이 없는 소식 줄 = 옛 기준으로 고른 줄.
-- 권한: owner 정책(쓰기 때는 같은 작업공간의 소식 줄에만 붙음) 위에 restrictive 운영자 기능 정책(calls 또는 telegram, 소식 runs 표와 같은 식).
--   authenticated: 읽기·넣기(값 칸만)·고치기(kind·reason만). 지우기 없음. anon·PUBLIC·service_role: 없음.
--   ai-assist가 사용자 로그인(JWT)으로 소식 줄을 넣을 때 함께 넣고, 옛 줄을 새 기준으로 다시 거를 때(④) 남는 줄에 넣는다.
-- 안 하는 것: 기존 표·칸·검사·정책·권한·트리거·함수·색인 변경, 기존 줄 내용 변경, 다른 표, rtw_* 객체.
-- 짝: docs/20261109020000_journal_memorable_pick.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109020000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261103230000' and name = 'journal_memorable') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_journal_memorable') is null
     or to_regclass('public.app_journal_memorable_picks') is not null
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_journal_memorable') and relrowsecurity)
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_journal_memorable')) <> 2
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'JOURNAL_MEMORABLE_PICK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_journal_memorable_picks (
  memorable_id uuid primary key references public.app_journal_memorable(id) on delete cascade,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  kind text not null,
  reason text not null,
  picked_at timestamptz not null default now(),
  constraint app_journal_memorable_picks_kind_check check (kind in ('task','event','note','org','area')),
  constraint app_journal_memorable_picks_reason_check check (char_length(btrim(reason)) between 1 and 60 and reason !~ '[[:cntrl:]]')
);
create index app_journal_memorable_picks_ws_idx on public.app_journal_memorable_picks(workspace_id);

alter table public.app_journal_memorable_picks enable row level security;
revoke all on table public.app_journal_memorable_picks from public, anon, authenticated, service_role;

grant select on table public.app_journal_memorable_picks to authenticated;
grant insert (memorable_id, workspace_id, kind, reason) on table public.app_journal_memorable_picks to authenticated;
grant update (kind, reason) on table public.app_journal_memorable_picks to authenticated;

create policy journal_memorable_picks_owner_all on public.app_journal_memorable_picks for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_journal_memorable m
      where m.id = memorable_id and m.workspace_id = app_journal_memorable_picks.workspace_id));
create policy op_feature_all on public.app_journal_memorable_picks as restrictive for all to authenticated
  using (private.app_workspace_has_feature(workspace_id, 'calls') or private.app_workspace_has_feature(workspace_id, 'telegram'))
  with check (private.app_workspace_has_feature(workspace_id, 'calls') or private.app_workspace_has_feature(workspace_id, 'telegram'));

-- 사후 확인: RLS 켜짐·정책 둘(owner 하나 + restrictive 하나, 모두 authenticated), anon·PUBLIC·service_role 권한 없음, 지우기 없음,
-- 넣기·고치기는 정해진 칸만, 빈 표, 기존 소식 표 정책 둘 그대로. 다르면 전체 취소.
do $$
declare t regclass := 'public.app_journal_memorable_picks'::regclass;
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
     or has_column_privilege('authenticated', t, 'picked_at', 'insert')
     or has_column_privilege('authenticated', t, 'memorable_id', 'update')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update')
     or not has_column_privilege('authenticated', t, 'kind', 'insert,update')
     or not has_column_privilege('authenticated', t, 'reason', 'insert,update')
     or (select count(*) from pg_policy where polrelid = t) <> 2
     or exists (select 1 from pg_policy where polrelid = t and not (polroles = array[to_regrole('authenticated')::oid]))
     or (select count(*) from pg_policy where polrelid = t and not polpermissive) <> 1
     or exists (select 1 from public.app_journal_memorable_picks)
     or (select count(*) from pg_policy where polrelid = 'public.app_journal_memorable'::regclass) <> 2 then
    raise exception 'JOURNAL_MEMORABLE_PICK_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261109020000', 'journal_memorable_pick', array['FORGET news fix: app_journal_memorable_picks (one row per news line: AI kind task|event|note|org|area + reason 1-60 chars), owner RLS with same-workspace check + restrictive operator feature policy, authenticated select/insert(value columns)/update(kind,reason), no delete, no anon/PUBLIC/service_role; no change to existing tables']);
commit;
