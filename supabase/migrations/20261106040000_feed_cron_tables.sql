begin;
-- S51-2 NEWS-전면개편 P1a: 수집 예약을 GitHub 예약에서 DB 안 예약(P1b의 pg_cron)으로 옮기기 위한 표·함수만 만든다.
-- 설계 docs/design/news-overhaul.md 3.1·3.3절(명진 결정 D3 "GitHub 예약 대신 Supabase 예약"), 8절 차례 2.
-- 이 파일에는 확장(pg_cron·pg_net·vault)·예약 등록·요청 보내기·금고 문이 없다(승인형 workflow가 막음 → P1b SQL Editor, 3.4절).
-- 확장이 없어도 표·함수는 만들어진다. 함수는 표만 읽고 쓰며, 바깥 요청은 P1b 예약 명령이 함수가 돌려준 일을 받아 직접 보낸다.
--
-- 무엇:
--   1) 표 셋(모두 RLS 켬, 정책 없음, service_role 읽기만, anon·authenticated·PUBLIC 권한 없음 — app_operator_features와 같은 모양):
--      app_cron_keys  : 예약 열쇠의 SHA-256 지문(이름 + 64자 16진). 값 자체는 두지 않는다(값은 P1b가 금고에서 만듦).
--      app_feed_runs  : 예약 칸 하나 = 한 줄(수집기 종류·예정 시각·상태·일 수). 제목·주소 칸 없음.
--      app_feed_jobs  : 칸 안의 일 하나 = 한 줄(동작·몸통(키·단계만, 200바이트 안쪽)·상태·시도 수·응답 번호·결과(건수·코드만)).
--   2) 함수 다섯(모두 INVOKER, search_path='', 언어 plpgsql, PUBLIC·anon·authenticated·service_role 실행권 회수 — 예약 명령은 소유자 postgres로 부름):
--      app_feed_enqueue(feed)   : 실행 줄 1개 + 첫 일(outside·news: 계획 1개 / news_fill: 대기 기사·외국 제목 2개). 같은 수집기 종류가 돌고 있거나 같은 분에 이미 있으면 null.
--      app_feed_claim(collector): 같은 수집기(outside / news=news·news_fill)에 '보냄' 일이 없을 때만 다음 일 하나를 '보냄'으로 바꿔 돌려준다(jsonb, 없으면 null).
--      app_feed_sent(job, req)  : 보낸 요청 번호를 그 일에 적는다(한 번만).
--      app_feed_settle(req, status, content): 받은 응답을 정리한다. 건수·상태 코드·단계 코드만 꺼내 result에 적고(제목·주소 버림),
--                                 '계획' 응답의 키 목록으로 다음 일을 줄에 넣고, 5xx·시간 초과는 3번까지 다시, 401은 그 칸 남은 일까지 실패, 실행 줄 집계.
--      app_feed_tidy()          : 1분 정리 — 응답 없이 10분 지난 '보냄'은 시간 초과로 처리, 2시간 넘은 칸은 '늦음'으로 닫음, 30일 지난 줄 지움.
-- 안 하는 것: 기존 표·칸·정책·권한·함수 변경, 확장·예약·요청·금고, SECURITY DEFINER, 화면·Edge 변경, rtw 객체.
-- 짝: docs/20261106040000_feed_cron_tables.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261106040000')
     or to_regnamespace('private') is null
     or to_regclass('public.app_cron_keys') is not null
     or to_regclass('public.app_feed_runs') is not null
     or to_regclass('public.app_feed_jobs') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'private' and p.proname in ('app_feed_enqueue', 'app_feed_claim', 'app_feed_sent', 'app_feed_settle', 'app_feed_tidy')) then
    raise exception 'FEED_CRON_TABLES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 표 셋.
create table public.app_cron_keys (
  name text primary key,
  secret_sha256 text not null,
  updated_at timestamptz not null default now(),
  constraint app_cron_keys_name_check check (name ~ '^web2_[a-z0-9_]{1,40}$'),
  constraint app_cron_keys_sha_check check (secret_sha256 ~ '^[0-9a-f]{64}$')
);

