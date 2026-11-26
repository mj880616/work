// S68-38 노트 '보드'(생각 지도, 명진 11/23 08:12·08:23 — Obsidian Canvas 참고): 카드끼리 잇는 연결선 계산(화면 없음, 시험 가능).
// - 저장: 서버 표 app_note_board_links(migration 20261123090000·20261123120000, owner RLS·같은 작업공간). 읽기·쓰기는 note-board-links-data.js 한 곳.
// - 선 한 줄 = {id, board_id, from_note|from_text|from_x·from_y, to_note|to_text|to_x·to_y, from_side, to_side, shape, dash, ends, label, bend_x, bend_y, color, width}.
//   S69-91(migration 20261125040100): 끝이 판 위 한 점이어도 된다(도구 줄로 넣은 선), 모양 elbow(꺾은선), 선 색(0~9)·두께(1~8).
//   S68-38c(명진 11/23 08:47): 끝마다 노트(from_note·to_note) 또는 그 보드의 글 상자(from_text·to_text) 중 정확히 하나(서버 check와 같은 규칙). endId(l, 'from')로 한 번에 읽는다.
//   from_side·to_side: 카드 네 변(top·right·bottom·left) 중 하나, 비면(null) 두 카드 자리로 서로 마주 보는 변을 고른다(카드를 옮기면 따라 바뀜).
//   shape: line(직선, S68-38c부터 새 선 기본)·curve(곡선). dash: solid(실선 = 이어지는 생각)·dashed(점선 = 그냥 관련). ends: end(끝에 화살촉)·both(양쪽)·none(없음).
//   bend_x·bend_y(S68-38c, 명진 11/23 08:32): 선 가운데를 끌어 만든 곡선이 지나는 점. 두 끝점 기준 상대 위치 —
//   bend_x = 시작→끝 방향 비율, bend_y = 그 수직 방향 비율(선 길이 단위). 카드·상자를 옮겨도 곡선이 따라온다. 둘 다 null = 지나는 점 없음
//   (shape=curve면 옛 자동 곡선, line이면 직선). 점이 있으면 shape는 curve.
//   label: 선 위 짧은 글자(1~40자, 없어도 됨). 같은 보드·같은 방향·같은 두 끝은 한 줄(서버 unique와 같은 규칙).
// - 글 상자(S68-38c, 서버 표 app_note_board_texts): {id, board_id, body, x, y}. 그 보드에만 있는 짧은 글(노트가 아님). 크기는 화면이 글에 맞춘다.
// - 기기 저장 없음.
import { CARD_W, CARD_H } from './note-board-model.mjs';

export const SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);
export const SHAPES = Object.freeze(['line', 'curve', 'elbow']);
export const DASHES = Object.freeze(['solid', 'dashed']);
export const ENDS = Object.freeze(['end', 'both', 'none']);
export const LABEL_MAX = 40;
export const LINK_LIMIT = 1000; // 보드 하나의 선 개수(화면에서만 막음, 수백 개까지 버벅이지 않게 그린다)
export const TEXT_MAX = 300; // 글 상자 글자 수(서버 check와 같음)
export const TEXT_LIMIT = 500; // 보드 하나의 글 상자 개수(화면에서만 막음)
export const BEND_LIMIT = 5; // 곡선 지나는 점 상대 위치 범위(서버 check와 같음, -5~5)
export const BEND_SNAP = 10; // 지나는 점이 두 끝을 잇는 직선에서 이만큼(판 px) 안이면 직선으로 되돌린다
const BOARD_RE = /^(all|b[0-9a-z]{6,12})$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

