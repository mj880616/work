-- PRIVATE SELECT only. Do not paste results into PR/Actions/chat/public documents.
-- Save this file/result privately only when OCR has actually been used.
-- Preservation is a record for forward fix; there is no destructive replay SQL.
select n.id note_id,n.workspace_id,
       to_char(n.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') note_version,
       n.attachments private_attachment_preservation,
       md5(n.attachments::text) attachment_hash
from public.app_notes n
where jsonb_path_exists(n.attachments,'$[*] ? (exists(@.ocr))')
order by n.id;
