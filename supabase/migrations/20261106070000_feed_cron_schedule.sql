-- S51-5 NEWS-전면개편 P1b: DB 안 예약(pg_cron)으로 사회운동·언론 수집을 정해진 시각에 돌린다.
-- 설계 docs/design/news-overhaul.md 3.1·3.2('나'안 1~3·5)·3.4절 ②, 8절 차례 4. 앞 단계(운영 적용·배포 끝):
--   20261106040000_feed_cron_tables(표 app_cron_keys·app_feed_runs·app_feed_jobs, 함수 private.app_feed_enqueue/claim/sent/settle/tidy),
--   Edge outside-feed·news-feed 지문 길(#1934).
--
-- ★ SQL Editor(폰 경로 C) 전용 ★ 확장(create extension)·cron·net·vault 문이 있어 승인형 DB workflow가 거절한다(docs/ops-db-workflow.md 차단 목록).
-- 이 파일은 조각 셋(조각마다 begin; … commit;)과 조각 사이 읽기 전용 확인 SQL로 되어 있다. 조각마다 새 쿼리 창(+)에 따로 붙여 넣어 실행한다.
--   조각 ① 확장 확인·켜기: pg_cron·pg_net은 없을 때만 켜고, supabase_vault·pgcrypto는 있는지 확인만(읽생기와 같은 DB — 이미 켜져 있으면 손대지 않음).
--   조각 ② 금고 값 만들기: DB 안에서 무작위 32바이트(16진 64자) → 금고 이름 web2_feed_cron, 그 SHA-256 지문만 public.app_cron_keys에.
--          운영 프로젝트 주소는 금고 이름 web2_feed_project_url에 둔다(저장소에 주소를 쓰지 않음).
--          ★ 이 조각에 실행 때 CC가 채우는 자리 표시가 한 곳 있다: '__CC_PROJECT_URL__' → 운영 프로젝트 주소(https://<ref>.supabase.co).
--            안 바꾸고 실행하면 주소 모양 검사에서 멈추고 아무것도 바뀌지 않는다.
--   조각 ③ 예약 4개(이름 앞머리 web2_feed_) + schema_migrations 기록 1행(④). Edge 지문 길 배포가 끝난 뒤에만(설계 3.4절: 그 전에 돌면 모두 401).
-- 값은 어디에도 찍지 않는다: 금고 값은 select로 돌려받지 않고, 예약 명령 본문에도 없다(돌 때마다 금고에서 읽어 요청 헤더에만 넣음).
-- 예약 시각은 UTC(pg_cron 기본 cron.timezone = GMT). KST = UTC + 9:
--   web2_feed_outside   '7 4,9,23 * * *'          = 08:07·13:07·18:07 KST → private.app_feed_enqueue('outside')
--   web2_feed_news      '22 4,9,23 * * *'         = 08:22·13:22·18:22 KST → private.app_feed_enqueue('news')
--   web2_feed_news_fill '22 0-3,5-8,10-22 * * *'  = 그 밖 매시 22분        → private.app_feed_enqueue('news_fill')
--   web2_feed_tick      '* * * * *'               = 1분마다: 받은 응답 정리(app_feed_settle) → 1분 정리(app_feed_tidy)
--                                                   → 수집기(outside·news)마다 꺼내기(app_feed_claim) → net.http_post(헤더 = 금고 값, 시간 상한 150초) → app_feed_sent
-- 안 하는 것: 표·칸·정책·권한·함수 변경, SECURITY DEFINER, anon·authenticated·PUBLIC 권한, 화면·Edge 변경, rtw 객체, 확장 끄기.
-- 짝: docs/20261106070000_feed_cron_schedule.{precheck,snapshot,postcheck,rollback}.sql, .summary.md


-- ===== 조각 ① 시작: 확장 확인·켜기 =====
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261106070000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261106040000' and name = 'feed_cron_tables')
     or to_regclass('public.app_cron_keys') is null then
    raise exception 'FEED_CRON_SCHEDULE_PREREQUISITE_CHANGED: already applied or P1a missing; stop';
  end if;
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    raise exception 'FEED_CRON_EXTENSION_UNAVAILABLE: pg_cron or pg_net not available on this server; stop';
  end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'supabase_vault')
     or to_regprocedure('vault.create_secret(text,text,text,uuid)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise exception 'FEED_CRON_VAULT_MISSING: supabase_vault not installed; stop (do not install here)';
  end if;
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'FEED_CRON_PGCRYPTO_MISSING: extensions.gen_random_bytes not found; stop';
  end if;
end
$$;
-- 이미 켜져 있으면 아무것도 하지 않는다(if not exists). pg_cron 스키마는 확장 제어 파일이 정한다. pg_net은 Supabase 안내대로 extensions.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regprocedure('cron.unschedule(text)') is null
     or to_regclass('cron.job') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('net._http_response') is null then
    raise exception 'FEED_CRON_EXTENSION_SHAPE_CHANGED: cron.schedule / net.http_post not as expected; stop';
  end if;
end
$$;
commit;
-- ===== 조각 ① 끝 =====


-- ===== 확인 1 (읽기 전용, 조각 ① 뒤·조각 ② 전): 모두 예여야 조각 ②로 간다 =====
select 'cron and net ready' as item, case when to_regprocedure('cron.schedule(text,text,text)') is not null
  and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then '예' else '아니오' end as value
union all select 'cron timezone UTC', case when coalesce(current_setting('cron.timezone', true), '') in ('GMT', 'UTC', 'Etc/UTC') then '예' else '아니오' end
union all select 'no web2_feed jobs yet', case when not exists (select 1 from cron.job where jobname like 'web2\_feed\_%') then '예' else '아니오' end
union all select 'vault names free', case when not exists (select 1 from vault.decrypted_secrets
  where name in ('web2_feed_cron', 'web2_feed_project_url')) then '예' else '아니오' end
union all select 'fingerprint row absent', case when not exists (select 1 from public.app_cron_keys where name = 'web2_feed_cron') then '예' else '아니오' end
union all select 'this migration not recorded', case when not exists (select 1 from supabase_migrations.schema_migrations
  where version = '20261106070000') then '예' else '아니오' end;


-- ===== 조각 ② 시작: 금고 값·지문 =====
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
declare
  v_url text := '__CC_PROJECT_URL__';
  v_key text;
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261106070000')
     or to_regclass('public.app_cron_keys') is null
     or exists (select 1 from public.app_cron_keys where name = 'web2_feed_cron')
     or exists (select 1 from vault.decrypted_secrets where name in ('web2_feed_cron', 'web2_feed_project_url')) then
    raise exception 'FEED_CRON_KEY_PREREQUISITE_CHANGED: already applied or key exists; stop';
  end if;
  if v_url !~ '^https://[a-z0-9]{20}\.supabase\.co$' then
    raise exception 'FEED_CRON_PROJECT_URL_INVALID: replace the placeholder with the production project URL; stop';
  end if;
  -- 무작위 32바이트(16진 64자). 값은 이 블록 밖으로 나가지 않는다(select·notice로 돌려주지 않음).
  v_key := encode(extensions.gen_random_bytes(32), 'hex');
  perform vault.create_secret(v_key, 'web2_feed_cron', 'Web2 feed cron key (NEWS P1b); fingerprint in public.app_cron_keys');
  perform vault.create_secret(v_url, 'web2_feed_project_url', 'Web2 project URL for feed cron (NEWS P1b)');
  insert into public.app_cron_keys (name, secret_sha256)
    values ('web2_feed_cron', encode(pg_catalog.sha256(convert_to(v_key, 'UTF8')), 'hex'));
  v_key := null;
  -- 사후 확인: 금고 값의 지문이 표의 지문과 같고, 금고 이름이 하나씩만 있다.
  if (select count(*) from vault.decrypted_secrets where name = 'web2_feed_cron') <> 1
     or (select count(*) from vault.decrypted_secrets where name = 'web2_feed_project_url') <> 1
     or not exists (select 1 from vault.decrypted_secrets s join public.app_cron_keys k on k.name = s.name
                     where s.name = 'web2_feed_cron' and length(s.decrypted_secret) = 64
                       and k.secret_sha256 = encode(pg_catalog.sha256(convert_to(s.decrypted_secret, 'UTF8')), 'hex')) then
    raise exception 'FEED_CRON_KEY_POSTCHECK_FAILED; stop';
  end if;
end
$$;
commit;
-- ===== 조각 ② 끝 =====


-- ===== 확인 2 (읽기 전용, 조각 ② 뒤·조각 ③ 전): 모두 예여야 조각 ③으로 간다. 값·지문·주소는 찍지 않고 예/아니오만 =====
select 'fingerprint row 1' as item, case when (select count(*) from public.app_cron_keys where name = 'web2_feed_cron') = 1 then '예' else '아니오' end as value
union all select 'fingerprint matches vault key', case when exists (select 1 from vault.decrypted_secrets s join public.app_cron_keys k on k.name = s.name
  where s.name = 'web2_feed_cron' and k.secret_sha256 = encode(pg_catalog.sha256(convert_to(s.decrypted_secret, 'UTF8')), 'hex')) then '예' else '아니오' end
union all select 'project URL shape', case when exists (select 1 from vault.decrypted_secrets
  where name = 'web2_feed_project_url' and decrypted_secret ~ '^https://[a-z0-9]{20}\.supabase\.co$') then '예' else '아니오' end
union all select 'no web2_feed jobs yet', case when not exists (select 1 from cron.job where jobname like 'web2\_feed\_%') then '예' else '아니오' end;


-- ===== 조각 ③ 시작: 예약 4개 + 기록 1행(④) — Edge 지문 길 배포 확인 뒤에만 =====
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261106070000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261106040000' and name = 'feed_cron_tables')
     or to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regprocedure('private.app_feed_enqueue(text)') is null
     or to_regprocedure('private.app_feed_claim(text)') is null
     or to_regprocedure('private.app_feed_sent(uuid,bigint)') is null
     or to_regprocedure('private.app_feed_settle(bigint,integer,text)') is null
     or to_regprocedure('private.app_feed_tidy()') is null
     or coalesce(current_setting('cron.timezone', true), '') not in ('GMT', 'UTC', 'Etc/UTC')
     or exists (select 1 from cron.job where jobname like 'web2\_feed\_%')
     or not exists (select 1 from vault.decrypted_secrets s join public.app_cron_keys k on k.name = s.name
                     where s.name = 'web2_feed_cron'
                       and k.secret_sha256 = encode(pg_catalog.sha256(convert_to(s.decrypted_secret, 'UTF8')), 'hex'))
     or not exists (select 1 from vault.decrypted_secrets
                     where name = 'web2_feed_project_url' and decrypted_secret ~ '^https://[a-z0-9]{20}\.supabase\.co$') then
    raise exception 'FEED_CRON_SCHEDULE_PREREQUISITE_CHANGED: run fragment 2 first, or jobs already exist; stop';
  end if;
end
$$;

select cron.schedule('web2_feed_outside', '7 4,9,23 * * *', $cmd$select private.app_feed_enqueue('outside')$cmd$);
select cron.schedule('web2_feed_news', '22 4,9,23 * * *', $cmd$select private.app_feed_enqueue('news')$cmd$);
select cron.schedule('web2_feed_news_fill', '22 0-3,5-8,10-22 * * *', $cmd$select private.app_feed_enqueue('news_fill')$cmd$);
select cron.schedule('web2_feed_tick', '* * * * *', $cmd$
do $tick$
declare
  r record;
  v_job jsonb;
  v_req bigint;
  v_key text;
  v_base text;
  v_collector text;
begin
  -- 1) 받은 응답 정리: 보낸 일의 응답(net._http_response)을 건수·코드만 남기고 일 결과로 옮긴다(응답 원문은 함수 밖으로 안 나감).
  for r in
    select j.request_id, h.status_code, h.content
      from public.app_feed_jobs j
      join net._http_response h on h.id = j.request_id
     where j.state = 'sent' and j.request_id is not null
     order by j.request_id
     limit 20
  loop
    perform private.app_feed_settle(r.request_id, case when r.status_code between 100 and 599 then r.status_code end, r.content);
  end loop;
  -- 2) 1분 정리: 응답 없는 '보냄' 시간 초과, 2시간 넘은 칸 '늦음', 30일 지난 칸 지움.
  perform private.app_feed_tidy();
  -- 3) 꺼내 보내기: 금고에서 열쇠·주소를 읽어 요청 헤더·주소에만 쓴다. 모양이 틀리면 보내지 않는다.
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'web2_feed_cron' limit 1;
  select s.decrypted_secret into v_base from vault.decrypted_secrets s where s.name = 'web2_feed_project_url' limit 1;
  if v_key is null or length(v_key) < 32 or v_base is null or v_base !~ '^https://[a-z0-9]{20}\.supabase\.co$' then
    return;
  end if;
  foreach v_collector in array array['outside', 'news'] loop
    v_job := private.app_feed_claim(v_collector);
    if v_job is not null then
      v_req := net.http_post(
        url := v_base || case when v_collector = 'outside' then '/functions/v1/outside-feed' else '/functions/v1/news-feed' end
               || '?action=' || (v_job ->> 'action'),
        body := v_job -> 'body',
        params := '{}'::jsonb,
        headers := jsonb_build_object('Content-Type', 'application/json',
                     case when v_collector = 'outside' then 'x-outside-feed-cron-secret' else 'x-news-feed-cron-secret' end, v_key),
        timeout_milliseconds := 150000);
      perform private.app_feed_sent((v_job ->> 'id')::uuid, v_req);
    end if;
  end loop;
