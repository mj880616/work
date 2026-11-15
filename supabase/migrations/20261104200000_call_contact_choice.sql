begin;
-- CALL-업무기본 DB: 통화 상대별로 명진이 한 번 고른 구분(업무/개인)을 기억해 다음부터 '확인할 통화'로 묻지 않게 한다. docs/design/call-personal.md 14절.
-- 앞 단계 20261025200000(개인 통화함 표·옮기기 함수) 위에서만 적용한다. 앱·Edge·화면 변경은 이 migration에 없다(Edge collector-feed는 이 DB 적용 뒤에 배포).
--
-- 무엇:
--   1) 새 표 public.app_call_contact_choice(workspace_id, contact_key, choice 'work'|'personal'): 상대 한 사람당 한 줄. contact_key는 작업공간별 SHA-256 열쇠(64자리 16진수)이고
--      번호·이름 원문은 어디에도 저장하지 않는다. 소유자 전용 RLS, authenticated는 읽기만, service_role은 세 칸 읽기만(서버가 '애매' 통화를 다시 가를 때 본다). 쓰기는 아래 함수만.
--   2) 새 표 public.app_call_contact_ref(workspace_id, source_ref, contact_key): 통화 한 건(원본 고유키)이 어느 상대 열쇠인지. 통화 두 표는 한 칸도 바꾸지 않는다(옮겨도 source_ref가 그대로라 따라간다).
--      소유자 전용 RLS, authenticated는 읽기만, service_role은 넣기만(서버가 통화를 저장한 직후 한 줄 더함). 읽기·고치기·지우기 없음.
--   3) public.app_call_move(uuid,text)를 같은 모양·같은 권한으로 바꿔 쓴다: 옮길 때 그 통화의 열쇠를 위 표에서 찾아, 있으면 고른 구분(옮겨 간 쪽)을 app_call_contact_choice에 남긴다.
--      (애매→업무/개인, 업무↔개인 어느 쪽이든 명진이 누른 선택이 그 상대의 다음 구분이 된다. 같은 함으로 옮기면 아무것도 안 한다.)
-- 안 하는 것: 기존 표(app_feed_items·app_call_personal)에 칸·권한·정책·CHECK 변경, 기존 트리거·트리거 함수 본문 교체, app_call_work_info 변경, anon·PUBLIC 권한, RLS 약화, 기존 줄 변경(열쇠는 새로 들어오는 통화부터), rtw_* 객체.
-- 개인 번호 목록은 보내기 스크립트의 속성(저장소 밖)이라 이 표와 합치지 않는다: 그 목록 통화는 이전처럼 스크립트가 개인으로 고쳐 보낸다.
-- 짝: docs/20261104200000_call_contact_choice.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_call_personal in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104200000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261025200000' and name = 'call_personal_box') <> 1
     or to_regclass('public.app_call_contact_choice') is not null
     or to_regclass('public.app_call_personal') is null
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_call_contact_ref') is not null
     -- 바꿔 쓸 함수는 앞 단계 본문 그대로여야 한다(이미 열쇠를 다루면 멈춘다).
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_call_move(uuid,text)') and prosecdef
         and proconfig = array['search_path=""'] and prosrc like '%CALL_MOVE_TARGET%' and prosrc not like '%contact_key%') <> 1
     or has_function_privilege('anon', to_regprocedure('public.app_call_move(uuid,text)'), 'execute')
     or has_function_privilege('service_role', to_regprocedure('public.app_call_move(uuid,text)'), 'execute')
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or (select count(*) from pg_class where oid = to_regclass('public.app_call_personal') and relrowsecurity and not relforcerowsecurity) <> 1
     or (select count(*) from pg_class c join pg_roles r on r.rolname = current_user and (r.rolbypassrls or r.oid = c.relowner)
         where c.oid in (to_regclass('public.app_feed_items'), to_regclass('public.app_call_personal'))) <> 2 then
    raise exception 'CALL_CONTACT_CHOICE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 상대별 선택 표. 열쇠는 서버가 만든다(번호·이름 원문 없음). 쓰기 권한은 아무에게도 없고 app_call_move만 쓴다.
create table public.app_call_contact_choice (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  contact_key text not null,
  choice text not null,
  updated_at timestamptz not null default now(),
  constraint app_call_contact_choice_pkey primary key (workspace_id, contact_key),
  constraint app_call_contact_choice_key_check check (contact_key ~ '^[0-9a-f]{64}$'),
  constraint app_call_contact_choice_choice_check check (choice in ('work', 'personal'))
);
alter table public.app_call_contact_choice enable row level security;
revoke all on table public.app_call_contact_choice from public, anon, authenticated, service_role;
create policy app_call_contact_choice_owner_select on public.app_call_contact_choice
  for select to authenticated using (private.app_is_workspace_owner(workspace_id));
