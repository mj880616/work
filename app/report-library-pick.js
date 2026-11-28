// S67-39(명진 11/20 20:20 "자료 + 자료실에서 추가도 가능하게"): 사업 보고 '자료 +'의 작은 메뉴 [기기에서 올리기]·[자료실에서 선택]과
// 자료실에서 고른 자료를 그 보고에 붙이는 길. 쓰기 창(team.js)과 보기·수정 창(meeting-round-detail.js)이 같이 쓴다.
// - 메뉴는 공용 작은 메뉴(anchored-menu.js, 모양 gt-task-menu), 고르기 창은 공용 고르기 창(library-move-picker.js, 여러 개 선택 —
//   브리핑 룸 [자료실에서 선택]과 같은 창). 목록은 열 때마다 서버에서 owner RLS로 읽는다(기기 저장 없음).
// - 붙이기 = 이미 있는 자료 행의 사업 보고 칸(app_documents.meeting_id)만 채운다. 파일 다시 올리기·복사·Drive 옮기기 없음.
//   내 작업공간(workspace_id) + 아직 어느 보고에도 안 붙은 줄(meeting_id is null)만 바꾼다 — 그사이 다른 보고에 붙은 자료는 건너뛴다.
//   소유자 확인은 DB RLS(task12a_owner_all)와 작업공간 일치 트리거가 한다(화면 값 믿지 않음). [빼기](meeting-round-detail.js)의 반대 길.
// - 조직 보고(담당조직 상세, workplace-detail.js) 자료 칸 [+]도 같은 메뉴·창·길을 쓴다(칸만 organization_id — [조직에서 빼기]의 반대 길).
import {createAnchoredMenu} from './anchored-menu.js';
import {createMovePicker} from './library-move-picker.js';
import {notify} from './small-notice.js';
import {reportPickRows, attachResult, PICK_SECTIONS, PICK_LABEL, DEVICE_LABEL, HERE_TAG, PICK_COLUMNS} from './report-library-pick-model.mjs';

const rt = () => window.KPTURuntime;
const ws = () => rt()?.context?.read?.()?.workspace?.id || '';
const enc = encodeURIComponent;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width:761px)').matches;
const PICK_CAP = 2000, CHUNK = 100;

// '자료 +' 작은 메뉴. 부른 버튼마다 할 일(device·library)을 둔다.
const jobs = new WeakMap();
let menu = null;
function ensureMenu() {
  menu ??= createAnchoredMenu({
    id: 'reportAddMenu', className: 'report-add-menu', label: '자료 추가', historyKey: 'kptuReportAddMenu', boxWidth: 180,
    parent: t => t.closest('.modal,[role="dialog"]') || document.body,
    key: t => t.id || 'report-add',
    render: () => `<button type="button" class="row-act" data-report-add="device">${esc(DEVICE_LABEL)}</button><button type="button" class="row-act" data-report-add="library">${esc(PICK_LABEL)}</button>`,
    onAction: (button, active) => {
      const job = jobs.get(active.trigger), act = button.dataset.reportAdd;
      if (act === 'device') job?.device?.();
      else if (act === 'library') job?.library?.();
    },
  });
  return menu;
}
export function openAddMenu(anchor, {device, library}) {
  if (!anchor || anchor.disabled) return;
  anchor.setAttribute('aria-haspopup', 'menu');
  jobs.set(anchor, {device, library});
  ensureMenu().open(anchor);
}

// 고르기 창의 모양(library-upload.css)은 자료실 묶음과 같이 온다(올리기 길과 같은 불러오기).
async function ensureLibraryLook() {
  const loader = window.KPTUViewLoader;
  if (loader?.load && !loader.isLoaded?.('library')) await loader.load('library');
}

