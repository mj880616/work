begin;
-- S50-31 PHOTO-정보고치기 ② DB(설계 docs/design/photo-info-edit.md 5-3·8절, 명진 결정 E3 (가)): 되돌리기 기록 표의 출처 허용 값 넓히기만.
-- 무엇: public.app_photo_info_edits의 출처 검사(app_photo_info_edits_source_check)를 지우고 같은 이름으로 다시 만든다:
--   기존 'phone' + 'onedrive'(원드라이브 사진, 열쇠 od:<item id>)·'gdrive'(구글 드라이브 사진, 열쇠 gd:<file id>).
-- 안 하는 것: 표·칸·권한·정책·RLS·함수·트리거 변경, 기존 줄 변경, anon·PUBLIC·service_role 권한, rtw_* 객체. 사진 이름·내용은 지금처럼 넣지 않는다.
-- 앞 단계: 20261103140000_photo_info_edits(표 만들기)가 먼저 적용되어 있어야 한다(없으면 멈춤).
-- 짝: docs/20261105220000_photo_info_cloud_sources.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_photo_info_edits in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261105220000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261103140000' and name = 'photo_info_edits') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_photo_info_edits'::regclass and conname = 'app_photo_info_edits_source_check'
         and contype = 'c' and convalidated and pg_get_constraintdef(oid) ~ '''phone''' and pg_get_constraintdef(oid) !~ '''onedrive''') <> 1 then
    raise exception 'PHOTO_INFO_CLOUD_SOURCES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_photo_info_edits drop constraint app_photo_info_edits_source_check;
alter table public.app_photo_info_edits add constraint app_photo_info_edits_source_check check (source in ('phone', 'onedrive', 'gdrive'));

-- 마지막 확인: 검사가 새 모양으로 하나, 정책 하나·RLS 켜짐·anon/PUBLIC 권한 없음 그대로. 어긋나면 전체 취소.
do $$
declare t regclass := 'public.app_photo_info_edits'::regclass;
begin
  if (select count(*) from pg_constraint where conrelid = t and conname = 'app_photo_info_edits_source_check'
        and convalidated and pg_get_constraintdef(oid) ~ '''phone''' and pg_get_constraintdef(oid) ~ '''onedrive''' and pg_get_constraintdef(oid) ~ '''gdrive''') <> 1
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or exists (select 1 from pg_class where oid = t and (not relrowsecurity or coalesce(relacl::text, '') ~ '(^|[{,])(anon)?='))
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', t, 'delete,truncate,references,trigger') then
    raise exception 'PHOTO_INFO_CLOUD_SOURCES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261105220000', 'photo_info_cloud_sources', array['S50-31 PHOTO-정보고치기 ②: app_photo_info_edits_source_check recreated with the extra sources onedrive and gdrive (no table, column, grant, policy, function or row change)']);
commit;
