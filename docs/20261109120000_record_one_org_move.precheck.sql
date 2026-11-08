-- SELECT only. Run before dry-run/apply (승인형 DB workflow 또는 SQL Editor 폰 경로 C). 집계 숫자·해시·예/아니오만 낸다(행 값 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 'already moved'는 0. 개수·해시는 기록하고, 사후 확인에서
--   'status rows to move'·'weekly lines to move'(옮길 대상 − 건너뜀) = 실제 옮긴 수, 원래 표 개수·해시·옮기지 않은 조직 기록 수 = 그대로.
-- O-2(record_one_org)가 적용되지 않았으면 source_kind 칸이 없어 이 SQL이 오류로 끝난다 → workflow는 쓰기 전에 멈춘다.
-- expect: already moved = 0
-- expect: org records rows not moved = 기록
-- expect: status rows total = 기록
-- expect: status rows skip same original twice = 기록
-- expect: status rows skip other workspace = 기록
-- expect: status rows skip record already there = 기록
-- expect: status rows to move = 기록
-- expect: weekly lines total = 기록
-- expect: weekly lines in = 기록
-- expect: weekly lines skip original record kept = 기록
-- expect: weekly lines skip carried from last week = 기록
-- expect: weekly lines skip same line twice = 기록
-- expect: weekly lines skip other workspace = 기록
-- expect: weekly lines skip same as status row = 기록
-- expect: weekly lines skip record already there = 기록
-- expect: weekly lines to move = 기록
-- expect: status rows hash = 기록
-- expect: weekly lines hash = 기록
-- expect: org records text length limits = 기록
-- expect: recent migrations = 기록
with u as (select to_regclass('public.app_suborganization_updates') as p),
s_one as (
  select distinct on (r.organization_id, r.day, r.body) r.id, r.workspace_id, r.organization_id, r.day, r.body
  from public.app_org_status_rows r
  order by r.organization_id, r.day, r.body, r.created_at, r.id),
s_ws as (select s.* from s_one s join public.app_suborganizations o on o.id = s.organization_id and o.workspace_id = s.workspace_id),
s_new as (select s.* from s_ws s
  where not exists (select 1 from public.app_suborganization_updates x
                    where x.organization_id = s.organization_id and x.source_kind = 'status_row' and x.source_id = s.id)
    and not exists (select 1 from public.app_suborganization_updates x
                    where x.organization_id = s.organization_id
                      and (x.occurred_at at time zone 'Asia/Seoul')::date = s.day and btrim(x.raw_text) = s.body)),
w_in as (select w.* from public.app_weekly_org_lines w where w.state = 'in'),
w_orphan as (select w.* from w_in w
  where not exists (select 1 from public.app_suborganization_updates x where x.id = any (w.source_update_ids))
    and not exists (select 1 from public.app_org_status_rows r where r.id = any (w.source_status_ids))),
w_fresh as (select w.* from w_orphan w
  where not (w.origin = 'last_week' and exists (
    select 1 from public.app_weekly_org_lines e
    where e.organization_id = w.organization_id and e.week_start < w.week_start and e.state = 'in' and e.body = w.body))),
w_one as (
  select distinct on (w.organization_id, coalesce(w.day, w.week_start), w.body)
    w.id, w.workspace_id, w.organization_id, coalesce(w.day, w.week_start) as on_day, w.body
  from w_fresh w
  order by w.organization_id, coalesce(w.day, w.week_start), w.body, w.created_at, w.id),
w_ws as (select l.* from w_one l join public.app_suborganizations o on o.id = l.organization_id and o.workspace_id = l.workspace_id),
w_nostatus as (select l.* from w_ws l
  where not exists (select 1 from public.app_suborganization_updates x
                    where x.organization_id = l.organization_id and x.source_kind = 'weekly_line' and x.source_id = l.id)
    and not exists (select 1 from public.app_org_status_rows r
                    where r.organization_id = l.organization_id and r.day = l.on_day and r.body = l.body)),
w_new as (select l.* from w_nostatus l
  where not exists (select 1 from public.app_suborganization_updates x
                    where x.organization_id = l.organization_id
                      and (x.occurred_at at time zone 'Asia/Seoul')::date = l.on_day and btrim(x.raw_text) = l.body))
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261109120000') then '예' else '아니오' end as value
union all select 'previous migration record_one_org present',case when (select count(*) from supabase_migrations.schema_migrations where version='20261109100000' and name='record_one_org')=1 then '예' else '아니오' end
union all select 'old tables present with end_day',case when to_regclass('public.app_org_status_rows') is not null and to_regclass('public.app_weekly_org_lines') is not null
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_org_status_rows') and attname='end_day' and not attisdropped)
  and (select count(*) from supabase_migrations.schema_migrations where (version='20261104201500' and name='org_status_rows_end_day') or (version='20261104211500' and name='weekly_org_lines'))=2 then '예' else '아니오' end
union all select 'org records new columns unique index and guard',case when (select count(*) from pg_attribute,u where attrelid=u.p and attnum>0 and not attisdropped
    and ((attname='raw_text' and atttypid='text'::regtype) or (attname='created_by' and atttypid='uuid'::regtype and not attnotnull)
      or (attname='created_at' and atttypid='timestamptz'::regtype) or (attname='end_day' and atttypid='date'::regtype)
      or (attname='source_kind' and atttypid='text'::regtype) or (attname='source_id' and atttypid='uuid'::regtype)))=6
  and to_regclass('public.app_suborganization_updates_source_once') is not null
  and (select count(*) from pg_trigger,u where tgrelid=u.p and tgname='app_suborganization_updates_source_guard' and not tgisinternal and tgenabled='O')=1 then '예' else '아니오' end
union all select 'org records other required columns have defaults',case when not exists(select 1 from pg_attribute,u where attrelid=u.p and attnum>0 and not attisdropped
  and attnotnull and not atthasdef and attname not in ('organization_id','raw_text','occurred_at','created_at','end_day','source_kind','source_id','created_by')) then '예' else '아니오' end
union all select 'owner member table',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_workspace_members') and attnum>0 and not attisdropped
  and attname in ('workspace_id','user_id','role'))=3 then '예' else '아니오' end
