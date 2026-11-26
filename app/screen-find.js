// UI-검색창하나로(S70-54, 명진 11/25 21:29 "검색창 두개인데 걍 맨 위 검색창 활용하면 안되나", 설계 docs/design/one-search-bar.md):
// 맨 위 검색 칸이 지금 화면 안 찾기를 겸한다. 이 모듈은 두 가지의 유일한 주인이다.
//  1) 화면 찾기 등록표: 화면이 registerScreenFind(key, {active, label, value, apply})로 자기 걸러 내기 함수를 넘긴다.
//     맨 위 칸(global-search.js)은 지금 화면에 등록된 찾기가 있으면 그 칸의 안내글·글자를 그 찾기 것으로 바꾸고, 칠 때 apply를 부른다.
//     새 검색을 만들지 않는다 — apply는 그 화면이 원래 쓰던 걸러 내기 함수 그대로다.
//  2) 옮겨 온 단추 상자: 화면 안 검색 줄에 있던 고르기·⋯·만들기 단추가 사는 상자(toolsBox). 상자는 PC 틀(761px~)이면 그 화면 안
//     첫 줄 오른쪽 끝(S71-59, screen-tools.js lineSlot), 폰 틀이면 앱 머리 줄 오른쪽([data-screen-tools="head"])에 붙고(S70-53 공용 자리),
//     지금 화면 것만 보인다. 상자 안 단추의 그리기·누르기는 계속 그 화면이 한다(여기서는 자리만).
//  3) 비슷한 것 찾기(SEARCH-비슷한것찾기 S70-67, 명진 11/26 08:22~08:24): 화면은 걸러 낼 때 findFor(key, 글자)로 공용 판정(find-match-model.mjs —
//     띄어쓰기 무시·오타·초성·앞부분)을 받아 줄마다 hit()을 부른다. 화면마다 따로 만들지 않는다. 맞은 부분 굵게는 spec.marks(글자 칸 고르개)
//     안 글자에 여기서 한 번 칠한다(CSS Custom Highlight — 글을 바꾸지 않고 칠만). 결과가 3개 미만이거나 문장이면 서버 AI(ai-assist find_expand)에
//     그 글 하나만 보내 비슷한 말·기간을 받아 다시 거르게 하고(spec.apply(글, {again: true})), 맨 위 칸 아래에 '비슷한 말로도 찾았어요' 한 줄을 둔다.
//  4) 화면 이름 옆 작은 글자(noteBox, S71-27 NEWS-머리한줄): '읽을 거리 · 새 글 40'처럼 화면 이름 바로 뒤 작은 회색 글 한 칸. 자리는 폰·폴드 머리 줄 이름 뒤
//     ([data-screen-note="head"]), PC 틀은 맨 위 줄 위치(›) 뒤([data-screen-note="top"]). 단추 상자와 같이 지금 화면 것만 보이고, 글자는 그 화면이 채운다.
// 저장하는 것 없음(화면 찾기 글자·비슷한 말은 이 탭 메모리).
import {compileFind, inPeriod, markRanges, wantsMeaning, looksSentence} from './find-match-model.mjs';
import {lineSlot} from './screen-tools.js'; // S71-59 UI-화면메뉴안으로: PC 틀 단추 상자 자리 = 그 화면 안 첫 줄 오른쪽 끝(표는 screen-tools.js 한 곳)
const scopes = new Map(), listeners = new Set(), boxes = new Map(), notes = new Map();
const WIDE = window.matchMedia('(min-width:761px)');
let current = null, queued = false;

// spec: {active(): boolean, label: '노트에서 찾기', value(): string, apply(q, {submit}): void}
// spec.marks: 맞은 부분을 굵게 칠할 글자 칸 고르개(예: '#noteRows [data-note-row] .title'). 없으면 굵게 없음.
// spec.meaning: false면 AI 찾기 풀이를 부르지 않는다(그 화면에 이미 문장 찾기가 있을 때).
export function registerScreenFind(key, spec) {
  const entry = {key, ...spec};
  entry.apply = (q, opt = {}) => { spec.apply(q, opt); if (!opt.again) afterApply(key, q, opt); };
  scopes.set(key, entry);
  refreshScreenFind();
}
export function screenFind() { return current; }
export function onScreenFind(fn) { listeners.add(fn); fn(current); return () => listeners.delete(fn); }
// 화면이 '찾기가 지금 쓰이는지'나 찾기 글자를 스스로 바꿨을 때(목록 ↔ 상세, 로그인 바뀜 등) 부른다. 한 번에 모아서 맞춘다.
export function refreshScreenFind() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; sync(); });
}
// 화면의 단추 상자(처음 부를 때 만든다). 화면은 여기에 자기 단추를 넣고, 누르기는 그 화면이 상자에 직접 붙인다.
// view: 라우터 화면 이름(빈 곳 우클릭 context-menu.js가 data-screen-tools-for로 이 화면 ⋯를 찾는다 — screen-tools.js와 같은 표시).
export function toolsBox(key, view) {
  let box = boxes.get(key);
  if (!box) {
    box = document.createElement('div');
    box.className = 'sf-tools'; box.dataset.sfTools = key; box.hidden = true;
    if (view) { box.dataset.screenToolsFor = view + 'View'; box.dataset.sfView = view; }
    boxes.set(key, box);
    place();
  }
  return box;
}

