begin;
-- 20261101011500_doc_date_year_fix의 짝 되돌리기. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow의 rollback 모드는 자료 UPDATE·표 삭제를 막는다).
-- 1) 비공개 표 app_document_date_fixes에 남긴 옛 날짜로 자료 날짜를 되돌린다. 적용 뒤 사람이 그 자료의 날짜를 다시 고쳤으면(지금 날짜가 새 날짜가 아니면) 건너뛴다.
-- 2) 그 표와 이번 기록 1행을 지운다. 다른 칸·표·권한·정책·함수는 건드리지 않는다.
-- 건너뛴 자료가 있으면 멈춘다(그 자료의 옛 날짜가 이 표에만 있으므로 표를 지우지 않는다). 그때는 명진이 그 자료를 볼지 정한 뒤 다시 계획한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_documents in share row exclusive mode;
lock table public.app_document_date_fixes in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261101011500' and name = 'doc_date_year_fix') <> 1 then
    raise exception 'DOC_DATE_YEAR_FIX_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_document_date_fixes f join public.app_documents d on d.id = f.document_id
             where d.document_date is distinct from f.new_document_date) then
    raise exception 'DOC_DATE_YEAR_FIX_ROLLBACK_BLOCKED: some dates changed after the fix';
  end if;
end
$$;

update public.app_documents d
  set document_date = f.old_document_date
  from public.app_document_date_fixes f
  where f.document_id = d.id
    and d.document_date = f.new_document_date;

drop table public.app_document_date_fixes;

delete from supabase_migrations.schema_migrations
  where version = '20261101011500' and name = 'doc_date_year_fix';
commit;
