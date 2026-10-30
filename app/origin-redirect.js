// SEC-github.io넘기기: Web2를 mj880616.github.io에서 열면 https://bokdoong.com 같은 경로·같은 ?뒤·같은 #뒤로 넘긴다.
// github.io 출처는 익명 글을 받는 Web1 페이지들과 같은 출처라, 그곳에서는 로그인 토큰을 만들거나 읽지 않게 한다.
// 각 HTML의 <head> 맨 앞에서 동기로 불린다(로그인·토큰 읽기·다른 스크립트보다 먼저). 넘길 때는 남은 문서를 글자로 묶어
// 뒤따르는 스크립트(app.js, 로그인 스크립트 등)가 실행되지 않게 한다(넘어가는 사이 github.io에서 세션을 읽거나 갱신하지 않음).
// 예외: 설치 앱(윈도우 앱 KPTUWindows/·안드로이드 앱 KPTUAndroid/)은 넘기지 않는다. 윈도우 앱은 github.io만 안쪽 주소로 보고
// 다른 주소는 바깥 브라우저로 여는데, 넘기면 앱이 열리자마자 바깥으로 튕긴다. 앱이 새 주소로 옮긴 뒤 이 예외를 지운다(PR 본문 남은 일).
(function(){
  var FROM_HOST='mj880616.github.io';
  var TO_ORIGIN='https://bokdoong.com';
  var APP_PATH='/work/app/';
  var NATIVE_UA=/\bKPTU(?:Windows|Android)\//;
  // 넘길 주소(넘기지 않으면 null). 순수 함수: tests/origin-redirect.test.mjs가 본다.
  function target(href,ua){
    var u;
    try{u=new URL(href)}catch(e){return null}
    if(u.protocol!=='https:'||u.hostname!==FROM_HOST)return null;
    if(u.pathname.indexOf(APP_PATH)!==0)return null;
    if(NATIVE_UA.test(String(ua||'')))return null;
    return TO_ORIGIN+u.pathname+u.search+u.hash;
  }
  window.KPTUOriginRedirect={target:target};
  var next=target(location.href,navigator.userAgent);
  if(!next)return;
  try{location.replace(next)}catch(e){return}
  document.write('<plaintext hidden>');
})();
