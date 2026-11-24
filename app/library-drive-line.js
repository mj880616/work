// S69-20 ①(명진 11/24 08:44 "자료실에 자료들이 어디에 업로드되고 있는 거야? 왜 표시가 없지?"):
// 자료실 목록 위 작은 한 줄 '구글 드라이브 · 웹2 › 자료실  열기 ↗'. 이 줄의 주인은 이 모듈 하나(#libraryDriveLine)다.
// 경로·주소는 서버(workspace-drive GET ?action=drive-place)가 서버에 적어 둔 자료실 폴더 id로 드라이브의 지금 이름을 읽어 준다(화면은 고르지 않음).
// 자료를 올린 적이 없거나 드라이브 연결이 없거나 읽기가 실패하면 줄을 그리지 않는다(안내문을 따로 두지 않음).
// S69-22(명진 11/24 08:54 "앱과 자동 수집이 쓰고 있는것좀 한 폴더에 몰아두면 안되니"): 같은 줄 끝 [앱 폴더 모으기].
// 누르면 서버(workspace-drive POST ?action=gather-folders)에 먼저 세기(dry_run)만 묻고 → 확인창 → 옮기기. 옮기는 폴더는 서버가 고른다(화면은 id를 보내지 않음).
// 부모만 바꾼다(삭제 없음, 링크 그대로). 한 번에 다 못 옮기면 이어서 다시 부른다. 자동으로는 돌지 않는다(사람이 누를 때만).
import {askConfirm, notify} from './small-notice.js';
const DRIVE_FOLDER_URL = /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]{10,200}$/;
const GATHER = '/functions/v1/workspace-drive?action=gather-folders';
const GATHER_ROUNDS = 5;
const KIND_WORDS = {basket: '바구니', record_backup: '기록 백업', edit_backup: '편집 백업', copy: '읽기용 사본'};
const rootName = name => typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : '맨 위 앱 폴더';

/** 세기 답 → 확인창 글. 모을 것이 없으면 null. */
export function gatherAskText(plan) {
  const count = Number(plan?.count) || 0;
  if (count <= 0) return null;
  const kinds = Object.entries(plan?.kinds || {}).filter(([k, n]) => KIND_WORDS[k] && n > 0).map(([k, n]) => n > 1 ? `${KIND_WORDS[k]} ${n}` : KIND_WORDS[k]);
  return {
    text: `앱 폴더 ${count}개를 '${rootName(plan.root_name)}' 아래로 모을까요?`,
    note: (kinds.length ? kinds.join(' · ') + '. ' : '') + (plan.root_new ? `'${rootName(plan.root_name)}' 폴더를 새로 만들어 넣습니다. ` : '') + '삭제하지 않고 자리만 옮겨요. 링크는 그대로예요.',
  };
}

/** [앱 폴더 모으기] 한 번: 세기 → 확인 → 옮기기(남으면 이어서). 답: {moved, failed, left} 또는 null(취소·없음). */
export async function gatherAppFolders({api, anchor = null, ask = askConfirm, say = notify}) {
  let plan;
  try { plan = await api(GATHER, {method: 'POST', body: {dry_run: true}}); }
  catch { say('드라이브 폴더를 확인하지 못했어요. 잠시 뒤 다시 눌러 주세요.', {error: true}); return null; }
  const q = gatherAskText(plan);
  if (!q) { say('모을 앱 폴더가 없어요. 이미 한곳에 있어요.'); return null; }
  if (!(await ask(anchor, {text: q.text, note: q.note, ok: '모으기'}))) return null;
  let moved = 0, failed = 0, left = 0, name = plan.root_name;
  for (let round = 0; round < GATHER_ROUNDS; round++) {
    let r;
    try { r = await api(GATHER, {method: 'POST', body: {}}); }
    catch { failed += Math.max(0, (Number(plan.count) || 0) - moved - failed); break; }
    moved += Number(r?.moved) || 0; failed += Number(r?.failed) || 0; left = Number(r?.left) || 0; name = r?.root_name || name;
    if (!left || !(Number(r?.moved) > 0)) break;
  }
  const where = rootName(name);
  if (moved && !failed && !left) say(`앱 폴더 ${moved}개를 '${where}' 아래로 모았어요.`);
  else if (moved) say(`앱 폴더 ${moved}개를 '${where}' 아래로 모았어요. ${failed + left}개는 옮기지 못했어요 — 다시 눌러 주세요.`, {error: true});
  else say('앱 폴더를 옮기지 못했어요. 잠시 뒤 다시 눌러 주세요.', {error: true});
  return {moved, failed, left};
}

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
  return `<span class="lu-drive-where">구글 드라이브 · ${where}</span><a class="lu-drive-open" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="구글 드라이브에서 ${where} 열기">열기 ↗</a><button class="lu-drive-gather" type="button" title="앱이 쓰는 드라이브 폴더를 맨 위 앱 폴더 한곳 아래로">앱 폴더 모으기</button>`;
}

export function mountLibraryDriveLine({api, esc, el = () => document.querySelector('#libraryDriveLine'), ask = askConfirm, say = notify}) {
  let place = null, loading = null, owner = 0, gathering = null;
  function render() {
    const box = el();
    if (!box) return;
    if (box.dataset && !box.dataset.gatherBound && typeof box.addEventListener === 'function') {
      box.dataset.gatherBound = '1';
      box.addEventListener('click', e => {
        const btn = e.target?.closest?.('.lu-drive-gather');
        if (!btn || gathering) return;
        btn.disabled = true;
        gathering = gatherAppFolders({api, anchor: btn, ask, say}).finally(() => { gathering = null; btn.disabled = false; });
      });
    }
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
  return {refresh, render, place: () => place, gathering: () => gathering};
}
