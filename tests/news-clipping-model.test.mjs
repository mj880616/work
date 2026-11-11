// NEWS-클리핑 C1 화면 계산(app/news-clipping-model.mjs). 글은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/news-clipping-model.mjs';

const NOW = Date.parse('2026-11-01T03:00:00Z'); // 서울 12:00

test('한 목록: 채널/자동 구분 없음 — 목록·별표 폴더 칸 걸러내기 조건(S51-8: 칩 줄은 없앰)', () => {
  assert.equal(M.tagOf, undefined); assert.equal(M.CHANNEL, undefined); assert.equal(M.AUTO, undefined);
  assert.equal(M.laneFilter(M.ALL), '');
  assert.equal(M.TABS, undefined); assert.equal(M.keepTab, undefined);
  assert.equal(M.laneFilter(M.STAR), '&starred_at=not.is.null');
  assert.equal(M.orderOf(M.STAR), 'starred_at.desc,id.desc');
  assert.equal(M.orderOf(M.ALL), 'created_at.desc,id.desc');
  assert.equal(M.itemView({id: '1', lane: 'channel', lang: 'ko', title: 'T', url: 'https://example.org/a'}).tag, undefined);
});

test('글자만: 저장된 글에 남은 태그·&nbsp;를 화면에서 걷는다(ITF 모양, 가짜 글)', () => {
  const raw = '<span class="field-title">Fake heading</span> <div class="field-body x"><p><span lang="EN-GB"><strong>Lead&nbsp;</strong>second part &amp; more</span></p></div>';
  assert.equal(M.plainText(raw), 'Fake heading Lead second part & more');
  assert.equal(M.plainText('이미 깨끗한 글'), '이미 깨끗한 글');
  assert.equal(M.plainText('&lt;p&gt;Esc&amp;nbsp;aped&lt;/p&gt;'), 'Esc aped');
  const v = M.itemView({id: '9', lane: 'media', lang: 'en', title: 'Plain', title_ko: '가짜 제목', summary: raw, state: 'ok', url: 'https://example.org/i'});
  assert.ok(!/[<>]|&nbsp;/.test(v.summary), v.summary);
});

test('줄 보임: 요약 늘 보임, 외국어 제목은 미리 번역한 한국어 + 원제 작게, 본문 번역은 고를 때만, 유료는 공개 요약 표시', () => {
  const en = {id: '1', lane: 'media', lang: 'en', title: 'A synthetic title', title_ko: '가짜 제목', translated_at: '2026-11-01T01:00:00Z', summary: 'One line.', state: 'ok', body_kind: 'full', url: 'https://example.org/a', created_at: '2026-11-01T02:00:00Z'};
  const v = M.itemView(en);
  assert.equal(v.title, '가짜 제목'); assert.equal(v.origTitle, 'A synthetic title'); assert.equal(v.titleLang, '');
  assert.equal(v.summary, 'One line.'); assert.equal(v.foreign, true); assert.equal(v.showingKo, false, '본문은 원문부터');
  const ko = M.itemView(en, {showKo: true});
  assert.equal(ko.title, '가짜 제목'); assert.equal(ko.showingKo, true);
  const raw = M.itemView({...en, translated_at: null, title_ko: null});
  assert.equal(raw.title, 'A synthetic title'); assert.equal(raw.origTitle, ''); assert.equal(raw.titleLang, 'en', '제목 번역 전이면 원제(lang 표시)');
  const kr = M.itemView({...en, lang: 'ko', title: '한국어 기사', title_ko: '엉뚱한 값'});
  assert.equal(kr.title, '한국어 기사'); assert.equal(kr.origTitle, '', '한국어 기사는 title_ko를 쓰지 않음');
  const paid = M.itemView({id: '2', lane: 'channel', lang: 'ko', title: '가짜 유료 기사', state: 'paywall', body_kind: 'lead', url: 'https://example.org/p', created_at: '2026-11-01T02:00:00Z'});
  assert.equal(paid.note, '유료 기사 · 공개 요약만'); assert.equal(paid.canOpen, true); assert.equal(paid.url, 'https://example.org/p');
  const media = M.itemView({id: '3', lane: 'media', lang: 'ko', title: '매체 새 글', state: 'ok', body_kind: null, url: 'https://example.org/m'});
  assert.equal(media.summary, '');
  const pend = {id: '4', lane: 'channel', lang: 'ko', title: null, state: 'pending', url: 'https://www.example.org/x'};
  const pending = M.itemView(pend);
  assert.equal(pending.title, '제목 읽기 전 · example.org', '도메인을 제목으로 보이지 않음'); assert.equal(pending.note, '아직 안 읽음'); assert.equal(pending.canOpen, false);
  assert.equal(M.itemView({...pend, title: 'naver.me/xAbC12'}).title, '제목 읽기 전 · example.org', '주소뿐인 제목도 제목으로 쓰지 않음');
  assert.equal(M.itemView({...pend, state: 'failed', title: 'https://example.org/x'}).title, '제목 없음 · example.org');
  assert.equal(M.itemView({...pend, title: '진짜 기사 제목'}).title, '진짜 기사 제목');
  assert.equal(M.itemView({id: '5', url: 'javascript:alert(1)', state: 'ok'}).url, '', '이상한 주소는 링크로 쓰지 않음');
});

