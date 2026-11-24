-- SELECT only. pg_catalog·migration 기록·메모 종류별 개수만 읽는다(메모 글·원문 제목·id는 읽지 않음). Run before dry-run/apply.
-- 적용 전 기대: prerequisite recorded 예 / new migration absent 예 / type check without new kinds 예 / insert policy before change 예 /
--   target tables and columns 예 / feature check function 예 / only known kinds 예. 새 종류 메모 0.
--   원문 표(자료·사업 보고·조직·조직 기록·텔레그램 소식)의 칸·제약·정책·권한·트리거 해시는 사후 확인과 같은 값이어야 한다(이 migration은 원문 표를 바꾸지 않는다).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: type check without new kinds = 예
-- expect: insert policy before change = 예
-- expect: target tables and columns = 예
-- expect: feature check function = 예
-- expect: only known kinds = 예
-- expect: new kind memos = 0
-- expect: target tables columns hash = 기록
-- expect: target tables constraints hash = 기록
-- expect: target tables policies hash = 기록
-- expect: target tables grants hash = 기록
-- expect: target tables triggers hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261125030000' and name='memos')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261125060000') then '예' else '아니오' end
union all select 'type check without new kinds',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_memos')
  and conname='app_memos_target_type_check' and pg_get_constraintdef(oid) ~ '''brief''' and pg_get_constraintdef(oid) !~ '''document''')=1 then '예' else '아니오' end
union all select 'insert policy before change',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_memos') and polname='memos_owner_insert'
  and polcmd='a' and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polwithcheck,polrelid) ~ 'app_notes' and pg_get_expr(polwithcheck,polrelid) !~ 'app_documents')=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_memos'))=4 then '예' else '아니오' end
union all select 'target tables and columns',case when (select count(*) from pg_attribute where attnum>0 and not attisdropped and atttypid='uuid'::regtype and attname='workspace_id'
  and attrelid in (to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_suborganizations'),to_regclass('public.app_feed_items')))=4
  and (select count(*) from pg_attribute where attrelid=to_regclass('public.app_suborganization_updates') and attnum>0 and not attisdropped and attname='organization_id' and atttypid='uuid'::regtype)=1
  and (select count(*) from pg_attribute where attrelid=to_regclass('public.app_feed_items') and attnum>0 and not attisdropped and attname='source')=1 then '예' else '아니오' end
union all select 'feature check function',case when to_regprocedure('private.app_workspace_has_feature(uuid,text)') is not null then '예' else '아니오' end
union all select 'only known kinds',case when not exists(select 1 from public.app_memos where target_type not in ('note','news','outside','reading','brief')) then '예' else '아니오' end
union all select 'new kind memos',(select count(*) from public.app_memos where target_type in ('document','meeting','org_record','telegram'))::text
union all select 'target tables columns hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||format_type(atttypid,atttypmod),',' order by attrelid::regclass::text,attname),''))
  from pg_attribute where attrelid in (to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_feed_items')) and attnum>0 and not attisdropped
union all select 'target tables constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),''))
  from pg_constraint where conrelid in (to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_feed_items'))
union all select 'target tables policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_feed_items'))
union all select 'target tables grants hash',md5(coalesce(string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attacl is not null),''),',' order by c.relname),''))
  from pg_class c where c.oid in (to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_feed_items'))
union all select 'target tables triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_feed_items')) and not tgisinternal;
