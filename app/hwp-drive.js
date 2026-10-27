// HWP-편집기 2단계: 자료실 문서·바구니 첨부(HWP·HWPX)를 편집기로 열고 Drive에 저장하는 요청.
// - 열기·덮어쓰기: document-actions `hwp-open`·`hwp-overwrite`. 파일·업무공간은 서버가 DB에서 정한다.
// - 새 파일로 저장(기본): 자료실은 library-files로 새 자료 등록, 바구니는 basket-files로 같은 메모에 첨부 추가.
// 어떤 요청도 자동으로 다시 보내지 않는다. 400대 거절은 "바뀐 것 없음", 시간 초과·5xx·응답 이상은 "결과 불명"이다.
// 서버가 아직 배포되지 않았으면 열기가 거절되어 편집기에 Drive 파일이 들어오지 않으므로 아무것도 바뀌지 않는다.
import {readTextLater} from './document-text-read.js'; // SEARCH ②: 자료실에 새로 등록된 파일 안 글자를 서버가 한 번 읽어 둠
export const HWP_EDIT_MAX_BYTES=30*1024*1024;
const OLD_SERVER=new Set(['document_id가 필요합니다.','Unknown action']);
export const HWP_TEXT={
  notReady:'HWP 편집 서버가 아직 준비되지 않았어요. 아무것도 바뀌지 않았어요.',
  session:'로그인을 확인하지 못했어요. 다시 로그인한 뒤 해 주세요. 아무것도 바뀌지 않았어요.',
  openFailed:'파일을 열지 못했어요. 아무것도 바뀌지 않았어요.',
  newUnknown:'저장했는지 확인하지 못했어요. 다시 저장하지 말고 {where}에서 먼저 확인해 주세요.',
  overwriteUnknown:'덮어쓰기 결과를 확인하지 못했어요. 다시 저장하지 말고 Drive에서 원본을 먼저 확인해 주세요.',
  refused:'저장하지 못했어요. 아무것도 바뀌지 않았어요.',
};
export const isHwpName=name=>/\.hwpx?$/i.test(String(name||''));
export const editedName=name=>`${String(name||'문서').replace(/\.(hwpx?)$/i,'').trim()||'문서'}-수정.hwp`;

// HWP-노조양식 1단계: 노조 문서 양식 HWP는 사용자가 자료실에 분류 "양식"으로 한 번 등록해 둔 자료다(Drive 권한 확대 없음).
// [노조 양식으로 새 문서]는 그 자료를 기존 hwp-open 흐름으로 열되, 원본에는 덮어쓰지 않고 새 파일 제목을 사용자가 정한다.
export const UNION_TEMPLATE_CATEGORY='양식';
const UNION_HINT=/노조|문서\s*스타일|통일/;
export function pickUnionTemplate(rows){
  const list=(Array.isArray(rows)?rows:[]).filter(row=>row&&typeof row.id==='string'&&row.category===UNION_TEMPLATE_CATEGORY&&/\.hwp$/i.test(String(row.file_name||'')));
  const hinted=list.filter(row=>UNION_HINT.test(`${row.title||''} ${row.file_name||''}`));
  const pool=hinted.length?hinted:list;
  const sorted=[...pool].sort((a,b)=>String(a.title||a.file_name).localeCompare(String(b.title||b.file_name),'ko'));
  return {chosen:sorted[0]||null,others:sorted.slice(1),total:list.length};
}
async function templateRows({rt}){
  const workspace=rt?.context?.read?.()?.workspace?.id;
  if(!workspace||typeof rt?.api!=='function')throw failure('session',HWP_TEXT.session);
  return rt.api(`/rest/v1/app_documents?workspace_id=eq.${encodeURIComponent(workspace)}&category=eq.${encodeURIComponent(UNION_TEMPLATE_CATEGORY)}&select=id,title,file_name,category&order=created_at.desc&limit=50`,{singleFlight:false});
}
export async function findUnionTemplate({rt=window.KPTURuntime}={}){
  return pickUnionTemplate(await templateRows({rt}));
}

