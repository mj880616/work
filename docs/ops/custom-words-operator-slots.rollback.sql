begin;
-- custom-words-operator-slots.apply.sql의 짝 되돌리기. 운영자 owner 한 명의 고친 이름에서 새 두 칸(affiliation·weekly)만 뺀다(15칸은 그대로).
-- 넣은 값과 글자 그대로 같을 때만 뺀다. 명진이 그 뒤 화면에서 두 칸을 바꿔 저장했으면 멈춘다(본인 설정을 지우지 않음).
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
     set custom_words = custom_words - 'affiliation' - 'weekly'
   where user_id = target
     and custom_words ->> 'affiliation' = '노조' and custom_words ->> 'weekly' = '주간 보고';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'CUSTOM_WORDS_OPERATOR_SLOTS_CHANGED_SINCE_APPLY; stop'; end if;
end
$$;
commit;
