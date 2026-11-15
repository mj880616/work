-- SELECT only. Aggregates and hashes; no record text. Run before apply (SQL Editor, 폰 경로 C) and keep the result capture.
-- 적용 전 기대: 앞선 기록 예 / 이번 기록 없음 예 / 표 있음 예 / RLS 켜짐·force 꺼짐 예 / anon·PUBLIC 표 권한 아니오 /
--   표 권한은 소유자·authenticated·service_role·RLS 우회 역할만 예 / 정책 4개, 그중 PUBLIC 하나만 대상인 정책 4개, authenticated 대상 0개 /
--   anon 대상 정책 아니오. 조건식 해시(역할 제외)와 그 밖의 해시는 사후 확인의 같은 이름 항목과 같아야 한다(대상 역할만 바뀜).
-- 이 표의 정책은 저장소 migration에 정의가 없다(운영에만 있음). 정의 원문은 짝 snapshot 파일이 카탈로그에서 읽어 남긴다.
-- expect: anon or public table privilege = 아니오
-- expect: anon policy = 아니오
-- expect: policies count = 4
-- expect: public-only policies count = 4
-- expect: authenticated-only policies count = 0
-- expect: recent migrations = 기록
-- expect: rows = 기록
-- expect: policy conditions hash = 기록
-- expect: policy names hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: columns hash = 기록
-- expect: constraints hash = 기록
-- expect: triggers hash = 기록
-- expect: indexes hash = 기록
with t(rel) as (values (to_regclass('public.app_project_progress_updates')))
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261023180000' and name='profile_view_prefs')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261023232000') then '예' else '아니오' end
union all select 'table exists',case when (select rel from t) is not null then '예' else '아니오' end
union all select 'RLS enabled and not forced',case when exists(select 1 from t join pg_class c on c.oid=t.rel and c.relrowsecurity and not c.relforcerowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when exists(select 1 from t join pg_class c on c.oid=t.rel where c.relacl::text ~ '(^|[{,])(anon)?=')
  or exists(select 1 from t where has_table_privilege('anon',t.rel,'select') or has_table_privilege('anon',t.rel,'insert') or has_table_privilege('anon',t.rel,'update') or has_table_privilege('anon',t.rel,'delete')) then '예' else '아니오' end
union all select 'table grants only owner authenticated service_role or bypass roles',case when not exists(select 1 from t join pg_class c on c.oid=t.rel cross join lateral aclexplode(c.relacl) x left join pg_roles r on r.oid=x.grantee
  where x.grantee<>c.relowner and x.grantee not in ('authenticated'::regrole::oid,'service_role'::regrole::oid) and not coalesce(r.rolbypassrls or r.rolsuper,false)) then '예' else '아니오' end
union all select 'policies count',(select count(*) from t join pg_policy p on p.polrelid=t.rel)::text
union all select 'public-only policies count',(select count(*) from t join pg_policy p on p.polrelid=t.rel and p.polroles=array[0::oid])::text
union all select 'authenticated-only policies count',(select count(*) from t join pg_policy p on p.polrelid=t.rel and p.polroles=array['authenticated'::regrole::oid])::text
union all select 'anon policy',case when exists(select 1 from t join pg_policy p on p.polrelid=t.rel where 'anon'::regrole::oid=any(p.polroles)) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r)
union all select 'rows',(select count(*) from public.app_project_progress_updates)::text
union all select 'policy conditions hash',md5(coalesce((select string_agg(p.polname::text||':'||p.polcmd::text||':'||p.polpermissive::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from t join pg_policy p on p.polrelid=t.rel),''))
union all select 'policy names hash',md5(coalesce((select string_agg(p.polname::text,',' order by p.polname) from t join pg_policy p on p.polrelid=t.rel),''))
union all select 'owner RLS grants hash',md5(coalesce((select c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') from t join pg_class c on c.oid=t.rel),''))
union all select 'column grants hash',md5(coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from t join pg_attribute a on a.attrelid=t.rel and a.attnum>0 and not a.attisdropped),''))
union all select 'columns hash',md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,',' order by a.attname) from t join pg_attribute a on a.attrelid=t.rel and a.attnum>0 and not a.attisdropped),''))
union all select 'constraints hash',md5(coalesce((select string_agg(c.conname||':'||pg_get_constraintdef(c.oid),',' order by c.conname) from t join pg_constraint c on c.conrelid=t.rel),''))
union all select 'triggers hash',md5(coalesce((select string_agg(g.tgname||':'||g.tgenabled::text||':'||pg_get_triggerdef(g.oid),',' order by g.tgname) from t join pg_trigger g on g.tgrelid=t.rel and not g.tgisinternal),''))
union all select 'indexes hash',md5(coalesce((select string_agg(ic.relname||':'||pg_get_indexdef(x.indexrelid),',' order by ic.relname) from t join pg_index x on x.indrelid=t.rel join pg_class ic on ic.oid=x.indexrelid),''));
