// S48-18 성명 초안 '바깥 문장'(설계 docs/design/outside-statements.md 5절): 사회운동 Now [문장 찾기]에서 [초안에 쓰기]로 고른 문장.
// 이 탭 메모리에만 둔다(최대 5개, 기기 저장·서버 저장 없음 — 고른 문장은 서버 표에 이미 있고, 초안 요청은 글 id + 문장 번호만 보낸다).
// 새로 고치거나 로그인이 바뀌면 비고, 성명 초안을 노트로 저장하면 비운다. 보여 주는 글(문장·단체·제목·날짜)은 화면 표시용일 뿐 서버로 보내지 않는다.
export const PRESS_QUOTE_MAX = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let list = [];
const subs = new Set();
const notify = () => { for (const fn of subs) { try { fn(list.slice()); } catch { /* one listener does not stop the rest */ } } };
const keyOf = (postId, idx) => `${String(postId).toLowerCase()} ${Number(idx)}`;

export const pressQuotes = () => list.slice();
export const hasPressQuote = (postId, idx) => list.some(q => keyOf(q.post_id, q.idx) === keyOf(postId, idx));

// 더하기: 'added' | 'have'(이미 있음) | 'full'(5개 참) | 'bad'(모양이 틀림).
export function addPressQuote(q) {
  const postId = String(q?.post_id || '').toLowerCase(), idx = Number(q?.idx);
  if (!UUID.test(postId) || !Number.isSafeInteger(idx) || idx < 0 || idx > 3000) return 'bad';
  if (hasPressQuote(postId, idx)) return 'have';
  if (list.length >= PRESS_QUOTE_MAX) return 'full';
  const s = (v, max) => [...String(v ?? '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');
  list = [...list, {post_id: postId, idx, text: s(q.text, 500), source: s(q.source, 60), title: s(q.title, 200), day: s(q.day, 10)}];
  notify();
  return 'added';
}
export function removePressQuote(postId, idx) {
  const before = list.length;
  list = list.filter(q => keyOf(q.post_id, q.idx) !== keyOf(postId, idx));
  if (list.length !== before) notify();
}
export function clearPressQuotes() { if (list.length) { list = []; notify(); } }
export function onPressQuotes(fn) { subs.add(fn); return () => subs.delete(fn); }

if (typeof window !== 'undefined') window.addEventListener('kptu:session-changed', clearPressQuotes);
