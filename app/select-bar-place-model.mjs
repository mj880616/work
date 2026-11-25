// S70-16 UI-고른글메뉴(명진 2026-11-25 09:51 "이 메뉴가 글을 가리지 않는 곳에 뜨게"): '선택한 글' 막대(text-select-bar.js) 자리 고르기의 순수 계산. DOM 없음.
// 넓은 화면(PC)만 쓴다 — 폰은 하단바 바로 위 고정 줄(자리 계산 없음).
// 차례: ① 글 칸 오른쪽 여백 ② 글 칸 왼쪽 여백 ③ 고른 글 위(한 줄 띄움 — 바로 앞 줄도 보이게) ④ 고른 글 아래(한 줄 띄움 — 바로 다음 줄도 보이게).
// 어디에도 자리가 없으면 null(부르는 쪽이 화면 아래 고정 줄로). 위를 아래보다 먼저 보는 것은 읽는 방향이 아래라 이미 읽은 쪽을 덮는 편이 덜 방해되기 때문.
// sel = 고른 글 상자(첫 줄 위~마지막 줄 아래), col = 글 칸 상자, bar = {w, h}, view = {w, h}(아래 바 몫을 뺀 높이), line = 글 한 줄 높이.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

export function pickBarSpot({sel, col, bar, view, line = 20, edge = 8, gap = 8} = {}) {
  if (!sel || !bar || !view || !(bar.w > 0) || !(bar.h > 0)) return null;
  const c = col || sel, w = bar.w, h = bar.h;
  // 고른 글이 화면 밖이면 자리를 잡지 않는다.
  if (sel.bottom < 0 || sel.top > view.h || sel.right < 0 || sel.left > view.w) return null;
  const sideTop = clamp(Math.max(sel.top, edge), edge, view.h - edge - h);
  if (c.right + gap + w <= view.w - edge) return {side: 'right', left: c.right + gap, top: sideTop};
  if (c.left - gap - w >= edge) return {side: 'left', left: c.left - gap - w, top: sideTop};
  const left = clamp(sel.left, edge, view.w - edge - w);
  const aboveTop = sel.top - line - h;
  if (aboveTop >= edge) return {side: 'top', left, top: aboveTop};
  const belowTop = sel.bottom + line;
  if (belowTop + h <= view.h - edge) return {side: 'bottom', left, top: belowTop};
  return null;
}

// 두 상자가 겹치는가(시험·확인용).
export const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
