begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_notes in access exclusive mode;
do $$
begin
  if exists(select 1 from public.app_notes where attachments->0 ? 'ocr' or attachments->1 ? 'ocr' or attachments->2 ? 'ocr' or attachments->3 ? 'ocr' or attachments->4 ? 'ocr' or attachments->5 ? 'ocr' or attachments->6 ? 'ocr' or attachments->7 ? 'ocr' or attachments->8 ? 'ocr' or attachments->9 ? 'ocr' or attachments->10 ? 'ocr' or attachments->11 ? 'ocr' or attachments->12 ? 'ocr' or attachments->13 ? 'ocr' or attachments->14 ? 'ocr' or attachments->15 ? 'ocr' or attachments->16 ? 'ocr' or attachments->17 ? 'ocr' or attachments->18 ? 'ocr' or attachments->19 ? 'ocr') then
    raise exception 'OCR_DATA_PRESERVATION_REQUIRED';
  end if;
end
$$;
alter table public.app_notes drop constraint app_notes_attachments_check;
alter table public.app_notes
add constraint app_notes_attachments_check check (
    case when jsonb_typeof(attachments) = 'array' then
      jsonb_array_length(attachments) <= 20
      -- Strict top-level item check prevents lax auto-unwrapping nested arrays.
      and not jsonb_path_exists(attachments, 'strict $[*] ? (@.type() != "object")')
      and not jsonb_path_exists(attachments, '$[*] ? (
        @.type() != "object"
        || !exists(@.drive_file_id) || !exists(@.file_name)
        || !exists(@.mime_type) || !exists(@.size_bytes)
        || @.drive_file_id.type() != "string"
        || !(@.drive_file_id like_regex "^[A-Za-z0-9_-]{1,255}$")
        || @.file_name.type() != "string"
        || !(@.file_name like_regex "^.{1,255}$" flag "s")
        || @.mime_type.type() != "string"
        || !(@.mime_type like_regex "^[^/[:space:]]{1,127}/[^/[:space:]]{1,127}$")
        || @.size_bytes.type() != "number"
        || @.size_bytes < 1 || @.size_bytes > 104857600
        || @.size_bytes != @.size_bytes.floor()
      )')
      and not jsonb_path_exists(attachments, '$[*].keyvalue() ? (
        @.key != "drive_file_id" && @.key != "file_name"
        && @.key != "mime_type" && @.key != "size_bytes"
      )')
    else false end
  );
drop function public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb);
delete from supabase_migrations.schema_migrations where version='20261013034836' and name='basket_photo_ocr_db';
commit;
