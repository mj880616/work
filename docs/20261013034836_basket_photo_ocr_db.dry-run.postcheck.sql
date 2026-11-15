-- First run 20261013034836_basket_photo_ocr_db.version-check.sql and require known PostgreSQL 16+.
-- Read-only API requests may run as a read-only role: read pg_constraint (information_schema hides
-- tables owned by other roles) and name the apply executor postgres instead of current_user.
-- Original state after cancelled dry-run; not the applied-state check.
select 'OCR migration absent' item,not exists(select 1 from supabase_migrations.schema_migrations where version='20261013034836') ok
union all select 'OCR RPC absent',not exists(select 1 from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname='app_basket_update_attachment_ocr')
union all select 'exact old CHECK restored',(select count(*) from pg_constraint where connamespace='public'::regnamespace and conname='app_notes_attachments_check')=1 and exists(select 1 from pg_constraint where conrelid='public.app_notes'::regclass and conname='app_notes_attachments_check' and contype='c' and convalidated) and exists(select 1 from pg_constraint where conrelid='public.app_notes'::regclass and conname='app_notes_attachments_check' and contype='c' and convalidated
 and btrim(regexp_replace(pg_get_constraintdef(oid),'\s+',' ','g'))=btrim(regexp_replace('CHECK ('||'
CASE
    WHEN (jsonb_typeof(attachments) = ''array''::text) THEN ((jsonb_array_length(attachments) <= 20) AND (NOT jsonb_path_exists(attachments, ''strict $[*]?(@.type() != "object")''::jsonpath)) AND (NOT jsonb_path_exists(attachments, ''$[*]?((((((((((((((@.type() != "object" || !(exists (@."drive_file_id"))) || !(exists (@."file_name"))) || !(exists (@."mime_type"))) || !(exists (@."size_bytes"))) || @."drive_file_id".type() != "string") || !(@."drive_file_id" like_regex "^[A-Za-z0-9_-]{1,255}$")) || @."file_name".type() != "string") || !(@."file_name" like_regex "^.{1,255}$" flag "s")) || @."mime_type".type() != "string") || !(@."mime_type" like_regex "^[^/[:space:]]{1,127}/[^/[:space:]]{1,127}$")) || @."size_bytes".type() != "number") || @."size_bytes" < 1) || @."size_bytes" > 104857600) || @."size_bytes" != @."size_bytes".floor())''::jsonpath)) AND (NOT jsonb_path_exists(attachments, ''$[*].keyvalue()?(((@."key" != "drive_file_id" && @."key" != "file_name") && @."key" != "mime_type") && @."key" != "size_bytes")''::jsonpath)))
    ELSE false
END'||')','\s+',' ','g')))
union all select 'notes triggers absent',not exists(select 1 from pg_trigger where tgrelid='public.app_notes'::regclass and not tgisinternal);