// 끝 id(노트 또는 글 상자). side: 'from'|'to'. 판 위 점 끝(S69-91 넣은 선)은 null.
export const endId = (l, side) => l[`${side}_note`] || l[`${side}_text`] || null;
// S69-91: 끝이 판 위 한 점인가(from_x·from_y / to_x·to_y). 점 끝은 크기 0인 칸으로 본다(선 계산이 그대로 통한다).
export const isPointEnd = (l, side) => Number.isFinite(l[`${side}_x`]) && Number.isFinite(l[`${side}_y`]);
export const pointRect = (l, side) => ({x:l[`${side}_x`], y:l[`${side}_y`], w:0, h:0});
// 끝을 옮긴 칸(서버에 보낼 칸): 노트·글 상자에 붙이기(kind 'note'|'text') 또는 점(kind 'point', at = {x, y}).
export function endPatch(side, kind, idOrAt, toSide = null) {
  const none = {[`${side}_note`]:null, [`${side}_text`]:null, [`${side}_x`]:null, [`${side}_y`]:null};
  if (kind === 'point') return {...none, [`${side}_x`]:clampAt(idOrAt.x), [`${side}_y`]:clampAt(idOrAt.y), [`${side}_side`]:null};
  return {...none, [`${side}_${kind}`]:idOrAt, [`${side}_side`]:toSide};
}
const clampAt = v => Math.max(0, Math.min(100000, Math.round(v)));
export const LINE_COLORS_MAX = 9, WIDTH_MIN = 1, WIDTH_MAX = 8;
const uuidish = v => typeof v === 'string' && v.length > 0;
const num = v => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= BEND_LIMIT ? v : null);
const coord = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000 ? v : null);
// 서버 줄 → 화면 값(모양이 틀리면 null). 옛 표 모양(글 상자·곡선 칸 없음)도 받는다.
export function parseLink(row) {
  if (!row || typeof row !== 'object') return null;
  const {id, board_id} = row;
  if (typeof id !== 'string' || !id || typeof board_id !== 'string' || !BOARD_RE.test(board_id)) return null;
  const ends = {};
  for (const side of ['from', 'to']) {
    const note = uuidish(row[`${side}_note`]) ? row[`${side}_note`] : null, text = uuidish(row[`${side}_text`]) ? row[`${side}_text`] : null;
    const px = coord(row[`${side}_x`]), py = coord(row[`${side}_y`]), point = px !== null && py !== null;
    if ([note, text, point || null].filter(Boolean).length !== 1) return null; // 끝마다 정확히 하나(노트·글 상자·점)
    ends[`${side}_note`] = note; ends[`${side}_text`] = text; ends[`${side}_x`] = point ? px : null; ends[`${side}_y`] = point ? py : null;
  }
  const a = ends.from_note || ends.from_text, b = ends.to_note || ends.to_text;
  if (a && a === b) return null;
  const label = typeof row.label === 'string' && row.label.trim() && !CONTROL.test(row.label) ? [...row.label].slice(0, LABEL_MAX).join('') : null;
  let bx = num(row.bend_x), by = num(row.bend_y);
  if (bx === null || by === null) bx = by = null;
  const shape = bx === null ? pick(row.shape, SHAPES, 'line') : 'curve';
  return {id, board_id, ...ends, from_side:pick(row.from_side, SIDES, null), to_side:pick(row.to_side, SIDES, null),
    shape, dash:pick(row.dash, DASHES, 'solid'), ends:pick(row.ends, ENDS, 'end'), label, bend_x:bx, bend_y:by,
    color:Number.isInteger(row.color) && row.color >= 0 && row.color <= LINE_COLORS_MAX ? row.color : null,
    width:Number.isInteger(row.width) && row.width >= WIDTH_MIN && row.width <= WIDTH_MAX ? row.width : null};
}
// 이 보드에서 그릴 선: 양쪽 끝(카드·글 상자)이 모두 판에 있는 것만(뺀 노트·지운 노트·잠긴 화면 밖 노트의 선은 그리지 않는다).
export const linksOnBoard = (links, boardId, onBoard) => links.filter(l => l.board_id === boardId && ['from', 'to'].every(s => isPointEnd(l, s) || onBoard(endId(l, s))));
export const hasLink = (links, boardId, from, to) => !!from && !!to && links.some(l => l.board_id === boardId && endId(l, 'from') === from && endId(l, 'to') === to);
// 새 선의 끝 칸: kind 'note'|'text'.
export const endFields = (side, kind, id) => (kind === 'text' ? {[`${side}_note`]:null, [`${side}_text`]:id} : {[`${side}_note`]:id, [`${side}_text`]:null});

