// UI-앱안알림 2단계: 바깥 연결(Google·원드라이브)이 끊겼는지의 한 곳. 새 서버 호출은 없다 — 이미 하던 읽기가 결과를 알려 준다.
// - google: google-tasks.js의 할 일 읽기(overview)가 needs_reconnect면 끊김, 권한이 확인되면 풀림.
// - onedrive: diary-onedrive.js의 원드라이브 호출이 onedrive_auth_expired면 끊김, 다른 호출이 성공하면 풀림.
// 값은 이 탭 메모리에만 있다(기기 저장 없음). 맨 위 알림 줄(notice-lines.js)이 구독해 '연결 끊김' 줄을 그린다.
export const LINK_SOURCES = Object.freeze(['google', 'onedrive']);
const state = new Map(), listeners = new Set();
export function reportLink(source, broken) {
  if (!LINK_SOURCES.includes(source)) return;
  const next = broken === true;
  if ((state.get(source) === true) === next) return;
  state.set(source, next);
  for (const fn of listeners) { try { fn(source, next); } catch {} }
}
export const brokenLinks = () => LINK_SOURCES.filter(source => state.get(source) === true);
export function onLinkState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// 로그인한 사람이 바뀌면 앞사람의 연결 상태를 버린다.
export function resetLinks() { const was = brokenLinks(); state.clear(); for (const source of was) for (const fn of listeners) { try { fn(source, false); } catch {} } }
