begin;
-- SEC-Web1첫페이지: Web1 루트 업무 페이지(index.html)의 카드 보관 상태 표를 로그인 없이 읽기만 되게 한다.
-- 로그인 없는 사용자(anon)·로그인 사용자(authenticated)·PUBLIC의 쓰기 권한(insert·update·delete·truncate·references·trigger)만 회수한다.
-- 읽기(select) 권한·RLS 설정·정책·행·칸은 바꾸지 않는다. 새 권한을 주지 않는다. service_role·소유자(SQL Editor)는 그대로 쓸 수 있다.
-- 선행: 화면이 더 이상 이 표에 쓰지 않는 index.html이 배포된 뒤 적용(쓰기 버튼이 남은 옛 화면은 저장 실패 알림만 뜬다).
-- 짝: docs/20261021200000_web1_archive_state_readonly.*
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261021200000')
     or to_regclass('public.main_project_archive_state') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.main_project_archive_state') and attname = 'card_key' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.main_project_archive_state') and attname = 'archived' and not attisdropped)
     or not has_table_privilege('anon', 'public.main_project_archive_state', 'select') then
    raise exception 'WEB1_ARCHIVE_STATE_PREREQUISITE_CHANGED: table, columns or anon read differ; stop';
  end if;
end
$$;

revoke insert, update, delete, truncate, references, trigger on table public.main_project_archive_state from public, anon, authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.main_project_archive_state', 'insert')
     or has_table_privilege('anon', 'public.main_project_archive_state', 'update')
     or has_table_privilege('anon', 'public.main_project_archive_state', 'delete')
     or has_table_privilege('anon', 'public.main_project_archive_state', 'truncate')
     or has_table_privilege('authenticated', 'public.main_project_archive_state', 'insert')
     or has_table_privilege('authenticated', 'public.main_project_archive_state', 'update')
     or has_table_privilege('authenticated', 'public.main_project_archive_state', 'delete')
     or has_table_privilege('authenticated', 'public.main_project_archive_state', 'truncate')
     or not has_table_privilege('anon', 'public.main_project_archive_state', 'select') then
    raise exception 'WEB1_ARCHIVE_STATE_REVOKE_INCOMPLETE: write still allowed (role membership?) or read lost; rolled back';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261021200000', 'web1_archive_state_readonly', array['SEC-Web1첫페이지: revoke anon/authenticated/public writes on main_project_archive_state (select kept)']);
commit;
