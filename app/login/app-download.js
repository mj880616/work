// APP-앱내려받기버튼(명진 11/15 00:11): 로그인 안 한 채 들어오면 [안드로이드 앱 내려받기]. 받는 주소는 최신 폰 앱 APK(../app-download.mjs가
// 배포 때 정한 ../phone-app.json을 읽음, 없으면 폰 앱 릴리스 목록). 로그인·토큰·개인정보와 상관없는 화면 부분이다.
import {downloadPlan, loadPhoneAppInfo} from '../app-download.mjs';

const box = document.querySelector('[data-login-app]');
const link = box?.querySelector('[data-login-app-link]'), hint = box?.querySelector('[data-login-app-hint]');
const ua = navigator.userAgent || '';
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