create table public.app_feed_runs (
  id uuid primary key default gen_random_uuid(),
  feed text not null,
  slot_at timestamptz not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  state text not null default 'running',
  jobs_total integer not null default 0,
  jobs_ok integer not null default 0,
  jobs_failed integer not null default 0,
  constraint app_feed_runs_slot_unique unique (feed, slot_at),
  constraint app_feed_runs_feed_check check (feed in ('outside', 'news', 'news_fill')),
  constraint app_feed_runs_state_check check (state in ('running', 'done', 'partial', 'late', 'failed')),
  constraint app_feed_runs_finished_check check ((state = 'running') = (finished_at is null)),
  constraint app_feed_runs_counts_check check (jobs_total between 0 and 200 and jobs_ok >= 0 and jobs_failed >= 0
    and jobs_ok + jobs_failed <= jobs_total)
);
create index app_feed_runs_open_idx on public.app_feed_runs (feed, slot_at) where state = 'running';
create index app_feed_runs_started_idx on public.app_feed_runs (started_at);

create table public.app_feed_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.app_feed_runs(id) on delete cascade,
  seq integer not null,
  action text not null,
  body jsonb not null default '{}'::jsonb,
  state text not null default 'queued',
  tries integer not null default 0,
  request_id bigint,
  sent_at timestamptz,
  done_at timestamptz,
  http_status integer,
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  constraint app_feed_jobs_seq_unique unique (run_id, seq),
  constraint app_feed_jobs_seq_check check (seq between 1 and 200),
  constraint app_feed_jobs_action_check check (action in ('run_plan', 'run')),
  -- 몸통: 객체, 200바이트 안쪽, 칸은 source·step만. 계획은 빈 객체, 일반 일은 빈 객체가 아님.
  constraint app_feed_jobs_body_check check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 200
    and (body - 'source' - 'step') = '{}'::jsonb
    and (body -> 'source' is null or (jsonb_typeof(body -> 'source') = 'string' and (body ->> 'source') ~ '^[a-z0-9][a-z0-9-]{1,39}$'))
    and (body -> 'step' is null or (jsonb_typeof(body -> 'step') = 'string'
         and (body ->> 'step') in ('media', 'keywords', 'pending', 'titles', 'prune', 'details')))
    and ((action = 'run_plan' and body = '{}'::jsonb) or (action = 'run' and body <> '{}'::jsonb))),
  constraint app_feed_jobs_state_check check (state in ('queued', 'sent', 'ok', 'failed', 'late')),
  constraint app_feed_jobs_tries_check check (tries between 0 and 3),
  constraint app_feed_jobs_done_check check ((state in ('queued', 'sent')) = (done_at is null)),
  constraint app_feed_jobs_queued_check check (state <> 'queued' or request_id is null),
  constraint app_feed_jobs_sent_check check (state <> 'sent' or (sent_at is not null and tries >= 1)),
  constraint app_feed_jobs_request_check check (request_id is null or request_id > 0),
  constraint app_feed_jobs_status_check check (http_status is null or http_status between 100 and 599),
  constraint app_feed_jobs_ok_check check (state <> 'ok' or (http_status between 200 and 299 and result is not null)),
  -- 결과: 객체, 400바이트 안쪽, 칸 이름은 소문자 짧은 말, 값은 0~1000000 정수 또는 짧은 코드뿐(제목·주소·키워드가 들어갈 자리 없음).
  constraint app_feed_jobs_result_check check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 400
    and not jsonb_path_exists(result, '$.keyvalue() ? (!(@.key like_regex "^[a-z_]{1,20}$"))')
    and not jsonb_path_exists(result, '$.* ? (@.type() != "number" && @.type() != "string")')
    and not jsonb_path_exists(result, '$.* ? (@.type() == "number" && (@ < 0 || @ > 1000000 || @.floor() != @))')
    and not jsonb_path_exists(result, '$.* ? (@.type() == "string" && !(@ like_regex "^[a-z0-9_-]{1,40}$"))'))),
  constraint app_feed_jobs_error_check check (error_code is null or error_code ~ '^[A-Za-z0-9_]{1,64}$')
);
create index app_feed_jobs_open_idx on public.app_feed_jobs (run_id, seq) where state in ('queued', 'sent');
create index app_feed_jobs_request_idx on public.app_feed_jobs (request_id) where request_id is not null;

alter table public.app_cron_keys enable row level security;
alter table public.app_feed_runs enable row level security;
alter table public.app_feed_jobs enable row level security;
revoke all on table public.app_cron_keys from public, anon, authenticated, service_role;
revoke all on table public.app_feed_runs from public, anon, authenticated, service_role;
revoke all on table public.app_feed_jobs from public, anon, authenticated, service_role;
grant select on table public.app_cron_keys to service_role;
grant select on table public.app_feed_runs to service_role;
grant select on table public.app_feed_jobs to service_role;

