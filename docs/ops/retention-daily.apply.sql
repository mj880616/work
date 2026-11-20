-- S67-24 DB-보관기간정리 ② 매일 정리 예약·한 번 정리·디스크 되돌려받기 — ★ SQL Editor(폰 경로 C) 전용 ★
-- 명진 결정 11/20 10:51·10:52: 언론 기사 3일, 사회운동 매체 2개월, 나머지 지워도 되는 것은 다 지움. 설계·근거: docs/design/db-retention.md.
--
-- 왜 승인형 DB workflow가 아닌가(docs/ops-db-workflow.md 차단 목록·확장 규칙):
--   · cron.schedule/cron.unschedule(cron 스키마 쓰기)과 cron.job_run_details 지우기 — workflow는 public·private 밖 스키마 쓰기를 받지 않는다.
--   · ops_backup 백업 표 지우기는 DROP TABLE(동적 EXECUTE) — workflow는 drop table·동적 EXECUTE를 막는다(백업 정리는 원래 "별도 승인 SQL" 경로).
--   · private 스키마 새 표 — 확장 규칙은 새 public 표만 받는다.
--   · VACUUM FULL은 거래(begin…commit) 안에서 돌 수 없다.
-- 앞 단계(반드시 먼저): ① Edge news-feed 배포(게시 72시간 넘은 피드 글을 다시 넣지 않는 거르기) → ② 승인형 workflow로
--   supabase/migrations/20261120130000_news_outside_retention.sql 적용(정리 함수 둘). 그 뒤 이 파일.
--
-- 사용법: 조각마다 새 쿼리 창(+)에 따로 붙여 넣고, 첫 줄·마지막 줄(commit;)·대상 프로젝트를 확인한 뒤 실행 → 결과 캡처.
--   조각 사이에는 docs/ops/retention-daily.precheck.sql(읽기 전용 미리 보기)을 돌려 숫자를 캡처한다.
-- 만약 "cannot execute ... in a read-only transaction" 오류가 나면(무료 한도 초과로 읽기 전용이 된 경우), 같은 창 맨 위에
--   set session characteristics as transaction read write;
--   한 줄을 더해 다시 실행한다(그 창에서만 적용, 끝나면 창을 닫는다).
-- 남의 기록 안 보기(AGENTS.md 3절): 이 파일의 결과는 지운 줄 수·표 이름·크기뿐이다. 기사 제목·내용·누구 것인지는 읽지 않는다.


-- ===== 조각 ① 시작: 백업 기록 표·매일 정리 함수·예약 1개 =====
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261120130000' and name = 'news_outside_retention') <> 1
     or to_regprocedure('public.app_news_prune(timestamptz,integer)') is null
     or to_regprocedure('public.app_outside_prune(timestamptz,integer)') is null
     or to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regclass('cron.job_run_details') is null
     or to_regnamespace('private') is null
     or coalesce(current_setting('cron.timezone', true), '') not in ('GMT', 'UTC', 'Etc/UTC')
     or exists (select 1 from cron.job where jobname = 'web2_retention_daily')
     or to_regclass('private.app_ops_backup_seen') is not null
     or to_regprocedure('private.app_retention_daily()') is not null then
    raise exception 'RETENTION_DAILY_PREREQUISITE_CHANGED: apply the migration first, or already installed; stop';
  end if;
end
$$;

-- 백업 사본을 처음 본 날. workflow가 만드는 백업 표 이름(<version>_<표>_<실행 번호>)에는 만든 시각이 없어서, 매일 정리가 처음 본 날을 적어 '14일'을 센다.
-- 지금 있는 백업은 오늘을 처음 본 날로 적는다(그래서 14일 뒤에 지워짐) — 11/15·16·19 뉴스 백업만 조각 ②에서 바로 지운다(명진 결정).
create table private.app_ops_backup_seen (
  name text primary key,
  first_seen_at timestamptz not null default now(),
  constraint app_ops_backup_seen_name_check check (name ~ '^[0-9]{14}_[a-z0-9_]+_[0-9]+$' and char_length(name) <= 63)
);
alter table private.app_ops_backup_seen enable row level security;
revoke all on table private.app_ops_backup_seen from public, anon, authenticated, service_role;
insert into private.app_ops_backup_seen (name)
  select c.relname from pg_class c
   where c.relnamespace = to_regnamespace('ops_backup') and c.relkind = 'r' and c.relname ~ '^[0-9]{14}_[a-z0-9_]+_[0-9]+$' and char_length(c.relname) <= 63
  on conflict do nothing;

-- 매일 정리(예약이 부름, 실행 역할 = 예약 주인). 돌려주는 것은 지운 줄 수·표 수뿐.
--  1) 언론 기사 3일·사회운동 글 2개월(정리 함수 둘, 한 번에 5000줄씩 최대 20번 — 남길 것 규칙은 함수 안).
--  2) 예약 실행 기록(cron.job_run_details) 7일치만 남김.
--  3) 백업 사본: 그 migration 기록이 있고(적용 끝남) 처음 본 지 14일 지난 것만 지운다. 기록이 없는 백업(적용이 멈춘 것)은 사람이 본다 — 지우지 않음.
create function private.app_retention_daily()
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

