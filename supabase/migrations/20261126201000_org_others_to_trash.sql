begin;
-- S71-40 DATA-정리두가지 (가) (사용자 결정 2026-11-26 18:11 "지워"): 운영자 작업공간의 '그 외 조직'을 휴지통으로 옮긴다.
-- '그 외 조직' = 내 프로필 '관리 대상 현황'에서 담당으로 체크되지 않은 조직(화면 기준 78곳):
--   그 작업공간의 조직 중 휴지통에 없고(deleted_at 없음), 활성(active가 false가 아님)이고,
--   담당 표 두 곳(app_suborganization_assignees·app_profile_workplaces) 어디에도 줄이 없는 조직.
--   담당 조직(체크된 곳)은 WHERE에서 빠지고, 사후 확인이 담당 조직 줄이 이번 transaction에서 바뀌지 않았는지 다시 본다.
--   비활성 조직(화면 목록에 안 나옴)은 건드리지 않는다(사전 확인에 개수만).
-- 지우는 방법 = 앱의 [삭제]와 같은 휴지통 옮기기(app_suborganizations.deleted_at = now(), 20261025100000 trash_org_report_db).
--   줄은 지우지 않으므로 외래 키 cascade·set null이 일어나지 않고, 앱 휴지통에서 하나씩 되살릴 수 있다. 영구 삭제는 이 파일에서 하지 않는다.
-- 참조 기록이 있는 조직은 옮기지 않는다(안전 우선): 아래 23곳(외래 키 22곳 + 이름으로 잇는 텔레그램 기억할 일 1곳) 중 한 곳에라도 그 조직을 가리키는 줄이 있으면 남긴다.
--   운영의 app_suborganizations 외래 키 목록이 이 파일이 아는 22곳과 하나라도 다르면 아무것도 바꾸지 않고 멈춘다(모르는 표의 기록을 놓치지 않게).
--   멈추면 snapshot artifact의 'fk' 줄(표·칸 이름, 카탈로그만)을 보고 목록을 더한 새 PR로 다시 한다.
-- 작업공간 id는 파일에 쓰지 않는다: 서버 운영자 허용 표(app_operator_features, feature 'telegram')의 작업공간이 정확히 하나이고 주인이 한 명일 때만 진행한다.
-- 옮기기 전 같은 transaction 안에서 옮길 조직 줄 전체(jsonb)를 백업 표 public.app_cleanup_s71_40_orgs에 복사한다(RLS 켬·정책 없음·API 역할 권한 없음).
--   승인형 DB workflow 확장 규칙은 public 표만 받으므로 private 스키마가 아니라 public에 두고 권한을 모두 걷는다(anon·authenticated·service_role 모두 못 읽음).
-- 그 외 조직이 78곳보다 많으면(화면과 다름) 멈춘다. 다른 표·칸·권한·정책·함수·트리거는 바꾸지 않는다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
-- 출력: 사전·사후 확인은 개수·예/아니오·해시만(조직 이름·기록 내용은 읽어 보이지 않음, AGENTS.md 3절).
-- 되돌리기: 짝 rollback(SQL Editor 전용) — 백업 표의 조직을 휴지통에서 꺼내고(영구 삭제됐으면 백업 줄로 다시 넣음) 백업 표·기록 1행을 지운다.
-- 짝: docs/20261126201000_org_others_to_trash.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_suborganizations in share row exclusive mode;
lock table public.app_suborganization_assignees, public.app_profile_workplaces, public.app_suborganization_updates,
  public.app_suborganization_timeline, public.app_suborganization_weekly_reports, public.app_suborganization_status_items,
  public.app_suborganization_affiliations, public.app_suborganization_dispute_stages, public.app_event_suborganizations,
  public.app_record_links, public.app_documents, public.app_todo_candidates, public.app_ledger_organizations,
  public.app_weekly_org_summaries, public.app_feed_items, public.app_calendar_work_refs, public.app_org_key_people,
  public.app_org_key_people_briefs, public.app_pre_meeting_sheets, public.app_org_status_rows, public.app_weekly_org_lines,
  public.app_library_folders, public.app_journal_memorable in share mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261126201000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261025100000' and name = 'trash_org_report_db') <> 1
     or to_regclass('public.app_cleanup_s71_40_orgs') is not null
     -- 휴지통 칸·휴지통 숨김 정책이 그대로.
     or (select count(*) from pg_attribute where attrelid = 'public.app_suborganizations'::regclass and not attisdropped
         and attname = 'deleted_at' and atttypid = 'timestamptz'::regtype) <> 1
     or (select count(*) from pg_attribute where attrelid = 'public.app_suborganizations'::regclass and not attisdropped
         and attname = 'active') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_suborganizations'::regclass
         and polname = 'app_suborganizations_trash_hidden' and not polpermissive) <> 1
     or exists (select 1 from pg_class where oid = 'public.app_suborganizations'::regclass and not relrowsecurity)
     -- 운영자 작업공간: 정확히 하나, 주인 한 명.
     or (select count(distinct f.workspace_id) from public.app_operator_features f where f.feature = 'telegram') <> 1
     or (select count(*) from public.app_workspace_members m
         where m.role = 'owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram')) <> 1
     -- app_suborganizations를 가리키는 외래 키가 정확히 이 22곳(표.칸).
     or (select count(*) from pg_constraint k
         join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
         where k.contype = 'f' and k.confrelid = 'public.app_suborganizations'::regclass) <> 22
     or exists (select 1 from pg_constraint k
         join pg_class c on c.oid = k.conrelid
         join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
         where k.contype = 'f' and k.confrelid = 'public.app_suborganizations'::regclass
           and (c.relnamespace <> 'public'::regnamespace or c.relname || '.' || a.attname <> all (array[
             'app_suborganization_assignees.organization_id', 'app_profile_workplaces.organization_id',
             'app_suborganization_updates.organization_id', 'app_suborganization_timeline.organization_id',
             'app_suborganization_weekly_reports.organization_id', 'app_suborganization_status_items.organization_id',
             'app_suborganization_affiliations.organization_id', 'app_suborganization_dispute_stages.organization_id',
             'app_event_suborganizations.organization_id', 'app_record_links.organization_id',
             'app_documents.organization_id', 'app_todo_candidates.organization_id',
             'app_ledger_organizations.suborganization_id', 'app_weekly_org_summaries.organization_id',
             'app_feed_items.organization_id', 'app_calendar_work_refs.organization_id',
             'app_org_key_people.organization_id', 'app_org_key_people_briefs.organization_id',
             'app_pre_meeting_sheets.organization_id', 'app_org_status_rows.organization_id',
             'app_weekly_org_lines.organization_id', 'app_library_folders.organization_id'])))
     -- 그 외 조직이 화면 기준(78곳)보다 많으면 멈춘다.
     or (select count(*) from public.app_suborganizations o
         where o.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram')
           and o.deleted_at is null and coalesce(o.active, true)
           and not exists (select 1 from public.app_suborganization_assignees x where x.organization_id = o.id)
           and not exists (select 1 from public.app_profile_workplaces x where x.organization_id = o.id)) > 78 then
    raise exception 'ORG_OTHERS_TO_TRASH_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 백업 표: 옮길 조직 줄 전체 사본. 외래 키 없음(조직이 나중에 영구 삭제돼도 사본은 남는다). RLS 켬·정책 없음·API 역할 권한 없음.
