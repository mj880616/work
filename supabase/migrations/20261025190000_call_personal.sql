begin;
-- CALL-개인통화함 1단계 DB (docs/design/call-personal.md 3절·8절). 앱·Edge·Apps Script 변경 없음.
-- 개인 통화(와 애매 통화)도 요약·전문까지 app_feed_items에 둘 수 있게 하고, 업무↔개인↔애매로 옮기는 길을 DB 함수 하나로 만든다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 운영 적용 직전 정지.
--
-- 핵심 설계(막는 쪽이 기본이 되게): 통화의 업무/개인/애매 구분을 source 값 자체에 둔다.
--   'call' = 업무 통화(지금과 같음), 'call_personal' = 개인 통화, 'call_unsure' = 애매 통화, 'telegram' = 텔레그램 소식(그대로).
--   원장 자동 기록(ai-assist)·통화 메뉴 등 지금 읽는 곳은 모두 source=call만 읽으므로, 새 값은 코드를 하나도 안 고쳐도 자동으로 빠진다.
--   앞으로 새 업무 기록 경로가 생겨도 "source=call"로 읽으면 개인이 섞일 수 없다(칸을 하나 더 두는 방식은 필터를 잊으면 섞인다).
--
-- 무엇:
--   1) source·모양 CHECK 교체: 통화 모양을 세 값 모두에 적용. 값 목록만 넓힌다(기존 줄은 전부 'call'·'telegram'이라 그대로 통과).
--   2) 새 CHECK app_feed_items_call_class_check: 개인·애매 통화는 고정(pinned_at)·조직·프로젝트·추천 프로젝트가 항상 비어 있다
--      (주간보고 고정 재료·조직 기록·프로젝트 화면 같은 업무 경로가 개인 통화를 가리킬 수 없게 DB가 보장, 모든 역할 공통).
--   3) 새 칸 두 개: moved_at(마지막으로 옮긴 시각, 트리거가 채움), refilled_at(옮긴 뒤 업무 정보를 다시 채운 시각, 함수가 채움). 둘 다 비어 있을 수 있다.
--   4) 같은 통화 원본(source_ref)은 세 값 통틀어 한 번만: 부분 unique index. 옮기기·다시 보내기로 같은 통화가 두 줄이 되지 않는다.
--   5) 트리거 함수 private.app_feed_item_guard() 본문 교체(같은 서명, INVOKER, 빈 search_path, 실행권 전부 회수 유지):
--      옛 검사(전문은 비우기만, 연결은 같은 작업공간만)는 그대로 + 통화끼리만 옮길 수 있음 + 옮길 때 moved_at 기록·refilled_at 비움
--      + 개인·애매로 옮기면 고정·조직·프로젝트 연결을 함께 비움(기록 줄 자체는 지우지 않는다).
--   6) 새 함수 둘(public, SECURITY DEFINER, search_path 빈칸, 실행권은 authenticated만):
--      app_feed_call_move(p_id, p_to)  — 소유자만, 통화 한 줄의 구분을 work/personal/unsure로 바꾼다. source 칸에 직접 쓰기 권한은 주지 않는다.
--      app_feed_call_work_info(...)    — 소유자만, 업무로 옮긴 직후 한 번만 통화 제목·상대 표기·관련 조직을 채운다(AI 다시 채우기 결과 저장용).
-- 안 하는 것: 표·정책·칸 권한 변경(authenticated는 여전히 source·title·counterpart를 직접 못 고친다, service_role 권한도 그대로),
--   anon·PUBLIC 권한, RLS 변경, 기존 줄 변경, 텔레그램 줄 변경, rtw_* 객체.
--   service_role(collector-feed)은 기존 칸별 insert 권한으로 'call_personal'·'call_unsure'를 넣을 수 있게만 된다(새 권한 없음, moved_at·refilled_at은 못 넣음).
-- 되돌리기(짝 rollback, SQL Editor 경로 전용): 개인·애매 줄이나 옮긴 흔적이 하나라도 있으면 멈춘다(자료를 잃지 않으려고).
--   없으면 함수·index·칸·CHECK를 걷어 내고 트리거 함수를 옛 본문으로 되돌린다.
-- 짝: docs/20261025190000_call_personal.{precheck,snapshot,postcheck,rollback}.sql·.summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 앞 단계가 없거나, 이미 적용됐거나, 표·함수·권한이 예상 모양이 아니면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025190000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024140000' and name = 'call_tg_feed') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024210000' and name = 'feed_item_guard_public') <> 1
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_suborganizations') is null
     or to_regprocedure('public.app_feed_call_move(uuid,text)') is not null
     or to_regprocedure('public.app_feed_call_work_info(uuid,text,text,uuid)') is not null
     or to_regclass('public.app_feed_items_call_ref_key') is not null
     or exists (select 1 from pg_attribute where attrelid = 'public.app_feed_items'::regclass and not attisdropped and attname in ('moved_at', 'refilled_at'))
     or exists (select 1 from pg_constraint where conrelid = 'public.app_feed_items'::regclass and conname = 'app_feed_items_call_class_check')
     or (select count(*) from pg_constraint where conrelid = 'public.app_feed_items'::regclass and conname in ('app_feed_items_source_check', 'app_feed_items_shape_check')) <> 2
     -- 줄이 지금 모양('call'·'telegram'뿐)이다.
     or exists (select 1 from public.app_feed_items where source not in ('call', 'telegram'))
     -- 교체할 트리거 함수가 앞 단계 본문(private 호출 없음)이고 트리거가 하나뿐이다.
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_feed_item_guard()')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc not like '%private.%'
         and prosrc like '%FEED_LINK_SCOPE%' and prosrc like '%FEED_RAW_TEXT_CLEAR_ONLY%') <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_feed_items'::regclass and not tgisinternal and tgname = 'app_feed_items_guard') <> 1
     -- 소유자 확인 함수가 있다(새 함수 둘이 부른다).
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     -- 표 권한이 앞 단계 그대로다: RLS 켜짐, anon·PUBLIC 없음, authenticated는 넣기·지우기·source 쓰기 없음.
     or exists (select 1 from pg_class where oid = 'public.app_feed_items'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_feed_items'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_feed_items', 'insert')
     or has_table_privilege('authenticated', 'public.app_feed_items', 'delete')
     or has_column_privilege('authenticated', 'public.app_feed_items', 'source', 'update')
     or (select count(*) from pg_policy where polrelid = 'public.app_feed_items'::regclass) <> 1 then
    raise exception 'CALL_PERSONAL_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 구분 값과 모양: 통화 세 값은 같은 모양(방 없음, 제목 필수, 원문 개수 0). 텔레그램 모양은 그대로.
