begin;
-- ORG-쟁의단계 다듬기 DB (docs/design/org-dispute-stage.md 4·6·11절, 명진 결정 2026-10-24 11:05~11:08). 앱 화면 코드 변경 없음.
-- 앞선 migration 20261024100000_org_dispute_stage_db(운영 적용 완료)의 이력 표 하나만 다룬다.
--
-- 무엇:
--   1) 이력 표 app_suborganization_dispute_stages에 선택 칸 end_date(date, 비우면 하루짜리 단계)와
--      검사 app_suborganization_dispute_stages_end_date_check(끝 날짜가 있으면 시작 날짜와 같거나 뒤) 하나를 더한다. 기존 줄은 모두 end_date 비어 있음.
--   2) 이력 한 줄 고치기: 지금까지 이력은 고치기 권한이 없었다(잘못 넣으면 지우기만). 명진 결정으로 단계·날짜·끝 날짜를 고칠 수 있게
--      authenticated에 네 칸(stage_id, stage_name, stage_date, end_date)의 고치기 열 권한과 새 칸 end_date의 넣기 열 권한만 준다.
--      조직(organization_id)·입력자(created_by)·입력 시각(created_at)·id는 고칠 수 없다(권한 없음).
--      누가 고칠 수 있나는 기존 소유자 정책(dispute_stage_history_owner_all, for all to authenticated, 소유자만)이 그대로 정한다 — 정책 변경 없음.
--   3) 좁히기 전용(restrictive) 정책 하나 dispute_stage_history_stage_ws_update: 고친 결과도 넣을 때와 같은 검사
--      (단계는 그 조직과 같은 업무공간의 단계, stage_id 비움 불가, 이름 사본은 그 단계의 지금 이름)를 통과해야 한다.
--   지우기: 이미 authenticated 지우기 권한 + 소유자 정책이 있다(변경 없음). 지운 뒤 현재 단계는 남은 이력의 최신 줄로 다시 읽힌다(저장 칸 없음).
-- 권한: anon·PUBLIC·service_role 권한 없음. 기존 정책·함수·트리거·다른 표 변경 없음. 권한이 넓어지는 쪽은 "소유자가 자기 이력 줄을 고칠 수 있음" 하나다.
-- 적용 경로: 승인형 DB workflow 확장 규칙은 기존 표에 권한을 더하는 줄(grant-existing)을 거절한다(앞선 20261024001000_weekly_draft와 같은 경우).
--   그래서 이 파일은 SQL Editor(폰 경로 C)로 원문 그대로 적용한다. 짝 파일 5개(precheck·snapshot·postcheck·rollback·summary)는 그 경로의 사전·사후 확인용이다.
-- 되돌리기(짝 rollback, SQL Editor): 끝 날짜가 든 줄이 있으면 멈춘다. 고친 줄은 고친 값 그대로 남는다(되돌리기는 칸·권한·정책만 지운다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024170000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024100000' and name = 'org_dispute_stage_db') <> 1
     or to_regclass('public.app_suborganization_dispute_stages') is null
     or to_regclass('public.app_dispute_stages') is null
     or exists (select 1 from pg_attribute where attrelid = 'public.app_suborganization_dispute_stages'::regclass and attname = 'end_date' and not attisdropped)
     or exists (select 1 from pg_constraint where conrelid = 'public.app_suborganization_dispute_stages'::regclass and conname = 'app_suborganization_dispute_stages_end_date_check')
     -- 이력 표: RLS 켜짐, anon·PUBLIC·service_role 권한 없음, 정책 정확히 둘(소유자 for all + 넣기 좁히기), 고치기 권한 아직 없음.
     or exists (select 1 from pg_class where oid = 'public.app_suborganization_dispute_stages'::regclass
         and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon|service_role)?='))
     or (select count(*) from pg_policy where polrelid = 'public.app_suborganization_dispute_stages'::regclass) <> 2
     or (select count(*) from pg_policy where polrelid = 'public.app_suborganization_dispute_stages'::regclass and polname = 'dispute_stage_history_owner_all'
         and polpermissive and polcmd = '*' and polroles = array['authenticated'::regrole]::oid[]
         and regexp_replace(pg_get_expr(polqual, polrelid), '[\s()]', '', 'g') = 'private.app_is_owner_organizationorganization_id'
         and regexp_replace(pg_get_expr(polwithcheck, polrelid), '[\s()]', '', 'g') = 'private.app_is_owner_organizationorganization_id') <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_suborganization_dispute_stages'::regclass and polname = 'dispute_stage_history_stage_ws'
         and not polpermissive and polcmd = 'a' and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or has_any_column_privilege('authenticated', 'public.app_suborganization_dispute_stages', 'update')
     or has_any_column_privilege('anon', 'public.app_suborganization_dispute_stages', 'select,insert,update,references') then
    raise exception 'ORG_DISPUTE_STAGE_PERIOD_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 끝 날짜 칸과 검사.
alter table public.app_suborganization_dispute_stages
  add column end_date date,
  add constraint app_suborganization_dispute_stages_end_date_check check (end_date is null or end_date >= stage_date);

-- 2) 열 권한: 새 칸 넣기, 네 칸 고치기(authenticated만).
grant insert (end_date) on table public.app_suborganization_dispute_stages to authenticated;
grant update (stage_id, stage_name, stage_date, end_date) on table public.app_suborganization_dispute_stages to authenticated;

