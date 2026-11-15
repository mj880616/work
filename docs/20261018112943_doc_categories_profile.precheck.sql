-- SELECT only. Aggregates and hashes; no profile or document text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite 예 / new migration absent 예 / abandoned version absent 예 / new column 0 / new functions 0 /
--   RLS 예 / anon 아니오 / authenticated can update profiles 예 / owner policies 예 / owner check function 예 / owner profile row 예 /
--   owner can update own profile row 예 / documents category column 예 / authenticated can update documents 예.
-- "owner can update own profile row"는 기존 RLS 식(private.app_is_owner_profile(user_id))을 소유자 본인 행에 그대로 대입한 결과다.
-- 이 값이 아니오이면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261018032038' and name='doc_organization_link')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261018112943') then '예' else '아니오' end
union all select 'abandoned version absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261018023753') then '예' else '아니오' end
union all select 'new column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_profiles') and attname='document_categories' and not attisdropped
union all select 'new functions count',count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname in('app_document_category_add','app_document_category_rename','app_document_category_delete')
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'authenticated can update profiles',case when has_table_privilege('authenticated','public.app_profiles','UPDATE') then '예' else '아니오' end
union all select 'owner policies only (current shape)',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_owner_all' and permissive='PERMISSIVE' and cmd='ALL' and roles=array['authenticated']::name[]
    and regexp_replace(qual,'[\s()]','','g')='private.app_is_owner_profileuser_id' and regexp_replace(with_check,'[\s()]','','g')='private.app_is_owner_profileuser_id')
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_profile_self_select' and permissive='PERMISSIVE' and cmd='SELECT' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'owner check function (task12a body)',case when (select count(*) from pg_proc where pronamespace='private'::regnamespace and proname='app_is_owner_profile' and prosecdef
  and regexp_replace(prosrc,'\s','','g')='selectexists(select1frompublic.app_workspace_memberssubjectjoinpublic.app_workspace_membersowneronowner.workspace_id=subject.workspace_idandowner.role=''owner''andowner.user_id=(selectauth.uid())wheresubject.user_id=p_user)')=1 then '예' else '아니오' end
union all select 'owner profile row exists',case when exists(select 1 from public.app_profiles p join public.app_workspace_members m on m.user_id=p.user_id and m.role='owner') then '예' else '아니오' end
-- The same predicate the RLS policy evaluates (auth.uid() = owner) applied to the owner's own row: USING and WITH CHECK are identical.
union all select 'owner can update own profile row',case when exists(select 1 from public.app_profiles p join public.app_workspace_members m on m.user_id=p.user_id and m.role='owner'
  where exists(select 1 from public.app_workspace_members subject join public.app_workspace_members owner on owner.workspace_id=subject.workspace_id and owner.role='owner' and owner.user_id=m.user_id where subject.user_id=p.user_id)) then '예' else '아니오' end
union all select 'documents category column',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_documents') and attname='category' and atttypid='text'::regtype and not attisdropped) then '예' else '아니오' end
union all select 'authenticated can update documents',case when has_table_privilege('authenticated','public.app_documents','UPDATE') then '예' else '아니오' end
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'profiles full-row hash',md5(coalesce(string_agg(to_jsonb(p)::text,E'\n' order by p.user_id),'')) from public.app_profiles p
union all select 'documents category hash',md5(coalesce(string_agg(d.id::text||':'||coalesce(d.category,''),E'\n' order by d.id),'')) from public.app_documents d
union all select 'columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attnum),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.app_profiles') and a.attnum>0 and not a.attisdropped
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_profiles')
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_profiles'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal;
