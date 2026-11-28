// HOME-업무일지홈(2026-10-30 명진 시안 확정): 옛 홈 칸 화면에만 있던 상태 줄을 내 프로필 맨 아래 칸으로 옮겼다.
// MULTI-다른담당자맞춤 ⑥(명진 11/13 15:30): 칸 이름 '사용 현황'. 마지막 수집 시각·AI 사용량 줄은 서버 운영자 기능이 있는
// 작업공간만(collection-status.js isOperator). 다른 사람에게는 이 칸 자체가 안 보이고, 한 달 AI 한도에 닿았을 때만 그 한 줄(ai-cap-line.js).
// '연락 없는 조직' 기준 [2주|3주|4주|6주|끄기]는 조직 보고 화면 ⋯로 옮겼다(suborganizations.js, 값은 그대로 view_prefs.quiet_weeks).
// - 마지막 수집 시각: collection-status.js가 유일한 renderer. AI 비용: ai-usage-line.js.
// - S70-29(2026-11-25 사용자 '다 없애 1회용 기능'): '예전 자료 글자 읽기 끝남' 줄과 그 야간 작업은 일회용이라 지웠다.
// 이 파일은 장 안 자리와 첫 화면 줄이 있을지만 정한다(줄이 하나도 없으면 첫 화면 '사용 현황' 줄이 없다). 읽기·쓰기 경로는 각 모듈 그대로(새 저장소·새 요청 없음).
import {mountCollectionStatus} from './collection-status.js';
import {mountAiUsageLine} from './ai-usage-line.js';
import {mountAiCapLine} from './ai-cap-line.js';

export function mountProfileStatus(panel, {onSummary} = {}) {
  if (!panel || panel.dataset.psStatusMounted) return null;
  panel.dataset.psStatusMounted = '1';
  // S71-36: 장 제목('사용 현황')은 장 머리가 그린다. 보일 줄이 없으면 첫 화면 줄도 없다(onSummary show:false).
  panel.innerHTML = '<section class="home-collect" data-ps-collect aria-labelledby="home-collect-title" hidden></section>'
    + '<section class="home-ai-usage" data-ps-ai-usage aria-label="AI 비용" hidden></section>'
    + '<p class="ps-ai-cap" data-ps-ai-cap role="status" hidden></p>';
  const parts = ['[data-ps-collect]', '[data-ps-ai-usage]', '[data-ps-ai-cap]'].map(sel => panel.querySelector(sel));
  const collect = mountCollectionStatus(parts[0], {menu: null});
  const ai = mountAiUsageLine(parts[1], {onPaint: () => sync()});
  const aiCap = mountAiCapLine(parts[2]);
  // 줄이 하나라도 보이면 칸을 보인다(각 줄은 자기 모듈이 그리고 숨긴다).
  // 첫 읽기가 끝나기 전에는 알리지 않는다(주소로 바로 연 '사용 현황' 장이 읽기 전에 닫히지 않게).
  let ready = false;
  function sync() { if (ready) onSummary?.({show: !parts.every(el => !el || el.hidden)}); }
  let run = 0;
  const refresh = () => {
    const mine = ++run;
    const jobs = [collect?.refresh(), ai?.refresh(), aiCap?.refresh()].map(p => Promise.resolve(p).catch(() => {}));
    void Promise.all(jobs).then(() => { if (mine === run) { ready = true; sync(); } });
  };
  refresh();
  return {refresh};
}
