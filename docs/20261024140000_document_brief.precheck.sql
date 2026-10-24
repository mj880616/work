-- SELECT only. Run before dry-run/apply (also the dry-run before/after comparison). Aggregates, names and hashes only; no summary text.
-- 운영 DB를 이 세션에서 볼 수 없으므로 docs/design/weekly-file-summary.md 8.1-1의 가정을 전부 여기서 확인한다.
-- 적용 전 기대: 아래 expect 줄이 없는 항목은 모두 예. 하나라도 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- read_only 요청은 표 소유자가 아닌 역할로 돈다. information_schema 대신 pg_catalog과 명시한 역할 이름(authenticated·anon)으로 읽는다.
-- expect: anon or public table privilege = 아니오
-- expect: old read policy present = 아니오
-- expect: foreign key to documents = 기록
-- expect: foreign key names hash = 기록
-- expect: columns definition hash = 기록
-- expect: index rows = 기록
-- expect: old shape rows = 기록
-- expect: brief rows = 기록
-- expect: null hash rows = 기록
-- expect: other constraints hash = 기록
-- expect: indexes hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: policies hash = 기록
-- expect: triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261024140000') then '예' else '아니오' end as value
union all select 'prerequisite recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261022100000' and name='library_ai_fill')=1 then '예' else '아니오' end
union all select 'index table present',case when to_regclass('public.app_document_ai_index') is not null and to_regclass('public.app_documents') is not null then '예' else '아니오' end
union all select 'nine columns with expected types',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_document_ai_index') and attnum>0 and not attisdropped
  and ((attname='document_id' and atttypid='uuid'::regtype) or (attname='workspace_id' and atttypid='uuid'::regtype)
    or (attname='content_hash' and atttypid='text'::regtype) or (attname='summary' and atttypid='text'::regtype)
    or (attname='keywords' and atttypid='text[]'::regtype) or (attname='chunk_count' and atttypid in ('integer'::regtype,'bigint'::regtype,'smallint'::regtype))
    or (attname='summary_model' and atttypid='text'::regtype) or (attname='indexed_at' and atttypid='timestamptz'::regtype)
    or (attname='updated_at' and atttypid='timestamptz'::regtype)))=9 then '예' else '아니오' end
union all select 'no other required column without default',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_document_ai_index') and attnum>0 and not attisdropped
  and attnotnull and not atthasdef and attname not in ('document_id','workspace_id','content_hash','summary','keywords','chunk_count','summary_model','indexed_at','updated_at')) then '예' else '아니오' end
union all select 'columns definition hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.app_document_ai_index') and a.attnum>0 and not a.attisdropped
union all select 'document id unique',case when exists(select 1 from pg_index i where i.indrelid=to_regclass('public.app_document_ai_index') and i.indisunique and i.indnkeyatts=1 and i.indpred is null
  and i.indkey[0]=(select attnum from pg_attribute where attrelid=to_regclass('public.app_document_ai_index') and attname='document_id')) then '예' else '아니오' end
union all select 'foreign key to documents',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_document_ai_index') and contype='f' and confrelid=to_regclass('public.app_documents')) then '예' else '아니오' end
union all select 'foreign key names hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_document_ai_index') and contype='f'
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_document_ai_index') and relrowsecurity) then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_document_ai_index'))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_document_ai_index' and policyname='task12a_owner_all' and cmd='ALL' and roles=array['authenticated']::name[]
    and regexp_replace(qual,'[\s()]','','g')='private.app_is_owner_documentdocument_id' and regexp_replace(with_check,'[\s()]','','g')='private.app_is_owner_documentdocument_id') then '예' else '아니오' end
union all select 'old read policy present',case when exists(select 1 from pg_policy where polrelid=to_regclass('public.app_document_ai_index') and polname='app_document_ai_index_read') then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_owner_document(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'authenticated can select',case when has_table_privilege('authenticated','public.app_document_ai_index','select') then '예' else '아니오' end
union all select 'authenticated can insert',case when has_table_privilege('authenticated','public.app_document_ai_index','insert') then '예' else '아니오' end
union all select 'authenticated can update',case when has_table_privilege('authenticated','public.app_document_ai_index','update') then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_document_ai_index','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_document_ai_index') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'brief check absent',case when not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_document_ai_index') and conname='app_document_ai_index_brief_check') then '예' else '아니오' end
union all select 'index rows',count(*)::text from public.app_document_ai_index
union all select 'old shape rows',count(*)::text from public.app_document_ai_index where content_hash is not null and left(content_hash,3)<>'b1:'
union all select 'brief rows',count(*)::text from public.app_document_ai_index where left(content_hash,3)='b1:'
union all select 'null hash rows',count(*)::text from public.app_document_ai_index where content_hash is null
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_document_ai_index') and conname<>'app_document_ai_index_brief_check'
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_document_ai_index'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_document_ai_index')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_document_ai_index') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_document_ai_index')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_document_ai_index') and not tgisinternal;
