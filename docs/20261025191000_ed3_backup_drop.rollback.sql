begin;
-- 20261025191000_ed3_backup_drop의 짝 되돌리기. 비공개 백업 표 public.app_ed3_text_backups의 "구조"만 다시 만든다(칸·제약·RLS·권한·소유자 읽기 정책이 20261024190000 원문과 같다).
-- 주의: 지운 백업 원문(raw_text·metadata)은 돌아오지 않는다. 다시 만든 표는 비어 있고, 노트 변환용 백업으로는 쓸 수 없다.
-- 표가 이미 있으면(적용 전이거나 이미 되돌렸으면) 멈춘다. 20261024190000 기록 1행은 그대로 둔다. 이번 기록 1행만 지운다.
-- SQL Editor(폰 경로 C) 전용이다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.app_ed3_text_backups') is not null
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261025191000' and name = 'ed3_backup_drop') <> 1
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261024190000' and name = 'ed3_text_backup') <> 1
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'ED3_BACKUP_DROP_ROLLBACK_BLOCKED: state differs';
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

delete from supabase_migrations.schema_migrations
  where version = '20261025191000' and name = 'ed3_backup_drop';
commit;
