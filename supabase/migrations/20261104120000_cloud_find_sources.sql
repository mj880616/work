begin;
-- S49-26 FILES-통합 1-②: [파일] [최근]이 '불러오지 못했습니다'가 되는 원인을 고친다(설계: docs/design/files-unified-plan.md A-4·F·G 1-②).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 원인(20261102160000 app_cloud_find, 코드로 확인):
--   - SECURITY INVOKER라 작업공간을 칸으로 거르지 않고 표 읽기 규칙(RLS)에 맡긴다. RLS는 줄마다 owner·files 두 함수를 부르므로
--     (workspace_id, modified_at) 색인을 못 타고 작업공간 파일 전체를 한 줄씩 검사한다.
--   - 정렬이 `case ... end desc nulls last, modified_at desc nulls last`라 어느 색인 순서와도 맞지 않는다(옛 색인은 modified_at desc = nulls first).
--     그래서 전체를 다 읽어 정렬한 뒤에야 200줄을 자른다.
--   - 자료실 짝(app_documents, lateral)과 별표 확인을 정렬 전에 모든 줄에 계산한다. app_documents(workspace_id, file_id) 색인은 없다
--     → 줄마다 자료실 표 전체를 다시 훑는다(그 표의 RLS 함수도 줄마다). 줄 수가 늘면 로그인 사용자 시간 제한에 걸린다.
--
-- 무엇:
--  1) public.app_cloud_find_in(p_sources text[], p_query text, p_shelf text, p_limit integer) 새 읽기 함수(SECURITY DEFINER, search_path '').
--     - 처음에 한 번: 로그인한 본인이 owner인 작업공간 하나를 구하고, 그 작업공간이 owner 검사·운영자 기능 files 검사를 모두 지나야 한다
--       (클라이언트가 보낸 작업공간 id는 받지 않는다). 아니면 0줄(지금 RLS가 0줄을 주는 것과 같음). 그 뒤는 그 작업공간 칸으로만 읽는다.
--     - p_sources: 켜진 출처('od'·'gd' 중 0~2개). 서버가 거른다(화면이 200줄을 받아 덮어 거르지 않음). 빈 배열이면 0줄.
--     - 묶음(recent·big): 출처마다 새 색인 순서대로 p_limit줄만 읽고 합쳐 p_limit줄. starred: 별표 표에서. 찾기(p_query): 그 작업공간·켜진 출처 안에서.
--     - 별표·자료실 짝·폴더 경로는 고른 줄(p_limit 이하)에만 계산한다.
--  2) public.app_cloud_find(text, text, integer)는 같은 서명·같은 답 모양으로 다시 정의: 새 함수를 두 출처 모두로 부르는 얇은 길(SECURITY INVOKER 그대로).
--     옛 화면(배포 전 캐시)이 불러도 빠른 길을 탄다. 옛 서명 지우기(DROP FUNCTION)는 승인형 workflow가 받지 않아 남겨 둔다.
--  3) 색인 3개: 출처별 최근(app_cloud_items_recent_src_idx), 출처별 큰 파일(app_cloud_items_big_src_idx), 자료실 짝(app_documents_workspace_file_idx).
--     옛 색인(app_cloud_items_modified_idx·size_idx)은 DROP을 workflow가 받지 않아 남긴다(쓰기 비용만 조금).
-- 권한: 표 RLS·정책·표 권한 변경 없음. 새 함수는 authenticated 실행만(PUBLIC·anon·service_role 회수). DEFINER 범위는 본인 owner 작업공간 + files 허용일 때
--   그 작업공간의 색인·별표·자료실 id(찾기에서는 '읽기 끝난' 글자 일치 여부)만 — 지금 RLS로 보이는 것과 같다. 쓰기 없음.
-- 짝: docs/20261104120000_cloud_find_sources.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104120000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261102160000' and name = 'cloud_files_index') <> 1
     or to_regclass('public.app_cloud_items') is null
     or to_regclass('public.app_cloud_stars') is null
     or to_regclass('public.app_documents') is null
     or to_regclass('public.app_workspace_members') is null
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null
     or to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)') is not null
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_cloud_find(text,text,integer)') and not prosecdef) <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('app_cloud_find', 'app_cloud_find_in')) <> 1
     or to_regclass('public.app_cloud_items_recent_src_idx') is not null
     or to_regclass('public.app_cloud_items_big_src_idx') is not null
     or to_regclass('public.app_documents_workspace_file_idx') is not null
     or (select count(*) from pg_attribute where attrelid = 'public.app_documents'::regclass and not attisdropped
         and attname in ('workspace_id', 'file_id', 'extraction_status', 'extracted_text')) <> 4
     or exists (select 1 from pg_class where oid in ('public.app_cloud_items'::regclass, 'public.app_cloud_stars'::regclass) and not relrowsecurity)
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_items'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_stars'::regclass) <> 1 then
    raise exception 'CLOUD_FIND_SOURCES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create index app_cloud_items_recent_src_idx on public.app_cloud_items(workspace_id, source, modified_at desc nulls last, item_id)
  where not is_folder and not trashed;
