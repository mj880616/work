// APP-앱내려받기버튼(사용자 11/15 00:11): 로그인 안 한 채 들어오면 [안드로이드 앱 내려받기]. 받는 주소는 최신 폰 앱 APK(../app-download.mjs가
// 배포 때 정한 ../phone-app.json을 읽음, 없으면 폰 앱 릴리스 목록). 로그인·토큰·개인정보와 상관없는 화면 부분이다.
// BASKET-노조플러스업로드(사용자 11/15 00:50): 같은 자리에 윈도우 PC 보조 프로그램 내려받기 + 설명·경고 안내. 받는 주소는 ../pc-app.json의
// 최신 PC 설치 파일(없으면 PC 릴리스 목록). 윈도우 PC 브라우저에서는 PC 줄을 위로, 폰에서는 안드로이드 줄이 위.
// S63-09 PC도우미구분(사용자 11/16): PC 브라우저에서는 맨 위에 "WORK ON+는 브라우저에서 씁니다" 한 줄 + [PC에 앱 설치](브라우저 앱 설치),
// 그 아래 윈도우만 [PC 파일 올리기 도우미 내려받기](WORK ON+ 자체가 아닌 보조 프로그램이라는 설명·경고 포함).
import {downloadPlan, loadPhoneAppInfo, pcPlan, loadPcAppInfo, PC_BUTTON, PC_BROWSER_LINE} from '../app-download.mjs';
import {installPlan, isStandalone, runInstall} from '../pwa-install.mjs';

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

const pwaBox = document.querySelector('[data-login-pwa]');
const install = installPlan({ua, standalone: isStandalone()});
if (pwaBox && install.kind === 'pc') {
  pwaBox.querySelector('[data-login-pc-browser]').textContent = PC_BROWSER_LINE;
  const btn = pwaBox.querySelector('[data-login-install]'), tip = pwaBox.querySelector('[data-login-install-hint]');
  btn.textContent = install.label;
  btn.addEventListener('click', async () => {
    if (await runInstall() === 'fallback') { tip.textContent = install.fallback; tip.hidden = false; }
  });
  if (box) box.before(pwaBox);
  pwaBox.hidden = false;
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
    pcLink.textContent = PC_BUTTON;
    void loadPcAppInfo().then(info => { const plan = pcPlan({ua, info}); pcLink.href = plan.url; if (plan.version) pcLink.textContent = `${PC_BUTTON} (${plan.version})`; });
  }
  pcBox.hidden = false;
}
