// Synthetic stand-in for the RTW (읽생기) tables. Fake rows only: no production data, no real names, no real text.
// Column names follow the owner-confirmed list in docs/design/rtw-note-unify-investigation.md (7.1/7.2).
export const ME = '20000000-0000-4000-8000-000000000001'; // same person as the Web2 owner in basket4-fixture.mjs
export const FRIEND = '20000000-0000-4000-8000-0000000000f1';
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ID = {
  R1: id(1), R2: id(2), R3: id(3), R4: id(4), RF: id(5),
  N1: id(11), N2: id(12), N3: id(13), N4: id(14), NA: id(15), NB: id(16), NF: id(17),
  Q1: id(21), Q2: id(22), T1: id(31), T2: id(32), TF: id(33),
  REC1: id(41), REC2: id(42),
};

export const rtwSchema = `
  create table public.rtw_resources(id uuid primary key, owner_id uuid not null, title text, original_title text, author text, source_name text,
    published_on date, original_url text, body_md text, visibility text default 'private', created_at timestamptz not null, updated_at timestamptz not null);
  create table public.rtw_notes(id uuid primary key, owner_id uuid not null, resource_id uuid references public.rtw_resources(id), body text, note_type text,
    created_at timestamptz not null, updated_at timestamptz not null);
  create table public.rtw_bookmarks(id uuid primary key, owner_id uuid not null, resource_id uuid references public.rtw_resources(id), bookmark_type text,
    selected_text text, context_before text, context_after text, start_offset int, end_offset int, note text, created_at timestamptz not null, updated_at timestamptz not null);
  create table public.rtw_questions(id uuid primary key, owner_id uuid not null, body text, current_thought text, status text,
    created_at timestamptz not null, updated_at timestamptz not null);
  create table public.rtw_topics(id uuid primary key, owner_id uuid not null, name text, slug text, summary text, created_at timestamptz not null, updated_at timestamptz not null);
  create table public.rtw_relations(id uuid primary key default gen_random_uuid(), owner_id uuid not null, source_type text, source_id uuid,
    target_type text, target_id uuid, relation_type text default 'related', created_at timestamptz not null default now());
  create table public.rtw_records(id uuid primary key, owner_id uuid not null, record_type text, title text, source_resource_id uuid,
    a_original text, b_feedback text, c_revision text, takeaway text, tags text[], origin text, created_at timestamptz not null, updated_at timestamptz not null);
  create table public.rtw_writing_context(owner_id uuid primary key, profile_md text, updated_at timestamptz not null);
  create table public.rtw_note_types(id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text, created_at timestamptz not null default now());
  create table public.rtw_personal_mode(id text primary key, owner_id uuid not null, claimed_at timestamptz not null default now());
`;

