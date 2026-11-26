// S69-82(사용자 11/24 23:51 "전체를 브레인 스토밍 마인드맵 하게. 제대로 개선"): 노트 › 보드의 생각 지도 계산(화면 없음, 시험 가능).
// 설계: docs/design/note-board-mindmap.md. 그리는 곳은 note-board.js 하나, 저장은 note-board-links-data.js(서버 표 app_note_board_texts).
// - 상자(주제) = 보드에만 있는 글 상자 한 줄. parent_id가 있으면 그 상자의 가지(하위), 없으면 혼자 선 상자(뿌리 — 옛 글 상자는 모두 뿌리로 읽힌다).
// - 뿌리만 자기 자리(x·y)를 쓰고, 가지 자리는 늘 자동 배치(나무 모양, 뿌리의 가지는 왼·오른 양쪽, 그 아래는 같은 쪽으로).
// - 꾸미기: 색(기존 노트 색 8가지 0~7, 없으면 기본) · 모양(둥근/네모/알약/글만) · 글자 크기(1~4) · 폭(비면 글 길이만큼).
// - S69-88(사용자 11/25 02:46 "크기 조절 … 높이 폭 모두", "이동도 자유롭고 파워포인트처럼"): 손으로 정한 높이(h, 비면 글 길이만큼 — 글이 더 길면
//   상자가 글만큼 커진다: 최소 높이), 손으로 옮겨 둔 가지(pinned — 자기 x·y를 쓰고 자동 배치가 덮어쓰지 않음, 그 아래 가지는 그 자리에서 자동, 가지 선은 따라감).
// - S69-91 ①: 종류에 글자(label)·도형(shape) — 늘 혼자 선 칸(가지가 아님, 자기 x·y). 도형 모양 6가지·색 -1(없음)·8·9, 꾸미기 칸은 note-board-decor-model.mjs.
// - 기기 저장 없음. 서버 check와 같은 범위만 받는다(migration 20261125000000_note_board_mindmap, 20261125020000_note_board_box_size, 20261125040000_note_board_decor).
import { FREE_KINDS, SHAPE_KINDS, decorShape } from './note-board-decor-model.mjs';

export const NODE_COLORS = Object.freeze([
  {n:0, name:'연두'}, {n:1, name:'하늘'}, {n:2, name:'연보라'}, {n:3, name:'살구'},
  {n:4, name:'민트'}, {n:5, name:'연분홍'}, {n:6, name:'쑥'}, {n:7, name:'회청'},
]);
export const NODE_SHAPES = Object.freeze(['round', 'rect', 'pill', 'plain']);
export const SHAPE_NAMES = Object.freeze({round:'둥근 상자', rect:'네모 상자', pill:'알약', plain:'글만'});
export const NODE_KINDS = Object.freeze(['topic', 'sticky', ...FREE_KINDS]);
const ALL_SHAPES = Object.freeze([...new Set(['round', 'rect', 'pill', 'plain', ...SHAPE_KINDS])]);
export const FONT_MIN = 1, FONT_MAX = 4, FONT_DEFAULT = 2, ROOT_FONT = 3;
export const FONT_PX = Object.freeze({1:12, 2:14, 3:17, 4:21});
export const FONT_NAMES = Object.freeze({1:'작게', 2:'보통', 3:'크게', 4:'아주 크게'});
export const W_MIN = 60, W_MAX = 600; // 손으로 정한 폭(서버 check와 같음). 비면 글 길이만큼(AUTO_MAX에서 줄바꿈)
export const H_MIN = 30, H_MAX = 1200; // 손으로 정한 높이(서버 check와 같음). 비면 글 길이만큼
export const AUTO_MAX = 260;
export const ORD_MAX = 1000000, ORD_STEP = 1024;
export const HGAP = 44, VGAP = 12;
const COORD = 100000;

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const at = v => (Number.isFinite(v) ? Math.max(0, Math.min(COORD, Math.round(v))) : 0);

// 서버 줄(글 상자 기본 칸은 note-board-links-model.mjs parseText가 이미 거름) + 생각 지도 칸. 칸이 없으면(옛 서버) 기본값.
export function nodeShape(base, row = {}) {
  if (!base) return null;
  const kind = NODE_KINDS.includes(row.kind) ? row.kind : 'topic', free = FREE_KINDS.includes(kind);
  const parent = !free && typeof row.parent_id === 'string' && row.parent_id && row.parent_id !== base.id ? row.parent_id : null;
  return {
    ...base,
    ...decorShape(row),
    parent_id:parent,
    ord:int(row.ord, 0, ORD_MAX) ?? 0,
    side:row.side === -1 || row.side === 1 ? row.side : null,
    kind,
    color:int(row.color, -1, 9),
    shape:ALL_SHAPES.includes(row.shape) ? row.shape : kind === 'shape' ? 'rect' : kind === 'label' ? 'plain' : 'round',
    font:int(row.font, FONT_MIN, FONT_MAX) ?? FONT_DEFAULT,
    w:int(row.w, W_MIN, W_MAX),
    h:int(row.h, H_MIN, H_MAX),
    collapsed:row.collapsed === true,
    pinned:row.pinned === true && !!parent, // 뿌리는 늘 자기 자리이므로 손으로 둔 표시는 가지에만 뜻이 있다
  };
}

