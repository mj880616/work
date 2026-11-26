// 선택 모드 상태 공용 부품(NOTE-탐색기 후속 ⑦, 2026-10-28): 자료실(library-upload.js luPick)과 노트(basket-notes.js pick)가 같은 상태 코드를 쓴다.
// 상태 주인은 이 부품 하나: items(null = 선택 모드 아님, Set = 고른 열쇠들), anchor(Shift 범위의 시작 줄). 화면 기억만(기기 저장 없음).
// 그리기·서버 일은 부르는 화면이 한다. 고르기 규칙은 자료실과 같은 순수 함수(library-select.js toggleAll·pruneSelected, library-bulk.js rangeIds).
// layer(선택): 라우터 한 겹 이름. 주면 선택 모드를 켤 때 한 겹을 열어 폰 뒤로가기(갤럭시 뒤로)가 선택 모드를 끈다(노트·자료실). 안 주면 겹 없음.
// canLeave(선택): 뒤로가기로 끄려 할 때 false를 돌려주면(예: 고른 것을 옮기거나 지우는 중) 선택 모드를 그대로 두고 겹으로 돌아간다.
import {toggleAll, pruneSelected} from './library-select.js';
import {rangeIds} from './library-bulk.js';

// 폰 길게 누르기 공용 규칙(S69 LONGPRESS-선택, 2026-11-24 사용자 "꾹 누르면 선택이 활성화 … 우클릭 메뉴는 옆에 점점점으로"):
// 줄을 움직이지 않고 꾹 누르면 선택 모드를 켜고 그 줄을 고른다. 이미 선택 모드면 그 줄을 더한다(토글 아님 — 다시 꾹 눌러도 풀리지 않는다).
// 메뉴는 줄 오른쪽 ⋯로만 연다. 길게 눌러 잡고 움직이면 끌기(각 화면의 끌기 부품). PC 마우스 우클릭 메뉴·키보드 길은 그대로.
// items: 지금 고른 Set(없으면 null), keys: 꾹 누른 줄의 열쇠들. 반환: 새 Set(넘겨받은 Set은 바꾸지 않는다).
export function holdPick(items, keys) {
  const next = new Set(items || []);
  for (const k of keys || []) next.add(k);
  return next;
}

// S69-89 UI-고르기모드통일(2026-11-25 사용자 "선택 가능 모드에서 폰 뒤로가기 버튼 누르면 선택 가능 모드에서 나오게 선택도 취소되고"):
// 고르기 모드의 뒤로가기 겹 하나를 여닫는 공용 부품. 고르기 상태를 따로 가진 화면(파일 p.picked)도 이것 하나로 같은 규칙을 쓴다
// (화면마다 history를 따로 만들지 않는다). 겹은 라우터(app-router.js layer)에 올리므로 열린 메뉴·창이 위에 있으면 그것부터 닫힌다.
// 추정 원인 대비: 크롬 계열은 누름(사용자 활성) 없이 넣은 기록 칸을 브라우저 뒤로가기에서 건너뛸 수 있다(그러면 뒤로가기가 고르기를 끄지 않고
// 직전 화면으로 간다). 꾹 누르기(contextmenu·타이머)처럼 누름이 아직 없을 때 켜지면 겹은 손을 떼는(누름이 생기는) 순간 연다.
// 반환: sync(on) 켜짐에 맞춰 열거나 닫기, close() 닫기(뒤로가기로 이미 빠졌으면 fromBack), get isOpen, settled()(닫은 겹의 뒤로가기 도착).
const ACTIVATION_EVENTS = ['pointerup', 'touchend', 'mousedown', 'keydown', 'click'];
function whenActivated(run) {
  const w = globalThis.window, ua = globalThis.navigator?.userActivation;
  if (!w || !ua || ua.isActive) { run(); return () => {}; }
  let done = false;
  const off = () => { for (const t of ACTIVATION_EVENTS) w.removeEventListener(t, go, true); };
  const go = () => { if (done) return; done = true; off(); run(); };
  for (const t of ACTIVATION_EVENTS) w.addEventListener(t, go, true);
  return () => { if (!done) { done = true; off(); } };
}
export function createBackLayer(layer, {router = () => globalThis.window?.KPTURouter, onBack = null, canLeave = null} = {}) {
  let opened = null, waiting = null;
  const open = () => {
    if (!layer || opened || waiting) return;
    let ran = false;
    const cancel = whenActivated(() => {
      ran = true; waiting = null;
      if (opened) return;
      opened = router()?.layer?.open(layer, {close: () => { if (canLeave?.() === false) return false; opened = null; onBack?.(); return true; }}) || null;
    });
    if (!ran) waiting = cancel;
  };
  // 반환: 겹의 뒤로가기가 도착하면 풀리는 약속(닫은 뒤 창을 여는 화면이 기다릴 수 있게 — 라우터 layer close와 같음).
  let last = Promise.resolve();
  const close = ({fromBack = false} = {}) => { waiting?.(); waiting = null; const l = opened; opened = null; if (!fromBack && l) last = Promise.resolve(l.close()); return last; };
  return {
    sync(on) { if (on) open(); else if (opened || waiting) close(); },
    open, close,
    get isOpen() { return !!opened; },
    // 마지막으로 닫은 겹의 뒤로가기가 도착하면 풀린다.
    settled: () => last,
  };
}

