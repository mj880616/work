// UI-상세칸고정(2026-11-03 명진 요청, S49-8): PC(761px~) '목록 | 상세' 화면에서 왼쪽 목록을 아래로 내려도 오른쪽 상세 칸은 제자리에 있다.
// 이 부품이 붙인 칸(.kptu-follow-pane)은 화면 위쪽(기본 12px)에 붙고(sticky), 내용이 화면보다 길면 그 칸만 따로 스크롤한다
// (최대 높이 = 화면 높이 - 위 자리 - 12px). 왼쪽 목록·그 밖의 칸은 화면 스크롤 하나 그대로다(UI-칸안스크롤하나로, 2026-10-30).
// 앞 규칙(긴 칸이 칸 끝까지 같이 내려가는 따라오기)은 이 요청으로 바뀌었다. 두 규칙은 docs/design-decisions.md 'UI-상세칸고정'에 한 줄씩.
// 모양(position:sticky·top·max-height·overflow)은 desktop-ui.css의 .kptu-follow-pane 한 곳이 정하고, 이 모듈은 칸에 이름을 붙이고
// 칸마다 --follow-top(위 자리)과 --follow-max(칸 최대 높이 = 화면 높이 - 칸이 지금 있는 자리 - 12px) 두 값만 정한다.
// 칸이 아직 제자리 위(자연 위치)로 오르기 전에는 칸 아래쪽 줄([저장] 등)이 화면 밖으로 나가지 않게 최대 높이를 그 자리에 맞춘다.
// 새 항목을 그려 다시 부르면(reset) 칸 안 스크롤을 맨 위로 되돌린다. 서버·기기 저장 없음.
// BIZ-결과칸작음(11/10 명진 요청): 칸 자리는 화면 스크롤·창 크기 말고도 바뀐다(위쪽 '이번 주 주간보고'를 접고 펴기, 목록을 새로 그림, 글 길이 바뀜).
// 그래서 칸이 든 화면 묶음(.view-panel, 없으면 칸 바로 위 틀) 하나의 크기 변화를 ResizeObserver 한 곳에서 본다(S56-17 고침).
// 크기 변화로 깨어나면 '화면에 그려져 있고 위쪽 위치가 지난번과 달라진 칸'만 최대 높이를 다시 쓴다(같은 값이면 안 씀, 한 프레임에 한 번,
// 스크롤·초점은 건드리지 않음). 칸이 화면에서 빠지면 그 칸 몫의 보기를 멈춘다. body 전체는 보지 않는다(앞 판은 body를 봐서
// 앱 어디서든 크기가 바뀔 때마다 모든 칸을 다시 재며 숨은 화면 칸까지 건드렸다).
const GAP = 12;
// S51-13 TODO-폴드목록상세: 폴드 펼침(600~760px, 폰 틀)에서도 붙일 칸은 narrow로 부른다. 그 폭은 아래에 입력칸·전환 줄·하단바가
// 떠 있으므로 그 높이(bottom, px를 돌려주는 함수)만큼 칸 최대 높이를 줄인다. 모양은 desktop-ui.css .kptu-follow-narrow 한 곳.
const panes = new Map(); // el -> {top(부른 쪽이 준 위 자리), bottom, node(보는 틀), lastTop(지난번 잰 위쪽 위치)}
// UI-PC스크롤묶음 ①(2026-11-10): PC 맨 위 줄(.app-topline)은 화면 맨 위에 붙어 있다. 부른 쪽이 주는 top은 '그 줄 아래에서' 몇 px인지이고,
// 칸이 실제로 붙는 자리는 그 줄이 차지하는 높이(맨 위 띠 + 줄 + 아래 간격)를 더한 값이다. 폰·폴드 접힘(~760px)은 줄이 없어 0.
/** 맨 위에 붙은 줄이 화면 위에서 차지하는 높이(px). 줄이 없거나 붙어 있지 않으면 0. */
export function stickTop() {
  const line = document.querySelector('#appView>.app-topline');
  if (!line) return 0;
  const s = getComputedStyle(line);
  if (s.display === 'none' || s.position !== 'sticky') return 0;
  return (parseFloat(s.top) || 0) + line.offsetHeight + (parseFloat(s.marginBottom) || 0);
}

