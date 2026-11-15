begin;
-- MTG-한줄업데이트 DB (요청함 2026-10-29 08:59 '사업 보고 [+] 메뉴에 한 줄 업데이트', 명진 09:01 '추천대로').
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
-- 선행: 20261022182319_bizreport_activity_kind(칸 여덟 개)·20261028191500_bizreport_area_next_plan(사업영역 꼬리표) 적용 뒤.
--
-- 무엇: 사업 보고 칸 검사(app_meetings_activity_kind_check) 하나만 바꾼다(지우고 같은 이름으로 다시 만듦).
--   여덟 칸(meeting·policy·negotiation·press·assembly·struggle·education·other)에 아홉째 'oneline'(한 줄 업데이트)을 더한다.
--   한 줄 업데이트 = 사업영역 꼬리표(business_area_id)를 단 가벼운 사업 보고 한 건(기록은 사업 보고 한 곳에만, 10/28 18:47 원칙).
--   새 표·새 칸·새 권한 없음. 기본값('meeting')·기존 기록은 그대로다.
--   꼬리표 필수는 화면이 확인한다(DB 검사로 묶지 않음: 사업영역을 영구 삭제하면 꼬리표가 비워지는 기존 동작 on delete set null과 부딪힘).
-- 권한: 표 grant·정책·RLS·함수·트리거·색인 변경 없음. 기존 owner 정책(task12a_owner_all)과 좁히기 정책 그대로 소유자만 읽고 쓴다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029160000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261022182319' and name = 'bizreport_activity_kind') <> 1
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261028191500' and name = 'bizreport_area_next_plan') <> 1
     or to_regclass('public.app_meetings') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_meetings'::regclass and not attisdropped
         and attname = 'business_area_id' and atttypid = 'uuid'::regtype)
     -- 칸 검사 1개, 검증됨, 여덟 값 그대로(oneline 없음). 쓰기 요청 = 표 소유자로 돌아 information_schema가 행을 본다.
     or (select count(*) from pg_constraint where conrelid = 'public.app_meetings'::regclass
         and conname = 'app_meetings_activity_kind_check' and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_meetings_activity_kind_check'
           and check_clause ~ 'education' and check_clause ~ 'other' and check_clause !~ 'oneline') <> 1
     or exists (select 1 from public.app_meetings where activity_kind not in
         ('meeting', 'policy', 'negotiation', 'press', 'assembly', 'struggle', 'education', 'other'))
     -- app_meetings: RLS 켜짐, anon·PUBLIC 표 권한 없음.
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     -- 넓히는(permissive) 정책은 task12a 한 개 그대로(소유자만).
     or (select count(*) from pg_policy where polrelid = 'public.app_meetings'::regclass and polpermissive) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_meetings' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id'
           and regexp_replace(with_check, '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') <> 1 then
    raise exception 'BIZREPORT_ONELINE_KIND_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_meetings drop constraint app_meetings_activity_kind_check;
alter table public.app_meetings
  add constraint app_meetings_activity_kind_check check (activity_kind in
    ('meeting', 'policy', 'negotiation', 'press', 'assembly', 'struggle', 'education', 'other', 'oneline'));

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 넓히는 정책 하나), 칸 검사 1개가 검증된 아홉 값. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_meetings'::regclass and polpermissive) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_meetings'::regclass
         and conname = 'app_meetings_activity_kind_check' and contype = 'c' and convalidated) <> 1
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_meetings_activity_kind_check'
           and check_clause ~ 'education' and check_clause ~ 'oneline') <> 1 then
    raise exception 'BIZREPORT_ONELINE_KIND_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029160000', 'bizreport_oneline_kind', array['MTG-한줄업데이트 DB: app_meetings_activity_kind_check accepts a ninth kind "oneline" (one-line business area update), no grants/policies/functions']);
commit;
