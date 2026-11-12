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
