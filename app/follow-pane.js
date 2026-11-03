// UI-상세칸고정(2026-11-03 명진 요청, S49-8): PC(761px~) '목록 | 상세' 화면에서 왼쪽 목록을 아래로 내려도 오른쪽 상세 칸은 제자리에 있다.
// 이 부품이 붙인 칸(.kptu-follow-pane)은 화면 위쪽(기본 12px)에 붙고(sticky), 내용이 화면보다 길면 그 칸만 따로 스크롤한다
// (최대 높이 = 화면 높이 - 위 자리 - 12px). 왼쪽 목록·그 밖의 칸은 화면 스크롤 하나 그대로다(UI-칸안스크롤하나로, 2026-10-30).
// 앞 규칙(긴 칸이 칸 끝까지 같이 내려가는 따라오기)은 이 요청으로 바뀌었다. 두 규칙은 docs/design-decisions.md 'UI-상세칸고정'에 한 줄씩.
// 모양(position:sticky·top·max-height·overflow)은 desktop-ui.css의 .kptu-follow-pane 한 곳이 정하고, 이 모듈은 칸에 이름을 붙이고
// 칸마다 --follow-top(위 자리)과 --follow-max(칸 최대 높이 = 화면 높이 - 칸이 지금 있는 자리 - 12px) 두 값만 정한다.
// 칸이 아직 제자리 위(자연 위치)로 오르기 전에는 칸 아래쪽 줄([저장] 등)이 화면 밖으로 나가지 않게 최대 높이를 그 자리에 맞춘다.
// 새 항목을 그려 다시 부르면(reset) 칸 안 스크롤을 맨 위로 되돌린다. 서버·기기 저장 없음.
const GAP = 12;
const panes = new Map(); // el -> top
let queued = false;

/** 순수 계산(tests/follow-pane-math.test.mjs): 칸이 화면 위에서 rectTop에 있을 때 화면 안에 다 들어오는 최대 높이. 칸이 붙으면(rectTop<=top) top 기준. */
export function followMax({ view, top = GAP, rectTop }) {
  return Math.max(160, Math.floor(view - Math.max(top, rectTop) - GAP));
}
function paint(el, top) {
  const v = `${followMax({ view: window.innerHeight, top, rectTop: el.getBoundingClientRect().top })}px`;
  if (el.style.getPropertyValue('--follow-max') !== v) el.style.setProperty('--follow-max', v);
}
function refresh() {
  queued = false;
  for (const [el, top] of panes) { if (el.isConnected) paint(el, top); else panes.delete(el); }
}
function queue() { if (!queued) { queued = true; requestAnimationFrame(refresh); } }
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
}

/** 칸 하나를 화면(위에서 top px)에 붙인다. 같은 칸을 다시 부르면 reset일 때 칸 안 스크롤을 맨 위로. */
export function followPane(el, { top = GAP, reset = true } = {}) {
  if (!el) return;
  el.classList.add('kptu-follow-pane');
  const v = `${Math.round(top)}px`;
  if (el.style.getPropertyValue('--follow-top') !== v) el.style.setProperty('--follow-top', v);
  panes.set(el, top); listen(); paint(el, top);
  if (reset) {
    el.scrollTop = 0;
    // 칸 머리가 자기 자리(top) 위로 지나가 있으면(칸을 품은 줄 끝 가까이에서 새 항목을 연 때) 그만큼만 화면을 올려 머리를 보인다.
    const over = el.getBoundingClientRect().top - top;
    if (over < -1) window.scrollBy({ top: over, behavior: 'instant' });
  }
}
