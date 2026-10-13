-- First run the independent 20261013034836_basket_photo_ocr_db.version-check.sql; stop below PG16 or if unknown.
-- SELECT only. Save before dry-run/apply. No note or OCR contents are printed.
with objects as (
 select 'column' kind,a.attname name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') definition from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.app_notes'::regclass and a.attnum>0 and not a.attisdropped
 union all select 'constraint',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.app_notes'::regclass
 union all select 'policy',polname,polcmd::text||':'||polroles::text||':'||coalesce(pg_get_expr(polqual,polrelid),'')||':'||coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy where polrelid in('public.app_notes'::regclass,'public.app_record_links'::regclass)
 union all select 'ACL',relname,relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid in('public.app_notes'::regclass,'public.app_record_links'::regclass)
 union all select 'column ACL',attname,coalesce(attacl::text,'') from pg_attribute where attrelid='public.app_notes'::regclass and attnum>0 and not attisdropped
 union all select 'function default ACL',defaclobjtype::text||':'||defaclnamespace::text,defaclacl::text from pg_default_acl where defaclrole=current_user::regrole and defaclobjtype='f' and (defaclnamespace=0 or defaclnamespace='public'::regnamespace)
 union all select 'auth role membership',member::regrole::text,inherit_option::text||':'||set_option::text from pg_auth_members where roleid='authenticated'::regrole
 union all select 'trigger',tgname,tgenabled::text||':'||pg_get_triggerdef(oid)||':'||pg_get_functiondef(tgfoid) from pg_trigger where tgrelid='public.app_notes'::regclass and not tgisinternal
 union all select 'existing function',p.proname,pg_get_functiondef(p.oid)||':'||coalesce(p.proacl::text,'') from pg_proc p where p.oid in(to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'),to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)'))
)
select kind,name,definition from objects
union all select 'aggregate','public attachments CHECK name count',count(*)::text from pg_constraint where connamespace='public'::regnamespace and conname='app_notes_attachments_check'
union all select 'aggregate','notes rows',count(*)::text from public.app_notes
union all select 'aggregate','notes full-row hash',md5(coalesce(string_agg((to_jsonb(n)||jsonb_build_object('occurred_at',to_char(n.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char(n.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char(n.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'archived_at',to_char(n.archived_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))::text,E'\n' order by id),'')) from public.app_notes n
union all select 'aggregate','links full-row hash',md5(coalesce(string_agg((to_jsonb(l)||jsonb_build_object('created_at',to_char(l.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'task_checked_at',to_char(l.task_checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))::text,E'\n' order by id),'')) from public.app_record_links l
order by 1,2,3;
