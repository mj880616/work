-- SELECT only. Run after apply (all 예 expected) or after rollback ('objects and history agree' = 예, 'trash installed' = 아니오).
-- 숫자·해시 항목(행 수·외래키·트리거·제약·칸·권한·정책·행 해시·service_role 읽기 권한)은 사전 확인의 같은 이름 항목과 같아야 한다.
-- 새로 생긴 칸·트리거·정책은 해시와 목록에서 뺀다(새로 생긴 것만 다르다). 프로젝트 휴지통(app_spaces)은 이번에 바꾸지 않는다.
with history as (
  select count(*) as n,count(*) filter(where name='trash_org_report_db') as named
  from supabase_migrations.schema_migrations where version='20261025100000'
), org_col as (
  select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_suborganizations') and not attisdropped and attname='deleted_at' and atttypid='timestamptz'::regtype and not attnotnull and not atthasdef
), org_trg as (
  select count(*) as n,count(*) filter(where tgenabled='O' and tgfoid=to_regprocedure('private.app_trash_org_before_delete()')
    and pg_get_triggerdef(oid) like '%BEFORE DELETE ON public.app_suborganizations FOR EACH ROW%') as valid
  from pg_trigger where tgrelid=to_regclass('public.app_suborganizations') and tgname='app_suborganizations_a_trash_before_delete'
), org_pol as (
  select count(*) as n,count(*) filter(where not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
    and pg_get_expr(polqual,polrelid)='(deleted_at IS NULL)' and pg_get_expr(polwithcheck,polrelid)='(deleted_at IS NULL)') as valid
  from pg_policy where polrelid=to_regclass('public.app_suborganizations') and polname='app_suborganizations_trash_hidden'
), org_first as (
  select tgname from pg_trigger where tgrelid=to_regclass('public.app_suborganizations') and not tgisinternal and (tgtype & 1)=1 and (tgtype & 2)=2 and (tgtype & 8)=8 order by tgname collate "C" limit 1
), report_col as (
  select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_meetings') and not attisdropped and attname='deleted_at' and atttypid='timestamptz'::regtype and not attnotnull and not atthasdef
), report_trg as (
  select count(*) as n,count(*) filter(where tgenabled='O' and tgfoid=to_regprocedure('private.app_trash_report_before_delete()')
    and pg_get_triggerdef(oid) like '%BEFORE DELETE ON public.app_meetings FOR EACH ROW%') as valid
  from pg_trigger where tgrelid=to_regclass('public.app_meetings') and tgname='app_meetings_a_trash_before_delete'
), report_pol as (
  select count(*) as n,count(*) filter(where not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
    and pg_get_expr(polqual,polrelid)='(deleted_at IS NULL)' and pg_get_expr(polwithcheck,polrelid)='(deleted_at IS NULL)') as valid
  from pg_policy where polrelid=to_regclass('public.app_meetings') and polname='app_meetings_trash_hidden'
), report_first as (
  select tgname from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal and (tgtype & 1)=1 and (tgtype & 2)=2 and (tgtype & 8)=8 order by tgname collate "C" limit 1
), fns as (
  select count(*) as n,
    count(*) filter(where p.prosecdef and p.proconfig=array['search_path=""']
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0)
      and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
      and (has_function_privilege('authenticated',p.oid,'execute') = (p.oid not in (to_regprocedure('private.app_trash_org_before_delete()'),to_regprocedure('private.app_trash_report_before_delete()'))))) as valid
  from pg_proc p where p.oid in (to_regprocedure('private.app_trash_org_before_delete()'),to_regprocedure('private.app_trash_report_before_delete()'))
), rpc as (
  -- RPC 3개: 적용 뒤에는 세 종류를 모두 알고, 되돌린 뒤에는 프로젝트 전용 모양이다. 어느 쪽이든 서명·DEFINER·search_path·권한은 같아야 한다.
  select count(*) as n,
    count(*) filter(where p.prosecdef and p.proconfig=array['search_path=""']
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0)
      and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
      and has_function_privilege('authenticated',p.oid,'execute')) as valid,
    count(*) filter(where p.prosrc like '%app_suborganizations%' and p.prosrc like '%app_meetings%' and p.prosrc like '%public.app_spaces%') as wide,
    count(*) filter(where p.prosrc not like '%app_suborganizations%' and p.prosrc not like '%app_meetings%' and p.prosrc like '%public.app_spaces%') as narrow
  from pg_proc p where p.oid in (to_regprocedure('public.app_trash_list(text)'),to_regprocedure('public.app_trash_restore(text,uuid)'),to_regprocedure('public.app_trash_purge(text,uuid)'))
), installed as (
  select ((select n from org_col)=1 and (select n from org_trg)=1 and (select valid from org_trg)=1 and (select n from org_pol)=1 and (select valid from org_pol)=1 and to_regclass('public.app_suborganizations_trash_idx') is not null) and ((select n from report_col)=1 and (select n from report_trg)=1 and (select valid from report_trg)=1 and (select n from report_pol)=1 and (select valid from report_pol)=1 and to_regclass('public.app_meetings_trash_idx') is not null)
    and (select n from fns)=2 and (select valid from fns)=2 and (select n from rpc)=3 and (select valid from rpc)=3 and (select wide from rpc)=3 as ok
), removed as (
  select ((select n from org_col)=0 and (select n from org_trg)=0 and (select n from org_pol)=0 and to_regclass('public.app_suborganizations_trash_idx') is null) and ((select n from report_col)=0 and (select n from report_trg)=0 and (select n from report_pol)=0 and to_regclass('public.app_meetings_trash_idx') is null)
    and (select n from fns)=0 and (select n from rpc)=3 and (select valid from rpc)=3 and (select narrow from rpc)=3 as ok
)
select 'objects and history agree' as item,case when ((select n from history)=0 and (select ok from removed))
  or ((select n from history)=1 and (select named from history)=1 and (select ok from installed)) then '예' else '아니오' end as ok