// 나무 만들기: 부모가 없거나(다른 보드·지워짐) 고리(서로가 서로의 부모)면 뿌리로 본다. 형제는 ord → id 순.
export function buildTree(nodes) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const parentOf = new Map();
  // S69-91: 글자·도형은 가지도 부모도 되지 않는다(늘 혼자 선 칸).
  for (const n of nodes) if (n.parent_id && byId.has(n.parent_id) && !FREE_KINDS.includes(n.kind) && !FREE_KINDS.includes(byId.get(n.parent_id).kind)) parentOf.set(n.id, n.parent_id);
  // 고리 끊기: 위로 올라가다 자기를 다시 만나면 그 줄을 뿌리로.
  for (const n of nodes) {
    const seen = new Set([n.id]);
    let p = parentOf.get(n.id);
    while (p) { if (seen.has(p)) { parentOf.delete(n.id); break; } seen.add(p); p = parentOf.get(p); }
  }
  const kids = new Map(nodes.map(n => [n.id, []]));
  const roots = [];
  for (const n of nodes) { const p = parentOf.get(n.id); if (p) kids.get(p).push(n); else roots.push(n); }
  const order = (a, b) => a.ord - b.ord || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const list of kids.values()) list.sort(order);
  return {byId, parentOf, kids, roots};
}
export const childrenOf = (tree, id) => tree.kids.get(id) || [];
export function rootOf(tree, id) { let r = id; while (tree.parentOf.has(r)) r = tree.parentOf.get(r); return r; }
export function depthOf(tree, id) { let d = 0, r = id; while (tree.parentOf.has(r)) { r = tree.parentOf.get(r); d++; } return d; }
// 그 상자 아래 전부(자기 빼고, 위에서부터).
export function descendants(tree, id) {
  const out = [], stack = [...childrenOf(tree, id)].reverse();
  while (stack.length) { const n = stack.pop(); out.push(n.id); stack.push(...[...childrenOf(tree, n.id)].reverse()); }
  return out;
}
export const isInside = (tree, id, maybeAncestor) => { let p = tree.parentOf.get(id); while (p) { if (p === maybeAncestor) return true; p = tree.parentOf.get(p); } return false; };
// 옮겨 붙일 수 있나: 자기·자기 아래로는 못 붙는다.
export const canAttach = (tree, id, target) => !!target && id !== target && tree.byId.has(target) && !isInside(tree, target, id);

// 뿌리 가지의 쪽: 저장한 쪽, 없으면 가벼운 쪽(높이 합이 작은 쪽, 같으면 오른쪽).
function rootSides(tree, rootId, heightOf) {
  const sides = new Map(); let right = 0, left = 0;
  for (const k of childrenOf(tree, rootId)) {
    if (k.pinned) continue; // 손으로 둔 가지는 쪽 무게에 넣지 않는다
    const s = k.side ?? (right <= left ? 1 : -1);
    sides.set(k.id, s);
    if (s === 1) right += heightOf(k.id) + VGAP; else left += heightOf(k.id) + VGAP;
  }
  return sides;
}
// 새 뿌리 가지를 둘 쪽(지금 가벼운 쪽).
export function lighterSide(tree, rootId, sizeOf) {
  const h = subtreeHeights(tree, sizeOf);
  let right = 0, left = 0;
  const sides = rootSides(tree, rootId, id => h.get(id) || 0);
  for (const [id, s] of sides) if (s === 1) right += (h.get(id) || 0) + VGAP; else left += (h.get(id) || 0) + VGAP;
  return right <= left ? 1 : -1;
}
function subtreeHeights(tree, sizeOf) {
  const memo = new Map();
  const of = id => {
    if (memo.has(id)) return memo.get(id);
    const n = tree.byId.get(id), own = sizeOf(id).h, ks = n?.collapsed ? [] : childrenOf(tree, id).filter(k => !k.pinned);
    const sum = ks.reduce((s, k) => s + of(k.id), 0) + Math.max(0, ks.length - 1) * VGAP;
    const v = Math.max(own, sum); memo.set(id, v); return v;
  };
  for (const n of tree.byId.values()) of(n.id);
  return memo;
}

