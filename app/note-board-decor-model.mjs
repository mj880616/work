// S69-91 ①(사용자 11/25 03:01 "파워포인트 처럼 도형 삽입 선 삽입 등 꾸밈 입력 자유롭게", 03:03 "배경 없는 텍스트도 추가 가능하게 크기 자유 이동 자유로워서
//   선 위에 놓기 등 자유롭게"): 노트 › 보드의 글자·도형·선 꾸미기 계산(화면 없음, 시험 가능). 그리는 곳은 note-board.js 하나.
// - 글자(kind label) = 배경·테두리 없는 글(파워포인트 텍스트 상자), 도형(kind shape) = 사각형·둥근 사각형·타원·마름모·삼각형·화살표.
//   둘 다 늘 혼자 선 칸(생각 지도 가지 자동 배치에 끼지 않음 — 서버 check도 같음). 고르기·손잡이 크기·자유 이동·맞춤선은 상자와 같은 부품.
// - 색은 번호(서버 smallint)로만 저장하고 화면은 테마 변수로 칠한다(하드코딩 색 없음): 0~7 노트 색, 8 바탕색, 9 진한 색, -1 없음.
// - 겹침 순서 z: 같은 보드 글 상자·글자·도형 안에서만(노트 카드는 그 위 칸, 선은 그 아래 칸).
// - 기기 저장 없음. 범위는 서버 check와 같다(migration 20261125040000_note_board_decor, 20261125040100_note_board_free_lines).
export const FREE_KINDS = Object.freeze(['label', 'shape']);
export const isFree = t => !!t && FREE_KINDS.includes(t.kind);
export const SHAPE_KINDS = Object.freeze(['rect', 'round', 'ellipse', 'diamond', 'triangle', 'arrow']);
export const SHAPE_KIND_NAMES = Object.freeze({rect:'사각형', round:'둥근 사각형', ellipse:'타원', diamond:'마름모', triangle:'삼각형', arrow:'화살표'});
// 색판: 번호 → 이름·테마 변수. 0~7은 노트 색(--ds-note-paper-n), 8·9는 앱 바탕(--kptu-surface)·글자 색(--kptu-ink).
export const PALETTE = Object.freeze([
  {n:0, name:'연두'}, {n:1, name:'하늘'}, {n:2, name:'연보라'}, {n:3, name:'살구'},
  {n:4, name:'민트'}, {n:5, name:'연분홍'}, {n:6, name:'쑥'}, {n:7, name:'회청'},
  {n:8, name:'바탕색'}, {n:9, name:'진한 색'},
]);
export const NONE = -1;
export const colorVar = n => (n === 8 ? 'var(--kptu-surface)' : n === 9 ? 'var(--kptu-ink)' : `var(--ds-note-paper-${n})`);
// 선·테두리·글자 색: 노트 색은 바탕용 옅은 색이라 선·글자로는 글자 색을 섞어 진한 변수(테마마다 같이 바뀜, 색 칸 부품이 받는 var(--토큰) 모양).
export const lineVar = n => (n === 8 ? 'var(--kptu-surface)' : n === 9 ? 'var(--kptu-ink)' : `var(--nb-ink-${n})`); // --nb-ink-n은 basket.css :root(노트 색 + 글자 색 섞음)
export const STROKE_WIDTHS = Object.freeze([1, 2, 4, 6]);
export const ALPHAS = Object.freeze([100, 75, 50, 25]);
export const ALIGNS = Object.freeze(['left', 'center', 'right']);
export const ALIGN_NAMES = Object.freeze({left:'왼쪽', center:'가운데', right:'오른쪽'});
export const Z_MIN = -100000, Z_MAX = 100000;
export const SHAPE_W = 120, SHAPE_H = 80; // 새 도형 크기(판 px)

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
// 서버 줄 → 꾸미기 칸(칸이 없으면 기본값 = 지금 모양).
export function decorShape(row = {}) {
  return {
    z:int(row.z, Z_MIN, Z_MAX) ?? 0,
    stroke:int(row.stroke, NONE, 9),
    stroke_w:int(row.stroke_w, 1, 8),
    dash:row.dash === true,
    alpha:int(row.alpha, 10, 100),
    bold:row.bold === true,
    align:ALIGNS.includes(row.align) ? row.align : null,
    ink:int(row.ink, 0, 9),
  };
}
// 칸 하나의 꾸미기 → CSS 변수(인라인 style 조각). 값이 없으면 빈 칸(종류별 기본은 basket.css).
export function decorStyle(t) {
  const out = [];
  if (t.color === NONE) out.push('--nb-fill:transparent');
  else if (Number.isInteger(t.color) && t.color >= 0) out.push(`--nb-fill:${colorVar(t.color)}`);
  if (t.stroke === NONE) out.push('--nb-stroke:transparent');
  else if (Number.isInteger(t.stroke)) out.push(`--nb-stroke:${lineVar(t.stroke)}`);
  if (t.stroke_w) out.push(`--nb-sw:${t.stroke_w}px`);
  if (t.alpha && t.alpha < 100) out.push(`opacity:${t.alpha / 100}`);
  if (Number.isInteger(t.ink)) out.push(`--nb-ink:${lineVar(t.ink)}`);
  if (t.align) out.push(`text-align:${t.align}`);
  return out.join(';');
}
// 그림으로 그리는 도형(마름모·삼각형·화살표)의 모양 — 0~100 칸 안 다각형(늘이면 칸에 맞춰 늘어남, 테두리 두께는 그대로).
const POLY = Object.freeze({
  diamond:'50,1 99,50 50,99 1,50',
  triangle:'50,1 99,99 1,99',
  arrow:'1,30 62,30 62,4 99,50 62,96 62,70 1,70',
});
export const shapeSvgPoints = shape => POLY[shape] || null;
// 겹침 순서: 맨 앞 = 지금 가장 큰 값 + 1, 맨 뒤 = 가장 작은 값 − 1(범위 안). 이미 맨 앞·뒤면 null(바꿀 것 없음).
export function zFront(list, id) {
  const me = list.find(t => t.id === id); if (!me) return null;
  const others = list.filter(t => t.id !== id);
  const top = others.length ? Math.max(...others.map(t => t.z || 0)) : me.z || 0;
  return (me.z || 0) > top ? null : Math.min(Z_MAX, top + 1);
}
export function zBack(list, id) {
  const me = list.find(t => t.id === id); if (!me) return null;
  const others = list.filter(t => t.id !== id);
  const low = others.length ? Math.min(...others.map(t => t.z || 0)) : me.z || 0;
  return (me.z || 0) < low ? null : Math.max(Z_MIN, low - 1);
}
// 화면 겹침 값(z-index): 1~ 양수로 줄 세운다(같은 z는 만든 순서).
export function zIndexes(list) {
  const order = [...list].map((t, i) => ({id:t.id, z:t.z || 0, i})).sort((a, b) => a.z - b.z || a.i - b.i);
  return new Map(order.map((t, i) => [t.id, i + 1]));
}
// 복제: 같은 꾸미기·크기, 조금 옆(16px)에, 맨 앞. 가지는 혼자 선 칸으로 복제한다(가지 관계는 복제하지 않음).
export function duplicateSpec(t, list) {
  const keys = ['kind', 'color', 'shape', 'font', 'w', 'h', 'stroke', 'stroke_w', 'dash', 'alpha', 'bold', 'align', 'ink'];
  const spec = {board_id:t.board_id, body:t.body, x:Math.min(100000, (t.x || 0) + 16), y:Math.min(100000, (t.y || 0) + 16), parent_id:null};
  for (const k of keys) if (t[k] !== undefined && t[k] !== null && t[k] !== false) spec[k] = t[k];
  const z = zFront([...list, {...t, id:'__copy', z:t.z}], '__copy'); if (z !== null) spec.z = z;
  return spec;
}
// 새 도형 칸(판 가운데 at = 도형 가운데).
export const newShapeSpec = (board_id, shape, at, z = 0) => ({board_id, kind:'shape', shape:SHAPE_KINDS.includes(shape) ? shape : 'rect', body:'',
  x:Math.max(0, Math.round(at.x - SHAPE_W / 2)), y:Math.max(0, Math.round(at.y - SHAPE_H / 2)), w:SHAPE_W, h:SHAPE_H, z});

// ---- 선 넣기(도구 줄 [선▾]) ----
export const LINE_KINDS = Object.freeze(['line', 'arrow', 'elbow', 'curve']);
export const LINE_KIND_NAMES = Object.freeze({line:'직선', arrow:'화살표 선', elbow:'꺾은선', curve:'곡선'});
export const LINE_LEN = 160; // 새 선 길이(판 px)
// 판 가운데에 가로로 놓는 새 선(양 끝 = 판 위 점). 곡선은 위로 살짝 휜 곡선(지나는 점).
export function newLineSpec(board_id, kind, at) {
  const y = Math.max(0, Math.round(at.y)), x0 = Math.max(0, Math.round(at.x - LINE_LEN / 2));
  const base = {board_id, from_note:null, to_note:null, from_text:null, to_text:null, from_x:x0, from_y:y, to_x:x0 + LINE_LEN, to_y:y, dash:'solid'};
  if (kind === 'arrow') return {...base, shape:'line', ends:'end'};
  if (kind === 'elbow') return {...base, shape:'elbow', ends:'end', to_y:y + 60};
  if (kind === 'curve') return {...base, shape:'curve', ends:'none', bend_x:0.5, bend_y:-0.25};
  return {...base, shape:'line', ends:'none'};
}
