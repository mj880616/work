// LIB-나무접기(요청함 11/09 18:10): PC 왼쪽 폴더 나무(자료실·[파일]·노트, 줄 = 들어가기 + 펼침 / 아이콘 = 접기·펼치기)의 누르기 규칙 한 곳.
//  ① 이미 들어가 있고 펼쳐진 폴더의 이름을 다시 누르면 접힌다(오른쪽은 그 폴더 그대로). 접힌 채 다시 누르면 지금처럼 펼친다.
//  ② 아이콘 누르기는 지금처럼 접기·펼치기만.
//  ③ 키보드: 줄(이름·아이콘)에 초점이 있을 때 → 펼치기, ← 접기. 같은 아이콘 단추를 눌러 같은 길로 간다.
// UI-폴더누르기한규칙(S57-5, 요청함 11/11 06:23 사용자 결정): 앱 전체 한 규칙 — 왼쪽 나무·오른쪽 목록 어디서든 폴더 한 번 누르기 = 그 자리에서 펼치기, 다시 누르기 = 접기.
//  그 폴더만 보기(들어가기)는 PC 우클릭 [이 폴더로 들어가기](FOLDER_ENTER_LABEL). 위 ①은 이 규칙이 나무에 닿은 화면에서
//  이름 누르기 = 아이콘 누르기로 바뀌었다(그 부품 ftPressToggle·①의 ftFoldIfRepeat는 S69-38에서 지움 — 아래 ftExplorePress).
// OPS-빠진일2차 1(사용자 11/11 14:55 '가', '하위 폴더가 없는 폴더는 한 번 누르면 연다')은 아래 UI-폴더이름펼치기로 없앴다(판정 folderPressAction·createLeafWait 삭제).
// UI-폴더이름펼치기(사용자 11/24 18:09 '폴더 명칭을 누르면 그 폴더 안으로 들어가는 액션인데 나는 그냥 펼쳐졌으면 / 들어가는 거는 오른쪽 ⋯ 이 폴더 안으로 들어가기를 눌렀을 때만'):
//  그 자리 펼치는 목록(자료실 폰 나무·두 칸 칸 안, [파일] 폰 나무·두 칸 칸 안, 노트 폰 폴더 목록, 사진 폰·폴드 폴더 나무)에서 폴더 이름 누르기 = 늘 그 자리 펼치기·접기.
//  빈 폴더도 펼쳐 안에 '빈 폴더' 한 줄(ftEmptyRowHtml 등), 하위 폴더 수를 몰라도 펼치며 읽는다(들어가지 않음). 들어가기는 ⋯ 첫 줄 [이 폴더로 들어가기](FOLDER_ENTER_LABEL)·
//  PC 우클릭만. 탐색기 나무(PC·펼친 폴드 왼쪽 나무 | 오른쪽 그 폴더, 아래 ftExplorePress)와 탐색기 오른쪽 칸·폰 '그 폴더만' 안 하위 폴더 줄(들어가기)은 그대로.
// S69-38 UI-탐색기나무누르기(사용자 11/24): 탐색기 나무(왼쪽 나무 | 오른쪽 그 폴더 내용)의 이름 누르기는 위 ①·UI-폴더누르기한규칙 대신 ftExplorePress 하나 —
//  누르면 오른쪽이 그 폴더로 바뀌고 접혀 있으면 펼친다(아래). 폰 나무·두 칸 칸 안 목록은 그 자리 펼치기 그대로(UI-폴더이름펼치기).
// 줄 모양은 folder-tree-ui.mjs(toggle을 준 줄 = .ft-has-tog, 들어간 폴더 = .ft-current, 펼침 = .ft-open, 아이콘 단추 = .ft-tog[aria-expanded]).
// 상태 주인은 각 화면이다. 이 파일은 그 화면의 아이콘 단추를 눌러 줄 뿐 상태를 따로 갖지 않는다.

