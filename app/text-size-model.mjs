// S68-33 READ-글자크기(사용자 11/23 02:30 "+ - 버튼 텍스트 크기"): 글 보기 본문 글자 크기 단계의 뜻(화면 없음, 시험 가능).
// 읽을 거리 글 보기와 News 글 상세가 같은 단계·같은 서버 값(view_prefs.news_font)을 쓴다. 단추·저장은 text-size.js 한 곳.
// 단계는 다섯: 기본(m) 아래 하나(s), 위 셋(l·xl·xxl). 배율은 각 화면 본문의 기본 글자 크기에 곱한다(News 16px → 14·16·19·22·25px).
// s·m·l은 앞 판(News [가 가 가] 세 단계)과 같은 크기라 이미 고른 값은 그대로 보인다.
export const TEXT_SIZES = Object.freeze(['s', 'm', 'l', 'xl', 'xxl']);
export const DEFAULT_TEXT_SIZE = 'm';
export const TEXT_SCALES = Object.freeze({s: 0.875, m: 1, l: 1.1875, xl: 1.375, xxl: 1.5625});
export const keepTextSize = v => (TEXT_SIZES.includes(v) ? v : DEFAULT_TEXT_SIZE);
// dir: +1 한 단계 크게, -1 한 단계 작게. 끝 단계에서는 그대로.
export function stepTextSize(v, dir) {
  const at = TEXT_SIZES.indexOf(keepTextSize(v));
  return TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, at + (dir > 0 ? 1 : -1)))];
}
export const canStep = (v, dir) => stepTextSize(v, dir) !== keepTextSize(v);
export const textScale = v => TEXT_SCALES[keepTextSize(v)];
