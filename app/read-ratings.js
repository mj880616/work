// HOME-읽을거리평가(사용자 2026-11-28 07:04): 읽을 거리 줄 👍·👎 평가의 화면 쪽 한 곳. 서버 길은 feed-shared.js(readRatings·writeRating) 하나,
// 값은 이 탭 메모리에만 둔다(기기 저장 없음 — 다시 열면 서버에서 다시 읽는다). 줄 밀기·⋯·우클릭(now-row-acts.js)이 부른다.
import {readRatings, writeRating, articleOf, knownArticleId, workspaceOf} from './feed-shared.js';
import {ratingKey, cleanRating, nextRating} from './read-ratings-model.mjs';

const FRESH_MS = 30 * 1000;
let scope = '', cache = new Map(), flight = null, at = 0;
const scopeNow = () => workspaceOf();
function check() { const s = scopeNow(); if (s !== scope) { scope = s; cache = new Map(); flight = null; at = 0; } }
// 내 평가를 서버에서 읽어 둔다(FRESH_MS 안에 읽었으면 건너뜀). 못 읽으면 지금 값 그대로(평가 없음으로 보임).
export function loadRatings({force = false} = {}) {
  check();
  if (!scope) return Promise.resolve(false);
  if (flight) return flight;
  if (!force && at && Date.now() - at < FRESH_MS) return Promise.resolve(true);
  const my = scope;
  flight = readRatings().then(rows => {
    if (my !== scope) return false;
    cache = new Map(rows.map(r => [ratingKey(r.type, r.id), r.rating])); at = Date.now(); return true;
  }).catch(() => false).finally(() => { if (my === scope) flight = null; });
  return flight;
}
// 옛 기사 id(홈 '읽을 만한 글')도 공용 id로 바꿔 둔 뒤 평가를 읽는다 — 그다음 ratingOf가 바로 답한다.
export const primeRatings = (type, ids, opts) => Promise.all([loadRatings(opts), articleOf(type, ids).catch(() => null)]).then(() => true, () => false);
// 지금 아는 평가(1 | -1 | 0). 기다리지 않는다.
export function ratingOf(item) {
  check();
  if (!item?.type || !item.id) return 0;
  return cleanRating(cache.get(ratingKey(item.type, knownArticleId(item.type, item.id))));
}
// 단추 하나 누름(key 1 | -1): 같은 단추면 취소, 다른 단추면 바꾸기. 서버에 쓴 뒤 메모리 값을 바꾼다. 돌려줌: 새 값.
export async function rate(item, pressed) {
  check();
  const my = scope, next = nextRating(ratingOf(item), pressed);
  const id = await writeRating(item, next);
  if (my === scope) { const k = ratingKey(item.type, id); if (next) cache.set(k, next); else cache.delete(k); }
  return next;
}
