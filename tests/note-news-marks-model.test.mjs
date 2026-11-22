import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NEWS_HL, NEWS_SAVED, isNewsAt, SAVED_KINDS, keepSavedKind, filterSavedKind, savedLine, newsSearch, searchHead} from '../app/note-news-marks-model.mjs';
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
  assert.equal(searchHead(2, 1, 0), '노트 2 · 밑줄 1 · 읽을 거리 0');
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
