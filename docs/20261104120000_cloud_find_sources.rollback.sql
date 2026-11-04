begin;
-- 20261104120000_cloud_find_sources의 짝 되돌리기. SQL Editor(폰 경로 C) 전용: 옛 함수를 이전 원문으로 다시 정의하므로 승인형 workflow rollback 모드 대상이 아니다.
-- 새 쿼리 창(+)에 붙여 넣고 첫 줄 begin;·마지막 줄 commit;·대상 프로젝트를 확인한 뒤 실행한다.
-- app_cloud_find(text,text,integer)를 20261102160000 원문(SECURITY INVOKER, RLS로 거름)으로 되돌리고, 새 함수 app_cloud_find_in·새 색인 3개·이번 기록 1행을 지운다.
-- 색인 표·별표·자료실 행은 한 줄도 바꾸지 않는다. 화면이 app_cloud_find_in을 부르는 판이면 먼저 화면을 이전 판으로 되돌린다(아니면 [파일] 목록 읽기가 실패한다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261104120000' and name = 'cloud_find_sources') <> 1
     or to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)') is null
     or to_regprocedure('public.app_cloud_find(text,text,integer)') is null then
    raise exception 'CLOUD_FIND_SOURCES_ROLLBACK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create or replace function public.app_cloud_find(p_query text, p_shelf text, p_limit integer)
returns table (source text, item_id text, parent_id text, name text, is_folder boolean, mime text, size_bytes bigint,
  modified_at timestamptz, hash text, starred boolean, library_doc_id uuid, match_in text, folder_path text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text := pg_catalog.btrim(coalesce(p_query, ''), ' ');
  v_words text[];
  v_pats text[];
  v_limit integer := coalesce(p_limit, 100);
begin
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

  return query
  with recursive hits as (
    select i.workspace_id, i.source, i.item_id, i.parent_id, i.name, i.is_folder, i.mime, i.size_bytes, i.modified_at, i.hash,
      exists (select 1 from public.app_cloud_stars s
        where s.workspace_id = i.workspace_id and s.source = i.source and s.item_id = i.item_id) as starred,
      doc.id as library_doc_id,
      case when v_query = '' then null::text when i.name ilike all (v_pats) then 'name' else 'text' end as match_in
    from public.app_cloud_items i
    left join lateral (
      select d.id, d.extraction_status, d.extracted_text from public.app_documents d
       where i.source = 'gd' and not i.is_folder and d.workspace_id = i.workspace_id and d.file_id = i.item_id
       order by d.id limit 1) doc on true
    where not i.trashed
      and case
        when v_query <> '' then pg_catalog.concat_ws(' ', i.name,
          case when doc.extraction_status = 'ready' then doc.extracted_text end) ilike all (v_pats)
        when p_shelf = 'starred' then exists (select 1 from public.app_cloud_stars s
          where s.workspace_id = i.workspace_id and s.source = i.source and s.item_id = i.item_id)
        else not i.is_folder
      end
    order by
      case when v_query <> '' and i.name ilike all (v_pats) then 0 else 1 end,
      case when p_shelf = 'big' then i.size_bytes end desc nulls last,
      i.modified_at desc nulls last, i.item_id
    limit v_limit
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
   order by
     case when h.match_in = 'name' then 0 when h.match_in = 'text' then 1 else 0 end,
     case when p_shelf = 'big' then h.size_bytes end desc nulls last,
     h.modified_at desc nulls last, h.item_id;
end
$$;

revoke all on function public.app_cloud_find(text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.app_cloud_find(text, text, integer) to authenticated;
drop function public.app_cloud_find_in(text[], text, text, integer);
drop index public.app_cloud_items_recent_src_idx;
drop index public.app_cloud_items_big_src_idx;
drop index public.app_documents_workspace_file_idx;

do $$
begin
  if to_regprocedure('public.app_cloud_find_in(text[],text,text,integer)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_cloud_find(text,text,integer)') and not prosecdef
                    and prolang = (select l.oid from pg_language l where l.lanname = 'plpgsql'))
     or exists (select 1 from pg_proc where oid = to_regprocedure('public.app_cloud_find(text,text,integer)')
                and (has_function_privilege('anon', oid, 'execute') or proacl::text ~ '(^|[{,])=' or not has_function_privilege('authenticated', oid, 'execute')))
     or to_regclass('public.app_cloud_items_recent_src_idx') is not null
     or to_regclass('public.app_cloud_items_big_src_idx') is not null
     or to_regclass('public.app_documents_workspace_file_idx') is not null then
    raise exception 'CLOUD_FIND_SOURCES_ROLLBACK_POSTCHECK_FAILED; stop';
  end if;
end
$$;

delete from supabase_migrations.schema_migrations where version = '20261104120000' and name = 'cloud_find_sources';
commit;
