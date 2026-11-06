// FILES-폴드나무목록 ⑥(S51-18): 화면이 '폴드 펼침'으로 칸을 나누기 시작하는 폭 — 공용 판정 한 곳.
// 원인: 펼친 갤럭시 Z 폴드는 기본 화면 크기에서 CSS 폭이 약 673~707px이다(폰 앱 WebView·삼성 인터넷 모두 기기 기본 배율 2.625로 그린다.
//   예: 1812px ÷ 2.625 ≈ 690, 1856px ÷ 2.625 ≈ 707). '화면 크기 작게' 설정이면 800~884px까지 넓어진다.
//   옛 판정 '760px 이하 = 폰'은 이 폭을 폰으로 잡아, 폴드를 펼쳐도 폰 모양(나무만 화면 가득 → 누르면 목록만)이 나왔다.
//   접은 폴드(바깥 화면)와 보통 폰은 세로로 약 344~430px, 큰 폰도 480px 안쪽이라 600px 미만이다.
// 기준: 600px 이상 = 칸 나누기(폴드 펼침·태블릿·PC), 600px 미만 = 폰 한 칸. 앱 틀(하단바·왼쪽 메뉴)의 761px 경계는 그대로다
//   (그 경계는 메뉴 틀을 정하고, 이 경계는 화면 안 칸을 정한다 — TODO-폴드목록상세가 먼저 쓴 600px과 같은 값).
// CSS는 이 값을 불러 쓸 수 없으므로 같은 숫자를 @media (min-width:600px) / (max-width:599px)로 쓴다(tests/screen-width.test.mjs가 맞춰 본다).
export const SPLIT_MIN_WIDTH = 600;
export const SPLIT_QUERY = `(min-width:${SPLIT_MIN_WIDTH}px)`;
export const NARROW_QUERY = `(max-width:${SPLIT_MIN_WIDTH - 1}px)`;
// 폭 숫자 → 칸을 나누는가(화면 없이 시험).
export const splitsAt = width => Number(width) >= SPLIT_MIN_WIDTH;
