-- SELECT only. Used-state recovery observations; does not remove functions/text.
select 'OCR attachment count' item,count(*)::text value from public.app_notes n cross join lateral jsonb_array_elements(n.attachments)a where a ? 'ocr'
union all select 'unresolved creation count',count(*)::text from public.app_notes n cross join lateral jsonb_array_elements(n.attachments)a where a->'ocr'->>'cleanup_state' in('create_pending','create_unknown')
union all select 'unresolved cleanup count',count(*)::text from public.app_notes n cross join lateral jsonb_array_elements(n.attachments)a where a->'ocr'->>'cleanup_state' in('created','delete_pending','delete_failed')
union all select 'known temporary document count',count(*)::text from public.app_notes n cross join lateral jsonb_array_elements(n.attachments)a where a->'ocr' ? 'temp_document_id'
union all select 'stored nonempty text count',count(*)::text from public.app_notes n cross join lateral jsonb_array_elements(n.attachments)a where coalesce(a->'ocr'->>'text','')<>''
union all select 'OCR version recorded',count(*)::text from supabase_migrations.schema_migrations where version='20261013034836' and name='basket_photo_ocr_db';
