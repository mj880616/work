// APP-앱내려받기버튼(명진 11/15 00:11): 로그인 안 한 채 들어오면 [안드로이드 앱 내려받기]. 받는 주소는 최신 폰 앱 APK(../app-download.mjs가
// 배포 때 정한 ../phone-app.json을 읽음, 없으면 폰 앱 릴리스 목록). 로그인·토큰·개인정보와 상관없는 화면 부분이다.
// BASKET-노조플러스업로드(명진 11/15 00:50): 같은 자리에 [윈도우 PC 프로그램 내려받기](노조+ 업로드) + 설명·경고 안내. 받는 주소는 ../pc-app.json의
// 최신 PC 설치 파일(없으면 PC 릴리스 목록). 윈도우 PC 브라우저에서는 PC 줄을 위로, 폰에서는 안드로이드 줄이 위.
import {downloadPlan, loadPhoneAppInfo, pcPlan, loadPcAppInfo} from '../app-download.mjs';

const ua = navigator.userAgent || '';
const box = document.querySelector('[data-login-app]');
const link = box?.querySelector('[data-login-app-link]'), hint = box?.querySelector('[data-login-app-hint]');
const first = downloadPlan({ua});
if (box && link && hint && first.kind !== 'app') {
  hint.textContent = first.hint;
  if (first.kind === 'other') link.remove();
  else {
    link.href = first.url;
    void loadPhoneAppInfo().then(info => { const plan = downloadPlan({ua, info}); link.href = plan.url; if (plan.version) link.textContent = `안드로이드 앱 내려받기 (${plan.version})`; });
  }
  box.hidden = false;
}

const pcBox = document.querySelector('[data-login-pc]');
const pcLink = pcBox?.querySelector('[data-login-pc-link]'), pcHint = pcBox?.querySelector('[data-login-pc-hint]'), pcWarn = pcBox?.querySelector('[data-login-pc-warn]');
const pcFirst = pcPlan({ua});
if (pcBox && pcLink && pcHint && pcWarn && pcFirst.kind !== 'app') {
  pcHint.textContent = pcFirst.hint;
  if (pcFirst.kind === 'other') pcLink.remove();
  else {
    pcLink.href = pcFirst.url;
    pcWarn.textContent = pcFirst.warn;
    pcWarn.hidden = false;
    if (box) box.before(pcBox);
    void loadPcAppInfo().then(info => { const plan = pcPlan({ua, info}); pcLink.href = plan.url; if (plan.version) pcLink.textContent = `윈도우 PC 프로그램 내려받기 (${plan.version})`; });
  }
  pcBox.hidden = false;
}
