// S68-38 노트 '보드'(생각 지도, 명진 11/23 08:12·08:23 — Obsidian Canvas 참고): 카드끼리 잇는 연결선 계산(화면 없음, 시험 가능).
// - 저장: 서버 표 app_note_board_links(migration 20261123090000, owner RLS·양쪽 노트 같은 작업공간). 읽기·쓰기는 note-board-links-data.js 한 곳.
// - 선 한 줄 = {id, board_id, from_note, to_note, from_side, to_side, shape, dash, ends, label}.
//   from_side·to_side: 카드 네 변(top·right·bottom·left) 중 하나, 비면(null) 두 카드 자리로 서로 마주 보는 변을 고른다(카드를 옮기면 따라 바뀜).
//   shape: curve(부드러운 곡선, 기본)·line(직선). dash: solid(실선 = 이어지는 생각)·dashed(점선 = 그냥 관련). ends: end(끝에 화살촉)·both(양쪽)·none(없음).
//   label: 선 위 짧은 글자(1~40자, 없어도 됨). 같은 보드·같은 방향·같은 두 노트는 한 줄(서버 unique와 같은 규칙).
// - 기기 저장 없음.
import { CARD_W, CARD_H } from './note-board-model.mjs';

export const SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);
export const SHAPES = Object.freeze(['curve', 'line']);
export const DASHES = Object.freeze(['solid', 'dashed']);
export const ENDS = Object.freeze(['end', 'both', 'none']);
export const LABEL_MAX = 40;
export const LINK_LIMIT = 1000; // 보드 하나의 선 개수(화면에서만 막음, 수백 개까지 버벅이지 않게 그린다)
const BOARD_RE = /^(all|b[0-9a-z]{6,12})$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

// 서버 줄 → 화면 값(모양이 틀리면 null).
export function parseLink(row) {
  if (!row || typeof row !== 'object') return null;
  const {id, board_id, from_note, to_note} = row;
  if (typeof id !== 'string' || !id || typeof board_id !== 'string' || !BOARD_RE.test(board_id)) return null;
  if (typeof from_note !== 'string' || typeof to_note !== 'string' || !from_note || !to_note || from_note === to_note) return null;
  const label = typeof row.label === 'string' && row.label.trim() && !CONTROL.test(row.label) ? [...row.label].slice(0, LABEL_MAX).join('') : null;
  return {id, board_id, from_note, to_note, from_side:pick(row.from_side, SIDES, null), to_side:pick(row.to_side, SIDES, null),
    shape:pick(row.shape, SHAPES, 'curve'), dash:pick(row.dash, DASHES, 'solid'), ends:pick(row.ends, ENDS, 'end'), label};
}
// 이 보드에서 그릴 선: 양쪽 카드가 모두 판에 있는 것만(뺀 노트·지운 노트·잠긴 화면 밖 노트의 선은 그리지 않는다).
export const linksOnBoard = (links, boardId, onBoard) => links.filter(l => l.board_id === boardId && onBoard(l.from_note) && onBoard(l.to_note));
export const hasLink = (links, boardId, from, to) => links.some(l => l.board_id === boardId && l.from_note === from && l.to_note === to);

// 선 위 글자(앞뒤 빈칸 지움). 빈 글자 = null(글자 없음).
export function validateLabel(text) {
  const raw = typeof text === 'string' ? text.trim().replace(/ {2,}/g, ' ') : '';
  if (!raw) return null;
  if (CONTROL.test(raw)) throw new Error('글자는 한 줄로 써 주세요.');
  if ([...raw].length > LABEL_MAX) throw new Error(`글자는 ${LABEL_MAX}자까지 쓸 수 있어요.`);
  return raw;
}

