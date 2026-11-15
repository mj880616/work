begin;
-- 20261108010000_feed_entity_text_fix의 짝 되돌리기. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow의 rollback 모드는 자료 UPDATE·표 삭제를 막는다).
-- 1) 비공개 표 app_feed_entity_fixes에 남긴 옛 값으로 되돌린다(지금 값이 이번에 바꾼 새 값인 칸만).
-- 2) 그 표와 이번 기록 1행을 지운다. 다른 칸·표·권한·정책·함수는 건드리지 않는다.
-- 적용 뒤 또 바뀐 칸(수집기가 다시 맞춤·번역 버튼 등)이 있거나 행이 지워졌으면 멈춘다(그 칸의 옛 값이 이 표에만 있으므로 표를 지우지 않는다). 그때는 명진이 볼지 정한 뒤 다시 계획한다.
set local lock_timeout = '5s';
set local statement_timeout = '120s';
lock table public.app_news_items, public.app_outside_posts, public.app_outside_sentences, public.app_feed_bodies in share row exclusive mode;
lock table public.app_feed_entity_fixes in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261108010000' and name = 'feed_entity_text_fix') <> 1 then
    raise exception 'FEED_ENTITY_FIX_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_feed_entity_fixes f where not
        case f.tbl
          when 'news' then exists (select 1 from public.app_news_items n where n.id::text = f.row_key and
            case f.col when 'title' then n.title when 'title_ko' then n.title_ko when 'summary' then n.summary
                       when 'body' then n.body when 'body_ko' then n.body_ko when 'publisher' then n.publisher end = f.new_value)
          when 'outside' then exists (select 1 from public.app_outside_posts p where p.id::text = f.row_key and
            case f.col when 'title' then p.title when 'title_ko' then p.title_ko when 'summary_ko' then p.summary_ko
                       when 'key_sentences' then p.key_sentences::text end = f.new_value)
          when 'sentence' then exists (select 1 from public.app_outside_sentences t where t.post_id::text || ':' || t.idx::text = f.row_key and t.text = f.new_value)
          when 'body' then exists (select 1 from public.app_feed_bodies b where b.id::text = f.row_key and b.blocks::text = f.new_value)
          else false
        end) then
    raise exception 'FEED_ENTITY_FIX_ROLLBACK_BLOCKED: some values changed after the fix';
  end if;
end
$$;

update public.app_news_items n set title = f.old_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'title' and f.row_key = n.id::text and n.title = f.new_value;
update public.app_news_items n set title_ko = f.old_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'title_ko' and f.row_key = n.id::text and n.title_ko = f.new_value;
update public.app_news_items n set summary = f.old_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'summary' and f.row_key = n.id::text and n.summary = f.new_value;
update public.app_news_items n set body = f.old_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'body' and f.row_key = n.id::text and n.body = f.new_value;
update public.app_news_items n set body_ko = f.old_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'body_ko' and f.row_key = n.id::text and n.body_ko = f.new_value;
update public.app_news_items n set publisher = f.old_value from public.app_feed_entity_fixes f
  where f.tbl = 'news' and f.col = 'publisher' and f.row_key = n.id::text and n.publisher = f.new_value;
update public.app_outside_posts p set title = f.old_value from public.app_feed_entity_fixes f
  where f.tbl = 'outside' and f.col = 'title' and f.row_key = p.id::text and p.title = f.new_value;
update public.app_outside_posts p set title_ko = f.old_value from public.app_feed_entity_fixes f
  where f.tbl = 'outside' and f.col = 'title_ko' and f.row_key = p.id::text and p.title_ko = f.new_value;
update public.app_outside_posts p set summary_ko = f.old_value from public.app_feed_entity_fixes f
  where f.tbl = 'outside' and f.col = 'summary_ko' and f.row_key = p.id::text and p.summary_ko = f.new_value;
update public.app_outside_posts p set key_sentences = f.old_value::jsonb from public.app_feed_entity_fixes f
  where f.tbl = 'outside' and f.col = 'key_sentences' and f.row_key = p.id::text and p.key_sentences::text = f.new_value;
update public.app_outside_sentences t set text = f.old_value from public.app_feed_entity_fixes f
  where f.tbl = 'sentence' and f.col = 'text' and f.row_key = t.post_id::text || ':' || t.idx::text and t.text = f.new_value;
update public.app_feed_bodies b set blocks = f.old_value::jsonb from public.app_feed_entity_fixes f
  where f.tbl = 'body' and f.col = 'blocks' and f.row_key = b.id::text and b.blocks::text = f.new_value;

drop table public.app_feed_entity_fixes;

delete from supabase_migrations.schema_migrations
  where version = '20261108010000' and name = 'feed_entity_text_fix';
commit;
