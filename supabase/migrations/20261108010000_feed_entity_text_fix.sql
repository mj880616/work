begin;
-- S52-38 NEWS-글자표기깨짐(요청함 11/08 01:33 'quot; 이 표시 해결'): 이미 저장된 News·사회운동 글 글자에 남은 'quot;'·'middot;'·'hellip;'·'lsquo;'·'rsquo;'·
-- '&quot;'·'&amp;quot;'·'#39;' 같은 표기를 글자(" · … ‘ ’ ')로 바꾼다. 새로 들어오는 글은 수집 함수의 공용 글자 풀기(_shared/html-entities.ts decodeText)가 같은 규칙으로 푼다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지. Edge(news-feed·outside-feed·ai-assist) 배포 뒤에 적용한다.
--
-- 규칙(68단계, 시험 tests/auth-handoff/feed-entity-text-fix.test.mjs가 decodeText와 같은 결과인지 본다):
--   1) '&'(+ 두 번·세 번 감싼 'amp;')가 붙은 정해진 이름·숫자 표기 → 글자(대소문자 무시)
--   2) '&' 빠진 숫자 표기('#39;' 등, 앞 글자가 '&'가 아닐 때)
--   3) '&' 빠진 이름 표기('quot;' 등, 앞 글자가 영문·숫자·'&'가 아닐 때 — 'Volt;'·'camp;' 같은 낱말 끝은 그대로). 'amp;'는 맨 마지막.
--   정해진 목록 밖의 표기는 건드리지 않는다. 태그를 만들지 않는다(글자 칸만, 화면은 글자로 그린다).
-- 무엇(칸): 뉴스 기사 app_news_items(title·title_ko·summary·body·body_ko·publisher), 사회운동 글 app_outside_posts(title·title_ko·summary_ko·key_sentences 글자),
--   사회운동 본문 문장 app_outside_sentences(text), 본문 블록 app_feed_bodies(blocks의 text·cap·alt — src·종류는 그대로).
--   새 비공개 표 app_feed_entity_fixes에 고친 칸의 옛 값·새 값을 남긴 뒤 그 칸만 바꾼다. 행 수·다른 칸(title_key·chars 포함)·권한·정책·함수·트리거는 바꾸지 않는다.
--   고칠 칸이 20000개를 넘으면 아무것도 바꾸지 않고 멈춘다.
-- 권한: 새 표는 RLS 켜고 정책 없음, PUBLIC·anon·authenticated·service_role 권한 모두 회수(화면·API 누구도 읽지 못함, SQL로만).
-- 출력: 글자는 어디에도 내보내지 않는다(사전·사후 확인은 건수·예/아니오·해시만).
-- 되돌리기: 짝 rollback(SQL Editor 전용) — 이 표의 옛 값으로 되돌리고(그 사이 또 바뀐 칸이 있으면 멈춤) 표와 기록 1행을 지운다.
set local lock_timeout = '5s';
set local statement_timeout = '120s';
lock table public.app_news_items, public.app_outside_posts, public.app_outside_sentences, public.app_feed_bodies in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261108010000')
     or to_regclass('public.app_feed_entity_fixes') is not null
     or (select count(*) from supabase_migrations.schema_migrations
         where (version, name) in (('20261031230000', 'outside_statements'), ('20261101233000', 'news_clipping'), ('20261106050000', 'feed_bodies'))) <> 3
     or (select count(*) from pg_attribute where attrelid = 'public.app_news_items'::regclass and not attisdropped
         and ((attname in ('title', 'title_ko', 'summary', 'body', 'body_ko', 'publisher') and atttypid = 'text'::regtype)
           or (attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype))) <> 8
     or (select count(*) from pg_attribute where attrelid = 'public.app_outside_posts'::regclass and not attisdropped
         and ((attname in ('title', 'title_ko', 'summary_ko') and atttypid = 'text'::regtype)
           or (attname = 'key_sentences' and atttypid = 'jsonb'::regtype)
           or (attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype))) <> 6
     or (select count(*) from pg_attribute where attrelid = 'public.app_outside_sentences'::regclass and not attisdropped
         and ((attname = 'text' and atttypid = 'text'::regtype) or (attname = 'idx' and atttypid = 'integer'::regtype)
           or (attname in ('post_id', 'workspace_id') and atttypid = 'uuid'::regtype))) <> 4
     or (select count(*) from pg_attribute where attrelid = 'public.app_feed_bodies'::regclass and not attisdropped
         and ((attname = 'blocks' and atttypid = 'jsonb'::regtype)
           or (attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype))) <> 3
     or exists (select 1 from pg_class where oid in ('public.app_news_items'::regclass, 'public.app_outside_posts'::regclass,
                'public.app_outside_sentences'::regclass, 'public.app_feed_bodies'::regclass) and not relrowsecurity) then
    raise exception 'FEED_ENTITY_FIX_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_feed_entity_fixes (
  tbl text not null,
  row_key text not null,
  col text not null,
  workspace_id uuid not null,
  old_value text not null,
  new_value text not null,
  fixed_at timestamptz not null default now(),
  primary key (tbl, row_key, col),
  constraint app_feed_entity_fixes_tbl_check check (tbl in ('news', 'outside', 'sentence', 'body'))
);

