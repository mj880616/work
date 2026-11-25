begin;
-- S70-20b FORGET-기본이미함(명진 11/25 12:36 "할일에 추가하지도 않고 이미 해버린 일이 많다는거야", 12:39 "모두 추천대로").
-- 잊지 말기 업무 제안(텔레그램 요청·AI 제안)의 기본을 뒤집는다: 아무것도 하지 않으면 서버가 저절로 '이미 함(지남)'으로 옮긴다.
--   ① 들어온 날(서울)·그다음 날(화면에서는 '어제 들어온 요청 n개' 한 줄 묶음)까지 처리 전에 두고, 그다음 날 0시(서울)가 지나면
--      예약 'web2_forget_auto_expire'(매일 UTC 15:13 = 서울 00:13)가 public.app_forget_auto_expire()로 옮긴다.
--      옮기는 줄: status='open'·auto_done 없음·마감(due) 없음·직접 부름(ask_direct) 아님·서울 기준 어제 0시보다 먼저 들어온 줄.
--      옮기면 status='done', decided_at = auto_done_at = now(), auto_done='expired'. 화면 '이미 함' 보기에 '지남' 꼬리표와 [되돌리기].
--      되돌리면(기존 되살리기 길, status·decided_at만) auto_done이 남아 다시 옮기지 않는다.
--   ③ 중요 ★: 마감 날짜가 있는 줄과 명진을 직접 부른 텔레그램 요청(1:1 방·내 메시지에 단 답장·내 이름을 부른 메시지)은 옮기지 않는다.
--      직접 부름은 collector-feed(supabase/functions/collector-feed/replied.ts askDirect)가 판정해 새 넣기 함수로 함께 넣는다.
-- 하는 것:
--   1) public.app_todo_candidates에 칸 둘: ask_direct boolean, ask_from(부탁한 사람의 이름표 열쇠 = 수집기가 만든 16~32자리 16진수 해시, 이름·번호 원문 아님).
--      둘 다 텔레그램 줄만, 글 칸 아님. authenticated는 표 단위 select로 읽기만(새 칸 쓰기 권한 없음).
--      ② 흔적 넓히기: 요청 뒤 그 사람과의 1:1 방에 내가 메시지를 보냈으면(다른 방 답) collector-feed가 '답장함'으로 옮긴다 — ask_from으로 찾는다.
--   2) 검사 app_todo_candidates_auto_done_check를 넓힌다: 'replied'(텔레그램만, 그대로) + 'expired'(모든 출처).
--   3) public.app_todo_candidate_from_telegram_ask(...10개): 20261125120000의 넣기 함수와 같은 검사·같은 dedupe에 p_direct·p_from을 더한 판.
--      public.app_todo_tg_open_asks_peer(p_workspace, p_room_key): 그 1:1 방 상대(이름표 표에서 그 방의 '나' 아닌 사람이 정확히 한 명일 때)가
--      다른 방에서 한 처리 전 텔레그램 요청(최근 3일, 저절로 옮긴 적 없음)의 id·ask_at만(최대 50줄, 글·열쇠 없음).
--      옮기기는 20261125120000의 app_todo_tg_auto_done을 그대로 쓴다(처리 전 텔레그램 줄만, 'replied').
--      SECURITY DEFINER·빈 search_path·service_role 실행만. 옛 두 넣기 함수는 그대로 둔다(collector-feed가 없으면 그쪽으로 물러남).
--   4) public.app_forget_auto_expire(): 위 ①의 옮기기 한 곳. 글을 읽지 않고 옮긴 줄 수만 돌려준다. 실행권은 누구에게도 주지 않는다
--      (예약은 함수 주인으로 돈다). 운영자 기능 트리거 trg_op_feature_guard는 그대로 본다.
--   5) 예약 하나 'web2_forget_auto_expire'(cron 예약 등록 규칙: 고정 이름, 명령은 위 함수 부르기 하나).
-- 안 하는 것: 표 grant·정책 변경, 기존 함수 변경·삭제, 가족 잊지 말기 표·소식 표 변경, 다른 예약, rtw_* 객체.
-- 짝: docs/20261125160000_forget_auto_expire.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125160000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261125120000' and name = 'todo_tg_auto_done') <> 1
     or to_regclass('public.app_todo_candidates') is null
     or to_regprocedure('public.app_todo_candidate_from_telegram_at(uuid,text,text,text,date,timestamp with time zone,text,text)') is null
     or to_regprocedure('public.app_todo_candidate_from_telegram_ask(uuid,text,text,text,date,timestamp with time zone,text,text,boolean,text)') is not null
     or to_regprocedure('public.app_todo_tg_open_asks_peer(uuid,text)') is not null
     or to_regprocedure('public.app_todo_tg_auto_done(uuid,uuid[])') is null
     or to_regprocedure('public.app_forget_auto_expire()') is not null
     or to_regclass('public.app_operator_features') is null
     or to_regclass('public.app_tg_day_senders') is null or to_regclass('public.app_tg_senders') is null
     or (select count(*) from pg_constraint where conrelid = to_regclass('public.app_todo_candidates') and conname = 'app_todo_candidates_auto_done_check') <> 1
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_todo_candidates') and attnum > 0 and not attisdropped and attname in ('ask_direct', 'ask_from'))
     or to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regclass('cron.job') is null
     or coalesce(current_setting('cron.timezone', true), '') not in ('GMT', 'UTC', 'Etc/UTC')
     or exists (select 1 from cron.job where jobname = 'web2_forget_auto_expire') then
    raise exception 'FORGET_AUTO_EXPIRE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_todo_candidates add column ask_direct boolean;
