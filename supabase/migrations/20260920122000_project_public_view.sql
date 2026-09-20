-- Project content stays in app_spaces/app_project_blocks. These tables store only
-- publication choices; they cannot be read or written directly by API roles.
create table if not exists public.app_project_publications (
  project_id uuid primary key references public.app_spaces(id) on delete cascade,
  published boolean not null default false,
  public_summary text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create table if not exists public.app_project_public_blocks (
  block_id uuid primary key references public.app_project_blocks(id) on delete cascade,
  project_id uuid not null references public.app_spaces(id) on delete cascade,
  published boolean not null default false,
  public_sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists app_project_public_blocks_project_order
  on public.app_project_public_blocks(project_id,public_sort_order,block_id)
  where published;
alter table public.app_project_publications enable row level security;
alter table public.app_project_public_blocks enable row level security;
revoke all on public.app_project_publications,public.app_project_public_blocks from public,anon,authenticated;

create or replace function public.app_set_project_publication(
  p_project uuid,p_publish boolean,p_confirm boolean,p_summary text default null
) returns boolean
language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare v_previous boolean;
begin
  if auth.uid() is null or p_project is null or p_publish is null or p_confirm is null
    or not private.app_can_manage_space(p_project) then return false; end if;
  if not exists(
    select 1 from public.app_spaces s join public.app_workspaces w on w.id=s.workspace_id
    where s.id=p_project and w.slug='kptu-work' and s.status in ('active','done')
      and (s.metadata->>'project_system'='v2' or exists(
        select 1 from public.app_spaces parent where parent.id=s.parent_id
          and parent.metadata->>'project_system'='v2'))
      and not s.is_legacy_snapshot
  ) then return false; end if;
  if length(coalesce(p_summary,''))>2000 then return false; end if;
  select published into v_previous from public.app_project_publications where project_id=p_project;
  if p_publish and not coalesce(v_previous,false) and not p_confirm then return false; end if;
  insert into public.app_project_publications(project_id,published,public_summary,updated_at,updated_by)
  values(p_project,p_publish,nullif(btrim(p_summary),''),now(),auth.uid())
  on conflict (project_id) do update set published=excluded.published,
    public_summary=excluded.public_summary,updated_at=now(),updated_by=auth.uid();
  return true;
end
$function$;

create or replace function public.app_set_project_block_publication(
  p_block uuid,p_publish boolean,p_confirm boolean,p_order integer default null
) returns boolean
language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare v_project uuid;v_previous boolean;v_order integer;
begin
  if auth.uid() is null or p_block is null or p_publish is null or p_confirm is null then return false; end if;
  select b.project_id,b.sort_order into v_project,v_order from public.app_project_blocks b
    join public.app_spaces s on s.id=b.project_id
    join public.app_workspaces w on w.id=s.workspace_id
    where b.id=p_block and s.status in ('active','done')
      and (s.metadata->>'project_system'='v2' or exists(
        select 1 from public.app_spaces parent where parent.id=s.parent_id
          and parent.metadata->>'project_system'='v2'))
      and not s.is_legacy_snapshot and w.slug='kptu-work';
  if v_project is null or not private.app_can_edit_space(v_project) then return false; end if;
  if p_order is not null and (p_order < 0 or p_order > 1000000) then return false; end if;
  select published into v_previous from public.app_project_public_blocks where block_id=p_block;
  if p_publish and not coalesce(v_previous,false) and not p_confirm then return false; end if;
  insert into public.app_project_public_blocks(block_id,project_id,published,public_sort_order,updated_at,updated_by)
  values(p_block,v_project,p_publish,coalesce(p_order,v_order),now(),auth.uid())
  on conflict (block_id) do update set published=excluded.published,
    public_sort_order=coalesce(p_order,app_project_public_blocks.public_sort_order),updated_at=now(),updated_by=auth.uid();
  return true;
end
$function$;

-- The only anonymous project reader. Its output is built from an explicit
-- allowlist, including individual JSON keys inside each supported block type.
create or replace function public.app_public_project(p_slug text) returns jsonb
language sql stable security definer set search_path=pg_catalog,public
as $function$
  select jsonb_build_object(
    'title',s.name,
    'summary',coalesce(pp.public_summary,s.description),
    'blocks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'section',sec.title,'title',b.title,'type',b.block_type,
        'content',case b.block_type
          when 'text' then jsonb_build_object('text',b.content->>'text')
          when 'table' then jsonb_build_object(
            'columns',coalesce((select jsonb_agg(to_jsonb(v.value)) from jsonb_array_elements_text(case when jsonb_typeof(b.content->'columns')='array' then b.content->'columns' else '[]'::jsonb end) v),'[]'::jsonb),
            'rows',coalesce((select jsonb_agg(coalesce((select jsonb_agg(to_jsonb(cell.value)) from jsonb_array_elements_text(case when jsonb_typeof(r.value)='array' then r.value else '[]'::jsonb end) cell),'[]'::jsonb)) from jsonb_array_elements(case when jsonb_typeof(b.content->'rows')='array' then b.content->'rows' else '[]'::jsonb end) r),'[]'::jsonb))
          when 'timeline' then jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('date',item.value->>'date','title',item.value->>'title','body',item.value->>'body')) from jsonb_array_elements(case when jsonb_typeof(b.content->'items')='array' then b.content->'items' else '[]'::jsonb end) item),'[]'::jsonb))
          when 'links' then jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('label',item.value->>'label','url',item.value->>'url','note',item.value->>'note')) from jsonb_array_elements(case when jsonb_typeof(b.content->'items')='array' then b.content->'items' else '[]'::jsonb end) item),'[]'::jsonb))
          else jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('label',item.value->>'label','value',item.value->>'value','note',item.value->>'note')) from jsonb_array_elements(case when jsonb_typeof(b.content->'items')='array' then b.content->'items' else '[]'::jsonb end) item),'[]'::jsonb))
        end
      ) order by pb.public_sort_order,b.id)
      from public.app_project_public_blocks pb
      join public.app_project_blocks b on b.id=pb.block_id and b.project_id=s.id
      join public.app_project_sections sec on sec.id=b.section_id and sec.project_id=s.id
      where pb.project_id=s.id and pb.published and b.block_type in ('text','table','timeline','links','status','metrics')
    ),'[]'::jsonb)
  )
  from public.app_spaces s
  join public.app_project_publications pp on pp.project_id=s.id and pp.published
  join public.app_workspaces w on w.id=s.workspace_id and w.slug='kptu-work'
  where p_slug ~ '^project-[0-9a-f]{32}$'
    and p_slug='project-'||replace(s.id::text,'-','')
    and s.status in ('active','done')
    and (s.metadata->>'project_system'='v2' or exists(
      select 1 from public.app_spaces parent where parent.id=s.parent_id
        and parent.metadata->>'project_system'='v2'))
    and not s.is_legacy_snapshot
  limit 1
