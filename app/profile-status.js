// HOME-업무일지홈(2026-10-30 명진 시안 확정): 옛 홈 칸 화면에만 있던 상태 줄을 내 프로필 맨 아래 '수집·사용량' 칸으로 옮겼다.
// - 마지막 수집 시각: collection-status.js가 유일한 renderer(칸 하나, PC·폰 같은 모양. 옛 폰 홈 경고 줄·메뉴 판 칸은 없앰).
// - 예전 자료 글자 읽기 끝남 한 줄: text-backfill-notice.js 그대로.
// - AI 사용량: ai-usage-line.js 그대로.
// - 홈 '연락 없는 조직' 줄의 기준 [2주|3주|4주|6주|끄기]: 옛 홈 편집에 있던 것. 바꾸면 바로 서버 저장(view_prefs.quiet_weeks).
// 이 파일은 칸 자리와 기준 단추만 그린다. 읽기·쓰기 경로는 각 모듈 그대로(새 저장소·새 요청 없음).
import {mountCollectionStatus} from './collection-status.js';
import {mountTextBackfillNotice} from './text-backfill-notice.js';
import {mountAiUsageLine} from './ai-usage-line.js';
import {viewPrefs} from './view-prefs.js';
import {WEEK_CHOICES, weeksOf} from './org-quiet-model.mjs';

export function mountProfileStatus(panel) {
  if (!panel || panel.dataset.psStatusMounted) return null;
  panel.dataset.psStatusMounted = '1';
  panel.innerHTML = '<h3>수집·사용량</h3>'
    + '<p class="home-text-done" data-ps-text-done role="status" hidden></p>'
    + '<section class="home-collect" data-ps-collect aria-labelledby="home-collect-title" hidden></section>'
    + '<section class="home-ai-usage" data-ps-ai-usage aria-label="AI 사용량" hidden></section>'
    + '<div class="ps-quiet-weeks"><span class="ps-quiet-label" id="psQuietLabel">홈 \'연락 없는 조직\' 기준</span><span class="he-seg" role="group" aria-labelledby="psQuietLabel" data-ps-quiet></span><span class="ps-quiet-note" data-ps-quiet-note role="status" aria-live="polite"></span></div>';
  const collect = mountCollectionStatus(panel.querySelector('[data-ps-collect]'), {menu: null});
  const textDone = mountTextBackfillNotice(panel.querySelector('[data-ps-text-done]'));
  const ai = mountAiUsageLine(panel.querySelector('[data-ps-ai-usage]'));
  const seg = panel.querySelector('[data-ps-quiet]'), note = panel.querySelector('[data-ps-quiet-note]');
  const paintWeeks = () => {
    const now = weeksOf(viewPrefs.get('quiet_weeks'));
    seg.innerHTML = WEEK_CHOICES.map(w => `<button type="button" data-ps-weeks="${w}" aria-pressed="${now === w}">${w ? `${w}주` : '끄기'}</button>`).join('');
  };
  seg.addEventListener('click', event => {
    const b = event.target.closest('[data-ps-weeks]'); if (!b) return;
    const w = Number(b.dataset.psWeeks);
    viewPrefs.set('quiet_weeks', w, {rejectable: true});
    void viewPrefs.flush();
    window.dispatchEvent(new CustomEvent('kptu:quiet-weeks-changed'));
    note.textContent = w ? `${w}주로 바꿨어요.` : '줄을 껐어요.';
    paintWeeks();
    seg.querySelector(`[data-ps-weeks="${w}"]`)?.focus({preventScroll: true});
  });
  window.addEventListener('kptu:view-prefs-ready', paintWeeks);
  window.addEventListener('kptu:view-prefs-rejected', event => {
    if (!event.detail?.paths?.includes('quiet_weeks')) return;
    note.textContent = '서버가 아직 이 기준을 받지 못해 원래대로 되돌렸어요.'; paintWeeks();
    window.dispatchEvent(new CustomEvent('kptu:quiet-weeks-changed'));
  });
  paintWeeks();
  const refresh = () => { collect?.refresh(); textDone?.refresh(); ai?.refresh(); paintWeeks(); };
  refresh();
  return {refresh};
}