// ---- 자리 계산(판 좌표) ----
const center = r => ({x:r.x + r.w / 2, y:r.y + r.h / 2});
export const rectOf = p => ({x:p.x, y:p.y, w:CARD_W, h:CARD_H});
// 변의 가운데 점.
export function sidePoint(r, side) {
  if (side === 'top') return {x:r.x + r.w / 2, y:r.y};
  if (side === 'bottom') return {x:r.x + r.w / 2, y:r.y + r.h};
  if (side === 'left') return {x:r.x, y:r.y + r.h / 2};
  return {x:r.x + r.w, y:r.y + r.h / 2};
}
const NORMAL = {top:{x:0, y:-1}, bottom:{x:0, y:1}, left:{x:-1, y:0}, right:{x:1, y:0}};
// 점에서 가장 가까운 변(카드 모양 비율을 따져, 넓적한 카드의 위아래가 너무 쉽게 뽑히지 않게).
export function nearestSide(r, point) {
  const c = center(r), dx = (point.x - c.x) / (r.w / 2), dy = (point.y - c.y) / (r.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}
// 변을 정하지 않은 쪽: 상대 카드 쪽을 보는 변. 두 쪽 다 비면 서로 마주 보는 변.
export function resolveSides(a, b, fromSide = null, toSide = null) {
  const s1 = fromSide || nearestSide(a, toSide ? sidePoint(b, toSide) : center(b));
  const s2 = toSide || nearestSide(b, sidePoint(a, s1));
  return [s1, s2];
}
// 곡선 손잡이 길이: 두 점 거리에 비례(가까우면 짧게, 멀어도 너무 휘지 않게).
const reach = (p, q) => Math.max(24, Math.min(180, Math.hypot(q.x - p.x, q.y - p.y) * 0.45));
const r1 = v => Math.round(v * 10) / 10;
// 선 하나의 모양: 시작·끝 점과 변, SVG path d, 글자 놓을 가운데 점. shape는 curve|line.
export function linkGeometry(a, b, {from_side = null, to_side = null, shape = 'curve'} = {}) {
  const [s1, s2] = resolveSides(a, b, from_side, to_side);
  const p = sidePoint(a, s1), q = sidePoint(b, s2);
  if (shape === 'line') return {from:{...p, side:s1}, to:{...q, side:s2}, d:`M${r1(p.x)} ${r1(p.y)}L${r1(q.x)} ${r1(q.y)}`, mid:{x:(p.x + q.x) / 2, y:(p.y + q.y) / 2}};
  const k = reach(p, q), n1 = NORMAL[s1], n2 = NORMAL[s2];
  const c1 = {x:p.x + n1.x * k, y:p.y + n1.y * k}, c2 = {x:q.x + n2.x * k, y:q.y + n2.y * k};
  // 3차 베지어의 t=0.5 점.
  const mid = {x:(p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, y:(p.y + 3 * c1.y + 3 * c2.y + q.y) / 8};
  return {from:{...p, side:s1}, to:{...q, side:s2}, d:`M${r1(p.x)} ${r1(p.y)}C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(q.x)} ${r1(q.y)}`, mid};
}
// 끌고 있는 선(손잡이 → 손가락 자리): 끝 변이 없으니 시작 변 방향으로 뻗는 곡선.
export function dragPath(a, side, point) {
  const p = sidePoint(a, side), n = NORMAL[side], k = reach(p, point);
  return `M${r1(p.x)} ${r1(p.y)}C${r1(p.x + n.x * k)} ${r1(p.y + n.y * k)} ${r1(point.x)} ${r1(point.y)} ${r1(point.x)} ${r1(point.y)}`;
}
// 선이 차지하는 대략의 칸(화면 밖 선 그리기 생략용): 두 카드와 곡선 손잡이를 다 덮는 사각형.
export function linkBox(a, b) {
  const x0 = Math.min(a.x, b.x) - 180, y0 = Math.min(a.y, b.y) - 180, x1 = Math.max(a.x + a.w, b.x + b.w) + 180, y1 = Math.max(a.y + a.h, b.y + b.h) + 180;
  return {x:x0, y:y0, w:x1 - x0, h:y1 - y0};
}

// ---- 메뉴 동작(새 값만 돌려줌, 서버에 보낼 칸) ----
// 방향 뒤집기: 시작·끝(변 포함)을 바꾼다. 양방향·없음이어도 바꾼다(다음에 '끝에만'으로 바꿀 때의 방향).
export const flipPatch = l => ({from_note:l.to_note, to_note:l.from_note, from_side:l.to_side, to_side:l.from_side});
export const SHAPE_NAMES = Object.freeze({curve:'곡선', line:'직선'});
export const DASH_NAMES = Object.freeze({solid:'실선', dashed:'점선'});
export const ENDS_NAMES = Object.freeze({end:'한쪽', both:'양쪽', none:'없음'});
