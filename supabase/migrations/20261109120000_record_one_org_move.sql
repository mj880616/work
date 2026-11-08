begin;
-- S54-29 ORG-기록하나로 O-3 운영 데이터 변경(설계 docs/design/record-one.md 3-1·3-2·5절 O-3).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
-- 앞 단계: 20261109100000_record_one_org(O-2) 기록이 있어야 한다(없으면 멈춘다).
--
-- 무엇: 옛 조직 자료 두 곳을 조직 기록(app_suborganization_updates)으로 복사한다. 원래 자료는 지우거나 고치지 않는다.
--  1) 현황 표 줄(app_org_status_rows) → source_kind 'status_row', source_id = 원래 줄 id.
--  2) 주별 조직보고 줄(app_weekly_org_lines) 중 넣은 줄(state in)이고 원래 기록이 없는 줄 → source_kind 'weekly_line'.
--     '원래 기록이 없다' = source_update_ids의 기록이 하나도 남아 있지 않고, source_status_ids의 현황 표 줄도 하나도 남아 있지 않음
--     (손으로 쓴 줄, 원래 기록이 지워진 줄). 원래 기록이 남은 줄은 그 기록이 이미 조직 기록이므로 복사하지 않는다.
--  옮긴 줄의 값: occurred_at = 그날(주별 줄은 날이 없으면 그 주 월요일) 서울 12:00, end_day = 원래 끝 날, raw_text = 원래 글,
--   created_at = 원래 줄이 생긴 시각, created_by = 그 작업공간 주인(owner 회원 행). detail_text·doc은 비움.
-- 건너뛰기(복사하지 않음, 개수는 precheck에 기록):
--  - 같은 원래 줄이 이미 옮겨짐(source_kind·source_id가 같은 기록 있음, O-2 고유 색인) — 다시 돌려도 0건.
--  - 같은 조직·같은 서울 날짜·같은 글(앞뒤 공백 무시)의 기록이 이미 있음. 옮길 줄끼리 같으면 먼저 생긴 줄 하나만.
--  - 주별 줄이 현황 표 줄과 같은 조직·같은 날·같은 글이면 현황 표 쪽만(현황 표가 먼저 옮겨짐).
--  - 주별 줄 중 '지난주 가져오기'(origin last_week)로 생긴 줄인데 앞 주에 같은 조직·같은 글의 넣은 줄이 있음(옮긴 사본의 사본).
--  - 줄의 작업공간과 조직의 작업공간이 다름(남의 작업공간 자료를 섞지 않음; 원래 표의 검사 트리거로 생길 수 없지만 한 번 더 막음).
--  - 빈 글·길이 초과: 원래 표의 검사(1~200자, 앞뒤 공백·제어문자 없음)로 생길 수 없다. 조직 기록 쪽 길이 제한은 사전 확인에서 본다.
-- 보고용 표시(app_report_line_marks)로 옮기는 '고친 넣은 줄'은 이 파일에서 하지 않는다(PR 본문 '요청과 다른 점').
-- 권한·정책·표 모양은 바꾸지 않는다. 옮긴 종류는 O-2 검사 트리거가 로그인 사용자·서버 키의 넣기를 막으므로 이 SQL만 넣을 수 있다.
-- 되돌리기: docs/20261109120000_record_one_org_move.rollback.sql(옮긴 표시가 있는 줄만 지움, SQL Editor 경로).
-- 짝: docs/20261109120000_record_one_org_move.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_org_status_rows, public.app_weekly_org_lines in share mode;
lock table public.app_suborganization_updates in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109120000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261109100000' and name = 'record_one_org') <> 1
     or (select count(*) from supabase_migrations.schema_migrations
         where (version = '20261104201500' and name = 'org_status_rows_end_day')
            or (version = '20261104211500' and name = 'weekly_org_lines')) <> 2
     or to_regclass('public.app_org_status_rows') is null
     or to_regclass('public.app_weekly_org_lines') is null
     or to_regclass('public.app_workspace_members') is null
     or to_regclass('public.app_suborganization_updates_source_once') is null
     or (select count(*) from pg_attribute where attrelid = 'public.app_suborganization_updates'::regclass and attnum > 0 and not attisdropped
           and ((attname = 'raw_text' and atttypid = 'text'::regtype)
             or (attname = 'created_by' and atttypid = 'uuid'::regtype and not attnotnull)
             or (attname = 'created_at' and atttypid = 'timestamptz'::regtype)
             or (attname = 'end_day' and atttypid = 'date'::regtype)
             or (attname = 'source_kind' and atttypid = 'text'::regtype)
             or (attname = 'source_id' and atttypid = 'uuid'::regtype))) <> 6
     or exists (select 1 from pg_attribute where attrelid = 'public.app_suborganization_updates'::regclass and attnum > 0 and not attisdropped
           and attnotnull and not atthasdef
           and attname not in ('organization_id', 'raw_text', 'occurred_at', 'created_at', 'end_day', 'source_kind', 'source_id', 'created_by'))
     or (select count(*) from pg_attribute where attrelid = 'public.app_org_status_rows'::regclass and attnum > 0 and not attisdropped
           and attname in ('id', 'workspace_id', 'organization_id', 'day', 'end_day', 'body', 'created_at')) <> 7
     or (select count(*) from pg_attribute where attrelid = 'public.app_weekly_org_lines'::regclass and attnum > 0 and not attisdropped
           and attname in ('id', 'workspace_id', 'organization_id', 'week_start', 'day', 'end_day', 'body', 'state', 'origin',
                           'source_update_ids', 'source_status_ids', 'created_at')) <> 12
     or (select count(*) from pg_attribute where attrelid = 'public.app_workspace_members'::regclass and attnum > 0 and not attisdropped
           and attname in ('workspace_id', 'user_id', 'role')) <> 3
     or (select count(*) from pg_trigger where tgrelid = 'public.app_suborganization_updates'::regclass
           and tgname = 'app_suborganization_updates_source_guard' and not tgisinternal and tgenabled = 'O') <> 1 then
    raise exception 'RECORD_ONE_ORG_MOVE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 현황 표 줄 → 조직 기록(status_row).
