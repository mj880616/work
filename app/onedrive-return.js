// JOURNAL-일기원드라이브: 마이크로소프트 로그인 뒤 돌아오는 정적 페이지(등록 주소 .../work/app/onedrive-return.html).
// 코드와 확인값을 주소의 # 뒤로 옮겨 일기 화면으로 보낸다(# 뒤는 서버로 전달되지 않는다). 연결 처리는 로그인된 일기 화면이 한다.
(() => {
  const query = new URLSearchParams(location.search), out = new URLSearchParams();
  const code = query.get('code'), state = query.get('state');
  if (code && state) { out.set('onedrive_code', code); out.set('onedrive_state', state); }
  else out.set('onedrive_error', /^[a-z_]{1,40}$/.test(query.get('error') || '') ? query.get('error') : 'unknown');
  location.replace('./?view=diary#' + out.toString());
})();
