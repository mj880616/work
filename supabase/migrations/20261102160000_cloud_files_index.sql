begin;
-- S48-12b 파일 탐색기 ② DB (FILES-클라우드탐색기, 명진 결정 F1~F9 11/02). 설계: docs/design/files-explorer.md 3절·4.1절·7절 ②.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
--
--  1) 운영자 기능 키에 'files'를 더한다(검사 지우고 같은 이름으로 다시 만듦). 허용 행은 '구글 드라이브 사진(gdrive_photos)이 허용된
--     작업공간이 정확히 하나이고 그 작업공간이 통화(calls) 작업공간과 같을 때'만 그 작업공간에 1행 넣는다. 고정 id·이름·메일을 쓰지 않는다.
--     파일 메뉴는 드라이브 전체를 보므로(사진 폴더보다 넓음) 화면 숨김이 아니라 이 키로 서버·DB가 막는다.
--  2) app_cloud_sync: 작업공간·출처(od 원드라이브 / gd 구글 드라이브)마다 1행. 바뀐 것 따라가기 커서(원드라이브 deltaLink /
--     구글 changes pageToken), 처음 훑기 이어 받기 자리(next_page), 처음 훑기 시작·끝 시각, 마지막 맞춘 시각, 겹침 막기 잠금, 마지막 오류 코드.
--     커서는 로그인 토큰이 아니지만 화면에 줄 까닭이 없어 화면(authenticated)은 이 표를 읽지 못한다(상태는 Edge cloud-files가 알려 줌).
--  3) app_cloud_items: 두 클라우드의 파일·폴더 목록 사본(이름·부모 폴더·크기·바뀐 날·종류·해시·휴지통 여부). 파일 본문은 넣지 않는다.
--     내 드라이브 맨 위에 바로 든 항목은 parent_id가 null이다(뿌리 폴더 자체는 넣지 않음). seen_at은 다시 훑을 때 남은 옛 행을 지우는 표시.
--  4) app_cloud_stars: 별표. 색인 행은 다시 만들어질 수 있어 따로 둔다.
--  5) 읽기 함수 3개(SECURITY INVOKER — RLS가 그대로 걸림): app_cloud_list(한 폴더 안, 폴더 옆 숫자 = 바로 든 파일 수 F3),
--     app_cloud_find(이름 검색 + 자료실이 이미 읽은 글자 F7, 또는 최근·큰 파일·별표 묶음 F9), app_cloud_trail(위치 줄).
--
-- 권한: 새 표 셋 RLS 켬. 화면(authenticated)은 app_cloud_items·app_cloud_stars를 읽기(select)만 하고, 정책이
--   '그 작업공간 owner(private.app_is_workspace_owner) 그리고 그 작업공간에 files 허용(private.app_workspace_has_feature)'인 행만 보인다.
--   app_cloud_sync는 정책 없음·authenticated 권한 없음. 쓰기(insert·update·delete)는 모든 표에서 service_role(Edge cloud-files)만.
--   anon·PUBLIC 권한 없음. 기존 표(app_operator_features·app_documents 포함)에는 권한·정책을 더하지 않는다.
-- 안 하는 것: 기존 함수·트리거·정책·칸·권한·행 변경(허용 행 1줄 더하기 제외), 파일 본문 저장, 클라우드 파일 자체 변경.
-- 짝: docs/20261102160000_cloud_files_index.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261102160000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261031120000' and name = 'gdrive_photo_index') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_operator_features') is null
     or to_regclass('public.app_documents') is null
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null
     or to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null
     or to_regclass('public.app_cloud_sync') is not null
     or to_regclass('public.app_cloud_items') is not null
     or to_regclass('public.app_cloud_stars') is not null
     or to_regprocedure('public.app_cloud_list(text,text)') is not null
     or to_regprocedure('public.app_cloud_find(text,text,integer)') is not null
     or to_regprocedure('public.app_cloud_trail(text,text)') is not null
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ 'gdrive_photos' and pg_get_constraintdef(oid) !~ '''files''') <> 1
     or exists (select 1 from public.app_operator_features where feature not in ('calls', 'telegram', 'gdrive_photos')) then
    raise exception 'CLOUD_FILES_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from public.app_operator_features where feature = 'gdrive_photos') <> 1
     or (select count(*) from public.app_operator_features g join public.app_operator_features c
           on c.workspace_id = g.workspace_id and c.feature = 'calls' where g.feature = 'gdrive_photos') <> 1 then
    raise exception 'CLOUD_FILES_SEED_WORKSPACE_NOT_SINGLE; stop';
  end if;
end
$$;

alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files'));
insert into public.app_operator_features (workspace_id, feature)
  select f.workspace_id, 'files' from public.app_operator_features f where f.feature = 'gdrive_photos';

