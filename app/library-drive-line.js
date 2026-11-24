// S69-20 ①(명진 11/24 08:44 "자료실에 자료들이 어디에 업로드되고 있는 거야? 왜 표시가 없지?"):
// 자료실 목록 위 작은 한 줄 '구글 드라이브 · 웹2 › 자료실  열기 ↗'. 이 줄의 주인은 이 모듈 하나(#libraryDriveLine)다.
// 경로·주소는 서버(workspace-drive GET ?action=drive-place)가 서버에 적어 둔 자료실 폴더 id로 드라이브의 지금 이름을 읽어 준다(화면은 고르지 않음).
// 자료를 올린 적이 없거나 드라이브 연결이 없거나 읽기가 실패하면 줄을 그리지 않는다(안내문을 따로 두지 않음).
// S69-20 ③④⑤: 폴더 안에 들어가면 그 앱 폴더의 짝 드라이브 폴더(서버가 준 pairs)로 연다. 앱 폴더·자료가 바뀌면 서버에
// '앞으로 같게'(drive-mirror auto)를 부탁하고, 드라이브 쪽이 실패하면 줄 끝에 '드라이브 정리 대기'(다음에 다시 부탁).
// [드라이브 폴더 맞추기](자료실 ⋯)는 명진이 누를 때만 기존 자료까지 맞춘다(align, 이어서 하기·실패 시 멈춤·옮긴 수 알림).
const DRIVE_FOLDER_URL = /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]{10,200}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
export const AUTO_WAIT_MS = 2500;
export const ALIGN_ROUNDS = 40;

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
    + (note ? `<span class="lu-drive-note" role="status">${esc(note)}</span>` : '');
}

/** 서버 답(숫자만) → 줄 끝 글. */
export function mirrorNote(r) {
  if (!r || typeof r !== 'object') return '';
  if (r.ok === false && r.code !== 'not_ready' && r.code !== 'drive_not_connected') return '드라이브 정리 대기';
  return (Number(r.pending) > 0 || r.more === true) ? '드라이브 정리 대기' : '';
}

export function mountLibraryDriveLine({api, esc, at = () => ({}), notify = () => {}, el = () => document.querySelector('#libraryDriveLine'), wait = AUTO_WAIT_MS}) {
  let place = null, owner = 0, note = '', aligning = false, autoTimer = null, autoRunning = false, lastSign = null, again = false, waiting;
  function render() {
    const box = el();
    if (!box) return;
    const html = driveLineHtml(place, esc, at(), note);
    if (box.innerHTML !== html) box.innerHTML = html;
    box.hidden = !html;
  }
  // 자료실에 들어올 때마다 다시 묻는다(드라이브에서 이름을 바꿨으면 그 이름). 겹친 요청은 마지막 것만 그린다.
  function refresh() {
    const mine = ++owner;
    return api('/functions/v1/workspace-drive?action=drive-place', {method: 'GET'})
      .then(d => { if (mine === owner) place = cleanPlace(d?.place); })
      .catch(() => { if (mine === owner) place = null; })
      .finally(() => { if (mine !== owner) return; render(); if (place && waiting !== undefined) { const sign = waiting; waiting = undefined; changed(sign); } });
  }
  const mirror = mode => api('/functions/v1/workspace-drive?action=drive-mirror', {method: 'POST', body: {mode}});
  // 앱 폴더·자료 연결이 바뀌었을 때(sign = 폴더·연결 모양) 잠시 뒤 한 번만 부탁한다. 대기가 남아 있으면 다음 바뀜·들어옴 때 다시.
  function changed(sign) {
    if (!place) { waiting = sign; return; }
    if (aligning) return;
    if (sign === lastSign && !note) return;
    lastSign = sign;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(runAuto, wait);
  }
  async function runAuto() {
    if (autoRunning) { again = true; return; }
    autoRunning = true;
    try {
      const r = await mirror('auto');
      note = mirrorNote(r);
      if (r?.files_moved || r?.folders_made) await refresh(); // 새 짝 폴더 주소
    } catch { note = '드라이브 정리 대기'; }
    finally { autoRunning = false; render(); if (again) { again = false; autoTimer = setTimeout(runAuto, wait); } }
  }
  // [드라이브 폴더 맞추기]: 이어서 하기(more) · 실패 시 멈춤 · 옮긴 수 알림. 드라이브 파일은 지우지 않는다(서버 규칙).
  async function align() {
    if (aligning || !place) return null;
    aligning = true; clearTimeout(autoTimer);
    const sum = {folders_made: 0, folders_fixed: 0, files_moved: 0, cant: 0};
    let last = null;
    try {
      for (let i = 0; i < ALIGN_ROUNDS; i++) {
        note = `드라이브 맞추는 중 · ${sum.files_moved}개 옮김`; render();
        last = await mirror('align');
        for (const k of Object.keys(sum)) sum[k] += Number(last?.[k]) || 0;
        if (!last?.ok || !last.more || last.stopped) break;
      }
    } catch { last = {ok: false}; }
    finally { aligning = false; }
    const done = last?.ok && last.state === 'aligned' && !last.more && !last.stopped && !last.pending;
    note = done ? '' : '드라이브 정리 대기';
    await refresh();
    const counts = `폴더 ${sum.folders_made}개 만들고 자료 ${sum.files_moved}개 옮겼어요` + (sum.cant ? ` · 옮길 수 없는 자료 ${sum.cant}개는 그대로` : '');
    notify(done ? `드라이브 폴더를 맞췄어요 · ${counts}` : `드라이브 폴더를 다 맞추지 못했어요(${counts}). 잠시 뒤 다시 눌러 주세요.`, {error: !done});
    return {done, ...sum};
  }
  return {refresh, render, changed, align, place: () => place, busy: () => aligning};
}
