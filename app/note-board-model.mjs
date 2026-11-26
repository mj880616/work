// NOTE-보기3가지 (요청함 10/29 15:05, 명진 결정 15:10 '추천대로'): 보드 보기(옛 이름 포스트잇)의 자리 계산(화면 없음, 시험 가능).
// S68-38(명진 11/23 08:12·08:23): '포스트잇' → '보드'(생각 지도). 카드는 제목 한 줄만인 작은 칸(CARD_W×CARD_H)이고 기울이지 않고 그린다
//   (저장 모양의 r은 옛 값과 호환되게 그대로 둔다). 판은 끝없이 넓은 캔버스처럼 옮기고(translate) 키운다(scale) — 확대는 ZOOM_MIN~ZOOM_MAX 사이 연속 값.
// - 저장 모양: 노트 행의 기존 metadata.board = {x, y, r, z}. x·y = 보드 왼쪽 위에서의 자리(확대 1배 px), r = 기울기(도), z = 겹친 순서(클수록 위).
//   S69-83: 모든 노트를 늘어놓던 [전체](metadata.board 저장)는 없앴다. 지금 저장은 보드별 metadata.boards[id](note-boards-model.mjs, basket-data.js setNoteBoardPlace).
//   layoutBoard의 기본 placeOf(boardOf)는 자리 계산 시험용으로만 남는다(화면은 늘 보드별 placeOf를 넘긴다). 기기 저장 없음.
// - 처음 배치: 저장된 자리가 하나도 없으면 폴더끼리 모아 흩어 놓는다(같은 노트 목록이면 어느 기기에서나 같은 모양).
//   하나라도 저장돼 있으면 자리가 없는 노트(새 노트)는 보드 왼쪽 위에서부터 빈 곳에 붙는다.
//   처음 한 장을 옮기는 순간 아직 저장 안 된 노트들도 지금 보이는 자리로 함께 저장한다(다른 칸이 튀지 않게, basket-notes.js).
// - S69-88(명진 11/25 02:46~02:48 "크기 조절 … 높이 폭 모두", "노트 내용, 링크는 유지하더라도 텍스트는 다르게"): 카드 자리 값에 손으로 정한 크기(w·h, 비면 CARD_W×CARD_H)와
//   그 보드에서만 보일 글자(label, 비면 노트 제목)를 함께 둔다 — {x, y, r, z, w?, h?, label?}. 노트 제목·내용·연결은 그대로(누르면 그 노트가 열림).
// - 칸 기본 크기는 모두 같다(CARD_W×CARD_H). 색은 폴더마다 다른 연한 색(tone 0~7, 노랑 없음 — 색 값은 basket.css), 폴더 없음은 'none'.
import { clampCoord, okCoord, COORD_LIMIT } from './note-board-coord.mjs';
export const CARD_W = 128, CARD_H = 34, GAP = 22, SLOT_W = CARD_W + GAP, SLOT_H = CARD_H + GAP, PAD = 24;
export const BOARD_MAX = 20000, Z_MAX = 1e9, TILT_MAX = 6; // S71-52: BOARD_MAX는 자리 없는 새 노트를 처음 늘어놓는 범위만(판 끝이 아님 — 판 범위는 note-board-coord.mjs)
export const MIN_W = 1200, MIN_H = 900, ROOM = 360; // 보드는 화면보다 넓게: 놓인 칸 바깥으로 ROOM만큼 더 둔다
export const TONES = 8;
export const ZOOM_MIN = 0.04, ZOOM_MAX = 2.5, ZOOM_STEP = 1.25; // S71-52 ②: 큰 생각지도를 한눈에 — 0.2 → 0.04(멀리 보기는 note-board-view-model.mjs FAR_Z 아래)
export const CLUSTER_WRAP = 1500; // 처음 배치에서 폴더 묶음을 한 줄에 늘어놓는 너비

