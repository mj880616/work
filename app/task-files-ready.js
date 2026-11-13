// PERF-첫로딩 ③(S61-32): 할 일 파일 표(app_task_attachments)가 이 주인에게 답하는지 — 그 답의 유일한 주인(메모리만, 새 저장소 아님).
// task-files.js에서 떼어 냈다: 홈 빠른 입력(home-quick.js)이 첫 화면 전에 task-files.js의 큰 사슬(파일 메뉴·올리기·이름 고치기·휴지통 등)을
// 받지 않고도 [할 일] 클립 자리를 정할 수 있게. task-files.js가 이 모듈을 그대로 다시 내보내고 readTaskFiles의 답도 여기로 알린다(상태 한 곳).
export const MAX_TASK_FILES = 10;
// task-files.js readTaskFiles와 같은 칸·순서(같은 주소라 같은 읽기를 나눠 받는다).
export const TASK_FILE_COLS = 'select=google_task_id,drive_file_id,file_name,size_bytes&order=created_at.asc';
// 표가 있는지만 묻는 읽기 한 번(readTaskFiles([])와 같은 주소·같은 결과). 답 행은 쓰지 않는다.
async function probe(rt) {
  let rows;
  try { rows = await rt.api(`/rest/v1/app_task_attachments?limit=1&${TASK_FILE_COLS}`, {}); }
  catch (e) { tableMissing(rt); throw e; }
  if (!Array.isArray(rows)) throw Error('할 일 파일을 확인하지 못했어요.');
  tableAnswered(ownerOf(rt));
  return true;
}
const available = new Map();
const readyEvents = typeof window === 'undefined' ? new EventTarget() : window;
export function ownerOf(rt) { return rt?.context?.read?.()?.user?.id || rt?.session?.read?.()?.user?.id || ''; }
// TEST-홈빠른입력안정화: windows that keep the file part's place while the answer is out hear a yes and a failed read alike.
function tell(owner, yes) { try { readyEvents.dispatchEvent(new CustomEvent('kptu:task-files-ready', {detail: {owner, yes}})); } catch {} }
// A read of the table answered for this owner (the task list's own read or the check below). Only a yes is kept in memory.
export function tableAnswered(owner) {
  if (!owner || available.get(owner)?.yes) return;
  const yes = Promise.resolve(true); yes.yes = true; available.set(owner, yes);
  tell(owner, true);
}
// A read failed (no table yet, or a network error): a window still keeping the place stops waiting. Nothing is stored.
export function tableMissing(rt) {
  const owner = ownerOf(rt);
  if (!owner || available.get(owner)?.yes) return;
  tell(owner, false);
}
// Whether the link table answers for this owner (the same check that shows ⋯ → 파일 붙이기). Only a yes is remembered.
// ask:false only reports an answer already known (the [할 일] screen waits for its list's own read, see onTaskFilesReady).
export function taskFilesAvailable({rt = window.KPTURuntime, ask = true} = {}) {
  const owner = ownerOf(rt);
  if (!owner) return Promise.resolve(false);
  if (!available.has(owner)) {
    if (!ask) return Promise.resolve(false);
    available.set(owner, probe(rt).then(() => true, () => { if (!available.get(owner)?.yes) available.delete(owner); return false; }));
  }
  return available.get(owner);
}
// Whether a yes is already known for the signed-in owner (no request). Lets a window lay out its file row before it shows.
export function taskFilesKnown({rt = window.KPTURuntime} = {}) { return !!available.get(ownerOf(rt))?.yes; }
// Calls back once the table has answered for an owner (by any read; yes = true), and after a read failed (yes = false).
// Returns a function that stops listening.
export function onTaskFilesReady(callback) {
  const listener = e => callback(e.detail?.owner || '', e.detail?.yes !== false);
  readyEvents.addEventListener('kptu:task-files-ready', listener);
  return () => readyEvents.removeEventListener('kptu:task-files-ready', listener);
}
