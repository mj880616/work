// UI-앱안알림 4·5단계: 알림(폰 알림·맨 위 알림 줄·내 프로필 '최근 알림 7일')을 누르면 그 자리로 화면 안 이동.
// 알림 줄(notice-done.js)과 최근 알림 목록(phone-push-settings.js)이 함께 쓴다. 주소 검사는 phone-push-model.mjs noticePlace.
import {noticePlace} from './phone-push-model.mjs';

/** 화면 안 이동: 다음 주 준비는 홈 [주간 정리]로, 그 밖에는 그 화면(·옆 칸)으로. */
export function goPlace(open, win = window) {
  const place = noticePlace(open);
  const router = win.KPTURouter;
  if (!place || !router?.go) return false;
  if (router.current !== place.view || place.pane) router.go(place.view, {source:'delegated', ...(place.pane ? {sub:place.pane} : {})});
  if (place.mode === 'week') {
    // 홈(업무일지)의 [주간 정리] 단추가 보기 전환의 주인이다(journal.js setMode). 화면이 그려지면 그 단추를 한 번 누른다.
    let tries = 0;
    const press = () => {
      const button = win.document.querySelector('#homeView button[data-journal-mode="week"]');
      if (button && router.current === 'home') { if (button.getAttribute('aria-pressed') !== 'true') button.click(); return; }
      if (++tries < 120) win.requestAnimationFrame(press);
    };
    press();
  }
  return true;
}

