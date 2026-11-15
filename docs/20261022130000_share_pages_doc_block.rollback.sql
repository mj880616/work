begin;
-- 20261022130000_share_pages_doc_block의 짝 되돌리기. 검사 조건을 20261020005000의 6종 원문으로 되돌리고 이번 기록 1행만 지운다.
-- 글(doc) 블록이 든 페이지가 하나라도 있으면 멈춘다. 페이지나 블록을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 화면을 되돌리고(새 편집기 없이), 그 페이지들을 초안으로 돌리거나 글 블록을 옮긴 뒤 다시 계획한다.
-- 표 권한·정책·함수에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_share_pages in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022130000' and name = 'share_pages_doc_block') <> 1 then
    raise exception 'SHARE_DOC_BLOCK_ROLLBACK_BLOCKED: migration record differs';
  end if;
  -- @> containment (an operator, no function call): any block whose type is "doc".
  if exists (select 1 from public.app_share_pages where blocks @> '[{"type":"doc"}]'::jsonb) then
    raise exception 'SHARE_DOC_BLOCK_ROLLBACK_BLOCKED: doc blocks exist; move them first';
  end if;
end
$$;

alter table public.app_share_pages drop constraint app_share_pages_blocks_check;
alter table public.app_share_pages
  add constraint app_share_pages_blocks_check check (
    jsonb_typeof(blocks) = 'array'
    and jsonb_array_length(blocks) <= 60
    and octet_length(blocks::text) <= 262144
    and jsonb_array_length(jsonb_path_query_array(blocks,
      'strict $[*].type ? (@ == "summary" || @ == "stages" || @ == "schedule" || @ == "issues" || @ == "links" || @ == "updates")',
      '{}', true)) = jsonb_array_length(blocks)
  );

delete from supabase_migrations.schema_migrations
  where version = '20261022130000' and name = 'share_pages_doc_block';
commit;
