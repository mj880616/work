-- SELECT only. Aggregates and hashes; no document text, titles or file names. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: 아래 expect가 없는 항목은 모두 예. 두 칸·검사 개수는 0. 자료 수·해시·정책/권한/트리거/색인 해시는 값만 남기고 postcheck의 같은 이름 항목과 같은지 본다
--   (새 칸 두 개 말고는 칸·검사·권한·정책·트리거·색인·행 값이 하나도 바뀌지 않았는지).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: previous files column count = 0
-- expect: reclassify column count = 0
-- expect: previous files check count = 0
-- expect: anon or public table privilege = 아니오
-- expect: anon or public policy = 아니오
-- expect: recent migrations = 기록
-- expect: documents rows = 기록
-- expect: documents values hash = 기록
-- expect: documents columns hash = 기록
-- expect: documents constraints hash = 기록
-- expect: documents policies count = 기록
-- expect: documents policies hash = 기록
-- expect: documents owner RLS grants hash = 기록
-- expect: documents column grants hash = 기록
-- expect: documents triggers count = 기록
-- expect: documents triggers hash = 기록
-- expect: documents indexes hash = 기록
with t as (select to_regclass('public.app_documents') as rel)
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261023120000' and name='library_ai_classify')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261024030000') then '예' else '아니오' end
union all select 'documents table exists',case when (select rel from t) is not null then '예' else '아니오' end
union all select 'file and text columns are text',case when (select count(*) from t join pg_attribute a on a.attrelid=t.rel and not a.attisdropped
  and ((a.attname in ('file_id','file_name','extracted_text','extraction_status') and a.atttypid='text'::regtype) or (a.attname='field_origin' and a.atttypid='jsonb'::regtype)))=5 then '예' else '아니오' end
union all select 'previous files column count',(select count(*) from t join pg_attribute a on a.attrelid=t.rel and a.attname='previous_files' and not a.attisdropped)::text
union all select 'reclassify column count',(select count(*) from t join pg_attribute a on a.attrelid=t.rel and a.attname='reclassify_needed' and not a.attisdropped)::text
union all select 'previous files check count',(select count(*) from pg_constraint where conrelid=(select rel from t) and conname='app_documents_previous_files_check')::text
union all select 'RLS enabled',case when exists(select 1 from t join pg_class c on c.oid=t.rel and c.relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when exists(select 1 from t join pg_class c on c.oid=t.rel where c.relacl::text ~ '(^|[{,])(anon)?=')
  or exists(select 1 from t where has_table_privilege('anon',t.rel,'select') or has_table_privilege('anon',t.rel,'insert') or has_table_privilege('anon',t.rel,'update') or has_table_privilege('anon',t.rel,'delete')) then '예' else '아니오' end
union all select 'anon or public policy',case when exists(select 1 from t join pg_policy p on p.polrelid=t.rel where 0::oid=any(p.polroles) or 'anon'::regrole::oid=any(p.polroles)) then '예' else '아니오' end
union all select 'authenticated can read and update',case when exists(select 1 from t where has_table_privilege('authenticated',t.rel,'select') and has_table_privilege('authenticated',t.rel,'update')) then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=(select rel from t))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_documents' and policyname='task12a_owner_all' and permissive='PERMISSIVE' and cmd='ALL' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r)
union all select 'documents rows',count(*)::text from public.app_documents
union all select 'documents values hash',md5(coalesce(string_agg((to_jsonb(d)-'previous_files'-'reclassify_needed')::text,E'\n' order by d.id),'')) from public.app_documents d
union all select 'documents columns hash',md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attname)
  from t join pg_attribute a on a.attrelid=t.rel and a.attnum>0 and not a.attisdropped and a.attname not in ('previous_files','reclassify_needed') left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum),''))
union all select 'documents constraints hash',md5(coalesce((select string_agg(c.conname||':'||pg_get_constraintdef(c.oid),',' order by c.conname) from pg_constraint c where c.conrelid=(select rel from t) and c.conname<>'app_documents_previous_files_check'),''))
union all select 'documents policies count',(select count(*) from pg_policy where polrelid=(select rel from t))::text
union all select 'documents policies hash',md5(coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=(select rel from t)),''))
union all select 'documents owner RLS grants hash',md5(coalesce((select c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=(select rel from t)),''))
union all select 'documents column grants hash',md5(coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=(select rel from t) and a.attnum>0 and not a.attisdropped and a.attname not in ('previous_files','reclassify_needed')),''))
union all select 'documents triggers count',(select count(*) from pg_trigger g where g.tgrelid=(select rel from t) and not g.tgisinternal)::text
union all select 'documents triggers hash',md5(coalesce((select string_agg(g.tgname||':'||g.tgenabled::text||':'||pg_get_triggerdef(g.oid),',' order by g.tgname) from pg_trigger g where g.tgrelid=(select rel from t) and not g.tgisinternal),''))
union all select 'documents indexes hash',md5(coalesce((select string_agg(ic.relname||':'||pg_get_indexdef(x.indexrelid),',' order by ic.relname) from pg_index x join pg_class ic on ic.oid=x.indexrelid where x.indrelid=(select rel from t)),''));
