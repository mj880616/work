// ORG-기록자료폴더(명진 11/24 "앞으로 조직관리에서 각 조직 기록 자료 추가하면 궤도 조직 각 조직 폴더에 저장"):
// 담당조직 기록·조직 상세 자료 [+]로 올린 자료를 자료실 '모으는 폴더(부모) › 그 조직 폴더'에 넣는다. 자료는 하나(복사 아님) — 기록에는 지금처럼 붙어 보이고
// 자료실 그 폴더에서도 보인다. 기록에서 첨부를 빼도 자료실 자료는 남는다(삭제는 자료실에서만, 이 모듈은 삭제하지 않음).
// 규칙은 org-files-folder-model.mjs 한 곳. 저장은 모두 서버: 부모 폴더 = 내 프로필 org_files_folder 칸(받는 폴더와 같은 내 행 PATCH, owner RLS),
// 조직 ↔ 폴더 짝 = 폴더 줄 organization_id(서버 함수 app_library_folder_set_org, 내 작업공간 폴더·조직만). 기기 저장 없음.
// 드라이브 사본은 따로 옮기지 않는다: 자료실 폴더 = 드라이브 폴더 맞추기(S69-20/40, workspace-drive drive-mirror auto)가 폴더 연결이 바뀌면 그 폴더의 드라이브 폴더로 옮긴다.
// 남의 기록 안 보기(AGENTS.md 3절): 내 로그인·내 작업공간만. 남의 작업공간 조직(공유로 보이는 조직)은 내 조직 표에 없으므로 넣지 않는다(서버 함수도 거절).
import {readLibraryFolders, readLibraryFolderItems, createLibraryFolder, putDocumentInFolder, readFolderOrgLinks, setFolderOrganization} from './library-folder-data.js';
import {folderSiblings, nextSortOrder} from './library-tree.js';
import {profileUrl} from './library-view-pref.js';
import {notify} from './small-notice.js';
import {word} from './brand/brand.mjs';
import {isFolderId, guessParentFolder, liveParent, planOrgFolder, gatherPlan, ASK_TEXT, gatherLine} from './org-files-folder-model.mjs';

const enc = encodeURIComponent;
const ctxOf = rt => { const c = rt?.context?.read?.(); return {ws: c?.workspace?.id || '', user: c?.user?.id || ''}; };

// {status:'ok', id|null} | {status:'pending'}(칸이 아직 없는 서버) | {status:'error'}
export async function readOrgFilesParent(rt = window.KPTURuntime) {
  const url = profileUrl(rt); if (!url) return {status: 'error'};
  try {
    const rows = await rt.api(`${url}&select=org_files_folder&limit=1`);
    if (!Array.isArray(rows) || rows.length !== 1) return {status: 'error'};
    if (!rows[0] || !('org_files_folder' in rows[0])) return {status: 'pending'}; // 칸을 모르는 서버(돌려준 줄에 칸이 없음)
    const v = rows[0].org_files_folder ?? null;
    return v === null || isFolderId(v) ? {status: 'ok', id: v} : {status: 'error'};
  } catch (error) { return {status: Number(error?.status) === 400 ? 'pending' : 'error'}; }
}
export async function saveOrgFilesParent(id, rt = window.KPTURuntime) {
  const url = profileUrl(rt); if (!url || (id !== null && !isFolderId(id))) return false;
  try {
    const saved = await rt.api(url, {method: 'PATCH', prefer: 'return=representation', body: {org_files_folder: id}, singleFlight: false});
    return Array.isArray(saved) && saved.length === 1 && (saved[0]?.org_files_folder ?? null) === id;
  } catch { return false; }
}

// 내 작업공간의 조직(이름은 서버 값). 남의 조직 id면 빈 배열.
async function myOrgs(rt, ws, ids = null) {
  const only = ids ? `&id=in.(${ids.map(enc).join(',')})` : '';
  const rows = await rt.api(`/rest/v1/app_suborganizations?workspace_id=eq.${enc(ws)}${only}&select=id,name&order=id.asc`);
  return Array.isArray(rows) ? rows : [];
}
async function loadState(rt) {
  const {ws} = ctxOf(rt); if (!ws) return null;
  const api = rt.api.bind(rt);
  const [parent, folders, links] = await Promise.all([readOrgFilesParent(rt), readLibraryFolders(api, ws), readFolderOrgLinks(api, ws)]);
  if (parent.status === 'pending' || links === null) return {off: true};
  if (parent.status !== 'ok') throw new Error('org files parent read failed');
  return {ws, api, parentId: parent.id, folders: Array.isArray(folders) ? folders : [], links};
}