const long = n => '가'.repeat(n);
export const rtwData = `
  insert into public.rtw_personal_mode(id, owner_id, claimed_at) values ('owner', '${ME}', '2026-09-01 00:00+09');
  insert into public.rtw_topics(id, owner_id, name, slug, summary, created_at, updated_at) values
    ('${ID.T1}', '${ME}', '주제 하나', 't1', null, '2026-08-01 09:00+09', '2026-08-01 09:00+09'),
    ('${ID.T2}', '${ME}', '주제 둘', 't2', '', '2026-08-01 09:00+09', '2026-08-01 09:00+09'),
    ('${ID.TF}', '${FRIEND}', '지인 주제', 'tf', null, '2026-08-01 09:00+09', '2026-08-01 09:00+09');
  -- R1: every part (link, author, source, date, memos, passage + whole-article bookmarks, topics, question).
  insert into public.rtw_resources(id, owner_id, title, original_title, author, source_name, published_on, original_url, body_md, created_at, updated_at) values
    ('${ID.R1}', '${ME}', '시험 글 하나', '원문 [제목] 하나', '저자 갑', '출처 을', '2026-09-18', 'https://example.test/a(1) b', E'본문 첫 줄\\n\\n본문 둘째 줄\\n', '2026-09-01 09:00+09', '2026-09-05 12:00+09'),
    -- R2: 250-char multi-line title (cut to 200), no URL, no body.
    ('${ID.R2}', '${ME}', E'둘째\\n${long(250)}', null, null, null, null, null, null, '2026-09-02 09:00+09', '2026-09-02 09:00+09'),
    -- R3: non-web address, author only.
    ('${ID.R3}', '${ME}', '셋째 글', null, '저자 병', null, null, 'ftp://example.test/x', '셋째 본문', '2026-09-03 09:00+09', '2026-09-03 09:00+09'),
    -- R4: blank title falls back to the original title.
    ('${ID.R4}', '${ME}', '  ', '원문 제목 넷', null, null, null, '', E'넷째 본문\\n\\n\\n', '2026-09-04 09:00+09', '2026-09-04 09:00+09'),
    ('${ID.RF}', '${FRIEND}', '지인 글', null, null, null, null, null, '지인 본문', '2026-09-04 09:00+09', '2026-09-04 09:00+09');
  insert into public.rtw_notes(id, owner_id, resource_id, body, note_type, created_at, updated_at) values
    ('${ID.NA}', '${ME}', '${ID.R1}', E'첫 메모 첫 줄\\n## 메모 안 제목\\n\\n마지막 줄', '생각', '2026-09-06 09:00+09', '2026-09-06 09:00+09'),
    ('${ID.NB}', '${ME}', '${ID.R3}', '둘째 메모', null, '2026-09-07 09:00+09', '2026-09-07 09:00+09'),
    ('${ID.N1}', '${ME}', null, E'# 제목 줄이 먼저\\n\\n독립 메모 본문', '생각', '2026-09-10 09:00+09', '2026-09-11 09:00+09'),
    ('${ID.N2}', '${ME}', null, E'> 인용으로 시작\\n\\n내 생각', '질문', '2026-09-12 09:00+09', '2026-09-12 09:00+09'),
    ('${ID.N3}', '${ME}', null, E'\\n\\n   공백 있는 첫 줄  \\n둘째 줄', '생각', '2026-09-13 09:00+09', '2026-09-13 09:00+09'),
    ('${ID.N4}', '${ME}', null, '', null, '2026-09-14 09:00+09', '2026-09-14 09:00+09'),
    ('${ID.NF}', '${FRIEND}', null, '지인 메모', '생각', '2026-09-14 09:00+09', '2026-09-14 09:00+09');
  insert into public.rtw_bookmarks(id, owner_id, resource_id, bookmark_type, selected_text, note, start_offset, end_offset, created_at, updated_at) values
    (gen_random_uuid(), '${ME}', '${ID.R1}', 'passage', E'뒤쪽 문장\\n두 줄', '뒤쪽 메모', 50, 60, '2026-09-08 09:00+09', '2026-09-08 09:00+09'),
    (gen_random_uuid(), '${ME}', '${ID.R1}', 'passage', '앞쪽 문장', null, 5, 9, '2026-09-08 10:00+09', '2026-09-08 10:00+09'),
    (gen_random_uuid(), '${ME}', '${ID.R1}', 'resource', null, '글 전체 메모', null, null, '2026-09-08 11:00+09', '2026-09-08 11:00+09'),
    (gen_random_uuid(), '${ME}', '${ID.R3}', 'resource', null, null, null, null, '2026-09-08 11:00+09', '2026-09-08 11:00+09'),
    (gen_random_uuid(), '${FRIEND}', '${ID.RF}', 'passage', '지인 문장', null, 1, 2, '2026-09-08 11:00+09', '2026-09-08 11:00+09');
  insert into public.rtw_questions(id, owner_id, body, current_thought, status, created_at, updated_at) values
    ('${ID.Q1}', '${ME}', E'열린 질문입니다\\n둘째 줄', '지금 생각은 이렇다', 'open', '2026-09-15 09:00+09', '2026-09-16 09:00+09'),
    ('${ID.Q2}', '${ME}', '닫힌 질문', null, 'closed', '2026-09-17 09:00+09', '2026-09-17 09:00+09');
  insert into public.rtw_relations(owner_id, source_type, source_id, target_type, target_id) values
    ('${ME}', 'resource', '${ID.R1}', 'topic', '${ID.T1}'),
    ('${ME}', 'resource', '${ID.R1}', 'topic', '${ID.T2}'),
    ('${ME}', 'note', '${ID.NA}', 'question', '${ID.Q1}'),
    ('${ME}', 'note', '${ID.NA}', 'topic', '${ID.T1}'),
    ('${ME}', 'note', '${ID.N1}', 'topic', '${ID.T2}'),
    ('${ME}', 'resource', '${ID.R3}', 'question', '${ID.Q2}'),
    ('${FRIEND}', 'resource', '${ID.RF}', 'topic', '${ID.TF}');
  insert into public.rtw_records(id, owner_id, record_type, title, source_resource_id, a_original, b_feedback, c_revision, takeaway, tags, origin, created_at, updated_at) values
    ('${ID.REC1}', '${ME}', '연습', '기록 하나', '${ID.R1}', '처음 쓴 글', '피드백 글', '고친 글', '배운 것 글', '{태그가,태그나}', 'manual', '2026-09-20 09:00+09', '2026-09-21 09:00+09'),
    ('${ID.REC2}', '${ME}', '연습', '', null, '처음만 있음', null, null, null, '{}', 'manual', '2026-09-22 09:00+09', '2026-09-22 09:00+09');
  insert into public.rtw_writing_context(owner_id, profile_md, updated_at) values
    ('${ME}', E'# 훈련 기준\\n\\n짧게 쓴다.\\n', '2026-09-25 09:00+09'),
    ('${FRIEND}', '지인 기준', '2026-09-25 09:00+09');
  insert into public.rtw_note_types(owner_id, name) values ('${ME}', '생각'), ('${ME}', '질문');
`;

// Expected planned notes for the fake data above: 4 articles + 4 standalone memos + 2 questions + 2 records + 1 training standard.
export const EXPECTED = { resources: 4, memos: 4, questions: 2, records: 2, context: 1, total: 13, memosOnArticles: 2, bookmarks: 4, relations: 6 };
