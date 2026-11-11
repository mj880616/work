begin;
-- 20261111181000_library_receive_folder의 짝 되돌리기(SQL Editor 새 쿼리 창에서 실행 — 폰 경로 C 가능).
-- 넣기 뒤 트리거·그 함수·받는 폴더 칸(외래 키·색인 함께)을 지우고 이번 기록 1행만 지운다.
-- 켜 둔 받는 폴더 설정(사람마다 폴더 id 하나)은 함께 없어진다. 이미 받는 폴더에 들어간 자료는 그 폴더에 그대로 있다(자료·폴더 연결 행은 건드리지 않음).
-- 화면은 칸이 없으면 메뉴 줄을 숨기고 지금처럼 '폴더 밖'으로 동작한다. 표 권한·정책·다른 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261111181000' and name = 'library_receive_folder') <> 1 then
    raise exception 'LIBRARY_RECEIVE_FOLDER_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop trigger app_documents_receive_folder on public.app_documents;
drop function private.app_documents_receive_folder();
drop index public.app_profiles_library_receive_folder_idx;
alter table public.app_profiles drop constraint app_profiles_library_receive_folder_fkey;
alter table public.app_profiles drop column library_receive_folder;

delete from supabase_migrations.schema_migrations where version = '20261111181000' and name = 'library_receive_folder';
commit;