union all select 'every moved workspace has one owner',case when not exists(select 1 from (select workspace_id from s_new union select workspace_id from w_new) z
  where (select count(*) from public.app_workspace_members wm where wm.workspace_id=z.workspace_id and wm.role='owner')<>1) then '예' else '아니오' end
union all select 'already moved',(select count(*) from public.app_suborganization_updates where source_kind in ('status_row','weekly_line'))::text
union all select 'org records rows not moved',(select count(*) from public.app_suborganization_updates where source_kind is null or source_kind not in ('status_row','weekly_line'))::text
union all select 'status rows total',(select count(*) from public.app_org_status_rows)::text
union all select 'status rows skip same original twice',((select count(*) from public.app_org_status_rows)-(select count(*) from s_one))::text
union all select 'status rows skip other workspace',((select count(*) from s_one)-(select count(*) from s_ws))::text
union all select 'status rows skip record already there',((select count(*) from s_ws)-(select count(*) from s_new))::text
union all select 'status rows to move',(select count(*) from s_new)::text
union all select 'weekly lines total',(select count(*) from public.app_weekly_org_lines)::text
union all select 'weekly lines in',(select count(*) from w_in)::text
union all select 'weekly lines skip original record kept',((select count(*) from w_in)-(select count(*) from w_orphan))::text
union all select 'weekly lines skip carried from last week',((select count(*) from w_orphan)-(select count(*) from w_fresh))::text
union all select 'weekly lines skip same line twice',((select count(*) from w_fresh)-(select count(*) from w_one))::text
union all select 'weekly lines skip other workspace',((select count(*) from w_one)-(select count(*) from w_ws))::text
union all select 'weekly lines skip same as status row',((select count(*) from w_ws)-(select count(*) from w_nostatus))::text
union all select 'weekly lines skip record already there',((select count(*) from w_nostatus)-(select count(*) from w_new))::text
union all select 'weekly lines to move',(select count(*) from w_new)::text
union all select 'status rows hash',md5(coalesce((select string_agg(r.id::text||':'||r.organization_id::text||':'||r.day::text||':'||coalesce(r.end_day::text,'')||':'||md5(r.body)||':'||r.updated_at::text,',' order by r.id) from public.app_org_status_rows r),''))
union all select 'weekly lines hash',md5(coalesce((select string_agg(w.id::text||':'||w.state||':'||coalesce(w.day::text,'')||':'||md5(w.body)||':'||w.updated_at::text,',' order by w.id) from public.app_weekly_org_lines w),''))
union all select 'org records text length limits',(select count(*) from pg_constraint c,u
  where c.conrelid=u.p and c.contype='c' and pg_get_constraintdef(c.oid) ~ '(length|char_length|octet_length)[ (]*raw_text')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