// 화면 이름 옆 작은 글자 칸(처음 부를 때 만든다). 화면은 textContent만 채운다(빈 글자면 자리째 없음 — CSS).
export function noteBox(key) {
  let el = notes.get(key);
  if (!el) {
    el = document.createElement('span');
    el.className = 'sf-note'; el.dataset.sfNote = key; el.hidden = true;
    notes.set(key, el);
    place();
  }
  return el;
}

function pick() {
  for (const spec of scopes.values()) {
    try { if (spec.active()) return spec; } catch { /* 화면이 아직 준비 전 */ }
  }
  return null;
}
function hostFor(box) {
  // 폰 틀은 S70-53 공용 자리(index.html 앱 머리 줄 [data-screen-tools="head"], screen-tools.js와 같은 칸).
  // PC 틀은 S71-59: 그 화면 안 첫 줄 오른쪽 끝(screen-tools.js lineSlot — 맨 위 줄에는 앱 전체 것만).
  return WIDE.matches ? lineSlot(box.dataset.sfView) : document.querySelector('[data-screen-tools="head"]');
}
function place() {
  for (const [key, box] of boxes) {
    const host = hostFor(box);
    if (host && box.parentElement !== host) host.append(box);
    box.hidden = key !== current?.key;
  }
  const noteHost = document.querySelector(WIDE.matches ? '[data-screen-note="top"]' : '[data-screen-note="head"]');
  for (const [key, el] of notes) {
    if (noteHost && el.parentElement !== noteHost) noteHost.append(el);
    el.hidden = key !== current?.key;
  }
}
function sync() {
  const next = pick();
  current = next;
  if (next) document.documentElement.dataset.screenFind = next.key; else delete document.documentElement.dataset.screenFind;
  place();
  for (const fn of listeners) { try { fn(current); } catch (e) { console.error('screen find', e?.name || 'Error'); } }
}

// 화면이 바뀌면 그 화면이 자기 칸을 그린 뒤 맞춘다(같은 틱 안의 화면 그리기가 먼저).
window.addEventListener('kptu:view-changed', () => { refreshScreenFind(); requestAnimationFrame(refreshScreenFind); });
WIDE.addEventListener('change', () => { place(); for (const fn of listeners) fn(current); });
window.addEventListener('kptu:screen-line', place); // S71-59: 화면 첫 줄이 새로 생기면(screen-tools.js placeScreenTools) PC 틀 상자 자리를 다시 맞춘다

