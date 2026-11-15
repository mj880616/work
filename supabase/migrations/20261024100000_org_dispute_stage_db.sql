begin;
-- ORG-쟁의단계 DB (docs/design/org-dispute-stage.md 2·4·6절, 명진 결정 2026-10-23 23:06 ~ 2026-10-24 07:25). 앱 화면 코드 변경 없음.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(또는 폰 경로 C)으로만 한다. 이 브랜치는 운영 적용 직전 정지.
--
-- 무엇:
--   1) 새 표 app_dispute_stages(쟁의 단계 목록). 업무공간 소유자만 읽고 쓴다(private.app_is_workspace_owner, 기존 소유자 정책과 같은 모양).
--      이름 1~20자(같은 업무공간 안에서 중복 불가), 순서, '투쟁 중으로 봄'(is_struggle), '끝남'(is_ending), 기본 단계 표시(is_default).
--      한 단계에 두 표시를 동시에 켤 수 없다(check). 기본 단계는 업무공간마다 하나뿐(부분 unique 색인)이고 두 표시를 켤 수 없다.
--      기본 단계 표시는 넣을 때만 정하고 고칠 수 없다(고치기 열 권한 없음). 기본 단계는 지울 수 없다(좁히기 전용 정책).
--      기본 9단계는 migration이 넣지 않는다. 설계 6절대로 소유자가 처음 열 때 앱이 소유자 권한으로 채운다(운영 데이터 변경 없음, 빈 표 생성).
--   2) 새 표 app_suborganization_dispute_stages(조직별 단계 이력, 현재 단계의 유일한 원본). 담당조직이 지워지면 이력도 함께 지워진다.
--      단계 id(stage_id)와 저장 당시 이름 사본(stage_name)을 같이 둔다. 단계가 지워지면 id만 비고 이름 사본은 남는다.
--      소유자만(private.app_is_owner_organization, 기존 조직 딸린 표와 같은 모양). 넣을 때 단계가 그 조직과 같은 업무공간의 단계이고
--      이름 사본이 그 단계의 지금 이름과 같은지 좁히기 전용(restrictive) 정책이 서버에서 검사한다. 이력은 고치지 못하고(고치기 권한 없음) 줄 하나씩 지울 수만 있다.
--   3) 저장 함수 1개 app_dispute_stage_delete(INVOKER·search_path 고정·authenticated만 실행): 단계 지우기를 한 번에 처리한다.
--      기본 단계면 거절, 지금 그 단계에 있는 조직이 있고 확인 없으면 거절(조직 id 목록을 돌려줌), 확인했으면 그 조직들을 기본 단계로 옮기고(이력 한 줄 추가)
--      같은 트랜잭션에서 단계를 지운다. 함수를 거치지 않은 직접 지우기도 지금 그 단계에 있는 조직이 있으면 같은 좁히기 정책이 거절한다.
-- 권한: 기존 표·정책·함수·트리거 변경 없음. 새 표 권한은 authenticated만. anon·PUBLIC 권한과 정책 대상 없음(모든 정책 to authenticated).
-- 되돌리기(짝 rollback, SQL Editor 경로 전용): 단계 또는 이력 줄이 하나라도 있으면 멈춘다(preserve SQL로 먼저 보관).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024100000')
     or to_regclass('public.app_suborganizations') is null
     or to_regclass('public.app_workspaces') is null
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null
     or to_regprocedure('private.app_is_owner_organization(uuid)') is null
     or to_regclass('public.app_dispute_stages') is not null
     or to_regclass('public.app_suborganization_dispute_stages') is not null
     or to_regprocedure('public.app_dispute_stage_delete(uuid,boolean)') is not null
     -- 조직 표: RLS 켜짐, anon·PUBLIC 표 권한 없음, 소유자 정책 그대로(새 표가 같은 모양을 따른다).
     or exists (select 1 from pg_class where oid = 'public.app_suborganizations'::regclass
         and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or (select count(*) from pg_policy where polrelid = 'public.app_suborganizations'::regclass and polname = 'task12a_owner_all'
         and polpermissive and polcmd = '*' and polroles = array['authenticated'::regrole]::oid[]
         and regexp_replace(pg_get_expr(polqual, polrelid), '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') <> 1 then
    raise exception 'ORG_DISPUTE_STAGE_DB_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 단계 목록 표.
create table public.app_dispute_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_struggle boolean not null default false,
  is_ending boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_dispute_stages_name_check check (char_length(btrim(name)) between 1 and 20),
  constraint app_dispute_stages_name_unique unique (workspace_id, name),
  constraint app_dispute_stages_flags_check check (not (is_struggle and is_ending)),
  constraint app_dispute_stages_default_check check (not is_default or (not is_struggle and not is_ending))
);
create unique index app_dispute_stages_one_default on public.app_dispute_stages(workspace_id) where is_default;
alter table public.app_dispute_stages enable row level security;
revoke all on table public.app_dispute_stages from public, anon, authenticated, service_role;
grant select, delete on table public.app_dispute_stages to authenticated;
grant insert (workspace_id, name, sort_order, is_struggle, is_ending, is_default) on table public.app_dispute_stages to authenticated;
grant update (name, sort_order, is_struggle, is_ending, updated_at) on table public.app_dispute_stages to authenticated;
create policy dispute_stages_owner_all on public.app_dispute_stages for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 2) 조직별 단계 이력 표.
create table public.app_suborganization_dispute_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.app_suborganizations(id) on delete cascade,
  stage_id uuid references public.app_dispute_stages(id) on delete set null,
  stage_name text not null,
  stage_date date not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint app_suborganization_dispute_stages_name_check check (char_length(btrim(stage_name)) between 1 and 20)
);
create index app_suborganization_dispute_stages_current_idx
  on public.app_suborganization_dispute_stages(organization_id, stage_date desc, created_at desc);
