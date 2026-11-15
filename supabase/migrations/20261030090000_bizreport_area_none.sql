begin;
-- MTG-사업영역없음 DB (요청함 2026-10-30 07:51 '사업 보고 사업영역 고르기에 [없음] 추가', 명진 07:51 '추천대로').
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 적용 직전 정지.
-- 선행: 20261028191500_bizreport_area_next_plan(사업영역 꼬리표 business_area_id) 적용 뒤.
--
-- 무엇: 사업 보고 표(app_meetings)에 칸 하나를 더한다(Expand만, 기존 칸·기록은 그대로).
--   business_area_none boolean not null default false — '사업영역 없음'을 사용자가 직접 고른 보고.
--   지금은 business_area_id가 비어 있으면 '아직 안 고름'과 '사업영역이 없는 보고(노조 상집 등)'를 구분할 수 없어
--   '사업영역 안 단 보고 n건'에 계속 남는다. 꼬리표 칸은 사업영역 표(app_spaces) 외래키라 빈 값 말고 다른 표시를 담을 수 없다.
--   규칙: 꼬리표(business_area_id)가 있으면 꼬리표가 이긴다. 화면은 사업영역을 고르면 이 칸을 false로, [없음]을 고르면
--   꼬리표를 비우고 true로 함께 보낸다. DB 검사로 묶지 않는다(이 칸을 모르는 옛 화면이 꼬리표만 보내도 저장이 막히지 않게).
--   기존 행은 모두 false(=지금 뜻 그대로). 상수 기본값이라 표를 다시 쓰지 않는다.
-- 권한: 표 grant 변경 없음(기존 표 단위 권한 그대로 — 새 칸도 소유자만 읽고 씀). 정책·함수·트리거·색인 추가 없음. anon·PUBLIC 권한 없음.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_meetings in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다(pg_catalog만 읽는다).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261030090000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261028191500' and name = 'bizreport_area_next_plan') <> 1
     or to_regclass('public.app_meetings') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_meetings'::regclass and not attisdropped
         and attname = 'business_area_id' and atttypid = 'uuid'::regtype)
     -- 새 칸이 아직 없다.
     or exists (select 1 from pg_attribute where attrelid = 'public.app_meetings'::regclass and not attisdropped
         and attname = 'business_area_none')
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
    raise exception 'BIZREPORT_AREA_NONE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_meetings
  add column business_area_none boolean not null default false;

-- 사후 확인: 권한 경계 그대로, 새 칸은 boolean·필수·기본 false·모두 false, 넓히는 정책은 여전히 하나. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_meetings'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_meetings'::regclass and polpermissive) <> 1
     or (select count(*) from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
         where a.attrelid = 'public.app_meetings'::regclass and not a.attisdropped and a.attname = 'business_area_none'
           and a.atttypid = 'boolean'::regtype and a.attnotnull and pg_get_expr(d.adbin, d.adrelid) = 'false') <> 1
     or exists (select 1 from public.app_meetings where business_area_none) then
    raise exception 'BIZREPORT_AREA_NONE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261030090000', 'bizreport_area_none', array['MTG-사업영역없음 DB: app_meetings.business_area_none boolean not null default false (user chose "no business area"; the tag wins when set), no grants/policies/functions/triggers/indexes']);
commit;