// 다시 그린 뒤 같은 단추를 찾는 선택자(data- 속성 모두).
function sameSelector(el) {
  const parts = [...(el?.attributes || [])].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`);
  return parts.length ? `:is(.ft-row, .nx-row) ${el.tagName.toLowerCase()}${parts.join('')}` : '';
}
function pressKeepFocus(tog, keep) {
  const sel = sameSelector(keep);
  tog.click();
  if (sel) document.querySelector(sel)?.focus?.({preventScroll: true});
}
const togOf = row => row?.querySelector(':scope > button.ft-tog[aria-expanded]') || null;

// 그 폴더만 보기(들어가기) 메뉴 글자 — 자료실·[파일]·노트·사진이 같은 이름을 쓴다(UI-폴더누르기한규칙).
export const FOLDER_ENTER_LABEL = '이 폴더로 들어가기';

// 탐색기 나무 누르기 한 곳(ftExplorePress) — 왼쪽 나무 | 오른쪽 그 폴더 내용인 화면(자료실·[파일]·노트 [폴더] 보기·사진 [폴더] — PC·펼친 폴드).
// TREE-탐색기꺾쇠(S70-81b, 사용자 2026-11-26 09:25 최종 결정, docs/design/standard-interactions.md T10 — 윈도 탐색기와 같게):
//  앞 규칙 TREE-펼치기먼저(S70-81 '한 번 = 펼치기만, 다시 = 내용')와 S69-38('누르면 오른쪽 + 펼치기')을 대신한다.
//  ① 폴더 아이콘 왼쪽 작은 회색 꺾쇠(.ft-tog, 접힘 › / 펼침 ⌄, 하위 없으면 없음) 누르기 = 펼치기·접기만(오른쪽 그대로). 꺾쇠는 각 화면이 그 상태 주인으로 처리한다.
//  ② 폴더 이름(아이콘 포함) 한 번 누르기 = 오른쪽에 그 폴더 내용(enter). 나무 펼침은 그대로. 오른쪽에 이미 보이는 폴더면 아무것도 안 함.
//  ③ 이름 두 번 누르기(마우스 더블클릭) = 첫 누르기로 오른쪽에 그 폴더 + 두 번째 누르기로 펼치기/접기.
//     두 번째인지는 브라우저가 세는 누르기 수(click 이벤트 detail ≥ 2)로 본다 — 키보드 Enter(detail 0)는 늘 한 번 누르기.
//  ④ 키보드: → 펼치기, ← 접기(ftTreeArrow), ↑↓ 줄 옮기기, Enter = 이름 누르기(오른쪽 그 폴더).
//  enter()가 Promise를 돌려주면(서버에서 목록 읽기) 끝난 뒤 다시 그려진 줄에 초점을 둔다. 처리했으면 true(호출한 쪽은 더 하지 않는다).
//  이 규칙은 탐색기 나무에만 쓴다. 폰 나무·두 칸 칸 안 목록은 UI-폴더이름펼치기(T5) 그대로.
const ROW_SEL = '.ft-row, .nx-row';
function rowMainSelector(main) {
  const parts = [...(main?.attributes || [])].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`);
  if (!parts.length) return '';
  const cls = main.classList.contains('ft-main') ? '.ft-main' : main.classList.contains('nx-main') ? '.nx-main' : '';
  return ROW_SEL.split(', ').map(r => `${r} > ${main.tagName.toLowerCase()}${cls}${parts.join('')}`).join(', ');
}
// 지금 처리 중인 누르기의 누르기 수(click detail). ftBindTreeArrows가 문서 맨 앞(capture)에서 적어 두고, 화면 click 처리기가 ftExplorePress를 부를 때 읽는다.
let pressCount = 0;
export function explorePressPlan({canOpen = true, current = false, count = 1} = {}) {
  if (count >= 2) return {enter: !current, toggle: !!canOpen};
  return {enter: !current, toggle: false};
}
// count: 누르기 수를 직접 줄 때(시험). 없으면 지금 누르기의 수.
export function ftExplorePress(main, enter, {count = pressCount} = {}) {
  if (!main || typeof enter !== 'function') return false;
  const sel = rowMainSelector(main);
  const row0 = main.closest(ROW_SEL);
  const tog0 = row0?.querySelector(':scope > button.ft-tog[aria-expanded]') || null;
  const current = !!(row0?.classList?.contains('ft-current') || main.getAttribute?.('aria-current') === 'true');
  const plan = explorePressPlan({canOpen: !!tog0, current, count});
  if (plan.toggle && tog0) pressKeepFocus(tog0, main); else main.focus?.({preventScroll: true});
  if (!plan.enter) return true;
  const out = enter();
  const after = () => { const now = (sel && document.querySelector(sel)) || (main.isConnected ? main : null); now?.focus?.({preventScroll: true}); };
  if (out && typeof out.then === 'function') out.then(after, () => {}); else after();
  return true;
}

// 끄는 중 나무의 닫힌 폴더 위에 잠깐(약 1초) 머무르면 저절로 펼친다(탐색기 방식, T10). 자료실 오른쪽 목록(1초)·노트(0.9초)는 화면 안 원래 부품 그대로.
//  over(key, canOpen) = 지금 끄는 손이 머무는 폴더(없으면 ''), stop() = 끌기 끝. open(key)은 그 화면 상태 주인이 펼친다.
export const HOVER_EXPAND_MS = 1000;
export function ftHoverExpander(open, ms = HOVER_EXPAND_MS) {
  let key = '', timer = 0;
  const stop = () => { clearTimeout(timer); key = ''; };
  return {
    over(k, canOpen = true) {
      const want = canOpen && k ? k : '';
      if (want === key) return;
      stop(); key = want;
      if (want) timer = setTimeout(() => { if (key === want) { key = ''; open(want); } }, ms);
    },
    stop,
  };
}

