import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ALL, normalizeCatalog, enabledKeys, chipsOf, keysOf, keepChip, groupPosts, isOld, firstSentence, postView, safeUrl, bodyText, isFresh, sourceState} from '../app/outside-statements-model.mjs';

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

test('칩 줄: 전체 + 켠 단체가 있는 묶음 + 둘 이상 켜진 묶음의 단체 낱개', () => {
  const on = enabledKeys([{source_key: 'kctu', enabled: true}, {source_key: 'laborparty', enabled: true}, {source_key: 'kgreens', enabled: true}, {source_key: 'jacobin', enabled: false}]);
  const chips = chipsOf(CATALOG, on);
  assert.deepEqual(chips.map(c => c.label), ['전체', '민주노총', '정당', '노동당', '녹색당']);
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
});

test('작은 규칙: 첫 문장·원문 주소·본문 잇기·새 글·단체 상태', () => {
  assert.equal(firstSentence('노조는 반대한다. 이어서 둘째.'), '노조는 반대한다.');
  assert.equal(firstSentence(''), '');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://kgreens.org/statement?bmode=view&idx=1'), 'https://kgreens.org/statement?bmode=view&idx=1');
  assert.equal(bodyText([{idx: 1, text: '둘.'}, {idx: 0, text: '하나.'}]), '하나. 둘.');
  assert.equal(isFresh({fetched_at: '2026-10-31T00:00:00Z'}, '2026-10-30T00:00:00Z'), true);
  assert.equal(isFresh({fetched_at: '2026-10-31T00:00:00Z'}, null), false);
  assert.equal(sourceState({enabled: true, last_error: 'robots'}), '사이트가 자동 읽기를 막음');
  assert.equal(sourceState({enabled: true, last_ok_at: '2026-10-31T09:07:00Z'}), '마지막 10. 31. (토) 18:07');
});