// ---------- 비슷한 것 찾기(S70-67) ----------
const states = new Map();          // key -> {text, sig, find, period, count, timer}
const meanings = new Map();        // 검색 글 -> {words, from, to} | null(못 받음) | Promise
const MEANING_MAX = 30;            // 한 번 열어 둔 동안 AI 풀이를 부르는 최대 횟수(하루 한도는 서버가 센다)
let meaningCalls = 0, meaningOff = false;
const norm = raw => String(raw ?? '').replace(/\s+/g, ' ').trim();
const stateOf = key => { let st = states.get(key); if (!st) { st = {text: '', sig: '', find: compileFind(''), period: null, count: 0, timer: 0}; states.set(key, st); } return st; };
// 화면이 걸러 낼 때(그리기 한 번마다) 부른다. 받은 판정의 hit(...글)·hitAt(날짜, ...글)이 맞으면 {score, ranges, field}, 아니면 null.
// rank(목록, 줄 → 글들[, 줄 → 날짜]) = 맞은 줄만 맞은 정도 순. 비슷한 말로 맞은 줄은 기간(있으면) 안의 것만.
export function findFor(key, raw) {
  const st = stateOf(key), text = norm(raw);
  st.text = text; st.seen = text; // seen: 이 화면이 이 글자로 공용 판정을 실제로 썼다(안 쓴 화면은 AI 풀이를 부르지 않는다)
  const m = meanings.get(text);
  const meaning = m && !(m instanceof Promise) ? m : null;
  const sig = text + '\u0000' + (meaning ? meaning.words.join('\u0001') : '');
  if (st.sig !== sig) {
    st.sig = sig;
    st.find = compileFind(text, {also: meaning?.words || []});
    st.period = meaning && (meaning.from || meaning.to) ? {from: meaning.from, to: meaning.to} : null;
  }
  // 결과 수(AI 풀이를 부를지 볼 때 씀) = 이번 그리기에서 맞은 서로 다른 줄 글 수(같은 줄을 여러 번 물어도 한 번).
  const seenRows = new Set();
  st.count = 0;
  const f = st.find, period = st.period;
  const check = (day, texts) => {
    const r = f.best(...texts);
    if (!r || (r.also && day !== undefined && !inPeriod(day, period))) return null;
    const sig = texts.map(t => String(t ?? '')).join('\u0001');
    if (!seenRows.has(sig)) { seenRows.add(sig); st.count = seenRows.size; }
    return r;
  };
  schedulePaint(); // 비운 뒤에도 한 번 칠해 지난 칠하기를 지운다
  return {
    empty: f.empty, text, also: f.also, period,
    best: f.best, test: f.test, // 세지 않고 점수만 볼 때(정렬 등)
    hit: (...texts) => (f.empty ? {score: 0, ranges: []} : check(undefined, texts)),
    hitAt: (day, ...texts) => (f.empty ? {score: 0, ranges: []} : check(day, texts)),
    rank(items, texts, dayOf) {
      if (f.empty) return [...(items || [])];
      const out = [];
      (items || []).forEach((item, i) => { const r = check(dayOf ? dayOf(item) : undefined, [].concat(texts(item))); if (r) out.push({item, i, s: r.score}); });
      return out.sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.item);
    },
  };
}

// 걸러 내기 함수가 그리기 곳곳에서 불릴 때: 같은 동기 그리기(한 틱) 안에서는 같은 판정을 쓰고, 다음 그리기에서 새로 받는다.
export function finderOf(key, textOf) {
  let m = null;
  return () => { if (!m) { m = findFor(key, textOf()); queueMicrotask(() => { m = null; }); } return m; };
}

function afterApply(key, raw, opt) {
  const st = stateOf(key), text = norm(raw);
  clearTimeout(st.timer);
  paintAlso();
  schedulePaint();
  if (!text) return;
  // 그리기가 끝난 뒤(결과 수가 정해진 뒤) 본다. Enter면 바로, 치는 중이면 손을 멈춘 뒤.
  st.timer = setTimeout(() => requestAnimationFrame(() => considerMeaning(key, text)), opt?.submit ? 0 : 900);
}
function considerMeaning(key, text) {
  const st = stateOf(key), spec = scopes.get(key);
  if (!spec || spec.meaning === false || current?.key !== key || st.text !== text || st.seen !== text) return;
  if (meanings.has(text)) return;
  if (!wantsMeaning(text, looksSentence(text) ? 0 : st.count)) return;
  const ask = askMeaning(text);
  if (!ask) return;
  ask.then(got => {
    if (!got || current?.key !== key || stateOf(key).text !== text) return;
    try { spec.apply(text, {again: true}); } catch (e) { console.error('screen find again', e?.name || 'Error'); }
    paintAlso();
  });
}
// 뜻 비슷 찾기 한 길(S71-15: 홈 전체 검색도 같은 길·같은 기억·같은 한도를 쓴다). 서버 AI(ai-assist find_expand)에 친 글 하나만 보낸다.
// 돌려주는 것: Promise<{words, from, to} | null>, 부를 수 없으면(한도·AI 없음·런타임 없음) null. 같은 글은 한 번만 묻는다(이 탭 메모리).
export function askMeaning(text) {
  const t = norm(text);
  if (!t) return null;
  if (meanings.has(t)) { const m = meanings.get(t); return m instanceof Promise ? m : Promise.resolve(m); }
  if (meaningOff || meaningCalls >= MEANING_MAX || !window.KPTURuntime?.api) return null;
  meaningCalls++;
  const ask = window.KPTURuntime.api('/functions/v1/ai-assist', {method: 'POST', body: {kind: 'find_expand', text: t}, singleFlight: false, timeoutMs: 20000})
    .then(data => {
      const words = Array.isArray(data?.words) ? data.words.filter(w => typeof w === 'string' && w.trim()).slice(0, 8) : [];
      const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
      const got = words.length || day(data?.from) || day(data?.to) ? {words, from: day(data?.from), to: day(data?.to)} : null;
      meanings.set(t, got);
      return got;
    }, e => {
      // 하루·월 한도(429)나 AI 없음이면 이번에 연 동안 더 부르지 않는다 — 글자 비슷 찾기 결과만 보인다.
      if (e?.status === 429 || e?.status === 503) meaningOff = true;
      meanings.set(t, null);
      return null;
    });
  meanings.set(t, ask);
  return ask;
}

