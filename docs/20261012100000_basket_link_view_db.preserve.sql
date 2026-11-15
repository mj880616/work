-- PRIVATE output: all rows, including NULL summaries. Never publish this result.
-- Timestamp fields use UTC without a session-dependent offset.
with preservation as (
  select coalesce(jsonb_agg(row_data order by row_data->>'id'), '[]'::jsonb) data
  from (
    select to_jsonb(l) || jsonb_build_object('created_at', l.created_at at time zone 'UTC', 'task_checked_at', l.task_checked_at at time zone 'UTC') row_data
    from public.app_record_links l
  ) rows
)
select data as preservation_json,
       encode(convert_to(data::text, 'UTF8'), 'hex') as preservation_hex
from preservation;
