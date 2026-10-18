begin;
-- 20261018112943_doc_categories_profile의 짝 되돌리기. 함수 3개·검사 조건·분류 목록 칸만 지운다.
-- 어떤 프로필의 분류 목록이 기본 7개와 다르면(사용자가 추가·이름 바꾸기·삭제를 한 뒤) 멈춘다. 목록을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 화면(PR 3)을 되돌리고, 목록을 캡처해 보관한 뒤 복구 계획을 따로 세운다.
-- 이름 바꾸기·삭제로 이미 바뀐 자료의 분류 값은 되돌리지 않는다(그 값은 평범한 글자로 남고, 화면은 7개 대응표로 보여 준다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261018112943' and name = 'doc_categories_profile') <> 1 then
    raise exception 'DOC_CATEGORIES_PROFILE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles
      where document_categories is distinct from array['교섭', '투쟁', '교육', '선전', '정책', '회의', '기타']::text[]) then
    raise exception 'DOC_CATEGORIES_PROFILE_ROLLBACK_BLOCKED: category list edited; preserve and plan recovery';
  end if;
end
$$;

drop function public.app_document_category_delete(text, text[]);
drop function public.app_document_category_rename(text, text, text[]);
drop function public.app_document_category_add(text);
alter table public.app_profiles
  drop constraint app_profiles_document_categories_check,
  drop column document_categories;

delete from supabase_migrations.schema_migrations
  where version = '20261018112943' and name = 'doc_categories_profile';
commit;
