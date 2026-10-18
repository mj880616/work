-- 초안(DRAFT) — RTW-노트일원화 ④ 옮기기 1/4: 해 보기만(아무것도 바뀌지 않음). 설명: docs/design/rtw-note-copy-sql.md
-- 무엇이 바뀌나: 아무것도 안 바뀐다. 실제와 똑같이 노트를 넣어 보고 개수·제목·길이를 표로 보여 준 뒤, 맨 끝 rollback으로 전부 취소한다.
-- 잘못되면: 중간에 하나라도 맞지 않으면 빨간 오류 문구(RTW_COPY_STOP-번호)로 멈추고 아무것도 안 바뀐다.
-- 되돌리는 법: 필요 없다(이미 취소됨).
-- 쓰는 법: Supabase SQL Editor 새 쿼리 창(+)에 전부 붙여 넣기 → 첫 줄 begin; · 마지막 줄 rollback; 확인 → 대상 프로젝트 확인 → 실행.
-- 이 파일은 읽생기 표(rtw_*)를 select만 하고, 임시 표와 app_notes에만 쓴다(그리고 마지막에 취소한다).
begin;
-- 결과 표가 안 보이고 "No rows returned"만 보이면, 아래 'no'를 'yes'로 바꿔 다시 실행한다. 그러면 표 내용이 오류 칸에 글자로 나온다(그래도 전부 취소됨).
select set_config('rtw_copy.show_as_error', 'no', true);
-- ==== 본문 시작 (해 보기 파일과 실행 파일이 글자 하나까지 같아야 한다. 고치지 말 것) ====
-- 이 본문이 하는 일: 읽생기(rtw_*)의 명진 글을 읽기만 하고, Web2 노트(app_notes)에 새 노트로 넣는다.
-- 읽생기 표·권한·정책·함수는 건드리지 않는다. 권한 확대·정책 변경·새 함수·GRANT 없음.
-- 임시 표(rtw_ctx 등)는 이 거래가 끝나면 저절로 사라진다.
set local lock_timeout = '5s';
set local statement_timeout = '120s';
-- 같은 순간에 다른 곳에서 노트를 넣거나 이 SQL을 또 돌려도 두 번 들어가지 않게 노트 표에 쓰기 잠금을 건다.
lock table public.app_notes in share row exclusive mode;

