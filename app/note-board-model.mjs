// NOTE-보기3가지 (요청함 10/29 15:05, 명진 결정 15:10 '추천대로'): 포스트잇 보기의 자리 계산(화면 없음, 시험 가능).
// - 저장 모양: 노트 행의 기존 metadata.board = {x, y, r, z}. x·y = 보드 왼쪽 위에서의 자리(확대 1배 px), r = 기울기(도), z = 겹친 순서(클수록 위).
//   저장·읽기 길은 basket-data.js setNoteBoard(고정·폴더와 같은 metadata 쓰기). 기기 저장 없음.
// - 처음 배치: 저장된 자리가 하나도 없으면 폴더끼리 모아 흩어 놓는다(같은 노트 목록이면 어느 기기에서나 같은 모양).
//   하나라도 저장돼 있으면 자리가 없는 노트(새 노트)는 보드 왼쪽 위에서부터 빈 곳에 붙는다.
//   처음 한 장을 옮기는 순간 아직 저장 안 된 노트들도 지금 보이는 자리로 함께 저장한다(다른 칸이 튀지 않게, basket-notes.js).
// - 칸 크기는 모두 같다(크기 바꾸기 없음). 색은 폴더마다 다른 연한 색(tone 0~7, 노랑 없음 — 색 값은 basket.css), 폴더 없음은 'none'.
export const CARD = 148, GAP = 22, SLOT = CARD + GAP, PAD = 24;
export const BOARD_MAX = 20000, Z_MAX = 1e9, TILT_MAX = 6;
export const MIN_W = 1200, MIN_H = 900, ROOM = 360; // 보드는 화면보다 넓게: 놓인 칸 바깥으로 ROOM만큼 더 둔다
export const TONES = 8;
export const ZOOMS = Object.freeze([0.5, 0.65, 0.8, 1, 1.25, 1.5]);
export const CLUSTER_WRAP = 1500; // 처음 배치에서 폴더 묶음을 한 줄에 늘어놓는 너비

const hash = value => { let h = 2166136261; for (const ch of String(value)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const num = v => typeof v === 'number' && Number.isFinite(v);
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

// 폴더 색(같은 폴더는 어느 기기에서나 같은 색). 폴더 없음 = 'none'(회색 계열).
export const folderTone = folderId => (folderId == null ? 'none' : String(hash(folderId) % TONES));
// 노트마다 정해진 살짝 기울기(-4~4도, 0 없음).
export function tiltFor(id) { const t = (hash('t' + id) % 9) - 4; return t === 0 ? (hash(id) % 2 ? 1.5 : -1.5) : t; }
const jitter = (id, salt, span) => (hash(salt + id) % (span * 2 + 1)) - span;

// 저장된 자리(모양이 틀리면 null = 자리 없음으로 보고 다시 놓는다).
export function boardOf(note) {
  const b = plain(note?.metadata) ? note.metadata.board : null;
  if (!plain(b) || !num(b.x) || !num(b.y) || !num(b.r) || !Number.isInteger(b.z)) return null;
  if (b.x < 0 || b.y < 0 || b.x > BOARD_MAX || b.y > BOARD_MAX || Math.abs(b.r) > TILT_MAX || b.z < 0 || b.z > Z_MAX) return null;
  return {x:b.x, y:b.y, r:b.r, z:b.z};
}
export const clampPos = v => Math.round(Math.max(0, Math.min(BOARD_MAX - CARD, v)));
const overlaps = (a, b) => a.x < b.x + CARD && b.x < a.x + CARD && a.y < b.y + CARD && b.y < a.y + CARD;
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
    const w = cols * (CARD - 18) + 18 + GAP * 2, h = rows * (CARD - 24) + 24 + GAP * 2;
    if (x0 > PAD && x0 + w > CLUSTER_WRAP) { x0 = PAD; y0 += rowH; rowH = 0; }
    notes.forEach((note, i) => {
      // 묶음 안에서는 살짝 겹쳐(포스트잇 뭉치) 흩어 놓는다.
      const cx = x0 + (i % cols) * (CARD - 18) + jitter(note.id, 'x', 10), cy = y0 + Math.floor(i / cols) * (CARD - 24) + jitter(note.id, 'y', 8);
      out.set(note.id, {x:clampPos(cx), y:clampPos(cy), r:tiltFor(note.id), z:z++});
    });
    x0 += w; rowH = Math.max(rowH, h);
  }
  return out;
}
// 저장된 칸들과 겹치지 않는 왼쪽 위 빈 칸부터(가로 cols칸씩 줄을 훑는다). 새 노트가 먼저 좋은 자리를 받는다.
function freePlace(list, taken, startZ) {
  const out = new Map(), used = [...taken];
  const cols = Math.max(4, Math.floor(CLUSTER_WRAP / SLOT));
  const maxSlot = cols * Math.floor((BOARD_MAX - CARD - PAD) / SLOT);
  const slotAt = s => ({x:PAD + (s % cols) * SLOT, y:PAD + Math.floor(s / cols) * SLOT});
  let slot = 0, z = startZ;
  for (const note of [...list].sort(newestFirst)) {
    while (slot < maxSlot && used.some(u => overlaps(u, slotAt(slot)))) slot++;
    const at = slotAt(Math.min(slot, maxSlot)), p = {x:clampPos(at.x), y:clampPos(at.y), r:tiltFor(note.id), z:z++};
    out.set(note.id, p); used.push(p);
    if (slot < maxSlot) slot++;
  }
  return out;
}

// 모든 노트의 자리. 돌려주는 Map: id → {x, y, r, z, saved}. saved=false는 아직 서버에 없는 계산 자리.
export function layoutBoard(notes, folderOf = () => null) {
  const out = new Map(), unsaved = [];
  for (const note of notes) { const b = boardOf(note); if (b) out.set(note.id, {...b, saved:true}); else unsaved.push(note); }
  if (!unsaved.length) return out;
  const placed = out.size ? freePlace(unsaved, [...out.values()], topZ(out) + 1) : clusterPlace(unsaved, folderOf);
  for (const [id, p] of placed) out.set(id, {...p, saved:false});
  return out;
}
export function topZ(places) { let z = -1; for (const p of places.values()) if (p.z > z) z = p.z; return z; }
// 보드 크기(확대 1배 px): 놓인 칸 바깥으로 여유를 두고, 최소 크기 이상.
export function boardExtent(places) {
  let w = MIN_W, h = MIN_H;
  for (const p of places.values()) { w = Math.max(w, p.x + CARD + ROOM); h = Math.max(h, p.y + CARD + ROOM); }
  return {w:Math.min(w, BOARD_MAX), h:Math.min(h, BOARD_MAX)};
}
// 끌어 놓은 자리: 옮긴 만큼 더하고 맨 위로.
export function movedTo(place, dx, dy, top) {
  return {x:clampPos(place.x + dx), y:clampPos(place.y + dy), r:place.r, z:Math.min(Z_MAX, top + 1)};
}
// 확대 단계 한 칸(dir +1 크게, -1 작게). 끝이면 그대로.
export function stepZoom(zoom, dir) {
  let at = ZOOMS.indexOf(zoom); if (at < 0) at = ZOOMS.indexOf(1);
  return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, at + Math.sign(dir)))];
}
