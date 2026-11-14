// APP-앱내려받기버튼(명진 지시 11/15 00:11): 로그인 화면 [안드로이드 앱 내려받기]와 로그인 뒤 메뉴 '앱 내려받기'가 같이 쓰는 한 곳.
// 받을 주소는 Pages 배포 때 scripts/phone-app-latest.mjs가 GitHub 공개 릴리스에서 고른 최신 폰 앱(phone-app-v<버전>의 web2-phone-<버전>.apk)을
// 같은 주소의 app/phone-app.json 한 파일에 적어 둔 것이다. 화면은 이 파일만 읽고 GitHub API를 부르지 않는다(바구니 PC 릴리스와 섞이지 않음).
// 파일이 없거나 읽지 못하면 폰 앱 릴리스 목록 주소로 연다(거기서 맨 위 web2-phone-*.apk). 로그인·토큰·개인정보와 상관없다.
import {isPhoneApp} from './phone-push-model.mjs';

export const PHONE_REPO = 'mj880616/work';
export const RELEASES_PAGE = `https://github.com/${PHONE_REPO}/releases?q=phone-app-v&expanded=true`;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export const INSTALL_HINT = "받은 뒤 '알 수 없는 앱 설치 허용'을 한 번 켜야 해요";
export const OTHER_HINT = '안드로이드 폰에서 열면 앱을 받을 수 있어요';

// phone-app.json 값 → 믿을 수 있는 {version, url}. 주소는 받은 값을 그대로 쓰지 않고 버전으로 다시 만든다(같은 저장소·같은 태그·같은 파일 이름만).
export function apkFromInfo(info) {
  const version = typeof info?.version === 'string' && VERSION.test(info.version) ? info.version : '';
  if (!version) return null;
  const url = `https://github.com/${PHONE_REPO}/releases/download/phone-app-v${version}/web2-phone-${version}.apk`;
  return info.url === url ? {version, url} : null;
}

// 어떤 기기에서 무엇을 보이나: app = 폰 앱 안(앱이 스스로 업데이트하므로 내려받기 없음), android = 안드로이드 폰 브라우저(내려받기 버튼),
// other = PC·아이폰(버튼 대신 '안드로이드 폰에서 열면…' 한 줄).
export function downloadPlan({ua = '', info = null} = {}) {
  if (isPhoneApp(ua)) return {kind: 'app'};
  if (!/Android/i.test(ua)) return {kind: 'other', hint: OTHER_HINT};
  const apk = apkFromInfo(info);
  return {kind: 'android', url: apk?.url || RELEASES_PAGE, version: apk?.version || '', hint: INSTALL_HINT};
}

// 같은 주소의 phone-app.json(배포물에만 있음). 못 읽으면 null — 그때는 릴리스 목록 주소.
export async function loadPhoneAppInfo(fetchImpl = globalThis.fetch, base = import.meta.url) {
  try {
    const res = await fetchImpl(new URL('./phone-app.json', base).href, {cache: 'no-cache', credentials: 'omit'});
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
