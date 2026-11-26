// S69-20 ①(명진 11/24 08:44 "자료실에 자료들이 어디에 업로드되고 있는 거야? 왜 표시가 없지?"):
// 자료실 목록 위 작은 한 줄 '구글 드라이브 · 웹2 › 자료실  열기 ↗'. 이 줄의 주인은 이 모듈 하나(#libraryDriveLine)다.
// 경로·주소는 서버(workspace-drive GET ?action=drive-place)가 서버에 적어 둔 자료실 폴더 id로 드라이브의 지금 이름을 읽어 준다(화면은 고르지 않음).
// 자료를 올린 적이 없거나 드라이브 연결이 없거나 읽기가 실패하면 줄을 그리지 않는다(안내문을 따로 두지 않음).
// S69-20 ③④⑤: 폴더 안에 들어가면 그 앱 폴더의 짝 드라이브 폴더(서버가 준 pairs)로 연다.
// S70-76 LIB-드라이브늘같게: 옮기기·폴더 만들기·이름 바꾸기·옮기기는 그 자리에서 drive-follow.mjs가 서버에 '드라이브도 같게'를 부탁한다(앱 어디서든).
// 이 줄은 그 결과를 듣고, 드라이브 쪽이 밀렸으면 줄 끝에 '드라이브에 못 옮겼어요 [다시]'. [드라이브 폴더 맞추기]·[드라이브와 맞는지 보기]는 지웠다.
import {followDrive, followFailed, onDriveFollow} from './drive-follow.mjs';
const DRIVE_FOLDER_URL = /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]{10,200}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
export const AUTO_WAIT_MS = 600;
export const FOLLOW_FAILED_NOTE = '드라이브에 못 옮겼어요';
// S69-41(명진 11/24 "이게 자료실에 있는게 좀 뜬금없는느낌임"): [앱 폴더 모으기](S69-22)는 앱 전체 드라이브 폴더 기능이라
// 내 프로필 '구글 드라이브' 칸(drive-folders-panel.js — S70-29에 버튼은 지우고 서버가 저절로)으로 옮겼다. 이 줄에는 저장 위치와 [열기 ↗]만 남는다.
/** 서버 답 place → 그릴 값 {path:[이름…], url, pairs:{앱 폴더 id: 드라이브 폴더 id}} 또는 null(모양이 어긋나면 그리지 않음). */
export function cleanPlace(place) {
  if (!place || typeof place !== 'object' || typeof place.url !== 'string' || !DRIVE_FOLDER_URL.test(place.url)) return null;
  const path = Array.isArray(place.path) ? place.path.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 120)).slice(0, 6) : [];
  const pairs = {};
  if (place.pairs && typeof place.pairs === 'object') for (const [k, v] of Object.entries(place.pairs)) if (typeof v === 'string' && DRIVE_ID.test(v)) pairs[k] = v;
  return path.length ? {path, url: place.url, pairs} : null;
}

/** 지금 자리(폴더 안이면 그 폴더 이름 줄 trail)의 경로·주소. 짝이 없는 폴더면 자료실 폴더로 연다. */
export function placeAt(place, {folderId = null, trail = []} = {}) {
  const p = cleanPlace(place);
  if (!p) return null;
  const names = folderId ? trail.map(x => String(x || '').trim()).filter(Boolean) : [];
  const drive = folderId && p.pairs[folderId];
  return drive ? {path: [...p.path, ...names], url: `https://drive.google.com/drive/folders/${drive}`} : {path: p.path, url: p.url};
}

/** 한 줄 HTML. esc: 화면 공용 글자 막기. note: 줄 끝 작은 상태 글('드라이브 정리 대기' 등). */
export function driveLineHtml(place, esc, at = {}, note = '') {
  const p = placeAt(place, at);
  if (!p) return '';
  const where = p.path.map(esc).join(' › ');
  return `<span class="lu-drive-where">구글 드라이브 · ${where}</span><a class="lu-drive-open" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="구글 드라이브에서 ${where} 열기">열기 ↗</a>`
    + noteHtml(note, esc);
}
/** 줄 끝 작은 상태 글. 밀렸으면 [다시](누르면 서버가 그 자리에서 다시). */
function noteHtml(note, esc, extra = '') {
  if (!note) return '';
  const again = note === FOLLOW_FAILED_NOTE ? `<button type="button" class="row-act lu-drive-retry${extra}" data-lu-drive-retry>다시</button>` : '';
  return `<span class="lu-drive-note${extra}" role="status">${esc(note)}</span>${again}`;
}

