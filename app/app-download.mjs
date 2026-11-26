// APP-앱내려받기버튼(사용자 지시 11/15 00:11): 로그인 화면 [안드로이드 앱 내려받기]와 로그인 뒤 메뉴 '앱 내려받기'가 같이 쓰는 한 곳.
// 받을 주소는 Pages 배포 때 scripts/phone-app-latest.mjs가 GitHub 공개 릴리스에서 고른 최신 폰 앱(phone-app-v<버전>의 web2-phone-<버전>.apk)을
// 같은 주소의 app/phone-app.json 한 파일에 적어 둔 것이다. 화면은 이 파일만 읽고 GitHub API를 부르지 않는다(바구니 PC 릴리스와 섞이지 않음).
// 파일이 없거나 읽지 못하면 폰 앱 릴리스 목록 주소로 연다(거기서 맨 위 web2-phone-*.apk). 로그인·토큰·개인정보와 상관없다.
import {isPhoneApp} from './phone-push-model.mjs';
import {word} from './brand/brand.mjs';

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

// BASKET-노조플러스업로드: 윈도우 PC 보조 프로그램(WORK ON+ 파일 올리기). 받을 주소는 배포 때 같은 스크립트가 고른 최신 PC 설치 파일
// (basket-pc-v<버전>의 BasketDropApp-win-Setup.exe)을 적은 같은 주소의 app/pc-app.json. 폰 앱 파일과 섞이지 않는다.
// S63-09 PC도우미구분(사용자 11/16): 이 프로그램을 WORK ON+ 자체로 아는 사람이 있어, 이름을 'WORK ON+ 파일 올리기'(도우미)로 하고
// 받는 곳마다 "WORK ON+는 브라우저에서 쓴다" 한 줄을 먼저 보인다(PC_BROWSER_LINE). PC에서 WORK ON+를 바탕화면에 두는 길은 브라우저 '앱 설치'(pwa-install.mjs).
export const PC_RELEASES_PAGE = `https://github.com/${PHONE_REPO}/releases?q=basket-pc-v&expanded=true`;
export const PC_SETUP_NAME = 'BasketDropApp-win-Setup.exe';
// S68-21: 프로그램 자체 이름(basket-pc TrayStatus.Name)과 같은 글자 — 모두에게 같다.
export const PC_HELPER_NAME = 'WORK ON+ 파일 올리기';
export const PC_BUTTON = 'PC 파일 올리기 도우미 내려받기';
export const PC_BROWSER_LINE = word("WORK ON+는 크롬·엣지 같은 인터넷 브라우저에서 씁니다. PC에서는 브라우저로 열거나 크롬 '앱 설치'로 바탕화면에 두세요.");
export const PC_DESC = word('도우미는 WORK ON+ 자체가 아니에요. WORK ON+ [파일]에서 이 PC 폴더를 보고, 클라우드와 파일을 복사·옮기게 돕는 작은 프로그램이에요');
export const PC_WARN = "처음 실행 때 윈도우 경고가 뜨면 '추가 정보 → 실행'을 눌러 주세요";
export const PC_OTHER_HINT = '윈도우 PC에서 열면 PC 파일 올리기 도우미를 받을 수 있어요';

export function setupFromInfo(info) {
  const version = typeof info?.version === 'string' && VERSION.test(info.version) ? info.version : '';
  if (!version) return null;
  const url = `https://github.com/${PHONE_REPO}/releases/download/basket-pc-v${version}/${PC_SETUP_NAME}`;
  return info.url === url ? {version, url} : null;
}

export const isWindowsPc = ua => /Windows NT/i.test(ua) && !/Android|Windows Phone/i.test(ua);

// app = 폰 앱 안(없음), pc = 윈도우 PC 브라우저(브라우저 안내 + 도우미 내려받기 + 설명·경고 안내), other = 그 밖(안내 한 줄).
export function pcPlan({ua = '', info = null} = {}) {
  if (isPhoneApp(ua)) return {kind: 'app'};
  if (!isWindowsPc(ua)) return {kind: 'other', hint: PC_OTHER_HINT};
  const setup = setupFromInfo(info);
  return {kind: 'pc', url: setup?.url || PC_RELEASES_PAGE, version: setup?.version || '', browser: PC_BROWSER_LINE, hint: PC_DESC, warn: PC_WARN};
}

// 같은 주소의 pc-app.json(배포물에만 있음). 못 읽으면 null — 그때는 PC 릴리스 목록 주소.
export async function loadPcAppInfo(fetchImpl = globalThis.fetch, base = import.meta.url) {
  try {
    const res = await fetchImpl(new URL('./pc-app.json', base).href, {cache: 'no-cache', credentials: 'omit'});
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
