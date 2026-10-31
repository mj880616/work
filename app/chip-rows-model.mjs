// UI-칩줄두줄(2026-10-31 명진 결정): 앱 전체 칩 줄의 '두 줄 + [더보기 ▾]' 계산(화면 없이 시험하는 부분).
// 화면 쪽(app/chip-rows.js)은 실제로 놓인 칩의 위치를 재서 이 함수들로 줄 수와 남길 칩을 정한다.

// 칩 줄에 보이는 칸들(문서 순서)의 위·아래 끝 [{top, bottom}]으로 몇 줄인지 센다.
// 한 줄 안에서 높이가 다른 칸(작은 전환 묶음 등)이 가운데 맞춤이어도, 칸의 위 끝이 그 줄의 아래 끝보다 위면 같은 줄이다.
export function lineCount(boxes) {
  let lines = 0, bottom = -Infinity;
  for (const b of Array.isArray(boxes) ? boxes : []) {
    if (!b || !Number.isFinite(b.top) || !Number.isFinite(b.bottom)) continue;
    if (b.top >= bottom - 1) { lines += 1; bottom = b.bottom; }
    else bottom = Math.max(bottom, b.bottom);
  }
  return lines;
}

// 여러 개를 켜고 끄는 칩 줄(자료 분류 등)에서 접혀도 늘 보일 '고른 칩': 켠 칩과 끈 칩 중 적은 쪽.
// 모두 켰거나 모두 껐으면 고른 것이 없다(빈 모음). 처음에 '회의'만 꺼진 자료실이면 꺼 둔 '회의'가 고른 칩이다.
export function pickedToggles(names, off) {
  const list = Array.isArray(names) ? names : [], offSet = off instanceof Set ? off : new Set(off || []);
  const on = list.filter(name => !offSet.has(name)), offs = list.filter(name => offSet.has(name));
  if (!on.length || !offs.length) return new Set();
  return new Set(on.length <= offs.length ? on : offs);
}