alter table public.app_todo_candidates add column ask_from text;
alter table public.app_todo_candidates add constraint app_todo_candidates_ask_direct_check
  check (ask_direct is null or source_kind = 'telegram');
alter table public.app_todo_candidates add constraint app_todo_candidates_ask_from_check
  check (ask_from is null or (source_kind = 'telegram' and ask_from ~ '^[0-9a-f]{16,32}$'));
alter table public.app_todo_candidates drop constraint app_todo_candidates_auto_done_check;
alter table public.app_todo_candidates add constraint app_todo_candidates_auto_done_check
  check ((auto_done is null and auto_done_at is null)
    or (auto_done = 'replied' and auto_done_at is not null and source_kind = 'telegram')
    or (auto_done = 'expired' and auto_done_at is not null));

create function public.app_todo_candidate_from_telegram_ask(p_workspace uuid, p_source_ref text, p_summary text, p_evidence text, p_due date,
  p_ask_at timestamptz, p_ask_ref text, p_auto_done text, p_direct boolean, p_from text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item uuid;
  v_day date;
  v_org uuid;
  v_summary text := pg_catalog.btrim(coalesce(p_summary, ''));
  v_evidence text := pg_catalog.btrim(coalesce(p_evidence, ''));
  v_now timestamptz := pg_catalog.now();
  v_done boolean := p_auto_done is not null;
  v_id uuid;
begin
  if p_workspace is null or p_source_ref is null or p_source_ref !~ '^tg:[A-Za-z0-9_-]{1,64}:[0-9]{1,4}$'
     or pg_catalog.char_length(v_summary) not between 1 and 100 or v_summary ~ '[[:cntrl:]]'
     or pg_catalog.char_length(v_evidence) > 200 or v_evidence ~ '[[:cntrl:]]'
     or p_ask_at is null or p_ask_ref is null or p_ask_ref !~ '^[A-Za-z0-9_.:-]{1,40}$'
     or (p_auto_done is not null and p_auto_done <> 'replied') or p_direct is null
     or (p_from is not null and p_from !~ '^[0-9a-f]{16,32}$') then
    raise exception using errcode = '22023', message = 'TODO_TG_ARGS';
  end if;
  select i.id, i.day, i.organization_id into v_item, v_day, v_org
    from public.app_feed_items i
    where i.source_ref = p_source_ref and i.workspace_id = p_workspace and i.source = 'telegram' and i.hidden_at is null;
  if v_item is null then
    raise exception using errcode = '22023', message = 'TODO_TG_SOURCE';
  end if;
  insert into public.app_todo_candidates (workspace_id, kind, summary, due, source_kind, source_id, source_day, evidence, dedupe_key, organization_id,
      ask_at, ask_ref, ask_direct, ask_from, status, decided_at, auto_done, auto_done_at)
    values (p_workspace, 'request', v_summary, p_due, 'telegram', v_item, v_day, v_evidence, 'tg:' || v_item::text, v_org,
      p_ask_at, p_ask_ref, p_direct, p_from, case when v_done then 'done' else 'open' end, case when v_done then v_now end,
      case when v_done then 'replied' end, case when v_done then v_now end)
    on conflict (workspace_id, dedupe_key) do nothing
    returning id into v_id;
  return pg_catalog.jsonb_build_object('result', case when v_id is null then 'exists' else 'added' end);
end
$$;

create function public.app_todo_tg_open_asks_peer(p_workspace uuid, p_room_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_peer text[];
  v_rows jsonb;
begin
  if p_workspace is null or p_room_key is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TODO_TG_ARGS';
  end if;
  -- 그 방에 나온 나 아닌 사람의 이름표 열쇠. 정확히 한 사람일 때만(1:1 방) 찾는다.
  select pg_catalog.array_agg(distinct s.sender_key) into v_peer
    from public.app_tg_day_senders d
    join public.app_tg_senders s on s.workspace_id = d.workspace_id and s.id = d.sender_id
   where d.workspace_id = p_workspace and d.room_key = p_room_key and not s.is_self and s.sender_key is not null;
  if coalesce(pg_catalog.cardinality(v_peer), 0) <> 1 then
    return pg_catalog.jsonb_build_object('rows', '[]'::jsonb);
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.id, 'ask_at', x.ask_at) order by x.ask_at), '[]'::jsonb)
    into v_rows
    from (select c.id, c.ask_at
            from public.app_todo_candidates c
            join public.app_feed_items i on i.id = c.source_id and i.workspace_id = c.workspace_id and i.source = 'telegram'
           where c.workspace_id = p_workspace and c.source_kind = 'telegram' and c.status = 'open' and c.auto_done is null
             and c.ask_from = v_peer[1] and i.room_key is distinct from p_room_key
             and c.ask_at is not null and c.ask_at >= pg_catalog.now() - interval '3 days'
           order by c.ask_at desc
           limit 50) x;
  return pg_catalog.jsonb_build_object('rows', v_rows);
