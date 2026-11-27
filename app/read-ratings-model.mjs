// HOME-읽을거리평가(사용자 2026-11-28 07:04 "홈화면 읽을 거리 왼쪽 스와이프 할 땐 엄지척 엄지다운 버튼 추가 학습해서 추후 추천에 반영"): 셈만(화면 없음, 단위 시험 대상).
// 평가 값: 1 = 좋아요, -1 = 별로예요, 0 = 없음. 같은 단추를 다시 누르면 취소(0), 다른 단추는 바꾸기.
export const LIKE = 1, DISLIKE = -1;
export const LIKE_LABEL = '좋아요', DISLIKE_LABEL = '별로예요';
export const RATE_KEYS = Object.freeze({like: LIKE, dislike: DISLIKE});
export const ratingKey = (type, id) => `${type}:${String(id || '').toLowerCase()}`;
export const cleanRating = v => (v === LIKE || v === DISLIKE ? v : 0);
// 지금 값 + 누른 단추 → 새 값.
export const nextRating = (now, pressed) => (cleanRating(pressed) === 0 ? 0 : cleanRating(now) === pressed ? 0 : pressed);
// 누른 뒤 작은 알림 한 줄.
export const ratedText = (next, pressed) => (next === LIKE ? '좋아요 — 다음 추천에 반영해요' : next === DISLIKE ? '별로예요 — 비슷한 글은 덜 추천해요' : pressed === LIKE ? '좋아요를 취소했어요' : '별로예요를 취소했어요');
// 밀기 칸(위 👍·아래 👎를 포갠 한 칸, row-swipe.js isPair). 누른 상태는 aria-pressed.
export const ratePair = now => ({key: 'rate', label: '평가', pair: [
  {key: 'like', label: LIKE_LABEL, icon: 'thumb-up', tone: 'muted', pressed: cleanRating(now) === LIKE},
  {key: 'dislike', label: DISLIKE_LABEL, icon: 'thumb-down', tone: 'muted', pressed: cleanRating(now) === DISLIKE},
]});
// 줄 ⋯·우클릭 메뉴 항목(PC). 누른 상태는 글자 끝 ✓('저장됨 ✓'과 같은 꼴).
export const rateMenuItems = now => [
  {id: 'like', label: cleanRating(now) === LIKE ? `${LIKE_LABEL} ✓` : LIKE_LABEL},
  {id: 'dislike', label: cleanRating(now) === DISLIKE ? `${DISLIKE_LABEL} ✓` : DISLIKE_LABEL},
];