grant select on table public.app_call_contact_choice to authenticated;
grant select (workspace_id, contact_key, choice) on table public.app_call_contact_choice to service_role;

-- 2) 통화 한 건의 상대 열쇠. 서버가 통화를 저장한 직후 한 줄 넣는다(저장 실패해도 통화는 이미 저장됨: 그 통화만 선택 기억에서 빠진다).
create table public.app_call_contact_ref (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source_ref text not null,
  contact_key text not null,
  constraint app_call_contact_ref_pkey primary key (workspace_id, source_ref),
  constraint app_call_contact_ref_source_ref_check check (source_ref ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  constraint app_call_contact_ref_key_check check (contact_key ~ '^[0-9a-f]{64}$')
);
alter table public.app_call_contact_ref enable row level security;
revoke all on table public.app_call_contact_ref from public, anon, authenticated, service_role;
create policy app_call_contact_ref_owner_select on public.app_call_contact_ref
  for select to authenticated using (private.app_is_workspace_owner(workspace_id));
grant select on table public.app_call_contact_ref to authenticated;
grant insert (workspace_id, source_ref, contact_key) on table public.app_call_contact_ref to service_role;

-- 3) 옮기기 함수: 앞 단계 본문에 contact_key 옮기기와 선택 기억만 더한다. 소유자 확인·오류 이름·권한은 그대로.
create or replace function public.app_call_move(p_id uuid, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.app_feed_items%rowtype;
  p public.app_call_personal%rowtype;
  k text;
begin
  if p_to is null or p_to not in ('work', 'personal') then
    raise exception using errcode = '22023', message = 'CALL_MOVE_TARGET';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_call_move:' || coalesce(p_id::text, ''), 0));

  select * into w from public.app_feed_items f where f.id = p_id;
  if found then
    if not private.app_is_workspace_owner(w.workspace_id) then
      raise exception using errcode = 'P0002', message = 'CALL_NOT_FOUND';
    end if;
    if w.source <> 'call' then
      raise exception using errcode = '23514', message = 'CALL_NOT_CALL';
    end if;
    if p_to = 'work' then
      return pg_catalog.jsonb_build_object('ok', true, 'id', w.id, 'from', 'work', 'to', 'work', 'changed', false, 'needs_refill', false);
    end if;
    delete from public.app_feed_items f where f.id = w.id and f.workspace_id = w.workspace_id;
    insert into public.app_call_personal (id, workspace_id, kind, day, occurred_at, title, summary, points, counterpart, speaker_split,
      raw_text, source_ref, drive_url, hidden_at, model, judged_at, moved_at, created_at, updated_at)
    values (w.id, w.workspace_id, 'personal', w.day, w.occurred_at, w.title, w.summary, w.points, w.counterpart, w.speaker_split,
      w.raw_text, w.source_ref, w.drive_url, w.hidden_at, w.model, w.judged_at, pg_catalog.now(), w.created_at, pg_catalog.now());
    select r.contact_key into k from public.app_call_contact_ref r where r.workspace_id = w.workspace_id and r.source_ref = w.source_ref;
    if k is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_call_choice:' || w.workspace_id::text || k, 0));
      update public.app_call_contact_choice c set choice = 'personal', updated_at = pg_catalog.now() where c.workspace_id = w.workspace_id and c.contact_key = k;
      if not found then
        insert into public.app_call_contact_choice (workspace_id, contact_key, choice, updated_at) values (w.workspace_id, k, 'personal', pg_catalog.now());
      end if;
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'id', w.id, 'from', 'work', 'to', 'personal', 'changed', true, 'needs_refill', false);
  end if;

  select * into p from public.app_call_personal c where c.id = p_id;
  if not found or not private.app_is_workspace_owner(p.workspace_id) then
    raise exception using errcode = 'P0002', message = 'CALL_NOT_FOUND';
  end if;
  if p_to = 'personal' then
    if p.kind = 'personal' then
      return pg_catalog.jsonb_build_object('ok', true, 'id', p.id, 'from', 'personal', 'to', 'personal', 'changed', false, 'needs_refill', false);
    end if;
    update public.app_call_personal c set kind = 'personal', updated_at = pg_catalog.now()
     where c.id = p.id and c.workspace_id = p.workspace_id;
    select r.contact_key into k from public.app_call_contact_ref r where r.workspace_id = p.workspace_id and r.source_ref = p.source_ref;
    if k is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_call_choice:' || p.workspace_id::text || k, 0));
      update public.app_call_contact_choice c set choice = 'personal', updated_at = pg_catalog.now() where c.workspace_id = p.workspace_id and c.contact_key = k;
      if not found then
        insert into public.app_call_contact_choice (workspace_id, contact_key, choice, updated_at) values (p.workspace_id, k, 'personal', pg_catalog.now());
      end if;
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'id', p.id, 'from', 'unsure', 'to', 'personal', 'changed', true, 'needs_refill', false);
  end if;
  delete from public.app_call_personal c where c.id = p.id and c.workspace_id = p.workspace_id;
  insert into public.app_feed_items (id, workspace_id, source, day, occurred_at, title, summary, points, counterpart, speaker_split,
    raw_text, raw_count, source_ref, drive_url, hidden_at, model, judged_at, moved_at, refilled_at, created_at, updated_at)
  values (p.id, p.workspace_id, 'call', p.day, p.occurred_at, p.title, p.summary, p.points, p.counterpart, p.speaker_split,
    p.raw_text, 0, p.source_ref, p.drive_url, p.hidden_at, p.model, p.judged_at, pg_catalog.now(), null, p.created_at, pg_catalog.now());
  select r.contact_key into k from public.app_call_contact_ref r where r.workspace_id = p.workspace_id and r.source_ref = p.source_ref;
  if k is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_call_choice:' || p.workspace_id::text || k, 0));
    update public.app_call_contact_choice c set choice = 'work', updated_at = pg_catalog.now() where c.workspace_id = p.workspace_id and c.contact_key = k;
    if not found then
      insert into public.app_call_contact_choice (workspace_id, contact_key, choice, updated_at) values (p.workspace_id, k, 'work', pg_catalog.now());
    end if;
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'id', p.id, 'from', p.kind, 'to', 'work', 'changed', true, 'needs_refill', true);
end
$$;
revoke all on function public.app_call_move(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.app_call_move(uuid, text) to authenticated;

-- 마지막 확인: 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_proc where oid = to_regprocedure('public.app_call_move(uuid,text)') and prosecdef and proconfig = array['search_path=""']
         and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
         and not has_function_privilege('service_role', oid, 'execute') and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 1
     or not exists (select 1 from pg_class where oid = 'public.app_call_contact_choice'::regclass and relrowsecurity and not relforcerowsecurity)
     or (select count(*) from pg_policy where polrelid = 'public.app_call_contact_choice'::regclass and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_call_contact_choice'::regclass) <> 1
     or exists (select 1 from pg_class where oid in ('public.app_call_contact_choice'::regclass, 'public.app_call_contact_ref'::regclass, 'public.app_feed_items'::regclass, 'public.app_call_personal'::regclass)
                and coalesce(relacl::text, '') ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_call_contact_choice'::regclass, 'public.app_call_contact_ref'::regclass, 'public.app_feed_items'::regclass, 'public.app_call_personal'::regclass)
                and attacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_call_contact_choice', 'insert')
     or has_table_privilege('authenticated', 'public.app_call_contact_choice', 'update')
     or has_table_privilege('authenticated', 'public.app_call_contact_choice', 'delete')
     or has_table_privilege('service_role', 'public.app_call_contact_choice', 'insert')
     or has_any_column_privilege('service_role', 'public.app_call_contact_choice', 'update')
     or has_table_privilege('service_role', 'public.app_call_contact_choice', 'delete')
     or not has_column_privilege('service_role', 'public.app_call_contact_choice', 'choice', 'select')
     or has_column_privilege('service_role', 'public.app_call_contact_choice', 'updated_at', 'select')
     or not exists (select 1 from pg_class where oid = 'public.app_call_contact_ref'::regclass and relrowsecurity and not relforcerowsecurity)
     or (select count(*) from pg_policy where polrelid = 'public.app_call_contact_ref'::regclass) <> 1
     or has_table_privilege('authenticated', 'public.app_call_contact_ref', 'insert')
     or has_table_privilege('authenticated', 'public.app_call_contact_ref', 'update')
     or has_table_privilege('authenticated', 'public.app_call_contact_ref', 'delete')
     or has_any_column_privilege('service_role', 'public.app_call_contact_ref', 'select')
     or has_any_column_privilege('service_role', 'public.app_call_contact_ref', 'update')
     or has_table_privilege('service_role', 'public.app_call_contact_ref', 'delete')
     or not has_column_privilege('service_role', 'public.app_call_contact_ref', 'contact_key', 'insert')
     or has_any_column_privilege('service_role', 'public.app_feed_items', 'update')
     or has_any_column_privilege('service_role', 'public.app_call_personal', 'update') then
    raise exception 'CALL_CONTACT_CHOICE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261104200000', 'call_contact_choice', array['CALL-업무기본 DB: new tables app_call_contact_choice (per-counterpart work/personal choice keyed by workspace-salted SHA-256, owner RLS select only, service_role select three columns) and app_call_contact_ref (call source_ref to contact key, owner RLS select only, service_role insert only), no change to app_feed_items/app_call_personal, app_call_move replaced in place (looks up the contact key, records the chosen box; same owner check, SECURITY DEFINER, empty search_path, execute to authenticated only), no anon/PUBLIC, no change to existing policies, grants or trigger bodies']);
commit;
