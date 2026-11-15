-- SELECT only. Run before dry-run/apply (also the dry-run before/after comparison). Counts and hashes only; no text, titles, file names or ids.
-- 적용 전 기대: 아래 expect가 없는 항목은 모두 예. 표시 행(상태 비어 있음 + 대상 이유)은 0.
-- "다시 읽을 자료"(reread rows)는 상태가 error인 대상 행 + 이미 되돌린 표시 행의 합이라 적용 전·후·rollback 뒤 모두 같은 값이다.
--   postcheck의 같은 이름 항목과 같아야 한다(바뀐 행이 정확히 그 행들인지 id 해시까지 대조). 0이면 무변화로 끝난다.
-- 상태 칸을 뺀 모든 칸의 값 해시, 대상 밖 행의 상태 해시, 칸·정책·권한·트리거·색인 해시도 postcheck와 같아야 한다.
-- expect: marker rows = 0
-- expect: recent migrations = 기록
-- expect: reread rows = 기록
-- expect: reread rows photo = 기록
-- expect: reread rows pdf = 기록
-- expect: reread ids hash = 기록
-- expect: documents rows = 기록
-- expect: documents values without status hash = 기록
-- expect: other rows status hash = 기록
-- expect: documents columns hash = 기록
-- expect: documents policies hash = 기록
-- expect: documents owner RLS grants hash = 기록
-- expect: documents column grants hash = 기록
-- expect: documents triggers hash = 기록
-- expect: documents indexes hash = 기록
with t as (select to_regclass('public.app_documents') as rel),
scope as (
  select d.id,d.extraction_status,lower(coalesce(d.file_name,''))||' '||lower(coalesce(d.mime_type,'')) as kind from public.app_documents d
  where d.workspace_id in (select w.id from public.app_workspaces w where w.slug='kptu-work') and d.file_id is not null and (d.extracted_text is null or btrim(d.extracted_text)='') and d.extraction_error in ('unsupported','empty','현재 AI 본문 읽기를 지원하지 않는 파일 형식입니다.','추출된 본문이 비어 있습니다.') and (d.extracted_at is null or d.extracted_at<'2026-10-24 01:36:00+00'::timestamptz) and (lower(d.file_name) ~ '\.(jpe?g|png|pdf)$' or (coalesce(lower(d.file_name),'') !~ '\.[a-z0-9]{1,8}$' and lower(d.mime_type) in ('image/jpeg','image/png','application/pdf')))
), reread as (select * from scope where extraction_status='error' or extraction_status is null)
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261024170000') then '예' else '아니오' end as value
union all select 'workspace found',case when (select count(*) from public.app_workspaces where slug='kptu-work')=1 then '예' else '아니오' end
union all select 'text columns as expected',case when (select count(*) from t join pg_attribute a on a.attrelid=t.rel and not a.attisdropped
  and ((a.attname in ('file_id','file_name','mime_type','extracted_text','extraction_status','extraction_error') and a.atttypid='text'::regtype)
    or (a.attname='extracted_at' and a.atttypid='timestamptz'::regtype)))=7 then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from t join pg_class c on c.oid=t.rel and c.relrowsecurity) then '예' else '아니오' end
union all select 'marker rows',(select count(*) from public.app_documents d where d.extraction_status is null and d.extraction_error in ('unsupported','empty','현재 AI 본문 읽기를 지원하지 않는 파일 형식입니다.','추출된 본문이 비어 있습니다.'))::text
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r)
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