end
$$;

create function public.app_forget_auto_expire()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  -- 서울 기준 어제 0시. 이보다 먼저 들어온 줄 = 들어온 날과 그다음 날('어제' 묶음)이 모두 지난 줄.
  v_cut timestamptz := ((pg_catalog.timezone('Asia/Seoul', v_now))::date - 1)::timestamp at time zone 'Asia/Seoul';
  v_n integer;
begin
  update public.app_todo_candidates c
     set status = 'done', decided_at = v_now, auto_done = 'expired', auto_done_at = v_now
   where c.status = 'open' and c.auto_done is null and c.due is null and c.ask_direct is not true and c.created_at < v_cut
     -- 텔레그램 줄은 운영자 기능이 켜진 작업공간만(기존 트리거 trg_op_feature_guard가 막을 줄 하나 때문에 예약 전체가 멈추지 않게).
     -- 기능 판정은 트리거와 같이 허용 표 행만 본다(예약에는 로그인 사람이 없어 주인 확인 함수를 쓸 수 없다).
     and (c.source_kind <> 'telegram' or exists (select 1 from public.app_operator_features f where f.workspace_id = c.workspace_id and f.feature = 'telegram'));
  get diagnostics v_n = row_count;
  return pg_catalog.jsonb_build_object('expired', v_n);
end
$$;

