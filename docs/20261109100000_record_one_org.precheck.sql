-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 해시 4개(조직 기록의 정책·표 권한·기존 칸 권한·기존 검사)는 기록만 하고 사후 확인에서 같아야 한다.
-- 'org records table grants for authenticated'가 예여야 새 칸에 따로 권한을 주지 않아도 된다(칸 단위 권한이면 멈춤).
-- 'org records created_at'이 아니오면(운영 표에 created_at이 없음) 멈추고 커맨드센터가 created_at을 더하는 판으로 바꾼다.
-- expect: org records policies hash = 기록
-- expect: org records table grants hash = 기록
-- expect: org records old column grants hash = 기록
-- expect: org records old constraints hash = 기록
-- expect: recent migrations = 기록
with u as (select to_regclass('public.app_suborganization_updates') as p)
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261109100000') then '예' else '아니오' end as value
union all select 'prerequisite tables with workspace',case when to_regclass('public.app_workspaces') is not null and to_regclass('public.app_spaces') is not null
  and (select count(*) from pg_attribute where attnum>0 and not attisdropped and atttypid='uuid'::regtype and attname='workspace_id'
    and attrelid in (to_regclass('public.app_suborganizations'),to_regclass('public.app_documents'),to_regclass('public.app_meetings'),
      to_regclass('public.app_feed_items'),to_regclass('public.app_journal_memorable'),to_regclass('public.app_notes')))=6 then '예' else '아니오' end
union all select 'org records organization_id occurred_at',case when (select count(*) from pg_attribute,u where attrelid=u.p and attnum>0 and not attisdropped
  and ((attname='organization_id' and atttypid='uuid'::regtype) or (attname='occurred_at' and atttypid='timestamptz'::regtype)))=2 then '예' else '아니오' end
union all select 'org records created_at',case when exists(select 1 from pg_attribute,u where attrelid=u.p and attname='created_at' and atttypid='timestamptz'::regtype and not attisdropped) then '예' else '아니오' end
union all select 'org records new columns absent',case when not exists(select 1 from pg_attribute,u where attrelid=u.p and not attisdropped and attname in ('end_day','source_kind','source_id')) then '예' else '아니오' end
union all select 'org records RLS on and no anon or PUBLIC',case when (select relrowsecurity from pg_class where oid=(select p from u))
  and not exists(select 1 from pg_class where oid=(select p from u) and relacl::text ~ '(^|[{,])(anon)?=')
  and not exists(select 1 from pg_policy where polrelid=(select p from u) and (polroles @> array[0::oid] or polroles @> array[to_regrole('anon')::oid]))
  and (select count(*) from pg_policy where polrelid=(select p from u))>=1 then '예' else '아니오' end
union all select 'org records table grants for authenticated',case when exists(select 1 from pg_class where oid=(select p from u)
  and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*r' and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*a' and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w') then '예' else '아니오' end
union all select 'new tables functions indexes absent',case when to_regclass('public.app_report_line_marks') is null and to_regclass('public.app_report_snapshots') is null
  and to_regclass('public.app_suborganization_updates_source_once') is null and to_regclass('public.app_suborganization_updates_org_occurred_idx') is null
  and to_regprocedure('private.app_suborganization_updates_source_guard()') is null and to_regprocedure('private.app_report_line_marks_guard()') is null
  and to_regprocedure('private.app_report_snapshots_guard()') is null
  and not exists(select 1 from pg_constraint where conrelid=(select p from u) and conname in ('app_suborganization_updates_end_day_check','app_suborganization_updates_source_check')) then '예' else '아니오' end
union all select 'owner and space functions',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
  and to_regprocedure('private.app_space_in_workspace(uuid,uuid)') is not null then '예' else '아니오' end
union all select 'org records policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select p from u)
union all select 'org records table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select p from u)
union all select 'org records old column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),''))
  from pg_attribute where attrelid=(select p from u) and attnum>0 and not attisdropped and attname not in ('end_day','source_kind','source_id')
union all select 'org records old constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=(select p from u) and conname not in ('app_suborganization_updates_end_day_check','app_suborganization_updates_source_check')
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
