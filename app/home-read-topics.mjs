// HOME-읽을만한글넓힘(사용자 2026-11-28: 아침 메일 '오늘 읽을 글' 대신 홈 '읽을 만한 글'로): 홈 '읽을 만한 글'이 쓰는 기본 관심 주제 이름.
// 고르기는 서버(ai-assist home_day_picks)가 한다 — 서버 사본 supabase/functions/ai-assist/home-day-picks.ts DEFAULT_READ_TOPICS의 이름과 같아야 한다(시험이 본다).
// 관심 주제의 저장은 News '관심 주제'와 같은 서버 표 app_now_interests 하나다(새 저장소 없음):
//   쓸 주제 = 확정한 주제 + 아래 기본 주제(그 사람이 [빼기]해 'dropped' 줄이 있는 것 제외). 기본 주제를 빼거나 고치면 그 표에 줄이 생긴다.
// 이 이름들은 '읽을 만한 글' 칸 ⋯ [관심 주제] 창에서만 보인다(그 칸은 News 기능을 켠 계정에만 있다).
export const DEFAULT_READ_TOPIC_NAMES = Object.freeze([
  '공공기관 정책', '철도·공공교통', '노동', '한국 정치·정책', '국제 정세·정치경제', '역사', '아스날', 'AI 코딩', '해외축구 전술',
]);
