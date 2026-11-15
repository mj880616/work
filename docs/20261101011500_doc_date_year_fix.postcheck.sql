-- SELECT only. Works after apply (record and fix table present, no certain wrong date left) and after rollback/dry-run (no record, no fix table).
-- No title, file name, text or id is shown: only yes/no, counts and hashes. The fix table is only named through to_regclass (this file also runs after the rollback).
-- The count/hash items must equal the precheck values of the same name (no grant, policy, trigger or constraint change; no row added or removed; no date emptied).
with k as (select k.*
  from (select c.*,
      case when c.new_date is not null and c.new_date <= c.upload_day + 60 and c.origin = 'ai' then true else false end as fix
    from (select b.id, b.workspace_id, b.old_date, b.origin, b.dy, b.uy, b.upload_day, b.name, b.head, a.ys,
        case when cardinality(a.ys) = 1 and a.ys[1] <> b.dy and not (b.dm = 2 and b.dd = 29)
          and a.src !~ ('(^|[^0-9])' || b.dy::text || '([^0-9]|$)')
          then make_date(a.ys[1], b.dm, b.dd) end as new_date
      from (select d.id, d.workspace_id, d.document_date as old_date,
          coalesce(d.field_origin ->> 'document_date', '') as origin,
          extract(year from d.document_date)::int as dy, extract(month from d.document_date)::int as dm,
          extract(day from d.document_date)::int as dd,
          (d.created_at at time zone 'Asia/Seoul')::date as upload_day,
          extract(year from (d.created_at at time zone 'Asia/Seoul'))::int as uy,
          coalesce(d.title, '') || ' ' || coalesce(d.file_name, '') as name,
          case when d.extraction_status = 'ready' then left(coalesce(d.extracted_text, ''), 1000) else '' end as head
        from public.app_documents d
        where d.document_date is not null and coalesce(d.field_origin ->> 'document_date', '') <> 'user') b
      cross join lateral (
        select case when n.ny is not null then n.ny else n.hy end as ys,
          case when n.ny is not null then b.name else b.head end as src
        from (select array_agg(distinct f.y order by f.y) filter (where f.src = 'name') as ny,
            array_agg(distinct f.y order by f.y) filter (where f.src = 'head') as hy
          from (select s.src, x.y, x.mo, x.da
            from (values ('name', b.name), ('head', b.head)) s(src, txt)
            cross join lateral (
              select m[2]::int as y, m[3]::int as mo, m[4]::int as da from regexp_matches(s.txt, '(^|[^0-9])((?:19|20)[0-9]{2})\s*(?:[./-]|년)\s*([0-9]{1,2})\s*(?:[./-]|월)\s*([0-9]{1,2})(?=[^0-9]|$)', 'g') m
              union all select m[2]::int, m[3]::int, m[4]::int from regexp_matches(s.txt, '(^|[^0-9])((?:19|20)[0-9]{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])(?=[^0-9]|$)', 'g') m
              union all select 2000 + m[2]::int, m[3]::int, m[4]::int from regexp_matches(s.txt, '(^|[^0-9])([0-9]{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])(?=[^0-9]|$)', 'g') m
              union all select 2000 + m[2]::int, m[3]::int, m[4]::int from regexp_matches(s.txt, '(^|[^0-9.])([0-9]{2})\.\s*([0-9]{1,2})\.\s*([0-9]{1,2})(?=[^0-9]|$)', 'g') m) x) f
          where f.mo = b.dm and f.da = b.dd and f.y between 2000 and b.uy + 1) n) a) c) k),
t as (select to_regclass('public.app_document_date_fixes') as b),
h as (select count(*) filter (where name='doc_date_year_fix') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261101011500')
select 'fix agrees with history' as item,case
  when h.n=1 and h.named=1 and t.b is not null then case when exists(select 1 from k where k.fix) then '아니오' else '예' end
  when h.n=0 and t.b is null then '예' else '아니오' end as value
  from t,h
union all select 'fix table locked',case when (select b from t) is null or (
  exists(select 1 from pg_class where oid=(select b from t) and relrowsecurity)
  and not exists(select 1 from pg_policy where polrelid=(select b from t))
  and not has_table_privilege('anon',(select b from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated',(select b from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select b from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select b from t),'select,insert,update,references')
  and not has_any_column_privilege('authenticated',(select b from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select b from t) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_documents','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'documents rows',(select count(*) from public.app_documents)::text
union all select 'documents with date',(select count(*) from public.app_documents where document_date is not null)::text
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_documents')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_documents')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_documents') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_documents')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_documents') and not tgisinternal;
