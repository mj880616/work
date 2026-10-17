// BASKET-할일출처: Google tasks made from a basket note are listed in that
// note's metadata.tasks (newest first). No new table, policy or RPC: the write
// is an owner-RLS REST PATCH of metadata only, and the read is one contains
// query. updated_at stays the original's version (raw text and attachments),
// so an AI handoff or a photo-text read already in flight keeps its version.
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
  return `updated_at=eq.${encodeURIComponent(note.updated_at)}&metadata->write_request->>marked_at=${textGuard(request)}&metadata->tasks->0->>task_id=${textGuard(plainObject(first)?first.task_id:null)}`;
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
    if(!Array.isArray(rows))throw Error('출처 메모를 확인하지 못했어요.');
    for(const row of rows)for(const task of noteTasks({metadata:{tasks:row?.tasks}}))if(!out.has(task.task_id))out.set(task.task_id,row.id);
    if(rows.length<size)return out;
  }
}
// One-shot in-app hand-offs between the task view and the basket. Each is
// bound to the signed-in user and workspace and expires quickly.
const REQUEST_MS=60*1000;
const requests={note:null,notedoc:null,task:null};
const put=(kind,id,rt)=>{const scope=scopeOf(rt);requests[kind]=id&&scope?{id,scope,at:Date.now()}:null;};
const take=(kind,rt)=>{const value=requests[kind];requests[kind]=null;return value&&value.scope===scopeOf(rt)&&Date.now()-value.at<REQUEST_MS?value.id:null;};
export const requestBasketNote=(id,rt=window.KPTURuntime)=>put('note',id,rt);
export const takeBasketNoteRequest=(rt=window.KPTURuntime)=>take('note',rt);
// Menu [쓰기] → a note just saved opens on the basket's [노트] side.
export const requestNoteDocOpen=(id,rt=window.KPTURuntime)=>put('notedoc',id,rt);
export const takeNoteDocRequest=(rt=window.KPTURuntime)=>take('notedoc',rt);
export const requestTaskOpen=(id,rt=window.KPTURuntime)=>put('task',id,rt);
export const takeTaskOpenRequest=(rt=window.KPTURuntime)=>take('task',rt);
export const basketNoteHref=id=>`./?view=basket&note=${encodeURIComponent(id)}`;