-- [1단계] 시작 전 확인. 하나라도 다르면 아무것도 바꾸지 않고 여기서 멈춘다(오류 문구에 이유가 나온다).
do $$
begin
  if (select count(*) from public.rtw_personal_mode where id = 'owner') <> 1 then
    raise exception 'RTW_COPY_STOP-01: 읽생기 소유자 지정 행이 1개가 아님';
  end if;
  if (select count(*) from public.app_workspaces where slug = 'kptu-work') <> 1 then
    raise exception 'RTW_COPY_STOP-02: Web2 작업공간(kptu-work)이 1개가 아님';
  end if;
  if (select string_agg(m.user_id::text, ',') from public.app_workspace_members m join public.app_workspaces w on w.id = m.workspace_id
      where w.slug = 'kptu-work' and m.role = 'owner')
     is distinct from (select owner_id::text from public.rtw_personal_mode where id = 'owner') then
    raise exception 'RTW_COPY_STOP-03: 읽생기 소유자와 Web2 소유자가 같은 사람이 아님';
  end if;
  -- (재실행 막기 시작) 이미 옮긴 노트가 하나라도 있으면 멈춘다. 같은 글이 두 번 들어가지 않는다.
  if exists (select 1 from public.app_notes where metadata -> 'rtw' is not null) then
    raise exception 'RTW_COPY_STOP-04: 이미 옮긴 노트가 있음(metadata.rtw). 다시 옮기려면 먼저 되돌리기';
  end if;
  -- (재실행 막기 끝)
  if (select count(*) from pg_attribute where attrelid = 'public.app_notes'::regclass and not attisdropped
        and attname in ('workspace_id', 'kind', 'title', 'raw_text', 'occurred_at', 'created_at', 'updated_at',
                        'attachments', 'archived_at', 'ai_export_allowed', 'metadata')) <> 11
     or (select count(*) from pg_constraint where conrelid = 'public.app_notes'::regclass and contype = 'c' and convalidated
           and conname in ('app_notes_kind_check', 'app_notes_title_check', 'app_notes_raw_text_check', 'app_notes_metadata_check')) <> 4
     or (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'public.app_notes'::regclass and conname = 'app_notes_title_check') not like '%<= 200%'
     or (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'public.app_notes'::regclass and conname = 'app_notes_raw_text_check') not like '%100000%'
     or exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and not relrowsecurity)
     or (select count(*) from pg_policy where polrelid = 'public.app_notes'::regclass and polname = 'notes_owner_all') <> 1
     or exists (select 1 from pg_trigger where tgrelid = 'public.app_notes'::regclass and not tgisinternal) then
    raise exception 'RTW_COPY_STOP-05: app_notes의 열·검사 조건·정책·트리거가 예상과 다름';
  end if;
  if exists (
    select 1
    from (values
      ('rtw_resources', 'id,owner_id,title,original_title,author,source_name,published_on,original_url,body_md,created_at,updated_at'),
      ('rtw_notes', 'id,owner_id,resource_id,body,note_type,created_at,updated_at'),
      ('rtw_bookmarks', 'id,owner_id,resource_id,bookmark_type,selected_text,note,start_offset,created_at'),
      ('rtw_questions', 'id,owner_id,body,current_thought,status,created_at,updated_at'),
      ('rtw_topics', 'id,owner_id,name'),
      ('rtw_relations', 'owner_id,source_type,source_id,target_type,target_id'),
      ('rtw_records', 'id,owner_id,record_type,title,source_resource_id,a_original,b_feedback,c_revision,takeaway,tags,created_at,updated_at'),
      ('rtw_writing_context', 'owner_id,profile_md,updated_at')
    ) as need(tbl, cols)
    cross join lateral string_to_table(need.cols, ',') as col
    where not exists (select 1 from information_schema.columns ic
                      where ic.table_schema = 'public' and ic.table_name = need.tbl and ic.column_name = col)
  ) then
    raise exception 'RTW_COPY_STOP-06: 읽생기 표에 이 SQL이 읽는 열이 없음(열 이름이 다름)';
  end if;
end
$$;

-- [2단계] 기준 정보: 소유자, 넣을 작업공간, 옮긴 시각, 시작 전 노트 수.
create temp table rtw_ctx on commit drop as
select (select owner_id from public.rtw_personal_mode where id = 'owner') as owner_id,
       (select id from public.app_workspaces where slug = 'kptu-work') as workspace_id,
       to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as migrated_at,
       (select count(*) from public.app_notes) as notes_before;

-- [3단계] 연결(주제·질문)을 글자로 바꿀 재료. 메모에서 나간 연결은 그 메모가 붙은 글로 모은다.
create temp table rtw_rel on commit drop as
select case when rel.source_type = 'resource' then 'rtw_resources'
            when n.resource_id is not null then 'rtw_resources' else 'rtw_notes' end as plan_table,
       case when rel.source_type = 'resource' then rel.source_id::text
            when n.resource_id is not null then n.resource_id::text else rel.source_id::text end as plan_id,
       rel.target_type,
       case rel.target_type
         when 'topic' then nullif(btrim(regexp_replace(coalesce(t.name, ''), '\s+', ' ', 'g')), '')
         when 'question' then nullif(left(btrim(regexp_replace(coalesce(q.body, ''), '\s+', ' ', 'g')), 60), '')
       end as label
from public.rtw_relations rel
join rtw_ctx c on c.owner_id = rel.owner_id
left join public.rtw_notes n on rel.source_type = 'note' and n.id::text = rel.source_id::text and n.owner_id = rel.owner_id
left join public.rtw_topics t on rel.target_type = 'topic' and t.id::text = rel.target_id::text and t.owner_id = rel.owner_id
left join public.rtw_questions q on rel.target_type = 'question' and q.id::text = rel.target_id::text and q.owner_id = rel.owner_id
where rel.source_type in ('resource', 'note');