// HWP-서식변환: 문서 종류(보고서·공문·회의자료)별 빈 양식도 같은 자료실 분류 "양식"의 HWP다. 이름(자료명·파일 이름)에 종류 낱말이 든 것을 먼저 쓰고,
// 없으면 종류 낱말이 없는 일반 노조 양식을 쓴다(specific:false). 다른 종류의 양식은 쓰지 않는다(공문에 보고서 양식을 넣지 않는다).
export const CONVERT_TYPE_HINTS=Object.freeze({report:/보고/,letter:/공문/,meeting:/회의/});
export function pickConvertTemplate(rows,docType){
  const list=(Array.isArray(rows)?rows:[]).filter(row=>row&&typeof row.id==='string'&&row.category===UNION_TEMPLATE_CATEGORY&&/\.hwp$/i.test(String(row.file_name||'')));
  const nameOf=row=>`${row.title||''} ${row.file_name||''}`;
  const hint=CONVERT_TYPE_HINTS[docType];
  const byName=(a,b)=>String(a.title||a.file_name).localeCompare(String(b.title||b.file_name),'ko');
  const typed=hint?list.filter(row=>hint.test(nameOf(row))).sort(byName):[];
  if(typed.length)return {chosen:typed[0],specific:true};
  const generic=list.filter(row=>!Object.values(CONVERT_TYPE_HINTS).some(re=>re.test(nameOf(row))));
  const picked=pickUnionTemplate(generic).chosen;
  return {chosen:picked,specific:false};
}
export async function findConvertTemplate(docType,{rt=window.KPTURuntime}={}){
  return pickConvertTemplate(await templateRows({rt}),docType);
}

// 양식에서 시작한 새 문서의 파일 이름: 사용자가 정한 제목(파일 이름에 못 쓰는 글자는 뺀다).
export const newDocumentFileName=title=>`${String(title||'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,' ').replace(/\s+/g,' ').replace(/\.(hwpx?)$/i,'').trim().slice(0,80)||'새 문서'}.hwp`;

// One-shot in-app hand-off from the library or basket to the editor view, bound to the signed-in user and
// workspace for one minute, like the library and task hand-offs. Nothing is kept in browser storage.
const REQUEST_MS=60*1000;
let pending=null;
const scopeOf=rt=>{const c=rt?.context?.read?.();return c?.user?.id&&c?.workspace?.id?`${c.user.id}:${c.workspace.id}`:''};
export function requestHwpEdit(target,rt=window.KPTURuntime){
  const scope=scopeOf(rt);
  pending=scope&&target&&(target.kind==='library'?typeof target.document?.id==='string':typeof target.noteId==='string'&&typeof target.fileId==='string')?{target,scope,at:Date.now()}:null;
  return !!pending;
}
export function takeHwpEditRequest(rt=window.KPTURuntime){
  const value=pending;pending=null;
  return value&&value.scope===scopeOf(rt)&&Date.now()-value.at<REQUEST_MS?value.target:null;
}
export function hasHwpEditRequest(){return !!pending}

const failure=(kind,message,extra={})=>Object.assign(new Error(message),{kind,...extra});
async function session(rt){
  if(!(await rt.session.ensure()))throw failure('session',HWP_TEXT.session);
  const value=rt.session.read();
  if(!value?.access_token)throw failure('session',HWP_TEXT.session);
  return value;
}
// One request, never repeated. A timeout leaves the outcome unknown; the caller decides what that means.
async function send(rt,path,body,{timeoutMs=120000,fetcher=fetch}={}){
  const s=await session(rt);
  let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('unknown','timeout')),timeoutMs)});
  try{
    return await Promise.race([fetcher(rt.config.url+path,{method:'POST',cache:'no-store',headers:{apikey:rt.config.key,Authorization:'Bearer '+s.access_token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)}),deadline]);
  }catch(err){
    if(err?.kind)throw err;
    throw failure('unknown','network');
  }finally{clearTimeout(timer)}
}
const readJson=async response=>{try{return await response.json()}catch{return null}};
const sourceBody=target=>target.kind==='library'?{document_id:target.document.id}:{note_id:target.noteId,drive_file_id:target.fileId};

export async function openHwpFromDrive(target,{rt=window.KPTURuntime,fetcher}={}){
  let response;
  try{response=await send(rt,'/functions/v1/document-actions',{action:'hwp-open',...sourceBody(target)},{timeoutMs:90000,fetcher})}
  catch(err){if(err.kind==='session')throw err;throw failure('refused',HWP_TEXT.openFailed+' 네트워크를 확인한 뒤 다시 열어 주세요.')}
  if(response.ok){
    let info;
    try{info=JSON.parse(decodeURIComponent(response.headers.get('X-Web2-Hwp')||''))}catch{info=null}
    const bytes=new Uint8Array(await response.arrayBuffer().catch(()=>new ArrayBuffer(0)));
    if(!info||!['hwp','hwpx'].includes(info.format)||typeof info.revision!=='string'||typeof info.md5!=='string'||bytes.length!==info.size)throw failure('refused',HWP_TEXT.openFailed);
    return {bytes,info};
  }
  const data=await readJson(response);
  if(response.status===401)throw failure('session',HWP_TEXT.session);
  // The gateway refuses these before the function runs; an older function does not know the action.
  if([403,404,405].includes(response.status)||OLD_SERVER.has(String(data?.error||'')))throw failure('refused',HWP_TEXT.notReady);
  throw failure('refused',[HWP_TEXT.openFailed,data?.error].filter(Boolean).join(' '));
}

