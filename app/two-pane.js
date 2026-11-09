// LIB-두칸보기 PR-1(S55-11, 시안 docs/design/mockups/library-two-pane.html): 두 칸 틀 공용 부품 — [파일](files.js)·자료실이 같이 쓴다.
// 이 부품이 맡는 것(틀): 요소 → 칸 번호, 칸 상자 찾기, 지금 칸 표시(테두리 클래스), 두 칸 키(Tab 칸 바꾸기 · F5 반대 칸에 복사 · F6 옮기기)의
// 판정(files-panes-model.mjs paneKeyAction)과 연결, Tab 뒤 그 칸 줄로 포커스. 칸 사이 끌어 놓기 받는 자리는 dropPane(놓은 칸·반대 칸인가)으로 알려 준다.
// 칸 안 목록 그리기·옮기기·복사·상태(위치·정렬·고르기)는 각 화면이 자기 것으로 가지고, 넘긴 함수(콜백)로만 부른다. 경계 폭은 split-resize.js.
import {paneKeyAction} from './files-panes-model.mjs';

/**
 * @param {object} o
 * @param {Element|null} o.root 화면 뿌리(칸 상자들이 이 안에 있다)
 * @param {string} o.attr 칸 상자 표시 속성(값 = 칸 번호 0·1), 예: 'data-fx-pane-i'
 * @param {string} o.rowAttr 목록 줄 표시 속성(Tab을 줄에서만 받는다), 예: 'data-fx-row'
 * @param {string} o.curClass 지금 칸 상자에 붙일 클래스
 * @param {() => boolean} o.on 지금 두 칸인가
 * @param {() => number} o.cur 지금 칸 번호
 * @param {(i:number) => void} o.setCur 지금 칸 바꾸기(화면 상태 주인이 바꾼다)
 * @param {() => boolean} [o.visible] 이 화면이 보이는가
 * @param {() => boolean} [o.blocked] 창·묻기가 떠 있어 키를 받지 않을 때
 * @param {(mode:'copy'|'move') => void} [o.send] F5·F6: 지금 칸에서 고른 것을 반대 칸으로
 * @param {boolean} [o.copy] 복사가 있는 화면인가(없으면 F5는 가로채지 않는다)
 * @param {(i:number) => string} [o.selOf] 칸 i에서 선택한 줄 값(Tab 뒤 그 줄로 포커스)
 */
export function twoPaneFrame(o) {
  const {root, attr, rowAttr, curClass, on, cur, setCur, visible = () => true, blocked = () => false, send = () => {}, copy = true, selOf = () => ''} = o;
  const box = i => root?.querySelector(`[${attr}="${i}"]`) || null;
  // 요소가 든 칸 번호(칸 밖이면 -1).
  const paneOf = el => { const b = el?.closest?.(`[${attr}]`); return b && root?.contains(b) ? Number(b.getAttribute(attr)) : -1; };
  // 지금 칸 표시: 두 칸일 때 지금 칸 상자에만 curClass.
  const mark = () => { const two = on(), c = cur(); for (const el of root?.querySelectorAll(`[${attr}]`) || []) el.classList.toggle(curClass, two && Number(el.getAttribute(attr)) === c); };
  // 칸 i로 바꾸고 그 칸의 선택한 줄(없으면 첫 줄, 줄이 없으면 첫 단추)에 포커스.
  const focusPane = i => {
    setCur(i);
    const b = box(i), rows = [...(b?.querySelectorAll(`[${rowAttr}]`) || [])], sel = selOf(i);
    (rows.find(r => r.getAttribute(rowAttr) === sel) || rows[0] || b?.querySelector('button,select'))?.focus({preventScroll: false});
  };
  // 두 칸 키: 이 화면이 보이고 두 칸일 때, 입력 칸 밖에서만. 포커스가 화면 안이거나 아무 데도 없을 때(body)만 가로챈다.
  // Tab은 목록 줄(또는 아무 데도 없을 때)에서만 칸을 바꾼다 — 위 줄·막대 단추 사이의 Tab 이동은 그대로.
  const key = event => {
    if (!on() || !visible()) return false;
    const t = event.target;
    if (t?.matches?.('input,select,textarea,[contenteditable="true"]')) return false;
    const blank = t === document.body || t === document.documentElement;
    if (!(blank || root?.contains(t))) return false;
    if (blocked()) return false;
    const act = paneKeyAction({key: event.key, mod: event.altKey || event.ctrlKey || event.metaKey, onRow: blank || !!t?.matches?.(`[${rowAttr}]`), copy});
    if (!act) return false;
    event.preventDefault();
    if (act === 'switch') focusPane(cur() ^ 1); else send(act);
    return true;
  };
  // 끌어 놓기 받는 자리: 놓은 곳이 든 칸과 그 칸이 끌기를 시작한 칸(from)의 반대 칸인가.
  const dropPane = (target, from) => { const i = on() ? paneOf(target) : -1; return {i, box: i >= 0 ? box(i) : null, cross: i >= 0 && i !== from}; };
  return {box, paneOf, mark, key, focusPane, dropPane};
}
