// S70-16 UI-고른글메뉴(명진 2026-11-25 09:51 "이 메뉴가 글을 가리지 않는 곳에 뜨게"): '선택한 글' 막대(text-select-bar.js) 자리 고르기의 순수 계산. DOM 없음.
// S70-80 READ-형광펜안됨(명진 2026-11-26 09:04, CC 확인: 두 칸 보기에서 막대가 고른 글이 아니라 왼쪽 목록 칸 아래에 뜸):
//   옛 차례의 '글 칸 옆 여백'(① 오른쪽 ② 왼쪽)은 두 칸 보기에서 옆 칸(목록)을 여백으로 잘못 보고 막대를 목록 위에 띄웠다. 옆 여백 자리를 없애고
//   모든 화면(두 칸·한 칸·폰)이 고른 글 바로 위·아래 두 자리만 쓴다.
// 차례: PC = ① 고른 글 위(한 줄 띄움 — 바로 앞 줄도 보이게) ② 아래(한 줄 띄움 — 바로 다음 줄도 보이게).
//       폰(order 'below') = ① 아래(한 줄 + 선택 손잡이 자리) ② 위 — 폰 자체 선택 메뉴가 고른 글 위에 뜨므로 겹치지 않게 아래가 먼저.
// 가로: 고른 글 왼쪽 끝에 맞추되 글 칸(col) 안에 머문다(막대가 글 칸보다 넓으면 화면 안에만). 두 칸 보기에서 옆 칸(목록)으로 넘어가지 않는다.
// 어디에도 자리가 없으면 null(부르는 쪽이 화면 아래 고정 줄로).
// sel = 고른 글 상자(첫 줄 위~마지막 줄 아래), col = 글 칸 상자, bar = {w, h}, view = {w, h, top}(h는 아래 바 몫을 뺀 높이, top은 위 머리 몫), line = 글 한 줄 높이,
// handle = 고른 글 아래 손잡이 자리(폰 손가락 고르기, px).
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

export function pickBarSpot({sel, col, bar, view, line = 20, edge = 8, order = 'above', handle = 0} = {}) {
  if (!sel || !bar || !view || !(bar.w > 0) || !(bar.h > 0)) return null;
  const w = bar.w, h = bar.h, top0 = Math.max(edge, (view.top || 0) + edge);
  // 고른 글이 화면 밖이면 자리를 잡지 않는다.
  if (sel.bottom < (view.top || 0) || sel.top > view.h || sel.right < 0 || sel.left > view.w) return null;
  const c = col && col.right - col.left >= w ? col : null;
  const lo = c ? Math.max(edge, c.left) : edge, hi = (c ? Math.min(view.w - edge, c.right) : view.w - edge) - w;
  const left = clamp(sel.left, lo, hi);
  const above = () => { const top = sel.top - line - h; return top >= top0 ? {side: 'top', left, top} : null; };
  const below = () => { const top = sel.bottom + line + handle; return top + h <= view.h - edge ? {side: 'bottom', left, top} : null; };
  return order === 'below' ? below() || above() : above() || below();
}

// 두 상자가 겹치는가(시험·확인용).
export const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