export function newFileOutcome({status,data,error},where){
  if(error?.kind==='session')return {kind:'session',message:HWP_TEXT.session};
  if(error)return {kind:'unknown',message:HWP_TEXT.newUnknown.replace('{where}',where)};
  if(status===401)return {kind:'session',message:HWP_TEXT.session};
  if(status>=400&&status<500)return {kind:'refused',message:[HWP_TEXT.refused,data?.message||data?.error].filter(Boolean).join(' '),code:data?.code};
  return {kind:'unknown',message:HWP_TEXT.newUnknown.replace('{where}',where)};
}

// 자료실: a new private library document in the library folder (library-files). The server checks the owner and the
// project/meeting; the title is given so no file content leaves for title inference.
export async function saveLibraryCopy(target,bytes,{rt=window.KPTURuntime,fetcher,newTitle}={}){
  const doc=target.document,form=new FormData();
  if(target.template){
    // 양식에서 시작한 새 문서: 양식 자료의 분류("양식")·태그를 물려받지 않는다. 분류·프로젝트는 자료실에서 정한다.
    const title=String(newTitle||'').trim()||'새 문서';
    form.append('file',new File([bytes],newDocumentFileName(title),{type:'application/x-hwp'}));
    form.append('title',title);
  }else{
    form.append('file',new File([bytes],editedName(doc.file_name),{type:'application/x-hwp'}));
    form.append('title',`${String(doc.title||doc.file_name||'문서').trim()} (수정)`);
    for(const key of ['category','source','document_date','project_id','meeting_id'])if(doc[key])form.append(key,String(doc[key]));
    if(Array.isArray(doc.tags)&&doc.tags.length)form.append('tags',doc.tags.join(','));
  }
  let response;
  try{response=await send(rt,'/functions/v1/library-files',form,{fetcher})}catch(error){return newFileOutcome({error},'자료실')}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&typeof data.document?.id==='string'){readTextLater(data.document,{rt});return {kind:'created',document:{id:data.document.id,title:String(data.document.title||'')},message:'자료실에 새 문서로 등록했어요. 원본은 그대로예요.'};}
  return newFileOutcome(response.ok?{status:0}:{status:response.status,data},'자료실');
}

// HWP-서식변환 [자료실에 저장]: [노조 서식으로 만들기]로 만든 한글 파일을 자료실에 새 자료로 등록한다(library-files).
// 자료명과 파일 이름은 화면이 정해 보내므로 서버가 파일 내용을 읽어 이름을 짐작하지 않는다. 분류·프로젝트는 비워 두고 자료실에서 정한다
// (분류 "양식"을 달지 않는다: 양식 목록에 섞이지 않게). 한 번만 보내고 결과를 모르면 다시 보내지 않는다.
export async function saveConvertedCopy(bytes,{fileName,title},{rt=window.KPTURuntime,fetcher}={}){
  const form=new FormData();
  form.append('file',new File([bytes],newDocumentFileName(String(fileName||'').replace(/\.hwpx?$/i,'')||title),{type:'application/x-hwp'}));
  form.append('title',String(title||'').trim()||'새 문서');
  let response;
  try{response=await send(rt,'/functions/v1/library-files',form,{fetcher})}catch(error){return newFileOutcome({error},'자료실')}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&typeof data.document?.id==='string'){readTextLater(data.document,{rt});return {kind:'created',document:{id:data.document.id,title:String(data.document.title||'')},message:'자료실에 새 문서로 저장했어요. 분류·프로젝트는 자료실에서 정해 주세요.'};}
  return newFileOutcome(response.ok?{status:0}:{status:response.status,data},'자료실');
}

