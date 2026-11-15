begin;
-- MTG-기록겹침거르기 1단계 DB (docs/design/record-overlap.md 3.3·5절 1번·6절, 명진 결정 2026-10-25 16:05: 8절 질문 9개 모두 추천대로). 앱·Edge 코드 변경 없음.
-- 사업 보고와 프로젝트 기록이 같은 일을 두 번 적은 것을 AI가 "같은 일이다/아니다/애매"로 판정한 결과를 서버에 저장할 새 표와 저장 함수를 만든다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 운영 적용 직전 정지.
--
-- 무엇:
--   1) 새 표 app_record_overlaps: 기록 두 건(a_ref < b_ref, 글자 참조 '<종류>:<uuid>')마다 판정 1행(same·different·unsure),
--      누가 판정했나(ai·user·link), 이유 한 줄(120자 이하), 판정 때 글 지문(낡음 판단용), 모델 이름.
--      종류는 meeting·project_update·org_update·basket만 받는다(work·call은 다음 단계). 참조는 글자라 외래키가 없고 읽는 쪽이 지금 있는 기록과 맞춰 본다.
--   2) owner 정책 하나(private.app_is_workspace_owner), authenticated만, PUBLIC·anon·service_role 권한 없음, 칸 단위 grant, SECURITY DEFINER 없음.
--      지우기 권한은 주지 않는다(기록은 지우지 않는다. 빼기는 화면에서 가리는 것뿐). 쌍·작업공간은 만든 뒤 못 바꾼다.
--   3) 넣기·고치기 보호 트리거 하나(INVOKER, private.app_record_overlap_guard): 두 기록이 이 작업공간에 실제로 있는지 소유자 정책(RLS)을 따라 읽어 확인하고,
--      이미 사용자(user) 판정인 쌍을 ai·link 판정이 덮어쓰지 못하게 하고(조용히 그대로 둠), link 판정은 바구니 메모와 사업 보고의 연결 줄이 실제로 있을 때만 받는다.
--      이 규칙이 표에 있으므로 함수를 거치지 않는 직접 쓰기에도 같다.
--   4) 저장 함수 public.app_record_overlap_set(작업공간, 판정 목록): 1~20쌍, 전부 아니면 전무, 쌍 순서는 함수가 맞춘다(a_ref < b_ref, 글자 바이트 순서).
--      INVOKER(소유자 RLS를 그대로 따름), search_path 고정, authenticated만 실행. 사용자 판정을 덮어쓰지 않은 개수를 돌려준다.
-- 안 하는 것: 기존 표·정책·권한·함수 변경, ai-assist·화면, 기존 기록 읽기·복사, service_role 권한. 서버는 아직 이 표를 쓰지 않으므로 지금 동작은 그대로다.
-- service_role 경로: 새 객체에 service_role 권한이 없고 ai-assist는 명진 로그인 토큰(authenticated)으로만 이 함수를 부른다.
-- 짝: docs/20261025190000_record_overlap_db.{precheck,snapshot,postcheck,rollback}.sql·.summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록·새 객체 없음, owner 함수, 읽을 표와 칸이 모두 있음.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025190000')
     or to_regclass('public.app_record_overlaps') is not null
     or to_regprocedure('public.app_record_overlap_set(uuid,jsonb)') is not null
     or to_regprocedure('private.app_record_overlap_guard()') is not null
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or (select count(*) from pg_attribute where not attisdropped and attnum > 0 and (
           (attrelid = to_regclass('public.app_meetings') and attname in ('id', 'workspace_id'))
        or (attrelid = to_regclass('public.app_notes') and attname in ('id', 'workspace_id', 'kind'))
        or (attrelid = to_regclass('public.app_spaces') and attname in ('id', 'workspace_id'))
        or (attrelid = to_regclass('public.app_suborganizations') and attname in ('id', 'workspace_id'))
        or (attrelid = to_regclass('public.app_project_progress_updates') and attname in ('id', 'project_id'))
        or (attrelid = to_regclass('public.app_suborganization_updates') and attname in ('id', 'organization_id'))
        or (attrelid = to_regclass('public.app_record_links') and attname in ('workspace_id', 'note_id', 'meeting_id')))) <> 16 then
    raise exception 'RECORD_OVERLAP_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 판정 표. 참조 모양은 소문자 uuid만(다음 단계의 줄 지문 '#8자'는 그때 CHECK를 넓힌다).