create table public.app_cleanup_s71_40_orgs (
  organization_id uuid primary key,
  workspace_id uuid not null,
  moved_at timestamptz not null default now(),
  row_data jsonb not null
);
alter table public.app_cleanup_s71_40_orgs enable row level security;
revoke all on table public.app_cleanup_s71_40_orgs from public, anon, authenticated, service_role;

insert into public.app_cleanup_s71_40_orgs (organization_id, workspace_id, row_data)
select o.id, o.workspace_id, to_jsonb(o)
  from public.app_suborganizations o
 where o.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram')
   and o.deleted_at is null
   and coalesce(o.active, true)
   -- 담당 조직은 빼기(체크된 곳).
   and not exists (select 1 from public.app_suborganization_assignees x where x.organization_id = o.id)
   and not exists (select 1 from public.app_profile_workplaces x where x.organization_id = o.id)
   -- 참조 기록이 있는 조직은 빼기.
   and not exists (select 1 from public.app_suborganization_updates x where x.organization_id = o.id)
   and not exists (select 1 from public.app_suborganization_timeline x where x.organization_id = o.id)
   and not exists (select 1 from public.app_suborganization_weekly_reports x where x.organization_id = o.id)
   and not exists (select 1 from public.app_suborganization_status_items x where x.organization_id = o.id)
   and not exists (select 1 from public.app_suborganization_affiliations x where x.organization_id = o.id)
   and not exists (select 1 from public.app_suborganization_dispute_stages x where x.organization_id = o.id)
   and not exists (select 1 from public.app_event_suborganizations x where x.organization_id = o.id)
   and not exists (select 1 from public.app_record_links x where x.organization_id = o.id)
   and not exists (select 1 from public.app_documents x where x.organization_id = o.id)
   and not exists (select 1 from public.app_todo_candidates x where x.organization_id = o.id)
   and not exists (select 1 from public.app_ledger_organizations x where x.suborganization_id = o.id)
   and not exists (select 1 from public.app_weekly_org_summaries x where x.organization_id = o.id)
   and not exists (select 1 from public.app_feed_items x where x.organization_id = o.id)
   and not exists (select 1 from public.app_calendar_work_refs x where x.organization_id = o.id)
   and not exists (select 1 from public.app_org_key_people x where x.organization_id = o.id)
   and not exists (select 1 from public.app_org_key_people_briefs x where x.organization_id = o.id)
   and not exists (select 1 from public.app_pre_meeting_sheets x where x.organization_id = o.id)
   and not exists (select 1 from public.app_org_status_rows x where x.organization_id = o.id)
   and not exists (select 1 from public.app_weekly_org_lines x where x.organization_id = o.id)
   and not exists (select 1 from public.app_library_folders x where x.organization_id = o.id)
   and not exists (select 1 from public.app_journal_memorable x where x.workspace_id = o.workspace_id and x.org_name = o.name);