create index app_cloud_items_big_src_idx on public.app_cloud_items(workspace_id, source, size_bytes desc nulls last, modified_at desc nulls last, item_id)
  where not is_folder and not trashed;
create index app_documents_workspace_file_idx on public.app_documents(workspace_id, file_id) where file_id is not null;

-- 찾기·묶음(켜진 출처만). 답 모양은 app_cloud_find와 같다.
create function public.app_cloud_find_in(p_sources text[], p_query text, p_shelf text, p_limit integer)
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

  -- 주인 검사는 여기서 한 번: 로그인한 본인이 owner인 작업공간이 정확히 하나이고, owner 검사·files 허용을 지나야 한다. 아니면 0줄.
  select pg_catalog.min(m.workspace_id::text)::uuid, pg_catalog.count(*) into v_ws, v_owners
    from public.app_workspace_members m
   where m.user_id = (select auth.uid()) and m.role = 'owner';
  if v_owners <> 1 or v_ws is null or not private.app_is_workspace_owner(v_ws)
     or not private.app_workspace_has_feature(v_ws, 'files') then
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

-- 옛 서명: 같은 답 모양, 두 출처 모두. SECURITY INVOKER 그대로(새 함수의 주인 검사를 그대로 탄다).
create or replace function public.app_cloud_find(p_query text, p_shelf text, p_limit integer)
returns table (source text, item_id text, parent_id text, name text, is_folder boolean, mime text, size_bytes bigint,
  modified_at timestamptz, hash text, starred boolean, library_doc_id uuid, match_in text, folder_path text)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.source, f.item_id, f.parent_id, f.name, f.is_folder, f.mime, f.size_bytes, f.modified_at, f.hash,
    f.starred, f.library_doc_id, f.match_in, f.folder_path
    from public.app_cloud_find_in(array['od', 'gd'], p_query, p_shelf, p_limit) f
$$;

revoke all on function public.app_cloud_find_in(text[], text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.app_cloud_find(text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.app_cloud_find_in(text[], text, text, integer) to authenticated;
grant execute on function public.app_cloud_find(text, text, integer) to authenticated;

-- 사후 확인: 새 함수는 DEFINER·search_path 고정·authenticated만 실행, 옛 서명은 INVOKER·authenticated만, 표 RLS·정책 수·표 권한 그대로,
-- 색인 3개 있음. 다르면 전체 취소.
do $$
begin
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)')
                   and prosecdef and proconfig = array['search_path=""'])
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_cloud_find(text,text,integer)') and not prosecdef)
     or exists (select 1 from pg_proc where oid in (to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)'),
                  to_regprocedure('public.app_cloud_find(text,text,integer)'))
                and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('service_role', oid, 'execute')
                     or proacl::text ~ '(^|[{,])=' or not has_function_privilege('authenticated', oid, 'execute')))
     or exists (select 1 from pg_class where oid in ('public.app_cloud_items'::regclass, 'public.app_cloud_stars'::regclass, 'public.app_documents'::regclass)
                and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or has_table_privilege('authenticated', 'public.app_cloud_items', 'insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_cloud_stars', 'insert,update,delete,truncate,references,trigger')
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_items'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_stars'::regclass) <> 1
     or to_regclass('public.app_cloud_items_recent_src_idx') is null
     or to_regclass('public.app_cloud_items_big_src_idx') is null
     or to_regclass('public.app_documents_workspace_file_idx') is null then
    raise exception 'CLOUD_FIND_SOURCES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261104120000', 'cloud_find_sources', array['S49-26 FILES-통합 1-②: new SECURITY DEFINER read function app_cloud_find_in(sources, query, shelf, limit) (owner + files checked once, own workspace only, authenticated only, no anon/PUBLIC); app_cloud_find(text,text,integer) re-defined as an INVOKER wrapper over both sources; indexes app_cloud_items_recent_src_idx, app_cloud_items_big_src_idx, app_documents_workspace_file_idx; no table, policy or grant change on tables']);
commit;
