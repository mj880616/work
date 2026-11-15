-- SELECT only. Works after apply (record + reread rows are marker rows) and after rollback (no record + no marker rows).
-- The count/hash items must equal the precheck values of the same name: exactly the precheck reread rows changed, and only their status.
with t as (select to_regclass('public.app_documents') as rel),
history as (
  select count(*) as n,count(*) filter(where name='library_reread_old_scans') as named from supabase_migrations.schema_migrations where version='20261024170000'
), scope as (
  select d.id,d.extraction_status,lower(coalesce(d.file_name,''))||' '||lower(coalesce(d.mime_type,'')) as kind from public.app_documents d
  where d.workspace_id in (select w.id from public.app_workspaces w where w.slug='kptu-work') and d.file_id is not null and (d.extracted_text is null or btrim(d.extracted_text)='') and d.extraction_error in ('unsupported','empty','현재 AI 본문 읽기를 지원하지 않는 파일 형식입니다.','추출된 본문이 비어 있습니다.') and (d.extracted_at is null or d.extracted_at<'2026-10-24 01:36:00+00'::timestamptz) and (lower(d.file_name) ~ '\.(jpe?g|png|pdf)$' or (coalesce(lower(d.file_name),'') !~ '\.[a-z0-9]{1,8}$' and lower(d.mime_type) in ('image/jpeg','image/png','application/pdf')))
), reread as (select * from scope where extraction_status='error' or extraction_status is null),
markers as (select count(*) as n from public.app_documents d where d.extraction_status is null and d.extraction_error in ('unsupported','empty','현재 AI 본문 읽기를 지원하지 않는 파일 형식입니다.','추출된 본문이 비어 있습니다.'))
select 'status and history agree' as item,case when
  (history.n=1 and history.named=1 and not exists(select 1 from reread where extraction_status='error') and markers.n=(select count(*) from reread))
  or (history.n=0 and markers.n=0) then '예' else '아니오' end as value from history,markers
union all select 'RLS still enabled',case when exists(select 1 from t join pg_class c on c.oid=t.rel and c.relrowsecurity) then '예' else '아니오' end
union all select 'reread rows',(select count(*) from reread)::text
union all select 'reread rows photo',(select count(*) from reread where kind ~ '\.(jpe?g|png) |image/')::text
union all select 'reread rows pdf',(select count(*) from reread where not (kind ~ '\.(jpe?g|png) |image/'))::text
union all select 'reread ids hash',md5(coalesce((select string_agg(id::text,',' order by id) from reread),''))
union all select 'documents rows',(select count(*) from public.app_documents)::text
union all select 'documents values without status hash',md5(coalesce((select string_agg((to_jsonb(d)-'extraction_status')::text,E'\n' order by d.id) from public.app_documents d),''))
union all select 'other rows status hash',md5(coalesce((select string_agg(d.id::text||':'||coalesce(d.extraction_status,'(null)'),',' order by d.id) from public.app_documents d where d.id not in (select id from reread)),''))
union all select 'documents columns hash',md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attname)
  from t join pg_attribute a on a.attrelid=t.rel and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum),''))
union all select 'documents policies hash',md5(coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=(select rel from t)),''))
union all select 'documents owner RLS grants hash',md5(coalesce((select c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=(select rel from t)),''))
union all select 'documents column grants hash',md5(coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=(select rel from t) and a.attnum>0 and not a.attisdropped),''))
union all select 'documents triggers hash',md5(coalesce((select string_agg(g.tgname||':'||g.tgenabled::text||':'||pg_get_triggerdef(g.oid),',' order by g.tgname) from pg_trigger g where g.tgrelid=(select rel from t) and not g.tgisinternal),''))
union all select 'documents indexes hash',md5(coalesce((select string_agg(ic.relname||':'||pg_get_indexdef(x.indexrelid),',' order by ic.relname) from pg_index x join pg_class ic on ic.oid=x.indexrelid where x.indrelid=(select rel from t)),''));
