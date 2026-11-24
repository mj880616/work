-- SELECT only. Aggregates and hashes; no note title, comment text or id. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite recorded 예 / new migration absent 예 / new table absent 예 / note columns present 예 / comment columns present 예 / RLS on existing tables 예 / owner check function 예.
--   그 밖의 개수·해시는 사후 확인과 같은 값이어야 한다(기록만: 노트·노트 댓글 표의 칸·제약·정책·권한·트리거·줄 수는 바뀌지 않는다).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: new table absent = 예
-- expect: note columns present = 예
-- expect: comment columns present = 예
-- expect: RLS on existing tables = 예
-- expect: owner check function = 예
-- expect: note comments rows = 기록
-- expect: existing tables columns hash = 기록
-- expect: existing tables constraints hash = 기록
-- expect: existing tables policies hash = 기록
-- expect: existing tables grants hash = 기록
-- expect: existing tables triggers hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261102203000' and name='note_comments')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261125020000') then '예' else '아니오' end
union all select 'new table absent',case when to_regclass('public.app_memos') is null then '예' else '아니오' end
union all select 'note columns present',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_notes') and attnum>0 and not attisdropped
  and attname in ('id','workspace_id','kind','title'))=4 then '예' else '아니오' end
union all select 'comment columns present',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_note_comments') and attnum>0 and not attisdropped
  and attname in ('id','workspace_id','note_id','kind','quote','body','created_at'))=7 then '예' else '아니오' end
union all select 'RLS on existing tables',case when (select count(*) from pg_class where oid in (to_regclass('public.app_notes'),to_regclass('public.app_note_comments')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'note comments rows',count(*)::text from public.app_note_comments
union all select 'existing tables columns hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||format_type(atttypid,atttypmod),',' order by attrelid::regclass::text,attname),''))
  from pg_attribute where attrelid in (to_regclass('public.app_notes'),to_regclass('public.app_note_comments')) and attnum>0 and not attisdropped
union all select 'existing tables constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),''))
  from pg_constraint where conrelid in (to_regclass('public.app_notes'),to_regclass('public.app_note_comments'))
union all select 'existing tables policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_notes'),to_regclass('public.app_note_comments'))
union all select 'existing tables grants hash',md5(coalesce(string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attacl is not null),''),',' order by c.relname),''))
  from pg_class c where c.oid in (to_regclass('public.app_notes'),to_regclass('public.app_note_comments'))
union all select 'existing tables triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_notes'),to_regclass('public.app_note_comments')) and not tgisinternal;
