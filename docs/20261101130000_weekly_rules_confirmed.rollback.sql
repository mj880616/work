begin;
-- 20261101130000_weekly_rules_confirmed의 짝 되돌리기. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow의 rollback 모드는 자료 UPDATE를 막는다).
-- 운영자 작업공간의 새 모양 규칙 칸 하나를 옛 모양 {"at","week","lines"}로 되돌린다: 후보 줄 + 옛 폐기 줄(맨 앞에 넣은 폐기 1줄은 뺌)을 lines로,
-- 확정 줄은 뺀다. 옛 줄의 고침·더함 표시는 되살리지 않는다(모두 자동 줄로). 적용 뒤 명진이 후보를 확정하거나 고친 것도 함께 사라지므로,
-- 그 뒤에 되돌릴 때는 적용 직전 자동 사본(ops_backup)의 규칙 칸을 먼저 본다. 그 밖의 행·칸·권한·정책은 건드리지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_weekly_exec_requests in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261101130000' and name = 'weekly_rules_confirmed') <> 1 then
    raise exception 'WEEKLY_RULES_CONFIRMED_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if (select count(*) from public.app_weekly_exec_requests q
      where (q.draft -> 'rules' ->> 'v') = '2'
        and q.workspace_id = (select f.workspace_id from public.app_operator_features f where f.feature = 'calls')) <> 1 then
    raise exception 'WEEKLY_RULES_CONFIRMED_ROLLBACK_BLOCKED: split rules row differs';
  end if;
end
$$;

update public.app_weekly_exec_requests r
  set draft = jsonb_set(r.draft, '{rules}', jsonb_strip_nulls(jsonb_build_object(
        'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'week', r.draft -> 'rules' -> 'week',
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('text', x.t, 'from', 'auto') order by x.k, x.n), '[]'::jsonb)
          from (select 1 as k, e.n, e.v ->> 'text' as t from jsonb_array_elements(coalesce(r.draft -> 'rules' -> 'candidates', '[]'::jsonb)) with ordinality e(v, n)
                union all
                select 2, e.n, e.v ->> 'text' from jsonb_array_elements(coalesce(r.draft -> 'rules' -> 'retired', '[]'::jsonb)) with ordinality e(v, n) where e.n > 1) x
          where coalesce(x.t, '') <> '')))),
      draft_saved_at = now()
  where (r.draft -> 'rules' ->> 'v') = '2'
    and r.workspace_id = (select f.workspace_id from public.app_operator_features f where f.feature = 'calls');

delete from supabase_migrations.schema_migrations
  where version = '20261101130000' and name = 'weekly_rules_confirmed';
commit;