/** 순수 계산(tests/follow-pane-math.test.mjs): 칸이 화면 위에서 rectTop에 있을 때 화면 안에 다 들어오는 최대 높이. 칸이 붙으면(rectTop<=top) top 기준. */
export function followMax({ view, top = GAP, rectTop }) {
  return Math.max(160, Math.floor(view - Math.max(top, rectTop) - GAP));
}
function paint(el, at) {
  const below = typeof at.bottom === 'function' ? Math.max(0, Number(at.bottom()) || 0) : 0;
  const top = Math.round(at.top + stickTop());
  const t = `${top}px`;
  if (el.style.getPropertyValue('--follow-top') !== t) el.style.setProperty('--follow-top', t);
  const rectTop = el.getBoundingClientRect().top;
  at.lastTop = rectTop;
  const v = `${followMax({ view: window.innerHeight - below, top, rectTop })}px`;
  if (el.style.getPropertyValue('--follow-max') !== v) el.style.setProperty('--follow-max', v);
  return top;
}
/** 순수 계산(tests/follow-pane-math.test.mjs): 크기 변화로 깨어났을 때 이 칸을 다시 잴지. 그려져 있고 위쪽 위치가 1px 넘게 바뀐 때만. */
export function moved({ shown, lastTop, rectTop }) {
  if (!shown) return false;
  return typeof lastTop !== 'number' || Math.abs(rectTop - lastTop) > 0.5;
}
let queued = false, all = false;
function refresh() {
  queued = false;
  const every = all; all = false;
  for (const [el, at] of panes) {
    if (!el.isConnected) { forget(el); continue; }
    if (every) { paint(el, at); continue; }
    // 크기 변화만으로 깨어난 때: 숨은 화면의 칸·자리가 그대로인 칸은 건드리지 않는다.
    const shown = el.getClientRects().length > 0;
    if (shown && moved({ shown, lastTop: at.lastTop, rectTop: el.getBoundingClientRect().top })) paint(el, at);
  }
}
function queue() { all = true; schedule(); }
function schedule() { if (!queued) { queued = true; requestAnimationFrame(refresh); } }
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
}
// 칸 위치를 옮길 수 있는 틀(칸이 든 화면 묶음)의 크기 변화를 본다. 같은 틀은 한 번만 보고, 그 틀을 쓰는 칸이 모두 빠지면 보기를 멈춘다.
let sizes = null;
const watched = new Map(); // 틀 -> 그 틀로 보는 칸 Set
/** 순수 계산(tests/follow-pane-math.test.mjs): 칸 el의 크기 변화를 볼 틀 — 화면 묶음(.view-panel), 없으면 칸 바로 위 틀. */
export function watchTarget(el) {
  return el?.closest?.('.view-panel') || el?.parentElement || null;
}
function watch(el, at) {
  if (typeof ResizeObserver !== 'function') return;
  const node = watchTarget(el);
  if (at.node === node) return;
  unwatch(el, at);
  if (!node) return;
  sizes ||= new ResizeObserver(schedule);
  let users = watched.get(node);
  if (!users) { users = new Set(); watched.set(node, users); sizes.observe(node); }
  users.add(el); at.node = node;
}
function unwatch(el, at) {
  const node = at?.node; if (!node) return;
  at.node = null;
  const users = watched.get(node); users?.delete(el);
  if (!users?.size) { watched.delete(node); sizes?.unobserve(node); }
}
function forget(el) { unwatch(el, panes.get(el)); panes.delete(el); }

/** 칸 하나를 화면(위에서 top px)에 붙인다. 같은 칸을 다시 부르면 reset일 때 칸 안 스크롤을 맨 위로. */
export function followPane(el, { top = GAP, reset = true, narrow = false, bottom = null } = {}) {
  if (!el) return;
  el.classList.add('kptu-follow-pane');
  el.classList.toggle('kptu-follow-narrow', !!narrow);
  const at = panes.get(el) || { node: null, lastTop: null };
  at.top = top; at.bottom = narrow ? bottom : null;
  panes.set(el, at); listen(); watch(el, at); paint(el, at);
  const stuck = Math.round(top + stickTop());
  if (reset) {
    el.scrollTop = 0;
    // 칸 머리가 자기 자리(맨 위 줄 아래 top) 위로 지나가 있으면(칸을 품은 줄 끝 가까이에서 새 항목을 연 때) 그만큼만 화면을 올려 머리를 보인다.
    const over = el.getBoundingClientRect().top - stuck;
    if (over < -1) window.scrollBy({ top: over, behavior: 'instant' });
  }
}