end
$tick$;
$cmd$);

do $$
begin
  if (select count(*) from cron.job where jobname like 'web2\_feed\_%') <> 4
     or not exists (select 1 from cron.job where jobname = 'web2_feed_outside' and schedule = '7 4,9,23 * * *' and active)
     or not exists (select 1 from cron.job where jobname = 'web2_feed_news' and schedule = '22 4,9,23 * * *' and active)
     or not exists (select 1 from cron.job where jobname = 'web2_feed_news_fill' and schedule = '22 0-3,5-8,10-22 * * *' and active)
     or not exists (select 1 from cron.job where jobname = 'web2_feed_tick' and schedule = '* * * * *' and active)
     or exists (select 1 from cron.job j, vault.decrypted_secrets s
                 where j.jobname like 'web2\_feed\_%' and s.name in ('web2_feed_cron', 'web2_feed_project_url')
                   and position(s.decrypted_secret in j.command) > 0) then
    raise exception 'FEED_CRON_SCHEDULE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

-- ④ 기록 1행(조각 ③과 같은 거래: 예약이 모두 들어가야 기록된다).
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261106070000', 'feed_cron_schedule', array['S51-5 NEWS-overhaul P1b (SQL Editor only): enable pg_cron and pg_net if absent (supabase_vault and pgcrypto checked only); create vault secrets web2_feed_cron (random 32 bytes made in the DB, never printed) and web2_feed_project_url; store only the SHA-256 fingerprint in public.app_cron_keys; schedule cron jobs web2_feed_outside, web2_feed_news, web2_feed_news_fill (enqueue) and web2_feed_tick (every minute: settle responses, tidy, claim one job per collector, net.http_post with the vault key header and 150 s timeout, mark sent); no table, policy, grant or function change']);
commit;
-- ===== 조각 ③ 끝 =====


-- ===== 확인 3 (읽기 전용, 조각 ③ 뒤) = docs/20261106070000_feed_cron_schedule.postcheck.sql =====