// 이 조직의 폴더(없으면 만들고 짝짓기). 반환 폴더 줄 | null.
async function ensureOrgFolder(st, parent, org) {
  const plan = planOrgFolder({folders: st.folders, links: st.links, parent, org});
  if (!plan) return null;
  if (plan.kind === 'linked') return plan.folder;
  let folder = plan.folder;
  if (plan.kind === 'create') {
    folder = await createLibraryFolder(st.api, {workspace: st.ws, project_id: parent.project_id || null, parent_id: parent.id, name: plan.name,
      sort_order: nextSortOrder(folderSiblings(st.folders, {free: true, parentId: parent.id}))});
    if (!folder?.id) return null;
    st.folders.push(folder);
  }
  if (!(await setFolderOrganization(st.api, folder.id, org.id))) return null;
  st.links = st.links.filter(l => l.organization_id !== org.id && l.id !== folder.id).concat({id: folder.id, organization_id: org.id});
  return folder;
}

// 같은 탭에서 두 올리기가 겹쳐 같은 조직 폴더를 두 번 만들지 않게 한 줄로 세운다.
let tail = Promise.resolve();
const queued = work => { const run = tail.then(work, work); tail = run.catch(() => {}); return run; };

// 첫 사용: '조직 기록 자료를 ○○ 폴더에 모을까요? [예] [다른 폴더]'. 선택하면 저장하고 방금 올린 자료도 넣는다. 답하지 않으면 다음에 다시 묻는다.
// S70-29(2026-11-25 명진 '다 없애 1회용 기능'·조사 문서 8번 '자동으로 바꿈'): 모으는 폴더를 처음 정하면 지난 조직 기록 자료도 같이 조직 폴더로 모은다
// (옛 조직 관리 ⋯ [지난 조직 기록 자료도 조직 폴더로 모으기] 메뉴 줄은 지움). 결과 한 줄 + [되돌리기]. 처음 정할 때만 — 나중에 폴더를 바꿔도 다시 모으지 않는다.
let asking = false;
function askParent(st, rt, then) {
  if (asking) return; asking = true;
  const guess = guessParentFolder(st.folders, st.orgs || []);
  const done = () => { asking = false; };
  const choose = async (folder, close) => {
    close(); done();
    if (!folder?.id) return;
    if (!(await saveOrgFilesParent(folder.id, rt))) { notify('모으는 폴더를 저장하지 못했어요. 다시 시도해 주세요.', {error: true}); return; }
    then();
    void gatherPastOrgFiles({rt});
  };
  const pickOther = async ({box, close}) => {
    const {openLibraryFolderPicker} = await import('./library-folder-pick.js');
    openLibraryFolderPicker({anchor: box, folders: st.folders, choose: true, title: '모으는 폴더 선택', onPick: f => void choose(f, close), onClosed: () => {}});
  };
  const text = guess ? ASK_TEXT(guess.name) : word('조직 기록 자료를 모을 폴더를 선택할까요?');
  notify(text, {record: false, ms: 20000, actions: guess
    ? [{label: '예', run: ({close}) => void choose(guess, close)}, {label: '다른 폴더', run: a => void pickOther(a)}]
    : [{label: '폴더 선택', run: a => void pickOther(a)}]});
  setTimeout(done, 21000);
}

// 조직 기록 자료를 그 조직 폴더에. docIds = 방금 올린(또는 자료가 된) 자료 id들, org = {id}.
// 반환 {status:'filed', folder, put, failed} | {status:'asked'} | {status:'off'}(서버 준비 전·남의 조직·내 작업공간 아님) | {status:'error'}.
export function fileIntoOrgFolder({docIds, org, rt = window.KPTURuntime, ask = true} = {}) {
  const ids = [...new Set((docIds || []).filter(isFolderId))];
  if (!ids.length || !isFolderId(org?.id)) return Promise.resolve({status: 'off'});
  const owner = ctxOf(rt).user;
  return queued(async () => {
    try {
      if (ctxOf(rt).user !== owner) return {status: 'off'};
      const st = await loadState(rt); if (!st || st.off) return {status: 'off'};
      const [mine] = await myOrgs(rt, st.ws, [org.id]);
      if (!mine) return {status: 'off'}; // 남의 작업공간 조직(공유) — 내 자료실에 넣지 않는다
      const parent = liveParent(st.parentId, st.folders);
      const linked = planOrgFolder({folders: st.folders, links: st.links, parent: null, org: mine});
      if (!parent && !linked) {
        if (!ask) return {status: 'off'};
        st.orgs = await myOrgs(rt, st.ws).catch(() => []);
        askParent(st, rt, () => void fileIntoOrgFolder({docIds: ids, org, rt, ask: false}).then(r => { if (r.status === 'filed' && r.put) notify(`‘${r.folder.name}’ 폴더에 넣었어요 ${r.put}개`); }));
        return {status: 'asked'};
      }
      const folder = linked?.folder || await ensureOrgFolder(st, parent, mine);
      if (!folder) return {status: 'error'};
      let put = 0, failed = 0;
      for (const id of ids) { if (ctxOf(rt).user !== owner) break; if (await putDocumentInFolder(st.api, {workspace: st.ws, documentId: id, folderId: folder.id})) put++; else failed++; }
      if (put) window.dispatchEvent(new CustomEvent('kptu:library-folders-changed', {detail: {folder_id: folder.id}}));
      return {status: 'filed', folder: {id: folder.id, name: String(folder.name || '')}, put, failed};
    } catch (error) { console.warn('org files folder', error?.status || '', error?.message || ''); return {status: 'error'}; }
  });
}

