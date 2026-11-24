// HELP-메뉴안쓰는법: '쓰는 법' 화면(?view=help)으로 가는 길 한 곳. 계정 메뉴의 '쓰는 법' 줄, 각 화면 ⋯ 메뉴 맨 아래 '쓰는 법', 빈 화면 안내의
// [쓰는 법 보기]가 모두 여기를 부른다. topic(메뉴 이름)을 주면 쓰는 법 화면이 그 줄을 펼친 채(넓은 화면은 그 줄을 고른 채) 연다.
// 화면 전환·뒤로가기는 라우터 한 곳(KPTURouter.go). 기기 저장 없음 — 펼칠 줄은 주소(?view=help&topic=…)와 이 메모리 한 칸으로만 건넨다.
import {topic as helpTopic} from './help-content.mjs';

let pending = null;
/** 쓰는 법 화면을 연다. topic이 쓰는 법 줄 이름이면 그 줄을 펼친다. */
export function openHelp(topic = '') {
  pending = helpTopic(topic) ? topic : '';
  window.KPTURouter?.go?.('help', {source: 'delegated'});
}
/** 쓰는 법 화면(help.js)이 들어올 때 한 번 가져간다(없으면 ''). */
export function takeHelpTopic() { const t = pending; pending = null; return t; }

if (typeof document !== 'undefined' && !window.__KPTU_HELP_LINK__) {
  window.__KPTU_HELP_LINK__ = true;
  // 빈 화면 안내의 [쓰는 법 보기](data-help-open): 화면 안 버튼이라 메뉴 닫기 없이 바로 연다.
  // ⋯ 메뉴 안 줄은 그 메뉴의 onAction이 메뉴를 닫은 뒤 openHelp를 부른다(여기서는 메뉴 밖 버튼만).
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-help-open]');
    if (!button || button.closest('[role="menu"],[popover]')) return;
    event.preventDefault();
    openHelp(button.dataset.helpOpen || '');
  });
}
