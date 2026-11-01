// UI-앱안알림 3단계(docs/design/in-app-notices.md 5절, 명진 결정 A4): 다른 화면에서도 '나한테 온 요청'이 있음을 알리는 메뉴 '홈' 표시의 상태 주인 하나.
// 폰(760px 이하) 하단바 '홈' 그림 오른쪽 위 작은 점(숫자 없음), 폴드 펼침·PC 왼쪽 메뉴 '홈' 옆 옅은 숫자(배지 아님). 1건 이상일 때만.
// 숫자는 새로 읽지 않는다: 홈 요약 줄(home-summary.js)과 정리함 '챙길 것' 목록(inbox-todos.js)이 이미 센 값을 알려 준다(같은 기준 inbox-count.js openAsks).
// 화면에는 #appView의 data-home-asks·--kptu-home-asks 두 값만 둔다. 메뉴 버튼은 그 주인(index.html·menu-layout.js)이 그리고, 모양은 CSS(notice-bar.css)가 이 값을 읽어 그린다.
// 기기 저장 없음(이 탭 메모리). 로그인한 사람이 바뀌면 지운다.
let count = 0;
function paint() {
  const app = document.getElementById('appView');
  if (!app) return;
  if (count > 0) {
    app.dataset.homeAsks = String(count);
    app.style.setProperty('--kptu-home-asks', `"${count > 99 ? '99+' : count}"`);
  } else {
    delete app.dataset.homeAsks;
    app.style.removeProperty('--kptu-home-asks');
  }
}
// n: 0 이상 정수 = 지금 센 값, 그 밖(모름) = 표시를 내린다(틀린 점을 남기지 않음).
export function setHomeAsks(n) {
  const next = Number.isInteger(n) && n > 0 ? n : 0;
  if (next === count) return;
  count = next; paint();
}
export const homeAsks = () => count;
if (typeof window !== 'undefined') window.addEventListener('kptu:session-changed', () => setHomeAsks(0));
