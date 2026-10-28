// JOURNAL-일기원드라이브: 마이크로소프트 로그인 뒤 돌아오는 정적 페이지(등록 주소 .../work/app/onedrive-return.html).
// 코드와 확인값을 주소의 # 뒤로 옮겨 연결을 시작한 화면으로 보낸다(# 뒤는 서버로 전달되지 않는다). 연결 처리는 로그인된 그 화면이 한다.
// PHOTO-사진메뉴 2차(명진 결정 5): 사진 메뉴에서 연결했으면 state 끝에 '~photos'가 붙어 온다(diary-onedrive.js odAuthUrlBack).
// 그 꼬리만 떼어 사진 메뉴로 보내고, 서버가 확인하는 state는 원래 그대로 넘긴다. 꼬리가 없거나 모르는 값이면 예전처럼 일기로.
(() => {
  const query = new URLSearchParams(location.search), out = new URLSearchParams();
  const code = query.get('code');
  let state = query.get('state'), view = 'diary';
  const tail = state ? /^([^~]+)~([a-z]{1,20})$/.exec(state) : null;
  if (tail) { state = tail[1]; if (tail[2] === 'photos') view = 'photos'; }
  if (code && state) { out.set('onedrive_code', code); out.set('onedrive_state', state); }
  else out.set('onedrive_error', /^[a-z_]{1,40}$/.test(query.get('error') || '') ? query.get('error') : 'unknown');
  location.replace('./?view=' + view + '#' + out.toString());
})();
