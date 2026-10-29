// UI-칸안스크롤하나로(2026-10-30 사용자 결정, 시안 A): PC(1024px~) 좌우 화면은 스크롤이 화면 전체 하나다.
// 왼쪽 목록은 화면과 같이 내려가고, 오른쪽 상세 칸(또는 왼쪽 폴더 나무 같은 옆 칸)은 화면에 붙어 따라온다.
// - 칸이 화면보다 짧으면 위쪽(기본 12px, 사이드바와 같은 자리)에 붙는다.
// - 칸이 화면보다 길면 내려갈 때는 칸 끝까지 같이 내려간 뒤 아래쪽에 붙고, 올라갈 때는 칸 머리까지 같이 올라간 뒤 위쪽에 붙는다.
//   그래서 칸 안에 따로 스크롤 막대를 두지 않아도 칸 전체를 읽을 수 있다.
// - 새 항목을 그려 다시 부르면(followPane 다시 호출) 칸 머리부터 보인다(아래쪽 옛 줄을 눌러도 상세가 바로 보임).
// 모양(position:sticky·top)은 desktop-ui.css의 .kptu-follow-pane 한 곳이 정하고, 이 모듈은 칸마다 --follow-top 값 하나만 바꾼다.
// 칸 내용·배치는 각 화면 renderer 그대로다. 서버·기기 저장 없음.
const GAP = 12;
const panes = new Map(); // el -> {t, top, scroller}
const lastPos = new Map(); // scroller(window|element) -> 마지막 스크롤 위치
const listening = new Set();
let ro = null;

const pos = s => (s === window ? window.scrollY : s.scrollTop);
const viewH = s => (s === window ? window.innerHeight : s.clientHeight);

/** 순수 계산(tests/follow-pane-math.test.mjs): 칸의 top 값 t를 칸 높이·화면 높이 안으로 묶는다.
 * 짧은 칸은 늘 top, 긴 칸은 top(머리가 보임)과 화면 높이 - 칸 높이 - 12(끝이 보임) 사이. */
export function clampFollowTop(t, { top = GAP, view, height }) {
  const min = Math.min(top, view - height - GAP);
  return Math.min(top, Math.max(min, t));
}
function apply(el, st) {
  st.t = clampFollowTop(st.t, { top: st.top, view: viewH(st.scroller), height: el.offsetHeight });
  const v = `${Math.round(st.t)}px`;
  if (el.style.getPropertyValue('--follow-top') !== v) el.style.setProperty('--follow-top', v);
}
function onScroll(scroller) {
  const now = pos(scroller), d = now - (lastPos.get(scroller) ?? now);
  lastPos.set(scroller, now);
  for (const [el, st] of panes) {
    if (!el.isConnected) { panes.delete(el); ro?.unobserve(el); continue; }
    if (st.scroller !== scroller) continue;
    st.t -= d; apply(el, st);
  }
}
function refreshAll() {
  for (const [el, st] of panes) { if (el.isConnected) apply(el, st); else { panes.delete(el); ro?.unobserve(el); } }
}
function listen(scroller) {
  if (listening.has(scroller)) return;
  listening.add(scroller);
  lastPos.set(scroller, pos(scroller));
  scroller.addEventListener('scroll', () => onScroll(scroller), { passive: true });
}

/** 칸 하나를 화면(또는 창 몸통 scroller)에 붙여 따라오게 한다. 같은 칸을 다시 부르면 칸 머리부터 보인다(reset). */
export function followPane(el, { top = GAP, scroller = window, reset = true } = {}) {
  if (!el) return;
  let st = panes.get(el);
  if (!st) {
    st = { t: top, top, scroller };
    panes.set(el, st);
    el.classList.add('kptu-follow-pane');
    if (!ro && typeof ResizeObserver === 'function') ro = new ResizeObserver(entries => { for (const e of entries) { const s = panes.get(e.target); if (s) apply(e.target, s); } });
    ro?.observe(el);
    if (!listening.size) window.addEventListener('resize', refreshAll);
    listen(scroller); lastPos.set(scroller, pos(scroller));
  } else {
    st.top = top;
    if (st.scroller !== scroller) { st.scroller = scroller; listen(scroller); }
    // 다시 머리부터: 아직 처리되지 않은 스크롤 이동(누르기 직전의 스크롤)이 머리 자리를 다시 밀어내지 않게 지금 위치를 기준으로 삼는다.
    if (reset) { st.t = top; lastPos.set(scroller, pos(scroller)); }
  }
  apply(el, st);
}