alter table public.app_feed_entity_fixes enable row level security;
revoke all on table public.app_feed_entity_fixes from public, anon, authenticated, service_role;

-- 새 값 계산(쓰기는 이 비공개 표에만). 글자 조각마다 규칙 68단계를 차례로 적용한다.
insert into public.app_feed_entity_fixes (tbl, row_key, col, workspace_id, old_value, new_value)
with recursive r(ord, pat, ch, flags) as (values
    (1, '&(amp;)*quot;', '"', 'gi'),
    (2, '&(amp;)*apos;', '''', 'gi'),
    (3, '&(amp;)*lt;', '<', 'gi'),
    (4, '&(amp;)*gt;', '>', 'gi'),
    (5, '&(amp;)*nbsp;', ' ', 'gi'),
    (6, '&(amp;)*middot;', '·', 'gi'),
    (7, '&(amp;)*hellip;', '…', 'gi'),
    (8, '&(amp;)*lsquo;', '‘', 'gi'),
    (9, '&(amp;)*rsquo;', '’', 'gi'),
    (10, '&(amp;)*ldquo;', '“', 'gi'),
    (11, '&(amp;)*rdquo;', '”', 'gi'),
    (12, '&(amp;)*ndash;', '–', 'gi'),
    (13, '&(amp;)*mdash;', '—', 'gi'),
    (14, '&(amp;)*laquo;', '«', 'gi'),
    (15, '&(amp;)*raquo;', '»', 'gi'),
    (16, '&(amp;)*bull;', '•', 'gi'),
    (17, '&(amp;)*amp;', '&', 'gi'),
    (18, '&(amp;)*#39;', '''', 'gi'),
    (19, '&(amp;)*#039;', '''', 'gi'),
    (20, '&(amp;)*#x27;', '''', 'gi'),
    (21, '&(amp;)*#34;', '"', 'gi'),
    (22, '&(amp;)*#034;', '"', 'gi'),
    (23, '&(amp;)*#x22;', '"', 'gi'),
    (24, '&(amp;)*#183;', '·', 'gi'),
    (25, '&(amp;)*#8216;', '‘', 'gi'),
    (26, '&(amp;)*#8217;', '’', 'gi'),
    (27, '&(amp;)*#8220;', '“', 'gi'),
    (28, '&(amp;)*#8221;', '”', 'gi'),
    (29, '&(amp;)*#8230;', '…', 'gi'),
    (30, '&(amp;)*#8211;', '–', 'gi'),
    (31, '&(amp;)*#8212;', '—', 'gi'),
    (32, '&(amp;)*#160;', ' ', 'gi'),
    (33, '&(amp;)*#38;', '&', 'gi'),
    (34, '&(amp;)*#038;', '&', 'gi'),
    (35, '(?<!&)(amp;)*#39;', '''', 'g'),
    (36, '(?<!&)(amp;)*#039;', '''', 'g'),
    (37, '(?<!&)(amp;)*#x27;', '''', 'g'),
    (38, '(?<!&)(amp;)*#34;', '"', 'g'),
    (39, '(?<!&)(amp;)*#034;', '"', 'g'),
    (40, '(?<!&)(amp;)*#x22;', '"', 'g'),
    (41, '(?<!&)(amp;)*#183;', '·', 'g'),
    (42, '(?<!&)(amp;)*#8216;', '‘', 'g'),
    (43, '(?<!&)(amp;)*#8217;', '’', 'g'),
    (44, '(?<!&)(amp;)*#8220;', '“', 'g'),
    (45, '(?<!&)(amp;)*#8221;', '”', 'g'),
    (46, '(?<!&)(amp;)*#8230;', '…', 'g'),
    (47, '(?<!&)(amp;)*#8211;', '–', 'g'),
    (48, '(?<!&)(amp;)*#8212;', '—', 'g'),
    (49, '(?<!&)(amp;)*#160;', ' ', 'g'),
    (50, '(?<!&)(amp;)*#38;', '&', 'g'),
    (51, '(?<!&)(amp;)*#038;', '&', 'g'),
    (52, '(?<![A-Za-z0-9&])(amp;)*quot;', '"', 'g'),
    (53, '(?<![A-Za-z0-9&])(amp;)*apos;', '''', 'g'),
    (54, '(?<![A-Za-z0-9&])(amp;)*lt;', '<', 'g'),
    (55, '(?<![A-Za-z0-9&])(amp;)*gt;', '>', 'g'),
    (56, '(?<![A-Za-z0-9&])(amp;)*nbsp;', ' ', 'g'),
    (57, '(?<![A-Za-z0-9&])(amp;)*middot;', '·', 'g'),
    (58, '(?<![A-Za-z0-9&])(amp;)*hellip;', '…', 'g'),
    (59, '(?<![A-Za-z0-9&])(amp;)*lsquo;', '‘', 'g'),
    (60, '(?<![A-Za-z0-9&])(amp;)*rsquo;', '’', 'g'),
    (61, '(?<![A-Za-z0-9&])(amp;)*ldquo;', '“', 'g'),
    (62, '(?<![A-Za-z0-9&])(amp;)*rdquo;', '”', 'g'),
    (63, '(?<![A-Za-z0-9&])(amp;)*ndash;', '–', 'g'),
    (64, '(?<![A-Za-z0-9&])(amp;)*mdash;', '—', 'g'),
    (65, '(?<![A-Za-z0-9&])(amp;)*laquo;', '«', 'g'),
    (66, '(?<![A-Za-z0-9&])(amp;)*raquo;', '»', 'g'),
    (67, '(?<![A-Za-z0-9&])(amp;)*bull;', '•', 'g'),
    (68, '(?<![A-Za-z0-9&])(amp;)*amp;', '&', 'g')
),
-- 고칠 후보 글자(표기 낱말이 든 것만). jsonb는 블록·핵심 문장의 글자 칸을 하나씩.
s(v) as (
  select v from public.app_news_items n cross join lateral (values (n.title), (n.title_ko), (n.summary), (n.body), (n.body_ko), (n.publisher)) x(v) where v ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union select v from public.app_outside_posts p cross join lateral (values (p.title), (p.title_ko), (p.summary_ko)) x(v) where v ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union select k.value #>> '{}' from public.app_outside_posts p cross join lateral jsonb_array_elements(case when jsonb_typeof(p.key_sentences) = 'array' then p.key_sentences else '[]'::jsonb end) e
    cross join lateral jsonb_each(case when jsonb_typeof(e) = 'object' then e else '{}'::jsonb end) k where jsonb_typeof(k.value) = 'string' and k.value #>> '{}' ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union select t.text from public.app_outside_sentences t where t.text ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union select k.value #>> '{}' from public.app_feed_bodies b cross join lateral jsonb_array_elements(case when jsonb_typeof(b.blocks) = 'array' then b.blocks else '[]'::jsonb end) e
    cross join lateral jsonb_each(case when jsonb_typeof(e) = 'object' then e else '{}'::jsonb end) k
    where k.key in ('text', 'cap', 'alt') and jsonb_typeof(k.value) = 'string' and k.value #>> '{}' ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
),
fx(v, step, f) as (
  select v, 0, v from s
  union all
  select fx.v, fx.step + 1, regexp_replace(fx.f, r.pat, r.ch, r.flags) from fx join r on r.ord = fx.step + 1
),
fin as (select v, f from fx where step = (select max(ord) from r) and f <> v),
-- 칸별 새 값. jsonb는 같은 모양으로 다시 짓되 고친 글자만 바꾼다(키·순서·다른 값 그대로).
cand(tbl, row_key, col, workspace_id, old_value, new_value) as (
  select 'news', n.id::text, x.col, n.workspace_id, x.v, fin.f
  from public.app_news_items n
  cross join lateral (values ('title', n.title), ('title_ko', n.title_ko), ('summary', n.summary), ('body', n.body), ('body_ko', n.body_ko), ('publisher', n.publisher)) x(col, v)
  join fin on fin.v = x.v
  union all
  select 'outside', p.id::text, x.col, p.workspace_id, x.v, fin.f
  from public.app_outside_posts p
  cross join lateral (values ('title', p.title), ('title_ko', p.title_ko), ('summary_ko', p.summary_ko)) x(col, v)
  join fin on fin.v = x.v
  union all
  select 'outside', p.id::text, 'key_sentences', p.workspace_id, p.key_sentences::text,
    (select jsonb_agg(case when jsonb_typeof(e.value) = 'object' then
        coalesce((select jsonb_object_agg(k.key, case when jsonb_typeof(k.value) = 'string'
           then coalesce((select to_jsonb(fin.f) from fin where fin.v = k.value #>> '{}'), k.value) else k.value end)
         from jsonb_each(e.value) k), e.value)
      else e.value end order by e.ordinality) from jsonb_array_elements(p.key_sentences) with ordinality e)::text
  from public.app_outside_posts p
  where jsonb_typeof(p.key_sentences) = 'array' and jsonb_array_length(p.key_sentences) > 0 and p.key_sentences::text ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union all
  select 'sentence', t.post_id::text || ':' || t.idx::text, 'text', t.workspace_id, t.text, fin.f
  from public.app_outside_sentences t join fin on fin.v = t.text
  union all
  select 'body', b.id::text, 'blocks', b.workspace_id, b.blocks::text,
    (select jsonb_agg(case when jsonb_typeof(e.value) = 'object' then
        coalesce((select jsonb_object_agg(k.key, case when k.key in ('text', 'cap', 'alt') and jsonb_typeof(k.value) = 'string'
           then coalesce((select to_jsonb(fin.f) from fin where fin.v = k.value #>> '{}'), k.value) else k.value end)
         from jsonb_each(e.value) k), e.value)
      else e.value end order by e.ordinality) from jsonb_array_elements(b.blocks) with ordinality e)::text
  from public.app_feed_bodies b
  where jsonb_typeof(b.blocks) = 'array' and jsonb_array_length(b.blocks) > 0 and b.blocks::text ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
)
select tbl, row_key, col, workspace_id, old_value, new_value from cand
where new_value is not null and new_value <> old_value;

do $$
begin
  if (select count(*) from public.app_feed_entity_fixes) > 20000 then
    raise exception 'FEED_ENTITY_FIX_TOO_MANY; stop';
  end if;
end
$$;

update public.app_news_items n set title = f.new_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'title' and f.row_key = n.id::text and n.title = f.old_value;
update public.app_news_items n set title_ko = f.new_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'title_ko' and f.row_key = n.id::text and n.title_ko = f.old_value;
update public.app_news_items n set summary = f.new_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'summary' and f.row_key = n.id::text and n.summary = f.old_value;
update public.app_news_items n set body = f.new_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'body' and f.row_key = n.id::text and n.body = f.old_value;
update public.app_news_items n set body_ko = f.new_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'body_ko' and f.row_key = n.id::text and n.body_ko = f.old_value;
update public.app_news_items n set publisher = f.new_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'publisher' and f.row_key = n.id::text and n.publisher = f.old_value;
update public.app_outside_posts p set title = f.new_value from public.app_feed_entity_fixes f
  where f.tbl = 'outside' and f.col = 'title' and f.row_key = p.id::text and p.title = f.old_value;
update public.app_outside_posts p set title_ko = f.new_value from public.app_feed_entity_fixes f
  where f.tbl = 'outside' and f.col = 'title_ko' and f.row_key = p.id::text and p.title_ko = f.old_value;
update public.app_outside_posts p set summary_ko = f.new_value from public.app_feed_entity_fixes f
  where f.tbl = 'outside' and f.col = 'summary_ko' and f.row_key = p.id::text and p.summary_ko = f.old_value;
update public.app_outside_posts p set key_sentences = f.new_value::jsonb from public.app_feed_entity_fixes f
  where f.tbl = 'outside' and f.col = 'key_sentences' and f.row_key = p.id::text and p.key_sentences::text = f.old_value;
update public.app_outside_sentences t set text = f.new_value from public.app_feed_entity_fixes f
  where f.tbl = 'sentence' and f.col = 'text' and f.row_key = t.post_id::text || ':' || t.idx::text and t.text = f.old_value;
update public.app_feed_bodies b set blocks = f.new_value::jsonb from public.app_feed_entity_fixes f
  where f.tbl = 'body' and f.col = 'blocks' and f.row_key = b.id::text and b.blocks::text = f.old_value;

-- 사후 확인: 남긴 칸마다 지금 값이 새 값, 새 표는 RLS 켜짐·정책 없음·API 역할 권한 없음. 다르면 전체 취소.
do $$
begin
  if (select count(*) from public.app_feed_entity_fixes f where
        case f.tbl
          when 'news' then exists (select 1 from public.app_news_items n where n.id::text = f.row_key and
            case f.col when 'title' then n.title when 'title_ko' then n.title_ko when 'summary' then n.summary
                       when 'body' then n.body when 'body_ko' then n.body_ko when 'publisher' then n.publisher end = f.new_value)
          when 'outside' then exists (select 1 from public.app_outside_posts p where p.id::text = f.row_key and
            case f.col when 'title' then p.title when 'title_ko' then p.title_ko when 'summary_ko' then p.summary_ko
                       when 'key_sentences' then p.key_sentences::text end = f.new_value)
          when 'sentence' then exists (select 1 from public.app_outside_sentences t where t.post_id::text || ':' || t.idx::text = f.row_key and t.text = f.new_value)
          when 'body' then exists (select 1 from public.app_feed_bodies b where b.id::text = f.row_key and b.blocks::text = f.new_value)
        end) <> (select count(*) from public.app_feed_entity_fixes)
     or not exists (select 1 from pg_class where oid = 'public.app_feed_entity_fixes'::regclass and relrowsecurity)
     or exists (select 1 from pg_policy where polrelid = 'public.app_feed_entity_fixes'::regclass)
     or has_table_privilege('anon', 'public.app_feed_entity_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_feed_entity_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_feed_entity_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or exists (select 1 from pg_class where oid = 'public.app_feed_entity_fixes'::regclass and relacl::text ~ '(^|[{,])=')
     or exists (select 1 from pg_class where oid in ('public.app_news_items'::regclass, 'public.app_outside_posts'::regclass,
                'public.app_outside_sentences'::regclass, 'public.app_feed_bodies'::regclass) and not relrowsecurity) then
    raise exception 'FEED_ENTITY_FIX_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261108010000', 'feed_entity_text_fix', array['FEED entity text fix: private table app_feed_entity_fixes (RLS, no policy, all API privileges revoked) keeps old/new values; listed HTML entity names (with &, double-wrapped, or with the & missing) in news items, outside posts, outside sentences and feed body blocks replaced by their characters with the _shared/html-entities.ts decodeText rules (max 20000 values); no other column, row, privilege, policy or function change']);
commit;
