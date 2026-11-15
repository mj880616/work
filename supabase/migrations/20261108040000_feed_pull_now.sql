begin;
-- S52-46 FEED-최신화즉시수집 1/3 — DB: 통화·텔레그램 [최신화] 누른 횟수를 서버에서 세는 표 하나와 그 표만 다루는 함수 하나.
-- 설계: docs/design/feed-pull-now.md 2절 (나)·4절 차례 1(명진 결정 11/08 08:41 "1 나 2 빼": F1=(나), F2=사람마다 하루 20번·3분 간격).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
-- Edge(drive-summary ?action=collector_pull)·앱 스크립트·화면 변경은 이 migration에 없다. 그 전까지 새 표는 비어 있고 함수는 아무도 부르지 않는다.
--
-- 무엇:
--   1) 새 표 public.app_feed_pulls: 사람(user_id)·한국 날짜(day)·출처(telegram·call)마다 한 줄. 누른 횟수(n)와 마지막으로 누른 시각(last_at)뿐.
--      내용·방·번호·주소 칸 없음. 작업공간이 지워지면 함께 지워진다(외래 키 cascade).
--   2) 새 함수 public.app_feed_pull_take(p_user, p_workspace, p_source) (SECURITY INVOKER, 빈 search_path, plpgsql):
--      같은 사람은 거래 잠금(pg_advisory_xact_lock)으로 한 번에 하나씩 센다.
--      - 그 사람의 오늘(한국) 두 출처 합계가 20번이면 {ok:false, reason:'daily'}.
--      - 같은 출처를 마지막으로 누른 지 3분이 안 됐으면 {ok:false, reason:'cooldown', wait_s}.
--      - 아니면 그 줄의 n을 1 더하고 last_at을 지금으로 바꾼 뒤 {ok:true, left(오늘 남은 횟수)}. 31일 지난 그 사람 줄은 지운다.
--      운영자 기능 확인(app_operator_feature_workspace)과 로그인 확인은 부르는 쪽(Edge)이 먼저 한다. 이 함수는 세기만 한다.
-- 권한: 새 표 RLS 켬, 정책 없음. service_role만 읽기·넣기·고치기·지우기(함수가 INVOKER라 부르는 역할 권한으로 표를 만짐).
--   anon·authenticated·PUBLIC 표 권한 없음. 함수 실행은 service_role만(PUBLIC·anon·authenticated 회수).
-- 안 하는 것: 기존 표·칸·정책·권한·함수 변경, 기존 줄 변경, SECURITY DEFINER, 공개·공유 경로, 운영자 기능 키 추가, rtw_* 객체.
-- 짝: docs/20261108040000_feed_pull_now.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261108040000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_feed_pulls') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.proname = 'app_feed_pull_take')
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_workspaces') and contype = 'p'
         and conkey = array[(select attnum from pg_attribute where attrelid = to_regclass('public.app_workspaces') and attname = 'id'
                             and atttypid = 'uuid'::regtype and not attisdropped)]) then
    raise exception 'FEED_PULL_NOW_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_feed_pulls (
  user_id uuid not null,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  day date not null,
  source text not null,
  n integer not null default 0,
  last_at timestamptz not null default now(),
  constraint app_feed_pulls_pkey primary key (user_id, day, source),
  constraint app_feed_pulls_source_check check (source in ('telegram', 'call')),
  constraint app_feed_pulls_n_check check (n between 0 and 1000)
);
create index app_feed_pulls_workspace_idx on public.app_feed_pulls (workspace_id, day);
alter table public.app_feed_pulls enable row level security;
revoke all on table public.app_feed_pulls from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.app_feed_pulls to service_role;

-- 센다: 하루 20번(두 출처 합계), 같은 출처 3분 간격. 결과는 짧은 jsonb(ok·reason·wait_s·left)뿐.
create function public.app_feed_pull_take(p_user uuid, p_workspace uuid, p_source text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day date := (pg_catalog.now() at time zone 'Asia/Seoul')::date;
  v_total integer;
  v_last timestamptz;
  v_wait integer;
begin
  if p_user is null or p_workspace is null or p_source is null or p_source not in ('telegram', 'call') then
    raise exception using errcode = '22023', message = 'FEED_PULL_INVALID';
  end if;
  -- 같은 사람이 동시에 두 번 눌러도 하나씩 센다(이 거래 동안 잠금).
  perform pg_catalog.pg_advisory_xact_lock(7340200, pg_catalog.hashtext(p_user::text));
  select coalesce(sum(p.n), 0)::integer into v_total
    from public.app_feed_pulls p where p.user_id = p_user and p.day = v_day;
  if v_total >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'daily', 'left', 0);
  end if;
  -- 자정 직전에 누른 것도 3분 간격에 넣는다(날짜와 상관없이 그 출처의 마지막 시각).
  select max(p.last_at) into v_last
    from public.app_feed_pulls p where p.user_id = p_user and p.source = p_source;
  if v_last is not null and v_last > pg_catalog.now() - interval '3 minutes' then
    v_wait := greatest(1, ceil(extract(epoch from (v_last + interval '3 minutes' - pg_catalog.now())))::integer);
    return jsonb_build_object('ok', false, 'reason', 'cooldown', 'wait_s', v_wait, 'left', 20 - v_total);
  end if;
  -- 위 잠금 안이라 '고치기 → 없으면 넣기'가 겹치지 않는다.
  update public.app_feed_pulls p set n = p.n + 1, last_at = pg_catalog.now(), workspace_id = p_workspace
   where p.user_id = p_user and p.day = v_day and p.source = p_source;
  if not found then
    insert into public.app_feed_pulls (user_id, workspace_id, day, source, n, last_at)
      values (p_user, p_workspace, v_day, p_source, 1, pg_catalog.now());
  end if;
  delete from public.app_feed_pulls p where p.user_id = p_user and p.day < v_day - 31;
  return jsonb_build_object('ok', true, 'left', 20 - v_total - 1);
end
$$;
revoke all on function public.app_feed_pull_take(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.app_feed_pull_take(uuid, uuid, text) to service_role;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261108040000', 'feed_pull_now', array['S52-46 FEED-pull-now 1/3: new table app_feed_pulls (user_id, workspace_id, KST day, source telegram|call, press count n, last_at; no content columns), RLS on, no policies, service_role select/insert/update/delete only, no anon/authenticated/PUBLIC; new SECURITY INVOKER plpgsql function public.app_feed_pull_take(uuid,uuid,text) with empty search_path (20 presses per person per day across both sources, 3 minutes between presses of one source, advisory lock per person, prunes that person''s rows older than 31 days), execute revoked from PUBLIC, anon, authenticated and service_role, then granted to service_role only; no change to existing objects']);
commit;
