import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ALL, normalizeCatalog, enabledKeys, chipsOf, subChipsOf, chipPressed, keysOf, keepChip, groupPosts, isOld, firstSentence, postView, safeUrl, bodyText, isFresh, sourceState, errorNote, FEED_SLOTS_KST, feedSlots, feedWhen} from '../app/outside-statements-model.mjs';
import {readFileSync} from 'node:fs';

// OUTSIDE-바깥성명 ④ 화면 1(docs/design/outside-statements.md 2·4절): 화면 계산 규칙.
const CATALOG = normalizeCatalog({ok: true, sources: [
  {key: 'kctu', name: '민주노총', group: 'kctu', lang: 'ko'},
  {key: 'kptu', name: '공공운수노조', group: 'kptu', lang: 'ko'},
  {key: 'laborparty', name: '노동당', group: 'party', lang: 'ko'},
  {key: 'kgreens', name: '녹색당', group: 'party', lang: 'ko'},
  {key: 'jacobin', name: 'Jacobin', group: 'foreign', lang: 'en'},
  {key: 'BAD KEY', name: 'x', group: 'party'},
]});
const NOW = Date.parse('2026-10-31T03:00:00Z'); // 서울 10. 31. 12:00

test('카탈로그는 모양이 맞는 단체만 받는다', () => {
  assert.deepEqual(CATALOG.map(s => s.key), ['kctu', 'kptu', 'laborparty', 'kgreens', 'jacobin']);
  assert.deepEqual(normalizeCatalog(null), []);
});

test('칩 줄: 첫 줄은 전체 + 켠 단체가 있는 묶음만, 단체 낱개는 묶음을 고르면 둘째 줄에(둘 이상 켜진 묶음만)', () => {
  const on = enabledKeys([{source_key: 'kctu', enabled: true}, {source_key: 'laborparty', enabled: true}, {source_key: 'kgreens', enabled: true}, {source_key: 'jacobin', enabled: false}]);
  const chips = chipsOf(CATALOG, on);
  assert.deepEqual(chips.map(c => c.label), ['전체', '민주노총', '정당'], '첫 줄에 단체 낱개가 섞이지 않음');
  assert.deepEqual(subChipsOf(CATALOG, on, ALL), [], '묶음을 안 고르면 둘째 줄 없음');
  assert.deepEqual(subChipsOf(CATALOG, on, 'g:kctu'), [], '단체가 하나뿐인 묶음은 둘째 줄 없음');
  assert.deepEqual(subChipsOf(CATALOG, on, 'g:party').map(c => [c.id, c.label]), [['s:laborparty', '노동당'], ['s:kgreens', '녹색당']]);
  assert.deepEqual(subChipsOf(CATALOG, on, 's:kgreens').map(c => c.id), ['s:laborparty', 's:kgreens'], '단체를 골라도 둘째 줄 유지');
  assert.equal(chipPressed('g:party', 's:kgreens', CATALOG), true, '단체를 고르면 그 묶음 칩도 눌린 모양');
  assert.equal(chipPressed('g:kctu', 's:kgreens', CATALOG), false);
  assert.equal(chipPressed('s:kgreens', 's:kgreens', CATALOG), true);
  assert.equal(keepChip('s:kgreens', [...chips, ...subChipsOf(CATALOG, on, 's:kgreens')]), 's:kgreens');
  assert.equal(keysOf(ALL, CATALOG, on), null);
  assert.deepEqual(keysOf('g:party', CATALOG, on), ['laborparty', 'kgreens']);
  assert.deepEqual(keysOf('s:kgreens', CATALOG, on), ['kgreens']);
  assert.equal(keepChip('g:foreign', chips), ALL, '없어진 칩은 전체로');
  assert.deepEqual(chipsOf(CATALOG, []).map(c => c.id), [ALL]);
});

test('날짜 묶음: 오늘·어제·그 밖 날짜, 서버 순서 유지', () => {
  const posts = [
    {id: 'a', published_at: '2026-10-31T01:00:00Z'},
    {id: 'b', published_at: null, fetched_at: '2026-10-30T14:00:00Z'},
    {id: 'c', published_at: '2026-10-29T05:00:00Z'},
    {id: 'd', published_at: '2025-12-29T05:00:00Z'},
  ];
  assert.deepEqual(groupPosts(posts, NOW).map(g => [g.label, g.items.map(p => p.id).join('')]), [['오늘', 'a'], ['어제', 'b'], ['10. 29. (목)', 'c'], ['2025. 12. 29. (월)', 'd']]);
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

test('작은 규칙: 첫 문장·원문 주소·본문 잇기·새 글·단체 상태', () => {
  assert.equal(firstSentence('노조는 반대한다. 이어서 둘째.'), '노조는 반대한다.');
  assert.equal(firstSentence(''), '');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://kgreens.org/statement?bmode=view&idx=1'), 'https://kgreens.org/statement?bmode=view&idx=1');
  assert.equal(bodyText([{idx: 1, text: '둘.'}, {idx: 0, text: '하나.'}]), '하나. 둘.');
  assert.equal(isFresh({fetched_at: '2026-10-31T00:00:00Z'}, '2026-10-30T00:00:00Z'), true);
  assert.equal(isFresh({fetched_at: '2026-10-31T00:00:00Z'}, null), false);
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
test('예약 읽기 시각은 outside-feed.yml cron(UTC)과 같다', () => {
  const yml = readFileSync(new URL('../.github/workflows/outside-feed.yml', import.meta.url), 'utf8');
  const m = /cron:\s*'(\d+) ([\d,]+) \* \* \*'/.exec(yml);
  assert.ok(m, 'cron 한 줄');
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
