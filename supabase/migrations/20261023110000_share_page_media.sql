begin;
-- ED-통합편집기 ② 공유 사진 보관(DB). 설계: docs/design/unified-editor.md 5절.
-- 새 표 1개(app_share_page_media)만 만든다. 기존 표·정책·함수·자료는 바꾸지 않는다. 사진 파일은 비공개 버킷에 두고(버킷은 대시보드에서 따로 만든다),
-- 이 표에는 "어느 페이지의 어느 파일인지"만 적는다. 저장 경로는 페이지 id/사진 id.jpg 한 가지 모양만 받는다.
-- authenticated: owner만 읽기·쓰기(private.app_is_workspace_owner). service_role(공유 읽기 Edge): 읽기에 필요한 칸만 SELECT.
-- anon·PUBLIC 권한과 공개 정책은 없다. 로그인 없는 사람은 share-page-read가 링크 지문을 확인한 뒤에만 짧은 사진 주소를 받는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023110000')
     or to_regclass('public.app_share_page_media') is not null
     or to_regclass('public.app_share_pages') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'SHARE_MEDIA_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_share_page_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  page_id uuid not null references public.app_share_pages(id) on delete cascade,
  storage_path text not null,
  width integer not null,
  height integer not null,
  bytes integer not null,
  created_at timestamptz not null default now(),
  constraint app_share_page_media_path_check check (storage_path = page_id::text || '/' || id::text || '.jpg'),
  constraint app_share_page_media_size_check check (width between 1 and 8000 and height between 1 and 8000 and bytes between 1 and 3145728)
);
create index app_share_page_media_page_idx on public.app_share_page_media(page_id);

alter table public.app_share_page_media enable row level security;
revoke all on table public.app_share_page_media from public, anon, authenticated, service_role;
grant select, delete on table public.app_share_page_media to authenticated;
grant insert (id, workspace_id, page_id, storage_path, width, height, bytes) on table public.app_share_page_media to authenticated;
grant select (id, page_id, storage_path) on table public.app_share_page_media to service_role;

create policy share_page_media_owner_all on public.app_share_page_media for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_share_pages p
      where p.id = page_id and p.workspace_id = app_share_page_media.workspace_id));

do $$
begin
  if not exists (select 1 from pg_class where oid = 'public.app_share_page_media'::regclass and relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_share_page_media'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_share_page_media'::regclass and attacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_share_page_media'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_share_page_media'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
    raise exception 'SHARE_MEDIA_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261023110000', 'share_page_media', array['ED-통합편집기 ②: app_share_page_media, owner RLS, no anon, service_role column SELECT only']);
commit;