create table public.app_cloud_sync (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source text not null,
  cursor text,
  next_page text,
  scan_started_at timestamptz,
  index_done_at timestamptz,
  synced_at timestamptz,
  lock_until timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, source),
  constraint app_cloud_sync_source_check check (source in ('od', 'gd')),
  constraint app_cloud_sync_cursor_check check ((cursor is null or char_length(cursor) <= 4000)
    and (next_page is null or char_length(next_page) <= 4000)),
  constraint app_cloud_sync_error_check check (last_error is null or last_error ~ '^[A-Z0-9_]{1,80}$')
);

create table public.app_cloud_items (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source text not null,
  item_id text not null,
  parent_id text,
  name text not null,
  is_folder boolean not null default false,
  mime text,
  size_bytes bigint,
  modified_at timestamptz,
  created_at timestamptz,
  hash text,
  trashed boolean not null default false,
  seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, source, item_id),
  constraint app_cloud_items_source_check check (source in ('od', 'gd')),
  constraint app_cloud_items_id_check check (item_id ~ '^[A-Za-z0-9!_.-]{1,200}$'
    and (parent_id is null or parent_id ~ '^[A-Za-z0-9!_.-]{1,200}$') and parent_id is distinct from item_id),
  constraint app_cloud_items_name_check check (char_length(name) between 1 and 400),
  constraint app_cloud_items_mime_check check (mime is null or char_length(mime) <= 200),
  constraint app_cloud_items_size_check check (size_bytes is null or size_bytes >= 0),
  constraint app_cloud_items_hash_check check (hash is null or hash ~ '^(md5|sha1|sha256|qx):[A-Za-z0-9+/=]{1,100}$')
);
create index app_cloud_items_parent_idx on public.app_cloud_items(workspace_id, source, parent_id);
create index app_cloud_items_modified_idx on public.app_cloud_items(workspace_id, modified_at desc) where not is_folder and not trashed;
create index app_cloud_items_size_idx on public.app_cloud_items(workspace_id, size_bytes desc) where not is_folder and not trashed;
create index app_cloud_items_seen_idx on public.app_cloud_items(workspace_id, source, seen_at);

create table public.app_cloud_stars (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source text not null,
  item_id text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, source, item_id),
  constraint app_cloud_stars_source_check check (source in ('od', 'gd')),
  constraint app_cloud_stars_id_check check (item_id ~ '^[A-Za-z0-9!_.-]{1,200}$')
);

alter table public.app_cloud_sync enable row level security;
alter table public.app_cloud_items enable row level security;
alter table public.app_cloud_stars enable row level security;
revoke all on table public.app_cloud_sync from public, anon, authenticated, service_role;
revoke all on table public.app_cloud_items from public, anon, authenticated, service_role;
revoke all on table public.app_cloud_stars from public, anon, authenticated, service_role;

create policy cloud_items_owner_read on public.app_cloud_items for select to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'files'));
create policy cloud_stars_owner_read on public.app_cloud_stars for select to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'files'));

grant select on table public.app_cloud_items to authenticated;
grant select on table public.app_cloud_stars to authenticated;
grant select, insert, update, delete on table public.app_cloud_sync to service_role;
grant select, insert, update, delete on table public.app_cloud_items to service_role;
grant select, insert, update, delete on table public.app_cloud_stars to service_role;

