// S69-20 ①(명진 11/24 08:44 "자료실에 자료들이 어디에 업로드되고 있는 거야? 왜 표시가 없지?"):
// 자료실 목록 위 작은 한 줄 '구글 드라이브 · 웹2 › 자료실  열기 ↗'. 이 줄의 주인은 이 모듈 하나(#libraryDriveLine)다.
// 경로·주소는 서버(workspace-drive GET ?action=drive-place)가 서버에 적어 둔 자료실 폴더 id로 드라이브의 지금 이름을 읽어 준다(화면은 고르지 않음).
// 자료를 올린 적이 없거나 드라이브 연결이 없거나 읽기가 실패하면 줄을 그리지 않는다(안내문을 따로 두지 않음).
const DRIVE_FOLDER_URL = /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]{10,200}$/;

/** 서버 답 place → 그릴 값 {path:[이름…], url} 또는 null(모양이 어긋나면 그리지 않음). */
export function cleanPlace(place) {
  if (!place || typeof place !== 'object' || typeof place.url !== 'string' || !DRIVE_FOLDER_URL.test(place.url)) return null;
  const path = Array.isArray(place.path) ? place.path.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 120)).slice(0, 6) : [];
  return path.length ? {path, url: place.url} : null;
}

/** 한 줄 HTML. esc: 화면 공용 글자 막기. */
export function driveLineHtml(place, esc) {
  const p = cleanPlace(place);
  if (!p) return '';
  const where = p.path.map(esc).join(' › ');
  return `<span class="lu-drive-where">구글 드라이브 · ${where}</span><a class="lu-drive-open" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="구글 드라이브에서 ${where} 열기">열기 ↗</a>`;
}

export function mountLibraryDriveLine({api, esc, el = () => document.querySelector('#libraryDriveLine')}) {
  let place = null, loading = null, owner = 0;
  function render() {
    const box = el();
    if (!box) return;
    const html = driveLineHtml(place, esc);
    if (box.innerHTML !== html) box.innerHTML = html;
    box.hidden = !html;
  }
  // 자료실에 들어올 때마다 다시 묻는다(드라이브에서 이름을 바꿨으면 그 이름). 겹친 요청은 마지막 것만 그린다.
  function refresh() {
    const mine = ++owner;
    loading = api('/functions/v1/workspace-drive?action=drive-place', {method: 'GET'})
      .then(d => { if (mine === owner) place = cleanPlace(d?.place); })
      .catch(() => { if (mine === owner) place = null; })
      .finally(() => { if (mine === owner) { loading = null; render(); } });
    return loading;
  }
  return {refresh, render, place: () => place};
}
