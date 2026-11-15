// UI-앱안알림 4·5단계: 알림(폰 알림·맨 위 알림 줄·내 프로필 '최근 알림 7일')을 누르면 그 자리로 화면 안 이동.
// 알림 줄(notice-done.js)과 최근 알림 목록(phone-push-settings.js)이 함께 쓴다. 주소 검사는 phone-push-model.mjs noticePlace.
import {noticePlace} from './phone-push-model.mjs';

/** 화면 안 이동: 그 화면(·옆 칸)으로. */
export function goPlace(open, win = window) {
  const place = noticePlace(open);
  const router = win.KPTURouter;
  if (!place || !router?.go) return false;
  if (router.current !== place.view || place.pane) router.go(place.view, {source:'delegated', ...(place.pane ? {sub:place.pane} : {})});
  return true;
}

