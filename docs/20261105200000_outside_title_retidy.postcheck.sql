-- SELECT only. Works after apply (record and fix table present, every fixed post has its new title, no lead kind tag left)
-- and after rollback/dry-run (no record, no fix table). No title or id is shown: only yes/no, counts and hashes.
-- The fix table is only named through to_regclass (this file also runs after the rollback).
-- The count/hash items must equal the precheck values of the same name (only title of the chosen rows changes; no grant, policy, trigger or constraint change; no row added or removed).
with n(source_key, name) as (values ('kctu', '민주노총'), ('kptu', '공공운수노조'), ('kmwu', '금속노조'), ('kfsu', '서비스연맹'), ('hakbi', '학비노조'),
  ('laborparty', '노동당'), ('kgreens', '녹색당'), ('jinboparty', '진보당'), ('justice', '정의당'),
  ('pssp', '사회진보연대'), ('ws', '노동자연대'), ('platformc', '플랫폼C'), ('leftall', '전국결집'),
  ('socialism', '사회주의를향한전진'), ('socialist', '사회주의자'),
  ('jacobin', 'Jacobin'), ('labornotes', 'Labor Notes'), ('redpepper', 'Red Pepper'), ('socialistworker', 'Socialist Worker')),
x as (select (regexp_match(p.title, '^\s*[[<(【〈「《（]\s*([^]>)】〉」》）]{1,30})\s*[]>)】〉」》）]\s*'))[1] as tag_in, regexp_replace(p.title, '^\s*[[<(【〈「《（]\s*([^]>)】〉」》）]{1,30})\s*[]>)】〉」》）]\s*', '') as rest,
         regexp_replace(coalesce(n.name, ''), '\s', '', 'g') as nflat
  from public.app_outside_posts p left join n on n.source_key = p.source_key where p.title <> '제목 없음 · 원문 링크'),
tagged as (select 1 from x where x.tag_in is not null and char_length(x.rest) > 1
  and (regexp_replace(x.tag_in, '\s', '', 'g') ~ '(성명|논평|보도자료|기자회견|입장|브리핑|발언|논설|칼럼|규탄|공동성명|결의문|호소문|선언)'
       or (x.nflat <> '' and position(x.nflat in regexp_replace(x.tag_in, '\s', '', 'g')) > 0)
       or btrim(x.tag_in) ~ '^(20\d{2}\s*[-./년]\s*)?\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?\s*\.?(\s*\([월화수목금토일]\))?$')),
t as (select to_regclass('public.app_outside_title_fixes') as b),
h as (select count(*) filter (where name='outside_title_retidy') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261105200000')
select 'retidy agrees with history' as item,case
  when h.n=1 and h.named=1 and t.b is not null then case when exists(select 1 from tagged) then '아니오' else '예' end
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
union all select 'columns except title hash',md5(coalesce(string_agg(id::text||':'||workspace_id::text||':'||source_key||':'||kind||':'||lang||':'||coalesce(title_ko,'')||':'||coalesce(author,'')||':'||url||':'||coalesce(published_at::text,'')||':'||fetched_at::text||':'||coalesce(summary_ko,'')||':'||key_sentences::text||':'||has_body::text,',' order by id),'')) from public.app_outside_posts
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_outside_posts')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_outside_posts')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_outside_posts') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_outside_posts')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_outside_posts') and not tgisinternal;
