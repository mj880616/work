-- SELECT only. pg_catalog·migration 기록·메모 종류별 개수만 읽는다(메모 글·원문 제목·id는 읽지 않음). Run before dry-run/apply.
-- 적용 전 기대: prerequisite recorded 예 / new migration absent 예 / type check without record_link 예 / insert policy before change 예 /
--   link table and columns 예 / only known kinds 예. record_link 메모 0.
--   연결 표(app_record_links)의 칸·제약·정책·권한·트리거 해시는 사후 확인과 같은 값이어야 한다(이 migration은 연결 표를 바꾸지 않는다).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: type check without record_link = 예
-- expect: insert policy before change = 예
-- expect: link table and columns = 예
-- expect: only known kinds = 예
-- expect: record_link memos = 0
-- expect: link table columns hash = 기록
-- expect: link table constraints hash = 기록
-- expect: link table policies hash = 기록
-- expect: link table grants hash = 기록
-- expect: link table triggers hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261125060000' and name='memos_more_targets')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261127030000') then '예' else '아니오' end
union all select 'type check without record_link',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_memos')
  and conname='app_memos_target_type_check' and pg_get_constraintdef(oid) ~ '''telegram''' and pg_get_constraintdef(oid) !~ '''record_link''')=1 then '예' else '아니오' end
union all select 'insert policy before change',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_memos') and polname='memos_owner_insert'
  and polcmd='a' and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polwithcheck,polrelid) ~ 'app_feed_items' and pg_get_expr(polwithcheck,polrelid) !~ 'app_record_links')=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_memos'))=4 then '예' else '아니오' end
union all select 'link table and columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_record_links') and attnum>0 and not attisdropped
  and ((attname='workspace_id' and atttypid='uuid'::regtype) or (attname='id' and atttypid='uuid'::regtype) or attname='status'))=3 then '예' else '아니오' end
union all select 'only known kinds',case when not exists(select 1 from public.app_memos where target_type not in ('note','news','outside','reading','brief','document','meeting','org_record','telegram')) then '예' else '아니오' end
union all select 'record_link memos',(select count(*) from public.app_memos where target_type='record_link')::text
union all select 'link table columns hash',md5(coalesce(string_agg(attname||':'||format_type(atttypid,atttypmod),',' order by attname),''))
  from pg_attribute where attrelid=to_regclass('public.app_record_links') and attnum>0 and not attisdropped
union all select 'link table constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_record_links')
union all select 'link table policies hash',md5(coalesce(string_agg(polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_record_links')
union all select 'link table grants hash',md5(coalesce(string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attacl is not null),''),',' order by c.relname),''))
  from pg_class c where c.oid=to_regclass('public.app_record_links')
union all select 'link table triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_record_links') and not tgisinternal;