create index app_suborganization_dispute_stages_stage_idx
  on public.app_suborganization_dispute_stages(stage_id) where stage_id is not null;
alter table public.app_suborganization_dispute_stages enable row level security;
revoke all on table public.app_suborganization_dispute_stages from public, anon, authenticated, service_role;
grant select, delete on table public.app_suborganization_dispute_stages to authenticated;
grant insert (organization_id, stage_id, stage_name, stage_date) on table public.app_suborganization_dispute_stages to authenticated;
create policy dispute_stage_history_owner_all on public.app_suborganization_dispute_stages for all to authenticated
  using (private.app_is_owner_organization(organization_id))
  with check (private.app_is_owner_organization(organization_id));

-- 넣을 때 검사(좁히기 전용, 기존 소유자 정책과 함께 AND). 단계는 그 조직과 같은 업무공간의 단계여야 하고 이름 사본은 그 단계의 지금 이름이어야 한다.
create policy dispute_stage_history_stage_ws on public.app_suborganization_dispute_stages as restrictive
  for insert to authenticated
  with check (stage_id is not null and exists (
    select 1 from public.app_dispute_stages s
      join public.app_suborganizations o on o.id = app_suborganization_dispute_stages.organization_id
     where s.id = app_suborganization_dispute_stages.stage_id
       and s.workspace_id = o.workspace_id
       and s.name = app_suborganization_dispute_stages.stage_name));

-- 단계 지우기 좁히기 전용 정책: 기본 단계는 지울 수 없고, 지금 어느 조직이 그 단계에 있으면 지울 수 없다(조직 옮기기는 아래 함수가 먼저 한다).
-- 현재 단계 = 조직의 이력 중 단계 날짜 → 입력 시각 → id 순으로 가장 나중 줄.
create policy dispute_stages_keep_default_and_used on public.app_dispute_stages as restrictive
  for delete to authenticated
  using (not is_default and not exists (
    select 1 from public.app_suborganization_dispute_stages h
     where h.stage_id = app_dispute_stages.id
       and h.id = (select h2.id from public.app_suborganization_dispute_stages h2
                    where h2.organization_id = h.organization_id
                    order by h2.stage_date desc, h2.created_at desc, h2.id desc limit 1)));