// 자동 배치: 보이는 상자마다 판 좌표 칸 {x, y, w, h, side, depth, root, pinned}. 접힌 가지 아래는 넣지 않는다(hidden에 모음).
// sizeOf(id) → {w, h}(그린 크기). 뿌리는 자기 x·y(왼쪽 위). 가지는 부모 옆(HGAP)·형제는 위아래(VGAP)로 겹치지 않게, 부모 가운데 높이에 맞춘다.
// 손으로 둔 가지(pinned)는 형제 줄에서 빠져 자기 x·y에 서고(쪽은 부모 가운데보다 왼쪽이면 왼쪽), 그 아래 가지는 그 자리에서 자동.
// posOf(id) → {x, y} 또는 null: 끄는 중·크기를 바꾸는 중인 뿌리·손으로 둔 가지의 잠깐 자리(저장 전).
export function layoutMindmap(tree, sizeOf, {hgap = HGAP, vgap = VGAP, posOf = () => null} = {}) {
  const heights = subtreeHeights(tree, sizeOf), out = new Map(), hidden = new Set();
  const own = n => posOf(n.id) || {x:n.x, y:n.y};
  const fold = id => { for (const d of descendants(tree, id)) hidden.add(d); };
  // 그 상자 아래 가지 놓기: 자동 가지는 옆에 쌓고, 손으로 둔 가지는 제자리.
  const branch = (id, r, side, depth, root) => {
    const n = tree.byId.get(id), ks = childrenOf(tree, id);
    if (n.collapsed) { fold(id); return; }
    const auto = ks.filter(k => !k.pinned).map(k => k.id);
    if (side === 0) {
      const sides = rootSides(tree, id, k => heights.get(k));
      stack(auto.filter(k => sides.get(k) === 1), r.x + r.w + hgap, r.y + r.h / 2, 1, depth + 1, root);
      stack(auto.filter(k => sides.get(k) === -1), r.x - hgap, r.y + r.h / 2, -1, depth + 1, root);
    } else stack(auto, side === -1 ? r.x - hgap : r.x + r.w + hgap, r.y + r.h / 2, side, depth + 1, root);
    for (const k of ks) if (k.pinned) pin(k, r, depth + 1, root);
  };
  const pin = (k, parent, depth, root) => {
    const {w, h} = sizeOf(k.id), p = own(k), side = p.x + w / 2 < parent.x + parent.w / 2 ? -1 : 1;
    const r = {x:p.x, y:p.y, w, h, side, depth, root, pinned:true};
    out.set(k.id, r); branch(k.id, r, side, depth, root);
  };
  const place = (id, x, cy, side, depth, root) => {
    const {w, h} = sizeOf(id), left = side === -1 ? x - w : x, r = {x:left, y:cy - h / 2, w, h, side, depth, root};
    out.set(id, r); branch(id, r, side, depth, root);
  };
  const stack = (ids, x, cy, side, depth, root) => {
    const total = ids.reduce((s, id) => s + heights.get(id), 0) + Math.max(0, ids.length - 1) * vgap;
    let top = cy - total / 2;
    for (const id of ids) { const hh = heights.get(id); place(id, x, top + hh / 2, side, depth, root); top += hh + vgap; }
  };
  for (const n of tree.roots) {
    const {w, h} = sizeOf(n.id), p = own(n), r = {x:p.x, y:p.y, w, h, side:0, depth:0, root:n.id};
    out.set(n.id, r); branch(n.id, r, 0, 0, n.id);
  }
  return {rects:out, hidden};
}

// 가지 선(부모 → 가지): 부모 옆 가운데에서 가지 반대쪽 가운데로 부드러운 곡선.
export function branchPath(p, c, side) {
  const s = side === -1 ? -1 : 1;
  const x1 = s === 1 ? p.x + p.w : p.x, y1 = p.y + p.h / 2, x2 = s === 1 ? c.x : c.x + c.w, y2 = c.y + c.h / 2;
  const mx = (x1 + x2) / 2, r = v => Math.round(v * 10) / 10;
  return `M${r(x1)} ${r(y1)}C${r(mx)} ${r(y1)} ${r(mx)} ${r(y2)} ${r(x2)} ${r(y2)}`;
}
// 가지 선 색: 자기 색 → 위로 올라가며 처음 만나는 색(뿌리 빼고) → 뿌리 가지 순서로 돌림(0~7).
export function branchTone(tree, id) {
  let cur = id;
  while (tree.parentOf.has(cur)) {
    const n = tree.byId.get(cur); if (n.color != null) return n.color;
    const p = tree.parentOf.get(cur);
    if (!tree.parentOf.has(p)) return childrenOf(tree, p).findIndex(k => k.id === cur) % NODE_COLORS.length;
    cur = p;
  }
  return null;
}