alter table public.app_feed_items
  drop constraint app_feed_items_source_check,
  drop constraint app_feed_items_shape_check,
  add constraint app_feed_items_source_check check (source in ('call', 'call_personal', 'call_unsure', 'telegram')),
  add constraint app_feed_items_shape_check check (
    (source in ('call', 'call_personal', 'call_unsure') and room_key is null and room_label is null and title is not null and raw_count = 0)
    or (source = 'telegram' and room_key is not null and room_label is not null and counterpart is null and not speaker_split)),
  -- 2) 개인·애매 통화는 업무 경로로 이어지는 칸이 비어 있어야 한다(업무 'call'과 텔레그램은 제한 없음).
  add constraint app_feed_items_call_class_check check (
    source in ('call', 'telegram')
    or (pinned_at is null and organization_id is null and project_id is null and suggested_project_id is null));

-- 3) 새 칸 둘(기본값 없음, 기존 줄은 비어 있음). authenticated는 표 단위 읽기라 읽을 수 있고, 쓰기 권한은 주지 않는다.
alter table public.app_feed_items
  add column moved_at timestamptz,
  add column refilled_at timestamptz;

-- 4) 같은 통화 원본은 구분이 달라도 한 줄만.
create unique index app_feed_items_call_ref_key on public.app_feed_items (workspace_id, source_ref)
  where source in ('call', 'call_personal', 'call_unsure');