-- 2) 함수 다섯. 모두 INVOKER: 부르는 역할(예약 = 소유자 postgres)의 권한으로만 표를 만진다.
create function private.app_feed_enqueue(p_feed text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run uuid;
  v_slot timestamptz := date_trunc('minute', now());
begin
  if p_feed is null or p_feed not in ('outside', 'news', 'news_fill') then
    raise exception using errcode = '22023', message = 'FEED_KIND_INVALID';
  end if;
  -- 같은 수집기 종류가 아직 돌고 있으면 새 칸을 만들지 않는다(겹치지 않게; 2시간 넘은 칸은 app_feed_tidy가 닫음).
  if exists (select 1 from public.app_feed_runs r where r.feed = p_feed and r.state = 'running') then
    return null;
  end if;
  insert into public.app_feed_runs (feed, slot_at, jobs_total)
    values (p_feed, v_slot, case when p_feed = 'news_fill' then 2 else 1 end)
    on conflict (feed, slot_at) do nothing
    returning id into v_run;
  if v_run is null then
    return null;
  end if;
  if p_feed = 'news_fill' then
    insert into public.app_feed_jobs (run_id, seq, action, body) values
      (v_run, 1, 'run', jsonb_build_object('step', 'pending')),
      (v_run, 2, 'run', jsonb_build_object('step', 'titles'));
  else
    insert into public.app_feed_jobs (run_id, seq, action, body) values (v_run, 1, 'run_plan', '{}'::jsonb);
  end if;
  return v_run;
end
$$;
revoke all on function private.app_feed_enqueue(text) from public, anon, authenticated, service_role;

create function private.app_feed_claim(p_collector text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_feeds text[];
  v_job record;
begin
  if p_collector = 'outside' then
    v_feeds := array['outside'];
  elsif p_collector = 'news' then
    v_feeds := array['news', 'news_fill'];
  else
    raise exception using errcode = '22023', message = 'FEED_COLLECTOR_INVALID';
  end if;
  -- 같은 수집기에서 동시에 두 번 꺼내지 않게 이 거래 동안 잠근다.
  perform pg_catalog.pg_advisory_xact_lock(7340100, case when p_collector = 'outside' then 1 else 2 end);
  if exists (select 1 from public.app_feed_jobs j join public.app_feed_runs r on r.id = j.run_id
              where j.state = 'sent' and r.feed = any (v_feeds)) then
    return null;
  end if;
  select j.id, j.action, j.body, r.feed into v_job
    from public.app_feed_jobs j join public.app_feed_runs r on r.id = j.run_id
   where j.state = 'queued' and r.state = 'running' and r.feed = any (v_feeds)
   order by r.slot_at, r.started_at, j.seq
   limit 1
   for update of j skip locked;
  if not found then
    return null;
  end if;
  update public.app_feed_jobs set state = 'sent', tries = tries + 1, sent_at = now(), request_id = null
   where id = v_job.id and state = 'queued';
  return jsonb_build_object('id', v_job.id, 'feed', v_job.feed, 'action', v_job.action, 'body', v_job.body);
end
$$;
revoke all on function private.app_feed_claim(text) from public, anon, authenticated, service_role;

create function private.app_feed_sent(p_job uuid, p_request bigint)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_job is null or p_request is null or p_request <= 0 then
    raise exception using errcode = '22023', message = 'FEED_REQUEST_INVALID';
  end if;
  update public.app_feed_jobs set request_id = p_request
   where id = p_job and state = 'sent' and request_id is null;
  return found;
end
$$;
revoke all on function private.app_feed_sent(uuid, bigint) from public, anon, authenticated, service_role;

-- 응답 정리. p_status null = 시간 초과·연결 실패. p_content는 응답 원문(이 함수 밖으로 내보내지 않고 건수·코드만 남김).
create function private.app_feed_settle(p_request bigint, p_status integer, p_content text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job record;
  v_body jsonb;
  v_stage text;
  v_result jsonb;
  v_keys text[];
  v_state text;
  v_error text;
  v_seq integer;
  v_ok boolean;
begin
  if p_request is null or p_request <= 0 or (p_status is not null and (p_status < 100 or p_status > 599)) then
    raise exception using errcode = '22023', message = 'FEED_RESPONSE_INVALID';
  end if;
  select j.id, j.run_id, j.action, j.tries, r.feed into v_job
    from public.app_feed_jobs j join public.app_feed_runs r on r.id = j.run_id
   where j.request_id = p_request and j.state = 'sent'
   for update of j;
  if not found then
    return null; -- 이미 정리했거나 늦음으로 닫힌 일
  end if;

  if p_content is not null and octet_length(p_content) <= 1000000 then
    begin
      v_body := p_content::jsonb;
    exception when others then
      v_body := null;
    end;
  end if;
  if v_body is not null and jsonb_typeof(v_body) <> 'object' then
    v_body := null;
  end if;
  if jsonb_typeof(v_body -> 'error') = 'string' and (v_body ->> 'error') ~ '^[A-Z][A-Z0-9_]{0,63}$' then
    v_stage := v_body ->> 'error';
  end if;
  v_ok := p_status between 200 and 299 and v_body -> 'ok' = 'true'::jsonb;

  if v_ok then
    -- 건수(0~1000000 정수)와 상태 코드만 남긴다.
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_result
      from jsonb_each(v_body) e
     where (e.key in ('listed', 'fresh', 'inserted', 'skipped', 'deferred', 'refilled', 'done', 'removed', 'remaining', 'stale', 'pruned')
            and jsonb_typeof(e.value) = 'number'
            and (e.value)::numeric between 0 and 1000000 and (e.value)::numeric = floor((e.value)::numeric))
        or (e.key = 'status' and jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~ '^[a-z0-9_-]{1,40}$');
    v_state := 'ok';
    if v_job.action = 'run_plan' then
      -- 계획 응답의 키 목록(사회운동 sources / 언론 media)으로 다음 일을 만든다. 카탈로그·켬 판단은 Edge가 한다.
      if jsonb_typeof(v_body -> case when v_job.feed = 'outside' then 'sources' else 'media' end) is distinct from 'array'
         or (v_job.feed = 'outside' and jsonb_typeof(v_body -> 'pruned') is distinct from 'number') then
        v_state := 'failed';
        v_error := 'plan_shape';
      else
        select coalesce(array_agg(k.key order by k.first), array[]::text[]) into v_keys
          from (select x.item #>> '{}' as key, min(x.n) as first
                  from jsonb_array_elements(v_body -> case when v_job.feed = 'outside' then 'sources' else 'media' end) with ordinality as x(item, n)
                 where jsonb_typeof(x.item) = 'string'
                   and ((v_job.feed = 'outside' and (x.item #>> '{}') ~ '^[a-z0-9][a-z0-9-]{1,39}$')
                     or (v_job.feed = 'news' and (x.item #>> '{}') ~ '^news-[a-z0-9-]{1,34}$'))
                 group by x.item #>> '{}'
                 order by min(x.n)
                 limit 40) k;
        v_result := v_result || jsonb_build_object('keys', coalesce(array_length(v_keys, 1), 0));
        select coalesce(max(seq), 0) into v_seq from public.app_feed_jobs where run_id = v_job.run_id;
        if v_job.feed = 'outside' then
          insert into public.app_feed_jobs (run_id, seq, action, body)
            select v_job.run_id, v_seq + k.n, 'run', jsonb_build_object('source', k.key)
              from unnest(v_keys) with ordinality as k(key, n);
        else
          insert into public.app_feed_jobs (run_id, seq, action, body)
            select v_job.run_id, v_seq + k.n, 'run', jsonb_build_object('step', 'media', 'source', k.key)
              from unnest(v_keys) with ordinality as k(key, n);
          v_seq := v_seq + coalesce(array_length(v_keys, 1), 0);
          insert into public.app_feed_jobs (run_id, seq, action, body) values
            (v_job.run_id, v_seq + 1, 'run', jsonb_build_object('step', 'keywords')),
            (v_job.run_id, v_seq + 2, 'run', jsonb_build_object('step', 'pending')),
            (v_job.run_id, v_seq + 3, 'run', jsonb_build_object('step', 'titles')),
            (v_job.run_id, v_seq + 4, 'run', jsonb_build_object('step', 'prune'));
        end if;
      end if;
    end if;
    if v_state = 'ok' then
      update public.app_feed_jobs set state = 'ok', done_at = now(), http_status = p_status, result = v_result, error_code = null
       where id = v_job.id;
    else
      update public.app_feed_jobs set state = 'failed', done_at = now(), http_status = p_status, result = null, error_code = v_error
       where id = v_job.id;
    end if;
  else
    v_error := coalesce(v_stage, case when p_status is null then 'timeout' when p_status between 200 and 299 then 'not_ok'
                                      else 'http_' || p_status::text end);
    if (p_status is null or (p_status >= 500 and v_stage is distinct from 'SERVER_CONFIG_MISSING')) and v_job.tries < 3 then
      -- 5xx·시간 초과만 다시(3번까지). 다음 1분 꺼내기가 다시 보낸다.
      update public.app_feed_jobs set state = 'queued', request_id = null, http_status = p_status, error_code = v_error
       where id = v_job.id;
      v_state := 'queued';
    else
      update public.app_feed_jobs set state = 'failed', done_at = now(), http_status = p_status, result = null, error_code = v_error
       where id = v_job.id;
      v_state := 'failed';
      if p_status = 401 then
        -- 열쇠가 맞지 않으면 그 칸의 남은 일도 모두 같은 까닭으로 닫는다(스크립트가 401에서 멈추던 것과 같음).
        update public.app_feed_jobs set state = 'failed', done_at = now(), error_code = 'unauthorized'
         where run_id = v_job.run_id and state = 'queued';
      end if;
    end if;
  end if;

  -- 실행 줄 집계. 남은 일이 없으면 닫는다: 실패 없음 done / 성공 없음 failed / 섞임 partial.
  update public.app_feed_runs r
     set jobs_total = a.total, jobs_ok = a.ok, jobs_failed = a.bad,
         state = case when a.open > 0 then 'running' when a.bad = 0 then 'done' when a.ok = 0 then 'failed' else 'partial' end,
         finished_at = case when a.open > 0 then null else now() end
    from (select count(*)::integer as total,
                 count(*) filter (where j.state = 'ok')::integer as ok,
                 count(*) filter (where j.state in ('failed', 'late'))::integer as bad,
                 count(*) filter (where j.state in ('queued', 'sent'))::integer as open
            from public.app_feed_jobs j where j.run_id = v_job.run_id) a
   where r.id = v_job.run_id and r.state = 'running';
  return v_state;
end
$$;
revoke all on function private.app_feed_settle(bigint, integer, text) from public, anon, authenticated, service_role;

create function private.app_feed_tidy()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_retried integer;
  v_timed_out integer;
  v_late integer;
  v_pruned integer;
begin
  -- 응답 없이 10분 지난 '보냄'(요청 시간 상한 150초 + 여유)은 시간 초과로 본다: 3번 안쪽이면 다시, 아니면 실패.
  update public.app_feed_jobs set state = 'queued', request_id = null, http_status = null, error_code = 'no_response'
   where state = 'sent' and sent_at < now() - interval '10 minutes' and tries < 3;
  get diagnostics v_retried = row_count;
  update public.app_feed_jobs set state = 'failed', done_at = now(), http_status = null, error_code = 'no_response'
   where state = 'sent' and sent_at < now() - interval '10 minutes' and tries >= 3;
  get diagnostics v_timed_out = row_count;

  -- 2시간 안에 안 끝난 칸은 남은 일을 '늦음'으로 닫는다(다음 칸과 겹치지 않게).
  update public.app_feed_jobs j set state = 'late', done_at = now()
    from public.app_feed_runs r
   where r.id = j.run_id and r.state = 'running' and r.started_at < now() - interval '2 hours' and j.state in ('queued', 'sent');
  update public.app_feed_runs r
     set state = 'late', finished_at = now(),
         jobs_total = a.total, jobs_ok = a.ok, jobs_failed = a.bad
    from (select j.run_id,
                 count(*)::integer as total,
                 count(*) filter (where j.state = 'ok')::integer as ok,
                 count(*) filter (where j.state in ('failed', 'late'))::integer as bad
            from public.app_feed_jobs j group by j.run_id) a
   where a.run_id = r.id and r.state = 'running' and r.started_at < now() - interval '2 hours';
  get diagnostics v_late = row_count;

  -- 시간 초과로 실패한 일만 남은 칸도 닫는다.
  update public.app_feed_runs r
     set jobs_total = a.total, jobs_ok = a.ok, jobs_failed = a.bad,
         state = case when a.bad = 0 then 'done' when a.ok = 0 then 'failed' else 'partial' end,
         finished_at = now()
    from (select j.run_id,
                 count(*)::integer as total,
                 count(*) filter (where j.state = 'ok')::integer as ok,
                 count(*) filter (where j.state in ('failed', 'late'))::integer as bad,
                 count(*) filter (where j.state in ('queued', 'sent'))::integer as open
            from public.app_feed_jobs j group by j.run_id) a
   where a.run_id = r.id and r.state = 'running' and a.open = 0;

  -- 30일 지난 닫힌 칸은 일 줄과 함께 지운다.
  delete from public.app_feed_runs where state <> 'running' and started_at < now() - interval '30 days';
  get diagnostics v_pruned = row_count;
  return jsonb_build_object('retried', v_retried, 'timed_out', v_timed_out, 'late', v_late, 'pruned', v_pruned);
end
$$;
revoke all on function private.app_feed_tidy() from public, anon, authenticated, service_role;

-- 마지막 확인: 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_class where oid in ('public.app_cron_keys'::regclass, 'public.app_feed_runs'::regclass, 'public.app_feed_jobs'::regclass)
        and relrowsecurity and not relforcerowsecurity) <> 3
     or exists (select 1 from pg_policy where polrelid in ('public.app_cron_keys'::regclass, 'public.app_feed_runs'::regclass, 'public.app_feed_jobs'::regclass))
     or exists (select 1 from pg_class where oid in ('public.app_cron_keys'::regclass, 'public.app_feed_runs'::regclass, 'public.app_feed_jobs'::regclass)
                 and coalesce(relacl::text, '') ~ '(^|[{,])(anon|authenticated)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_cron_keys'::regclass, 'public.app_feed_runs'::regclass, 'public.app_feed_jobs'::regclass)
                 and attacl is not null)
     or has_table_privilege('authenticated', 'public.app_cron_keys', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.app_feed_runs', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.app_feed_jobs', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.app_cron_keys', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.app_feed_runs', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.app_feed_jobs', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'public.app_cron_keys', 'select')
     or not has_table_privilege('service_role', 'public.app_feed_runs', 'select')
     or not has_table_privilege('service_role', 'public.app_feed_jobs', 'select')
     or has_table_privilege('service_role', 'public.app_cron_keys', 'insert,update,delete,truncate')
     or has_table_privilege('service_role', 'public.app_feed_runs', 'insert,update,delete,truncate')
     or has_table_privilege('service_role', 'public.app_feed_jobs', 'insert,update,delete,truncate')
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname in ('app_feed_enqueue', 'app_feed_claim', 'app_feed_sent', 'app_feed_settle', 'app_feed_tidy')
            and not p.prosecdef and p.proconfig = array['search_path=""']
            and coalesce(p.proacl::text, '') !~ '(^|[{,])(anon|authenticated|service_role)?=') <> 5
     or has_function_privilege('authenticated', 'private.app_feed_enqueue(text)', 'execute')
     or has_function_privilege('authenticated', 'private.app_feed_claim(text)', 'execute')
     or has_function_privilege('authenticated', 'private.app_feed_sent(uuid,bigint)', 'execute')
     or has_function_privilege('authenticated', 'private.app_feed_settle(bigint,integer,text)', 'execute')
     or has_function_privilege('authenticated', 'private.app_feed_tidy()', 'execute')
     or has_function_privilege('service_role', 'private.app_feed_enqueue(text)', 'execute')
     or has_function_privilege('service_role', 'private.app_feed_claim(text)', 'execute')
     or has_function_privilege('service_role', 'private.app_feed_sent(uuid,bigint)', 'execute')
     or has_function_privilege('service_role', 'private.app_feed_settle(bigint,integer,text)', 'execute')
     or has_function_privilege('service_role', 'private.app_feed_tidy()', 'execute')
     or has_function_privilege('anon', 'private.app_feed_enqueue(text)', 'execute')
     or has_function_privilege('anon', 'private.app_feed_settle(bigint,integer,text)', 'execute') then
    raise exception 'FEED_CRON_TABLES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261106040000', 'feed_cron_tables', array['S51-2 NEWS-overhaul P1a: new tables app_cron_keys (cron key SHA-256 fingerprint only), app_feed_runs (one row per scheduled slot) and app_feed_jobs (one row per Edge call; body holds key/step only, result holds counts/codes only, both size and shape checked); RLS on, no policies, service_role select only, no anon/authenticated/PUBLIC; new SECURITY INVOKER plpgsql functions private.app_feed_enqueue(text), app_feed_claim(text), app_feed_sent(uuid,bigint), app_feed_settle(bigint,integer,text), app_feed_tidy() with empty search_path and execute revoked from PUBLIC, anon, authenticated and service_role; no extension, cron, net or vault statements; no change to existing objects']);
commit;