update public.app_suborganizations o
   set deleted_at = now()
 where o.deleted_at is null
   and o.id in (select b.organization_id from public.app_cleanup_s71_40_orgs b);

-- 사후 확인(같은 transaction): 백업한 조직은 모두 휴지통에, 이번에 바뀐 조직 줄 수 = 백업 줄 수, 담당 조직·담당 표·프로필 줄은 이번에 바뀌지 않음,
-- 백업 표 RLS 켜짐·API 역할 권한 없음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from public.app_cleanup_s71_40_orgs b
             where not exists (select 1 from public.app_suborganizations o where o.id = b.organization_id and o.deleted_at = b.moved_at))
     or (select count(*) from public.app_suborganizations o where o.xmin = pg_catalog.pg_current_xact_id()::xid)
        <> (select count(*) from public.app_cleanup_s71_40_orgs)
     or exists (select 1 from public.app_suborganizations o
                where o.xmin = pg_catalog.pg_current_xact_id()::xid
                  and (exists (select 1 from public.app_suborganization_assignees x where x.organization_id = o.id)
                       or exists (select 1 from public.app_profile_workplaces x where x.organization_id = o.id)))
     or exists (select 1 from public.app_suborganization_assignees x where x.xmin = pg_catalog.pg_current_xact_id()::xid)
     or exists (select 1 from public.app_profile_workplaces x where x.xmin = pg_catalog.pg_current_xact_id()::xid)
     or exists (select 1 from public.app_profiles x where x.xmin = pg_catalog.pg_current_xact_id()::xid)
     or exists (select 1 from public.app_ledger_organizations x where x.xmin = pg_catalog.pg_current_xact_id()::xid)
     or exists (select 1 from pg_class where oid = 'public.app_cleanup_s71_40_orgs'::regclass and not relrowsecurity)
     or exists (select 1 from pg_policy where polrelid = 'public.app_cleanup_s71_40_orgs'::regclass)
     or has_table_privilege('anon', 'public.app_cleanup_s71_40_orgs', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_cleanup_s71_40_orgs', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_cleanup_s71_40_orgs', 'select,insert,update,delete,truncate,references,trigger') then
    raise exception 'ORG_OTHERS_TO_TRASH_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261126201000', 'org_others_to_trash', array['S71-40 DATA (a): operator workspace organizations that are active, not in trash, not assigned (assignees/profile_workplaces) and referenced by none of 22 FK tables or journal memorable names are copied to public.app_cleanup_s71_40_orgs (RLS on, no policy, no API grants) and moved to trash (deleted_at = now()); stops if the FK list differs or more than 78 such organizations; no row deleted, no other table, grant, policy, function or trigger change']);
commit;
