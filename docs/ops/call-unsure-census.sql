-- SELECT only. CALL-업무기본 ⑤: '확인할 통화'(개인 통화함의 애매 통화)에 쌓인 것 중 같은 규칙으로 업무에 해당하는 건수를 센다.
-- 읽기 전용 확인 SQL(SQL Editor 또는 로컬 세션 read-only). 이름·번호·내용은 내보내지 않고 건수만 낸다. 바꾸는 일은 call-unsure-sweep.sql이 건수 보고 뒤에 한다.
--
-- 규칙(서버 collector-feed contactIsWork와 같은 뜻): 상대 표기(counterpart)에 쓰는 담당조직의 정식 이름·별칭이 들어 있으면 업무.
--   비교 모양: 소문자, 띄어쓰기·문장부호 제거, '노동조합'='노조', 정식 이름 끝 '지부'·'지회'는 뗀 것도 같은 이름으로 본다. 3글자 미만 이름은 쓰지 않는다. 휴지통·쓰지 않는 조직 제외.
-- 한계(사실): 옛 애매 통화 줄에는 연락처 이름(전사 파일 이름)이 저장돼 있지 않다. 그래서 줄에 남은 '상대 표기'만 본다. 상대 표기가 비어 있거나 조직 이름이 없는 줄은 규칙에 안 걸려 계속 '확인할 통화'에 남는다.
-- 업무 꼬리표(의원실·기자 등)는 두 낱말 이상 연락처 이름을 전제로 한 서버 규칙이라 여기서는 쓰지 않는다(상대 표기는 사람 이름·직함 글이라 잘못 걸릴 수 있음).
with keys as (
  select o.workspace_id, k.key
  from public.app_suborganizations o
  cross join lateral (
    select distinct regexp_replace(replace(lower(regexp_replace(n, '[[:space:]·‧․.,()\[\]{}<>「」『』''"“”‘’\-–_/]', '', 'g')), '노동조합', '노조'), '(지부|지회)$', '') as key
    from unnest(array[o.name] || coalesce(o.aliases, '{}')) as n
    union
    select replace(lower(regexp_replace(n, '[[:space:]·‧․.,()\[\]{}<>「」『』''"“”‘’\-–_/]', '', 'g')), '노동조합', '노조')
    from unnest(array[o.name] || coalesce(o.aliases, '{}')) as n
  ) k
  where o.deleted_at is null and coalesce(o.active, true) and char_length(k.key) >= 3
), unsure as (
  select c.id, c.workspace_id,
         replace(lower(regexp_replace(c.counterpart, '[[:space:]·‧․.,()\[\]{}<>「」『』''"“”‘’\-–_/]', '', 'g')), '노동조합', '노조') as who
  from public.app_call_personal c
  where c.kind = 'unsure' and c.hidden_at is null
)
select 'unsure calls (not hidden)' as item, (select count(*)::text from unsure) as value
union all select 'unsure with a counterpart text', (select count(*)::text from unsure where who is not null and who <> '')
union all select 'rule hit: counterpart contains a known organization name or alias (would move to work)',
  (select count(distinct u.id)::text from unsure u join keys k on k.workspace_id = u.workspace_id and position(k.key in u.who) > 0)
union all select 'remaining after sweep (stay in 확인할 통화)',
  (select count(*)::text from unsure u where not exists (select 1 from keys k where k.workspace_id = u.workspace_id and position(k.key in u.who) > 0));
