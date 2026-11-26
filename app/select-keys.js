// UI-목록공용키(S70-18, docs/qa/folder-tree-audit-20261125.md N2·N3·N4): 목록 칸(자료실·노트·[파일]) 키 공용 부품.
// 기준표 docs/design/standard-interactions.md S5·K1·K2: Ctrl(⌘)+A = 그 목록 전체 고르기, Delete = 그 화면의 [삭제](언제 묻나는 아래 confirmDelete 한 규칙),
// F2 = 이름 바꾸기(고른 줄, 없으면 커서 줄), Esc = 고르기 풀기. 글 쓰는 칸(input·textarea·contenteditable)·열린 창에서는 건드리지 않는다(글자 동작 그대로).
// 상태·그리기·서버 일은 부르는 화면이 한다. 이 부품은 '어느 키가 어떤 일인지'만 정하고, 화면 함수가 일을 했다고(true) 돌려주면 기본 동작을 막는다.

// 글 쓰는 칸: 체크 칸·라디오는 줄 고르기 네모라 목록으로 본다.
export const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]),textarea,select,[contenteditable]:not([contenteditable="false"])';
// 창: 초점이 창 안이면 창 것. 화면 위를 덮는 창(aria-modal·.modal·dialog)이 보이면 목록 키도 받지 않는다(옆에 떠 있는 작업 칸은 막지 않음).
const IN_BOX = '.modal,[role="dialog"],[role="alertdialog"],dialog';
const COVER_BOX = '.modal:not(.hidden),[aria-modal="true"],dialog[open]';

// 키 → 할 일 이름(순수 함수, 단위 시험 대상). k: {key, ctrlKey, metaKey, altKey, shiftKey, isComposing, typing, boxOpen}.
// 반환: 'all' | 'delete' | 'rename' | 'clear' | null.
export function selectKeyAction(k = {}) {
  if (!k || k.isComposing || k.typing || k.boxOpen) return null;
  const mod = !!(k.ctrlKey || k.metaKey);
  const key = String(k.key || '');
  if (mod && !k.altKey && !k.shiftKey && key.toLowerCase() === 'a') return 'all';
  if (mod || k.altKey) return null;
  if (key === 'Delete' && !k.shiftKey) return 'delete';
  if (key === 'F2' && !k.shiftKey) return 'rename';
  if (key === 'Escape' && !k.shiftKey) return 'clear';
  return null;
}

const isEl = t => !!t && typeof t.closest === 'function';
// 화면에서 지금 보이는 창(확인 창·이름 묻기 창 등)이 있나. 창 안 키는 창 것이다.
function boxOpen(target) {
  if (isEl(target) && target.closest(IN_BOX)) return true;
  const doc = globalThis.document;
  if (!doc) return false;
  return [...doc.querySelectorAll(COVER_BOX)].some(el => el.checkVisibility?.() ?? el.getClientRects().length > 0);
}

// 이벤트 → 할 일 이름. blocked(e)가 true면(화면의 열린 메뉴 등) 아무것도 하지 않는다.
export function eventAction(e, {blocked = null} = {}) {
  if (!e || e.defaultPrevented) return null;
  const t = e.target;
  const typing = isEl(t) && !!t.closest(TYPING);
  const action = selectKeyAction({key:e.key, ctrlKey:e.ctrlKey, metaKey:e.metaKey, altKey:e.altKey, shiftKey:e.shiftKey, isComposing:e.isComposing, typing, boxOpen:false});
  if (!action) return null;
  if (blocked?.(e)) return null;
  if (boxOpen(t)) return null;
  return action;
}

// 화면 함수 묶음 {all, delete, rename, clear}(각각 (e) → 일을 했으면 true). 없는 것은 그 키를 화면 기본 처리에 맡긴다.
// active(): 이 화면이 지금 키를 받을 때만 true(라우터 화면·바쁜 중 등). 반환: handle(e, only) — 이미 있는 keydown 처리 안 정해진 자리에서 부를 수 있다
// (only: 할 일 이름 목록이면 그것만). 일을 했으면 true.
export function createSelectKeys(acts = {}, {active = null, blocked = null} = {}) {
  const handle = (e, only = null) => {
    const action = eventAction(e, {blocked});
    if (!action || (only && !only.includes(action))) return false;
    const run = acts[action];
    if (typeof run !== 'function' || (active && !active(e))) return false;
    if (run(e) !== true) return false;
    e.preventDefault();
    return true;
  };
  return {handle};
}

// el의 keydown에 건다(capture: 화면의 다른 keydown보다 먼저 받을 때). 반환: 떼기.
export function bindSelectKeys(el, acts, {active = null, blocked = null, capture = false} = {}) {
  if (!el) return () => {};
  const {handle} = createSelectKeys(acts, {active, blocked});
  const on = e => { handle(e); };
  el.addEventListener('keydown', on, capture);
  return () => el.removeEventListener('keydown', on, capture);
}

// F2 대상(N4): 고른 것이 정확히 하나면 그것, 하나도 없으면 커서(초점) 줄, 여럿이면 없음(이름은 하나씩 바꾼다).
export function renameTarget(picked = [], cursor = null) {
  const list = [...(picked || [])];
  if (list.length === 1) return list[0];
  if (list.length > 1) return null;
  return cursor ?? null;
}

// K1 지우기 한 규칙(I-6, 2026-11-25 사용자 결정 6 "추천대로"): 지운 뒤 [되돌리기]가 있으면 확인 없이 바로 지우고, 없으면 확인 창을 받는다.
// Delete 키·선택 막대 [삭제]·⋯ [삭제]가 모두 이 함수 하나로 묻는다(화면마다 따로 '언제 묻나'를 정하지 않는다). 확인 창 글·모양은 부르는 화면 것(ask).
// undo: 이 지우기 뒤에 [되돌리기] 알림이 뜨나(true/false). ask: () → Promise<boolean>(확인 창). 반환: 지워도 되면 true.
export const deleteNeedsConfirm = ({undo = false} = {}) => !undo;
export async function confirmDelete({undo = false, ask = null} = {}) {
  if (!deleteNeedsConfirm({undo})) return true;
  if (typeof ask !== 'function') return false; // 되돌리기도 확인 창도 없으면 지우지 않는다
  return !!(await ask());
}
