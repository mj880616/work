import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCatalog, enabledKeys, groupPosts, isOld, firstSentence, postView, safeUrl, sourceState, errorNote, FEED_SLOTS_KST, feedSlots, feedWhen, ownSourceRows} from '../app/outside-statements-model.mjs';
import {readFileSync} from 'node:fs';

// OUTSIDE-바깥성명 ④ 화면 1(docs/design/outside-statements.md 2·4절): 화면 계산 규칙.
const CATALOG = normalizeCatalog({ok: true, sources: [
  {key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko'},
  {key: 'kptu', name: '공공운수노조', group: 'kptu', lang: 'ko'}, // 옛 서버 카탈로그 묶음 이름도 [노동]으로
  {key: 'laborparty', name: '노동당', group: 'party', lang: 'ko'},
  {key: 'kgreens', name: '녹색당', group: 'party', lang: 'ko'},
  {key: 'jacobin', name: 'Jacobin', group: 'foreign', lang: 'en'},
  {key: 'BAD KEY', name: 'x', group: 'party'},
]});
const NOW = Date.parse('2026-10-31T03:00:00Z'); // 서울 10. 31. 12:00

test('카탈로그는 모양이 맞는 단체만 받는다', () => {
  assert.deepEqual(CATALOG.map(s => s.key), ['kctu', 'kptu', 'laborparty', 'kgreens', 'jacobin']);
  assert.deepEqual(normalizeCatalog(null), []);
  assert.deepEqual(CATALOG.filter(s => s.group === 'labor').map(s => s.key), ['kctu', 'kptu'], '민주노총·공공운수노조는 [노동] 묶음(11/02 00:19)');
});

test('날짜 묶음: 오늘·어제·그 밖 날짜, 서버 순서 유지, 게시 시각 모르는 글은 받은 시각이 아니라 \'날짜 모름\'(11/02 00:17)', () => {
  const posts = [
    {id: 'a', published_at: '2026-10-31T01:00:00Z'},
    {id: 'b', published_at: '2026-10-30T14:00:00Z'},
    {id: 'c', published_at: '2026-10-29T05:00:00Z'},
    {id: 'd', published_at: '2025-12-29T05:00:00Z'},
    {id: 'e', published_at: null, fetched_at: '2026-10-31T02:23:00Z'},
    {id: 'f', published_at: null, fetched_at: '2026-10-31T02:23:00Z'},
  ];
  assert.deepEqual(groupPosts(posts, NOW).map(g => [g.label, g.items.map(p => p.id).join('')]), [['오늘', 'a'], ['어제', 'b'], ['10. 29. (목)', 'c'], ['2025. 12. 29. (월)', 'd'], ['날짜 모름', 'ef']]);
  // 서버 순서가 어떻든 날짜 모름 묶음은 맨 아래(S50-1).
  const mixed = [{id: 'x', published_at: null, fetched_at: '2026-10-31T02:23:00Z'}, ...posts.slice(0, 2)];
  assert.deepEqual(groupPosts(mixed, NOW).map(g => g.label), ['오늘', '어제', '날짜 모름']);
  const unknown = postView({lang: 'ko', kind: 'comment', title: 't', published_at: null, fetched_at: '2026-10-31T13:23:00Z'}, NOW);
  assert.equal(unknown.time, '들어온 날 10.31.', '읽은 시각(22:23)을 게시 시각처럼 보이지 않고 들어온 날만 작게');
  assert.equal(postView({lang: 'ko', title: 't', published_at: null}, NOW).time, '날짜 모름', '받은 시각도 없으면 날짜 모름');
  assert.equal(postView({lang: 'ko', title: 't', published_at: '2026-10-29T15:00:00.000Z'}, NOW).time, '', '날짜만 아는 글은 시각 칸 비움(00:00이라고 쓰지 않음)');
});

test('글 모양: 국내는 본문 펼치기, 외국은 요약·핵심 문장, 2년 지난 글은 제목·요약만', () => {
  const ko = postView({lang: 'ko', kind: 'statement', title: '[성명] 제목', summary_ko: '한 문장 요약이다.', has_body: true, url: 'https://nodong.org/statement/1', published_at: '2026-10-31T01:00:00Z'}, NOW);
  assert.equal(ko.kind, '성명'); assert.equal(ko.body, 'sentences'); assert.equal(ko.lead, '한 문장 요약이다.'); assert.equal(ko.time, '10:00');
  const en = postView({lang: 'en', kind: 'article', title: 'Orig', title_ko: '한국어 제목', summary_ko: '첫 문장임. 둘째 문장임.', key_sentences: [{orig: 'A', ko: '가'}], url: 'https://jacobin.com/x'}, NOW);
  assert.equal(en.title, '한국어 제목'); assert.equal(en.origTitle, 'Orig'); assert.equal(en.lead, '첫 문장임.'); assert.equal(en.body, 'foreign'); assert.deepEqual(en.keys, [{orig: 'A', ko: '가'}]);
  const old = postView({lang: 'ko', kind: 'comment', title: '옛 글', summary_ko: '요약.', has_body: true, published_at: '2024-10-01T00:00:00Z'}, NOW);
  assert.equal(old.old, true); assert.equal(old.body, '', '2년 지난 글은 펼치지 않음');
  assert.equal(isOld({published_at: '2024-11-30T00:00:00Z'}, NOW), false);
  assert.equal(postView({lang: 'ko', has_body: false, title: 't'}, NOW).body, '');
  // 종류 칸: 외국 글·사회운동 글(article)은 보도·논설을 가릴 수 없어 비운다('글'이라고 쓰지 않음).
  assert.equal(en.kind, '');
  assert.equal(postView({lang: 'ko', kind: 'article', title: 't'}, NOW).kind, '');
  assert.equal(postView({lang: 'ko', kind: 'press', title: 't'}, NOW).kind, '보도자료');
  assert.equal(postView({lang: 'ko', kind: 'toString', title: 't'}, NOW).kind, '');
});

test('작은 규칙: 첫 문장·원문 주소·단체 상태', () => {
  assert.equal(firstSentence('노조는 반대한다. 이어서 둘째.'), '노조는 반대한다.');
  assert.equal(firstSentence(''), '');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://kgreens.org/statement?bmode=view&idx=1'), 'https://kgreens.org/statement?bmode=view&idx=1');
  assert.equal(sourceState({enabled: true, last_error: 'robots'}), '못 읽음 · 사이트가 자동 읽기 막음');
  assert.equal(sourceState({enabled: true, last_ok_at: '2026-10-31T09:07:00Z'}), '마지막 10. 31. (토) 18:07');
});

// OUTSIDE-막힌단체: 막힌 까닭을 단체 줄에 작은 글로(서버 단계 코드 → 일상어).
test('막힌 단체 상태 글: 단계 코드마다 까닭 한 줄, 모르는 코드는 읽기 실패', () => {
  assert.equal(sourceState({enabled: true, last_error: 'parse_empty', last_ok_at: '2026-10-31T09:07:00Z'}), '못 읽음 · 사이트 구조 바뀜');
  assert.equal(errorNote('robots_denied'), '못 읽음 · 사이트가 자동 읽기 막음');
  assert.equal(errorNote('bot_check'), '못 읽음 · 사이트가 자동 읽기 막음');
  assert.equal(errorNote('too_large'), '못 읽음 · 목록이 너무 큼');
  assert.equal(errorNote('robots_unreachable'), '못 읽음 · 사이트 응답 없음');
  assert.equal(errorNote('timeout'), '못 읽음 · 사이트 응답 없음');
  assert.equal(errorNote('http_503'), '못 읽음 · 사이트 오류');
  assert.equal(errorNote('http_200'), '못 읽음');
  assert.equal(errorNote('constructor'), '못 읽음');
  assert.equal(errorNote('url_outside'), '못 읽음');
  assert.equal(errorNote(''), '');
});

// OUTSIDE-이름·바로읽기 ③: 목록 위 '마지막으로 읽음 … · 다음 …' 줄.
test('예약 읽기 시각은 Supabase 예약 web2_feed_outside cron(UTC)과 같다', () => {
  // 11/06부터 정해진 시각 실행은 DB 예약(migration 20261106070000, SQL Editor 적용)이 한다. GitHub workflow는 손 실행만.
  const sql = readFileSync(new URL('../supabase/migrations/20261106070000_feed_cron_schedule.sql', import.meta.url), 'utf8');
  const m = /cron\.schedule\('web2_feed_outside',\s*'(\d+) ([\d,]+) \* \* \*'/.exec(sql);
  assert.ok(m, 'web2_feed_outside 예약 한 줄');
  const kst = m[2].split(',').map(h => `${String((Number(h) + 9) % 24).padStart(2, '0')}:${m[1].padStart(2, '0')}`).sort();
  assert.deepEqual(kst, [...FEED_SLOTS_KST]);
});
test('지난·다음 예약 시각(서울 기준, 날 넘김 포함)', () => {
  const at = iso => Date.parse(iso);
  assert.deepEqual(feedSlots(at('2026-11-01T04:42:00Z')), {prev: at('2026-11-01T04:07:00Z'), next: at('2026-11-01T09:07:00Z')});
  // 서울 00:30 → 지난 것은 전날 18:07, 다음은 그날 08:07.
  assert.deepEqual(feedSlots(at('2026-10-31T15:30:00Z')), {prev: at('2026-10-31T09:07:00Z'), next: at('2026-10-31T23:07:00Z')});
  // 예약 시각 그 순간은 지난 것으로 본다.
  assert.equal(feedSlots(at('2026-11-01T04:07:00Z')).prev, at('2026-11-01T04:07:00Z'));
});
test('마지막으로 읽은 시각 · 다음 읽기 한 줄', () => {
  const now = Date.parse('2026-11-01T04:42:00Z'); // 서울 11. 1. 13:42
  assert.equal(feedWhen([], now), '');
  assert.equal(feedWhen([{source_key: 'kctu', enabled: false, last_ok_at: '2026-11-01T02:01:00Z'}], now), '', '켠 단체가 없으면 줄 없음');
  // 13:07 예약이 아직 안 돌았다(마지막 11:01) → 다음 곧.
  assert.equal(feedWhen([{enabled: true, last_ok_at: '2026-11-01T02:01:00Z'}, {enabled: true, last_ok_at: '2026-10-31T09:10:00Z'}], now), '마지막으로 읽음 오늘 11:01 · 다음 곧(13:07 예정분)');
  // 13:07분이 돌았다 → 다음 18:07쯤. 꺼진 단체의 더 늦은 시각은 보지 않는다.
  assert.equal(feedWhen([{enabled: true, last_ok_at: '2026-11-01T04:10:00Z'}, {enabled: false, last_ok_at: '2026-11-01T04:30:00Z'}], now), '마지막으로 읽음 오늘 13:10 · 다음 18:07쯤');
  assert.equal(feedWhen([{enabled: true, last_ok_at: null}], now), '아직 읽지 않음 · 다음 18:07쯤');
  // 저녁 뒤 → 내일 08:07, 어제 읽은 것은 '어제'.
  assert.equal(feedWhen([{enabled: true, last_ok_at: '2026-11-01T09:20:00Z'}], Date.parse('2026-11-01T12:00:00Z')), '마지막으로 읽음 오늘 18:20 · 다음 내일 08:07쯤');
  assert.equal(feedWhen([{enabled: true, last_ok_at: '2026-10-31T09:20:00Z'}], Date.parse('2026-10-31T23:05:00Z')), '마지막으로 읽음 어제 18:20 · 다음 08:07쯤');
});

test('사회운동 Now는 자기 단체 줄만: 뉴스 클리핑 매체(news- 키)는 켬 수·마지막으로 읽음에 섞이지 않음', () => {
  const now = Date.parse('2026-11-01T03:00:00Z');
  const rows = [
    {source_key: 'kctu', enabled: true, last_ok_at: '2026-10-31T09:07:00Z'},
    {source_key: 'news-fake-en', enabled: true, last_ok_at: '2026-11-01T02:30:00Z'},
    null, {source_key: ''}, {enabled: true},
  ];
  const own = ownSourceRows(rows);
  assert.deepEqual(own.map(r => r.source_key), ['kctu']);
  assert.deepEqual(enabledKeys(own), ['kctu']);
  assert.equal(feedWhen(own, now), feedWhen([rows[0]], now));
  assert.ok(feedWhen(own, now).startsWith('마지막으로 읽음 어제'), '뉴스 매체의 더 늦은 시각을 쓰지 않음');
  assert.deepEqual(ownSourceRows(null), []);
});
