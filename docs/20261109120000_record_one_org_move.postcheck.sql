-- SELECT only. 적용 뒤(승인형 DB workflow 사후 확인 또는 SQL Editor). 집계 숫자·해시·예/아니오만 낸다(행 값 없음).
-- 예/아니오는 모두 예. 'status rows to move'·'weekly lines to move'는 실제로 옮긴 줄 수이고 사전 확인의 같은 이름 값(옮길 대상 − 건너뜀)과 같아야 한다.
-- 원래 표 개수·해시와 옮기지 않은 조직 기록 수는 사전 값과 같아야 한다(원래 자료 그대로). 다시 돌리면 옮길 줄 0건.
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
select 'migration recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261109120000' and name='record_one_org_move')=1 then '예' else '아니오' end as value
union all select 'status rows to move',(select count(*) from public.app_suborganization_updates where source_kind='status_row')::text
union all select 'weekly lines to move',(select count(*) from public.app_suborganization_updates where source_kind='weekly_line')::text
union all select 'nothing left to move',case when (select count(*) from s_new)=0 and (select count(*) from w_new)=0 then '예' else '아니오' end
union all select 'moved rows match their original',case when not exists(select 1 from public.app_suborganization_updates x where x.source_kind='status_row'
    and not exists(select 1 from public.app_org_status_rows r where r.id=x.source_id and r.organization_id=x.organization_id and r.body=x.raw_text
      and (x.occurred_at at time zone 'Asia/Seoul')::date=r.day and x.end_day is not distinct from r.end_day and x.created_at=r.created_at))
  and not exists(select 1 from public.app_suborganization_updates x where x.source_kind='weekly_line'
    and not exists(select 1 from public.app_weekly_org_lines w where w.id=x.source_id and w.organization_id=x.organization_id and w.body=x.raw_text and w.state='in'
      and (x.occurred_at at time zone 'Asia/Seoul')::date=coalesce(w.day,w.week_start) and x.end_day is not distinct from w.end_day and x.created_at=w.created_at)) then '예' else '아니오' end
union all select 'moved rows stay in their workspace',case when not exists(select 1 from public.app_suborganization_updates x
    join public.app_suborganizations o on o.id=x.organization_id
    where x.source_kind in ('status_row','weekly_line')
      and (not exists(select 1 from public.app_org_status_rows r where r.id=x.source_id and r.workspace_id=o.workspace_id)
       and not exists(select 1 from public.app_weekly_org_lines w where w.id=x.source_id and w.workspace_id=o.workspace_id)
       or x.created_by is distinct from (select wm.user_id from public.app_workspace_members wm where wm.workspace_id=o.workspace_id and wm.role='owner' order by wm.user_id limit 1))) then '예' else '아니오' end
union all select 'org records rows not moved',(select count(*) from public.app_suborganization_updates where source_kind is null or source_kind not in ('status_row','weekly_line'))::text
union all select 'status rows total',(select count(*) from public.app_org_status_rows)::text
union all select 'weekly lines total',(select count(*) from public.app_weekly_org_lines)::text
union all select 'status rows hash',md5(coalesce((select string_agg(r.id::text||':'||r.organization_id::text||':'||r.day::text||':'||coalesce(r.end_day::text,'')||':'||md5(r.body)||':'||r.updated_at::text,',' order by r.id) from public.app_org_status_rows r),''))
union all select 'weekly lines hash',md5(coalesce((select string_agg(w.id::text||':'||w.state||':'||coalesce(w.day::text,'')||':'||md5(w.body)||':'||w.updated_at::text,',' order by w.id) from public.app_weekly_org_lines w),''));
