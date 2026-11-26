// MTG-정기회의자료폴더(사용자 11/24 21:03 "자료실 폴더 이름 중 회의 폴더 이름이 정기 회의 폴더 이름과 같고 매칭이 되어서.
//   저기에 회의자료 등을 올리면 저 폴더로 자동으로 가게"):
// 사업 보고(회의)에 올린 회의자료·첨부를 그 회의명과 짝인 자료실 폴더에 넣는다. 짝이 없으면 이름이 같은 폴더 하나, 그것도 없으면 지금처럼.
// 자료는 하나(복사 아님) — 사업 보고에는 지금처럼 붙어 보이고 자료실 그 폴더에서도 보인다. 이 모듈은 자료를 지우지 않는다.
// 규칙은 meeting-folder-model.mjs 한 곳. 짝 = 폴더 줄 meeting_key(서버 함수 app_library_folder_set_meeting, 내 작업공간 폴더만). 기기 저장 없음.
// 드라이브 사본은 따로 옮기지 않는다: 자료실 폴더 = 드라이브 폴더 맞추기(S69-20/40, workspace-drive drive-mirror auto)가 폴더 연결이 바뀌면 그 폴더의 드라이브 폴더로 옮긴다.
// 남의 기록 안 보기(AGENTS.md 3절): 내 로그인·내 작업공간의 사업 보고·폴더만 읽는다.
import {readLibraryFolders, putDocumentInFolder, readFolderMeetingLinks, setFolderMeeting} from './library-folder-data.js';
import {notify} from './small-notice.js';
import {pickMeetingFolder, linkedFolder, meetingLinkKey, meetingNameOf, filedLine} from './meeting-folder-model.mjs';

const enc = encodeURIComponent;
const ROW_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ctxOf = rt => { const c = rt?.context?.read?.(); return {ws: c?.workspace?.id || '', user: c?.user?.id || ''}; };

async function loadState(rt) {
  const {ws} = ctxOf(rt); if (!ws) return null;
  const api = rt.api.bind(rt);
  const [folders, links] = await Promise.all([readLibraryFolders(api, ws), readFolderMeetingLinks(api, ws)]);
  return {ws, api, folders: Array.isArray(folders) ? folders : [], links};
}

// 같은 탭에서 두 올리기가 겹쳐도 차례로(같은 자료를 두 번 넣지 않게).
let tail = Promise.resolve();
const queued = work => { const run = tail.then(work, work); tail = run.catch(() => {}); return run; };

// 사업 보고 하나에 올린 자료를 그 회의명 폴더에. docIds = 올린 자료 id들.
// 반환 {status:'filed', folder, put, failed} | {status:'none'}(짝·같은 이름 폴더 없음) | {status:'off'}(내 것 아님·계정 바뀜) | {status:'error'}.
// quiet가 아니면 넣은 뒤 '…폴더에 넣었어요' 한 줄.
export function fileIntoMeetingFolder({docIds, meetingId, rt = window.KPTURuntime, quiet = false} = {}) {
  const ids = [...new Set((docIds || []).filter(id => typeof id === 'string' && ROW_ID.test(id)))];
  if (!ids.length || typeof meetingId !== 'string' || !ROW_ID.test(meetingId)) return Promise.resolve({status: 'off'});
  const owner = ctxOf(rt).user;
  return queued(async () => {
    try {
      if (!owner || ctxOf(rt).user !== owner) return {status: 'off'};
      const st = await loadState(rt); if (!st) return {status: 'off'};
      const rows = await st.api(`/rest/v1/app_meetings?id=eq.${enc(meetingId)}&workspace_id=eq.${enc(st.ws)}&select=id,title,series_name&limit=1`);
      const meeting = Array.isArray(rows) ? rows[0] : null;
      if (!meeting) return {status: 'off'}; // 내 작업공간 사업 보고가 아님
      const pick = pickMeetingFolder({folders: st.folders, links: st.links, name: meetingNameOf(meeting)});
      if (!pick) return {status: 'none'};
      let put = 0, failed = 0;
      for (const id of ids) {
        if (ctxOf(rt).user !== owner) break;
        if (await putDocumentInFolder(st.api, {workspace: st.ws, documentId: id, folderId: pick.folder.id})) put++; else failed++;
      }
      if (put) window.dispatchEvent(new CustomEvent('kptu:library-folders-changed', {detail: {folder_id: pick.folder.id}}));
      const folder = {id: pick.folder.id, name: String(pick.folder.name || '')};
      if (!quiet && (put || failed)) notify(filedLine(folder.name, put, failed), {error: failed > 0});
      return {status: 'filed', folder, how: pick.how, put, failed};
    } catch (error) { console.warn('meeting folder', error?.status || '', error?.message || ''); return {status: 'error'}; }
  });
}

// 회의명 고르기 창 줄 ⋯ [자료실 폴더 정하기]: 공용 폴더 고르기 창으로 폴더 하나를 고르면 그 회의명과 짝짓는다.
export async function chooseMeetingFolder({anchor, name, rt = window.KPTURuntime} = {}) {
  const key = meetingLinkKey(name);
  if (!key) { notify('이 회의명에는 폴더를 정할 수 없어요.', {error: true}); return; }
  const st = await loadState(rt).catch(() => null);
  if (!st) { notify('자료실 폴더를 읽지 못했어요. 다시 해 주세요.', {error: true}); return; }
  if (st.links === null) { notify('아직 준비 중인 기능이에요.', {error: true}); return; }
  const now = linkedFolder({folders: st.folders, links: st.links, name});
  const {openLibraryFolderPicker} = await import('./library-folder-pick.js');
  openLibraryFolderPicker({anchor, folders: st.folders, choose: true, title: '회의자료 넣을 폴더 선택', ...(now ? {start: now.id} : {}), onPick: async f => {
    if (!f?.id || f.id === now?.id) return;
    const ok = await setFolderMeeting(st.api, f.id, key).catch(() => false);
    notify(ok ? `‘${String(name).trim()}’ 자료는 ‘${f.name}’ 폴더에 넣어요.` : '폴더를 정하지 못했어요. 다시 해 주세요.', {error: !ok});
  }});
}

// 지금 짝지은 폴더 이름(⋯ 메뉴 글자에 보임). 모르면 ''.
export async function meetingFolderName(name, rt = window.KPTURuntime) {
  try { const st = await loadState(rt); return st ? String(linkedFolder({folders: st.folders, links: st.links, name})?.name || '') : ''; }
  catch { return ''; }
}

// 회의명을 바꾸면 짝도 새 이름으로(짝이 없으면 아무것도 안 함).
export async function followMeetingRename(from, to, rt = window.KPTURuntime) {
  const a = meetingLinkKey(from), b = meetingLinkKey(to);
  if (!a || !b || a === b) return false;
  try {
    const st = await loadState(rt); if (!st || !Array.isArray(st.links)) return false;
    const pair = st.links.find(l => l.meeting_key === a); if (!pair) return false;
    return await setFolderMeeting(st.api, pair.id, b);
  } catch { return false; }
}
