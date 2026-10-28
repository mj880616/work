begin;
-- MTG-프로젝트합치기 1단계 DB (docs/design/project-into-report.md 3·4절, 요청함 2026-10-28 18:47).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
-- 선행: 없음(화면은 다음 세션. 화면이 이 칸을 쓰기 전에 적용해도 지금 동작은 그대로다).
--
-- 무엇: 사업 보고 표(app_meetings)에 칸 두 개를 더한다(Expand만, 기존 칸·기록은 그대로).
--   1) business_area_id uuid — '사업영역 꼬리표'. 지금 프로젝트 표(app_spaces, 사업영역 › 세부 과제 › 사안 트리)의 한 행을 가리킨다.
--      새 분류표를 만들지 않고 프로젝트 표를 그대로 분류표로 쓴다. 한 보고 = 꼬리표 하나(사업 요약 표의 한 칸).
--      비워도 된다. 프로젝트를 영구 삭제하면 꼬리표만 비워진다(on delete set null, 보고는 남음).
--      기존 project_id(연결 함수 app_meeting_set_links가 '첫 연결 프로젝트'로 다시 맞추는 칸)는 그대로 두고 함께 쓰지 않는다:
--      그 칸은 연결을 고칠 때마다 바뀌어 사용자가 고른 분류로 쓸 수 없다(설계 3.2절). 기존 행은 채우지 않는다(화면이 project_id로 대신 보여 줌).
--   2) next_plan text — '다음 할 일'(주간보고 사업 요약 표의 '이후 계획'). 비워도 된다, 1000자 이하.
--   3) 같은 업무공간 확인: 좁히기 전용(restrictive) 정책 하나. 꼬리표가 다른 업무공간의 프로젝트를 가리키는 행은 읽기·쓰기 모두 막는다.
--      기존 정책(task12a_owner_all·app_meetings_trash_hidden)은 고치지 않는다.
-- 권한: 표 grant 변경 없음(기존 표 단위 권한 그대로 — 새 칸도 소유자만 읽고 씀). 함수·트리거·색인 추가 없음. anon·PUBLIC 권한 없음.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028191500')
     or to_regclass('public.app_meetings') is null
     or to_regclass('public.app_spaces') is null
     -- 새 칸·검사·외래키·정책이 아직 없다.
     or exists (select 1 from pg_attribute where attrelid = 'public.app_meetings'::regclass and not attisdropped
         and attname in ('business_area_id', 'next_plan'))
     or exists (select 1 from pg_constraint where conrelid = 'public.app_meetings'::regclass
         and conname in ('app_meetings_business_area_id_fkey', 'app_meetings_next_plan_check'))
     or exists (select 1 from pg_policy where polrelid = 'public.app_meetings'::regclass and polname = 'app_meetings_business_area_ws')
     -- 같은 업무공간 확인 함수(20260916030032)가 그대로 있다: SECURITY DEFINER, uuid 두 개, boolean.
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_space_in_workspace(uuid,uuid)')
         and prosecdef and prorettype = 'boolean'::regtype)
     -- 기존 칸: workspace_id uuid, 프로젝트 id uuid(외래키 대상).
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_meetings'::regclass and not attisdropped
         and attname = 'workspace_id' and atttypid = 'uuid'::regtype)
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_spaces'::regclass and not attisdropped
         and attname = 'id' and atttypid = 'uuid'::regtype)
     -- app_meetings: RLS 켜짐, anon·PUBLIC 표 권한 없음.
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     -- 넓히는(permissive) 정책은 task12a 한 개 그대로(소유자만).
     or (select count(*) from pg_policy where polrelid = 'public.app_meetings'::regclass and polpermissive) <> 1
     or not exists (select 1 from pg_policy where polrelid = 'public.app_meetings'::regclass
         and polname = 'task12a_owner_all' and polpermissive and polcmd = '*'
         and polroles = array['authenticated'::regrole]::oid[]
         and regexp_replace(pg_get_expr(polqual, polrelid), '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id'
         and regexp_replace(pg_get_expr(polwithcheck, polrelid), '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') then
    raise exception 'BIZREPORT_AREA_NEXT_PLAN_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1·2) 칸 두 개. 기존 행은 둘 다 비어 있다(표 다시 쓰기 없음).
alter table public.app_meetings
  add column business_area_id uuid
    constraint app_meetings_business_area_id_fkey references public.app_spaces(id) on delete set null,
  add column next_plan text
    constraint app_meetings_next_plan_check check (char_length(next_plan) <= 1000);

-- 3) 같은 업무공간 확인(좁히기만). 꼬리표가 비어 있으면 통과.
create policy app_meetings_business_area_ws on public.app_meetings as restrictive
  for all to authenticated
  using (business_area_id is null or private.app_space_in_workspace(business_area_id, workspace_id))
  with check (business_area_id is null or private.app_space_in_workspace(business_area_id, workspace_id));

-- 사후 확인: 권한 경계 그대로, 새 칸은 모두 비어 있음, 넓히는 정책은 여전히 하나. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_meetings'::regclass and polpermissive) <> 1
     or not exists (select 1 from pg_policy where polrelid = 'public.app_meetings'::regclass
         and polname = 'app_meetings_business_area_ws' and not polpermissive and polcmd = '*'
         and polroles = array['authenticated'::regrole]::oid[])
     or (select count(*) from pg_attribute where attrelid = 'public.app_meetings'::regclass and not attisdropped
         and ((attname = 'business_area_id' and atttypid = 'uuid'::regtype and not attnotnull)
           or (attname = 'next_plan' and atttypid = 'text'::regtype and not attnotnull))) <> 2
     or (select count(*) from pg_constraint where conrelid = 'public.app_meetings'::regclass and conname = 'app_meetings_business_area_id_fkey'
         and contype = 'f' and confrelid = 'public.app_spaces'::regclass and confdeltype = 'n') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_meetings'::regclass and conname = 'app_meetings_next_plan_check'
         and contype = 'c' and convalidated) <> 1
     or exists (select 1 from public.app_meetings where business_area_id is not null or next_plan is not null) then
    raise exception 'BIZREPORT_AREA_NEXT_PLAN_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261028191500', 'bizreport_area_next_plan', array['MTG-프로젝트합치기 1단계 DB: app_meetings.business_area_id uuid (FK app_spaces on delete set null) + next_plan text (<=1000) + restrictive same-workspace policy app_meetings_business_area_ws (no grants/functions/triggers/indexes)']);
commit;
