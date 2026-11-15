begin;
-- S54-29 BIZ-기록하나로 B-2 운영 데이터 변경(설계 docs/design/record-one.md 3-1·3-2·5절 B-2).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
-- 앞 단계: 20261109110000_record_one_biz(B-1) 기록이 있어야 한다(없으면 멈춘다). O-3(20261109120000)과는 서로 기대지 않는다.
--
-- 무엇: 옛 사업 진행 기록(app_project_progress_updates)을 사업 기록(app_business_records)으로 복사한다. 원래 자료는 지우거나 고치지 않는다.
--  옮긴 줄의 값: workspace_id = 그 사업(app_spaces)의 작업공간, space_id = project_id, day = effective_on(비었으면 서울 날짜의 created_at),
--   body = summary의 줄바꿈·제어문자를 빈칸 하나로 바꾸고 앞뒤 빈칸을 뗀 글, source_kind 'progress', source_id = 원래 줄 id,
--   created_at = 원래 줄이 생긴 시각(비었으면 옮긴 시각), created_by = 그 작업공간 주인(owner 회원 행). end_day는 비움.
--   status_label·next_step·doc(서식)은 옮기지 않는다(원래 줄에 그대로 남음).
-- 건너뛰기(복사하지 않음, 개수는 precheck에 기록):
--  - 같은 원래 줄이 이미 옮겨짐(source_kind·source_id가 같은 사업 기록 있음, B-1 고유 색인) — 다시 돌려도 0건.
--  - 사업을 찾을 수 없음(project_id에 맞는 app_spaces 행이 없거나 작업공간이 비었음).
--  - 날짜 없음(effective_on·created_at 모두 비었음).
--  - 빈 글(정리한 summary가 비었음), 길이 초과(정리한 summary가 300자 넘음 — 사업 기록 1~300자 검사).
--  - 같은 사업·같은 날·같은 글의 사업 기록이 이미 있음. 옮길 줄끼리 같으면 먼저 생긴 줄 하나만.
--  - 사업 하나에 하루 50줄 상한(B-1 검사 트리거)을 넘는 줄: 그날 이미 있는 줄 수 + 먼저 생긴 순서로 50줄까지만.
-- 권한·정책·표 모양은 바꾸지 않는다. progress 종류는 B-1 검사 트리거가 로그인 사용자·서버 키의 넣기를 막으므로 이 SQL만 넣을 수 있다.
-- 되돌리기: docs/20261109130000_record_one_biz_move.rollback.sql(옮긴 표시가 있는 줄만 지움, SQL Editor 경로).
-- 짝: docs/20261109130000_record_one_biz_move.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_project_progress_updates in share mode;
lock table public.app_business_records in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109130000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261109110000' and name = 'record_one_biz') <> 1
     or to_regclass('public.app_project_progress_updates') is null
     or to_regclass('public.app_business_records') is null
     or to_regclass('public.app_business_records_source_once') is null
     or to_regclass('public.app_workspace_members') is null
     or (select count(*) from pg_attribute where attrelid = 'public.app_project_progress_updates'::regclass and attnum > 0 and not attisdropped
           and ((attname = 'id' and atttypid = 'uuid'::regtype)
             or (attname = 'project_id' and atttypid = 'uuid'::regtype)
             or (attname = 'summary' and atttypid = 'text'::regtype)
             or (attname = 'effective_on' and atttypid = 'date'::regtype)
             or (attname = 'created_at' and atttypid = 'timestamptz'::regtype))) <> 5
     or (select count(*) from pg_attribute where attrelid = 'public.app_spaces'::regclass and attnum > 0 and not attisdropped
           and attname = 'workspace_id' and atttypid = 'uuid'::regtype) <> 1
     or (select count(*) from pg_attribute where attrelid = 'public.app_workspace_members'::regclass and attnum > 0 and not attisdropped
           and attname in ('workspace_id', 'user_id', 'role')) <> 3
     or (select count(*) from pg_trigger where tgrelid = 'public.app_business_records'::regclass
           and tgname = 'app_business_records_guard' and not tgisinternal and tgenabled = 'O') <> 1 then
    raise exception 'RECORD_ONE_BIZ_MOVE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 옛 사업 진행 기록 → 사업 기록(progress).
insert into public.app_business_records (workspace_id, space_id, day, body, source_kind, source_id, created_by, created_at)
select c.workspace_id, c.space_id, c.day, c.body, 'progress', c.id,
  (select wm.user_id from public.app_workspace_members wm
   where wm.workspace_id = c.workspace_id and wm.role = 'owner' order by wm.user_id limit 1),
  coalesce(c.created_at, now())
from (
  select d.id, d.workspace_id, d.space_id, d.day, d.body, d.created_at,
    row_number() over (partition by d.space_id, d.day order by d.created_at, d.id) as n
  from (
    select distinct on (e.space_id, e.day, e.body) e.id, e.workspace_id, e.space_id, e.day, e.body, e.created_at
    from (
      select p.id, s.workspace_id, p.project_id as space_id,
        coalesce(p.effective_on, (p.created_at at time zone 'Asia/Seoul')::date) as day,
        btrim(regexp_replace(coalesce(p.summary, ''), '[[:cntrl:]]+', ' ', 'g')) as body, p.created_at
      from public.app_project_progress_updates p
      join public.app_spaces s on s.id = p.project_id and s.workspace_id is not null
    ) e
    where e.day is not null and char_length(e.body) between 1 and 300
      and not exists (select 1 from public.app_business_records b
                      where b.workspace_id = e.workspace_id and b.source_kind = 'progress' and b.source_id = e.id)
    order by e.space_id, e.day, e.body, e.created_at, e.id
  ) d
  where not exists (select 1 from public.app_business_records b
                    where b.workspace_id = d.workspace_id and b.space_id = d.space_id and b.day = d.day and b.body = d.body)
) c
where c.n + (select count(*) from public.app_business_records b where b.space_id = c.space_id and b.day = c.day) <= 50;

-- 사후 확인: 옮긴 줄마다 원래 줄이 같은 사업에 있고 날짜가 맞으며, 작업공간이 그 사업의 작업공간이다. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from public.app_business_records b
             where b.source_kind = 'progress' and not exists (
               select 1 from public.app_project_progress_updates p
               join public.app_spaces s on s.id = p.project_id
               where p.id = b.source_id and p.project_id = b.space_id and s.workspace_id = b.workspace_id
                 and coalesce(p.effective_on, (p.created_at at time zone 'Asia/Seoul')::date) = b.day)) then
    raise exception 'RECORD_ONE_BIZ_MOVE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261109130000', 'record_one_biz_move', array['S54-29 BIZ-기록하나로 B-2: copy app_project_progress_updates into app_business_records (source_kind progress, idempotent, originals untouched, 1-300 chars, 50 per business per day)']);
commit;