// 조직 관리 ⋯ [조직 기록 자료 모으는 폴더]: 지금 값을 보이고 바꾼다.
export async function chooseOrgFilesParent(anchor, rt = window.KPTURuntime) {
  const st = await loadState(rt).catch(() => null);
  if (!st || st.off) { notify('아직 준비 중인 기능이에요.', {error: true}); return; }
  const {openLibraryFolderPicker} = await import('./library-folder-pick.js');
  openLibraryFolderPicker({anchor, folders: st.folders, choose: true, title: '모으는 폴더 선택', start: st.parentId, onPick: async f => {
    if (!f?.id) return;
    const saved = await saveOrgFilesParent(f.id, rt);
    notify(saved ? word`조직 기록 자료를 ‘${f.name}’ 폴더에 모아요.` : '모으는 폴더를 저장하지 못했어요.', {error: false});
    if (saved && !liveParent(st.parentId, st.folders)) void gatherPastOrgFiles({rt}); // 처음 정할 때만(S70-29)
  }});
}

// 모으는 폴더를 처음 정했을 때 저절로(S70-29 — 메뉴 줄 없음): 담당조직이 붙은 자료 중 폴더 밖·받는 폴더에 있는 것만 옮긴다.
// 옮긴 것이 있을 때만 결과 한 줄 + [되돌리기]. 모으는 폴더가 없거나 서버 준비 전이면 아무것도 하지 않는다(묻지 않음).
export async function gatherPastOrgFiles({rt = window.KPTURuntime} = {}) {
  return queued(async () => {
    const st = await loadState(rt).catch(() => null);
    if (!st || st.off) return {status: 'off'};
    const parent = liveParent(st.parentId, st.folders);
    if (!parent) return {status: 'off'};
    const [orgs, docs, items, receive] = await Promise.all([
      myOrgs(rt, st.ws),
      rt.api(`/rest/v1/app_documents?workspace_id=eq.${enc(st.ws)}&organization_id=not.is.null&select=id,organization_id&order=id.asc&limit=5000`),
      // S69: 연결 줄은 1000줄 넘어도 모두(library-folder-data.js readLibraryFolderItems, 자료실과 같은 이어 읽기). 잘리면 폴더에 든 자료를 '폴더 밖'으로 잘못 본다.
      readLibraryFolderItems(p => rt.api(p), st.ws),
      import('./library-receive.js').then(m => m.readReceiveFolder(rt)).catch(() => ({status: 'error'})),
    ]);
    const byOrg = gatherPlan({docs, items, visibleIds: new Set(st.folders.map(f => f.id)), receiveId: receive?.status === 'ok' ? receive.id : null, orgIds: orgs.map(o => o.id)});
    const moved = []; let failed = 0;
    for (const org of orgs) {
      const list = byOrg.get(org.id); if (!list?.length) continue;
      const folder = await ensureOrgFolder(st, parent, org).catch(() => null);
      if (!folder) { failed += list.length; continue; }
      for (const d of list) { if (await putDocumentInFolder(st.api, {workspace: st.ws, documentId: d.id, folderId: folder.id})) moved.push({...d, to: folder.id}); else failed++; }
    }
    if (moved.length) window.dispatchEvent(new CustomEvent('kptu:library-folders-changed', {detail: {}}));
    const undo = moved.length ? async () => {
      let back = 0;
      for (const m of moved) {
        const w = `?document_id=eq.${enc(m.id)}&workspace_id=eq.${enc(st.ws)}&folder_id=eq.${enc(m.to)}`; // 그 사이 다른 폴더로 옮긴 자료는 건드리지 않는다
        try {
          if (m.from) await st.api('/rest/v1/app_library_folder_items' + w, {method: 'PATCH', prefer: 'return=minimal', body: {folder_id: m.from}});
          else await st.api('/rest/v1/app_library_folder_items' + w, {method: 'DELETE', prefer: 'return=minimal'});
          back++;
        } catch { /* 남은 것은 자료실에서 확인 */ }
      }
      window.dispatchEvent(new CustomEvent('kptu:library-folders-changed', {detail: {}}));
      return back > 0;
    } : null;
    if (moved.length || failed) notify(gatherLine(moved.length, failed), {error: failed > 0, ...(undo ? {undo, label: word`조직 폴더로 모으기 ${moved.length}개`} : {})});
    return {status: 'done', moved: moved.length, failed};
  });
}
