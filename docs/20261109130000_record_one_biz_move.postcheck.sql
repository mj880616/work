-- SELECT only. 적용 뒤(승인형 DB workflow 사후 확인 또는 SQL Editor). 집계 숫자·해시·예/아니오만 낸다(행 값 없음).
-- 예/아니오는 모두 예. 'progress rows to move'는 실제로 옮긴 줄 수이고 사전 확인의 같은 이름 값(옮길 대상 − 건너뜀)과 같아야 한다.
-- 원래 표 개수·해시와 옮기지 않은 사업 기록 수는 사전 값과 같아야 한다(원래 자료 그대로). 다시 돌리면 옮길 줄 0건.
with e_all as (
  select p.id, s.workspace_id, p.project_id as space_id,
    coalesce(p.effective_on, (p.created_at at time zone 'Asia/Seoul')::date) as day,
    btrim(regexp_replace(coalesce(p.summary, ''), '[[:cntrl:]]+', ' ', 'g')) as body, p.created_at
  from public.app_project_progress_updates p
  join public.app_spaces s on s.id = p.project_id and s.workspace_id is not null),
e_day as (select e.* from e_all e where e.day is not null),
e_text as (select e.* from e_day e where char_length(e.body) >= 1),
e_len as (select e.* from e_text e where char_length(e.body) <= 300),
e_fresh as (select e.* from e_len e where not exists (select 1 from public.app_business_records b
  where b.workspace_id = e.workspace_id and b.source_kind = 'progress' and b.source_id = e.id)),
e_one as (select distinct on (e.space_id, e.day, e.body) e.* from e_fresh e order by e.space_id, e.day, e.body, e.created_at, e.id),
e_new as (select d.*, row_number() over (partition by d.space_id, d.day order by d.created_at, d.id) as n from e_one d
  where not exists (select 1 from public.app_business_records b
    where b.workspace_id = d.workspace_id and b.space_id = d.space_id and b.day = d.day and b.body = d.body)),
e_move as (select c.* from e_new c
  where c.n + (select count(*) from public.app_business_records b where b.space_id = c.space_id and b.day = c.day) <= 50)
select 'migration recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261109130000' and name='record_one_biz_move')=1 then '예' else '아니오' end as value
union all select 'progress rows to move',(select count(*) from public.app_business_records where source_kind='progress')::text
union all select 'nothing left to move',case when (select count(*) from e_move)=0 then '예' else '아니오' end
union all select 'moved rows match their original',case when not exists(select 1 from public.app_business_records b where b.source_kind='progress'
  and not exists(select 1 from e_all e where e.id=b.source_id and e.space_id=b.space_id and e.day=b.day and e.body=b.body and b.created_at=coalesce(e.created_at,b.created_at) and b.end_day is null)) then '예' else '아니오' end
union all select 'moved rows stay in their workspace',case when not exists(select 1 from public.app_business_records b where b.source_kind='progress'
  and (not exists(select 1 from public.app_spaces s where s.id=b.space_id and s.workspace_id=b.workspace_id)
    or b.created_by is distinct from (select wm.user_id from public.app_workspace_members wm where wm.workspace_id=b.workspace_id and wm.role='owner' order by wm.user_id limit 1))) then '예' else '아니오' end
union all select 'at most 50 a day per business',case when not exists(select 1 from public.app_business_records b group by b.space_id,b.day having count(*)>50) then '예' else '아니오' end
union all select 'progress rows total',(select count(*) from public.app_project_progress_updates)::text
union all select 'progress rows hash',md5(coalesce((select string_agg(p.id::text||':'||p.project_id::text||':'||coalesce(p.effective_on::text,'')||':'||md5(coalesce(p.summary,''))||':'||coalesce(p.created_at::text,''),',' order by p.id) from public.app_project_progress_updates p),''))
union all select 'business records rows not moved',(select count(*) from public.app_business_records where source_kind<>'progress')::text;