// WEEKLY-한글초안 2단계 [확정]: the weekly report file made in the browser goes to the library like any upload (library-files:
// the owner's Drive library folder under drive.file, one private app_documents row). Title, category and date are given, so
// the server does not read the content to guess a title. One request, never repeated; an unknown outcome says to check first.
export const WEEKLY_CONFIRMED_CATEGORY='주간보고 개인본';
export async function saveWeeklyReport(bytes,{fileName,title,documentDate},{rt=window.KPTURuntime,fetcher}={}){
  const form=new FormData();
  form.append('file',new File([bytes],fileName,{type:/\.hwpx$/i.test(fileName)?'application/hwp+zip':'application/x-hwp'}));
  form.append('title',title);
  form.append('category',WEEKLY_CONFIRMED_CATEGORY);
  if(documentDate)form.append('document_date',documentDate);
  let response;
  try{response=await send(rt,'/functions/v1/library-files',form,{fetcher})}catch(error){return newFileOutcome({error},'자료실')}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&typeof data.document?.id==='string'){readTextLater(data.document,{rt});return {kind:'created',document:{id:data.document.id,title:String(data.document.title||'')},message:`자료실에 "${WEEKLY_CONFIRMED_CATEGORY}" 분류로 저장했어요(Drive 자료실 폴더).`};}
  return newFileOutcome(response.ok?{status:0}:{status:response.status,data},'자료실');
}

// 바구니: the HWP is added to the same note as a new attachment (basket-files). The note decides the workspace.
export async function saveBasketCopy(target,bytes,{rt=window.KPTURuntime,fetcher}={}){
  const form=new FormData();
  form.append('file',new File([bytes],editedName(target.fileName),{type:'application/x-hwp'}));
  form.append('note_id',target.noteId);
  let response;
  try{response=await send(rt,'/functions/v1/basket-files',form,{fetcher})}catch(error){return newFileOutcome({error},'정리함 업데이트')}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&data.note_id===target.noteId&&Array.isArray(data.attachments)){
    try{window.dispatchEvent(new CustomEvent('kptu:api-saved',{detail:{path:'/functions/v1/basket-files',method:'POST',fields:['attachments'],action:'',projectLinked:false}}))}catch{/* A listener cannot undo a saved attachment. */}
    return {kind:'created',message:'같은 업데이트에 새 첨부로 추가했어요. 원본은 그대로예요.'};
  }
  if(response.status===409&&data?.code==='note_changed')return {kind:'refused',message:'업데이트가 그사이 바뀌어 첨부하지 않았어요. 아무것도 바뀌지 않았어요.'};
  return newFileOutcome(response.ok?{status:0}:{status:response.status,data},'정리함 업데이트');
}

export async function overwriteHwp(target,bytes,info,{confirmShared=false,rt=window.KPTURuntime,fetcher}={}){
  const form=new FormData();
  form.append('action','hwp-overwrite');
  for(const [key,value] of Object.entries(sourceBody(target)))form.append(key,value);
  form.append('base_revision',info.revision);
  form.append('base_md5',info.md5);
  if(confirmShared)form.append('confirm_shared','1');
  form.append('file',new File([bytes],'edited.hwp',{type:'application/x-hwp'}));
  let response;
  try{response=await send(rt,'/functions/v1/document-actions',form,{fetcher})}
  catch(err){return err.kind==='session'?{kind:'session',message:HWP_TEXT.session}:{kind:'unknown',message:HWP_TEXT.overwriteUnknown}}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&data.result==='overwritten'&&typeof data.revision==='string'&&typeof data.md5==='string'&&typeof data.backup?.name==='string')
    return {kind:'overwritten',revision:data.revision,md5:data.md5,message:`원본에 덮어썼어요. 고치기 전 사본은 Drive "Web2 편집 백업" 폴더에 "${data.backup.name}"으로 보관했어요.`};
  if(response.status===401)return {kind:'session',message:HWP_TEXT.session};
  if(response.status===409&&data?.code==='VERSION_CHANGED')return {kind:'changed',message:'연 뒤에 Drive의 원본이 바뀌어 덮어쓰지 않았어요. [새 파일로 저장]을 써 주세요.'};
  if(response.status===409&&data?.code==='SHARED_CONFIRM_REQUIRED')return {kind:'shared',message:'정리함과 자료실이 같은 원본을 써요. 다시 [원본에 덮어쓰기]를 눌러 확인해 주세요. 아무것도 바뀌지 않았어요.'};
  if(response.status===400&&OLD_SERVER.has(String(data?.error||'')))return {kind:'refused',message:HWP_TEXT.notReady};
  if([400,403,404,405,409].includes(response.status))return {kind:'refused',message:[HWP_TEXT.refused,data?.error].filter(Boolean).join(' ')};
  return {kind:'unknown',message:HWP_TEXT.overwriteUnknown};
}