create table public.app_record_overlaps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  a_ref text not null,
  b_ref text not null,
  verdict text not null,
  decided_by text not null,
  keep_ref text,
  reason text,
  a_hash text,
  b_hash text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_record_overlaps_pair unique (workspace_id, a_ref, b_ref),
  constraint app_record_overlaps_order check (pg_catalog.convert_to(a_ref, 'UTF8') < pg_catalog.convert_to(b_ref, 'UTF8')),
  constraint app_record_overlaps_ref_check check (
    a_ref ~ '^(meeting|project_update|org_update|basket):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and b_ref ~ '^(meeting|project_update|org_update|basket):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint app_record_overlaps_verdict_check check (verdict in ('same', 'different', 'unsure')),
  constraint app_record_overlaps_decided_by_check check (decided_by in ('ai', 'user', 'link')),
  constraint app_record_overlaps_link_same check (decided_by <> 'link' or verdict = 'same'),
  constraint app_record_overlaps_keep_check check (keep_ref is null or keep_ref in (a_ref, b_ref)),
  constraint app_record_overlaps_reason_check check (reason is null or (char_length(reason) <= 120 and reason !~ '[[:cntrl:]]')),
  constraint app_record_overlaps_hash_check check (
    (a_hash is null or a_hash ~ '^[0-9a-f]{16}$') and (b_hash is null or b_hash ~ '^[0-9a-f]{16}$')),
  constraint app_record_overlaps_model_check check (model is null or (char_length(model) between 1 and 60 and model !~ '[[:cntrl:]]'))
);
create index app_record_overlaps_b_idx on public.app_record_overlaps (workspace_id, b_ref);

-- 2) 권한: 호스팅 기본 권한을 모두 걷어 낸 뒤 authenticated에 필요한 만큼만. 지우기 없음, 쌍·작업공간은 못 바꿈.
alter table public.app_record_overlaps enable row level security;
revoke all on table public.app_record_overlaps from public, anon, authenticated, service_role;
grant select on table public.app_record_overlaps to authenticated;
grant insert (workspace_id, a_ref, b_ref, verdict, decided_by, keep_ref, reason, a_hash, b_hash, model)
  on table public.app_record_overlaps to authenticated;
grant update (verdict, decided_by, keep_ref, reason, a_hash, b_hash, model, updated_at)
  on table public.app_record_overlaps to authenticated;

create policy record_overlaps_owner_all on public.app_record_overlaps for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 3) 보호 트리거 함수(INVOKER). 읽는 표는 호출한 사람의 소유자 RLS를 그대로 따른다. 트리거는 만든 쪽 권한으로 걸리므로 실행권은 아무에게도 주지 않는다.
create function private.app_record_overlap_guard()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_ref text;
  v_kind text;
  v_id uuid;
  v_ok boolean;
begin
  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id or new.a_ref <> old.a_ref or new.b_ref <> old.b_ref then
      raise exception using errcode = '22023', message = 'OVERLAP_PAIR_FIXED';
    end if;
    -- 사용자 판정은 ai·link가 덮어쓰지 못하고, link 판정은 ai가 덮어쓰지 못한다. 오류 없이 그대로 둔다(0행 처리).
    if old.decided_by = 'user' and new.decided_by <> 'user' then
      return null;
    end if;
    if old.decided_by = 'link' and new.decided_by = 'ai' then
      return null;
    end if;
    new.id := old.id;
    new.created_at := old.created_at;
    new.updated_at := pg_catalog.now();
  else
    if new.a_ref !~ '^(meeting|project_update|org_update|basket):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or new.b_ref !~ '^(meeting|project_update|org_update|basket):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '23514', message = 'OVERLAP_BAD_REF';
    end if;
    -- 두 기록이 이 작업공간에 실제로 있어야 한다(소유자 RLS로 읽음. 남의 작업공간 기록은 안 보이므로 없는 것으로 거절).
    foreach v_ref in array array[new.a_ref, new.b_ref] loop
      v_kind := pg_catalog.split_part(v_ref, ':', 1);
      v_id := pg_catalog.split_part(v_ref, ':', 2)::uuid;
      if v_kind = 'meeting' then
        select exists (select 1 from public.app_meetings m where m.id = v_id and m.workspace_id = new.workspace_id) into v_ok;
      elsif v_kind = 'basket' then
        select exists (select 1 from public.app_notes n where n.id = v_id and n.workspace_id = new.workspace_id and n.kind = 'basket') into v_ok;
      elsif v_kind = 'project_update' then
        select exists (select 1 from public.app_project_progress_updates p
          join public.app_spaces s on s.id = p.project_id
          where p.id = v_id and s.workspace_id = new.workspace_id) into v_ok;
      else
        select exists (select 1 from public.app_suborganization_updates u
          join public.app_suborganizations o on o.id = u.organization_id
          where u.id = v_id and o.workspace_id = new.workspace_id) into v_ok;
      end if;
      if not v_ok then
        raise exception using errcode = '22023', message = 'OVERLAP_REF_NOT_FOUND';
      end if;
    end loop;
  end if;
  -- link 판정: 바구니 메모와 사업 보고를 잇는 연결 줄이 실제로 있는 쌍만.
  if new.decided_by = 'link' then
    select exists (select 1 from public.app_record_links l
      where l.workspace_id = new.workspace_id and l.note_id is not null and l.meeting_id is not null
        and ((new.a_ref = 'basket:' || l.note_id::text and new.b_ref = 'meeting:' || l.meeting_id::text)
          or (new.b_ref = 'basket:' || l.note_id::text and new.a_ref = 'meeting:' || l.meeting_id::text))) into v_ok;
    if not v_ok then
      raise exception using errcode = '22023', message = 'OVERLAP_LINK_NOT_FOUND';
    end if;
  end if;
  return new;
