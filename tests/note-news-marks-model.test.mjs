import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {visibleMarks, marksNewsOn, NEWS_HL, NEWS_SAVED, isNewsAt, SAVED_KINDS, keepSavedKind, filterSavedKind, savedLine, newsSearch, searchHead} from '../app/note-news-marks-model.mjs';
import {OUTSIDE, RECENT} from '../app/note-tree.mjs';
// S62-13 NOTE-News밑줄보관보기: 노트 'News에서' 두 줄의 순수 계산 + 구조 약속(복사본·기기 저장·새 읽기 길 없음). 글은 모두 가상.
const ID = n => `a7000000-0000-4000-8000-00000000000${n}`;
const saved = [
  {type: 'outside', id: ID(1), star: true, row: {id: ID(1), source_key: 'x1', kind: 'statement', lang: 'ko', title: '가상 증언 모음', published_at: '2026-10-03T00:00:00Z'}},
  {type: 'news', id: ID(2), star: true, row: {id: ID(2), title: '가상 철도 기사', publisher: '가상일보', url: 'https://example.org/a', lang: 'ko', state: 'ok', published_at: '2026-10-04T00:00:00Z'}},
];
const hl = [{id: ID(3), quote: '가상 점검 인력', memo: '국감', source_title: '가상 철도 기사', source_media: '가상일보'}, {id: ID(4), quote: '다른 글', memo: null, source_title: '예산', source_media: '가상뉴스'}];

test('자리 값은 폴더 없음·최근과 겹치지 않는다', () => {
  assert.ok(isNewsAt(NEWS_HL) && isNewsAt(NEWS_SAVED));
  assert.ok(!isNewsAt(OUTSIDE) && !isNewsAt(RECENT) && !isNewsAt(null) && !isNewsAt(ID(1)));
});
test('보관한 글 거르기 [전체|뉴스|사회운동 글]', () => {
  assert.deepEqual(SAVED_KINDS.map(k => k.label), ['전체', '뉴스', '사회운동 글']);
  assert.equal(keepSavedKind('zzz'), 'all');
  assert.equal(filterSavedKind(saved, 'news').length, 1);
  assert.equal(filterSavedKind(saved, 'outside')[0].id, ID(1));
  assert.equal(filterSavedKind(saved, 'all').length, 2);
});
test('보관한 글 줄 값: 뉴스·사회운동 글 모두 별표(보관 = 별표), 사회운동 글은 이름을 모르면 사회운동', () => {
  const n = savedLine(saved[1]), o = savedLine(saved[0]), named = savedLine(saved[0], () => '가상 단체');
  assert.deepEqual([n.title, n.media, n.day, n.star, n.key], ['가상 철도 기사', '가상일보', '10/04', true, `news:${ID(2)}`]);
  assert.deepEqual([o.media, o.star, o.day], ['사회운동', true, '10/03']);
  assert.equal(named.media, '가상 단체');
});
test('노트 검색: 밑줄은 글·메모·제목·매체, 보관은 제목(띄어쓰기·대소문자 무시)', () => {
  assert.deepEqual(newsSearch({highlights: hl, saved, query: '철도'}).highlights.map(h => h.id), [ID(3)]);
  assert.deepEqual(newsSearch({highlights: hl, saved, query: '국감'}).highlights.map(h => h.id), [ID(3)]);
  assert.deepEqual(newsSearch({highlights: hl, saved, query: '가상 철도'}).saved.map(r => r.id), [ID(2)]);
  assert.deepEqual(newsSearch({highlights: hl, saved, query: ''}), {highlights: [], saved: []});
  assert.equal(searchHead(2, 1, 0), '노트 2 · 밑줄 1 · 저장한 글 0');
});
test('구조: News와 같은 읽기 길·같은 밑줄 목록을 쓰고 따로 서버 주소를 부르지 않는다(기기 저장 금지는 CI audit가 본다)', () => {
  const src = readFileSync(new URL('../app/note-news-marks.js', import.meta.url), 'utf8');
  assert.match(src, /readSavedRows/);
  assert.match(src, /highlightsNow\(\)/);
  assert.doesNotMatch(src, /\/rest\/v1\//, '노트 쪽은 따로 서버 주소를 부르지 않는다(now-saved.js·text-highlights.js 길 재사용)');
  const saver = readFileSync(new URL('../app/now-saved.js', import.meta.url), 'utf8');
  assert.match(saver, /export async function readSavedRows/);
  // S68-24: News [보관] 탭은 없앴다. S68-27: 보관의 원본은 읽을 거리 표 하나 — 읽을 거리 목록은 그 표를 직접 읽고(합치기 없음), 이 읽기는 노트만 쓴다.
  assert.doesNotMatch(saver, /createNowSaved/);
  assert.doesNotMatch(saver, /starred_at\.not\.is\.null/, '표시 표의 옛 별표 칸을 읽지 않는다');
  const reading = readFileSync(new URL('../app/reading.js', import.meta.url), 'utf8');
  assert.doesNotMatch(reading, /now-saved\.js|readSavedRows/);
});

// S69-04 MARK-밑줄한목록: 노트 › 밑줄과 저장한 글 [밑줄] 탭이 같은 한 규칙으로 같은 목록·같은 개수.
test('밑줄 한 규칙: 출처(저장한 글·News·사회운동·텔레그램·노트)와 상관없이 다 — 잠근 노트 밑줄과 News 키 없음만 뺀다', () => {
  const raw = [
    {id: ID(5), source_type: 'reading', source_id: ID(1)}, {id: ID(6), source_type: 'news', source_id: ID(2)},
    {id: ID(7), source_type: 'outside', source_id: ID(3)}, {id: ID(8), source_type: 'telegram', source_id: ID(4)},
    {id: ID(9), source_type: 'note', source_id: ID(1)},
  ];
  assert.equal(visibleMarks(null), null, '아직 못 읽었으면 null');
  assert.deepEqual(visibleMarks(raw).map(h => h.id), raw.map(h => h.id));
  assert.deepEqual(visibleMarks(raw, {noteHidden: id => id === ID(1)}).map(h => h.source_type), ['reading', 'news', 'outside', 'telegram']);
  assert.deepEqual(visibleMarks(raw, {newsOn: false}).map(h => h.source_type), ['reading', 'note']);
  assert.equal(marksNewsOn(null), true, '모르면 다 보인다');
  assert.equal(marksNewsOn([]), false);
  assert.equal(marksNewsOn(['outside']), true);
});
test('두 화면이 같은 함수·같은 원본을 쓴다(복사본·따로 거르기 없음)', () => {
  const nnm = readFileSync(new URL('../app/note-news-marks.js', import.meta.url), 'utf8');
  const rd = readFileSync(new URL('../app/reading.js', import.meta.url), 'utf8');
  for (const src of [nnm, rd]) {
    assert.match(src, /visibleMarks\(highlightsNow\(\)/);
    assert.match(src, /marksNewsOn\(/);
  }
  assert.match(rd, /highlightRowHtml\(h, \{src: sourceTag\(h\)\}\)/, '줄 모양도 같은 부품');
  assert.doesNotMatch(rd, /markKeysOf|entryMarked/, '옛 글 줄 거르기([밑줄] = 밑줄 그은 저장한 글)는 없앴다');
});
