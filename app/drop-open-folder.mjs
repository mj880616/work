// UI-펼친폴더안놓기전체(S60-13, 명진 11/12 09:23): "a폴더(파일·파일·파일 a) b폴더(파일 *…)에서 * 파일을 '파일 a' 쪽에만 가져가도 a폴더로 놓이게,
// 비슷한 화면은 모두". 화면마다 판정을 따로 두지 않고 이 한 규칙을 쓴다.
//   규칙: 손 아래 요소에서 가장 가까운(안쪽 먼저) '펼친 폴더 묶음'이 놓을 폴더다. 묶음 = 그 폴더 줄 아래 보이는 모든 것
//   (안의 자료 줄 · [사진 n] · 작은 그림 칸 · 빈 폴더/기다림 줄 · 줄 사이 빈 틈). 묶음 안 하위 폴더 줄은 그 하위 폴더 자신의 묶음.
// 각 화면은 묶음을 나타내는 선택자(group)와 그 묶음의 폴더 키 읽기(keyOf)만 넘긴다(자료실 한 칸 details.lu-node, 두 칸 [data-lu-pane-sub],
// [파일] [data-fx-drop], 노트 나무는 자기 dropPlan이 같은 규칙). 놓을 수 있는지(이미 그 폴더·자기 안 등)는 각 화면이 그대로 판정한다.
// 표시도 한 모양: 놓일 묶음 전체에 옅은 바탕(DROP_GROUP), 폴더 줄에는 점선 + '여기에 놓기'(각 화면의 기존 머리 표시).

/** 손 아래 el에서 가장 가까운 펼친 폴더 묶음. skip(선택자)에 걸린 요소(예: 묶음 머리 줄) 안이면 null — 머리 줄은 각 화면이 따로 본다. */
export function openFolderAt(el, {group, keyOf = g => g.dataset?.dropFolder || '', within = null, skip = ''} = {}) {
  if (!el?.closest || !group) return null;
  const g = el.closest(group);
  if (!g || (within && !(typeof within === 'string' ? g.closest(within) : within.contains(g)))) return null;
  if (skip) { const s = el.closest(skip); if (s && g.contains(s) && s.parentElement === g) return null; }
  const key = keyOf(g);
  return key ? {key, el: g} : null;
}

/** 놓일 묶음 표시: els에만 cls를 붙이고 scope 안 다른 것은 뗀다(빈 배열 = 모두 지움). */
export const DROP_GROUP = 'drop-group';
export function paintDropGroup(scope, els = [], cls = DROP_GROUP) {
  const keep = new Set((els || []).filter(Boolean));
  for (const el of scope?.querySelectorAll?.('.' + cls) || []) if (!keep.has(el)) el.classList.remove(cls);
  for (const el of keep) el.classList.add(cls);
}

// STD-빈곳놓기(S71-45, 2026-11-26 사용자 결정 "그 외에 위 아래 여백쪽에 두면 그 최상위 폴더에 드롭가능하게"): 끄는 중 손 아래가
// 어느 줄에도 걸리지 않는 빈 곳(폴더 나무 맨 위 줄 위·맨 아래 줄 밑 여백, 칸 안쪽 여백)이면 그 나무의 맨 위(뿌리)에 놓는다.
// 폴더 줄 위(이름 오른쪽 같은 줄 포함)는 지금처럼 그 폴더 — 이 판정은 줄 밖일 때만 참이다. 화면마다 따로 계산하지 않고 이 하나를 쓴다.
//   zone: 빈 곳으로 볼 칸(선택자 또는 요소 — 나무 칸), rows: 줄 선택자(그 안이면 빈 곳 아님), skip: 단추·입력칸 등(빈 곳 아님).
export const BLANK_SKIP = 'button,a[href],input,select,textarea,label,[contenteditable],summary,[role="treeitem"],[role="menu"],[role="dialog"],[popover]';
export function blankRootAt(el, {zone, rows = '.ft-row', skip = BLANK_SKIP} = {}) {
  if (!el?.closest || !zone) return false;
  const box = typeof zone === 'string' ? el.closest(zone) : (zone.contains?.(el) ? zone : null);
  if (!box) return false;
  if (rows && el.closest(rows)) return false;
  if (skip) { const s = el.closest(skip); if (s && box.contains(s)) return false; }
  return true;
}
// STD-순서는줄사이만(S71-45): 순서 바꾸기 선은 두 줄 '사이'에서만 생긴다. 나무 맨 끝 줄의 아래 끝(그 밑에 줄이 없음)은 줄 사이가 아니라
// 아래 빈 곳 — 'blank'로 돌려 위 blankRootAt과 같은 '맨 위에 놓기'가 된다. 원인(추정, 사용자 캡처 '순서를 바꿨어요 · 되돌리기'):
// 맨 아래 폴더 밑 여백 가까이 놓으면 그 줄의 아래 25%(dropZone 'after')로 잡혀 순서 바꾸기가 되었다.
export function lineOrBlank(zone, {last = false, first = false} = {}) {
  if (zone === 'after' && last) return 'blank';
  if (zone === 'before' && first) return 'blank';
  return zone;
}
