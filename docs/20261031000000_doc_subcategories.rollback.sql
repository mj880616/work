begin;
-- 20261031000000_doc_subcategories의 짝 되돌리기(SQL Editor 전용: 자료 UPDATE가 있어 승인형 workflow rollback 허용 목록 밖).
-- 새 함수 셋을 지우고, 주간보고 합치기를 되돌린다('주간보고›확정본' → '주간보고 확정본', '주간보고›개인본' → '주간보고 개인본', 붙였던 '주간보고' 빼기).
-- 표·정책·권한·검사는 손대지 않는다. 화면이 소분류를 쓰기 시작해 다른 소분류('›')가 생겼으면 멈춘다(지워서 통과시키지 않는다).
-- 그런 경우: 화면을 소분류 없는 판으로 되돌린 뒤, 그 소분류 자료를 어떻게 할지 커맨드센터가 정해 별도 승인 SQL로 처리하고 이 파일을 다시 실행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in share row exclusive mode;
lock table public.app_documents in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261031000000' and name = 'doc_subcategories') <> 1 then
    raise exception 'DOC_SUBCATEGORIES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_profiles p, unnest(p.document_categories) c
             where strpos(c, '›') > 0 and c not in ('주간보고›확정본', '주간보고›개인본'))
     or exists (select 1 from public.app_documents where strpos(category, '›') > 0 and category not in ('주간보고›확정본', '주간보고›개인본')) then
    raise exception 'DOC_SUBCATEGORIES_ROLLBACK_BLOCKED: other subcategories in use';
  end if;
end
$$;

update public.app_documents set category = case category when '주간보고›확정본' then '주간보고 확정본' else '주간보고 개인본' end
  where category in ('주간보고›확정본', '주간보고›개인본');

-- '주간보고' 자리에 옛 두 이름을 되돌려 놓고 '주간보고'와 새 소분류는 뺀다(사전 확인에서 '주간보고'가 따로 있던 프로필은 0이었다).
update public.app_profiles p
  set document_categories = (
    select array_agg(x order by n, k) from (
      select c as x, n, 0 as k from unnest(p.document_categories) with ordinality as t(c, n)
        where c not in ('주간보고', '주간보고›확정본', '주간보고›개인본')
      union all
      select v.x, (select min(n) from unnest(p.document_categories) with ordinality as t(c, n) where c = '주간보고'), v.k
        from (values ('주간보고 확정본', 1), ('주간보고 개인본', 2)) as v(x, k)
        where (v.k = 1 and '주간보고›확정본' = any (p.document_categories))
           or (v.k = 2 and '주간보고›개인본' = any (p.document_categories))
    ) back)
  where p.document_categories && array['주간보고›확정본', '주간보고›개인본']::text[];

drop function public.app_document_category_delete_group(text, text[]);
drop function public.app_document_category_rename_group(text, text, text[]);
drop function public.app_document_subcategory_delete(text);

delete from supabase_migrations.schema_migrations where version = '20261031000000' and name = 'doc_subcategories';
commit;
