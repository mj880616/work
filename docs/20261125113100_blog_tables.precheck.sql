-- SELECT only. Aggregates and hashes; no blog, note or page title, text or key value. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: 아래 예 6개, blog rows 0. 그 밖의 해시·개수는 사후 확인과 같은 값이어야 한다
-- (기록만: 공유 페이지·노트·운영자 표의 칸·정책·권한·트리거는 바뀌지 않는다 — 운영자 표 검사 제약 하나만 'blog'를 더해 다시 만든다).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: new tables absent = 예
-- expect: feature check with nojo_words without blog = 예
-- expect: single calls workspace = 예
-- expect: owner and feature functions = 예
-- expect: blog rows = 0
-- expect: share pages rows = 기록
-- expect: existing tables columns hash = 기록
-- expect: existing tables policies hash = 기록
-- expect: existing tables grants hash = 기록
-- expect: existing tables triggers hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where (version='20261121090000' and name='nojo_words_feature') or (version='20261027050000' and name='trash_share_pages_db'))=2 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261125113100') then '예' else '아니오' end
union all select 'new tables absent',case when to_regclass('public.app_blogs') is null and to_regclass('public.app_blog_boards') is null and to_regclass('public.app_blog_posts') is null then '예' else '아니오' end
union all select 'feature check with nojo_words without blog',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_operator_features')
  and conname='app_operator_features_feature_check' and pg_get_constraintdef(oid) ~ '''nojo_words''' and pg_get_constraintdef(oid) !~ '''blog''')=1 then '예' else '아니오' end
union all select 'single calls workspace',case when (select count(*) from public.app_operator_features where feature='calls')=1 then '예' else '아니오' end
union all select 'owner and feature functions',case when (select count(*) from pg_proc where prosecdef and oid in (to_regprocedure('private.app_is_workspace_owner(uuid)'),to_regprocedure('private.app_workspace_has_feature(uuid,text)')))=2
  and to_regprocedure('public.app_operator_feature_workspace(text)') is not null then '예' else '아니오' end
union all select 'blog rows',(select count(*) from public.app_operator_features where feature::text='blog')::text
union all select 'share pages rows',count(*)::text from public.app_share_pages
union all select 'existing tables columns hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||format_type(atttypid,atttypmod),',' order by attrelid::regclass::text,attname),''))
  from pg_attribute where attrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features')) and attnum>0 and not attisdropped
union all select 'existing tables policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features'))
union all select 'existing tables grants hash',md5(coalesce(string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attacl is not null),''),',' order by c.relname),''))
  from pg_class c where c.oid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features'))
union all select 'existing tables triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features')) and not tgisinternal;
