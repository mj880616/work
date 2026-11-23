begin;
-- S69-01 글 보기 요약·시사점 다시 만들기 고침(명진 11/24 06:40·06:46 "매번 다시 만드는 거 같은데 이러지마").
-- 저장된 요약·시사점을 버리는 기준을 '본문을 뽑은 시각'(extracted_at)에서 '본문 내용 지문'으로 바꾸려고, 사람별 자세히 표 둘에 칸 하나를 더한다.
-- 같은 본문을 수집·다시 뽑기가 새 시각으로 다시 적어도 요약을 다시 만들지 않고, 본문 글자가 실제로 바뀔 때만 다시 만든다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. Edge ai-assist 배포는 이 적용 뒤에(새 칸을 읽고 쓰므로).
--
-- 무엇: app_news_now_details·app_outside_now_details에 body_key text(비어도 됨) + 모양 검사(소문자 영문·숫자 1~64자, interests_key와 같은 꼴).
--   기존 행은 건드리지 않는다(비어 있음 = 옛 저장본 — 서버가 다음에 열 때 한 번 지금 본문 지문을 적는다).
-- 권한: grant·revoke·정책·RLS·함수·트리거 변경 없음. 두 표는 지금처럼 화면(authenticated)은 자기 줄 읽기만, 쓰기는 service_role(서버)만.
-- 앞 단계: 20261115140000_news_for_all_refs·20261115150000_outside_for_all 기록이 있어야 한다.
-- 짝: docs/20261124070000_now_detail_body_key.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261124070000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115140000' and name = 'news_for_all_refs') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115150000' and name = 'outside_for_all') <> 1
     or to_regclass('public.app_news_now_details') is null
     or to_regclass('public.app_outside_now_details') is null
     or exists (select 1 from pg_attribute where attrelid in (to_regclass('public.app_news_now_details'), to_regclass('public.app_outside_now_details'))
         and attname = 'body_key' and not attisdropped)
     or exists (select 1 from pg_class where oid in (to_regclass('public.app_news_now_details'), to_regclass('public.app_outside_now_details')) and not relrowsecurity) then
    raise exception 'NOW_DETAIL_BODY_KEY_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_news_now_details add column body_key text;
alter table public.app_news_now_details
  add constraint app_news_now_details_body_key_check check (body_key is null or body_key ~ '^[a-z0-9]{1,64}$');
alter table public.app_outside_now_details add column body_key text;
alter table public.app_outside_now_details
  add constraint app_outside_now_details_body_key_check check (body_key is null or body_key ~ '^[a-z0-9]{1,64}$');

-- 사후 확인은 짝 postcheck(읽기 전용)로 한다 — 이 파일은 엄격 규칙 안(승인형 workflow rollback 모드도 쓸 수 있게)에 둔다.

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261124070000', 'now_detail_body_key', array['S69-01: app_news_now_details and app_outside_now_details get body_key (content fingerprint of the body used for the saved detail, shape check); no privilege, policy, RLS, function or trigger change; existing rows untouched']);
commit;
