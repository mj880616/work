// S69-88(사용자 11/25 02:46~02:48 "보드에서 이 입력창 자체를 좀 자유자재로 크기 조절 … 높이 폭 모두", "이동도 자유롭고 파워포인트처럼"):
// 노트 › 보드의 상자·노트 카드 틀(크기 손잡이 8개·자유 이동·맞춤선) 계산(화면 없음, 시험 가능). 그리는 곳은 note-board.js 하나.
// - 손잡이: 네 모서리(nw·ne·se·sw = 폭·높이 함께, 자유 비율)와 네 변 가운데(n·e·s·w = 그 방향만).
//   왼쪽·위쪽 손잡이는 반대편(오른쪽·아래쪽 변)을 고정하고 늘린다. 크기는 범위 안으로 자르고, 판 왼쪽·위 끝(0)을 넘지 않는다.
// - 맞춤선(스마트 가이드): 끄는 칸의 왼쪽·가운데·오른쪽(위·가운데·아래)이 다른 칸의 같은 선과 threshold 안이면 그 선에 붙고 가는 선을 보인다.
// - 기기 저장 없음. 범위는 서버 check와 같다(상자: migration 20261125000000 w 60~600, 20261125020000 h 30~1200 · 카드: note-board-model.mjs).
export const HANDLES = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
export const HANDLE_NAMES = Object.freeze({nw:'왼쪽 위', n:'위', ne:'오른쪽 위', e:'오른쪽', se:'오른쪽 아래', s:'아래', sw:'왼쪽 아래', w:'왼쪽'});
export const FRAME_LIMITS = Object.freeze({wMin:60, wMax:600, hMin:30, hMax:1200});
export const SNAP_PX = 6; // 화면 px(판 좌표로는 배율로 나눈다)

export const clampSize = (v, lo, hi) => Math.round(Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo)));

// 손잡이를 (dx, dy)만큼 끈 칸. start = 끌기 시작 칸 {x, y, w, h}(판 좌표). 반대편 변은 그대로.
export function resizeRect(start, handle, dx, dy, lim = FRAME_LIMITS) {
  let {x, y, w, h} = start;
  const right = start.x + start.w, bottom = start.y + start.h;
  if (handle.includes('e')) w = clampSize(start.w + dx, lim.wMin, lim.wMax);
  if (handle.includes('w')) { w = clampSize(Math.min(start.w - dx, right), lim.wMin, lim.wMax); x = right - w; }
  if (handle.includes('s')) h = clampSize(start.h + dy, lim.hMin, lim.hMax);
  if (handle.includes('n')) { h = clampSize(Math.min(start.h - dy, bottom), lim.hMin, lim.hMax); y = bottom - h; }
  return {x:Math.round(x), y:Math.round(y), w, h};
}

// 맞춤선: rect(끄는 칸, 판 좌표)를 others(다른 칸들) 선에 붙일 만큼(dx, dy)과 그릴 선들.
// 가로(x) 맞춤 = 세로 선, 세로(y) 맞춤 = 가로 선. 가장 가까운 하나씩만.
export function snapMove(rect, others, threshold = SNAP_PX) {
  const xsOf = r => [r.x, r.x + r.w / 2, r.x + r.w], ysOf = r => [r.y, r.y + r.h / 2, r.y + r.h];
  let bx = null, by = null;
  for (const o of others) {
    for (const a of xsOf(rect)) for (const b of xsOf(o)) { const d = b - a; if (Math.abs(d) <= threshold && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = {d, at:b}; }
    for (const a of ysOf(rect)) for (const b of ysOf(o)) { const d = b - a; if (Math.abs(d) <= threshold && (!by || Math.abs(d) < Math.abs(by.d))) by = {d, at:b}; }
  }
  const dx = bx ? bx.d : 0, dy = by ? by.d : 0, moved = {...rect, x:rect.x + dx, y:rect.y + dy}, guides = [];
  const near = v => Math.abs(v) < 0.5;
  if (bx) { // 그 세로 선에 닿는 칸들을 모두 이어 그린다
    const hit = others.filter(o => xsOf(o).some(v => near(v - bx.at)));
    const y1 = Math.min(moved.y, ...hit.map(o => o.y)), y2 = Math.max(moved.y + moved.h, ...hit.map(o => o.y + o.h));
    guides.push({x1:bx.at, y1, x2:bx.at, y2});
  }
  if (by) {
    const hit = others.filter(o => ysOf(o).some(v => near(v - by.at)));
    const x1 = Math.min(moved.x, ...hit.map(o => o.x)), x2 = Math.max(moved.x + moved.w, ...hit.map(o => o.x + o.w));
    guides.push({x1, y1:by.at, x2, y2:by.at});
  }
  return {dx, dy, guides};
}

// 화살표 키 한 번에 옮길 만큼(판 px): 1px, Shift = 10px.
export const arrowStep = (key, shift) => {
  const d = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]}[key];
  return d ? {dx:d[0] * (shift ? 10 : 1), dy:d[1] * (shift ? 10 : 1)} : null;
};
// 손으로 정한 크기 저장 값: 끈 손잡이의 축만 바꾸고(변 손잡이 = 그 방향만), 다른 축은 지금 값 그대로(비어 있으면 글 길이만큼).
export function sizePatch(handle, next, old = {}) {
  return {w:/[ew]/.test(handle) ? next.w : old.w ?? null, h:/[ns]/.test(handle) ? next.h : old.h ?? null};
}