union all select 'trash installed',case when (select ok from installed) then '예' else '아니오' end
union all select 'org trash trigger runs first',case when (select n from org_trg)=0 or (select tgname from org_first)='app_suborganizations_a_trash_before_delete' then '예' else '아니오' end
union all select 'report trash trigger runs first',case when (select n from report_trg)=0 or (select tgname from report_first)='app_meetings_a_trash_before_delete' then '예' else '아니오' end
union all select 'project trash still installed',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_spaces') and attname in ('deleted_at') and not attisdropped)
  and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_spaces') and tgname='app_spaces_a_trash_before_delete' and tgenabled='O')
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_spaces') and polname='app_spaces_trash_hidden') then '예' else '아니오' end
union all select 'RLS still enabled and not forced on both',case when (select count(*) from pg_class where oid in (to_regclass('public.app_suborganizations'),to_regclass('public.app_meetings')) and relrowsecurity and not relforcerowsecurity)=2 then '예' else '아니오' end
union all select 'org row count',count(*)::text from public.app_suborganizations
union all select 'org foreign keys in by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_suborganizations') group by confdeltype) f),'')
union all select 'org triggers',coalesce((select string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname) from pg_trigger where tgrelid=to_regclass('public.app_suborganizations') and not tgisinternal and tgname<>'app_suborganizations_a_trash_before_delete'),'')
union all select 'org constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_suborganizations')),''))
union all select 'org columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_suborganizations') and attnum>0 and not attisdropped and attname<>'deleted_at'),''))
union all select 'org owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_suborganizations')),''))
union all select 'org policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_suborganizations') and polname<>'app_suborganizations_trash_hidden'),''))
union all select 'org rows hash (ids only)',md5(coalesce((select string_agg(id::text,',' order by id) from public.app_suborganizations),''))
union all select 'org service_role select (table level)',has_table_privilege('service_role','public.app_suborganizations','select')::text
union all select 'report row count',count(*)::text from public.app_meetings
union all select 'report foreign keys in by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_meetings') group by confdeltype) f),'')
union all select 'report triggers',coalesce((select string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname) from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal and tgname<>'app_meetings_a_trash_before_delete'),'')
union all select 'report constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_meetings')),''))
union all select 'report columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_meetings') and attnum>0 and not attisdropped and attname<>'deleted_at'),''))
union all select 'report owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_meetings')),''))
union all select 'report policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_meetings') and polname<>'app_meetings_trash_hidden'),''))
union all select 'report rows hash (ids only)',md5(coalesce((select string_agg(id::text,',' order by id) from public.app_meetings),''))
union all select 'report service_role select (table level)',has_table_privilege('service_role','public.app_meetings','select')::text;