// 놓을 곳: 점이 닿은 상자(고른 가지와 그 아래는 뺌). 뿌리가 아닌 상자는 위·아래 1/4 = 그 앞·뒤 형제, 가운데 = 그 아래 가지.
export function dropTarget(rects, point, skip = new Set(), isRoot = () => false, pad = 6) {
  let best = null;
  for (const [id, r] of rects) {
    if (skip.has(id)) continue;
    if (point.x < r.x - pad || point.x > r.x + r.w + pad || point.y < r.y - pad || point.y > r.y + r.h + pad) continue;
    const d = Math.hypot(point.x - (r.x + r.w / 2), point.y - (r.y + r.h / 2));
    if (!best || d < best.d) best = {id, r, d};
  }
  if (!best) return null;
  if (isRoot(best.id)) return {id:best.id, zone:'in'};
  const rel = (point.y - best.r.y) / Math.max(1, best.r.h);
  return {id:best.id, zone:rel < 0.25 ? 'before' : rel > 0.75 ? 'after' : 'in'};
}
// 가장 가까운 상자(잇기 끝 붙이기): 칸 밖이어도 snap(판 px) 안이면 그 상자.
export function nearestRect(rects, point, skip = new Set(), snap = 24) {
  let best = null;
  for (const [id, r] of rects) {
    if (skip.has(id)) continue;
    const dx = Math.max(r.x - point.x, 0, point.x - (r.x + r.w)), dy = Math.max(r.y - point.y, 0, point.y - (r.y + r.h)), d = Math.hypot(dx, dy);
    if (d <= snap && (!best || d < best.d)) best = {id, d};
  }
  return best?.id ?? null;
}

// 형제 사이에 끼울 ord. index = 넣을 자리(0 = 맨 앞). 사이가 없으면 형제 전부 새 번호(renumber: [{id, ord}]).
export function ordAt(siblings, index) {
  const list = siblings.map(s => s.ord), i = Math.max(0, Math.min(index, list.length));
  const before = i > 0 ? list[i - 1] : null, after = i < list.length ? list[i] : null;
  if (before == null && after == null) return {ord:0, renumber:[]};
  if (after == null) { if (before + ORD_STEP <= ORD_MAX) return {ord:before + ORD_STEP, renumber:[]}; }
  else if (before == null) { if (after - ORD_STEP >= 0) return {ord:after - ORD_STEP, renumber:[]}; if (after > 0) return {ord:Math.floor(after / 2), renumber:[]}; }
  else if (after - before >= 2) return {ord:Math.floor((before + after) / 2), renumber:[]};
  // 사이가 없다: 넣을 자리를 비우고 모두 다시 번호.
  const renumber = [], step = Math.max(1, Math.min(ORD_STEP, Math.floor(ORD_MAX / (siblings.length + 1))));
  let ord = 0;
  siblings.forEach((s, k) => { if (k === i) ord += step; if (s.ord !== ord) renumber.push({id:s.id, ord}); ord += step; });
  return {ord:i * step, renumber};
}

// 키보드 길 찾기(←→↑↓): 오른쪽 가지에서 → = 첫 가지, ← = 부모(왼쪽 가지는 반대). ↑↓ = 화면에서 위·아래로 가장 가까운 보이는 상자(같은 뿌리 먼저).
export function neighbor(tree, rects, id, key) {
  const r = rects.get(id); if (!r) return null;
  const side = r.side || 1, kids = childrenOf(tree, id).filter(k => rects.has(k.id));
  const parent = tree.parentOf.get(id);
  const toward = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  if (toward) {
    if (!parent) { // 뿌리: 그쪽 첫 가지
      const k = kids.find(c => rects.get(c.id).side === toward); return k?.id ?? null;
    }
    if (toward === side) return tree.byId.get(id).collapsed ? null : kids[0]?.id ?? null;
    return parent;
  }
  const dir = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0; if (!dir) return null;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let best = null;
  for (const [oid, o] of rects) {
    if (oid === id) continue;
    const oy = o.y + o.h / 2, dy = (oy - cy) * dir; if (dy <= 1) continue;
    const score = dy + Math.abs(o.x + o.w / 2 - cx) * 2 + (o.root === r.root ? 0 : 100000);
    if (!best || score < best.score) best = {id:oid, score};
  }
  return best?.id ?? null;
}

export const stepFont = (font, dir) => Math.max(FONT_MIN, Math.min(FONT_MAX, (font || FONT_DEFAULT) + dir));
// 상자 칸들을 감싸는 칸(맞추기·화면 밖 그리기 판단).
export function boundsOf(rects) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) { x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
  return Number.isFinite(x1) ? {x:x1, y:y1, w:x2 - x1, h:y2 - y1} : null;
}
// 뿌리를 옮겼을 때 저장할 자리(판 범위 안 정수).
export const rootPlace = (x, y) => ({x:at(x), y:at(y)});
