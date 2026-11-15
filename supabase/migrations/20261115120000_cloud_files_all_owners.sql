begin;
-- S62-11 MULTI-구글드라이브사진모두 ①(설계: docs/design/gdrive-photos-all.md 2-2절 ① DB·4절 B1, 명진 결정 11/14 22:18·11/15 09:19).
-- [파일] 색인·별표·작업표 읽기를 '그 작업공간 owner 그리고 운영자 기능 files 허용'에서 '그 작업공간 owner'로 바꾼다(각자 자기 작업공간만).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(시험 적용 먼저)으로만 한다. 이 브랜치는 적용 직전 정지.
-- 순서: 이 DB 적용이 먼저, Edge cloud-files 배포가 다음(거꾸로면 Edge는 통과해도 목록이 비어 보임 — 보안 문제는 없음), 메뉴 화면이 마지막.
--
-- 무엇:
--  1) 읽기 정책 3개(cloud_items_owner_read·cloud_stars_owner_read·cloud_jobs_owner_read)를 같은 이름·같은 표·같은 명령(select)·같은 대상(authenticated)으로
--     다시 만들며 조건에서 `and private.app_workspace_has_feature(workspace_id, 'files')`만 뺀다. owner 조건(private.app_is_workspace_owner)은 그대로.
--  2) public.app_cloud_find_in(text[], text, text, integer)를 같은 서명·같은 답 모양·SECURITY DEFINER·search_path ''로 다시 정의하며
--     처음 주인 검사에서 files 허용 줄만 뺀다(로그인한 본인이 owner인 작업공간 정확히 하나 + owner 검사는 그대로, 화면이 보낸 작업공간 값은 받지 않음).
--     app_cloud_list·app_cloud_trail·app_cloud_find는 SECURITY INVOKER라 1)의 정책을 그대로 따른다(바꾸지 않음).
-- 권한: anon·PUBLIC 권한 없음, RLS 켬 그대로, 표 권한·쓰기(service_role만) 그대로, 함수 실행은 authenticated만 그대로.
--   넓어지는 범위는 '운영자 기능 키가 없는 작업공간 owner가 자기 작업공간 줄을 읽는 것'뿐이다(다른 작업공간 줄은 계속 0줄).
-- 안 하는 것: app_operator_features의 files·gdrive_photos 행은 지우지 않는다(되돌리기 쉽게). 표·칸·색인·자료 행·rtw_* 변경 없음.
-- 짝: docs/20261115120000_cloud_files_all_owners.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115120000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261102160000' and name = 'cloud_files_index') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261104120000' and name = 'cloud_find_sources') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261104162800' and name = 'cloud_jobs') <> 1
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)')
           and prosecdef and strpos(pg_get_functiondef(oid), 'app_workspace_has_feature(v_ws, ''files'')') > 0) <> 1
     or exists (select 1 from pg_class where oid in ('public.app_cloud_items'::regclass, 'public.app_cloud_stars'::regclass, 'public.app_cloud_jobs'::regclass)
                and not relrowsecurity)
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_items'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_stars'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_jobs'::regclass) <> 1
     or (select count(*) from pg_policy p
          where (p.polrelid, p.polname) in (('public.app_cloud_items'::regclass, 'cloud_items_owner_read'),
                                            ('public.app_cloud_stars'::regclass, 'cloud_stars_owner_read'),
                                            ('public.app_cloud_jobs'::regclass, 'cloud_jobs_owner_read'))
            and p.polcmd = 'r' and p.polpermissive and p.polwithcheck is null
            and p.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]
            and strpos(pg_get_expr(p.polqual, p.polrelid), 'app_is_workspace_owner(workspace_id)') > 0
            and strpos(pg_get_expr(p.polqual, p.polrelid), 'app_workspace_has_feature(workspace_id, ''files''') > 0) <> 3 then
    raise exception 'CLOUD_FILES_ALL_OWNERS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 읽기 정책: 같은 이름·같은 표·select·authenticated, 조건은 owner만.