// UI-폴더펼치면위로(S61-7, 요청함 11/13 04:24): 나무·목록을 다시 그리는 앞뒤를 감싸 '그 자리'를 지키는 공용 부품 한 곳.
//  ① 스크롤: box 안(box 자신 포함)에서 스크롤해 내려가 있던 상자는 다시 그린 뒤에도 같은 만큼 내려가 있다. 같은 상자가 남아 있으면 그 상자,
//     새로 그려 바뀌었으면 box에서의 자리(태그·data- 속성·id, 없으면 첫 class)가 같은 새 상자에 같은 값을 준다(같은 그리기 안 — 늦게 맞추기 아님).
//     그래서 폴더를 눌러 펼치기·접기만 하면 누른 폴더가 화면에서 같은 높이에 남는다(자료실 왼쪽 나무·두 칸, 사진 PC 나무, [파일] 나무·받을 곳 창).
//  ② 초점: 나무 안 초점을 같은 단추로 되돌린다. 펼침으로 읽어 온 하위 폴더가 늦게 그려져 줄이 통째로 바뀌어도 키보드 초점(Enter·←/→ 뒤)이 이어진다.
//  상자를 통째로 바꾸지 않고 안쪽만 바꾸는 것이 먼저다(자료실 왼쪽 나무). 이 부품은 통째로 다시 그리는 화면도 같은 자리를 지키게 한다.
const segOf = el => {
  const data = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${CSS.escape(el.id)}${data}`;
  return data ? tag + data : el.classList[0] ? `${tag}.${CSS.escape(el.classList[0])}` : tag;
};
function placeKey(el, box) {
  if (el === box) return '';
  const out = [];
  for (let e = el; e && e !== box; e = e.parentElement) out.unshift(segOf(e));
  return out.join('>');
}
function scrolledIn(box) {
  const out = [];
  for (const el of [box, ...box.querySelectorAll('*')]) if (el.scrollTop > 0) out.push({el, key: placeKey(el, box), top: el.scrollTop});
  return out;
}
function placeAgain(box, {el, key, top}) {
  let at = el.isConnected && (el === box || box.contains(el)) ? el : null;
  if (!at && key) { const last = key.split('>').pop(); at = [...box.querySelectorAll(last)].find(c => placeKey(c, box) === key) || null; }
  if (at && Math.abs(at.scrollTop - top) > 0.5) at.scrollTop = top;
}
export function ftKeepPlace(box, paint) {
  if (!box?.querySelectorAll) return paint();
  const at = box.contains(document.activeElement) ? document.activeElement : null, sel = at ? sameSelector(at) : '';
  const spots = scrolledIn(box);
  const out = paint();
  for (const s of spots) placeAgain(box, s);
  if (sel && !at.isConnected) box.querySelector(sel)?.focus?.({preventScroll: true});
  return out;
}
// ③-2 ↑/↓(STD-기본동작 K4·T10, docs/design/standard-interactions.md): role="tree" 나무·[파일] 왼쪽 나무 안 이름 단추에서 보이는 앞·뒤 줄의 이름 단추로 커서를 옮긴다.
// 앱 공용 ↑↓(keyboard-keys.js)는 role=tree를 건드리지 않으므로 겹치지 않는다. 화면이 이미 처리한 키(defaultPrevented)는 손대지 않는다.
const visibleMain = el => el.getClientRects().length > 0 && !el.closest('[hidden],[inert]');
function ftTreeUpDown(event) {
  if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const t = event.target;
  const ROW_MAIN = '.ft-row .ft-main, .nx-row .nx-main'; // 사진 PC 나무는 nx-row 모양
  if (!t?.matches?.(ROW_MAIN)) return false;
  const tree = t.closest('[role="tree"], [data-fx-tree]'); // [파일] 왼쪽 나무(data-fx-tree)도 같은 ↑↓(T10)
  if (!tree) return false;
  const mains = [...tree.querySelectorAll(ROW_MAIN)].filter(visibleMain);
  const next = mains[mains.indexOf(t) + (event.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return false;
  event.preventDefault();
  next.focus({preventScroll: true});
  next.scrollIntoView?.({block: 'nearest'});
  return true;
}

// ③ ←/→. 처리했으면 true.
export function ftTreeArrow(event) {
  if (ftTreeUpDown(event)) return true;
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
  document.addEventListener('click', event => { pressCount = event.detail || 0; }, true);
}
