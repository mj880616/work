// S63-09 PC도우미구분(사용자 11/16): PC에서 WORK ON+를 '프로그램처럼' 쓰는 길은 브라우저의 앱 설치(PWA, app/windows-manifest.json)다.
// 크롬·엣지가 설치를 허락하면 보내는 beforeinstallprompt를 이 모듈 하나가 붙잡아 두고, [PC에 앱 설치] 단추가 그것을 연다.
// 붙잡은 것이 없으면(이미 설치됨·브라우저가 아직 안 보냄·지원 안 함) 단추를 누를 때 '주소창 오른쪽 설치 아이콘' 한 줄 안내.
// 로그인 화면(app/login/app-download.js)과 계정 메뉴(app/topbar-actions.js)가 같이 쓴다. 저장하는 것은 없다(메모리에만).
import {isPhoneApp} from './phone-push-model.mjs';
import {word} from './brand/brand.mjs';

export const INSTALL_BUTTON = 'PC에 앱 설치';
export const INSTALL_FALLBACK = word("크롬·엣지 주소창 오른쪽의 설치 아이콘을 눌러 주세요(이미 설치했으면 바탕화면·시작 메뉴의 WORK ON+를 여세요)");

// 단추를 보일지: PC 브라우저에서만. 폰(안드로이드·아이폰)은 폰 앱이 따로 있고, 폰 앱 안·이미 설치한 창(standalone) 안에서는 없음.
export function installPlan({ua = '', standalone = false} = {}) {
  if (isPhoneApp(ua) || standalone) return {kind: 'none'};
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return {kind: 'none'};
  return {kind: 'pc', label: INSTALL_BUTTON, fallback: INSTALL_FALLBACK};
}

let deferred = null;
const waiters = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferred = event;
    for (const fn of waiters) fn(true);
  });
  window.addEventListener('appinstalled', () => { deferred = null; for (const fn of waiters) fn(false); });
}

export const isStandalone = () => typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
export const canPrompt = () => !!deferred;
export function onPromptChange(fn) { waiters.add(fn); return () => waiters.delete(fn); }

// 단추를 눌렀을 때: 붙잡아 둔 설치 창이 있으면 열고 'prompted', 없으면 'fallback'(부르는 쪽이 안내 한 줄을 보인다).
export async function runInstall() {
  const event = deferred;
  if (!event) return 'fallback';
  deferred = null;
  try { await event.prompt(); await event.userChoice; } catch { return 'fallback'; }
  return 'prompted';
}
