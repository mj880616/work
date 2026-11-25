begin;
-- S70-20 FORGET-이미한일빼기(명진 11/25 "텔레그램에서 내가 답변을 했다거나 하면 제안 없애든지").
-- 텔레그램 '나한테 온 요청' 후보 중, 요청 뒤 내가(작업공간 주인) 이미 답한 것을 서버가 '이미 함(저절로, 답장함)'으로 옮길 수 있게 한다.
-- 답했는지 판정은 collector-feed(supabase/functions/collector-feed/replied.ts) 한 곳에서 하고, DB는 아래만 한다.
--   1) public.app_todo_candidates에 칸 넷: ask_at(요청 메시지 시각), ask_ref(요청 메시지 번호), auto_done('replied'만), auto_done_at.
--      글 칸이 아니다(시각·번호·고정 낱말). authenticated는 표 단위 select로 읽기만 하고, 새 칸 쓰기 권한은 주지 않는다(update 칸 권한 그대로).
--      되돌리기([되돌리기])는 기존 길(status·decided_at만 바꿈)이고 auto_done은 남아 같은 줄을 다시 저절로 옮기지 않는다(아래 3).
--      화면은 status='done'이고 decided_at = auto_done_at인 줄에만 '답장함' 꼬리표를 단다(사람이 다시 [이미 함]을 누르면 시각이 달라짐).
--   2) public.app_todo_candidate_from_telegram_at(...8개): 기존 넣기 함수와 같은 검사·같은 dedupe에 요청 시각·번호를 함께 넣고,
--      p_auto_done='replied'이면 처음부터 status='done'·decided_at=auto_done_at=now()로 넣는다(같은 묶음에서 이미 답한 요청).
--   3) public.app_todo_tg_open_asks(p_workspace, p_room_key): 그 방(소식 줄 room_key)의 처리 전 텔레그램 후보 중 최근 3일·아직 저절로 옮긴 적 없는 것의
--      id·ask_at·ask_ref만(최대 50줄, 글 없음) 돌려준다.
--   4) public.app_todo_tg_auto_done(p_workspace, p_ids uuid[]): 그 작업공간의 처리 전·텔레그램·아직 저절로 옮긴 적 없는 줄만 done으로(최대 50개).
-- 세 함수 모두 SECURITY DEFINER, 빈 search_path, 실행권은 service_role만(PUBLIC·anon·authenticated 회수). 운영자 기능 판정은 기존 트리거
-- trg_op_feature_guard(텔레그램 줄 insert·update, 20261102030000)가 그대로 본다.
-- 안 하는 것: 표 grant·정책 변경, 기존 함수 변경·삭제, 기존 줄 변경, 가족 잊지 말기 표 변경, rtw_* 객체.
-- 짝: docs/20261125120000_todo_tg_auto_done.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125120000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029120000' and name = 'todo_candidates_telegram') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261101180000' and name = 'todo_feedback') <> 1
     or to_regclass('public.app_todo_candidates') is null
     or to_regclass('public.app_feed_items') is null
     or to_regprocedure('public.app_todo_candidate_from_telegram(uuid,text,text,text,date)') is null
     or to_regprocedure('public.app_todo_candidate_from_telegram_at(uuid,text,text,text,date,timestamp with time zone,text,text)') is not null
     or to_regprocedure('public.app_todo_tg_open_asks(uuid,text)') is not null
     or to_regprocedure('public.app_todo_tg_auto_done(uuid,uuid[])') is not null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_todo_candidates') and attnum > 0 and not attisdropped
                  and attname in ('ask_at', 'ask_ref', 'auto_done', 'auto_done_at')) then
    raise exception 'TODO_TG_AUTO_DONE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_todo_candidates add column ask_at timestamptz;
alter table public.app_todo_candidates add column ask_ref text;
alter table public.app_todo_candidates add column auto_done text;
alter table public.app_todo_candidates add column auto_done_at timestamptz;
alter table public.app_todo_candidates add constraint app_todo_candidates_ask_ref_check
  check (ask_ref is null or ask_ref ~ '^[A-Za-z0-9_.:-]{1,40}$');
alter table public.app_todo_candidates add constraint app_todo_candidates_auto_done_check
  check ((auto_done is null and auto_done_at is null) or (auto_done = 'replied' and auto_done_at is not null and source_kind = 'telegram'));