-- 한 폴더 안(휴지통 제외). p_parent_id null = 내 드라이브 맨 위. 폴더 옆 숫자는 그 폴더에 바로 든 파일 수(F3).
-- 자료실 표시: 구글 파일 id가 자료(app_documents.file_id)와 같으면 그 자료 id(app_documents의 기존 RLS가 그대로 걸림).
create function public.app_cloud_list(p_source text, p_parent_id text)
returns table (source text, item_id text, parent_id text, name text, is_folder boolean, mime text, size_bytes bigint,
  modified_at timestamptz, hash text, child_count integer, starred boolean, library_doc_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.source, i.item_id, i.parent_id, i.name, i.is_folder, i.mime, i.size_bytes, i.modified_at, i.hash,
    case when i.is_folder then (select pg_catalog.count(*)::integer from public.app_cloud_items c
      where c.workspace_id = i.workspace_id and c.source = i.source and c.parent_id = i.item_id
        and not c.is_folder and not c.trashed) end,
    exists (select 1 from public.app_cloud_stars s
      where s.workspace_id = i.workspace_id and s.source = i.source and s.item_id = i.item_id),
    (select d.id from public.app_documents d
      where i.source = 'gd' and not i.is_folder and d.workspace_id = i.workspace_id and d.file_id = i.item_id
      order by d.id limit 1)
  from public.app_cloud_items i
  where p_source in ('od', 'gd') and i.source = p_source
    and i.parent_id is not distinct from p_parent_id and not i.trashed
  order by i.is_folder desc, pg_catalog.lower(i.name), i.item_id
  limit 5000
$$;

-- 위치 줄: 그 항목에서 맨 위까지 폴더(가까운 것부터 depth 0). 40단계에서 멈춘다.
create function public.app_cloud_trail(p_source text, p_item_id text)
returns table (item_id text, name text, depth integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive up as (
    select i.workspace_id, i.source, i.item_id, i.parent_id, i.name, 0 as depth
      from public.app_cloud_items i
     where p_source in ('od', 'gd') and i.source = p_source and i.item_id = p_item_id
    union all
    select f.workspace_id, f.source, f.item_id, f.parent_id, f.name, u.depth + 1
      from up u join public.app_cloud_items f
        on f.workspace_id = u.workspace_id and f.source = u.source and f.item_id = u.parent_id
     where u.depth < 40
  )
  select u.item_id, u.name, u.depth from up u order by u.depth
$$;

-- 찾기. p_query가 있으면 이름(두 클라우드 함께) + 자료실이 이미 읽어 둔 글자(extraction_status = 'ready'만, F7)에서 모든 낱말을 찾는다.
-- p_query가 없으면 p_shelf 묶음: recent(바뀐 날 최근, F9) / big(큰 파일) / starred(별표). 폴더 경로(folder_path)를 함께 준다.
create function public.app_cloud_find(p_query text, p_shelf text, p_limit integer)
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

revoke all on function public.app_cloud_list(text, text) from public, anon, authenticated, service_role;
revoke all on function public.app_cloud_trail(text, text) from public, anon, authenticated, service_role;
revoke all on function public.app_cloud_find(text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.app_cloud_list(text, text) to authenticated;
grant execute on function public.app_cloud_trail(text, text) to authenticated;
grant execute on function public.app_cloud_find(text, text, integer) to authenticated;

-- 사후 확인: 새 표 셋 RLS 켜짐, 정책은 items·stars의 owner 읽기 하나씩(그 밖 없음), authenticated는 items·stars select만,
-- anon·PUBLIC 권한 없음, service_role은 새 표 넷만, 운영자 표는 RLS 켜짐·정책 없음·권한 없음 그대로,
-- 함수 셋은 INVOKER·anon·PUBLIC 실행권 없음, files 행은 gdrive_photos 행과 같은 작업공간 1행. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_cloud_sync'::regclass, 'public.app_cloud_items'::regclass, 'public.app_cloud_stars'::regclass,
                           'public.app_operator_features'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or exists (select 1 from pg_attribute where attrelid = t and attacl is not null)
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('authenticated', t, 'insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('authenticated', t, 'insert,update,references')
       or has_table_privilege('service_role', t, 'truncate,references,trigger') then
      raise exception 'CLOUD_FILES_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.app_cloud_sync', 'select')
     or has_table_privilege('authenticated', 'public.app_operator_features', 'select')
     or not has_table_privilege('authenticated', 'public.app_cloud_items', 'select')
     or not has_table_privilege('authenticated', 'public.app_cloud_stars', 'select')
     or exists (select 1 from pg_policy where polrelid in ('public.app_cloud_sync'::regclass, 'public.app_operator_features'::regclass))
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_items'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_cloud_stars'::regclass) <> 1
     or exists (select 1 from pg_policy where polrelid in ('public.app_cloud_items'::regclass, 'public.app_cloud_stars'::regclass)
                and (polcmd <> 'r' or not polpermissive or polroles <> array['authenticated'::regrole]::oid[]))
     or not has_table_privilege('service_role', 'public.app_cloud_sync', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'public.app_cloud_items', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'public.app_cloud_stars', 'select,insert,update,delete')
     or has_table_privilege('service_role', 'public.app_operator_features', 'select,insert,update,delete')
     or exists (select 1 from pg_proc where oid in ('public.app_cloud_list(text,text)'::regprocedure,
                  'public.app_cloud_trail(text,text)'::regprocedure, 'public.app_cloud_find(text,text,integer)'::regprocedure)
                and (prosecdef or has_function_privilege('anon', oid, 'execute') or proacl::text ~ '(^|[{,])='
                     or not has_function_privilege('authenticated', oid, 'execute')))
     or (select count(*) from public.app_operator_features where feature = 'files') <> 1
     or (select count(*) from public.app_operator_features f join public.app_operator_features g
           on g.workspace_id = f.workspace_id and g.feature = 'gdrive_photos' where f.feature = 'files') <> 1 then
    raise exception 'CLOUD_FILES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261102160000', 'cloud_files_index', array['S48-12b FILES-클라우드탐색기 ②: operator feature files (seeded only for the gdrive_photos workspace) + app_cloud_sync (service_role only) + app_cloud_items and app_cloud_stars (RLS, authenticated select only for workspace owner with files feature, writes service_role only) + SECURITY INVOKER read functions app_cloud_list, app_cloud_trail, app_cloud_find (authenticated only, no anon/PUBLIC)']);
commit;