revoke all on function public.app_todo_candidate_from_telegram_ask(uuid, text, text, text, date, timestamptz, text, text, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.app_todo_tg_open_asks_peer(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.app_forget_auto_expire() from public, anon, authenticated, service_role;
grant execute on function public.app_todo_candidate_from_telegram_ask(uuid, text, text, text, date, timestamptz, text, text, boolean, text) to service_role;
grant execute on function public.app_todo_tg_open_asks_peer(uuid, text) to service_role;

select cron.schedule('web2_forget_auto_expire', '13 15 * * *', $cmd$select public.app_forget_auto_expire()$cmd$);

do $$
begin
  if (select count(*) from pg_attribute where attrelid = 'public.app_todo_candidates'::regclass and attnum > 0 and not attisdropped and attname in ('ask_direct', 'ask_from')) <> 2
     or (select count(*) from pg_constraint where conrelid = 'public.app_todo_candidates'::regclass
           and conname in ('app_todo_candidates_ask_direct_check', 'app_todo_candidates_ask_from_check', 'app_todo_candidates_auto_done_check') and convalidated) <> 3
     or (select count(*) from pg_proc where oid in (
           to_regprocedure('public.app_todo_candidate_from_telegram_ask(uuid,text,text,text,date,timestamp with time zone,text,text,boolean,text)'),
           to_regprocedure('public.app_todo_tg_open_asks_peer(uuid,text)'), to_regprocedure('public.app_forget_auto_expire()'))
           and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 3
     or has_function_privilege('anon', 'public.app_forget_auto_expire()', 'execute')
     or has_function_privilege('authenticated', 'public.app_forget_auto_expire()', 'execute')
     or has_function_privilege('service_role', 'public.app_forget_auto_expire()', 'execute')
     or has_function_privilege('anon', 'public.app_todo_candidate_from_telegram_ask(uuid,text,text,text,date,timestamp with time zone,text,text,boolean,text)', 'execute')
     or has_function_privilege('authenticated', 'public.app_todo_candidate_from_telegram_ask(uuid,text,text,text,date,timestamp with time zone,text,text,boolean,text)', 'execute')
     or has_function_privilege('authenticated', 'public.app_todo_tg_open_asks_peer(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.app_todo_tg_open_asks_peer(uuid,text)', 'execute')
     or has_column_privilege('authenticated', 'public.app_todo_candidates'::regclass, 'ask_direct', 'update')
     or has_column_privilege('authenticated', 'public.app_todo_candidates'::regclass, 'ask_direct', 'insert')
     or has_column_privilege('authenticated', 'public.app_todo_candidates'::regclass, 'ask_from', 'update')
     or has_column_privilege('authenticated', 'public.app_todo_candidates'::regclass, 'ask_from', 'insert')
     or has_any_column_privilege('anon', 'public.app_todo_candidates'::regclass, 'select,insert,update,references')
     or (select count(*) from cron.job where jobname = 'web2_forget_auto_expire') <> 1
     or not exists (select 1 from cron.job where jobname = 'web2_forget_auto_expire' and schedule = '13 15 * * *' and active
                      and command = $cmd$select public.app_forget_auto_expire()$cmd$) then
    raise exception 'FORGET_AUTO_EXPIRE_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125160000', 'forget_auto_expire', array['S70-20b FORGET-기본이미함: app_todo_candidates adds ask_direct and ask_from (sender key hash; telegram only, no new column grants) and widens app_todo_candidates_auto_done_check with expired (any source); SECURITY DEFINER app_todo_candidate_from_telegram_ask and app_todo_tg_open_asks_peer (open asks by the 1:1 room peer in other rooms, ids and times only) (service_role execute only) and app_forget_auto_expire (no execute grants; moves open rows without due, not direct, created before yesterday 00:00 Asia/Seoul to done/expired, returns count only) with empty search_path; pg_cron job web2_forget_auto_expire daily 15:13 UTC calling it; no table grant, policy, existing function or other job change']);
commit;
