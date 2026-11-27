-- S73-01 NEWS-본문하루 ② 되돌리기 — ★ SQL Editor(폰 경로 C) 전용 ★ 새 쿼리 창(+)에서 한 번.
-- private.app_retention_daily()를 이 작업 전 본문(docs/ops/retention-daily.apply.sql 조각 ①과 한 글자도 같음)으로 되돌린다. 예약은 그대로.
-- 그 뒤 필요하면 supabase/migrations/20261127180000_news_body_trim.sql의 짝 rollback(docs/20261127180000_news_body_trim.rollback.sql)으로 새 함수를 지운다.
-- 비운 본문은 되살리지 않는다(화면은 그 글을 '원래 사이트 ↗'로 보인다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
begin
  if to_regprocedure('public.app_news_trim_bodies(timestamptz,integer)') is null
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261127180000' and name = 'news_body_trim') <> 1
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_retention_daily()') and not prosecdef
         and proconfig = array['search_path=""'] and md5(prosrc) = '4fb863fc9fabc60cd7899fe59308ac0e')
     or (select count(*) from cron.job where jobname = 'web2_retention_daily' and schedule = '43 17 * * *' and active) <> 1 then
    raise exception 'NEWS_BODY_TRIM_DAILY_ROLLBACK_BLOCKED: daily function differs from the S73-01 version; stop';
  end if;
end
$$;

create or replace function private.app_retention_daily()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $retention$
declare
  v_news integer := 0;
  v_outside integer := 0;
  v_cron integer := 0;
  v_backups integer := 0;
  v_n integer;
  r record;
begin
  for i in 1..20 loop
    v_n := public.app_news_prune(pg_catalog.now(), 5000);
    v_news := v_news + v_n;
    exit when v_n = 0;
  end loop;
  for i in 1..20 loop
    v_n := public.app_outside_prune(pg_catalog.now(), 5000);
    v_outside := v_outside + v_n;
    exit when v_n = 0;
  end loop;

  delete from cron.job_run_details where coalesce(end_time, start_time) < pg_catalog.now() - interval '7 days';
  get diagnostics v_cron = row_count;

  if pg_catalog.to_regnamespace('ops_backup') is not null then
    insert into private.app_ops_backup_seen (name)
      select c.relname from pg_catalog.pg_class c
       where c.relnamespace = pg_catalog.to_regnamespace('ops_backup') and c.relkind = 'r'
         and c.relname ~ '^[0-9]{14}_[a-z0-9_]+_[0-9]+$' and pg_catalog.char_length(c.relname) <= 63
      on conflict do nothing;
    for r in
      select s.name from private.app_ops_backup_seen s
        join pg_catalog.pg_class c on c.relname = s.name and c.relnamespace = pg_catalog.to_regnamespace('ops_backup') and c.relkind = 'r'
       where s.first_seen_at < pg_catalog.now() - interval '14 days'
         and exists (select 1 from supabase_migrations.schema_migrations m where m.version = pg_catalog.left(s.name, 14))
       order by s.name
    loop
      execute pg_catalog.format('drop table ops_backup.%I', r.name);
      v_backups := v_backups + 1;
    end loop;
    delete from private.app_ops_backup_seen s
     where not exists (select 1 from pg_catalog.pg_class c where c.relname = s.name and c.relnamespace = pg_catalog.to_regnamespace('ops_backup'));
  end if;

  return pg_catalog.jsonb_build_object('news', v_news, 'outside', v_outside, 'cron_runs', v_cron, 'backups', v_backups);
end
$retention$;
revoke all on function private.app_retention_daily() from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_retention_daily()') and not prosecdef
         and proconfig = array['search_path=""'] and md5(prosrc) = 'cc3b09ce4a5868d42dbe5fce4a443619')
     or has_function_privilege('authenticated', 'private.app_retention_daily()', 'execute')
     or has_function_privilege('anon', 'private.app_retention_daily()', 'execute')
     or has_function_privilege('service_role', 'private.app_retention_daily()', 'execute')
     or (select count(*) from cron.job where jobname = 'web2_retention_daily' and schedule = '43 17 * * *' and active) <> 1 then
    raise exception 'NEWS_BODY_TRIM_DAILY_ROLLBACK_POSTCHECK_FAILED; stop';
  end if;
end
$$;
commit;
