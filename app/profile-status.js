// HOME-업무일지홈(2026-10-30 명진 시안 확정): 옛 홈 칸 화면에만 있던 상태 줄을 내 프로필 맨 아래 칸으로 옮겼다.
// MULTI-다른담당자맞춤 ⑥(명진 11/13 15:30): 칸 이름 '사용 현황'. 마지막 수집 시각·글자 읽기·AI 사용량 줄은 서버 운영자 기능이 있는
// 작업공간만(collection-status.js isOperator). 다른 사람에게는 이 칸 자체가 안 보이고, 한 달 AI 한도에 닿았을 때만 그 한 줄(ai-cap-line.js).
// 홈 '연락 없는 조직' 기준 [2주|3주|4주|6주|끄기]는 조직 보고 화면 ⋯로 옮겼다(suborganizations.js, 값은 그대로 view_prefs.quiet_weeks).
// - 마지막 수집 시각: collection-status.js가 유일한 renderer. 예전 자료 글자 읽기 끝남: text-backfill-notice.js. AI 사용량: ai-usage-line.js.
// 이 파일은 칸 자리와 칸 전체 보이기만 정한다(줄이 하나도 없으면 칸을 숨김). 읽기·쓰기 경로는 각 모듈 그대로(새 저장소·새 요청 없음).
import {mountCollectionStatus} from './collection-status.js';
import {mountTextBackfillNotice} from './text-backfill-notice.js';
import {mountAiUsageLine} from './ai-usage-line.js';
import {mountAiCapLine} from './ai-cap-line.js';

export function mountProfileStatus(panel) {
  if (!panel || panel.dataset.psStatusMounted) return null;
  panel.dataset.psStatusMounted = '1';
  panel.hidden = true;
  panel.innerHTML = '<h3>사용 현황</h3>'
    + '<p class="home-text-done" data-ps-text-done role="status" hidden></p>'
    + '<section class="home-collect" data-ps-collect aria-labelledby="home-collect-title" hidden></section>'
    + '<section class="home-ai-usage" data-ps-ai-usage aria-label="AI 사용량" hidden></section>'
    + '<p class="ps-ai-cap" data-ps-ai-cap role="status" hidden></p>';
  const parts = ['[data-ps-text-done]', '[data-ps-collect]', '[data-ps-ai-usage]', '[data-ps-ai-cap]'].map(sel => panel.querySelector(sel));
  const collect = mountCollectionStatus(parts[1], {menu: null});
  const textDone = mountTextBackfillNotice(parts[0]);
  const ai = mountAiUsageLine(parts[2], {onPaint: () => sync()});
  const aiCap = mountAiCapLine(parts[3]);
  // 줄이 하나라도 보이면 칸을 보인다(각 줄은 자기 모듈이 그리고 숨긴다).
  function sync() { panel.hidden = parts.every(el => !el || el.hidden); }
  let run = 0;
  const refresh = () => {
    const mine = ++run;
    const jobs = [collect?.refresh(), textDone?.refresh(), ai?.refresh(), aiCap?.refresh()].map(p => Promise.resolve(p).catch(() => {}));
    void Promise.all(jobs).then(() => { if (mine === run) sync(); });
  };
  refresh();
  return {refresh};
}