test('날짜 묶음: 받은 날, 오늘·어제·날짜(요일)', () => {
  const g = M.groupItems([
    {id: 'a', created_at: '2026-11-01T02:00:00Z'}, {id: 'b', created_at: '2026-11-01T00:30:00Z'},
    {id: 'c', created_at: '2026-10-31T05:00:00Z'}, {id: 'd', created_at: '2026-10-20T05:00:00Z'},
  ], NOW);
  assert.deepEqual(g.map(x => [x.label, x.items.length]), [['오늘', 2], ['어제', 1], ['10. 20. (화)', 1]]);
  assert.equal(M.itemView({scrapped_at: '2026-11-01T00:05:00Z', state: 'ok'}).time, '09:05');
});

test('서버 응답 글: 지금 채우기·하루 한도', () => {
  assert.equal(M.fillResult({status: 'nothing'}), '채울 기사 없음');
  assert.equal(M.fillResult({done: 3, deferred: 0}), '3건 채움');
  assert.equal(M.fillResult({done: 5, deferred: 2}), '5건 채움 · 2건은 다음에');
  assert.equal(M.errorNote({status: 429, message: 'DAILY_LIMIT'}, '번역'), '오늘 번역 횟수를 다 씀');
  assert.equal(M.errorNote({status: 429, message: 'MONTHLY_LIMIT'}, '번역'), '이번 달 AI 한도에 닿음');
  assert.equal(M.errorNote({status: 503}, '번역'), '번역 실패 · 잠시 뒤 다시');
});

test('키워드·매체·한도', () => {
  assert.deepEqual(M.cleanWord('  가짜  키워드 '), {ok: true, word: '가짜 키워드'});
  assert.equal(M.cleanWord('').ok, false);
  assert.equal(M.cleanWord('가'.repeat(31)).reason, '30자까지');
  assert.equal(M.cleanWord('가짜', ['가짜']).reason, '이미 있음');
  const cat = M.normalizeCatalog({sources: [{key: 'news-a', name: '가짜일보', region: 'domestic', lang: 'ko'}, {key: 'kctu', name: '아님'}, {key: 'news-b', name: 'Fake', region: 'foreign', lang: 'en'}]});
  assert.deepEqual(cat.map(s => s.key), ['news-a', 'news-b']);
  assert.deepEqual(M.normalizeLimits({limits: {fill: 10, translate: 20, keywords: 30}}), {fill: 10, translate: 20, keywords: 30});
  // S59-1: 키워드 기사 하루 상한(keyword_items)은 없어졌다 — 옛 서버가 보내도 받지 않는다.
  assert.equal(M.normalizeLimits({limits: {keyword_items: 30}}).keyword_items, undefined);
  assert.equal(M.DEFAULT_LIMITS.keyword_items, undefined);
  assert.deepEqual(M.normalizeLimits(null), M.DEFAULT_LIMITS);
  assert.equal(M.sourceNote({enabled: true, last_error: 'robots'}), '읽지 못함');
  assert.equal(M.sourceNote({enabled: false}), '');
});

