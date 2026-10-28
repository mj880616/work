-- ED-폰마크다운붙여넣기 ②: 마크다운 기호가 글자 그대로 저장된 글(노트·일기·업데이트, 담당조직 기록, 프로젝트 기록) 세기 — 읽기 전용 (select만).
-- 사용: Supabase SQL Editor 새 쿼리 창(+)에 붙여 넣고 실행한 뒤 결과를 캡처해 커맨드센터에 보낸다. 조각이 셋이므로 조각 하나씩(; 까지)
--       선택해 [Run selected]로 따로 실행한다.
-- 이 파일은 아무것도 바꾸지 않는다(insert/update/delete/함수 호출 없음). 저장된 글을 바꾸는 일은 없다: 변환은 화면의 [서식으로 바꾸기]를
-- 명진이 누를 때만, 그 글 하나에서 일어난다.
-- 제목·본문 글자는 결과에 내지 않는다(개수와 id·종류·시각만).
--
-- 기준(화면과 같은 판정, app/note-markdown.mjs looksLikeMarkdown): 글 조각 하나라도 아래 기호가 있으면 "기호 있음".
--   ## 머리 / **굵게** / 표 구분 줄 |---|---| / ``` 코드 / > [!NOTE] 강조 상자 / [글](https://주소) 링크.
--   '- '·'1. '·날짜로 시작하는 줄은 손으로 쓴 글에도 흔해서 치지 않는다.
-- 읽는 법:
--   - with_marks: 저장된 서식(doc) 안 글자에 기호가 있는 글 수.
--   - offer_shown: 그중 글 전체가 서식 없는 줄뿐이라 열 때 [서식으로 바꾸기]가 뜨는 글 수(app/ed-markdown.mjs markdownLettersOf와 같은 조건:
--     모든 덩어리가 문단, 정렬·들여쓰기 없음, 안에는 글자와 줄바꿈만, 굵게·색 같은 표시 없음). 나머지(with_marks - offer_shown)는
--     서식이 이미 섞여 있어 버튼이 뜨지 않는다(기호 몇 개만 남은 글; 손으로 고친다).
--   - 서식(doc)이 없는 옛 노트는 세지 않는다: 그런 노트는 열 때 이미 마크다운으로 읽어 들인다(note-doc.mjs noteStartDoc).

