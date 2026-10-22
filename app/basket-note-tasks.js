// BASKET-할일출처: Google tasks made from a basket note are listed in that
// note's metadata.tasks (newest first). No new table, policy or RPC: the write
// is an owner-RLS REST PATCH of metadata only, and the read is one contains
// query. updated_at stays the original's version (raw text and attachments),
// so an AI handoff or a photo-text read already in flight keeps its version.
import {requestsGuard} from './update-requests.js';
import {journalGuard} from './update-journal.js';
export const NOTE_TASK_LIMIT=50;
const ENTRY_KEYS=['task_id','task_list_id','title','created_at'];
const LIMITS={task_id:1024,task_list_id:1024,title:1024};
const plainObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const scopeOf=rt=>{const c=rt?.context?.read?.();return c?.user?.id&&c?.workspace?.id?`${c.user.id}:${c.workspace.id}`:'';};

// Only well-formed entries are shown or kept; anything else in the array is dropped on the next write.
export function validNoteTask(entry){
  if(!plainObject(entry))return false;
  for(const key of ['task_id','task_list_id','title'])if(typeof entry[key]!=='string'||!entry[key]||[...entry[key]].length>LIMITS[key])return false;
  return typeof entry.created_at==='string'&&Number.isFinite(Date.parse(entry.created_at));
}
export function noteTasks(note){
  const tasks=plainObject(note?.metadata)?note.metadata.tasks:null;
  return Array.isArray(tasks)?tasks.filter(validNoteTask):[];
}
export function noteTaskEntry(task,now=new Date()){
  const entry={task_id:task?.id,task_list_id:task?.taskListId,title:String(task?.title||''),created_at:now.toISOString()};
  if(!validNoteTask(entry))throw Error('할 일 정보를 확인할 수 없어요.');
  return entry;
}
// Every other metadata key is kept as it is. The new task goes first; the
// same task is never listed twice; the oldest past the limit are dropped.
export function mergeNoteTask(metadata,entry){
  if(!validNoteTask(entry))throw Error('할 일 정보를 확인할 수 없어요.');
  const base=plainObject(metadata)?metadata:{};
  const kept=noteTasks({metadata:base}).filter(t=>t.task_id!==entry.task_id);
  return {...base,tasks:[Object.fromEntries(ENTRY_KEYS.map(key=>[key,entry[key]])),...kept].slice(0,NOTE_TASK_LIMIT)};
}
// Concurrency guard for the PATCH: the original's version must be unchanged,
// and so must the first listed task and the write-request candidate's mark
// (BASKET-4b-2), so two metadata writers never drop each other's entry.
const textGuard=value=>value==null?'is.null':'eq.'+encodeURIComponent(typeof value==='string'?value:JSON.stringify(value));
export function noteTaskGuard(note){
  const first=Array.isArray(note?.metadata?.tasks)?note.metadata.tasks[0]:null;
  const request=plainObject(note?.metadata)&&plainObject(note.metadata.write_request)?note.metadata.write_request.marked_at:null;
  // JOURNAL-요청표시: the update's request marks (metadata.requests, update-requests.js) are guarded too, and so is the
  // work-journal memo mark (metadata.journal_at, update-journal.js; BASKET-일지로남기기).
  return `updated_at=eq.${encodeURIComponent(note.updated_at)}&metadata->write_request->>marked_at=${textGuard(request)}${requestsGuard(note?.metadata)}${journalGuard(note?.metadata)}&metadata->tasks->0->>task_id=${textGuard(plainObject(first)?first.task_id:null)}`;
}
function workspaceId(rt){
  const id=rt.context.read()?.workspace?.id;
  if(!id)throw Error('업무 공간을 확인할 수 없어요.');
  return encodeURIComponent(id);
}
// Records one task on its source note. Never creates or retries the Google task.
// Returns {ok:true,note:{id,updated_at,metadata}} or {ok:false}.
export async function recordNoteTask(noteId,entry,{rt=window.KPTURuntime,expectedSessionEpoch=null}={}){
  if(!validNoteTask(entry))return {ok:false};
  const options=expectedSessionEpoch==null?{}:{expectedSessionEpoch};
  const base=`/rest/v1/app_notes?id=eq.${encodeURIComponent(noteId)}&workspace_id=eq.${workspaceId(rt)}`;
  // One fresh read and, after a lost race, one more: never more writes than that.
  for(let attempt=0;attempt<2;attempt++){
    const rows=await rt.api(`${base}&select=id,updated_at,metadata`,{singleFlight:false,...options});
    if(!Array.isArray(rows)||rows.length!==1||!rows[0]?.updated_at)return {ok:false};
    const fresh=rows[0];
    if(noteTasks(fresh).some(t=>t.task_id===entry.task_id))return {ok:true,note:fresh};
    const saved=await rt.api(`${base}&${noteTaskGuard(fresh)}&select=id,updated_at,metadata`,{method:'PATCH',prefer:'return=representation',body:{metadata:mergeNoteTask(fresh.metadata,entry)},...options});
    if(Array.isArray(saved)&&saved.length===1&&noteTasks(saved[0]).some(t=>t.task_id===entry.task_id))return {ok:true,note:saved[0]};
    if(!Array.isArray(saved)||saved.length>1)return {ok:false};
  }
  return {ok:false};
}
// task_id -> note_id for every note that lists tasks, in one paged contains
// query (never one request per task). Owner RLS decides which notes are visible.
export async function readTaskSourceNotes({rt=window.KPTURuntime,expectedSessionEpoch=null}={}){
  const options=expectedSessionEpoch==null?{}:{expectedSessionEpoch},out=new Map(),size=100;
  const path=`/rest/v1/app_notes?workspace_id=eq.${workspaceId(rt)}&kind=eq.basket&metadata=cs.${encodeURIComponent('{"tasks":[]}')}&select=id,tasks:metadata->tasks&order=id.asc`;
  for(let offset=0;;offset+=size){
    const rows=await rt.api(`${path}&limit=${size}&offset=${offset}`,options);
    if(!Array.isArray(rows))throw Error('출처 업데이트를 확인하지 못했어요.');
    for(const row of rows)for(const task of noteTasks({metadata:{tasks:row?.tasks}}))if(!out.has(task.task_id))out.set(task.task_id,row.id);
    if(rows.length<size)return out;
  }
}
// One-shot in-app hand-offs between the task view and the basket. Each is
// bound to the signed-in user and workspace and expires quickly.
const REQUEST_MS=60*1000;
const requests={note:null,notedoc:null,task:null,kind:null};
const put=(kind,id,rt)=>{const scope=scopeOf(rt);requests[kind]=id&&scope?{id,scope,at:Date.now()}:null;};
const take=(kind,rt)=>{const value=requests[kind];requests[kind]=null;return value&&value.scope===scopeOf(rt)&&Date.now()-value.at<REQUEST_MS?value.id:null;};
export const requestBasketNote=(id,rt=window.KPTURuntime)=>put('note',id,rt);
export const takeBasketNoteRequest=(rt=window.KPTURuntime)=>take('note',rt);
// Menu [쓰기] → a note just saved opens on the basket's [노트] side.
export const requestNoteDocOpen=(id,rt=window.KPTURuntime)=>put('notedoc',id,rt);
export const takeNoteDocRequest=(rt=window.KPTURuntime)=>take('notedoc',rt);
// UI-PC메모노트: the PC sidebar's [업데이트]·[노트] under [바구니] open that side of the basket.
export const requestBasketKind=(kind,rt=window.KPTURuntime)=>put('kind',kind,rt);
export const takeBasketKindRequest=(rt=window.KPTURuntime)=>take('kind',rt);
export const requestTaskOpen=(id,rt=window.KPTURuntime)=>put('task',id,rt);
export const takeTaskOpenRequest=(rt=window.KPTURuntime)=>take('task',rt);
export const basketNoteHref=id=>`./?view=basket&note=${encodeURIComponent(id)}`;

