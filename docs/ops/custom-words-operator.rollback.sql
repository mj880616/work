begin;
-- custom-words-operator.apply.sql의 짝 되돌리기. 운영자 owner 한 명의 고친 이름을 비운다(화면은 다시 얼굴 기본 이름).
-- 넣은 값과 글자 그대로 같을 때만 비운다. 명진이 그 뒤 화면에서 이름을 바꿔 저장했으면 멈춘다(본인 설정을 지우지 않음).
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  target uuid; owner_count int; changed int;
begin
  select count(*), min(m.user_id::text)::uuid into owner_count, target
    from public.app_workspace_members m
    where m.role = 'owner' and m.workspace_id = (
      select workspace_id from public.app_operator_features where feature in ('calls', 'telegram')
      group by workspace_id having count(distinct feature) = 2);
  if owner_count <> 1 or target is null then raise exception 'CUSTOM_WORDS_OPERATOR_OWNER_NOT_ONE; stop'; end if;
  update public.app_profiles
     set custom_words = null
   where user_id = target
     and custom_words = '{"menu_biz": "사업 관리", "report": "사업 보고", "area": "사업영역", "menu_org": "조직 관리", "org_one": "담당조직", "org_report": "조직 보고", "workplace": "투쟁사업장", "kind_meeting": "회의", "kind_policy": "정책", "kind_negotiation": "교섭", "kind_press": "언론", "kind_assembly": "국회", "kind_struggle": "투쟁", "kind_education": "교육", "kind_other": "기타"}'::jsonb;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'CUSTOM_WORDS_OPERATOR_CHANGED_SINCE_APPLY; stop'; end if;
end
$$;
commit;
