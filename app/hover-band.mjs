// S71-48 NOTE-연결점유지(B2): 마우스를 올리면 떠 있는 손잡이(연결점 동그라미·⋯·×)가 나오는 상자의 '올림 판정' 공용 계산.
// 손잡이가 상자 밖에 떠 있어도, 손잡이가 보이는 동안은 '상자 + 보이는 손잡이를 둘러싼 띠'(BAND_PAD만큼 여유) 안이면 그 상자를 계속 올린 것으로 본다.
// 띠가 이웃 상자와 겹치면 커서에 가까운 상자 하나만. 띠를 벗어나면 HOVER_LEAVE_MS 뒤 내린다(주된 고침은 띠, 이 시간은 손 떨림 여유).
// 좌표는 모두 화면 좌표(getBoundingClientRect 모양: left·top·right·bottom). 손가락(터치)에는 쓰지 않는다.

/** 띠 바깥 여유(화면 px). */
export const BAND_PAD = 8;
/** 띠를 벗어난 뒤 내리기까지의 여유(ms). 공용 값 — 다른 '올리면 나오는 손잡이'도 이 값을 쓴다. */
export const HOVER_LEAVE_MS = 250;

const box = r => ({left:r.left, top:r.top, right:r.right, bottom:r.bottom});
const solid = r => r && r.right > r.left && r.bottom > r.top;

/** 상자 사각형과 보이는 손잡이 사각형들을 모두 덮는 사각형에 여유 pad를 더한 띠. */
export function bandOf(rect, parts = [], pad = BAND_PAD) {
  const b = box(rect);
  for (const p of parts) if (solid(p)) { b.left = Math.min(b.left, p.left); b.top = Math.min(b.top, p.top); b.right = Math.max(b.right, p.right); b.bottom = Math.max(b.bottom, p.bottom); }
  return {left:b.left - pad, top:b.top - pad, right:b.right + pad, bottom:b.bottom + pad};
}

/** 띠가 상자보다 각 변으로 얼마나 넓은지 중 가장 큰 값(이웃 상자에 같은 띠를 어림할 때). */
export function reachOf(rect, band) {
  return Math.max(rect.left - band.left, rect.top - band.top, band.right - rect.right, band.bottom - rect.bottom, 0);
}

export const inside = (p, r) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;

/** 점에서 사각형까지 거리(안이면 0). */
export function distTo(p, r) {
  const dx = Math.max(r.left - p.x, 0, p.x - r.right), dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
  return Math.hypot(dx, dy);
}

/**
 * 지금 올린 것으로 볼 상자.
 * - direct: 커서 바로 아래 상자(그 손잡이 포함) — 있으면 그것.
 * - current: 지금 올린 상자 {key, rect, band}. 커서가 그 띠 밖이면 null(내림).
 * - others: 둘레 다른 상자 [{key, rect}] — 띠 안에서 current보다 커서에 더 가까운(그 상자도 같은 폭의 띠 안) 상자가 있으면 그것.
 */
export function pickHover({point, direct = null, current = null, others = []}) {
  if (direct != null) return direct;
  if (!current || !inside(point, current.band)) return null;
  const reach = reachOf(current.rect, current.band);
  let best = current.key, bestD = distTo(point, current.rect);
  for (const o of others) {
    if (o.key === current.key) continue;
    const d = distTo(point, o.rect);
    if (d <= reach && d < bestD) { best = o.key; bestD = d; }
  }
  return best;
}
