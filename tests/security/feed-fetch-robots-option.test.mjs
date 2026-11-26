// S68-23: 공용 읽기(_shared/feed-fetch.ts)의 robots.txt 건너뛰기는 '부르는 쪽이 skipRobots: true를 명시할 때만'이다.
// 사용자 결정 2026-11-22 "1. A": 사람이 직접 저장한 기사 한 쪽(note-import)만 robots.txt를 보지 않는다. 자동 수집(news-feed·now-detail-build 등)은 그대로 지킨다.
// 네트워크 없음: 사이트는 모두 지어낸 응답이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

const F = await import('../../supabase/functions/_shared/feed-fetch.ts');
const PAGE = 'https://example.org/news/1';
const ARTICLE = '<html><body><article><p>합성 문단</p></article></body></html>';

function reader(extra = {}, robots = 'User-agent: *\nDisallow: /') {
  const sent = [];
  const doFetch = async (url) => {
    sent.push(url);
    const u = new URL(url);
    if (u.pathname === '/robots.txt') return new Response(robots, {status: 200, headers: {'content-type': 'text/plain'}});
    if (u.href === 'https://example.org/hop') return new Response(null, {status: 302, headers: {location: 'https://other.example.net/x'}});
    return new Response(ARTICLE, {status: 200, headers: {'content-type': 'text/html'}});
  };
  const allow = (raw) => { try { const u = new URL(raw); return u.protocol === 'https:' && !u.hostname.startsWith('inside') ? u : null; } catch { return null; } };
  const r = F.makeFeedReader({doFetch, sleep: async () => {}, log: () => {}, userAgent: 'synthetic', robotsAgent: 'synthetic', gapMs: 0, allow, ...extra});
  return {r, sent};
}

test('기본값(옵션 없음)과 true가 아닌 값은 robots.txt를 읽고, 막히면 글을 읽지 않는다', async () => {
  for (const extra of [{}, {skipRobots: false}, {skipRobots: 'true'}, {skipRobots: 1}, {skipRobots: undefined}, {skipRobots: null}]) {
    const {r, sent} = reader(extra);
    const got = await r.get(PAGE, F.ACCEPT_HTML);
    assert.deepEqual(got, {ok: false, code: 'robots'}, JSON.stringify(extra));
    assert.deepEqual(sent, ['https://example.org/robots.txt'], JSON.stringify(extra));
  }
});

test('skipRobots: true면 robots.txt를 읽지 않고 글만 한 번 읽는다 — 주소 재검사(allow)·리다이렉트 막기는 그대로', async () => {
  const {r, sent} = reader({skipRobots: true});
  const got = await r.get(PAGE, F.ACCEPT_HTML);
  assert.equal(got.ok, true);
  assert.deepEqual(sent, [PAGE]);
  // allow 밖 주소는 처음부터 묻지 않는다.
  const a = reader({skipRobots: true});
  assert.deepEqual(await a.r.get('https://inside.example.net/x', F.ACCEPT_HTML), {ok: false, code: 'url_outside'});
  assert.deepEqual(a.sent, []);
  // 리다이렉트가 allow 밖을 가리키면 그쪽으로 요청하지 않는다.
  const b = reader({skipRobots: true, allow: (raw) => { const u = new URL(raw); return u.hostname === 'example.org' ? u : null; }});
  assert.deepEqual(await b.r.get('https://example.org/hop', F.ACCEPT_HTML), {ok: false, code: 'redirect_outside'});
  assert.deepEqual(b.sent, ['https://example.org/hop']);
});

test('skipRobots를 넘기는 함수는 note-import·news-feed 원문 reader·outside-feed 지난 글 다시 읽기뿐이다(피드·다른 수집 함수는 기본값 robots 확인)', () => {
  const root = 'supabase/functions';
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mjs|js)$/.test(name) && /skipRobots/.test(readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  walk(root);
  assert.deepEqual(hits.sort(), ['supabase/functions/_shared/feed-fetch.ts', 'supabase/functions/collector-feed/handler.ts', 'supabase/functions/news-feed/handler.ts', 'supabase/functions/note-import/handler.ts', 'supabase/functions/outside-feed/handler.ts']);
  const handler = readFileSync('supabase/functions/note-import/handler.ts', 'utf8');
  assert.match(handler, /skipRobots: SKIP_ROBOTS,/);
  // S68-25(사용자 결정 2026-11-22): News 원문 reader 두 개(page·open)만 건너뛴다. 매체 피드 reader(catalog)는 robots 확인 그대로.
  const news = readFileSync('supabase/functions/news-feed/handler.ts', 'utf8');
  assert.equal((news.match(/skipRobots: ARTICLE_SKIP_ROBOTS/g) || []).length, 2);
  assert.match(news, /catalog: \(s, person = false\) => makeFeedReader\(\{ \.\.\.base, allow: \(raw\) => allowedUrl\(s, raw\), \.\.\.t\(person\) \}\)/);
  assert.match(readFileSync('supabase/functions/_shared/now-detail-build.ts', 'utf8'), /makeFeedReader\(/);
  // S69 NEWS-제목늘읽기: collector-feed는 새로 들어온 기사 주소 한 장의 제목 읽기 reader 한 곳만(열린 주소 규칙, 기사 한 쪽 — news-feed 원문 reader와 같은 규칙).
  const collector = readFileSync('supabase/functions/collector-feed/handler.ts', 'utf8');
  assert.equal((collector.match(/skipRobots: true/g) || []).length, 1);
  assert.match(collector, /allow: openArticleUrl, now, skipRobots: true \}\);/);
  // S68-43: outside-feed는 이미 받아 둔 글 한 쪽 다시 읽기(rereadPage — 예약 robots 다시 읽기·[원문 다시 가져오기]) 한 곳만 넘기고, 피드(wantFeed) 읽기는 무시한다.
  const outside = readFileSync('supabase/functions/outside-feed/handler.ts', 'utf8');
  assert.equal((outside.match(/\{ skipRobots: true \}/g) || []).length, 1);
  assert.match(outside, /const page = await reader\.get\(source, url, false, \{ skipRobots: true \}\);/);
  assert.match(outside, /const exempt = robotsExempt\(source\) \|\| \(!wantFeed && opts\?\.skipRobots === true\);/);
});
