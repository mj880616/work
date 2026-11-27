import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nextRating, ratedText, ratePair, rateMenuItems, ratingKey, cleanRating, RATE_KEYS, LIKE, DISLIKE} from '../app/read-ratings-model.mjs';
// HOME-읽을거리평가(사용자 2026-11-28 07:04): 같은 단추 다시 = 취소, 다른 단추 = 바꾸기. 칸·메뉴는 지금 값으로 눌린 상태를 보인다.
test('누름 셈: 같은 단추 다시 누르면 취소, 다른 단추는 바꾸기', () => {
  assert.equal(nextRating(0, LIKE), LIKE); assert.equal(nextRating(LIKE, LIKE), 0); assert.equal(nextRating(LIKE, DISLIKE), DISLIKE);
  assert.equal(nextRating(DISLIKE, DISLIKE), 0); assert.equal(nextRating(5, LIKE), LIKE); assert.equal(nextRating(LIKE, 3), 0);
  assert.equal(cleanRating('1'), 0); assert.deepEqual(RATE_KEYS, {like: 1, dislike: -1});
  assert.equal(ratingKey('news', 'ABC'), 'news:abc');
  assert.equal(ratedText(LIKE, LIKE), '좋아요 — 다음 추천에 반영해요'); assert.equal(ratedText(0, LIKE), '좋아요를 취소했어요'); assert.equal(ratedText(0, DISLIKE), '별로예요를 취소했어요');
});
test('밀기 칸·메뉴: 이름 좋아요·별로예요, 그림 아이콘, 누른 상태', () => {
  const p = ratePair(DISLIKE);
  assert.deepEqual(p.pair.map(b => [b.key, b.label, b.icon, b.pressed]), [['like', '좋아요', 'thumb-up', false], ['dislike', '별로예요', 'thumb-down', true]]);
  assert.deepEqual(rateMenuItems(LIKE).map(i => i.label), ['좋아요 ✓', '별로예요']);
  assert.deepEqual(rateMenuItems(0).map(i => i.label), ['좋아요', '별로예요']);
});
test('기기 저장 없음: 평가 모듈은 localStorage·sessionStorage를 쓰지 않고 서버 길은 feed-shared.js 하나', () => {
  for (const f of ['app/read-ratings.js', 'app/read-ratings-model.mjs']) assert.doesNotMatch(readFileSync(f, 'utf8'), /localStorage|sessionStorage|indexedDB/);
  const src = readFileSync('app/read-ratings.js', 'utf8');
  assert.doesNotMatch(src, /rt\(\)\.api|\.api\(/);
  const shared = readFileSync('app/feed-shared.js', 'utf8');
  assert.match(shared, /app_read_ratings/);
  assert.doesNotMatch(shared.match(/export async function writeRating[\s\S]*?\n}\n/)[0], /title|summary|PATCH|rated_at/);
});