-- 1) 노트 표(app_notes): 종류(kind)별 개수. 보관함에 넣은 글(archived_at 있음)은 따로 센다.
with marked as (
  select n.id, n.kind, n.archived_at, n.doc,
    exists (
      select 1 from jsonb_path_query(n.doc, 'lax $.**.text') as t(v)
      where jsonb_typeof(t.v) = 'string' and (
           (t.v #>> '{}') ~ '^\s{0,3}#{1,6}[ \t]+\S'
        or (t.v #>> '{}') ~ '\*\*[^*\s]([^*\n]*[^*\s])?\*\*'
        or (t.v #>> '{}') ~ '^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$'
        or (t.v #>> '{}') ~ '^\s{0,3}(`{3,}|~{3,})'
        or (t.v #>> '{}') ~* '^\s{0,3}>[ \t]?\[!(note|tip|important|warning|caution)\]'
        or (t.v #>> '{}') ~ '\[[^]\n]+\]\((https?:|mailto:)[^)\s]+\)')
    ) as has_marks
  from public.app_notes n
  where n.doc is not null and jsonb_typeof(n.doc -> 'doc' -> 'content') = 'array'
), judged as (
  select m.*,
    m.has_marks
    and not exists (
      select 1 from jsonb_array_elements(m.doc -> 'doc' -> 'content') as b(node)
      where b.node ->> 'type' <> 'paragraph'
         or coalesce(b.node -> 'attrs' ->> 'align', '') <> ''
         or coalesce(b.node -> 'attrs' ->> 'indent', '0') <> '0')
    and not exists (
      select 1 from jsonb_array_elements(m.doc -> 'doc' -> 'content') as b(node),
        jsonb_array_elements(case when jsonb_typeof(b.node -> 'content') = 'array' then b.node -> 'content' else '[]'::jsonb end) as i(node)
      where i.node ->> 'type' not in ('text', 'hard_break')
         or (jsonb_typeof(i.node -> 'marks') = 'array' and jsonb_array_length(i.node -> 'marks') > 0)) as offer_shown
  from marked m
)
select kind,
  count(*) as with_doc,
  count(*) filter (where has_marks) as with_marks,
  count(*) filter (where offer_shown) as offer_shown,
  count(*) filter (where has_marks and archived_at is not null) as with_marks_archived
from judged
group by kind
order by kind;

-- 2) 노트 표에서 버튼이 뜨는 글 목록(id·종류·마지막 수정 시각만, 최근 것부터 100개). 예: 노트 '철도지하철 공약'이 여기 있는지 화면에서 대조.
with marked as (
  select n.id, n.kind, n.updated_at, n.doc,
    exists (
      select 1 from jsonb_path_query(n.doc, 'lax $.**.text') as t(v)
      where jsonb_typeof(t.v) = 'string' and (
           (t.v #>> '{}') ~ '^\s{0,3}#{1,6}[ \t]+\S'
        or (t.v #>> '{}') ~ '\*\*[^*\s]([^*\n]*[^*\s])?\*\*'
        or (t.v #>> '{}') ~ '^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$'
        or (t.v #>> '{}') ~ '^\s{0,3}(`{3,}|~{3,})'
        or (t.v #>> '{}') ~* '^\s{0,3}>[ \t]?\[!(note|tip|important|warning|caution)\]'
        or (t.v #>> '{}') ~ '\[[^]\n]+\]\((https?:|mailto:)[^)\s]+\)')
    ) as has_marks
  from public.app_notes n
  where n.doc is not null and jsonb_typeof(n.doc -> 'doc' -> 'content') = 'array'
)
select m.id, m.kind, m.updated_at
from marked m
where m.has_marks
  and not exists (
    select 1 from jsonb_array_elements(m.doc -> 'doc' -> 'content') as b(node)
    where b.node ->> 'type' <> 'paragraph'
       or coalesce(b.node -> 'attrs' ->> 'align', '') <> ''
       or coalesce(b.node -> 'attrs' ->> 'indent', '0') <> '0')
  and not exists (
    select 1 from jsonb_array_elements(m.doc -> 'doc' -> 'content') as b(node),
      jsonb_array_elements(case when jsonb_typeof(b.node -> 'content') = 'array' then b.node -> 'content' else '[]'::jsonb end) as i(node)
    where i.node ->> 'type' not in ('text', 'hard_break')
       or (jsonb_typeof(i.node -> 'marks') = 'array' and jsonb_array_length(i.node -> 'marks') > 0))
order by m.updated_at desc
limit 100;

-- 3) 담당조직 기록·프로젝트 기록(같은 편집기)의 기호 있는 글 수.
select 'app_suborganization_updates' as table_name,
  count(*) filter (where u.doc is not null) as with_doc,
  count(*) filter (where exists (
    select 1 from jsonb_path_query(u.doc, 'lax $.**.text') as t(v)
    where jsonb_typeof(t.v) = 'string' and (
         (t.v #>> '{}') ~ '^\s{0,3}#{1,6}[ \t]+\S'
      or (t.v #>> '{}') ~ '\*\*[^*\s]([^*\n]*[^*\s])?\*\*'
      or (t.v #>> '{}') ~ '^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$'
      or (t.v #>> '{}') ~ '^\s{0,3}(`{3,}|~{3,})'
      or (t.v #>> '{}') ~* '^\s{0,3}>[ \t]?\[!(note|tip|important|warning|caution)\]'
      or (t.v #>> '{}') ~ '\[[^]\n]+\]\((https?:|mailto:)[^)\s]+\)'))) as with_marks
from public.app_suborganization_updates u
union all
select 'app_project_progress_updates',
  count(*) filter (where u.doc is not null),
  count(*) filter (where exists (
    select 1 from jsonb_path_query(u.doc, 'lax $.**.text') as t(v)
    where jsonb_typeof(t.v) = 'string' and (
         (t.v #>> '{}') ~ '^\s{0,3}#{1,6}[ \t]+\S'
      or (t.v #>> '{}') ~ '\*\*[^*\s]([^*\n]*[^*\s])?\*\*'
      or (t.v #>> '{}') ~ '^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$'
      or (t.v #>> '{}') ~ '^\s{0,3}(`{3,}|~{3,})'
      or (t.v #>> '{}') ~* '^\s{0,3}>[ \t]?\[!(note|tip|important|warning|caution)\]'
      or (t.v #>> '{}') ~ '\[[^]\n]+\]\((https?:|mailto:)[^)\s]+\)')))
from public.app_project_progress_updates u;
