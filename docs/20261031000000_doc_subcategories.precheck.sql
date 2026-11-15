-- SELECT only. Aggregates and hashes; no profile text or document titles. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: 앞 단계 기록 예 / 이번 기록 없음 예 / 새 함수 없음 예 / 소분류('›') 없음 예 / '주간보고'가 따로 있는 합칠 프로필 0 / RLS 예 / 정책 수 예.
-- 합칠 프로필 수·옮길 자료 수는 기록만 하고, 사후 확인의 '옮긴 자료 수'와 같아야 한다(건수 전후 같음).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: new functions absent = 예
-- expect: no subcategory yet = 예
-- expect: merge profiles with separate parent = 0
-- expect: RLS enabled = 예
-- expect: policy counts = 예
-- expect: merge profiles = 기록
-- expect: weekly documents to move = 기록
-- expect: profiles rows = 기록
-- expect: documents rows = 기록
-- expect: owner RLS grants hash = 기록
-- expect: policies hash = 기록
-- expect: constraints hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261018112943' and name='doc_categories_profile')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261031000000') then '예' else '아니오' end
union all select 'new functions absent',case when not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('app_document_subcategory_delete','app_document_category_rename_group','app_document_category_delete_group')) then '예' else '아니오' end
union all select 'no subcategory yet',case when not exists(select 1 from public.app_profiles p,unnest(p.document_categories) c where strpos(c,'›')>0) and not exists(select 1 from public.app_documents where strpos(category,'›')>0) then '예' else '아니오' end
union all select 'merge profiles with separate parent',count(*)::text from public.app_profiles where document_categories && array['주간보고 확정본','주간보고 개인본']::text[] and '주간보고'=any(document_categories)
union all select 'merge profiles',count(*)::text from public.app_profiles where document_categories && array['주간보고 확정본','주간보고 개인본']::text[]
union all select 'weekly documents to move',count(*)::text from public.app_documents d where d.category in ('주간보고 확정본','주간보고 개인본')
  and exists(select 1 from public.app_workspace_members m join public.app_profiles p on p.user_id=m.user_id where m.workspace_id=d.workspace_id and m.role='owner' and d.category=any(p.document_categories))
union all select 'RLS enabled',case when (select count(*) from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_documents')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'policy counts',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2 and (select count(*) from pg_policy where polrelid=to_regclass('public.app_documents'))>=1 then '예' else '아니오' end
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),'')) from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_documents'))
union all select 'policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),'')) from pg_policy where polrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_documents'))
union all select 'constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),'')) from pg_constraint where conrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_documents'))
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'documents rows',count(*)::text from public.app_documents;