end
$$;
revoke all on function private.app_record_overlap_guard() from public, anon, authenticated, service_role;

create trigger app_record_overlaps_guard
  before insert or update on public.app_record_overlaps
  for each row execute function private.app_record_overlap_guard();

-- 4) 저장 함수: 판정 목록(1~20쌍)을 한 번에, 전부 아니면 전무. 항목 = {a_ref, b_ref, verdict, decided_by, keep_ref?, reason?, a_hash?, b_hash?, model?}.
--    쌍 순서는 여기서 맞춘다(뒤집으면 지문도 같이). 나머지 모양은 표 검사가 거절한다. 돌려주는 값: {saved, kept_user}
--    (kept_user = 이미 사용자 판정이거나 연결 판정이라 덮어쓰지 않고 둔 개수).
create function public.app_record_overlap_set(p_workspace_id uuid, p_pairs jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_a text;
  v_b text;
  v_ah text;
  v_bh text;
  v_rows integer;
  v_saved integer := 0;
  v_kept integer := 0;
begin
  if p_workspace_id is null or not private.app_is_workspace_owner(p_workspace_id) then
    raise exception using errcode = '42501', message = 'OVERLAP_NOT_OWNER';
  end if;
  if p_pairs is null or pg_catalog.jsonb_typeof(p_pairs) <> 'array'
     or pg_catalog.jsonb_array_length(p_pairs) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'OVERLAP_BAD_PAIRS: count';
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_pairs) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or exists (select 1 from pg_catalog.jsonb_object_keys(v_item) k
         where k not in ('a_ref', 'b_ref', 'verdict', 'decided_by', 'keep_ref', 'reason', 'a_hash', 'b_hash', 'model'))
       or exists (select 1 from pg_catalog.jsonb_each(v_item) kv
         where pg_catalog.jsonb_typeof(kv.value) not in ('string', 'null'))
       or (v_item ->> 'a_ref') is null or (v_item ->> 'b_ref') is null then
      raise exception using errcode = '22023', message = 'OVERLAP_BAD_PAIRS: item';
    end if;
    v_a := v_item ->> 'a_ref';
    v_b := v_item ->> 'b_ref';
    v_ah := v_item ->> 'a_hash';
    v_bh := v_item ->> 'b_hash';
    if pg_catalog.convert_to(v_a, 'UTF8') > pg_catalog.convert_to(v_b, 'UTF8') then
      v_a := v_item ->> 'b_ref';
      v_b := v_item ->> 'a_ref';
      v_ah := v_item ->> 'b_hash';
      v_bh := v_item ->> 'a_hash';
    end if;
    insert into public.app_record_overlaps as t
      (workspace_id, a_ref, b_ref, verdict, decided_by, keep_ref, reason, a_hash, b_hash, model)
    values (p_workspace_id, v_a, v_b, v_item ->> 'verdict', v_item ->> 'decided_by', v_item ->> 'keep_ref',
            v_item ->> 'reason', v_ah, v_bh, v_item ->> 'model')
    on conflict (workspace_id, a_ref, b_ref) do update
      set verdict = excluded.verdict, decided_by = excluded.decided_by, keep_ref = excluded.keep_ref,
          reason = excluded.reason, a_hash = excluded.a_hash, b_hash = excluded.b_hash, model = excluded.model,
          updated_at = pg_catalog.now()
      where not (t.decided_by = 'user' and excluded.decided_by <> 'user')
        and not (t.decided_by = 'link' and excluded.decided_by = 'ai');
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      v_saved := v_saved + 1;
    else
      v_kept := v_kept + 1;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('saved', v_saved, 'kept_user', v_kept);
end
$$;
revoke all on function public.app_record_overlap_set(uuid, jsonb) from public, anon, service_role;
grant execute on function public.app_record_overlap_set(uuid, jsonb) to authenticated;

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 지우기 권한 없음, 트리거 1개, 함수 실행권은 저장 함수의 authenticated뿐. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_record_overlaps'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_record_overlaps'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_record_overlaps'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('authenticated', 'public.app_record_overlaps', 'delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_record_overlaps'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_record_overlaps'::regclass) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_record_overlaps'::regclass and not tgisinternal) <> 1
     or has_function_privilege('anon', 'public.app_record_overlap_set(uuid,jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.app_record_overlap_set(uuid,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_record_overlap_set(uuid,jsonb)', 'execute')
     or has_function_privilege('anon', 'private.app_record_overlap_guard()', 'execute')
     or has_function_privilege('authenticated', 'private.app_record_overlap_guard()', 'execute')
     or has_function_privilege('service_role', 'private.app_record_overlap_guard()', 'execute') then
    raise exception 'RECORD_OVERLAP_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261025190000', 'record_overlap_db', array['MTG-기록겹침거르기 1단계: app_record_overlaps (pair verdict same/different/unsure by ai/user/link), owner RLS, no delete, no anon/service_role, guard trigger (refs exist in workspace, user verdict protected, link proof), app_record_overlap_set(uuid,jsonb) invoker']);
commit;