-- [4단계] 만들어질 노트를 임시 표(rtw_plan)에 먼저 계산한다. 아직 app_notes에는 아무것도 넣지 않는다.
create temp table rtw_plan (
  src_table text not null,
  src_id text not null,
  kind_label text not null,
  title text not null,
  raw_text text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  title_cut boolean not null default false,
  memos int not null default 0,
  marks int not null default 0,
  rels int not null default 0,
  primary key (src_table, src_id)
) on commit drop;

-- 4-1. 읽기 글 1개 = 노트 1개. 머리말 인용 한 묶음 + 본문 + 나의 메모 + 책갈피 + 끝 줄(주제·질문).
insert into rtw_plan (src_table, src_id, kind_label, title, raw_text, created_at, updated_at, title_cut, memos, marks, rels)
select 'rtw_resources', r.id::text, '읽기 글',
       btrim(left(t.one, 200)),
       array_to_string(array_remove(array[
         h.head,
         case when btrim(coalesce(r.body_md, ''), E' \t\r\n') <> '' then regexp_replace(r.body_md, '\s+$', '') end,
         m.memos_txt, k.marks_txt, f.footer], null), E'\n\n'),
       r.created_at, coalesce(r.updated_at, r.created_at),
       char_length(t.one) > 200,
       coalesce(m.n, 0), coalesce(k.n, 0), coalesce(f.n, 0)
from public.rtw_resources r
join rtw_ctx c on c.owner_id = r.owner_id
-- 제목: 한 줄로 합치고 200자까지. 비어 있으면 원문 제목, 그래도 없으면 "(제목 없음)".
cross join lateral (select coalesce(
    nullif(btrim(regexp_replace(coalesce(r.title, ''), '\s+', ' ', 'g')), ''),
    nullif(btrim(regexp_replace(coalesce(r.original_title, ''), '\s+', ' ', 'g')), ''),
    '(제목 없음)') as one) t