// 글 상자: 서버 줄 → 화면 값.
export function parseText(row) {
  if (!row || typeof row !== 'object') return null;
  const {id, board_id, body} = row;
  // S69-91: 도형(kind shape)만 빈 글을 받는다(글 없는 도형 — 서버 check와 같음).
  if (typeof id !== 'string' || !id || typeof board_id !== 'string' || !BOARD_RE.test(board_id) || typeof body !== 'string' || (!body.trim() && !(row.kind === 'shape' && body === ''))) return null;
  const at = v => (Number.isFinite(v) ? Math.max(0, Math.min(100000, Math.round(v))) : 0);
  return {id, board_id, body:[...body].slice(0, TEXT_MAX).join(''), x:at(row.x), y:at(row.y)};
}
// 글 상자 글: 앞뒤 빈칸·빈 줄 지움, 줄바꿈은 그대로(다른 제어 문자는 안 됨). 비면 null.
export function validateText(text) {
  const raw = typeof text === 'string' ? text.replace(/\r\n?/g, '\n').replace(/^[ \n]+|[ \n]+$/g, '') : '';
  if (!raw) return null;
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(raw)) throw new Error('글에 쓸 수 없는 문자가 있어요.');
  if ([...raw].length > TEXT_MAX) throw new Error(`글 상자는 ${TEXT_MAX}자까지 쓸 수 있어요.`);
  return raw;
}

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
export const rectOf = p => ({x:p.x, y:p.y, w:p.w || CARD_W, h:p.h || CARD_H}); // S69-88: 손으로 정한 카드 크기
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
  const c = center(r), dx = (point.x - c.x) / (r.w / 2 || 1), dy = (point.y - c.y) / (r.h / 2 || 1); // 점 끝(크기 0)은 방향만
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
// ---- 곡선 지나는 점(두 끝점 기준 상대 위치 ↔ 판 좌표) ----
// 상대 (u, v) → 점: p + u·(q−p) + v·(q−p를 시계 방향 90° 돌린 것).
export function bendPoint(p, q, u, v) {
  const dx = q.x - p.x, dy = q.y - p.y;
  return {x:p.x + u * dx - v * dy, y:p.y + u * dy + v * dx};
}
// 점 → 상대 (u, v). 직선에서 BEND_SNAP 안이거나 두 끝이 거의 붙어 있으면 null(직선).
export function bendOf(p, q, m) {
  const dx = q.x - p.x, dy = q.y - p.y, len2 = dx * dx + dy * dy;
  if (len2 < 16) return null;
  const rx = m.x - p.x, ry = m.y - p.y, u = (rx * dx + ry * dy) / len2, v = (ry * dx - rx * dy) / len2;
  if (Math.abs(v) * Math.sqrt(len2) < BEND_SNAP) return null;
  const clamp = n => Math.max(-BEND_LIMIT, Math.min(BEND_LIMIT, Math.round(n * 10000) / 10000));
  return {bend_x:clamp(u), bend_y:clamp(v)};
}
// 끌기 결과 → 서버에 보낼 칸(직선 복귀 포함).
export const bendPatch = bend => (bend ? {shape:'curve', ...bend} : {shape:'line', bend_x:null, bend_y:null});
export const isBent = l => l.bend_x != null && l.bend_y != null;
export const isStraight = l => !isBent(l) && l.shape !== 'curve';
export function linkGeometry(a, b, {from_side = null, to_side = null, shape = 'line', bend_x = null, bend_y = null} = {}) {
  const [s1, s2] = resolveSides(a, b, from_side, to_side);
  const p = sidePoint(a, s1), q = sidePoint(b, s2);
  if (bend_x != null && bend_y != null) { // 지나는 점 m을 t=0.5에서 지나는 2차 곡선: 조절점 = 2m − (p+q)/2
    const m = bendPoint(p, q, bend_x, bend_y), c = {x:2 * m.x - (p.x + q.x) / 2, y:2 * m.y - (p.y + q.y) / 2};
    return {from:{...p, side:s1}, to:{...q, side:s2}, d:`M${r1(p.x)} ${r1(p.y)}Q${r1(c.x)} ${r1(c.y)} ${r1(q.x)} ${r1(q.y)}`, mid:m};
  }
  if (shape === 'line') return {from:{...p, side:s1}, to:{...q, side:s2}, d:`M${r1(p.x)} ${r1(p.y)}L${r1(q.x)} ${r1(q.y)}`, mid:{x:(p.x + q.x) / 2, y:(p.y + q.y) / 2}};
  if (shape === 'elbow') { // S69-91 꺾은선: 시작 변 방향(가로 변이면 가로)으로 반쯤 가서 꺾고, 끝 쪽으로 다시 꺾는다.
    const across = s1 === 'left' || s1 === 'right';
    if (across) { const mx = (p.x + q.x) / 2; return {from:{...p, side:s1}, to:{...q, side:s2}, d:`M${r1(p.x)} ${r1(p.y)}H${r1(mx)}V${r1(q.y)}H${r1(q.x)}`, mid:{x:mx, y:(p.y + q.y) / 2}}; }
    const my = (p.y + q.y) / 2; return {from:{...p, side:s1}, to:{...q, side:s2}, d:`M${r1(p.x)} ${r1(p.y)}V${r1(my)}H${r1(q.x)}V${r1(q.y)}`, mid:{x:(p.x + q.x) / 2, y:my}};
  }
  const k = reach(p, q), n1 = NORMAL[s1], n2 = NORMAL[s2];
  const c1 = {x:p.x + n1.x * k, y:p.y + n1.y * k}, c2 = {x:q.x + n2.x * k, y:q.y + n2.y * k};
  // 3차 베지어의 t=0.5 점.
  const mid = {x:(p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, y:(p.y + 3 * c1.y + 3 * c2.y + q.y) / 8};
  return {from:{...p, side:s1}, to:{...q, side:s2}, d:`M${r1(p.x)} ${r1(p.y)}C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(q.x)} ${r1(q.y)}`, mid};
}
// 끌고 있는 선(손잡이 → 손가락 자리): 끝 변이 없으니 시작 변 방향으로 뻗는 곡선.
// from(선택): 선을 시작할 점(S70-77 — 누른 연결점 동그라미 가운데). 없으면 그 변 가운데.
export function dragPath(a, side, point, from = null) {
  const p = from && Number.isFinite(from.x) && Number.isFinite(from.y) ? from : sidePoint(a, side), n = NORMAL[side], k = reach(p, point);
  return `M${r1(p.x)} ${r1(p.y)}C${r1(p.x + n.x * k)} ${r1(p.y + n.y * k)} ${r1(point.x)} ${r1(point.y)} ${r1(point.x)} ${r1(point.y)}`;
}
// 선이 차지하는 대략의 칸(화면 밖 선 그리기 생략용): 두 카드와 곡선 손잡이를 다 덮는 사각형.
// extra: 곡선 지나는 점(있으면 함께 덮는다).
export function linkBox(a, b, extra = null) {
  const xs = [a.x, b.x, a.x + a.w, b.x + b.w, ...(extra ? [extra.x] : [])], ys = [a.y, b.y, a.y + a.h, b.y + b.h, ...(extra ? [extra.y] : [])];
  const x0 = Math.min(...xs) - 180, y0 = Math.min(...ys) - 180, x1 = Math.max(...xs) + 180, y1 = Math.max(...ys) + 180;
  return {x:x0, y:y0, w:x1 - x0, h:y1 - y0};
}

// ---- 메뉴 동작(새 값만 돌려줌, 서버에 보낼 칸) ----
// 방향 뒤집기: 시작·끝(변 포함)을 바꾼다. 양방향·없음이어도 바꾼다(다음에 '끝에만'으로 바꿀 때의 방향).
// 곡선 지나는 점은 같은 자리에 남게 바꾼다(시작·끝이 바뀌면 u → 1−u, v → −v).
export const flipPatch = l => ({from_note:l.to_note ?? null, to_note:l.from_note ?? null, from_text:l.to_text ?? null, to_text:l.from_text ?? null, from_side:l.to_side, to_side:l.from_side,
  ...(isPointEnd(l, 'from') || isPointEnd(l, 'to') ? {from_x:l.to_x ?? null, from_y:l.to_y ?? null, to_x:l.from_x ?? null, to_y:l.from_y ?? null} : {}),
  ...(isBent(l) ? {bend_x:Math.round((1 - l.bend_x) * 10000) / 10000, bend_y:-l.bend_y} : {})});
export const SHAPE_NAMES = Object.freeze({curve:'곡선', line:'직선', elbow:'꺾은선'});
export const DASH_NAMES = Object.freeze({solid:'실선', dashed:'점선'});
export const ENDS_NAMES = Object.freeze({end:'한쪽', both:'양쪽', none:'없음'});