-- 3) 단계 지우기 함수. 반환: {ok:true,moved:n} 또는 {ok:false,error:...}.
create function public.app_dispute_stage_delete(p_stage_id uuid, p_move_organizations boolean default false)
returns jsonb
language plpgsql security invoker set search_path = ''
as $stage$
declare
  v_stage public.app_dispute_stages%rowtype;
  v_default public.app_dispute_stages%rowtype;
  v_orgs uuid[];
  v_moved integer := 0;
  v_today date := (pg_catalog.now() at time zone 'Asia/Seoul')::date;
begin
  if p_stage_id is null then
    return pg_catalog.jsonb_build_object('ok',false,'error','INVALID_INPUT','moved',0);
  end if;
  -- INVOKER: a stage the caller cannot see is reported as missing. The row lock also blocks new history rows for this stage until we finish.
  select s.* into v_stage from public.app_dispute_stages s where s.id = p_stage_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok',false,'error','STAGE_MISSING','moved',0);
  end if;
  if v_stage.is_default then
    return pg_catalog.jsonb_build_object('ok',false,'error','DEFAULT_STAGE','moved',0);
  end if;
  select coalesce(pg_catalog.array_agg(c.organization_id order by c.organization_id), '{}'::uuid[]) into v_orgs
    from (select distinct on (h.organization_id) h.organization_id, h.stage_id
            from public.app_suborganization_dispute_stages h
           order by h.organization_id, h.stage_date desc, h.created_at desc, h.id desc) c
   where c.stage_id = p_stage_id;
  if pg_catalog.cardinality(v_orgs) > 0 then
    if p_move_organizations is not true then
      return pg_catalog.jsonb_build_object('ok',false,'error','ORGS_AT_STAGE','moved',0,
        'count',pg_catalog.cardinality(v_orgs),'organization_ids',pg_catalog.to_jsonb(v_orgs));
    end if;
    select d.* into v_default from public.app_dispute_stages d
     where d.workspace_id = v_stage.workspace_id and d.is_default;
    if not found then
      return pg_catalog.jsonb_build_object('ok',false,'error','NO_DEFAULT_STAGE','moved',0);
    end if;
    -- 옮긴 줄의 날짜는 오늘(한국 날짜) 또는 그 조직의 지금 줄 날짜 중 나중 것(미래 날짜 줄 뒤에 오게).
    insert into public.app_suborganization_dispute_stages(organization_id, stage_id, stage_name, stage_date)
    select c.organization_id, v_default.id, v_default.name, greatest(v_today, c.stage_date)
      from (select distinct on (h.organization_id) h.organization_id, h.stage_id, h.stage_date
              from public.app_suborganization_dispute_stages h
             order by h.organization_id, h.stage_date desc, h.created_at desc, h.id desc) c
     where c.stage_id = p_stage_id;
    get diagnostics v_moved = row_count;
  end if;
  delete from public.app_dispute_stages where id = p_stage_id;
  if not found then
    raise exception 'DISPUTE_STAGE_DELETE_REFUSED';
  end if;
  return pg_catalog.jsonb_build_object('ok',true,'moved',v_moved);
end
$stage$;
revoke all on function public.app_dispute_stage_delete(uuid,boolean) from public, anon;
grant execute on function public.app_dispute_stage_delete(uuid,boolean) to authenticated;

-- 마지막 확인: 어긋나면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_dispute_stages'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.app_suborganization_dispute_stages'::regclass)
     or (select count(*) from pg_policy where polrelid = 'public.app_dispute_stages'::regclass) <> 2
     or (select count(*) from pg_policy where polrelid = 'public.app_suborganization_dispute_stages'::regclass) <> 2
     or has_table_privilege('anon', 'public.app_dispute_stages', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.app_suborganization_dispute_stages', 'select,insert,update,delete')
     or has_function_privilege('anon', 'public.app_dispute_stage_delete(uuid,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_dispute_stage_delete(uuid,boolean)', 'execute') then
    raise exception 'ORG_DISPUTE_STAGE_DB_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024100000', 'org_dispute_stage_db', array['ORG-쟁의단계 DB: app_dispute_stages (owner RLS, 두 표시 동시 켜기 거절, 기본 단계 하나·삭제 거절) + app_suborganization_dispute_stages (이력, 단계 id와 이름 사본, 넣을 때 같은 업무공간 검사) + app_dispute_stage_delete (INVOKER, 지울 때 조직을 기본 단계로 이동)']);
commit;
