// LIB-나무접기(요청함 11/09 18:10): PC 왼쪽 폴더 나무(자료실·[파일]·노트, 줄 = 들어가기 + 펼침 / 아이콘 = 접기·펼치기)의 누르기 규칙 한 곳.
//  ① 이미 들어가 있고 펼쳐진 폴더의 이름을 다시 누르면 접힌다(오른쪽은 그 폴더 그대로). 접힌 채 다시 누르면 지금처럼 펼친다.
//  ② 아이콘 누르기는 지금처럼 접기·펼치기만.
//  ③ 키보드: 줄(이름·아이콘)에 초점이 있을 때 → 펼치기, ← 접기. 같은 아이콘 단추를 눌러 같은 길로 간다.
// UI-폴더누르기한규칙(S57-5, 요청함 11/11 06:23 명진 결정): 앱 전체 한 규칙 — 왼쪽 나무·오른쪽 목록 어디서든 폴더 한 번 누르기 = 그 자리에서 펼치기, 다시 누르기 = 접기.
//  그 폴더만 보기(들어가기)는 PC 우클릭 [이 폴더로 들어가기](FOLDER_ENTER_LABEL), 폰·폴드 두 손가락 벌리기(folder-pinch.js). 위 ①은 이 규칙이 나무에 닿은 화면에서
//  ftPressToggle로 바뀐다(이름 누르기 = 아이콘 누르기와 같은 단추).
// OPS-빠진일2차 1(명진 11/11 14:55 '가'): 하위 폴더가 없는 폴더(펼쳐 보일 것이 없는 폴더)는 한 번 누르면 그 폴더를 연다(folderPressAction — 모든 나무·목록이 같은 판정).
// 줄 모양은 folder-tree-ui.mjs(toggle을 준 줄 = .ft-has-tog, 들어간 폴더 = .ft-current, 펼침 = .ft-open, 아이콘 단추 = .ft-tog[aria-expanded]).
// 상태 주인은 각 화면이다. 이 파일은 그 화면의 아이콘 단추를 눌러 줄 뿐 상태를 따로 갖지 않는다.

