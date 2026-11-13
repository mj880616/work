// HOME-업무일지홈(2026-10-30 명진 시안 확정): 옛 홈 칸 화면에만 있던 상태 줄을 내 프로필 맨 아래 '수집·사용량' 칸으로 옮겼다.
// - 마지막 수집 시각: collection-status.js가 유일한 renderer(칸 하나, PC·폰 같은 모양. 옛 폰 홈 경고 줄·메뉴 판 칸은 없앰).
// - 예전 자료 글자 읽기 끝남 한 줄: text-backfill-notice.js 그대로.
// - AI 사용량: ai-usage-line.js 그대로. 사람별 한도 한 줄(AI-사람별한도, 운영자는 안 보임): ai-cap-line.js.
// - 홈 '연락 없는 조직' 줄의 기준 [2주|3주|4주|6주|끄기]: 옛 홈 편집에 있던 것. 바꾸면 바로 서버 저장(view_prefs.quiet_weeks).
// 이 파일은 칸 자리와 기준 단추만 그린다. 읽기·쓰기 경로는 각 모듈 그대로(새 저장소·새 요청 없음).
import {mountCollectionStatus} from './collection-status.js';
import {mountTextBackfillNotice} from './text-backfill-notice.js';
import {mountAiUsageLine} from './ai-usage-line.js';
import {mountAiCapLine} from './ai-cap-line.js';
import {viewPrefs} from './view-prefs.js';
import {WEEK_CHOICES, weeksOf} from './org-quiet-model.mjs';
import {myFeaturesOrNull, collectsFeeds} from './my-features.js';

// MULTI-처음쓰는사람 ⑤(docs/design/new-user-start.md 2-5): 수집 상태·AI 전체 사용량·'연락 없는 조직' 기준은 통화·텔레그램 수집이 있는 운영자 칸이다.
// 서버 운영자 기능 답(app_my_features)에 calls·telegram이 둘 다 없으면 그 줄들을 그리지 않고, 칸 이름을 'AI 사용'으로 해 이번 달 한도 한 줄만 둔다.
// 답을 못 받으면(null) 지금처럼 모두 그린다(운영자 화면이 빠지지 않게).

export function mountProfileStatus(panel, {rt = window.KPTURuntime} = {}) {
  if (!panel || panel.dataset.psStatusMounted) return null;
  panel.dataset.psStatusMounted = '1';
  // 운영자 기능 답이 오기 전에는 칸을 비워 둔다(줄이 생겼다 사라지지 않게). 운영자 계정은 답이 오면 지금 모양 그대로 그린다.
  const show = on => panel.classList.toggle('hidden', !on); // 칸(.panel)은 공용 .hidden 클래스로 감춘다(hidden 속성은 .panel 표시 규칙에 진다)
  show(false);
  let inner = null;
  const ready = Promise.resolve(rt?.api ? myFeaturesOrNull(rt) : null).catch(() => null).then(features => {
    if (collectsFeeds(features)) { show(true); inner = mountFull(panel); } else inner = mountCapOnly(panel, show);
  });
  return {refresh: () => { void ready.then(() => inner?.refresh()); }};
}
function mountCapOnly(panel, show) {
  // 제목은 'AI 사용' — 줄이 '이번 달 AI 사용 ○원 / 한도 ○원'이라 같은 말을 두 번 쓰지 않는다.
  panel.innerHTML = '<h3>AI 사용</h3><p class="ps-ai-cap" data-ps-ai-cap role="status" hidden></p>';
  panel.setAttribute('aria-label', 'AI 사용');
  const line = panel.querySelector('[data-ps-ai-cap]'), aiCap = mountAiCapLine(line);
  // 한도 줄을 못 읽으면(옛 서버 등) 빈 제목만 남지 않게 칸째 그리지 않는다. 이 칸의 유일한 renderer라 줄 상태를 따라간다.
  const refresh = () => Promise.resolve(aiCap?.refresh()).then(() => show(!line.hidden));
  void refresh();
  return {refresh};
}
function mountFull(panel) {
  panel.innerHTML = '<h3>수집·사용량</h3>'
    + '<p class="home-text-done" data-ps-text-done role="status" hidden></p>'
    + '<section class="home-collect" data-ps-collect aria-labelledby="home-collect-title" hidden></section>'
    + '<section class="home-ai-usage" data-ps-ai-usage aria-label="AI 사용량" hidden></section>'
    + '<p class="ps-ai-cap" data-ps-ai-cap role="status" hidden></p>'
    + '<div class="ps-quiet-weeks"><span class="ps-quiet-label" id="psQuietLabel">홈 \'연락 없는 조직\' 기준</span><span class="he-seg" role="group" aria-labelledby="psQuietLabel" data-ps-quiet></span><span class="ps-quiet-note" data-ps-quiet-note role="status" aria-live="polite"></span></div>';
  const collect = mountCollectionStatus(panel.querySelector('[data-ps-collect]'), {menu: null});
  const textDone = mountTextBackfillNotice(panel.querySelector('[data-ps-text-done]'));
  const ai = mountAiUsageLine(panel.querySelector('[data-ps-ai-usage]'));
  const aiCap = mountAiCapLine(panel.querySelector('[data-ps-ai-cap]'));
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
    note.textContent = '서버가 아직 이 기준을 받지 못해 이전 값으로 되돌렸어요.'; paintWeeks();
    window.dispatchEvent(new CustomEvent('kptu:quiet-weeks-changed'));
  });
  paintWeeks();
  const refresh = () => { collect?.refresh(); textDone?.refresh(); ai?.refresh(); aiCap?.refresh(); paintWeeks(); };
  refresh();
  return {refresh};
}
