-- SELECT only. Run before apply (SQL Editor, phone path C, or approved DB workflow). Aggregates only; no project names, ids or row values.
-- 적용 전 기대: 아래 예/아니오 항목은 모두 예. 숫자·해시 항목은 사후 확인과 비교용으로 캡처만 한다.
-- read_only 요청은 실행 역할이 postgres가 아닐 수 있으므로 current_user 대신 postgres 역할을 명시해 확인한다.
-- 승인형 DB workflow 기대값(DB-승인형확장): 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: project row count = 기록
-- expect: top project count = 기록
-- expect: foreign keys to app_spaces by action = 기록
-- expect: triggers = 기록
-- expect: constraints hash = 기록
-- expect: columns hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: policies hash = 기록
-- expect: rows hash (parent links only) = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261024193000') then '예' else '아니오' end as value
union all select 'trash columns absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_spaces') and attname in ('deleted_at','deleted_root_id') and not attisdropped) then '예' else '아니오' end
union all select 'trash functions absent',case when to_regprocedure('private.app_trash_space_before_delete()') is null and to_regprocedure('public.app_trash_list(text)') is null
  and to_regprocedure('public.app_trash_restore(text,uuid)') is null and to_regprocedure('public.app_trash_purge(text,uuid)') is null then '예' else '아니오' end
union all select 'trash trigger policy constraint index absent',case when not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_spaces') and tgname='app_spaces_a_trash_before_delete')
  and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_spaces') and polname='app_spaces_trash_hidden')
  and not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_spaces') and conname='app_spaces_trash_pair_check')
  and to_regclass('public.app_spaces_trash_root_idx') is null then '예' else '아니오' end
union all select 'id workspace_id parent_id are uuid',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_spaces') and not attisdropped and atttypid='uuid'::regtype and attname in ('id','workspace_id','parent_id'))=3 then '예' else '아니오' end
union all select 'name column present',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_spaces') and attname='name' and not attisdropped) then '예' else '아니오' end
union all select 'RLS enabled and not forced',case when exists(select 1 from pg_class where oid=to_regclass('public.app_spaces') and relrowsecurity and not relforcerowsecurity) then '예' else '아니오' end
union all select 'postgres owns or bypasses RLS',case when exists(select 1 from pg_roles r join pg_class c on c.oid=to_regclass('public.app_spaces') where r.rolname='postgres' and (r.rolbypassrls or r.oid=c.relowner)) then '예' else '아니오' end
union all select 'owner check function present',case when to_regprocedure('private.app_is_workspace_owner(uuid)') is not null then '예' else '아니오' end
union all select 'parent_id foreign key cascades',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_spaces') and contype='f' and confrelid=to_regclass('public.app_spaces') and confdeltype='c'
  and conkey=array[(select attnum from pg_attribute where attrelid=to_regclass('public.app_spaces') and attname='parent_id')])=1 then '예' else '아니오' end
union all select 'only the unlink before delete trigger',case when (select count(*) from pg_trigger where tgrelid=to_regclass('public.app_spaces') and not tgisinternal and (tgtype & 1)=1 and (tgtype & 2)=2 and (tgtype & 8)=8)=1
  and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_spaces') and not tgisinternal and tgname='app_spaces_unlink_retained_records_before_delete' and tgenabled='O' and (tgtype & 1)=1 and (tgtype & 2)=2 and (tgtype & 8)=8) then '예' else '아니오' end
union all select 'project row count',count(*)::text from public.app_spaces
union all select 'top project count',count(*)::text from public.app_spaces where parent_id is null
union all select 'foreign keys to app_spaces by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_spaces') group by confdeltype) f),'')
union all select 'triggers',coalesce((select string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname) from pg_trigger where tgrelid=to_regclass('public.app_spaces') and not tgisinternal),'')
union all select 'constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_spaces') and conname<>'app_spaces_trash_pair_check'),''))
union all select 'columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_spaces') and attnum>0 and not attisdropped and attname not in ('deleted_at','deleted_root_id')),''))
union all select 'owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_spaces')),''))
union all select 'policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_spaces') and polname<>'app_spaces_trash_hidden'),''))
union all select 'rows hash (parent links only)',md5(coalesce((select string_agg(id::text||':'||coalesce(parent_id::text,''),',' order by id) from public.app_spaces),''))
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