export function createSelectMode({layer = null, router = () => globalThis.window?.KPTURouter, onBack = null, canLeave = null} = {}) {
  let items = null;
  const back = createBackLayer(layer, {router, canLeave: () => !(items && canLeave?.() === false), onBack: () => { const was = !!items; items = null; self.anchor = null; if (was) onBack?.(); }});
  const openLayer = () => back.open();
  const closeLayer = fromBack => back.close({fromBack});
  const self = {
    anchor: null,
    get active() { return !!items; },
    // 고른 열쇠 Set(또는 null). 바로 바꿔 넣을 수 있다: null을 넣으면 선택 모드가 끝난다(겹도 닫음), Set을 넣으면 켜진다.
    get items() { return items; },
    set items(next) {
      if (next) { items = next instanceof Set ? next : new Set(next); openLayer(); }
      else if (items) { items = null; self.anchor = null; closeLayer(false); }
    },
    get size() { return items ? items.size : 0; },
    has: key => !!items?.has(key),
    // 켜기. keys: 처음부터 고를 것, anchor: Shift 범위 시작(없으면 null).
    start(keys = [], anchor = null) { if (!items) { items = new Set(); openLayer(); } for (const k of keys) items.add(k); self.anchor = anchor; return self; },
    // 끄기. fromBack: 뒤로가기로 겹이 이미 빠진 경우. 반환: 켜져 있었는지.
    stop({fromBack = false} = {}) { if (!items) return false; items = null; self.anchor = null; closeLayer(fromBack); return true; },
    // 하나 또는 여럿을 함께 고르기·풀기(모두 골라져 있으면 모두 풀고, 아니면 모두 고름). 끝나면 anchor는 마지막 하나.
    toggle(keys, {anchor = true} = {}) { if (!items) return self; items = toggleAll(items, keys); if (anchor && keys.length === 1) self.anchor = keys[0]; return self; },
    // Shift: anchor부터 key까지(order 차례) 더하기. anchor가 없으면 key 하나만 토글.
    range(order, key) { if (!items) return self; if (self.anchor == null) return self.toggle([key]); items = new Set([...items, ...rangeIds(order, self.anchor, key)]); return self; },
    // 폰 꾹 누르기(holdPick 규칙): 꺼져 있으면 켜고, keys를 더한다(풀지 않음). 하나면 anchor도 그 줄.
    hold(keys) { const list = [...(keys || [])]; self.items = holdPick(items, list); if (list.length === 1) self.anchor = list[0]; return self; },
    add(key) { items?.add(key); return self; },
    remove(key) { items?.delete(key); return self; },
    // 화면에서 사라진 것은 고른 목록에서 뺀다. 반환: 바뀌었는지.
    prune(visible) { if (!items) return false; const keep = pruneSelected(items, visible); if (keep.size === items.size) return false; items = keep; return true; },
  };
  return self;
}