-- 매일 02:43 KST(= 17:43 UTC). 수집 시각(:07·:22)과 겹치지 않는다.
select cron.schedule('web2_retention_daily', '43 17 * * *', $cmd$select private.app_retention_daily()$cmd$);

do $$
begin
  if (select count(*) from cron.job where jobname = 'web2_retention_daily' and schedule = '43 17 * * *' and active) <> 1
     or has_function_privilege('authenticated', 'private.app_retention_daily()', 'execute')
     or has_function_privilege('anon', 'private.app_retention_daily()', 'execute')
     or has_function_privilege('service_role', 'private.app_retention_daily()', 'execute')
     or has_table_privilege('authenticated', 'private.app_ops_backup_seen', 'select,insert,update,delete')
     or has_table_privilege('service_role', 'private.app_ops_backup_seen', 'select,insert,update,delete') then
    raise exception 'RETENTION_DAILY_POSTCHECK_FAILED; stop';
  end if;
end
$$;
commit;
-- ===== 조각 ① 끝 =====


-- ===== 조각 ② 시작: 지금 한 번 정리 + 11/15·16·19 뉴스 백업 지우기 =====
-- 미리 보기(precheck)에서 '지금지움'으로 표시된 백업 표만 지운다(그 migration 기록이 있는 것만). 그 밖의 백업은 14일 규칙대로 남는다.
-- 정리 한 번은 지울 줄이 많아 몇 분 걸릴 수 있다(상한 10분). 결과 jsonb = 지운 줄 수.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '600s';
do $$
declare r record;
begin
  if to_regprocedure('private.app_retention_daily()') is null then
    raise exception 'RETENTION_DAILY_MISSING: run fragment 1 first; stop';
  end if;
  if to_regnamespace('ops_backup') is not null then
    for r in
      select c.relname from pg_class c
       where c.relnamespace = to_regnamespace('ops_backup') and c.relkind = 'r'
         and c.relname ~ '^(20261115|20261116|20261119)[0-9]{6}_app_(news|outside|feed_bodies)[a-z0-9_]*_[0-9]+$'
         and exists (select 1 from supabase_migrations.schema_migrations m where m.version = left(c.relname, 14))
       order by c.relname
    loop
      execute format('drop table ops_backup.%I', r.relname);
    end loop;
    delete from private.app_ops_backup_seen s
     where not exists (select 1 from pg_class c where c.relname = s.name and c.relnamespace = to_regnamespace('ops_backup'));
  end if;
end
$$;
select private.app_retention_daily() as removed;
commit;
-- ===== 조각 ② 끝 =====


-- ===== 조각 ③: 디스크 되돌려받기(VACUUM FULL) — 한 줄씩 따로 실행 =====
-- 지우기만 하면 빈자리는 표 안에서 다시 쓰일 뿐 DB 크기(무료 한도 기준)는 줄지 않는다. VACUUM FULL이 표를 새로 써서 크기를 줄인다.
-- ★ VACUUM FULL은 그 표를 잠근다(읽기·쓰기 모두 기다림). 지운 뒤 표가 작아서 한 표에 몇 초~수십 초다.
-- ★ 시각: KST 14:30~14:55 또는 21:30~21:55처럼 수집(매시 :07·:22, 08·13·18시 묶음) 사이. 그 사이 수집이 잠금에 걸리면 그 회차만 실패하고 다음 회차에 다시 돈다.
-- ★ 거래 안에서 돌 수 없다: begin/commit 없이, 한 창에 한 줄만 붙여 넣고 실행한다(여러 줄을 한 번에 실행하면 'cannot run inside a transaction block').
-- ★ 표를 새로 쓰는 동안 그 표 크기만큼 잠깐 더 쓴다 — 지운 뒤라 작다. 큰 표부터가 아니라 아래 순서대로(작아진 표부터) 한다.
-- 순서(조각 ② 뒤, 다른 날이어도 됨):
--   vacuum (full, analyze) public.app_news_article_bodies;
--   vacuum (full, analyze) public.app_news_articles;
--   vacuum (full, analyze) public.app_news_items;
--   vacuum (full, analyze) public.app_feed_bodies;
--   vacuum (full, analyze) public.app_news_marks;
--   vacuum (full, analyze) public.app_news_id_map;
--   vacuum (full, analyze) public.app_outside_article_sentences;
--   vacuum (full, analyze) public.app_outside_sentences;
--   vacuum (full, analyze) public.app_outside_articles;
--   vacuum (full, analyze) public.app_outside_posts;
--   vacuum (full, analyze) cron.job_run_details;
-- 마지막 줄(cron.job_run_details)은 표 주인이 아니어서 "must be owner"(42501)로 거절될 수 있다. 그러면 넘어간다:
--   매일 정리가 7일치만 남기므로 빈자리를 다시 쓰며 더 커지지 않는다. 크기까지 줄여야 하면 Supabase 지원 문의(표 주인 권한)가 필요하다.
-- 끝나면 precheck를 다시 돌려 'database size MB'를 캡처한다.