export const CARD_W_MIN = 60, CARD_W_MAX = 600, CARD_H_MIN = 30, CARD_H_MAX = 1200, CARD_LABEL_MAX = 100;
const hash = value => { let h = 2166136261; for (const ch of String(value)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const num = v => typeof v === 'number' && Number.isFinite(v);
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

// 폴더 색(같은 폴더는 어느 기기에서나 같은 색). 폴더 없음 = 'none'(회색 계열).
export const folderTone = folderId => (folderId == null ? 'none' : String(hash(folderId) % TONES));
// 노트마다 정해진 살짝 기울기(-4~4도, 0 없음).
export function tiltFor(id) { const t = (hash('t' + id) % 9) - 4; return t === 0 ? (hash(id) % 2 ? 1.5 : -1.5) : t; }
const jitter = (id, salt, span) => (hash(salt + id) % (span * 2 + 1)) - span;

// 자리 값 하나의 모양 검사(맞으면 {x, y, r, z}, 틀리면 null). [전체]의 metadata.board와 보드별 metadata.boards[id]가 같은 모양이다.
export function placeShape(b) {
  if (!plain(b) || !num(b.x) || !num(b.y) || !num(b.r) || !Number.isInteger(b.z)) return null;
  if (!okCoord(b.x) || !okCoord(b.y) || Math.abs(b.r) > TILT_MAX || b.z < 0 || b.z > Z_MAX) return null; // S71-52: 판은 음수 쪽으로도 뻗는다
  const out = {x:b.x, y:b.y, r:b.r, z:b.z};
  if (Number.isInteger(b.w) && b.w >= CARD_W_MIN && b.w <= CARD_W_MAX) out.w = b.w;
  if (Number.isInteger(b.h) && b.h >= CARD_H_MIN && b.h <= CARD_H_MAX) out.h = b.h;
  const label = cardLabelOf(b.label); if (label) out.label = label;
  return out;
}
// 보드에 보일 글자(별명) 모양 검사: 한 줄·앞뒤 빈칸 없음·CARD_LABEL_MAX자까지. 틀리면 null(= 노트 제목).
function cardLabelOf(v) {
  if (typeof v !== 'string' || !v || v !== v.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(v) || [...v].length > CARD_LABEL_MAX) return null;
  return v;
}
// 입력한 별명 → 저장할 값(비면 null = 노트 제목으로 돌아감). 줄바꿈은 빈칸 하나로.
export function validateCardLabel(text) {
  const raw = typeof text === 'string' ? text.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() : '';
  if (!raw) return null;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) throw new Error('보드에 보일 글자에 쓸 수 없는 문자가 있어요.');
  if ([...raw].length > CARD_LABEL_MAX) throw new Error(`보드에 보일 글자는 ${CARD_LABEL_MAX}자까지 쓸 수 있어요.`);
  return raw;
}
// 카드에 보일 글자: 별명이 있으면 별명, 없으면 노트 제목.
export const cardLabel = (place, title) => place?.label || title;
// 저장할 자리 값만(계산용 saved 등은 뺀다). 크기·별명은 있을 때만.
export function placeFields(p) {
  const out = {x:p.x, y:p.y, r:p.r, z:p.z};
  if (p.w != null) out.w = p.w;
  if (p.h != null) out.h = p.h;
  if (p.label) out.label = p.label;
  return out;
}
// 저장된 자리(모양이 틀리면 null = 자리 없음으로 보고 다시 놓는다). [전체] 보드.
export const boardOf = note => placeShape(plain(note?.metadata) ? note.metadata.board : null);
// S71-52 NOTE-큰생각지도: 판은 끝이 없다 — 자리는 저장 범위(note-board-coord.mjs ±COORD_LIMIT) 안으로만 맞춘다(음수 포함). size는 옛 부르는 쪽 호환용.
export const clampPos = (v, size = CARD_W) => clampCoord(Math.min(COORD_LIMIT - size, v));
const clampX = v => clampPos(v, CARD_W), clampY = v => clampPos(v, CARD_H);
const overlaps = (a, b) => a.x < b.x + CARD_W && b.x < a.x + CARD_W && a.y < b.y + CARD_H && b.y < a.y + CARD_H;
const time = v => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };
const newestFirst = (a, b) => time(b.updated_at) - time(a.updated_at) || String(b.id).localeCompare(String(a.id));

