begin;
-- 20261124080000_app_lock_whole_app의 짝 되돌리기. features 검사와 목록 도우미를 앞 단계(20261119200000_feature_pin_lock) 정의로 되돌리고 이번 기록 1행만 지운다.
-- 되돌리기 전에 화면을 '앱 전체' 스위치가 없는 이전 판으로 되돌린다(화면이 'app'을 보내지 않게).
-- 이미 '앱 전체'를 켠 사람의 줄에서는 'app' 한 이름만 뺀다(PIN·다른 잠근 기능·다시 잠그기는 그대로) — 그래야 옛 검사가 통과한다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 함수 다시 만들기·자료 고치기를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261124080000' and name = 'app_lock_whole_app') <> 1 then
    raise exception 'APP_LOCK_WHOLE_APP_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

update public.app_feature_locks
   set features = pg_catalog.array_remove(features, 'app'), updated_at = now()
 where 'app' = any (features);

alter table public.app_feature_locks drop constraint app_feature_locks_features_check;
alter table public.app_feature_locks add constraint app_feature_locks_features_check check (
  cardinality(features) <= 4 and features <@ array['diary', 'photos', 'calls', 'telegram']::text[]);

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
                  where f is null or not (f = any (array['diary', 'photos', 'calls', 'telegram']::text[]))) then null
    else coalesce((select pg_catalog.array_agg(distinct f order by f) from pg_catalog.unnest(p_features) f), '{}'::text[])
  end
$$;
revoke all on function private.app_lock_clean_features(text[]) from public, anon, authenticated, service_role;

delete from supabase_migrations.schema_migrations
  where version = '20261124080000' and name = 'app_lock_whole_app';
commit;