create function public.app_todo_candidate_from_telegram_at(p_workspace uuid, p_source_ref text, p_summary text, p_evidence text, p_due date,
  p_ask_at timestamptz, p_ask_ref text, p_auto_done text)
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
     or (p_auto_done is not null and p_auto_done <> 'replied') then
    raise exception using errcode = '22023', message = 'TODO_TG_ARGS';
  end if;
  select i.id, i.day, i.organization_id into v_item, v_day, v_org
    from public.app_feed_items i
    where i.source_ref = p_source_ref and i.workspace_id = p_workspace and i.source = 'telegram' and i.hidden_at is null;
  if v_item is null then
    raise exception using errcode = '22023', message = 'TODO_TG_SOURCE';
  end if;
  insert into public.app_todo_candidates (workspace_id, kind, summary, due, source_kind, source_id, source_day, evidence, dedupe_key, organization_id,
      ask_at, ask_ref, status, decided_at, auto_done, auto_done_at)
    values (p_workspace, 'request', v_summary, p_due, 'telegram', v_item, v_day, v_evidence, 'tg:' || v_item::text, v_org,
      p_ask_at, p_ask_ref, case when v_done then 'done' else 'open' end, case when v_done then v_now end,
      case when v_done then 'replied' end, case when v_done then v_now end)
    on conflict (workspace_id, dedupe_key) do nothing
    returning id into v_id;
  return pg_catalog.jsonb_build_object('result', case when v_id is null then 'exists' else 'added' end);
end
$$;

create function public.app_todo_tg_open_asks(p_workspace uuid, p_room_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if p_workspace is null or p_room_key is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TODO_TG_ARGS';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.id, 'ask_at', x.ask_at, 'ask_ref', x.ask_ref) order by x.ask_at), '[]'::jsonb)
    into v_rows
    from (select c.id, c.ask_at, c.ask_ref
            from public.app_todo_candidates c
            join public.app_feed_items i on i.id = c.source_id and i.workspace_id = c.workspace_id and i.source = 'telegram'
           where c.workspace_id = p_workspace and c.source_kind = 'telegram' and c.status = 'open' and c.auto_done is null
             and c.ask_at is not null and c.ask_ref is not null and c.ask_at >= pg_catalog.now() - interval '3 days'
             and i.room_key = p_room_key
           order by c.ask_at desc
           limit 50) x;
  return pg_catalog.jsonb_build_object('rows', v_rows);
end
$$;

create function public.app_todo_tg_auto_done(p_workspace uuid, p_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_n integer;
begin
  if p_workspace is null or p_ids is null or pg_catalog.cardinality(p_ids) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'TODO_TG_ARGS';
  end if;
  update public.app_todo_candidates c
     set status = 'done', decided_at = v_now, auto_done = 'replied', auto_done_at = v_now
   where c.workspace_id = p_workspace and c.id = any (p_ids) and c.source_kind = 'telegram' and c.status = 'open' and c.auto_done is null;
  get diagnostics v_n = row_count;
  return pg_catalog.jsonb_build_object('done', v_n);
end
$$;

revoke all on function public.app_todo_candidate_from_telegram_at(uuid, text, text, text, date, timestamptz, text, text) from public, anon, authenticated, service_role;
revoke all on function public.app_todo_tg_open_asks(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.app_todo_tg_auto_done(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.app_todo_candidate_from_telegram_at(uuid, text, text, text, date, timestamptz, text, text) to service_role;
grant execute on function public.app_todo_tg_open_asks(uuid, text) to service_role;
grant execute on function public.app_todo_tg_auto_done(uuid, uuid[]) to service_role;

do $$
begin
  if (select count(*) from pg_attribute where attrelid = 'public.app_todo_candidates'::regclass and attnum > 0 and not attisdropped
        and attname in ('ask_at', 'ask_ref', 'auto_done', 'auto_done_at')) <> 4
     or (select count(*) from pg_constraint where conrelid = 'public.app_todo_candidates'::regclass
           and conname in ('app_todo_candidates_ask_ref_check', 'app_todo_candidates_auto_done_check') and convalidated) <> 2
     or (select count(*) from pg_proc where oid in (
           to_regprocedure('public.app_todo_candidate_from_telegram_at(uuid,text,text,text,date,timestamp with time zone,text,text)'),
           to_regprocedure('public.app_todo_tg_open_asks(uuid,text)'), to_regprocedure('public.app_todo_tg_auto_done(uuid,uuid[])'))
           and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 3
     or has_function_privilege('anon', 'public.app_todo_tg_auto_done(uuid,uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.app_todo_tg_auto_done(uuid,uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.app_todo_tg_open_asks(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.app_todo_candidate_from_telegram_at(uuid,text,text,text,date,timestamp with time zone,text,text)', 'execute')
     or has_column_privilege('authenticated', 'public.app_todo_candidates'::regclass, 'auto_done', 'update')
     or has_column_privilege('authenticated', 'public.app_todo_candidates'::regclass, 'auto_done', 'insert')
     or has_any_column_privilege('service_role', 'public.app_todo_candidates'::regclass, 'select,insert,update,references')
     or has_any_column_privilege('anon', 'public.app_todo_candidates'::regclass, 'select,insert,update,references') then
    raise exception 'TODO_TG_AUTO_DONE_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125120000', 'todo_tg_auto_done', array['S70-20 FORGET-이미한일빼기: app_todo_candidates adds ask_at, ask_ref, auto_done (replied only, telegram only), auto_done_at with checks, no new column grants; SECURITY DEFINER functions app_todo_candidate_from_telegram_at, app_todo_tg_open_asks (ids and times only), app_todo_tg_auto_done (open telegram rows not auto-moved before) with empty search_path and service_role execute only; no table grant, policy or existing function change']);
commit;