// 폴더끼리 모아 흩어 놓기: 최근 고친 노트가 든 폴더 묶음부터 왼쪽 위에서 오른쪽으로, 줄이 차면 아래로.
function clusterPlace(list, folderOf) {
  const groups = new Map();
  for (const note of [...list].sort(newestFirst)) { const key = folderOf(note) ?? ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(note); }
  const out = new Map();
  let x0 = PAD, y0 = PAD, rowH = 0, z = 0;
  for (const notes of groups.values()) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(notes.length))), rows = Math.ceil(notes.length / cols);
    const w = cols * SLOT_W + GAP, h = rows * SLOT_H + GAP;
    if (x0 > PAD && x0 + w > CLUSTER_WRAP) { x0 = PAD; y0 += rowH; rowH = 0; }
    notes.forEach((note, i) => {
      // 묶음 안에서는 겹치지 않게 살짝 흩어 놓는다(제목이 가려지지 않게, 흔들림은 칸 사이 틈보다 작게).
      const cx = x0 + (i % cols) * SLOT_W + jitter(note.id, 'x', 6), cy = y0 + Math.floor(i / cols) * SLOT_H + jitter(note.id, 'y', 6);
      out.set(note.id, {x:clampX(cx), y:clampY(cy), r:tiltFor(note.id), z:z++});
    });
    x0 += w; rowH = Math.max(rowH, h);
  }
  return out;
}
// 저장된 칸들과 겹치지 않는 왼쪽 위 빈 칸부터(가로 cols칸씩 줄을 훑는다). 새 노트가 먼저 좋은 자리를 받는다.
function freePlace(list, taken, startZ) {
  const out = new Map(), used = [...taken];
  const cols = Math.max(4, Math.floor(CLUSTER_WRAP / SLOT_W));
  const maxSlot = cols * Math.floor((BOARD_MAX - CARD_H - PAD) / SLOT_H);
  const slotAt = s => ({x:PAD + (s % cols) * SLOT_W, y:PAD + Math.floor(s / cols) * SLOT_H});
  let slot = 0, z = startZ;
  for (const note of [...list].sort(newestFirst)) {
    while (slot < maxSlot && used.some(u => overlaps(u, slotAt(slot)))) slot++;
    const at = slotAt(Math.min(slot, maxSlot)), p = {x:clampX(at.x), y:clampY(at.y), r:tiltFor(note.id), z:z++};
    out.set(note.id, p); used.push(p);
    if (slot < maxSlot) slot++;
  }
  return out;
}

// 모든 노트의 자리. 돌려주는 Map: id → {x, y, r, z, saved}. saved=false는 아직 서버에 없는 계산 자리.
// placeOf(note) → 저장된 자리 또는 null(기본 [전체] = boardOf; 이름 붙은 보드는 note-boards-model.mjs boardPlaceOf).
export function layoutBoard(notes, folderOf = () => null, placeOf = boardOf) {
  const out = new Map(), unsaved = [];
  for (const note of notes) { const b = placeOf(note); if (b) out.set(note.id, {...b, saved:true}); else unsaved.push(note); }
  if (!unsaved.length) return out;
  const placed = out.size ? freePlace(unsaved, [...out.values()], topZ(out) + 1) : clusterPlace(unsaved, folderOf);
  for (const [id, p] of placed) out.set(id, {...p, saved:false});
  return out;
}
export function topZ(places) { let z = -1; for (const p of places.values()) if (p.z > z) z = p.z; return z; }
// 보드 크기(확대 1배 px): 놓인 칸 바깥으로 여유를 두고, 최소 크기 이상.
export function boardExtent(places) {
  let w = MIN_W, h = MIN_H;
  for (const p of places.values()) { w = Math.max(w, p.x + CARD_W + ROOM); h = Math.max(h, p.y + CARD_H + ROOM); }
  return {w:Math.min(w, BOARD_MAX), h:Math.min(h, BOARD_MAX)};
}
// 끌어 놓은 자리: 옮긴 만큼 더하고 맨 위로.
// 크기·별명은 그대로 가져간다.
export function movedTo(place, dx, dy, top) {
  return {...placeFields(place), x:clampPos(place.x + dx, place.w || CARD_W), y:clampPos(place.y + dy, place.h || CARD_H), z:Math.min(Z_MAX, top + 1)};
}

