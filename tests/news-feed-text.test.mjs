// NEWS-태그글자: 출처별 가짜 RSS 한 건씩 — 요약·본문에 태그·&nbsp;가 글자로 남지 않는다(제목과 같은 순서). 글은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed, feedText} from '../supabase/functions/outside-feed/parse.ts';
import {NEWS_CATALOG} from '../supabase/functions/_shared/news-catalog.ts';

const NOW = Date.parse('2026-11-04T03:00:00Z');
const BAD = /<\/?[a-z][^>]*>|&nbsp;|&lt;|&gt;|&amp;nbsp/i;
const escHtml = h => h.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = '<div class="field-body x"><p><span lang="EN-GB"><strong>Fake lead&nbsp;</strong>second sentence.</span></p></div>';
const item = (src, desc, extra = '') => {
  const key = NEWS_CATALOG.find(s => s.key === src);
  const host = key.hosts[0];
  return {key, xml: `<rss><channel><item><title>Fake &amp;amp; title</title><link>https://${host}/a/1</link><pubDate>Wed, 04 Nov 2026 01:00:00 +0000</pubDate><description>${desc}</description>${extra}</item></channel></rss>`};
};
const cases = [
  ['news-itf', escHtml(html)],                         // 한 번 더 이스케이프돼 오는 모양
  ['news-psi', '<![CDATA[' + html + ']]>'],             // CDATA 안 HTML
  ['news-labortoday', '<![CDATA[<p>가짜 노동 기사&nbsp;첫 줄</p>]]>'],
  ['news-beminor', escHtml('<p>가짜 장애 기사 &nbsp;첫 줄</p>')],
  ['news-pressian', '가짜 &lt;b&gt;굵은&lt;/b&gt; 글'],
  ['news-labourstart', escHtml(html)],
];
for (const [src, desc] of cases) {
  test(`요약에 태그 글자 없음: ${src}`, () => {
    const {key, xml} = item(src, desc, `<content:encoded>${desc}</content:encoded>`);
    const [it] = parseFeed(key, xml, NOW);
    assert.ok(it, '글 한 건');
    assert.ok(it.summary && !BAD.test(it.summary), `summary: ${it.summary}`);
    assert.ok(it.content && !BAD.test(it.content), `content: ${it.content}`);
    assert.ok(!BAD.test(it.title), it.title);
  });
}
test('feedText: 풀기 → 태그 걷기 → 다시 풀기, 문단 줄바꿈 유지', () => {
  assert.equal(feedText(escHtml('<p>하나&nbsp;둘</p><p>셋</p>')), '하나 둘\n셋');
  assert.equal(feedText('평범한 글'), '평범한 글');
});