-- 5) 트리거 함수 교체. 본문에 이 함수 이름 말고 schema 이름이 든 호출은 쓰지 않는다(service_role에 schema 사용권이 없다: 20261024210000).
create or replace function private.app_feed_item_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if tg_op = 'UPDATE' and new.raw_text is distinct from old.raw_text and new.raw_text is not null then
    raise exception using errcode = '23514', message = 'FEED_RAW_TEXT_CLEAR_ONLY: the stored copy can only be cleared';
  end if;
  -- 구분 바꾸기: 통화끼리만. 옮긴 시각은 서버가 정하고, 업무 정보를 다시 채워야 하는 상태로 되돌린다.
  if tg_op = 'UPDATE' and new.source is distinct from old.source then
    if old.source not in ('call', 'call_personal', 'call_unsure') or new.source not in ('call', 'call_personal', 'call_unsure') then
      raise exception using errcode = '23514', message = 'FEED_SOURCE_CALL_ONLY: only a call can move between work, personal and unsure';
    end if;
    new.moved_at := pg_catalog.now();
    new.refilled_at := null;
    if new.source <> 'call' then
      new.pinned_at := null;
      new.organization_id := null;
      new.project_id := null;
      new.suggested_project_id := null;
    end if;
  end if;
  if (new.project_id is not null and not exists (
       select 1 from public.app_spaces s
       where s.id = new.project_id and s.workspace_id = new.workspace_id))
     or (new.suggested_project_id is not null and not exists (
       select 1 from public.app_spaces s
       where s.id = new.suggested_project_id and s.workspace_id = new.workspace_id))
     or (new.organization_id is not null and not exists (
       select 1 from public.app_suborganizations o
       where o.id = new.organization_id and o.workspace_id = new.workspace_id)) then
    raise exception using errcode = '23514', message = 'FEED_LINK_SCOPE: linked organization or project must be in the same workspace';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_feed_item_guard() from public, anon, authenticated, service_role;