$function$;

create or replace function public.app_project_publication_state(p_project uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public
as $function$
  select jsonb_build_object('published',coalesce(pp.published,false),
    'public_summary',pp.public_summary,
    'blocks',coalesce((select jsonb_agg(jsonb_build_object('id',b.block_id,'published',b.published,'public_order',b.public_sort_order))
      from public.app_project_public_blocks b where b.project_id=s.id),'[]'::jsonb))
  from public.app_spaces s
  left join public.app_project_publications pp on pp.project_id=s.id
  where s.id=p_project and private.app_can_edit_space(s.id)
  limit 1
$function$;

create or replace function public.app_move_project_public_block(p_block uuid,p_direction integer) returns boolean
language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare v_project uuid;v_ids uuid[];v_pos integer;v_other uuid;
begin
  if auth.uid() is null or p_direction not in (-1,1) then return false; end if;
  select project_id into v_project from public.app_project_public_blocks where block_id=p_block and published;
  if v_project is null or not private.app_can_edit_space(v_project) then return false; end if;
  perform 1 from public.app_project_public_blocks where project_id=v_project and published for update;
  select array_agg(block_id order by public_sort_order,block_id) into v_ids
    from public.app_project_public_blocks where project_id=v_project and published;
  v_pos:=array_position(v_ids,p_block);
  if v_pos is null or v_pos+p_direction<1 or v_pos+p_direction>array_length(v_ids,1) then return false; end if;
  v_other:=v_ids[v_pos+p_direction];v_ids[v_pos+p_direction]:=p_block;v_ids[v_pos]:=v_other;
  update public.app_project_public_blocks b set public_sort_order=x.ord*10,updated_at=now(),updated_by=auth.uid()
    from unnest(v_ids) with ordinality x(id,ord) where b.block_id=x.id and b.project_id=v_project;
  return true;
end
$function$;

revoke all on function public.app_set_project_publication(uuid,boolean,boolean,text) from public;
revoke all on function public.app_set_project_block_publication(uuid,boolean,boolean,integer) from public;
revoke all on function public.app_public_project(text) from public;
revoke all on function public.app_project_publication_state(uuid) from public;
revoke all on function public.app_move_project_public_block(uuid,integer) from public;
grant execute on function public.app_set_project_publication(uuid,boolean,boolean,text) to authenticated;
grant execute on function public.app_set_project_block_publication(uuid,boolean,boolean,integer) to authenticated;
grant execute on function public.app_public_project(text) to anon,authenticated;
grant execute on function public.app_project_publication_state(uuid) to authenticated;
grant execute on function public.app_move_project_public_block(uuid,integer) to authenticated;