// [자료실에서 선택]: 내 자료실 자료(최근 순, 이름 찾기)를 여러 개 고른다. 이 보고에 이미 있거나 이미 고른 것은 '이미 있음',
// 다른 보고에 붙은 것은 '다른 보고에 있음'(흐림, 고를 수 없음). onPick(docs) = 고른 자료 줄.
// column = 붙이는 칸('meeting_id' 기본, 조직 보고는 'organization_id'), targetId = 지금 보고·조직(meetingId는 옛 이름).
let picker = null;
export async function pickFromLibrary(anchor, {column = 'meeting_id', targetId = '', meetingId = '', chosen = new Set(), onPick}) {
  if (!anchor || anchor.disabled) return;
  if (picker?.isOpen) { void picker.close(false, true); return; }
  const workspace = ws();
  if (!workspace || typeof rt()?.api !== 'function') { notify('로그인 세션을 확인하지 못했어요.', {error: true}); return; }
  anchor.disabled = true;
  let docs = [];
  try {
    await ensureLibraryLook();
    const rows = await rt().api(`/rest/v1/app_documents?workspace_id=eq.${enc(workspace)}&select=id,title,file_name,mime_type,meeting_id,organization_id,created_at&order=created_at.desc&limit=${PICK_CAP}`);
    docs = Array.isArray(rows) ? rows : [];
  } catch { notify('자료실 자료를 읽지 못했어요. 잠시 뒤 다시 눌러 주세요.', {error: true}); return; }
  finally { anchor.disabled = false; }
  if (!anchor.isConnected || ws() !== workspace) return;
  picker ??= createMovePicker({esc, id: 'reportLibPicker', label: PICK_LABEL, findLabel: '자료 이름 찾기', foot: false, currentTag: HERE_TAG, folderIcons: false});
  anchor.setAttribute('aria-expanded', 'true');
  picker.open({anchor, place: 'below', history: !wide(), multi: true, sections: PICK_SECTIONS,
    doneLabel: n => (n ? `넣기 ${n}개` : '넣을 자료를 선택해 주세요'),
    keepOpen: t => !!menu && !!t?.closest?.('#reportAddMenu'),
    rows: query => reportPickRows({docs, column, targetId: targetId || meetingId, chosen, query}),
    onPickMany: ids => { if (ws() !== workspace) return; const set = new Set(ids); onPick?.(docs.filter(d => set.has(d.id))); },
    onClosed: () => { if (anchor.isConnected) anchor.setAttribute('aria-expanded', 'false'); }});
}

// 고른 자료를 그 사업 보고(또는 담당조직)에 붙인다. target = {column, id, project_id?}. 결과 한 줄은 작은 알림(quiet면 잘못됐을 때만).
// 붙인 것이 있으면 자료 목록을 다시 읽게 알린다(kptu:documents-changed — 보고 창·조직 상세·자료실이 듣는 같은 알림).
export async function attachTo(target, ids, {quiet = false} = {}) {
  const list = [...new Set((ids || []).filter(id => typeof id === 'string' && id))];
  const workspace = ws(), column = target?.column, targetId = String(target?.id || '');
  if (!list.length || !targetId || !PICK_COLUMNS.includes(column)) return {attached: 0, taken: 0, failed: 0};
  if (!workspace || typeof rt()?.api !== 'function') { notify('로그인 세션을 확인하지 못했어요.', {error: true, note: '자료는 붙이지 않았어요. 다시 로그인한 뒤 붙여 주세요.'}); return {attached: 0, taken: 0, failed: list.length}; }
  let attached = 0, taken = 0, failed = 0;
  const now = new Date().toISOString();
  for (let i = 0; i < list.length; i += CHUNK) {
    const part = list.slice(i, i + CHUNK);
    try {
      const rows = await rt().api(`/rest/v1/app_documents?workspace_id=eq.${enc(workspace)}&id=in.(${part.map(enc).join(',')})&${column}=is.null&select=id,${column}`,
        {method: 'PATCH', body: {[column]: targetId, updated_at: now}, prefer: 'return=representation'});
      const got = new Set((Array.isArray(rows) ? rows : []).filter(r => r?.[column] === targetId).map(r => r.id));
      const done = part.filter(id => got.has(id)).length;
      attached += done; taken += part.length - done;
    } catch (e) { console.warn('report library attach failed', e?.status || e?.name || 'Error'); failed += part.length; }
  }
  if (attached) window.dispatchEvent(new CustomEvent('kptu:documents-changed', {detail: column === 'meeting_id' ? {project_id: target?.project_id || null, meeting_id: targetId} : {organization_id: targetId}}));
  const r = attachResult({attached, taken, failed, column});
  if (r && (!quiet || r.error)) notify(r.text, {error: r.error, ...(failed ? {note: '아무것도 바뀌지 않았을 수 있어요. 다시 열어 확인해 주세요.'} : {})});
  return {attached, taken, failed};
}
// 사업 보고에 붙이기. meeting = {id, project_id}.
export const attachToReport = (meeting, ids, opts) => attachTo({column: 'meeting_id', id: meeting?.id, project_id: meeting?.project_id}, ids, opts);