// ---- 판 보기(view = {x, y, z}: 판 좌표 (0,0)이 화면 칸의 (x, y)에 오고 z배로 키움). 이번 접속 화면 메모리만(저장 값 아님). ----
export const clampZoom = z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1));
// 한 단계 크게(+1)·작게(-1). 끝이면 그대로.
export const stepZoom = (zoom, dir) => clampZoom(Math.round(clampZoom(zoom) * ZOOM_STEP ** Math.sign(dir) * 1000) / 1000);
// 화면 칸의 점(px, py)을 그대로 둔 채 배율만 바꾼다(두 손가락·휠·[−][+]).
export function zoomAt(view, next, px, py) {
  const z = clampZoom(next), bx = (px - view.x) / view.z, by = (py - view.y) / view.z;
  return {x:px - bx * z, y:py - by * z, z};
}
// 화면 칸 좌표 → 판 좌표.
export const toBoard = (view, px, py) => ({x:(px - view.x) / view.z, y:(py - view.y) / view.z});
// 칸들이 모두 보이게([맞추기]). rects: [{x, y, w, h}] 판 좌표, width·height: 화면 칸 크기. 칸이 없으면 왼쪽 위 1배.
// S69-33(명진 11/24: [전체]를 누르니 한 줄에 아주 작은 카드 10개): minZ(읽을 수 있는 가장 작은 배율)보다 작게는 줄이지 않는다.
//   그만큼 줄여야 다 들어가는 판이면 그 축은 카드 묶음의 왼쪽·위 끝에 맞춰(pad만큼 띄워) 보인다 — 저장된 자리는 바꾸지 않는다(보기만).
export const FIT_MIN = 0.6;
export function fitView(rects, width, height, pad = 24, maxZ = 1, minZ = ZOOM_MIN) {
  if (!rects.length || width <= 0 || height <= 0) return {x:0, y:0, z:clampZoom(1)};
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  const z = clampZoom(Math.max(Math.min(minZ, maxZ), Math.min(maxZ, (width - pad * 2) / Math.max(1, x1 - x0), (height - pad * 2) / Math.max(1, y1 - y0))));
  const cw = (x1 - x0) * z, ch = (y1 - y0) * z;
  return {x:cw <= width - pad * 2 + 0.5 ? (width - cw) / 2 - x0 * z : pad - x0 * z, y:ch <= height - pad * 2 + 0.5 ? (height - ch) / 2 - y0 * z : pad - y0 * z, z};
}
// 카드 하나가 화면 가운데 오게(왼쪽 목록에서 이미 붙은 노트를 누름 → 그 카드로). 배율은 그대로, 너무 작으면 1배.
export function centerOn(view, rect, width, height, minZ = FIT_MIN) {
  const z = view.z < minZ ? 1 : view.z;
  return {x:width / 2 - (rect.x + rect.w / 2) * z, y:height / 2 - (rect.y + rect.h / 2) * z, z};
}
// 화면 가운데 근처에서 여러 장을 놓을 자리(폰 고르기 창 [붙이기]). point = 첫 장 가운데(판 좌표). 4장씩 한 줄.
export function spreadFrom(point, count, cols = 4) {
  return Array.from({length:count}, (_, i) => ({x:point.x + (i % cols) * SLOT_W, y:point.y + Math.floor(i / cols) * SLOT_H}));
}
// 지금 화면에 보이는 판 영역(판 좌표, margin만큼 넉넉히). 화면 밖 칸·선은 그리지 않는다.
export function visibleArea(view, width, height, margin = 200) {
  return {x:-view.x / view.z - margin, y:-view.y / view.z - margin, w:width / view.z + margin * 2, h:height / view.z + margin * 2};
}
export const rectsMeet = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const cardRect = p => ({x:p.x, y:p.y, w:p.w || CARD_W, h:p.h || CARD_H});
