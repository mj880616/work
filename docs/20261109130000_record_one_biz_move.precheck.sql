-- SELECT only. Run before dry-run/apply (승인형 DB workflow 또는 SQL Editor 폰 경로 C). 집계 숫자·해시·예/아니오만 낸다(행 값 없음).
-- B-1(record_one_biz)이 적용되지 않았으면 app_business_records가 없어 이 SQL이 오류로 끝난다 → workflow는 쓰기 전에 멈춘다.
-- 적용 전 기대: 예/아니오 항목은 모두 예. 'already moved'는 0. 개수·해시는 기록하고, 사후 확인에서
--   'progress rows to move'(옮길 대상 − 건너뜀) = 실제 옮긴 수, 원래 표 개수·해시·옮기지 않은 사업 기록 수 = 그대로.
-- expect: already moved = 0
-- expect: progress rows total = 기록
-- expect: progress rows skip no business = 기록
-- expect: progress rows skip no date = 기록
-- expect: progress rows skip empty text = 기록
-- expect: progress rows skip over 300 chars = 기록
-- expect: progress rows skip same line twice = 기록
-- expect: progress rows skip record already there = 기록
-- expect: progress rows skip over 50 a day = 기록
-- expect: progress rows to move = 기록
-- expect: progress rows hash = 기록
-- expect: business records rows not moved = 기록
-- expect: recent migrations = 기록
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
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261109130000') then '예' else '아니오' end as value
union all select 'previous migration record_one_biz present',case when (select count(*) from supabase_migrations.schema_migrations where version='20261109110000' and name='record_one_biz')=1 then '예' else '아니오' end
union all select 'progress table columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_project_progress_updates') and attnum>0 and not attisdropped
  and ((attname='id' and atttypid='uuid'::regtype) or (attname='project_id' and atttypid='uuid'::regtype) or (attname='summary' and atttypid='text'::regtype)
    or (attname='effective_on' and atttypid='date'::regtype) or (attname='created_at' and atttypid='timestamptz'::regtype)))=5 then '예' else '아니오' end
union all select 'business records unique index and guard',case when to_regclass('public.app_business_records_source_once') is not null
  and (select count(*) from pg_trigger where tgrelid=to_regclass('public.app_business_records') and tgname='app_business_records_guard' and not tgisinternal and tgenabled='O')=1 then '예' else '아니오' end
union all select 'owner member table',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_workspace_members') and attnum>0 and not attisdropped
  and attname in ('workspace_id','user_id','role'))=3 then '예' else '아니오' end
union all select 'every moved workspace has one owner',case when not exists(select 1 from (select distinct workspace_id from e_move) z
  where (select count(*) from public.app_workspace_members wm where wm.workspace_id=z.workspace_id and wm.role='owner')<>1) then '예' else '아니오' end
union all select 'already moved',(select count(*) from public.app_business_records where source_kind='progress')::text
union all select 'progress rows total',(select count(*) from public.app_project_progress_updates)::text
union all select 'progress rows skip no business',((select count(*) from public.app_project_progress_updates)-(select count(*) from e_all))::text
union all select 'progress rows skip no date',((select count(*) from e_all)-(select count(*) from e_day))::text
union all select 'progress rows skip empty text',((select count(*) from e_day)-(select count(*) from e_text))::text
union all select 'progress rows skip over 300 chars',((select count(*) from e_text)-(select count(*) from e_len))::text
union all select 'progress rows skip same line twice',((select count(*) from e_fresh)-(select count(*) from e_one))::text
union all select 'progress rows skip record already there',((select count(*) from e_one)-(select count(*) from e_new))::text
union all select 'progress rows skip over 50 a day',((select count(*) from e_new)-(select count(*) from e_move))::text
union all select 'progress rows to move',(select count(*) from e_move)::text
union all select 'progress rows hash',md5(coalesce((select string_agg(p.id::text||':'||p.project_id::text||':'||coalesce(p.effective_on::text,'')||':'||md5(coalesce(p.summary,''))||':'||coalesce(p.created_at::text,''),',' order by p.id) from public.app_project_progress_updates p),''))
union all select 'business records rows not moved',(select count(*) from public.app_business_records where source_kind<>'progress')::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