-- 3) 고친 결과 검사(좁히기 전용, 기존 소유자 정책과 함께 AND). 넣을 때 검사(dispute_stage_history_stage_ws)와 같은 조건.
create policy dispute_stage_history_stage_ws_update on public.app_suborganization_dispute_stages as restrictive
  for update to authenticated
  with check (stage_id is not null and exists (
    select 1 from public.app_dispute_stages s
      join public.app_suborganizations o on o.id = app_suborganization_dispute_stages.organization_id
     where s.id = app_suborganization_dispute_stages.stage_id
       and s.workspace_id = o.workspace_id
       and s.name = app_suborganization_dispute_stages.stage_name));

-- 마지막 확인: 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_attribute where attrelid = 'public.app_suborganization_dispute_stages'::regclass and attname = 'end_date'
        and atttypid = 'date'::regtype and not attnotnull and not attisdropped) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_suborganization_dispute_stages'::regclass and contype = 'c' and convalidated
           and conname = 'app_suborganization_dispute_stages_end_date_check') <> 1
     or exists (select 1 from public.app_suborganization_dispute_stages where end_date is not null)
     or not (select relrowsecurity from pg_class where oid = 'public.app_suborganization_dispute_stages'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_suborganization_dispute_stages'::regclass and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_suborganization_dispute_stages'::regclass and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_any_column_privilege('anon', 'public.app_suborganization_dispute_stages', 'select,insert,update,references')
     or (select count(*) from pg_policy where polrelid = 'public.app_suborganization_dispute_stages'::regclass) <> 3
     or exists (select 1 from pg_policy where polrelid = 'public.app_suborganization_dispute_stages'::regclass and polroles <> array['authenticated'::regrole]::oid[])
     or not (has_column_privilege('authenticated', 'public.app_suborganization_dispute_stages', 'end_date', 'insert')
         and has_column_privilege('authenticated', 'public.app_suborganization_dispute_stages', 'stage_id', 'update')
         and has_column_privilege('authenticated', 'public.app_suborganization_dispute_stages', 'stage_name', 'update')
         and has_column_privilege('authenticated', 'public.app_suborganization_dispute_stages', 'stage_date', 'update')
         and has_column_privilege('authenticated', 'public.app_suborganization_dispute_stages', 'end_date', 'update'))
     or has_column_privilege('authenticated', 'public.app_suborganization_dispute_stages', 'organization_id', 'update')
     or has_column_privilege('authenticated', 'public.app_suborganization_dispute_stages', 'created_by', 'update')
     or has_column_privilege('authenticated', 'public.app_suborganization_dispute_stages', 'created_at', 'update')
     or has_column_privilege('authenticated', 'public.app_suborganization_dispute_stages', 'id', 'update') then
    raise exception 'ORG_DISPUTE_STAGE_PERIOD_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024170000', 'org_dispute_stage_period', array['ORG-쟁의단계 다듬기 DB: app_suborganization_dispute_stages.end_date date + CHECK (end_date >= stage_date); column grants insert(end_date), update(stage_id, stage_name, stage_date, end_date) to authenticated; restrictive update policy (same workspace stage, name copy); existing owner RLS unchanged']);
commit;
