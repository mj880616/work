begin isolation level read committed;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Replace the one placeholder with preservation_hex from the verified PRIVATE file.
-- Hex is reversible private data, not anonymization. Do not publish this query.
create temporary table basket_summary_preservation (row_data jsonb not null) on commit drop;
insert into pg_temp.basket_summary_preservation(row_data)
select value from jsonb_array_elements(
  convert_from(decode('PASTE_VERIFIED_PRIVATE_HEX', 'hex'), 'UTF8')::jsonb
);
-- Reject duplicates and malformed identities without showing private values.
create unique index on pg_temp.basket_summary_preservation ((row_data->>'id'));
do $file_guard$
begin
  if exists(select 1 from pg_temp.basket_summary_preservation
    where jsonb_typeof(row_data) <> 'object' or not (row_data ?& array['id','summary'])
       or jsonb_typeof(row_data->'id') <> 'string') then
    raise exception 'INVALID_PRESERVATION_FILE';
  end if;
end;
$file_guard$;
lock table public.app_record_links in access exclusive mode;
-- Run only AFTER separately approved reapplication of the migration.
-- Match the complete original row (identity, source, target, status, metadata,
-- timestamps), with only summary excluded. Never overwrite a current summary.
with restored as (
  update public.app_record_links l set summary=b.row_data->>'summary'
  from pg_temp.basket_summary_preservation b
  where l.summary is null and b.row_data->'summary' <> 'null'::jsonb
    and (to_jsonb(l) || jsonb_build_object('created_at', l.created_at at time zone 'UTC', 'task_checked_at', l.task_checked_at at time zone 'UTC')) - 'summary' = b.row_data - 'summary'
  returning l.id
)
select count(*) as restored_count from restored;
-- Verification returns only counts; excluded/deleted/changed rows need review.
select count(*) filter (where b.row_data->'summary' <> 'null'::jsonb) as preserved_summary_count,
       count(*) filter (where b.row_data->'summary' <> 'null'::jsonb
         and b.row_data = (to_jsonb(l) || jsonb_build_object('created_at', l.created_at at time zone 'UTC', 'task_checked_at', l.task_checked_at at time zone 'UTC'))) as exact_restored_summary_count
from pg_temp.basket_summary_preservation b
left join public.app_record_links l on l.id::text=b.row_data->>'id';
commit;