test('C2 별표 폴더·메모(= 노트)', () => {
  const F = 'f0000000-0000-4000-8000-000000000001', I = 'c0000000-0000-4000-8000-000000000001';
  const folders = [{id: F, parent_id: null, name: '가짜 폴더'}];
  assert.equal(M.itemFolderId({starred_at: '2026-11-01T00:00:00Z', folder_id: F}, folders), F);
  assert.equal(M.itemFolderId({starred_at: null, folder_id: F}, folders), null, '별표 없으면 폴더 없음');
  assert.equal(M.itemFolderId({starred_at: 'x', folder_id: 'f0000000-0000-4000-8000-000000000009'}, folders), null, '모르는 폴더');
  assert.equal(M.noteNewsItemId({metadata: {news_item_id: I}}), I);
  assert.equal(M.noteNewsItemId({metadata: {news_item_id: 'nope'}}), null);
  assert.equal(M.noteNewsItemId({metadata: null}), null);
});

test('목록을 열 때 읽기 전 채널 기사가 있으면 바로 채우기(10분에 한 번)', () => {
  const pend = [{lane: 'channel', state: 'pending'}], ok = [{lane: 'channel', state: 'ok'}, {lane: 'keyword', state: 'pending'}];
  assert.equal(M.needsAutoFill(pend, NaN, 1000), true);
  assert.equal(M.needsAutoFill(ok, NaN, 1000), false);
  assert.equal(M.needsAutoFill([], NaN, 1000), false);
  assert.equal(M.needsAutoFill(pend, 1000, 1000 + M.AUTO_FILL_GAP_MS - 1), false);
  assert.equal(M.needsAutoFill(pend, 1000, 1000 + M.AUTO_FILL_GAP_MS), true);
});

test('기본 켬(S53-6): 줄이 없으면 카탈로그 on, 줄이 있으면 줄 값(끈 줄은 꺼진 채)', () => {
  const cat = M.normalizeCatalog({sources: [{key: 'news-a', name: '가짜일보', region: 'domestic', on: true}, {key: 'news-b', name: '가짜신문', region: 'domestic'}, {key: 'news-c', name: '가짜방송', region: 'domestic', on: 'yes'}]});
  assert.deepEqual(cat.map(s => s.on), [true, false, false], 'on은 true만');
  const rows = new Map([['news-b', {source_key: 'news-b', enabled: true}]]);
  assert.deepEqual(M.enabledSourceKeys(cat, rows), ['news-a', 'news-b']);
  rows.set('news-a', {source_key: 'news-a', enabled: false});
  assert.deepEqual(M.enabledSourceKeys(cat, rows), ['news-b']);
  assert.equal(M.sourceOn(cat[0], undefined), true);
  assert.equal(M.sourceOn(cat[1], undefined), false);
  assert.deepEqual(M.enabledSourceKeys(null, rows), []);
});

// S59-1 NEWS-키워드살리기: 키워드 칸은 서버가 keywords 칸에 적어 둔 받은 글을 켠 키워드마다 모아 보인다.
test('키워드 칸 묶음: 켠 키워드만·키워드 목록 순서·걸린 글이 있는 것만, 머리 글자는 건수(더 있으면 최근 N건)', () => {
  const a = {id: 'a'}, b = {id: 'b'}, c = {id: 'c'};
  const hits = new Map([['철도', {items: [a, b], more: false}], ['파업', {items: [c], more: true}], ['버스', {items: [a]}], ['꺼짐', {items: [b]}]]);
  const kw = [{word: '파업', enabled: true}, {word: '없음', enabled: true}, {word: '꺼짐', enabled: false}, {word: '철도', enabled: true}, {word: 7, enabled: true}];
  const groups = M.keywordGroups(kw, hits);
  assert.deepEqual(groups.map(g => [g.word, g.items.map(i => i.id), g.more]), [['파업', ['c'], true], ['철도', ['a', 'b'], false]]);
  assert.deepEqual(groups.map(M.keywordGroupLabel), ['파업 · 최근 1건', '철도 · 2건']);
  assert.deepEqual(M.keywordGroups([], hits), []);
  assert.deepEqual(M.keywordGroups(kw, new Map()), []);
  assert.equal(M.KW_GROUP_SIZE, 20);
});

test('키워드 칸 읽기 값: PostgreSQL 배열 글자(따옴표·역빗금은 앞에 역빗금, 쉼표·괄호는 따옴표 안에서 그대로)', () => {
  assert.equal(M.pgTextArray(['철도']), '{"철도"}');
  assert.equal(M.pgTextArray(['a"b', 'c\\d', 'x,y', '(z)', '{w}']), '{"a\\"b","c\\\\d","x,y","(z)","{w}"}');
  assert.equal(M.pgTextArray([]), '{}');
});
