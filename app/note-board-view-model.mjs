// S71-52 ② NOTE-큰생각지도 보기 기능 계산(화면 없음, 시험 가능): 멀리 보기 단계·미니맵 자리·이 가지만 보기·찾은 주제로 가기.
// 사용자 2026-11-26 19:58 "굉장히 광범위한 생각지도를 만드는데 쓸거야 / 무한정 뻗어나가는." 화면은 note-board.js, 결정 docs/design/note-board-mindmap.md 11절.
import { descendants } from './note-board-mindmap-model.mjs';

// 멀리 보기: 배율이 FAR_Z보다 작으면 큰 가지(깊이 FAR_DEPTH 미만 — 뿌리·첫 가지)만 글자, 그 아래는 흐린 막대.
// 큰 가지 글자는 화면에서 약 FAR_PX(px) 높이로 보이게 키운다(14px 글자 기준 scale). step = 배율 계단(15%) — 계단이 바뀔 때만 화면 값을 고친다.
export const FAR_Z = 0.45, FAR_DEPTH = 2, FAR_PX = 13, FAR_SCALE_MAX = 12;
export function farOf(z) {
  if (!(z > 0) || z >= FAR_Z) return {on:false, step:null, scale:1};
  const step = Math.round(Math.log(z) / Math.log(1.15));
  const zq = 1.15 ** step;
  return {on:true, step, scale:Math.round(Math.min(FAR_SCALE_MAX, Math.max(1, FAR_PX / (14 * zq))) * 100) / 100};
}

// 미니맵: 모든 칸(rects, 판 좌표)을 감싼 범위를 w×h 칸에 맞춘다(가장자리 pad, 가로·세로 같은 비율, 가운데 맞춤).
// 돌려주는 것 {x, y, s, ox, oy} — 판 좌표 p → 미니맵 (ox + (p.x - x) * s, oy + (p.y - y) * s). 칸이 없으면 null.
export function miniLayout(rects, w, h, pad = 6) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) { if (!r) continue; x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + (r.w || 0)); y1 = Math.max(y1, r.y + (r.h || 0)); }
  if (!Number.isFinite(x0)) return null;
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0), s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  return {x:x0, y:y0, s, ox:(w - bw * s) / 2, oy:(h - bh * s) / 2};
}
// 미니맵 점(px) → 판 좌표, 판 사각형 → 미니맵 사각형.
export const fromMini = (m, px, py) => ({x:m.x + (px - m.ox) / m.s, y:m.y + (py - m.oy) / m.s});
export const toMini = (m, r) => ({x:m.ox + (r.x - m.x) * m.s, y:m.oy + (r.y - m.y) * m.s, w:r.w * m.s, h:r.h * m.s});

// 이 가지만 보기: 그 칸과 그 아래 전부.
export const focusIds = (tree, id) => new Set([id, ...descendants(tree, id)]);
// 찾은 주제로 갈 때 펴야 할 접힌 윗가지(가까운 것부터).
export function ancestorsOf(tree, id) {
  const out = []; let cur = id;
  while (tree.parentOf.has(cur)) { cur = tree.parentOf.get(cur); out.push(cur); }
  return out;
}
// 찾은 주제 목록에 보일 개수(나머지는 '외 N개').
export const FIND_SHOW = 30;
