// 선택 모드 상태 공용 부품(NOTE-탐색기 후속 ⑦, 2026-10-28): 자료실(library-upload.js luPick)과 노트(basket-notes.js pick)가 같은 상태 코드를 쓴다.
// 상태 주인은 이 부품 하나: items(null = 선택 모드 아님, Set = 고른 열쇠들), anchor(Shift 범위의 시작 줄). 화면 기억만(기기 저장 없음).
// 그리기·서버 일은 부르는 화면이 한다. 고르기 규칙은 자료실과 같은 순수 함수(library-select.js toggleAll·pruneSelected, library-bulk.js rangeIds).
// layer(선택): 라우터 한 겹 이름. 주면 선택 모드를 켤 때 한 겹을 열어 폰 뒤로가기(갤럭시 뒤로)가 선택 모드를 끈다(노트). 안 주면 겹 없음(자료실 그대로).
import {toggleAll, pruneSelected} from './library-select.js';
import {rangeIds} from './library-bulk.js';

export function createSelectMode({layer = null, router = () => globalThis.window?.KPTURouter, onBack = null} = {}) {
  let items = null, opened = null;
  const openLayer = () => {
    if (!layer || opened) return;
    opened = router()?.layer?.open(layer, {close: () => { opened = null; const was = !!items; items = null; self.anchor = null; if (was) onBack?.(); return true; }}) || null;
  };
  const closeLayer = fromBack => { const l = opened; opened = null; if (!fromBack) l?.close(); };
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
    add(key) { items?.add(key); return self; },
    remove(key) { items?.delete(key); return self; },
    // 화면에서 사라진 것은 고른 목록에서 뺀다. 반환: 바뀌었는지.
    prune(visible) { if (!items) return false; const keep = pruneSelected(items, visible); if (keep.size === items.size) return false; items = keep; return true; },
  };
  return self;
}
