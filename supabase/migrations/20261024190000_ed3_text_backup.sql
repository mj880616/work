begin;
-- ED③ 1단계 백업 (docs/design/unified-editor.md 4.1-1·11.3 484행, 2026-10-24 명진 결정 1): 마크다운 노트를 새 형식으로 한 번에 바꾸기 전에
-- 바뀔 수 있는 글의 원본을 비공개 표 하나에 한 번 복사한다. 변환 자체는 이 파일이 하지 않는다(편집기 JS 변환기가 필요 — PR 본문 근거).
--
-- 무엇: 새 표 app_ed3_text_backups 하나를 만들고 그 자리에서 원본을 복사한다.
--   note·basket·diary 노트 행(app_notes): id, 종류, raw_text, metadata, updated_at
--   담당조직 기록(app_suborganization_updates): id, raw_text, updated_at(운영 표에 있으면)
--   프로젝트 기록(app_project_progress_updates): id, summary, updated_at(운영 표에 있으면)
--   (두 기록 표는 저장소에 표 정의가 없어 칸을 직접 이름 부르지 않고 to_jsonb로 읽는다. 없는 칸은 비어 있음.)
-- 권한: RLS 켜고 PUBLIC·anon·authenticated·service_role의 모든 권한을 회수한다. 글 내용 칸(raw_text·metadata)은 누구에게도 다시 주지 않는다.
--   소유자 로그인(authenticated + 소유자 정책)에게는 "무엇이 백업됐는지" 확인용 칸(id·작업공간·출처·원래 행 id·원래 고친 시각·백업 시각)만 읽기를 준다.
--   변환 단추가 "백업이 있는 노트만, 백업 뒤 고치지 않은 노트만" 바꾸려고 이 칸을 읽는다. 쓰기·고치기·지우기 권한은 아무에게도 없다.
-- 기존 표·정책·권한·함수·자료는 바꾸지 않는다. 기존 행은 읽기만 한다(복사 중 쓰기를 막으려고 share 잠금).
-- 되돌리기: 짝 rollback(SQL Editor 전용, 표 삭제). 새 형식으로 바뀐 노트가 하나라도 있으면 멈춘다(그 노트의 원본은 이 표에만 있음).
set local lock_timeout = '5s';
set local statement_timeout = '120s';
lock table public.app_notes, public.app_suborganization_updates, public.app_project_progress_updates in share mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록·표 없음, 서식 칸 migration(20261023233000) 적용됨,
-- 세 표에 doc 칸이 있고 아직 새 형식으로 저장된 행이 하나도 없음, 소유자 확인 함수 있음, 기록 표가 붙는 조직·프로젝트 표 있음.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024190000')
     or to_regclass('public.app_ed3_text_backups') is not null
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261023233000' and name = 'ed_format_columns') <> 1
     or to_regclass('public.app_suborganizations') is null
     or to_regclass('public.app_spaces') is null
     or (select count(*) from pg_attribute where attname = 'doc' and not attisdropped and atttypid = 'jsonb'::regtype
           and attrelid in ('public.app_notes'::regclass, 'public.app_suborganization_updates'::regclass, 'public.app_project_progress_updates'::regclass)) <> 3
     or exists (select 1 from public.app_notes where doc is not null)
     or exists (select 1 from public.app_suborganization_updates where doc is not null)
     or exists (select 1 from public.app_project_progress_updates where doc is not null)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'ED3_TEXT_BACKUP_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_ed3_text_backups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source text not null,
  row_id uuid not null,
  row_updated_at timestamptz,
  raw_text text,
  metadata jsonb,
  backed_up_at timestamptz not null default now(),
  constraint app_ed3_text_backups_source_check check (source in ('note', 'basket', 'diary', 'org_update', 'project_record')),
  constraint app_ed3_text_backups_row_unique unique (source, row_id)
);

alter table public.app_ed3_text_backups enable row level security;
revoke all on table public.app_ed3_text_backups from public, anon, authenticated, service_role;
grant select (id, workspace_id, source, row_id, row_updated_at, backed_up_at) on table public.app_ed3_text_backups to authenticated;

create policy ed3_text_backups_owner_read on public.app_ed3_text_backups for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

insert into public.app_ed3_text_backups (workspace_id, source, row_id, row_updated_at, raw_text, metadata)
  select n.workspace_id, n.kind, n.id, n.updated_at, n.raw_text, n.metadata
  from public.app_notes n
  where n.kind in ('note', 'basket', 'diary');

insert into public.app_ed3_text_backups (workspace_id, source, row_id, row_updated_at, raw_text, metadata)
  select o.workspace_id, 'org_update', u.id, (to_jsonb(u) ->> 'updated_at')::timestamptz, u.raw_text, null
  from public.app_suborganization_updates u
  join public.app_suborganizations o on o.id = u.organization_id
  where u.id is not null;

insert into public.app_ed3_text_backups (workspace_id, source, row_id, row_updated_at, raw_text, metadata)
  select s.workspace_id, 'project_record', p.id, (to_jsonb(p) ->> 'updated_at')::timestamptz, p.summary, null
  from public.app_project_progress_updates p
  join public.app_spaces s on s.id = p.project_id
  where p.id is not null;

-- 사후 확인: 원본 행 수와 백업 행 수가 출처마다 같고(조직·프로젝트에 붙지 않은 기록이 있으면 멈춤), 글자가 그대로이며,
-- RLS 켜짐, anon·PUBLIC 권한 없음, 내용 칸 권한은 아무에게도 없음, 정책은 소유자 읽기 하나뿐. 다르면 전체 취소.
do $$
begin
  if (select count(*) from public.app_ed3_text_backups where source in ('note', 'basket', 'diary'))
       <> (select count(*) from public.app_notes where kind in ('note', 'basket', 'diary'))
     or (select count(*) from public.app_ed3_text_backups where source = 'org_update')
       <> (select count(*) from public.app_suborganization_updates)
     or (select count(*) from public.app_ed3_text_backups where source = 'project_record')
       <> (select count(*) from public.app_project_progress_updates)
     or exists (select 1 from public.app_ed3_text_backups b join public.app_notes n on n.id = b.row_id
           where b.source in ('note', 'basket', 'diary')
             and (n.raw_text is distinct from b.raw_text or n.metadata is distinct from b.metadata
                  or n.updated_at is distinct from b.row_updated_at or n.kind <> b.source))
     or not exists (select 1 from pg_class where oid = 'public.app_ed3_text_backups'::regclass and relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_ed3_text_backups'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_ed3_text_backups'::regclass and attacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_ed3_text_backups'::regclass
           and attname in ('raw_text', 'metadata') and attacl is not null)
     or (select count(*) from pg_policy where polrelid = 'public.app_ed3_text_backups'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_ed3_text_backups'::regclass
         and polcmd = 'r' and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
    raise exception 'ED3_TEXT_BACKUP_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024190000', 'ed3_text_backup', array['ED③ backup: private table app_ed3_text_backups (RLS, all privileges revoked; owner reads id/time columns only) + one-time copy of note/basket/diary, org update and project record text before the markdown note conversion']);
commit;
