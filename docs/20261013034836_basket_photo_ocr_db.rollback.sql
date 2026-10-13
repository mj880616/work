begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Membership option catalog columns require PostgreSQL 16+. This
-- separate guard executes before any statement using those catalog columns.
do $$
begin
  if (select count(*) from pg_settings where name='server_version_num' and setting::integer>=160000) <> 1 then
    raise exception 'PHOTO_OCR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
end
$$;

lock table public.app_notes in access exclusive mode;
-- Keep the checked history revision stable until the paired record deletion.
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$
begin
  if exists(select 1 from public.app_notes where attachments->0 ? 'ocr' or attachments->1 ? 'ocr' or attachments->2 ? 'ocr' or attachments->3 ? 'ocr' or attachments->4 ? 'ocr' or attachments->5 ? 'ocr' or attachments->6 ? 'ocr' or attachments->7 ? 'ocr' or attachments->8 ? 'ocr' or attachments->9 ? 'ocr' or attachments->10 ? 'ocr' or attachments->11 ? 'ocr' or attachments->12 ? 'ocr' or attachments->13 ? 'ocr' or attachments->14 ? 'ocr' or attachments->15 ? 'ocr' or attachments->16 ? 'ocr' or attachments->17 ? 'ocr' or attachments->18 ? 'ocr' or attachments->19 ? 'ocr') then
    raise exception 'OCR_DATA_PRESERVATION_REQUIRED';
  end if;
  -- Lock first; do not erase a later CHECK/RPC/permission/history revision.
  -- Exact canonical CHECK/source comparisons use metadata and literals, keeping
  -- the existing DO assertion grammar and authenticated-only policy unchanged.
  if (select count(*) from supabase_migrations.schema_migrations where version='20261013034836') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version='20261013034836' and name='basket_photo_ocr_db' and statements=array['Preparation only: compatible optional OCR attachment metadata and owner-invoker CAS']) <> 1
     or (select count(*) from pg_constraint where conrelid='public.app_notes'::regclass and conname='app_notes_attachments_check' and contype='c' and convalidated and not condeferrable and not condeferred and not connoinherit and conislocal and coninhcount=0) <> 1
     -- Reject another public table's same-name CHECK before using schema/name text.
     or (select count(*) from pg_constraint where connamespace='public'::regnamespace and conname='app_notes_attachments_check') <> 1
     or (select count(*) from information_schema.check_constraints where constraint_schema='public' and constraint_name='app_notes_attachments_check' and check_clause='
CASE
    WHEN (jsonb_typeof(attachments) = ''array''::text) THEN ((jsonb_array_length(attachments) <= 20) AND (NOT jsonb_path_exists(attachments, ''strict $[*]?(@.type() != "object")''::jsonpath)) AND (NOT jsonb_path_exists(attachments, ''$[*]?((((((((((((((@.type() != "object" || !(exists (@."drive_file_id"))) || !(exists (@."file_name"))) || !(exists (@."mime_type"))) || !(exists (@."size_bytes"))) || @."drive_file_id".type() != "string") || !(@."drive_file_id" like_regex "^[A-Za-z0-9_-]{1,255}$")) || @."file_name".type() != "string") || !(@."file_name" like_regex "^.{1,255}$" flag "s")) || @."mime_type".type() != "string") || !(@."mime_type" like_regex "^[^/[:space:]]{1,127}/[^/[:space:]]{1,127}$")) || @."size_bytes".type() != "number") || @."size_bytes" < 1) || @."size_bytes" > 104857600) || @."size_bytes" != @."size_bytes".floor())''::jsonpath)) AND (NOT jsonb_path_exists(attachments, ''$[*].keyvalue()?((((@."key" != "drive_file_id" && @."key" != "file_name") && @."key" != "mime_type") && @."key" != "size_bytes") && @."key" != "ocr")''::jsonpath)) AND (NOT jsonb_path_exists(attachments, ''strict $[*]?(exists (@."ocr") && @."ocr".type() != "object")''::jsonpath)) AND (NOT jsonb_path_exists(attachments, ''$[*]?(exists (@."ocr") && (((((((((((((((((((((@."mime_type" != "image/jpeg" && @."mime_type" != "image/png" || !(exists (@."ocr"."state"))) || @."ocr"."state".type() != "string") || (((@."ocr"."state" != "unread" && @."ocr"."state" != "reading") && @."ocr"."state" != "done") && @."ocr"."state" != "empty") && @."ocr"."state" != "failed") || !(exists (@."ocr"."original_file_id"))) || @."ocr"."original_file_id".type() != "string") || @."ocr"."original_file_id" != @."drive_file_id") || !(exists (@."ocr"."cleanup_state"))) || @."ocr"."cleanup_state".type() != "string") || (((((@."ocr"."cleanup_state" != "none" && @."ocr"."cleanup_state" != "create_pending") && @."ocr"."cleanup_state" != "create_unknown") && @."ocr"."cleanup_state" != "created") && @."ocr"."cleanup_state" != "delete_pending") && @."ocr"."cleanup_state" != "deleted") && @."ocr"."cleanup_state" != "delete_failed") || exists (@."ocr"."attempt_id") && (@."ocr"."attempt_id".type() != "string" || !(@."ocr"."attempt_id" like_regex "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"))) || @."ocr"."state" != "unread" && !(exists (@."ocr"."attempt_id"))) || exists (@."ocr"."text") && @."ocr"."text".type() != "string") || @."ocr"."state" == "done" && (!(exists (@."ocr"."text")) || @."ocr"."text" == "")) || (@."ocr"."state" == "done" || @."ocr"."state" == "empty") && ((@."ocr"."cleanup_state" == "none" || @."ocr"."cleanup_state" == "create_pending") || @."ocr"."cleanup_state" == "create_unknown")) || @."ocr"."state" == "empty" && (!(exists (@."ocr"."text")) || @."ocr"."text" != "")) || @."ocr"."state" == "unread" && (((exists (@."ocr"."attempt_id") || exists (@."ocr"."text")) || exists (@."ocr"."temp_document_id")) || @."ocr"."cleanup_state" != "none")) || exists (@."ocr"."temp_document_id") && ((@."ocr"."temp_document_id".type() != "string" || !(@."ocr"."temp_document_id" like_regex "^[A-Za-z0-9_-]{1,255}$")) || @."ocr"."temp_document_id" == @."drive_file_id")) || (((@."ocr"."cleanup_state" == "created" || @."ocr"."cleanup_state" == "delete_pending") || @."ocr"."cleanup_state" == "deleted") || @."ocr"."cleanup_state" == "delete_failed") && !(exists (@."ocr"."temp_document_id"))) || ((@."ocr"."cleanup_state" == "none" || @."ocr"."cleanup_state" == "create_pending") || @."ocr"."cleanup_state" == "create_unknown") && exists (@."ocr"."temp_document_id")) || exists (@."ocr"."error_code") && (@."ocr"."error_code".type() != "string" || !(@."ocr"."error_code" like_regex "^[A-Z][A-Z0-9_]{0,63}$"))) || exists (@."ocr"."cleanup_error_code") && (@."ocr"."cleanup_error_code".type() != "string" || !(@."ocr"."cleanup_error_code" like_regex "^[A-Z][A-Z0-9_]{0,63}$"))))''::jsonpath)) AND (NOT jsonb_path_exists(attachments, ''$[*]."ocr".keyvalue()?(((((((@."key" != "state" && @."key" != "attempt_id") && @."key" != "original_file_id") && @."key" != "text") && @."key" != "temp_document_id") && @."key" != "cleanup_state") && @."key" != "error_code") && @."key" != "cleanup_error_code")''::jsonpath)) AND COALESCE(((length((attachments #>> ''{0,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{0,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{1,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{1,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{2,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{2,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{3,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{3,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{4,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{4,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{5,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{5,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{6,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{6,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{7,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{7,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{8,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{8,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{9,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{9,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{10,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{10,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{11,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{11,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{12,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{12,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{13,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{13,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{14,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{14,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{15,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{15,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{16,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{16,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{17,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{17,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{18,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{18,ocr,text}''::text[])) <= 65536)), true) AND COALESCE(((length((attachments #>> ''{19,ocr,text}''::text[])) <= 16384) AND (octet_length((attachments #>> ''{19,ocr,text}''::text[])) <= 65536)), true))
    ELSE false
END') <> 1
     or (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='app_basket_update_attachment_ocr') <> 1
     or (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='app_basket_update_attachment_ocr'
       and pronargs=4 and proargtypes[0]='uuid'::regtype and proargtypes[1]='timestamptz'::regtype and proargtypes[2]='jsonb'::regtype and proargtypes[3]='jsonb'::regtype
       and proargnames=array['p_note_id','p_note_updated_at','p_expected_attachment','p_ocr'] and proargmodes is null and proallargtypes is null and proargdefaults is null and pronargdefaults=0
       and prorettype='jsonb'::regtype and prokind='f' and prolang=(select oid from pg_language where lanname='plpgsql')
       and not prosecdef and not proleakproof and not proisstrict and not proretset and provolatile='v' and proparallel='u' and procost=100 and prorows=0 and prosupport=0
       and proconfig=array['search_path=""'] and probin is null and prosrc='
declare
  v_note public.app_notes%rowtype;
  v_attachment jsonb;
  v_old jsonb;
  v_next_attachment jsonb;
  v_attachments jsonb;
  v_index integer;
  v_count integer;
  v_source text;
  v_old_state text;
  v_state text;
  v_old_cleanup text;
  v_cleanup text;
  v_new_attempt boolean;
  v_stamp timestamptz;
  v_saved_stamp timestamptz;
begin
  if auth.uid() is null then
    return pg_catalog.jsonb_build_object(''ok'',false,''error'',''PERMISSION_DENIED'');
  end if;
  if p_note_id is null or p_note_updated_at is null or not pg_catalog.isfinite(p_note_updated_at)
     or p_expected_attachment is null or pg_catalog.jsonb_typeof(p_expected_attachment) <> ''object''
     or p_ocr is null or pg_catalog.jsonb_typeof(p_ocr) <> ''object''
     or pg_catalog.octet_length(p_expected_attachment::text) > 131072
     or pg_catalog.octet_length(p_ocr::text) > 131072 then
    return pg_catalog.jsonb_build_object(''ok'',false,''error'',''INVALID_INPUT'');
  end if;
  v_source := p_expected_attachment->>''drive_file_id'';
  if v_source is null or v_source !~ ''^[A-Za-z0-9_-]{1,255}$''
     or not (p_ocr ?& array[''state'',''original_file_id'',''cleanup_state''])
     or p_ocr->>''original_file_id'' is distinct from v_source then
    return pg_catalog.jsonb_build_object(''ok'',false,''error'',''INVALID_INPUT'');
  end if;
  select n.* into v_note from public.app_notes n where n.id=p_note_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(''ok'',false,''error'',''NOTE_MISSING'');
  end if;
  if v_note.updated_at <> p_note_updated_at then
    return pg_catalog.jsonb_build_object(''ok'',false,''error'',''NOTE_CHANGED'');
  end if;
  select pg_catalog.count(*)::integer,pg_catalog.min(a.ordinality)::integer-1
    into v_count,v_index
    from pg_catalog.jsonb_array_elements(v_note.attachments) with ordinality as a(value,ordinality)
    where a.value->>''drive_file_id''=v_source;
  if v_count <> 1 then
    return pg_catalog.jsonb_build_object(''ok'',false,''error'',''ATTACHMENT_CHANGED'');
  end if;
  v_attachment := v_note.attachments->v_index;
  if v_attachment is distinct from p_expected_attachment then
    return pg_catalog.jsonb_build_object(''ok'',false,''error'',''ATTACHMENT_CHANGED'');
  end if;
  v_old := v_attachment->''ocr'';
  v_old_state := coalesce(v_old->>''state'',''unread'');
  v_old_cleanup := coalesce(v_old->>''cleanup_state'',''none'');
  v_state := p_ocr->>''state'';
  v_cleanup := p_ocr->>''cleanup_state'';
  v_new_attempt := v_old->>''attempt_id'' is distinct from p_ocr->>''attempt_id'';

  if v_new_attempt then
    -- One persistent attempt before external POST. Unknown creation/unfinished
    -- cleanup cannot be bypassed by inventing a new UUID.
    if v_state <> ''reading'' or v_cleanup <> ''create_pending''
       or p_ocr->>''attempt_id'' is null
       or v_old_state not in (''unread'',''done'',''empty'',''failed'')
       or v_old_cleanup not in (''none'',''deleted'')
       or coalesce(v_old->>''text'','''') is distinct from coalesce(p_ocr->>''text'','''') then
      return pg_catalog.jsonb_build_object(''ok'',false,''error'',''INVALID_TRANSITION'');
    end if;
  else
    if v_old is null or v_old_state=''unread''
       or (v_state is distinct from v_old_state and not (v_old_state=''reading'' and v_state in (''done'',''empty'',''failed'')))
       or not (
         v_cleanup=v_old_cleanup
         or (v_old_cleanup=''create_pending'' and v_cleanup in (''create_unknown'',''created'',''none''))
         or (v_old_cleanup=''create_unknown'' and v_cleanup in (''created'',''none''))
         or (v_old_cleanup=''created'' and v_cleanup=''delete_pending'')
         or (v_old_cleanup=''delete_pending'' and v_cleanup in (''deleted'',''delete_failed''))
         or (v_old_cleanup=''delete_failed'' and v_cleanup=''delete_pending'')
       )
       or (v_old ? ''temp_document_id'' and v_old->>''temp_document_id'' is distinct from p_ocr->>''temp_document_id'')
       or (v_state not in (''done'',''empty'') and coalesce(v_old->>''text'','''') is distinct from coalesce(p_ocr->>''text'',''''))
       or (v_old_state in (''done'',''empty'',''failed'') and coalesce(v_old->>''text'','''') is distinct from coalesce(p_ocr->>''text'','''')) then
      return pg_catalog.jsonb_build_object(''ok'',false,''error'',''INVALID_TRANSITION'');
    end if;
    -- A successful recognition requires a verified conversion document first.
    if v_old_state=''reading'' and v_state in (''done'',''empty'')
       and (v_old->>''temp_document_id'' is null or v_cleanup not in (''created'',''delete_pending'',''deleted'',''delete_failed'')) then
      return pg_catalog.jsonb_build_object(''ok'',false,''error'',''INVALID_TRANSITION'');
    end if;
  end if;
  if p_ocr ? ''text'' and (pg_catalog.jsonb_typeof(p_ocr->''text'') <> ''string''
     or pg_catalog.length(p_ocr->>''text'') > 16384 or pg_catalog.octet_length(p_ocr->>''text'') > 65536) then
    return pg_catalog.jsonb_build_object(''ok'',false,''error'',''INVALID_INPUT'');
  end if;
  v_next_attachment := pg_catalog.jsonb_set(v_attachment,array[''ocr''],p_ocr,true);
  v_attachments := pg_catalog.jsonb_set(v_note.attachments,array[v_index::text],v_next_attachment,false);
  -- AI effective text ignores lifecycle state. Reading/failed attempts retain
  -- the prior committed text. NULL/absence and empty text both contribute ''''.
  v_stamp := v_note.updated_at;
  if coalesce(v_old->>''text'','''') is distinct from coalesce(p_ocr->>''text'','''') then
    v_stamp := greatest(pg_catalog.clock_timestamp(),v_note.updated_at+interval ''1 microsecond'');
  end if;
  update public.app_notes set attachments=v_attachments,updated_at=v_stamp
    where id=p_note_id and updated_at=p_note_updated_at and attachments=v_note.attachments
    returning updated_at into v_saved_stamp;
  if not found then
    return pg_catalog.jsonb_build_object(''ok'',false,''error'',''PERMISSION_DENIED'');
  end if;
  return pg_catalog.jsonb_build_object(''ok'',true,''updated_at'',v_saved_stamp,''attachment'',v_next_attachment);
exception
  when insufficient_privilege then
    return pg_catalog.jsonb_build_object(''ok'',false,''error'',''PERMISSION_DENIED'');
  when check_violation or not_null_violation or invalid_text_representation then
    return pg_catalog.jsonb_build_object(''ok'',false,''error'',''INVALID_INPUT'');
end;
'
       and proowner=current_user::regrole and proacl=array[(current_user::text||'=X/'||current_user::text)::aclitem,('authenticated=X/'||current_user::text)::aclitem]) <> 1 then
    raise exception 'PHOTO_OCR_ROLLBACK_CHANGED';
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
