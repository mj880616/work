// NEWS-비마이너프레시안: 시간대 없는 날짜는 한국 매체면 서울 시간, 프레시안은 실제 RSS 주소. 글은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {feedDate, parseFeed} from '../supabase/functions/outside-feed/parse.ts';
import {NEWS_CATALOG, newsSourceByKey} from '../supabase/functions/_shared/news-catalog.ts';
import {allowedUrl} from '../supabase/functions/_shared/outside-catalog.ts';

const NOW = Date.parse('2026-11-04T06:00:00Z');
test('시간대 없는 날짜: 한국 매체는 서울(+9), 외국은 UTC', () => {
  assert.equal(feedDate('2026-11-04 10:00:00', NOW, true), '2026-11-04T01:00:00.000Z');
  assert.equal(feedDate('2026-11-04 03:00:00', NOW, false), '2026-11-04T03:00:00.000Z');
  assert.equal(feedDate('Wed, 04 Nov 2026 10:00:00', NOW, true), '2026-11-04T01:00:00.000Z');
  assert.equal(feedDate('Wed, 04 Nov 2026 10:00:00 +0900', NOW, true), '2026-11-04T01:00:00.000Z');
  assert.equal(feedDate('Wed, 04 Nov 2026 01:00:00 GMT', NOW, true), '2026-11-04T01:00:00.000Z');
  assert.equal(feedDate('2026-11-04T10:00:00+09:00', NOW, true), '2026-11-04T01:00:00.000Z');
  assert.equal(feedDate('2026-11-04T01:00:00Z', NOW, true), '2026-11-04T01:00:00.000Z');
  assert.equal(feedDate('쓰레기', NOW, true), null);
});
test('비마이너 꼴 RSS: 한국어 매체는 pubDate가 서울 시간으로', () => {
  const s = newsSourceByKey('news-beminor');
  const xml = '<rss><channel><item><title>가짜 기사</title><link>https://www.beminor.com/news/articleView.html?idxno=1</link><pubDate>2026-11-04 10:00:00</pubDate><description>가짜 소개</description></item></channel></rss>';
  assert.equal(parseFeed(s, xml, NOW)[0].published_at, '2026-11-04T01:00:00.000Z');
});
test('프레시안: 실제 RSS 주소(안내 쪽 /rss 아님), https 피드와 글 링크를 받음, 운동 매체는 다 받기', () => {
  const s = newsSourceByKey('news-pressian');
  assert.deepEqual(s.lists, ['https://www.pressian.com/api/v3/site/rss/news']);
  assert.ok(allowedUrl(s, s.lists[0]));
  const xml = '<rss><channel><item><title>가짜 프레시안 글</title><link>https://www.pressian.com/pages/articles/1</link><pubDate>Wed, 04 Nov 2026 10:00:00 +0900</pubDate></item></channel></rss>';
  const [it] = parseFeed(s, xml, NOW);
  assert.ok(it); assert.equal(it.published_at, '2026-11-04T01:00:00.000Z');
  for (const k of ['news-labortoday', 'news-beminor', 'news-pressian']) assert.equal(newsSourceByKey(k).take, 'all');
  assert.ok(NEWS_CATALOG.every(c => !c.take || ['all', 'keywords'].includes(c.take)));
});