drop policy cloud_items_owner_read on public.app_cloud_items;
create policy cloud_items_owner_read on public.app_cloud_items for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
drop policy cloud_stars_owner_read on public.app_cloud_stars;
create policy cloud_stars_owner_read on public.app_cloud_stars for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
drop policy cloud_jobs_owner_read on public.app_cloud_jobs;
create policy cloud_jobs_owner_read on public.app_cloud_jobs for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 2) 찾기·묶음 함수: 본문은 20261104120000 원문 그대로, 주인 검사에서 files 허용 줄만 뺀다.
-- 찾기·묶음(켜진 출처만). 답 모양은 app_cloud_find와 같다.
create or replace function public.app_cloud_find_in(p_sources text[], p_query text, p_shelf text, p_limit integer)
returns table (source text, item_id text, parent_id text, name text, is_folder boolean, mime text, size_bytes bigint,
  modified_at timestamptz, hash text, starred boolean, library_doc_id uuid, match_in text, folder_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := pg_catalog.btrim(coalesce(p_query, ''), ' ');
  v_words text[];
  v_pats text[];
  v_limit integer := coalesce(p_limit, 100);
  v_src text[];
  v_ws uuid;
  v_owners integer;
  v_hs text[];
  v_hi text[];
begin
  if p_sources is null or pg_catalog.cardinality(p_sources) > 2
     or exists (select 1 from pg_catalog.unnest(p_sources) x(s) where x.s is null or x.s not in ('od', 'gd')) then
    raise exception using errcode = '22023', message = 'CLOUD_FIND_BAD_SOURCES';
  end if;
  if pg_catalog.char_length(coalesce(p_query, '')) > 200 or coalesce(p_query, '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'CLOUD_FIND_BAD_QUERY';
  end if;
  if v_limit < 1 or v_limit > 300 then
    raise exception using errcode = '22023', message = 'CLOUD_FIND_BAD_LIMIT';
  end if;
  if v_query = '' then
    if p_shelf is null or p_shelf not in ('recent', 'big', 'starred') then
      raise exception using errcode = '22023', message = 'CLOUD_FIND_BAD_SHELF';
    end if;
  else
    if p_shelf is not null then
      raise exception using errcode = '22023', message = 'CLOUD_FIND_BAD_SHELF';
    end if;
    select coalesce(pg_catalog.array_agg(x.w order by x.o), '{}') into v_words
      from (select w, pg_catalog.min(o) as o
              from pg_catalog.unnest(pg_catalog.regexp_split_to_array(v_query, ' +')) with ordinality as t(w, o)
             where w <> '' group by w) x;
    if pg_catalog.cardinality(v_words) > 6
       or exists (select 1 from pg_catalog.unnest(v_words) w where pg_catalog.char_length(w) > 100) then
      raise exception using errcode = '22023', message = 'CLOUD_FIND_TOO_MANY_WORDS';
    end if;
    -- ILIKE 특수문자(\ % _)는 글자 그대로 찾는다.
    select pg_catalog.array_agg('%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(x.w, '\', '\\'), '%', '\%'), '_', '\_') || '%'
             order by x.o)
      into v_pats
      from pg_catalog.unnest(v_words) with ordinality as x(w, o);
  end if;

  -- 주인 검사는 여기서 한 번: 로그인한 본인이 owner인 작업공간이 정확히 하나이고, owner 검사를 지나야 한다. 아니면 0줄.
  select pg_catalog.min(m.workspace_id::text)::uuid, pg_catalog.count(*) into v_ws, v_owners
    from public.app_workspace_members m
   where m.user_id = (select auth.uid()) and m.role = 'owner';
  if v_owners <> 1 or v_ws is null or not private.app_is_workspace_owner(v_ws) then
    return;
  end if;
  select coalesce(pg_catalog.array_agg(distinct x.s), '{}') into v_src from pg_catalog.unnest(p_sources) x(s);
  if pg_catalog.cardinality(v_src) = 0 then
    return;
  end if;

  -- 고른 줄(출처, id)을 순서대로 v_hs·v_hi에 담는다. 묶음은 출처마다 색인 순서로 v_limit줄만 읽는다.
  if v_query <> '' then
    select pg_catalog.array_agg(h.source order by h.o), pg_catalog.array_agg(h.item_id order by h.o) into v_hs, v_hi
      from (select i.source, i.item_id,
                   pg_catalog.row_number() over (order by case when i.name ilike all (v_pats) then 0 else 1 end,
                     i.modified_at desc nulls last, i.item_id, i.source) as o
              from public.app_cloud_items i
              left join lateral (
                select d.extraction_status, d.extracted_text from public.app_documents d
                 where i.source = 'gd' and not i.is_folder and d.workspace_id = i.workspace_id and d.file_id = i.item_id
                 order by d.id limit 1) doc on true
             where i.workspace_id = v_ws and i.source = any (v_src) and not i.trashed
               and pg_catalog.concat_ws(' ', i.name, case when doc.extraction_status = 'ready' then doc.extracted_text end) ilike all (v_pats)) h
     where h.o <= v_limit;
  elsif p_shelf = 'recent' then
    select pg_catalog.array_agg(h.source order by h.o), pg_catalog.array_agg(h.item_id order by h.o) into v_hs, v_hi
      from (select r.source, r.item_id,
                   pg_catalog.row_number() over (order by r.modified_at desc nulls last, r.item_id, r.source) as o
              from pg_catalog.unnest(v_src) as s(src)
              cross join lateral (
                select i.source, i.item_id, i.modified_at from public.app_cloud_items i
                 where i.workspace_id = v_ws and i.source = s.src and not i.is_folder and not i.trashed
                 order by i.modified_at desc nulls last, i.item_id
                 limit v_limit) r) h
     where h.o <= v_limit;
  elsif p_shelf = 'big' then
    select pg_catalog.array_agg(h.source order by h.o), pg_catalog.array_agg(h.item_id order by h.o) into v_hs, v_hi
      from (select r.source, r.item_id,
                   pg_catalog.row_number() over (order by r.size_bytes desc nulls last, r.modified_at desc nulls last, r.item_id, r.source) as o
              from pg_catalog.unnest(v_src) as s(src)
              cross join lateral (
                select i.source, i.item_id, i.size_bytes, i.modified_at from public.app_cloud_items i
                 where i.workspace_id = v_ws and i.source = s.src and not i.is_folder and not i.trashed
                 order by i.size_bytes desc nulls last, i.modified_at desc nulls last, i.item_id
                 limit v_limit) r) h
     where h.o <= v_limit;
  else
    select pg_catalog.array_agg(h.source order by h.o), pg_catalog.array_agg(h.item_id order by h.o) into v_hs, v_hi
      from (select i.source, i.item_id,
                   pg_catalog.row_number() over (order by i.modified_at desc nulls last, i.item_id, i.source) as o
              from public.app_cloud_stars st
              join public.app_cloud_items i on i.workspace_id = st.workspace_id and i.source = st.source and i.item_id = st.item_id
             where st.workspace_id = v_ws and st.source = any (v_src) and not i.trashed) h
     where h.o <= v_limit;
  end if;

  return query
  with recursive hits as (
    select i.workspace_id, i.source, i.item_id, i.parent_id, i.name, i.is_folder, i.mime, i.size_bytes, i.modified_at, i.hash, k.o,
      exists (select 1 from public.app_cloud_stars s
        where s.workspace_id = i.workspace_id and s.source = i.source and s.item_id = i.item_id) as starred,
      (select d.id from public.app_documents d
        where i.source = 'gd' and not i.is_folder and d.workspace_id = i.workspace_id and d.file_id = i.item_id
        order by d.id limit 1) as library_doc_id,
      case when v_query = '' then null::text when i.name ilike all (v_pats) then 'name' else 'text' end as match_in
    from rows from (pg_catalog.unnest(v_hs), pg_catalog.unnest(v_hi)) with ordinality as k(src, id, o)
    join public.app_cloud_items i on i.workspace_id = v_ws and i.source = k.src and i.item_id = k.id
  ),
  up as (
    select h.workspace_id, h.source, h.item_id as hit_id, h.parent_id as cur, 0 as depth, ''::text as path
      from hits h
    union all
    select u.workspace_id, u.source, u.hit_id, f.parent_id, u.depth + 1,
      case when u.path = '' then f.name else f.name || ' › ' || u.path end
      from up u join public.app_cloud_items f
        on f.workspace_id = u.workspace_id and f.source = u.source and f.item_id = u.cur
     where u.cur is not null and u.depth < 40
  ),
  paths as (
    select distinct on (u.workspace_id, u.source, u.hit_id) u.workspace_id, u.source, u.hit_id, u.path
      from up u order by u.workspace_id, u.source, u.hit_id, u.depth desc
  )
  select h.source, h.item_id, h.parent_id, h.name, h.is_folder, h.mime, h.size_bytes, h.modified_at, h.hash,
    h.starred, h.library_doc_id, h.match_in, p.path
    from hits h left join paths p on p.workspace_id = h.workspace_id and p.source = h.source and p.hit_id = h.item_id
   order by h.o;
end
$$;
revoke all on function public.app_cloud_find_in(text[], text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.app_cloud_find_in(text[], text, text, integer) to authenticated;

-- 사후 확인: 세 표 RLS 켜짐·정책 각 1개(같은 이름, select, authenticated, owner 조건만), anon·PUBLIC 표 권한 없음,
-- authenticated 쓰기 권한 없음, 찾기 함수는 DEFINER·search_path 고정·authenticated만 실행·files 판정 없음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid in ('public.app_cloud_items'::regclass, 'public.app_cloud_stars'::regclass, 'public.app_cloud_jobs'::regclass)
               and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or has_table_privilege('authenticated', 'public.app_cloud_items', 'insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_cloud_stars', 'insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_cloud_jobs', 'insert,update,delete,truncate,references,trigger')
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_items'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_stars'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_jobs'::regclass) <> 1
     or (select count(*) from pg_policy p
          where (p.polrelid, p.polname) in (('public.app_cloud_items'::regclass, 'cloud_items_owner_read'),
                                            ('public.app_cloud_stars'::regclass, 'cloud_stars_owner_read'),
                                            ('public.app_cloud_jobs'::regclass, 'cloud_jobs_owner_read'))
            and p.polcmd = 'r' and p.polpermissive and p.polwithcheck is null
            and p.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]
            and pg_get_expr(p.polqual, p.polrelid) = 'private.app_is_workspace_owner(workspace_id)') <> 3
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)')
                      and prosecdef and proconfig = array['search_path=""']
                      and strpos(pg_get_functiondef(oid), 'app_workspace_has_feature') = 0)
     or exists (select 1 from pg_proc where oid = to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)')
                and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('service_role', oid, 'execute')
                     or proacl::text ~ '(^|[{,])=' or not has_function_privilege('authenticated', oid, 'execute'))) then
    raise exception 'CLOUD_FILES_ALL_OWNERS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115120000', 'cloud_files_all_owners', array['S62-11 MULTI-구글드라이브사진모두 ①: read policies cloud_items_owner_read, cloud_stars_owner_read, cloud_jobs_owner_read re-created with the same name, table, command (select) and role (authenticated), condition now workspace owner only (operator feature files check removed); app_cloud_find_in re-defined (same signature, SECURITY DEFINER, search_path empty, authenticated only) without the files feature check; no grants widened, no anon/PUBLIC, RLS stays on, operator feature rows kept']);
commit;
