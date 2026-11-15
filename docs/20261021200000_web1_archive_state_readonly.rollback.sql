begin;
-- 되돌리기: 적용 전 쓰기 권한을 다시 준다. 기본값은 Supabase가 public 표에 주는 기본 권한(anon·authenticated 전체)이다.
-- 실행 전 snapshot 캡처의 'grant' 줄과 대조해, 적용 전에 없던 권한은 아래 grant 목록에서 빼고 실행한다(권한을 원래보다 넓히지 않기).
-- 행·정책·RLS·select 권한은 건드리지 않는다. 되돌리면 로그인 없이 누구나 카드 보관 상태를 바꿀 수 있는 원래 위험도 돌아온다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
grant insert, update, delete, truncate, references, trigger on table public.main_project_archive_state to anon, authenticated;
delete from supabase_migrations.schema_migrations where version = '20261021200000' and name = 'web1_archive_state_readonly';
commit;
