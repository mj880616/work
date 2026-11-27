-- S73-01 NEWS-본문하루 ② 매일 정리가 본문 비우기를 부르게 — ★ SQL Editor(폰 경로 C) 전용 ★
-- 사용자 결정(2026-11-27 17:34): 받은 지 하루 지난 언론 기사는 본문만 지우고 제목·요약·주소는 남긴다. 설계: docs/design/db-retention.md 1-1절.
--
-- 왜 승인형 DB workflow가 아닌가: private.app_retention_daily()는 SQL Editor로 만든 함수(docs/ops/retention-daily.apply.sql 조각 ①)이고,
--   그 본문에 cron.job_run_details 지우기·백업 표 DROP(동적 EXECUTE)이 들어 있어 workflow 차단 목록에 걸린다. 그래서 같은 길(SQL Editor)로 고친다.
--   이번에 더하는 것은 정리 함수 부르기 한 묶음(아래 '바뀌는 곳')과 돌려주는 값 'news_bodies' 하나뿐이다. 그 밖의 줄은 한 글자도 바꾸지 않는다.
-- 앞 단계(반드시 먼저): ① Edge ai-assist 배포(본문을 비운 기사의 저장된 요약을 버리지 않게 — 이 PR의 _shared/now-detail-build.ts) →
--   ② 승인형 workflow로 supabase/migrations/20261127180000_news_body_trim.sql 적용(새 함수) → ③ 화면(이 PR merge로 Pages 배포) → 그 뒤 이 파일.
--
-- 사용법: 조각마다 새 쿼리 창(+)에 따로 붙여 넣고, 첫 줄·마지막 줄(commit;)·대상 프로젝트를 확인한 뒤 실행 → 결과 캡처.
--   조각 사이에는 docs/ops/news-body-trim-daily.precheck.sql(읽기 전용)을 돌려 숫자를 캡처한다.
-- 만약 "cannot execute ... in a read-only transaction" 오류가 나면 같은 창 맨 위에 set session characteristics as transaction read write; 한 줄을 더한다.
-- 남의 기록 안 보기(AGENTS.md 3절): 결과는 비운 줄 수·표 크기뿐이다. 기사 제목·내용·누구 것인지는 읽지 않는다.
-- 되돌리기: docs/ops/news-body-trim-daily.rollback.sql(이전 본문 그대로). 비운 본문은 되살릴 수 없다.
--
-- 바뀌는 곳(이전 본문과의 차이): 언론 지우기(app_news_prune) 반복 뒤, 사회운동 지우기 앞에
--   for i in 1..20 loop v_n := public.app_news_trim_bodies(now(), 5000); v_bodies := v_bodies + v_n; exit when v_n = 0; end loop;
--   를 더하고, 돌려주는 jsonb에 'news_bodies'(비운 기사 줄 수)를 더한다. 이전 본문 해시 cc3b09ce4a5868d42dbe5fce4a443619 → 새 본문 해시 4fb863fc9fabc60cd7899fe59308ac0e.


-- ===== 조각 ① 시작: 매일 정리 함수 고치기 =====
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
begin
  if to_regprocedure('public.app_news_trim_bodies(timestamptz,integer)') is null
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261127180000' and name = 'news_body_trim') <> 1
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_retention_daily()') and not prosecdef
         and proconfig = array['search_path=""'] and md5(prosrc) = 'cc3b09ce4a5868d42dbe5fce4a443619')
     or (select count(*) from cron.job where jobname = 'web2_retention_daily' and schedule = '43 17 * * *' and active) <> 1 then
    raise exception 'NEWS_BODY_TRIM_DAILY_PREREQUISITE_CHANGED: apply the migration first, or the daily function differs from the file; stop';
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
  v_bodies integer := 0;
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
  -- S73-01: 지우지 않고 남은 언론 기사 가운데 받은 지 24시간 지난 것의 본문만 비운다(남길 것 규칙은 함수 안).
  for i in 1..20 loop
    v_n := public.app_news_trim_bodies(pg_catalog.now(), 5000);
    v_bodies := v_bodies + v_n;
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

  return pg_catalog.jsonb_build_object('news', v_news, 'news_bodies', v_bodies, 'outside', v_outside, 'cron_runs', v_cron, 'backups', v_backups);
end
$retention$;
revoke all on function private.app_retention_daily() from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_retention_daily()') and not prosecdef
         and proconfig = array['search_path=""'] and md5(prosrc) = '4fb863fc9fabc60cd7899fe59308ac0e')
     or has_function_privilege('authenticated', 'private.app_retention_daily()', 'execute')
     or has_function_privilege('anon', 'private.app_retention_daily()', 'execute')
     or has_function_privilege('service_role', 'private.app_retention_daily()', 'execute')
     or (select count(*) from cron.job where jobname = 'web2_retention_daily' and schedule = '43 17 * * *' and active) <> 1 then
    raise exception 'NEWS_BODY_TRIM_DAILY_POSTCHECK_FAILED; stop';
  end if;
end
$$;
commit;
-- ===== 조각 ① 끝 =====


-- ===== 조각 ② 시작: 지금 한 번 비우기(다음 새벽을 기다리지 않을 때만) =====
-- 지금 쌓인 하루 지난 기사 본문을 한 번 비운다. 결과 = 비운 기사 줄 수(공용·옛 표 합). 0이 될 때까지 다시 실행해도 된다(이미 비운 기사는 다시 고르지 않음).
begin;
set local lock_timeout = '10s';
set local statement_timeout = '300s';
do $$
declare v_n integer; v_all integer := 0;
begin
  if to_regprocedure('public.app_news_trim_bodies(timestamptz,integer)') is null then
    raise exception 'NEWS_BODY_TRIM_MISSING: apply the migration first; stop';
  end if;
  for i in 1..20 loop
    v_n := public.app_news_trim_bodies(now(), 5000);
    v_all := v_all + v_n;
    exit when v_n = 0;
  end loop;
  raise notice 'news bodies trimmed: %', v_all;
end
$$;
commit;
-- ===== 조각 ② 끝 =====


-- ===== 조각 ③: 디스크 되돌려받기(VACUUM FULL) — 한 줄씩 따로 실행 =====
-- 비우기만 하면 빈자리는 표 안에서 다시 쓰일 뿐 DB 크기(무료 한도 기준)는 줄지 않는다(docs/design/db-retention.md 3절 '디스크를 실제로 줄이는 법').
-- ★ 그 표를 잠근다. KST 14:30~14:55 또는 21:30~21:55처럼 수집(매시 :07·:22) 사이에, begin/commit 없이 한 창에 한 줄만.
--   vacuum (full, analyze) public.app_news_article_bodies;
--   vacuum (full, analyze) public.app_feed_bodies;
--   vacuum (full, analyze) public.app_news_items;
--   vacuum (full, analyze) public.app_news_articles;
-- 끝나면 precheck를 다시 돌려 'database size MB'를 캡처한다.
