begin;
-- 20261115120000_cloud_files_all_owners의 짝 되돌리기. 읽기 정책 3개와 찾기 함수를 적용 전 원래 정의(owner + 운영자 기능 files)로 되돌리고 이번 기록 1행을 지운다.
-- 새 쿼리 창(+)에 붙여 넣고 첫 줄 begin;·마지막 줄 commit;·대상 프로젝트를 확인한 뒤 실행한다. 색인·별표·작업 행은 한 줄도 바꾸지 않는다.
-- 되돌리면 운영자 기능 files가 없는 작업공간의 [파일] 목록은 다시 0줄이 된다(그 사람들 메뉴의 [파일]을 빼는 화면 PR을 먼저 되돌린다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261115120000' and name = 'cloud_files_all_owners') <> 1
     or to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)') is null then
    raise exception 'CLOUD_FILES_ALL_OWNERS_ROLLBACK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

drop policy cloud_items_owner_read on public.app_cloud_items;
create policy cloud_items_owner_read on public.app_cloud_items for select to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'files'));
drop policy cloud_stars_owner_read on public.app_cloud_stars;
create policy cloud_stars_owner_read on public.app_cloud_stars for select to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'files'));
drop policy cloud_jobs_owner_read on public.app_cloud_jobs;
create policy cloud_jobs_owner_read on public.app_cloud_jobs for select to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'files'));

-- 찾기 함수: 20261104120000 원문 그대로.
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
revoke all on function public.app_cloud_find_in(text[], text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.app_cloud_find_in(text[], text, text, integer) to authenticated;

delete from supabase_migrations.schema_migrations where version = '20261115120000' and name = 'cloud_files_all_owners';
commit;
