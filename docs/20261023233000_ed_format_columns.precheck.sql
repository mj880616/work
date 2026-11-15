-- SELECT only. Aggregates and hashes; no note, record or organization text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite 예 / new migration absent 예 / 세 표가 있고 글자 칸이 text 예 / doc 칸·검사 0 / RLS 세 표 모두 켜짐 예 /
--   anon 표 권한·정책 아니오 / authenticated 표 단위 읽기·넣기·고치기 예 / 노트 표 소유자 정책 하나(notes_owner_all) 예 /
--   담당조직 기록 표 소유자 정책(task12a_owner_all) 예. 그 밖의 개수·해시는 사후 확인과 같은 값이어야 한다(기록만).
-- 프로젝트 기록·담당조직 기록 표는 저장소 migration에 표 정의·길이 제한이 없다(운영에만 있음). 아래 `기록` 항목과 snapshot 파일이 그 운영 값을 읽어 남긴다.
--   프로젝트 기록 표의 정책은 저장소에 없으므로 모양을 요구하지 않고(RLS 켜짐·anon 없음만 요구) 개수·해시를 기록한다.
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: doc column count = 0
-- expect: doc check count = 0
-- expect: anon or public table privilege = 아니오
-- expect: anon or public policy = 아니오
-- expect: recent migrations = 기록
-- expect: notes rows = 기록
-- expect: org updates rows = 기록
-- expect: project records rows = 기록
-- expect: notes text column length limits = 기록
-- expect: org updates text column length limits = 기록
-- expect: project records text column length limits = 기록
-- expect: notes all constraints hash = 기록
-- expect: org updates all constraints hash = 기록
-- expect: project records all constraints hash = 기록
-- expect: notes columns hash = 기록
-- expect: org updates columns hash = 기록
-- expect: project records columns hash = 기록
-- expect: notes policies count = 기록
-- expect: org updates policies count = 기록
-- expect: project records policies count = 기록
-- expect: notes policies hash = 기록
-- expect: org updates policies hash = 기록
-- expect: project records policies hash = 기록
-- expect: notes owner RLS grants hash = 기록
-- expect: org updates owner RLS grants hash = 기록
-- expect: project records owner RLS grants hash = 기록
-- expect: notes column grants hash = 기록
-- expect: org updates column grants hash = 기록
-- expect: project records column grants hash = 기록
-- expect: notes triggers count = 기록
-- expect: org updates triggers count = 기록
-- expect: project records triggers count = 기록
-- expect: notes triggers hash = 기록
-- expect: org updates triggers hash = 기록
-- expect: project records triggers hash = 기록
-- expect: notes indexes hash = 기록
-- expect: org updates indexes hash = 기록
-- expect: project records indexes hash = 기록
with t(label,rel,textcol) as (values
  ('notes',to_regclass('public.app_notes'),'raw_text'),
  ('org updates',to_regclass('public.app_suborganization_updates'),'raw_text'),
  ('project records',to_regclass('public.app_project_progress_updates'),'summary'))
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261023180000' and name='profile_view_prefs')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261023233000') then '예' else '아니오' end
union all select 'three tables exist',case when (select count(*) from t where rel is not null)=3 then '예' else '아니오' end
union all select 'text columns are text',case when (select count(*) from t join pg_attribute a on a.attrelid=t.rel and a.attname=t.textcol and not a.attisdropped and a.atttypid='text'::regtype)=3 then '예' else '아니오' end
union all select 'doc column count',(select count(*) from t join pg_attribute a on a.attrelid=t.rel and a.attname='doc' and not a.attisdropped)::text
union all select 'doc check count',(select count(*) from pg_constraint where connamespace='public'::regnamespace and conname in ('app_notes_doc_check','app_suborganization_updates_doc_check','app_project_progress_updates_doc_check'))::text
union all select 'RLS enabled on all three',case when (select count(*) from t join pg_class c on c.oid=t.rel and c.relrowsecurity)=3 then '예' else '아니오' end
union all select 'anon or public table privilege',case when exists(select 1 from t join pg_class c on c.oid=t.rel where c.relacl::text ~ '(^|[{,])(anon)?=')
  or exists(select 1 from t where has_table_privilege('anon',t.rel,'select') or has_table_privilege('anon',t.rel,'insert') or has_table_privilege('anon',t.rel,'update') or has_table_privilege('anon',t.rel,'delete')) then '예' else '아니오' end
union all select 'anon or public policy',case when exists(select 1 from t join pg_policy p on p.polrelid=t.rel where 0::oid=any(p.polroles) or 'anon'::regrole::oid=any(p.polroles)) then '예' else '아니오' end
union all select 'authenticated can read insert update on all three',case when (select count(*) from t where has_table_privilege('authenticated',t.rel,'select') and has_table_privilege('authenticated',t.rel,'insert') and has_table_privilege('authenticated',t.rel,'update'))=3 then '예' else '아니오' end
union all select 'notes one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_notes'))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_notes' and policyname='notes_owner_all' and permissive='PERMISSIVE' and cmd='ALL' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'org updates owner policy',case when exists(select 1 from pg_policies where schemaname='public' and tablename='app_suborganization_updates' and policyname='task12a_owner_all' and permissive='PERMISSIVE' and cmd='ALL' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r)
union all select 'notes rows',count(*)::text from public.app_notes
union all select 'org updates rows',count(*)::text from public.app_suborganization_updates
union all select 'project records rows',count(*)::text from public.app_project_progress_updates
union all select t.label||' text column length limits',coalesce((select string_agg(c.contype::text||':'||pg_get_constraintdef(c.oid),' / ' order by c.conname) from pg_constraint c where c.conrelid=t.rel and c.contype='c' and pg_get_constraintdef(c.oid) ~ ('(length|char_length|octet_length)[ (]*'||t.textcol)),'none') from t
union all select t.label||' all constraints hash',md5(coalesce((select string_agg(c.conname||':'||pg_get_constraintdef(c.oid),',' order by c.conname) from pg_constraint c where c.conrelid=t.rel and c.conname not in ('app_notes_doc_check','app_suborganization_updates_doc_check','app_project_progress_updates_doc_check')),'')) from t
union all select t.label||' columns hash',md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=t.rel and a.attnum>0 and not a.attisdropped and a.attname<>'doc'),'')) from t
union all select t.label||' policies count',(select count(*) from pg_policy where polrelid=t.rel)::text from t
union all select t.label||' policies hash',md5(coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=t.rel),'')) from t
union all select t.label||' owner RLS grants hash',md5(coalesce((select c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=t.rel),'')) from t
union all select t.label||' column grants hash',md5(coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=t.rel and a.attnum>0 and not a.attisdropped and a.attname<>'doc'),'')) from t
union all select t.label||' triggers count',(select count(*) from pg_trigger g where g.tgrelid=t.rel and not g.tgisinternal)::text from t
union all select t.label||' triggers hash',md5(coalesce((select string_agg(g.tgname||':'||g.tgenabled::text||':'||pg_get_triggerdef(g.oid),',' order by g.tgname) from pg_trigger g where g.tgrelid=t.rel and not g.tgisinternal),'')) from t
union all select t.label||' indexes hash',md5(coalesce((select string_agg(ic.relname||':'||pg_get_indexdef(x.indexrelid),',' order by ic.relname) from pg_index x join pg_class ic on ic.oid=x.indexrelid where x.indrelid=t.rel),'')) from t;