// UI-PC프로젝트좌우: a note opened from a 🧺 record of a project (projects view) or an organization (team view) remembers
// where it came from, so the note screen offers "← (name)으로 돌아가기" and the opener reopens that project or
// organization at the same scroll when the person comes back (the button, browser or phone back, or the tab itself).
// It lives in this tab's memory only, bound to the signed-in user and workspace, and ends when another screen is chosen.
// JOURNAL-하루개편 ⑥: the work journal's lines open an update or a note the same way (one back returns to the journal's day).
const ORIGIN_VIEWS={projects:'프로젝트',team:'담당조직',journal:'업무일지'};
let origin=null;
export function requestBasketNoteFrom(id,from,rt=window.KPTURuntime){
  put('note',id,rt);const scope=scopeOf(rt);
  origin=id&&scope&&ORIGIN_VIEWS[from?.view]&&from.id?{note:id,view:from.view,id:from.id,name:String(from.name||''),scroll:from.scroll||null,scope,entry:globalThis.navigation?.currentEntry?.key||null}:null;
}
// UI-기록아이콘: a note (app_notes kind=note) opened from a project's or organization's record line opens on the basket's
// [노트] side with the same return line and the same way back.
export function requestNoteDocFrom(id,from,rt=window.KPTURuntime){requestBasketNoteFrom(id,from,rt);requests.note=null;put('notedoc',id,rt);}
export const basketNoteOrigin=(noteId,rt=window.KPTURuntime)=>origin&&origin.note===noteId&&origin.scope===scopeOf(rt)?origin:null;
// The opener takes its origin once, when its own screen shows again.
export function takeBasketReturn(view,rt=window.KPTURuntime){const o=origin;if(!o||o.view!==view)return null;origin=null;return o.scope===scopeOf(rt)?o:null;}
// Korean particle after the name: 으로 after a final consonant other than ㄹ, 로 otherwise ("(으)로" when not Hangul).
function toParticle(name){const c=String(name).trim().slice(-1).charCodeAt(0)-0xac00;if(!(c>=0&&c<11172))return '(으)로';const end=c%28;return end&&end!==8?'으로':'로';}
// The line under the note screen's head. Phones keep the short label; wider screens name the project or organization.
export function basketReturnHtml(noteId,rt=window.KPTURuntime,{narrow=globalThis.matchMedia?.('(max-width:760px)')?.matches}={}){
  const o=basketNoteOrigin(noteId,rt);if(!o)return '';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kind=ORIGIN_VIEWS[o.view],label=narrow||!o.name?`${kind}${toParticle(kind)} 돌아가기`:`${o.name}${toParticle(o.name)} 돌아가기`;
  return `<div class="basket-return"><button type="button" class="basket-return-btn" data-basket-return aria-label="${esc(o.name?`${o.name}(${kind})${toParticle(o.name)} 돌아가기`:label)}"><span aria-hidden="true">←</span> <span class="basket-return-text">${esc(label)}</span></button></div>`;
}
// Goes back to the opener's history entry when it is still behind this one (the same as back), else opens that screen.
export function returnFromBasketNote(){
  const o=origin;if(!o)return false;
  const nav=globalThis.navigation,now=nav?.currentEntry,at=o.entry?nav?.entries?.().find(e=>e.key===o.entry):null;
  if(now&&at&&Number.isInteger(at.index)&&at.index<now.index){history.go(at.index-now.index);return true;}
  return !!window.KPTURouter?.go(o.view,{source:'delegated'});
}
globalThis.window?.addEventListener?.('kptu:view-changed',e=>{const view=e.detail?.view;if(origin&&view!=='basket'&&view!==origin.view)origin=null;});
globalThis.document?.addEventListener?.('click',e=>{const b=e.target.closest?.('[data-basket-return]');if(!b)return;e.preventDefault();returnFromBasketNote();});