// '비슷한 말로도 찾았어요: 협의 · 간담회' 한 줄: 맨 위 칸 바로 아래(화면 목록 위)에 떠 있는 작은 줄. 이 모듈이 유일한 주인.
let alsoLine = null;
const md = d => { const [, m, day] = d.split('-'); return `${Number(m)}월 ${Number(day)}일`; };
function paintAlso() {
  const spec = current, st = spec ? states.get(spec.key) : null;
  const text = st?.text || '';
  const m = text ? meanings.get(text) : null;
  const live = spec && m && !(m instanceof Promise) && norm(spec.value?.()) === text;
  const words = live ? m.words.filter(w => norm(w).toLowerCase() !== text.toLowerCase()).slice(0, 4) : [];
  const period = live && (m.from || m.to) ? `${m.from ? md(m.from) : ''}~${m.to ? md(m.to) : ''}` : '';
  if (!words.length && !period) { if (alsoLine) alsoLine.hidden = true; return; }
  if (!alsoLine) {
    alsoLine = document.createElement('div');
    alsoLine.className = 'sf-also'; alsoLine.setAttribute('role', 'status'); alsoLine.id = 'sfAlso';
    document.body.append(alsoLine);
  }
  alsoLine.textContent = [words.length ? `비슷한 말로도 찾았어요: ${words.join(' · ')}` : '', period].filter(Boolean).join(' · ');
  alsoLine.hidden = false;
  placeAlso();
}
function placeAlso() {
  if (!alsoLine || alsoLine.hidden) return;
  const input = document.querySelector(WIDE.matches ? '#gsTopInput' : '#gsScreenInput');
  const wrap = input?.closest('.gs-field') || input?.parentElement;
  const r = (input?.checkVisibility?.() ? wrap : document.querySelector('.mobile-shell-header'))?.getBoundingClientRect();
  if (!r) { alsoLine.hidden = true; return; }
  const width = Math.min(innerWidth - 16, Math.max(r.width, 220));
  alsoLine.style.top = `${Math.round(r.bottom + 2)}px`;
  alsoLine.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - width - 8)))}px`;
  alsoLine.style.maxWidth = `${Math.round(width)}px`;
}
window.addEventListener('resize', placeAlso);

// 맞은 부분 굵게: 지금 화면 spec.marks 안 글자 마디마다 같은 판정으로 구간을 찾아 칠한다(글은 바꾸지 않음). 그리기가 끝난 다음 틀에서 한 번.
let paintQueued = false;
function schedulePaint() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => { paintQueued = false; paintMarks(); });
}
const canHighlight = () => typeof window.Highlight === 'function' && !!window.CSS?.highlights;
function paintMarks() {
  if (!canHighlight()) return;
  const spec = current, st = spec ? states.get(spec.key) : null;
  const find = st?.find;
  const marks = new window.Highlight();
  if (find && !find.empty && spec.marks && norm(spec.value?.()) === st.text) {
    for (const host of document.querySelectorAll(spec.marks)) {
      if (!host.checkVisibility?.()) continue;
      const walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        for (const [a, b] of markRanges(node.data, find)) {
          const range = new Range();
          range.setStart(node, a); range.setEnd(node, Math.min(b, node.data.length));
          marks.add(range);
        }
      }
    }
  }
  window.CSS.highlights.set('kptu-find', marks);
}
onScreenFind(() => { paintAlso(); schedulePaint(); });
// 창 객체를 받아 쓰는 모듈(잊지 말기 목록 — 순수 시험에서도 불러짐)이 이 판정을 쓰게 연다.
window.KPTUScreenFind = {findFor, finderOf};
