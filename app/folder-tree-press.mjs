// LIB-나무접기(요청함 11/09 18:10): PC 왼쪽 폴더 나무(자료실·[파일]·노트, 줄 = 들어가기 + 펼침 / 아이콘 = 접기·펼치기)의 누르기 규칙 한 곳.
//  ① 이미 들어가 있고 펼쳐진 폴더의 이름을 다시 누르면 접힌다(오른쪽은 그 폴더 그대로). 접힌 채 다시 누르면 지금처럼 펼친다.
//  ② 아이콘 누르기는 지금처럼 접기·펼치기만.
//  ③ 키보드: 줄(이름·아이콘)에 초점이 있을 때 → 펼치기, ← 접기. 같은 아이콘 단추를 눌러 같은 길로 간다.
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