-- 6-가) 구분 옮기기. 소유자 확인은 함수 안에서 한다(오류는 "없음"과 "남의 것"을 똑같이 돌려줘 존재 여부를 알리지 않는다).
create function public.app_feed_call_move(p_id uuid, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.app_feed_items%rowtype;
  v_target text;
begin
  v_target := case p_to when 'work' then 'call' when 'personal' then 'call_personal' when 'unsure' then 'call_unsure' else null end;
  if v_target is null then
    raise exception using errcode = '22023', message = 'FEED_MOVE_TARGET';
  end if;
  select * into v_row from public.app_feed_items f where f.id = p_id for update;
  if not found or not private.app_is_workspace_owner(v_row.workspace_id) then
    raise exception using errcode = 'P0002', message = 'FEED_NOT_FOUND';
  end if;
  if v_row.source not in ('call', 'call_personal', 'call_unsure') then
    raise exception using errcode = '23514', message = 'FEED_NOT_CALL';
  end if;
  if v_row.source = v_target then
    return pg_catalog.jsonb_build_object('ok', true, 'id', v_row.id, 'from', v_row.source, 'to', v_target, 'changed', false, 'needs_refill', false);
  end if;
  update public.app_feed_items f
     set source = v_target, updated_at = pg_catalog.now()
   where f.id = v_row.id
     and f.workspace_id = v_row.workspace_id;
  return pg_catalog.jsonb_build_object('ok', true, 'id', v_row.id, 'from', v_row.source, 'to', v_target, 'changed', true, 'needs_refill', v_target = 'call');
end
$$;
revoke all on function public.app_feed_call_move(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.app_feed_call_move(uuid, text) to authenticated;

-- 6-나) 업무로 옮긴 직후 한 번만 업무 기준 정보를 채운다: 옮긴 적이 있고(moved_at) 아직 안 채운(refilled_at 비어 있음) 업무 통화에만.
--   조직은 같은 작업공간 것만(휴지통 여부는 보지 않는다: 그 열이 다른 migration 소관이라 이 파일이 기대지 않는다. AI에는 쓸 수 있는 조직 목록만 준다). 제목은 비우면 그대로 두고, 상대 표기·조직은 비우면 비운 채로 "채움 끝"만 기록한다(AI가 못 찾은 경우). 핵심내용·전문은 이 함수가 건드리지 않는다.
create function public.app_feed_call_work_info(p_id uuid, p_title text, p_counterpart text, p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.app_feed_items%rowtype;
begin
  select * into v_row from public.app_feed_items f where f.id = p_id for update;
  if not found or not private.app_is_workspace_owner(v_row.workspace_id) then
    raise exception using errcode = 'P0002', message = 'FEED_NOT_FOUND';
  end if;
  if v_row.source <> 'call' or v_row.moved_at is null or v_row.refilled_at is not null then
    raise exception using errcode = '23514', message = 'FEED_REFILL_NOT_PENDING';
  end if;
  if p_organization_id is not null and not exists (
       select 1 from public.app_suborganizations o
       where o.id = p_organization_id and o.workspace_id = v_row.workspace_id) then
    raise exception using errcode = '23514', message = 'FEED_LINK_SCOPE: linked organization must be in the same workspace';
  end if;
  update public.app_feed_items f
     set title = coalesce(nullif(pg_catalog.btrim(p_title), ''), f.title),
         counterpart = nullif(pg_catalog.btrim(p_counterpart), ''),
         organization_id = p_organization_id,
         refilled_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where f.id = v_row.id
     and f.workspace_id = v_row.workspace_id;
  return pg_catalog.jsonb_build_object('ok', true, 'id', v_row.id);
end
$$;
revoke all on function public.app_feed_call_work_info(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_feed_call_work_info(uuid, text, text, uuid) to authenticated;

-- 마지막 확인: 어긋나면 전체 취소. 표 권한·정책은 그대로, 새 함수는 authenticated만 실행, 트리거 함수는 아무도 실행 못 함.
do $$
begin
  if (select count(*) from pg_proc where oid = to_regprocedure('private.app_feed_item_guard()')
      and not prosecdef and proconfig = array['search_path=""'] and prosrc not like '%private.%'
      and prosrc like '%FEED_SOURCE_CALL_ONLY%' and coalesce(proacl::text, '') !~ '(^|[{,])(anon|authenticated|service_role)?=') <> 1
     or (select count(*) from pg_proc where oid in (to_regprocedure('public.app_feed_call_move(uuid,text)'), to_regprocedure('public.app_feed_call_work_info(uuid,text,text,uuid)'))
         and prosecdef and proconfig = array['search_path=""']
         and has_function_privilege('authenticated', oid, 'execute')
         and not has_function_privilege('anon', oid, 'execute')
         and not has_function_privilege('service_role', oid, 'execute')
         and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 2
     or (select count(*) from pg_trigger where tgrelid = 'public.app_feed_items'::regclass and not tgisinternal and tgname = 'app_feed_items_guard') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_feed_items'::regclass) <> 1
     or exists (select 1 from pg_class where oid = 'public.app_feed_items'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_column_privilege('authenticated', 'public.app_feed_items', 'source', 'update')
     or has_column_privilege('authenticated', 'public.app_feed_items', 'title', 'update')
     or has_column_privilege('authenticated', 'public.app_feed_items', 'moved_at', 'update')
     or has_column_privilege('authenticated', 'public.app_feed_items', 'refilled_at', 'update')
     or has_column_privilege('service_role', 'public.app_feed_items', 'moved_at', 'insert')
     or has_column_privilege('service_role', 'public.app_feed_items', 'refilled_at', 'insert')
     or has_any_column_privilege('service_role', 'public.app_feed_items', 'update')
     or (select count(*) from pg_constraint where conrelid = 'public.app_feed_items'::regclass
         and conname in ('app_feed_items_source_check', 'app_feed_items_shape_check', 'app_feed_items_call_class_check')) <> 3
     or to_regclass('public.app_feed_items_call_ref_key') is null then
    raise exception 'CALL_PERSONAL_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261025190000', 'call_personal', array['CALL-개인통화함 1단계: app_feed_items.source accepts call_personal/call_unsure (call shape), personal/unsure rows cannot hold pin/organization/project, moved_at/refilled_at columns, partial unique index on call source_ref, guard trigger function replaced (call-only moves, clears links on move), app_feed_call_move + app_feed_call_work_info (SECURITY DEFINER, owner check, execute to authenticated only), no table/column grant or policy change']);
commit;
