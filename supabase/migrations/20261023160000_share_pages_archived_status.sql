begin;
-- SHARE-페이지삭제 (2026-10-23 사용자 요청): 공유 페이지를 "삭제"하면 서버 기록은 지우지 않고 목록에서만 뺀다(보관).
-- 보관 표시는 기존 status 칸에 세 번째 값 'archived'를 받는 것으로 한다(새 칸·새 권한 없음).
-- 보관된 페이지는 share-page-read가 status = 'published'만 보여 주므로 공개 링크도 저절로 404가 된다(Edge 변경 없음).
-- 링크 행(app_share_page_links)·사진 기록·사진 파일은 건드리지 않는다. 되돌리기는 화면이 status를 원래 값으로 고치는 것이다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_share_pages_status_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦): draft·published → draft·published·archived.
-- 권한: 표 grant·정책·RLS·함수·트리거 변경 없음. 기존 열 권한(update status)과 owner 정책 그대로.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_share_pages in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 기록 있음, RLS 켜짐, anon·PUBLIC 표 권한 없음,
-- owner 정책 1개, 상태 검사 1개(검증됨, draft·published만 허용), 지금 상태 값이 모두 draft·published.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023160000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261020005000' and name = 'share_pages_links') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_share_pages'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_share_pages'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_share_pages'::regclass) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_share_pages'::regclass and conname = 'app_share_pages_status_check') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_share_pages'::regclass and conname = 'app_share_pages_status_check'
         and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_share_pages_status_check'
           and check_clause ~ 'draft' and check_clause ~ 'published' and check_clause !~ 'archived') <> 1
     or exists (select 1 from public.app_share_pages where status not in ('draft', 'published')) then
    raise exception 'SHARE_ARCHIVED_STATUS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_share_pages drop constraint app_share_pages_status_check;
alter table public.app_share_pages
  add constraint app_share_pages_status_check check (status in ('draft', 'published', 'archived'));

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 정책 1개), 상태 검사 1개가 검증된 상태. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_share_pages'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_share_pages'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_share_pages'::regclass) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_share_pages'::regclass and conname = 'app_share_pages_status_check'
         and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_share_pages_status_check' and check_clause ~ 'archived') <> 1 then
    raise exception 'SHARE_ARCHIVED_STATUS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261023160000', 'share_pages_archived_status', array['SHARE-페이지삭제: app_share_pages_status_check accepts a third value "archived" (hidden from the list and from share-page-read), no grants/policies/functions']);
commit;