insert into public.app_suborganization_updates
  (organization_id, raw_text, occurred_at, end_day, source_kind, source_id, created_by, created_at)
select s.organization_id, s.body, (s.day + time '12:00') at time zone 'Asia/Seoul', s.end_day, 'status_row', s.id,
  (select wm.user_id from public.app_workspace_members wm
   where wm.workspace_id = o.workspace_id and wm.role = 'owner' order by wm.user_id limit 1),
  s.created_at
from (
  select distinct on (r.organization_id, r.day, r.body) r.id, r.workspace_id, r.organization_id, r.day, r.end_day, r.body, r.created_at
  from public.app_org_status_rows r
  order by r.organization_id, r.day, r.body, r.created_at, r.id
) s
join public.app_suborganizations o on o.id = s.organization_id and o.workspace_id = s.workspace_id
where not exists (select 1 from public.app_suborganization_updates u
                  where u.organization_id = s.organization_id and u.source_kind = 'status_row' and u.source_id = s.id)
  and not exists (select 1 from public.app_suborganization_updates u
                  where u.organization_id = s.organization_id
                    and (u.occurred_at at time zone 'Asia/Seoul')::date = s.day and btrim(u.raw_text) = s.body);

-- 2) 원래 기록이 없는 넣은 주별 줄 → 조직 기록(weekly_line).
insert into public.app_suborganization_updates
  (organization_id, raw_text, occurred_at, end_day, source_kind, source_id, created_by, created_at)
select l.organization_id, l.body, (l.on_day + time '12:00') at time zone 'Asia/Seoul', l.end_day, 'weekly_line', l.id,
  (select wm.user_id from public.app_workspace_members wm
   where wm.workspace_id = o.workspace_id and wm.role = 'owner' order by wm.user_id limit 1),
  l.created_at
from (
  select distinct on (w.organization_id, coalesce(w.day, w.week_start), w.body)
    w.id, w.workspace_id, w.organization_id, coalesce(w.day, w.week_start) as on_day, w.end_day, w.body, w.created_at
  from public.app_weekly_org_lines w
  where w.state = 'in'
    and not exists (select 1 from public.app_suborganization_updates u where u.id = any (w.source_update_ids))
    and not exists (select 1 from public.app_org_status_rows r where r.id = any (w.source_status_ids))
    and not (w.origin = 'last_week' and exists (
      select 1 from public.app_weekly_org_lines e
      where e.organization_id = w.organization_id and e.week_start < w.week_start and e.state = 'in' and e.body = w.body))
  order by w.organization_id, coalesce(w.day, w.week_start), w.body, w.created_at, w.id
) l
join public.app_suborganizations o on o.id = l.organization_id and o.workspace_id = l.workspace_id
where not exists (select 1 from public.app_suborganization_updates u
                  where u.organization_id = l.organization_id and u.source_kind = 'weekly_line' and u.source_id = l.id)
  and not exists (select 1 from public.app_org_status_rows r
                  where r.organization_id = l.organization_id and r.day = l.on_day and r.body = l.body)
  and not exists (select 1 from public.app_suborganization_updates u
                  where u.organization_id = l.organization_id
                    and (u.occurred_at at time zone 'Asia/Seoul')::date = l.on_day and btrim(u.raw_text) = l.body);

-- 사후 확인: 옮긴 줄마다 원래 줄이 같은 조직에 있고 글이 같다. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from public.app_suborganization_updates u
             where u.source_kind = 'status_row' and not exists (
               select 1 from public.app_org_status_rows r
               where r.id = u.source_id and r.organization_id = u.organization_id and r.body = u.raw_text))
     or exists (select 1 from public.app_suborganization_updates u
             where u.source_kind = 'weekly_line' and not exists (
               select 1 from public.app_weekly_org_lines w
               where w.id = u.source_id and w.organization_id = u.organization_id and w.body = u.raw_text and w.state = 'in')) then
    raise exception 'RECORD_ONE_ORG_MOVE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261109120000', 'record_one_org_move', array['S54-29 ORG-기록하나로 O-3: copy app_org_status_rows and source-less in-state app_weekly_org_lines into app_suborganization_updates (source_kind status_row/weekly_line, idempotent, originals untouched)']);
commit;