/** UI-자료실파일모양(S69-85 ②): 폴더 안 위치 줄 끝에 붙는 작은 [드라이브 ↗] 하나(주소 줄을 두 줄로 겹치지 않게). */
export function pathLinkHtml(place, esc, at = {}, note = '') {
  const p = placeAt(place, at);
  if (!p) return '';
  const where = p.path.map(esc).join(' › ');
  return `<a class="lu-drive-open lu-drive-here" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="구글 드라이브에서 ${where} 열기" title="구글 드라이브 · ${where}">드라이브 ↗</a>`
    + noteHtml(note, esc, ' lu-drive-here');
}

/** 서버 답(숫자만) → 줄 끝 글. 드라이브 연결 없음·자료실 폴더 없음은 조용히(밀린 것이 아님). */
export function mirrorNote(r) {
  if (r == null) return '';
  return followFailed(r) ? FOLLOW_FAILED_NOTE : '';
}

// S69-52 ①: 드라이브에서 직접 바꾼 폴더 이름·자리는 자료실에 들어올 때(entered) 한 번 서버에 '늘 같게'를 부탁해 자료실이 따라간다.
// 서버가 자료실 폴더를 고쳤으면(app_renamed·app_moved) onAppChanged()로 화면이 폴더를 다시 읽는다.
// path: 폴더 안 위치 줄(있으면 저장 위치 줄 대신 그 끝에 [드라이브 ↗]). 위치 줄은 화면이 그리고, 그 끝 링크·저장 위치 줄의 주인은 여기 하나.
// changed(): 옛 부름 자리(폴더를 다시 읽을 때) — 옮기기 부탁은 drive-follow.mjs가 저장 직후에 하므로 여기서는 하지 않는다.
export function mountLibraryDriveLine({api, esc, at = () => ({}), el = () => document.querySelector('#libraryDriveLine'), path = () => globalThis.document?.querySelector('#libraryPath:not([hidden])') || null, wait = AUTO_WAIT_MS, onAppChanged = () => {}, follow: ask = followDrive, listen = onDriveFollow}) {
  let place = null, owner = 0, note = '', autoTimer = null, follow = false;
  function render() {
    const box = el(), nav = path(), here = at();
    for (const old of globalThis.document?.querySelectorAll('.lu-drive-here') || []) if (!nav || old.parentElement !== nav) old.remove();
    if (nav) {
      const link = pathLinkHtml(place, esc, here, note), now = [...nav.querySelectorAll(':scope > .lu-drive-here')].map(x => x.outerHTML).join('');
      if (now !== link) { nav.querySelectorAll(':scope > .lu-drive-here').forEach(x => x.remove()); if (link) nav.insertAdjacentHTML('beforeend', link); }
    }
    if (!box) return;
    const html = nav ? '' : driveLineHtml(place, esc, here, note);
    if (box.innerHTML !== html) box.innerHTML = html;
    box.hidden = !html;
  }
  // 자료실에 들어올 때마다 다시 묻는다(드라이브에서 이름을 바꿨으면 그 이름). 겹친 요청은 마지막 것만 그린다.
  function refresh() {
    const mine = ++owner;
    return api('/functions/v1/workspace-drive?action=drive-place', {method: 'GET'})
      .then(d => { if (mine === owner) place = cleanPlace(d?.place); })
      .catch(() => { if (mine === owner) place = null; })
      .finally(() => { if (mine !== owner) return; render(); if (place && follow) { follow = false; schedule(); } });
  }
  // 어디서 부탁했든(drive-follow.mjs) 결과를 듣고 줄 끝 글을 바꾼다. 새 짝 폴더가 생겼으면 주소를 다시 읽는다.
  listen(r => {
    note = mirrorNote(r);
    if (place && (Number(r?.files_moved) || Number(r?.folders_made))) void refresh();
    if (Number(r?.app_renamed) || Number(r?.app_moved)) Promise.resolve().then(onAppChanged).catch(() => { /* 다음 읽기에 */ });
    render();
  });
  function schedule() { clearTimeout(autoTimer); autoTimer = setTimeout(() => { autoTimer = null; void ask(api); }, wait); }
  function changed() { /* S70-76: 저장 직후 drive-follow.mjs가 부탁한다 */ }
  // 자료실에 들어올 때 한 번(바뀐 것이 없어도) — 드라이브 쪽 바뀜을 따라가고, 밀린 것이 있으면 서버가 다시 한다. 저장 위치를 아직 모르면 위치를 읽은 뒤.
  function entered() { if (place) schedule(); else follow = true; }
  // [다시]: 그 자리에서 다시 부탁(기다리지 않음).
  function retry() { clearTimeout(autoTimer); autoTimer = null; note = ''; render(); return ask(api); }
  globalThis.document?.addEventListener?.('click', e => { const b = e.target?.closest?.('[data-lu-drive-retry]'); if (!b) return; e.preventDefault(); void retry(); });
  return {refresh, render, changed, entered, retry, place: () => place};
}
