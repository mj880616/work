begin;
-- S69-08 SEC-앱전체잠금: 잠글 수 있는 기능 목록에 '앱 전체'(features 키 'app')를 더한다.
-- 명진 11/24 07:44 "잠금 기능 중에서 앱 전체를 잠그는 기능도 있었으면 좋겠는데 어 이것도 켜고 끌 수 있도록".
-- 설계 docs/design/feature-pin-lock.md 9절. 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다.
--
-- 무엇: 앞 단계(20261119200000_feature_pin_lock)의 두 곳만 고친다.
--   1) 표 public.app_feature_locks의 features 검사(4가지 → 'app'을 더한 5가지). 기존 줄은 모두 4가지 안이라 새 검사도 통과한다.
--   2) private 도우미 private.app_lock_clean_features(같은 이름·같은 인자·같은 security invoker·빈 search_path)를 다시 만들어 'app'을 받는다.
--      app_lock_setup·app_lock_save는 이 도우미로 목록을 거르므로 함수 자체는 고치지 않는다.
-- 보안(AGENTS.md 3절): 잠금은 화면 가림(편의 장치)이고 자료 권한(owner 경계·RLS)은 그대로다.
--   표의 RLS·정책·권한, 공개 함수 6개·노트 폴더 함수, 다른 표는 한 줄도 바꾸지 않는다. 도우미 실행권은 지금처럼 아무에게도 없다.
-- 짝: docs/20261124080000_app_lock_whole_app.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261124080000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261119200000' and name = 'feature_pin_lock') <> 1
     or to_regclass('public.app_feature_locks') is null
     or to_regprocedure('private.app_lock_clean_features(text[])') is null
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_feature_locks')
                     and conname = 'app_feature_locks_features_check')
     or exists (select 1 from public.app_feature_locks
                 where not (features <@ array['diary', 'photos', 'calls', 'telegram']::text[])) then
    raise exception 'APP_LOCK_WHOLE_APP_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_feature_locks drop constraint app_feature_locks_features_check;
alter table public.app_feature_locks add constraint app_feature_locks_features_check check (
  cardinality(features) <= 5 and features <@ array['app', 'diary', 'photos', 'calls', 'telegram']::text[]);

-- 잠글 기능 목록 정리: 정해진 5가지('app' = 앱 전체) 안에서 겹침 없이 정렬. 모르는 이름이 있으면 null.
create or replace function private.app_lock_clean_features(p_features text[])
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_features is null then '{}'::text[]
    when exists (select 1 from pg_catalog.unnest(p_features) f
                  where f is null or not (f = any (array['app', 'diary', 'photos', 'calls', 'telegram']::text[]))) then null
    else coalesce((select pg_catalog.array_agg(distinct f order by f) from pg_catalog.unnest(p_features) f), '{}'::text[])
  end
$$;
revoke all on function private.app_lock_clean_features(text[]) from public, anon, authenticated, service_role;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261124080000', 'app_lock_whole_app', array['S69-08 whole app lock: app_feature_locks features check widened from 4 to 5 names by adding app (whole app screen lock); private.app_lock_clean_features recreated with the same signature, invoker, empty search_path and no execute grants to accept app; app_lock_setup and app_lock_save unchanged and keep using it; no RLS, policy, grant, public function or row change; no anon or PUBLIC privilege']);
commit;