-- 머리말: > 원문: [원문 제목](주소) · 저자 · 출처 · 발표 날짜 · 책갈피 표시 (있는 것만). 웹 주소(http/https)만 링크로 만든다.
cross join lateral (
  select case when cardinality(x.p) = 0 then null else '> ' || array_to_string(x.p, ' · ') end as head
  from (
    select array_remove(array[
      case
        when s.url ~* '^https?://' then
          '원문: [' || replace(replace(replace(coalesce(s.ot, t.one), '\', '\\'), '[', '\['), ']', '\]') || '](' ||
          replace(replace(regexp_replace(s.url, '\s', '%20', 'g'), '(', '%28'), ')', '%29') || ')'
        when s.url is not null then '원문: ' || coalesce(s.ot || ' ', '') || regexp_replace(s.url, '\s', ' ', 'g')
        when s.ot is not null then '원문: ' || s.ot
      end,
      s.au, s.src,
      case when r.published_on is not null then '발표 ' || to_char(r.published_on, 'YYYY-MM-DD') end,
      s.star], null) as p
    from (select nullif(btrim(regexp_replace(coalesce(r.original_title, ''), '\s+', ' ', 'g')), '') as ot,
                 nullif(btrim(coalesce(r.original_url, '')), '') as url,
                 nullif(btrim(regexp_replace(coalesce(r.author, ''), '\s+', ' ', 'g')), '') as au,
                 nullif(btrim(regexp_replace(coalesce(r.source_name, ''), '\s+', ' ', 'g')), '') as src,
                 case when exists (select 1 from public.rtw_bookmarks b
                                   where b.resource_id = r.id and b.owner_id = r.owner_id and b.bookmark_type = 'resource')
                      then '책갈피 표시' end as star) s
  ) x
) h
-- ## 나의 메모: 글에 붙은 메모마다 "- [유형] 날짜" 줄과 본문(들여쓰기).
left join lateral (
  select '## 나의 메모' || E'\n\n' || string_agg(
           '- ' || coalesce('[' || nullif(btrim(n.note_type), '') || '] ', '')
           || to_char(n.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD')
           || case when btrim(coalesce(n.body, ''), E' \t\r\n') = '' then ''
                   else E'\n\n' || regexp_replace(regexp_replace(n.body, '\s+$', ''), '^(?=.)', '  ', 'ng') end,
           E'\n\n' order by n.created_at, n.id::text) as memos_txt,
         count(*)::int as n
  from public.rtw_notes n
  where n.resource_id = r.id and n.owner_id = r.owner_id
) m on true
-- ## 책갈피: 문장 책갈피는 "> 문장" + 메모, 글 전체 책갈피는 메모가 있을 때만 한 줄.
left join lateral (
  select '## 책갈피' || E'\n\n' || string_agg(i.item, E'\n\n'
           order by (i.bookmark_type = 'resource'), i.start_offset nulls last, i.created_at, i.id::text)
           filter (where i.item is not null) as marks_txt,
         count(*)::int as n
  from (
    select b.id, b.bookmark_type, b.start_offset, b.created_at,
           case b.bookmark_type
             when 'passage' then nullif(concat_ws(E'\n\n',
               case when btrim(coalesce(b.selected_text, ''), E' \t\r\n') <> ''
                    then regexp_replace(regexp_replace(b.selected_text, '\s+$', ''), '^', '> ', 'ng') end,
               case when btrim(coalesce(b.note, ''), E' \t\r\n') <> '' then '메모: ' || btrim(b.note, E' \t\r\n') end), '')
             when 'resource' then
               case when btrim(coalesce(b.note, ''), E' \t\r\n') <> '' then '글 전체 책갈피 메모: ' || btrim(b.note, E' \t\r\n') end
           end as item
    from public.rtw_bookmarks b
    where b.resource_id = r.id and b.owner_id = r.owner_id
  ) i
) k on true
-- 끝 줄: 주제: A, B · 질문: ...
left join lateral (
  select nullif(concat_ws(' · ',
           (select '주제: ' || string_agg(s.l, ', ' order by s.l)
            from (select distinct v.label as l from rtw_rel v
                  where v.plan_table = 'rtw_resources' and v.plan_id = r.id::text and v.target_type = 'topic' and v.label is not null) s),
           (select '질문: ' || string_agg(s.l, ' / ' order by s.l)
            from (select distinct v.label as l from rtw_rel v
                  where v.plan_table = 'rtw_resources' and v.plan_id = r.id::text and v.target_type = 'question' and v.label is not null) s)
         ), '') as footer,
         (select count(*) from rtw_rel v
          where v.plan_table = 'rtw_resources' and v.plan_id = r.id::text and v.label is not null)::int as n
) f on true;

-- 4-2. 독립 메모(글에 안 붙은 메모) 1개 = 노트 1개. 제목은 Web2 noteTitleFromText 규칙:
--      첫 줄(앞뒤 공백 제거, 앞의 # 표시 제거)을 200자까지. 본문은 메모 전체, 끝에 "유형: … · 주제: … · 질문: …".
insert into rtw_plan (src_table, src_id, kind_label, title, raw_text, created_at, updated_at, title_cut, memos, marks, rels)
select 'rtw_notes', n.id::text, '독립 메모',
       coalesce(nullif(btrim(regexp_replace(left(fl.line0, 200), '[\r\n]', ' ', 'g')), ''), '(제목 없는 메모)'),
       array_to_string(array_remove(array[
         case when btrim(coalesce(n.body, ''), E' \t\r\n') <> '' then regexp_replace(n.body, '\s+$', '') end,
         f.footer], null), E'\n\n'),
       n.created_at, coalesce(n.updated_at, n.created_at),
       char_length(coalesce(fl.line0, '')) > 200,
       0, 0, coalesce(f.n, 0)
from public.rtw_notes n
join rtw_ctx c on c.owner_id = n.owner_id
left join lateral (
  select regexp_replace(s.line, '^#{1,6}\s+', '') as line0
  from (select regexp_replace(l.line, '^[\s ﻿]+|[\s ﻿]+$', '', 'g') as line, l.ord
        from regexp_split_to_table(coalesce(n.body, ''), E'\r?\n') with ordinality as l(line, ord)) s
  where s.line <> ''
  order by s.ord
  limit 1
) fl on true
left join lateral (
  select nullif(concat_ws(' · ',
           case when nullif(btrim(coalesce(n.note_type, '')), '') is not null then '유형: ' || btrim(n.note_type) end,
           (select '주제: ' || string_agg(s.l, ', ' order by s.l)
            from (select distinct v.label as l from rtw_rel v
                  where v.plan_table = 'rtw_notes' and v.plan_id = n.id::text and v.target_type = 'topic' and v.label is not null) s),
           (select '질문: ' || string_agg(s.l, ' / ' order by s.l)
            from (select distinct v.label as l from rtw_rel v
                  where v.plan_table = 'rtw_notes' and v.plan_id = n.id::text and v.target_type = 'question' and v.label is not null) s)
         ), '') as footer,
         (select count(*) from rtw_rel v
          where v.plan_table = 'rtw_notes' and v.plan_id = n.id::text and v.label is not null)::int as n
) f on true
where n.resource_id is null;

-- 4-3. 질문 1개 = 노트 1개. 제목 = 질문(한 줄, 200자), 본문 = 질문 전문 + ## 현재 생각 + 상태.
insert into rtw_plan (src_table, src_id, kind_label, title, raw_text, created_at, updated_at, title_cut, memos, marks, rels)
select 'rtw_questions', q.id::text, '질문',
       coalesce(nullif(btrim(left(t.one, 200)), ''), '(제목 없는 질문)'),
       array_to_string(array_remove(array[
         case when btrim(coalesce(q.body, ''), E' \t\r\n') <> '' then regexp_replace(q.body, '\s+$', '') end,
         case when btrim(coalesce(q.current_thought, ''), E' \t\r\n') <> ''
              then '## 현재 생각' || E'\n\n' || regexp_replace(q.current_thought, '\s+$', '') end,
         '상태: ' || case q.status when 'open' then '열림' when 'closed' then '닫힘' else coalesce(q.status, '알 수 없음') end
       ], null), E'\n\n'),
       q.created_at, coalesce(q.updated_at, q.created_at),
       char_length(t.one) > 200, 0, 0, 0
from public.rtw_questions q
join rtw_ctx c on c.owner_id = q.owner_id
cross join lateral (select btrim(regexp_replace(coalesce(q.body, ''), '\s+', ' ', 'g')) as one) t;

-- 4-4. 글쓰기 기록 1개 = 노트 1개. ## A 처음 쓴 글 / B 피드백 / C 고친 글 / 배운 것 + "종류 · 태그 · 원본 글" 줄.
insert into rtw_plan (src_table, src_id, kind_label, title, raw_text, created_at, updated_at, title_cut, memos, marks, rels)
select 'rtw_records', rec.id::text, '글쓰기 기록',
       coalesce(nullif(btrim(left(t.one, 200)), ''), '(제목 없는 글쓰기 기록)'),
       array_to_string(array_remove(array[
         case when btrim(coalesce(rec.a_original, ''), E' \t\r\n') <> '' then '## A 처음 쓴 글' || E'\n\n' || regexp_replace(rec.a_original, '\s+$', '') end,
         case when btrim(coalesce(rec.b_feedback, ''), E' \t\r\n') <> '' then '## B 피드백' || E'\n\n' || regexp_replace(rec.b_feedback, '\s+$', '') end,
         case when btrim(coalesce(rec.c_revision, ''), E' \t\r\n') <> '' then '## C 고친 글' || E'\n\n' || regexp_replace(rec.c_revision, '\s+$', '') end,
         case when btrim(coalesce(rec.takeaway, ''), E' \t\r\n') <> '' then '## 배운 것' || E'\n\n' || regexp_replace(rec.takeaway, '\s+$', '') end,
         nullif(concat_ws(' · ',
           case when nullif(btrim(coalesce(rec.record_type, '')), '') is not null then '종류: ' || btrim(rec.record_type) end,
           case when cardinality(rec.tags) > 0 then '태그: ' || array_to_string(rec.tags, ', ') end,
           case when src.one is not null then '원본 글: ' || src.one end), '')
       ], null), E'\n\n'),
       rec.created_at, coalesce(rec.updated_at, rec.created_at),
       char_length(t.one) > 200, 0, 0, 0
from public.rtw_records rec
join rtw_ctx c on c.owner_id = rec.owner_id
cross join lateral (select btrim(regexp_replace(coalesce(rec.title, ''), '\s+', ' ', 'g')) as one) t
left join lateral (
  select nullif(btrim(left(regexp_replace(coalesce(rr.title, ''), '\s+', ' ', 'g'), 200)), '') as one
  from public.rtw_resources rr
  where rr.id::text = rec.source_resource_id::text and rr.owner_id = rec.owner_id
  limit 1
) src on true;

-- 4-5. 글쓰기 훈련 기준 1개 = 노트 1개("글쓰기 훈련 기준"). 내용이 비어 있으면 만들지 않는다.
insert into rtw_plan (src_table, src_id, kind_label, title, raw_text, created_at, updated_at)
select 'rtw_writing_context', w.owner_id::text, '훈련 기준', '글쓰기 훈련 기준',
       regexp_replace(w.profile_md, '\s+$', ''),
       coalesce(w.updated_at, now()), coalesce(w.updated_at, now())
from public.rtw_writing_context w
join rtw_ctx c on c.owner_id = w.owner_id
where btrim(coalesce(w.profile_md, ''), E' \t\r\n') <> '';

-- [5단계] 넣기 전 데이터 확인. 글자가 사라지거나 노트 규칙에 안 맞을 것 같으면 멈춘다.
do $$
begin
  if exists (select 1 from public.rtw_notes n join rtw_ctx c on c.owner_id = n.owner_id
             where n.resource_id is not null
               and not exists (select 1 from public.rtw_resources r where r.id = n.resource_id and r.owner_id = n.owner_id)) then
    raise exception 'RTW_COPY_STOP-11: 붙을 글이 없는 메모가 있음(옮기면 글자가 사라짐)';
  end if;
  if exists (select 1 from public.rtw_bookmarks b join rtw_ctx c on c.owner_id = b.owner_id
             where b.resource_id is null
                or not exists (select 1 from public.rtw_resources r where r.id = b.resource_id and r.owner_id = b.owner_id)
                or b.bookmark_type is null or b.bookmark_type not in ('passage', 'resource')) then
    raise exception 'RTW_COPY_STOP-12: 붙을 글이 없거나 종류를 모르는 책갈피가 있음';
  end if;
  if exists (select 1 from rtw_plan where char_length(raw_text) > 100000) then
    raise exception 'RTW_COPY_STOP-13: 본문이 10만 자를 넘는 노트가 있음(노트 규칙 위반)';
  end if;
  if exists (select 1 from rtw_plan where char_length(title) not between 1 and 200 or title ~ '[\r\n]') then
    raise exception 'RTW_COPY_STOP-14: 제목이 1~200자 한 줄 규칙에 안 맞는 노트가 있음';
  end if;
end
$$;

-- [6단계] 실제로 넣기. 읽생기 원본은 select만 했고, 여기서 app_notes에 insert만 한다.
--   날짜는 원래 값 그대로(created_at, updated_at), occurred_at = created_at.
--   metadata.rtw = {table, id, migrated_at, src_updated_at}: 중복 방지·되돌리기 표시·고쳤는지 판별용.
insert into public.app_notes (workspace_id, kind, title, raw_text, occurred_at, created_at, updated_at, metadata)
select c.workspace_id, 'note', p.title, p.raw_text, p.created_at, p.created_at, p.updated_at,
       jsonb_build_object('rtw', jsonb_build_object(
         'table', p.src_table, 'id', p.src_id, 'migrated_at', c.migrated_at, 'src_updated_at', to_jsonb(p.updated_at)))
from rtw_plan p
cross join rtw_ctx c
-- 안전망: 같은 원본이 이미 있으면 넣지 않는다.
where not exists (select 1 from public.app_notes x
                  where x.metadata -> 'rtw' ->> 'table' = p.src_table and x.metadata -> 'rtw' ->> 'id' = p.src_id)
order by p.created_at, p.src_table, p.src_id;

-- [7단계] 넣은 뒤 확인. 개수가 원본과 다르거나 다른 노트가 바뀌었으면 전체 취소.
do $$
declare
  c rtw_ctx%rowtype;
begin
  select * into c from rtw_ctx;
  if (select count(*) from public.app_notes where metadata -> 'rtw' ->> 'migrated_at' = c.migrated_at)
     <> (select count(*) from rtw_plan) then
    raise exception 'RTW_COPY_STOP-21: 넣은 노트 수가 계산한 수와 다름';
  end if;
  if (select count(*) from public.app_notes) <> c.notes_before + (select count(*) from rtw_plan) then
    raise exception 'RTW_COPY_STOP-22: 기존 노트 수가 달라짐';
  end if;
  if exists (select 1 from public.app_notes where metadata -> 'rtw' ->> 'migrated_at' = c.migrated_at
             and (workspace_id <> c.workspace_id or kind <> 'note' or attachments <> '[]'::jsonb or archived_at is not null)) then
    raise exception 'RTW_COPY_STOP-23: 넣은 노트의 작업공간·종류·첨부가 예상과 다름';
  end if;
  if (select count(*) from rtw_plan where src_table = 'rtw_resources')
       <> (select count(*) from public.rtw_resources where owner_id = c.owner_id)
     or (select count(*) from rtw_plan where src_table = 'rtw_notes')
       <> (select count(*) from public.rtw_notes where owner_id = c.owner_id and resource_id is null)
     or (select count(*) from rtw_plan where src_table = 'rtw_questions')
       <> (select count(*) from public.rtw_questions where owner_id = c.owner_id)
     or (select count(*) from rtw_plan where src_table = 'rtw_records')
       <> (select count(*) from public.rtw_records where owner_id = c.owner_id)
     or (select count(*) from rtw_plan where src_table = 'rtw_writing_context')
       <> (select count(*) from public.rtw_writing_context where owner_id = c.owner_id
           and btrim(coalesce(profile_md, ''), E' \t\r\n') <> '') then
    raise exception 'RTW_COPY_STOP-24: 종류별 노트 수가 읽생기 원본 수와 다름';
  end if;
end
$$;
-- ==== 본문 끝 ====

-- [8단계] 해 보기 결과표. 개수만 있고 글 내용은 없다. 판정이 전부 OK(또는 -)이면 실제 실행으로 간다.
create temp table rtw_report on commit drop as
with c as (select * from rtw_ctx),
src as (
  select
    (select count(*) from public.rtw_resources where owner_id = c.owner_id) as res,
    (select count(*) from public.rtw_notes where owner_id = c.owner_id and resource_id is null) as memo_alone,
    (select count(*) from public.rtw_notes where owner_id = c.owner_id and resource_id is not null) as memo_on,
    (select count(*) from public.rtw_questions where owner_id = c.owner_id) as q,
    (select count(*) from public.rtw_records where owner_id = c.owner_id) as rec,
    (select count(*) from public.rtw_writing_context where owner_id = c.owner_id and btrim(coalesce(profile_md, ''), E' \t\r\n') <> '') as wc,
    (select count(*) from public.rtw_bookmarks where owner_id = c.owner_id) as bm,
    (select count(*) from public.rtw_relations where owner_id = c.owner_id) as rel
  from c
),
mv as (select n.* from public.app_notes n, c where n.metadata -> 'rtw' ->> 'migrated_at' = c.migrated_at),
r as (
  select 10 as ord, '개수' as grp, '만들어질 노트 합계' as item, (select count(*) from mv) as val,
         (select res + memo_alone + q + rec + wc from src) as expected, 'eq' as how
  union all select 11, '개수', '읽기 글', (select count(*) from mv where metadata -> 'rtw' ->> 'table' = 'rtw_resources'), (select res from src), 'eq'
  union all select 12, '개수', '독립 메모', (select count(*) from mv where metadata -> 'rtw' ->> 'table' = 'rtw_notes'), (select memo_alone from src), 'eq'
  union all select 13, '개수', '질문', (select count(*) from mv where metadata -> 'rtw' ->> 'table' = 'rtw_questions'), (select q from src), 'eq'
  union all select 14, '개수', '글쓰기 기록', (select count(*) from mv where metadata -> 'rtw' ->> 'table' = 'rtw_records'), (select rec from src), 'eq'
  union all select 15, '개수', '훈련 기준', (select count(*) from mv where metadata -> 'rtw' ->> 'table' = 'rtw_writing_context'), (select wc from src), 'eq'
  union all select 20, '글자로 남긴 것', '글에 붙은 메모(나의 메모 칸)', (select coalesce(sum(memos), 0) from rtw_plan), (select memo_on from src), 'eq'
  union all select 21, '글자로 남긴 것', '책갈피(문장 + 글 전체)', (select coalesce(sum(marks), 0) from rtw_plan), (select bm from src), 'eq'
  union all select 22, '글자로 남긴 것', '연결(주제·질문 줄)', (select coalesce(sum(rels), 0) from rtw_plan), (select rel from src), 'eq'
  union all select 30, '제목 길이', '1~20자', (select count(*) from mv where char_length(title) between 1 and 20), null, 'info'
  union all select 31, '제목 길이', '21~50자', (select count(*) from mv where char_length(title) between 21 and 50), null, 'info'
  union all select 32, '제목 길이', '51~100자', (select count(*) from mv where char_length(title) between 51 and 100), null, 'info'
  union all select 33, '제목 길이', '101~200자', (select count(*) from mv where char_length(title) between 101 and 200), null, 'info'
  union all select 34, '제목 길이', '200자 넘어 잘린 제목', (select count(*) from rtw_plan where title_cut), 0, 'eq'
  union all select 35, '제목 길이', '가장 긴 제목(자)', (select coalesce(max(char_length(title)), 0) from mv), 200, 'max'
  union all select 36, '제목 길이', '인용(>)으로 시작해 제목이 인용문인 독립 메모', (select count(*) from mv where metadata -> 'rtw' ->> 'table' = 'rtw_notes' and title like '>%'), null, 'info'
  union all select 40, '본문 길이', '가장 긴 본문(자)', (select coalesce(max(char_length(raw_text)), 0) from mv), 100000, 'max'
  union all select 41, '본문 길이', '10만 자 넘는 본문', (select count(*) from mv where char_length(raw_text) > 100000), 0, 'eq'
  union all select 42, '본문 길이', '본문이 빈 노트', (select count(*) from mv where raw_text = ''), null, 'info'
  union all select 50, '안전', '작업공간(workspace_id) 종류 수', (select count(distinct workspace_id) from mv), 1, 'eq'
  union all select 51, '안전', '같은 원본이 두 번 들어간 수', (select count(*) - count(distinct (metadata -> 'rtw' ->> 'table', metadata -> 'rtw' ->> 'id')) from mv), 0, 'eq'
  union all select 52, '안전', '시작 전에 이미 옮겨져 있던 노트', (select count(*) from public.app_notes n, c where n.metadata -> 'rtw' is not null and n.metadata -> 'rtw' ->> 'migrated_at' <> c.migrated_at), 0, 'eq'
  union all select 53, '안전', '기존 노트(바구니 등) 수 변화', (select count(*) from public.app_notes) - (select notes_before from c) - (select count(*) from mv), 0, 'eq'
)
select ord, grp as "구분", item as "항목", val::text as "값", coalesce(expected::text, '-') as "기대·원본",
       case how
         when 'info' then '-'
         when 'max' then case when val <= expected then 'OK' else '확인 필요' end
         else case when val is not distinct from expected then 'OK' else '확인 필요' end
       end as "판정"
from r;

-- 결과 표가 안 보일 때(위 set_config를 'yes'로 바꾼 경우)만: 표 내용을 오류 문구로 보여 주고 전체를 취소한다.
do $$
declare
  t text;
begin
  if current_setting('rtw_copy.show_as_error', true) = 'yes' then
    select string_agg(format('%s | %s | 값 %s | 기대 %s | %s', "구분", "항목", "값", "기대·원본", "판정"), E'\n' order by ord)
      into t from rtw_report;
    raise exception E'RTW_COPY_DRYRUN_REPORT (전부 취소됨, 아무것도 안 바뀜)\n%', t;
  end if;
end
$$;

select "구분", "항목", "값", "기대·원본", "판정" from rtw_report order by ord;
-- 아무것도 저장하지 않고 끝낸다. 이 줄이 마지막 줄이어야 한다.
rollback;