// 다시 그린 뒤 같은 단추를 찾는 선택자(data- 속성 모두).
function sameSelector(el) {
  const parts = [...(el?.attributes || [])].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`);
  return parts.length ? `.ft-row ${el.tagName.toLowerCase()}${parts.join('')}` : '';
}
function pressKeepFocus(tog, keep) {
  const sel = sameSelector(keep);
  tog.click();
  if (sel) document.querySelector(sel)?.focus?.({preventScroll: true});
}
const togOf = row => row?.querySelector(':scope > button.ft-tog[aria-expanded]') || null;

// ① 이름 단추(.ft-main)를 눌렀을 때 부른다. 들어가 있고 펼쳐진 폴더면 접고 true(호출한 쪽은 들어가기를 하지 않는다).
export function ftFoldIfRepeat(main) {
  const row = main?.closest?.('.ft-row');
  if (!main?.classList?.contains('ft-main') || !row?.matches('.ft-has-tog.ft-current.ft-open')) return false;
  const tog = togOf(row);
  if (!tog || tog.getAttribute('aria-expanded') !== 'true') return false;
  pressKeepFocus(tog, main);
  return true;
}

// 그 폴더만 보기(들어가기) 메뉴 글자 — 자료실·[파일]·노트·사진이 같은 이름을 쓴다(UI-폴더누르기한규칙).
export const FOLDER_ENTER_LABEL = '이 폴더로 들어가기';

// OPS-빠진일2차 1(명진 11/11 14:55 '가'): 폴더 한 번 누르기 판정 한 곳 — 자료실·[파일]·노트·사진의 모든 나무·목록(폰·폴드·PC)이 이 함수를 부른다.
//  그 자리에 펼쳐 보일 것이 있으면 'toggle'(그 자리 펼치기·접기, 들어가지 않음), 없으면 'enter'(그 폴더 열기 = 우클릭 [이 폴더로 들어가기]·두 손가락 벌리기와 같은 곳).
//  펼쳐 보일 것 = 하위 폴더 + 그 화면이 펼친 폴더 아래 들여 보이는 것(파일·자료·노트·사진). 폴더만 보이는 나무(PC·폴드 왼쪽 나무)는 하위 폴더뿐이라
//  '하위 폴더가 없는 폴더 = 한 번에 열기'(명진 결정 그대로)이고, 안 자료까지 들여 보이는 목록·폰 나무는 안이 빈 폴더만 열린다
//  (그 자리 펼침에 보일 것이 있으면 지금처럼 펼침 — 처음 5개 + n개 더 보기, LIB-펼친폴더안놓기가 그대로).
//  하위 폴더 수를 아직 모르면(서버에서 읽기 전) 'toggle' — 펼치며 읽고, 읽어 보니 없으면 그때 연다(createLeafWait·[파일] pressFolder).
//  subfolders: 하위 폴더 수(숫자) · 있나(true/false) · 모름(null/undefined). shown: 펼침에 들여 보일 안 줄 수(폴더만 보이는 나무는 0, 모르면 null = 있다고 봄).
export const FOLDER_PRESS_TOGGLE = 'toggle', FOLDER_PRESS_ENTER = 'enter';
export function folderPressAction(subfolders, shown = 0) {
  if (subfolders === null || subfolders === undefined || shown === null || shown === undefined) return FOLDER_PRESS_TOGGLE;
  const n = (typeof subfolders === 'number' ? subfolders : subfolders ? 1 : 0) + (typeof shown === 'number' ? shown : shown ? 1 : 0);
  return n > 0 ? FOLDER_PRESS_TOGGLE : FOLDER_PRESS_ENTER;
}

// 하위 폴더를 몰라 펼치며 읽은 폴더를 기억해 두었다가, 읽기가 끝나 하위 폴더가 없다고 나오면 그때 연다(한 번 누르기 = 열기).
//  arm(key): 누른 폴더. done(key, subfolders, enter): 읽기가 끝났을 때 — 같은 폴더를 기다리던 중이고 하위 폴더가 없으면 enter()를 부르고 true.
//  clear(): 다른 것을 누르거나 화면을 떠나면 잊는다(늦게 끝난 읽기가 엉뚱한 때에 화면을 바꾸지 않게).
export function createLeafWait() {
  let waiting = null;
  return {
    arm(key) { waiting = key ?? null; },
    clear() { waiting = null; },
    get key() { return waiting; },
    done(key, subfolders, enter, shown = 0) {
      if (waiting === null || waiting !== key) return false;
      waiting = null;
      if (folderPressAction(subfolders, shown) !== FOLDER_PRESS_ENTER) return false;
      enter?.();
      return true;
    },
  };
}

// UI-폴더누르기한규칙: 이름 단추(.ft-main) 누르기 = 그 줄의 아이콘 단추(.ft-tog)를 눌러 펼치기·접기(들어가지 않음). 처리했으면 true.
//  이 나무들(PC·폴드 왼쪽 나무)은 아이콘 단추가 '하위 폴더가 있음(또는 아직 모름)'일 때만 있다. 아이콘 단추가 없는 줄(.ft-tog-none = 하위 폴더 없음)은
//  folderPressAction대로 enter()를 불러 그 폴더를 연다(OPS-빠진일2차 1). toggle 줄이 아니면 false(호출한 쪽이 이어서 처리).
export function ftPressToggle(main, enter = null) {
  const row = main?.closest?.('.ft-row');
  if (!main?.classList?.contains('ft-main') || !row?.matches('.ft-has-tog')) return false;
  const tog = togOf(row);
  if (folderPressAction(tog ? null : 0) === FOLDER_PRESS_TOGGLE) pressKeepFocus(tog, main);
  else enter?.();
  return true;
}

// 나무를 다시 그리는 앞뒤로 나무 안 초점을 같은 단추로 되돌린다. 펼침으로 읽어 온 하위 폴더가 늦게 그려져 줄이 통째로 바뀌어도 키보드 초점(Enter·←/→ 뒤)이 이어진다.
export function ftKeepFocus(box, paint) {
  const at = box?.contains?.(document.activeElement) ? document.activeElement : null, sel = at ? sameSelector(at) : '';
  paint();
  if (sel && !at.isConnected) box.querySelector(sel)?.focus?.({preventScroll: true});
}

// ③ ←/→. 처리했으면 true.
export function ftTreeArrow(event) {
  if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const t = event.target, row = t?.closest?.('.ft-row.ft-has-tog');
  if (!row || !(t.matches('.ft-main') || t.matches('.ft-tog'))) return false;
  const tog = togOf(row);
  if (!tog) return false;
  const open = tog.getAttribute('aria-expanded') === 'true';
  if (open !== (event.key === 'ArrowLeft')) return false;
  event.preventDefault();
  pressKeepFocus(tog, t);
  return true;
}

let bound = false;
export function ftBindTreeArrows() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('keydown', ftTreeArrow);
}
