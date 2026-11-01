-- SELECT only. Works after apply (record and fix table present, no failure notice left) and after rollback/dry-run (no record, no fix table).
-- No summary, title or id is shown: only yes/no, counts and hashes. The fix table is only named through to_regclass (this file also runs after the rollback).
-- The count/hash items must equal the precheck values of the same name (only summary_ko/key_sentences of the chosen rows change; no grant, policy, trigger or constraint change; no row added or removed).
with k as (select p.id from public.app_outside_posts p
  where p.summary_ko is not null
    and (regexp_replace(p.summary_ko, '\s+', ' ', 'g') ~ '요약할\s*수\s*(가\s*)?없|요약(이|은)?\s*(불가|어려)|(본문|원문|기사\s*본문|글\s*본문|기사|글의?\s*내용|본문\s*내용)(이|은|을|가)?\s*(제공되지\s*않|없(어|음|으므로|는|습)|비어\s*있|확인(할|되)\s*수\s*없|확인되지\s*않|포함되(어\s*있)?지\s*않)|제목만(으로는|\s*있|\s*제공)|(요약할|정리할)\s*(내용|재료|정보)(이|가)?\s*(없|부족)'
      or regexp_replace(p.summary_ko, '\s+', ' ', 'g') ~* '\y(cannot|can''t|unable to)\s+(be\s+)?summari[sz]|\yno\s+(article\s+)?(body|content|text)\s+(was\s+|is\s+)?(provided|available)')),
t as (select to_regclass('public.app_outside_summary_fixes') as b),
h as (select count(*) filter (where name='outside_summary_fail_clear') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261101210000')
select 'clear agrees with history' as item,case
  when h.n=1 and h.named=1 and t.b is not null then case when exists(select 1 from k) then '아니오' else '예' end
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
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_outside_posts') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_outside_posts','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_outside_posts') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'posts rows',(select count(*) from public.app_outside_posts)::text
union all select 'sentences rows',(select count(*) from public.app_outside_sentences)::text
union all select 'other columns hash',md5(coalesce(string_agg(id::text||':'||workspace_id::text||':'||source_key||':'||kind||':'||lang||':'||title||':'||coalesce(title_ko,'')||':'||coalesce(author,'')||':'||url||':'||coalesce(published_at::text,'')||':'||fetched_at::text||':'||has_body::text,',' order by id),'')) from public.app_outside_posts
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_outside_posts')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_outside_posts')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_outside_posts') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_outside_posts')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_outside_posts') and not tgisinternal;
