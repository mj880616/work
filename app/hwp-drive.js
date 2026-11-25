// HWP-편집기 2단계: 자료실 문서·바구니 첨부(HWP·HWPX)를 편집기로 열고 Drive에 저장하는 요청.
// - 열기·덮어쓰기: document-actions `hwp-open`·`hwp-overwrite`. 파일·업무공간은 서버가 DB에서 정한다.
// - 새 파일로 저장(기본): 자료실은 library-files로 새 자료 등록, 바구니는 basket-files로 같은 메모에 첨부 추가.
// 어떤 요청도 자동으로 다시 보내지 않는다. 400대 거절은 "바뀐 것 없음", 시간 초과·5xx·응답 이상은 "결과 불명"이다.
// 서버가 아직 배포되지 않았으면 열기가 거절되어 편집기에 Drive 파일이 들어오지 않으므로 아무것도 바뀌지 않는다.
import {weeklySaveCategory,weeklyCategoryOf,weeklyCategoryLabel,loadDocumentCategories,documentCategories,documentCategoriesLoaded,addDocumentCategory,categoryParent,WEEKLY_PERSONAL_CATEGORY} from './document-categories.js'; // S53-16: '개인 확정본' 역할 분류(이름이 바뀌어도 표식으로)로 저장
import {sendUpload} from './upload-send.mjs';
import {trackUpload} from './upload-progress.js';
import {openInLibrary} from './upload-done.js'; // UX-올림보기그자료: 끝 알림 [보기] = 자료실에서 그 자료
import {readTextLater} from './document-text-read.js'; // SEARCH ②: 자료실에 새로 등록된 파일 안 글자를 서버가 한 번 읽어 둠
import {word} from './brand/brand.mjs';
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

// HWP-노조양식 1단계: 노조 문서 양식 HWP는 사용자가 자료실에 분류 "노조 서식"으로 등록해 둔 자료다(Drive 권한 확대 없음).
// [노조 양식으로 새 문서]는 그 자료를 기존 hwp-open 흐름으로 열되, 원본에는 덮어쓰지 않고 새 파일 제목을 사용자가 정한다.
// HWP-노조서식분류(요청함 11/16 07:26): 분류 이름은 '노조 서식'. 새로 등록할 때는 '노조 서식'만 쓰고, 예전 이름 '양식'으로 등록된 자료도
// 계속 찾는다(읽을 때 두 이름 모두 — 운영 자료 일괄 변경 없음). 자료실 꼬리표도 '양식' → '노조 서식'으로 보인다(document-categories.js LEGACY).
// S68-21(명진 11/22 17:04): 새로 만드는 분류 이름은 얼굴 단어 word('노조 서식') — WORK ON+ 기본 '서식', 명진 화면(nojo_words) '노조 서식' 그대로.
// 저장된 자료의 분류 값과 내 분류 목록의 이름은 바꾸지 않는다(DB 변경 없음). 찾을 때는 지금 이름·'노조 서식'·옛 '양식'을 모두 보고,
// 올릴 때 내 목록에 이미 '노조 서식'이 있으면(전에 올린 사람) 그 분류를 계속 쓴다(분류가 둘로 갈라지지 않게).
export const UNION_TEMPLATE_NOJO_CATEGORY='노조 서식';
export const UNION_TEMPLATE_CATEGORY=word('노조 서식');
// S68-02: 편집 백업 폴더 이름. 서버(_shared/hwp-edit.ts)가 실제로 쓴 폴더 이름(backup.folder)을 알려 주면 그대로,
// 모르면(옛 서버) 기본 이름 word('노조+ 편집 백업') — WORK ON+ 기본은 'WORK ON+ 편집 백업', 명진 화면은 그대로.
// S69-42: 서버가 편집 백업 폴더를 쓸 때 옛 이름을 새 이름으로 바꾸므로 기본 이름도 누구나 새 이름(서버 _shared/brand-folders.mjs).
export const EDIT_BACKUP_FOLDER='WORK ON+ 편집 백업';
export const backupFolderName=name=>typeof name==='string'&&name.trim()&&name.length<=100&&!/["\n]/.test(name)?name.trim():EDIT_BACKUP_FOLDER;
export const UNION_TEMPLATE_OLD_CATEGORY='양식';
/** 서식 자료로 찾을 분류 값들(지금 이름이 맨 앞, 겹침 없이). current = 이 사람의 지금 이름(얼굴 단어). */
export const templateCategoriesFor=current=>Object.freeze([...new Set([String(current||UNION_TEMPLATE_NOJO_CATEGORY),UNION_TEMPLATE_NOJO_CATEGORY,UNION_TEMPLATE_OLD_CATEGORY])]);
/** 올릴 때 쓸 분류: 내 목록에 지금 이름이 있으면 그것, 없고 '노조 서식'이 있으면 그것(전에 만든 분류 계속), 둘 다 없으면 지금 이름(새로 더함). */
export function templateSaveCategory(list,current=UNION_TEMPLATE_CATEGORY){
  const names=Array.isArray(list)?list:[];
  return [current,UNION_TEMPLATE_NOJO_CATEGORY].find(name=>names.includes(name))||current;
}
export const UNION_TEMPLATE_CATEGORIES=templateCategoriesFor(UNION_TEMPLATE_CATEGORY);
export const isUnionTemplateCategory=value=>UNION_TEMPLATE_CATEGORIES.includes(String(value??''));
const UNION_HINT=/노조|문서\s*스타일|통일/;
const isUnionTemplateRow=row=>row&&typeof row.id==='string'&&isUnionTemplateCategory(row.category)&&/\.hwp$/i.test(String(row.file_name||''));
export function pickUnionTemplate(rows){
  const list=(Array.isArray(rows)?rows:[]).filter(isUnionTemplateRow);
  const hinted=list.filter(row=>UNION_HINT.test(`${row.title||''} ${row.file_name||''}`));
  const pool=hinted.length?hinted:list;
  const sorted=[...pool].sort((a,b)=>String(a.title||a.file_name).localeCompare(String(b.title||b.file_name),'ko'));
  return {chosen:sorted[0]||null,others:sorted.slice(1),total:list.length};
}
export const UNION_TEMPLATE_FILTER='in.('+encodeURIComponent(UNION_TEMPLATE_CATEGORIES.map(name=>`"${name}"`).join(','))+')';
async function templateRows({rt}){
  const workspace=rt?.context?.read?.()?.workspace?.id;
  if(!workspace||typeof rt?.api!=='function')throw failure('session',HWP_TEXT.session);
  return rt.api(`/rest/v1/app_documents?workspace_id=eq.${encodeURIComponent(workspace)}&category=${UNION_TEMPLATE_FILTER}&select=id,title,file_name,category&order=created_at.desc&limit=50`,{singleFlight:false});
}
export async function findUnionTemplate({rt=window.KPTURuntime}={}){
  return pickUnionTemplate(await templateRows({rt}));
}

// HWP-서식변환: 문서 종류(보고서·공문·회의자료)별 빈 양식도 같은 자료실 분류 "노조 서식"(옛 "양식")의 HWP다. 이름(자료명·파일 이름)에 종류 낱말이 든 것을 먼저 쓰고,
// 없으면 종류 낱말이 없는 일반 노조 양식을 쓴다(specific:false). 다른 종류의 양식은 쓰지 않는다(공문에 보고서 양식을 넣지 않는다).
export const CONVERT_TYPE_HINTS=Object.freeze({report:/보고/,letter:/공문/,meeting:/회의/});
export function pickConvertTemplate(rows,docType){
  const list=(Array.isArray(rows)?rows:[]).filter(isUnionTemplateRow);
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
// UI-올리기진행표시 ②: 파일을 보내는 요청(FormData)은 공용 길(upload-send.mjs, 실제 보낸 양)로 보내고 공용 표시(upload-progress.js)를 붙인다.
// 시간 한도·결과 불명 규칙은 그대로(한 번만 보내고, 한도가 지나면 결과 불명). ✕(취소)는 다 보내기 전만 — 그때는 아무것도 바뀌지 않는다.
// fetcher를 넘긴 시험은 지금처럼 그 fetcher로 보낸다(보낸 양 없음).
// UX-올림보기그자료(S64-12): 자료실에 자료를 만들거나 바꾼 올리기(library-files 답의 자료 id, 자료실 문서 덮어쓰기는 그 문서 id — doc)는
// 하단 한 줄 [보기]가 시작한 화면(홈 › 주간 보고는 홈 하루로 돌아갔다) 대신 자료실에서 그 자료를 연다. 바구니 첨부는 지금처럼 시작한 화면.
const LIBRARY_FILES='/functions/v1/library-files';
const savedDocId=(path,text,doc)=>{
  if(typeof doc==='string'&&doc)return doc;
  if(path!==LIBRARY_FILES)return '';
  try{const data=JSON.parse(text);return data?.ok===true&&typeof data.document?.id==='string'?data.document.id:''}catch{return ''}
};
const openSaved=id=>()=>{void openInLibrary(id).catch(()=>{/* 자료실을 열지 못하면 그대로 */})};
async function send(rt,path,body,{timeoutMs=120000,fetcher,doc=''}={}){
  const s=await session(rt);
  let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('unknown','timeout')),timeoutMs)});
  const headers={apikey:rt.config.key,Authorization:'Bearer '+s.access_token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})};
  const file=body instanceof FormData&&!fetcher?body.get('file'):null;
  const job=file?trackUpload({file,name:file.name,size:file.size}):null;
  try{
    if(job){
      const r=await Promise.race([sendUpload(rt.config.url+path,{headers,body,size:file.size||0,timeoutMs:0,signal:job.signal,onProgress:job.progress}),deadline]);
      if(r.ok){const id=savedDocId(path,r.text,doc);job.done(id?{back:openSaved(id)}:undefined)}else job.fail(HWP_TEXT.refused);
      return {ok:r.ok,status:r.status,headers:new Headers(),json:async()=>JSON.parse(r.text)};
    }
    return await Promise.race([(fetcher||fetch)(rt.config.url+path,{method:'POST',cache:'no-store',headers,body:body instanceof FormData?body:JSON.stringify(body)}),deadline]);
  }catch(err){
    if(err?.code==='upload_cancelled')throw failure('cancelled','cancelled');
    job?.fail('저장했는지 확인하지 못했어요.');
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
  if(error?.kind==='cancelled')return {kind:'refused',message:'업로드를 취소했어요. 아무것도 바뀌지 않았어요.'};
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
    // 양식에서 시작한 새 문서: 양식 자료의 분류("노조 서식")·태그를 물려받지 않는다. 분류·프로젝트는 자료실에서 정한다.
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
// (분류 "노조 서식"을 달지 않는다: 서식 목록에 섞이지 않게). 한 번만 보내고 결과를 모르면 다시 보내지 않는다.
export async function saveConvertedCopy(bytes,{fileName,title},{rt=window.KPTURuntime,fetcher}={}){
  const form=new FormData();
  form.append('file',new File([bytes],newDocumentFileName(String(fileName||'').replace(/\.hwpx?$/i,'')||title),{type:'application/x-hwp'}));
  form.append('title',String(title||'').trim()||'새 문서');
  let response;
  try{response=await send(rt,'/functions/v1/library-files',form,{fetcher})}catch(error){return newFileOutcome({error},'자료실')}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&typeof data.document?.id==='string'){readTextLater(data.document,{rt});return {kind:'created',document:{id:data.document.id,title:String(data.document.title||'')},message:word('자료실에 새 문서로 저장했어요. 분류·사업영역은 자료실에서 정해 주세요.')};}
  return newFileOutcome(response.ok?{status:0}:{status:response.status,data},'자료실');
}

// HWP-노조서식분류: 자료실 분류 '노조 서식'이 내 분류 목록에 없으면 기존 분류 추가 함수(app_document_category_add)로 한 번 더한다("폴더 없으면 만들고").
// 목록을 못 읽었거나(기본 7개뿐), 30개가 찼거나, 추가가 실패해도 올리기는 막지 않는다(자료는 '노조 서식' 값으로 저장되고 꼬리표만 '기타'로 보임).
// S68-21: 쓸 분류 이름은 templateSaveCategory(내 목록에 있는 지금 이름 → '노조 서식' → 새로 더할 지금 이름). 답 {ok, category}.
export async function unionFormCategory({rt=window.KPTURuntime}={}){
  try{await loadDocumentCategories({rt});}catch{return {ok:false,category:UNION_TEMPLATE_CATEGORY}}
  const list=documentCategories(),category=templateSaveCategory(list);
  if(list.includes(category))return {ok:true,category};
  if(list.length>=30)return {ok:false,category};
  try{return {ok:(await addDocumentCategory(category,{rt})).ok===true,category};}catch{return {ok:false,category}}
}
export async function ensureUnionFormCategory(opts={}){
  return (await unionFormCategory(opts)).ok;
}
// 서식 파일 올리기 규칙: 한글 파일(.hwp·.hwpx)만, 30MB까지. hwpOnly면 .hwp만([노조 서식으로 만들기]의 칸막이 엔진은 HWP 5 바탕만 받음).
export function unionFormFileProblem(file,{hwpOnly=false}={}){
  if(!file)return '파일을 읽지 못했어요.';
  const name=String(file.name||'');
  if(hwpOnly&&/\.hwpx$/i.test(name))return '한글(.hwp) 파일만 서식으로 쓸 수 있어요. 한글에서 다른 이름으로 저장 → .hwp로 저장해 올려 주세요.';
  if(!(hwpOnly?/\.hwp$/i:/\.hwpx?$/i).test(name))return hwpOnly?'한글(.hwp) 파일만 올릴 수 있어요.':'한글 파일(.hwp·.hwpx)만 올릴 수 있어요.';
  if(!(file.size>0))return '빈 파일이에요. 다른 파일을 선택해 주세요.';
  if(file.size>HWP_EDIT_MAX_BYTES)return '파일이 30MB보다 커서 올리지 않아요.';
  return '';
}
// 서식 파일 원본을 자료실에 분류 '노조 서식'으로 등록한다(기존 library-files — 내 Drive 자료실 폴더, owner 전용 자료 1행). 자료명은 파일 이름에서
// 정해 보내므로 서버가 내용을 읽어 이름을 짐작하지 않는다. 한 번만 보내고 결과를 모르면 다시 보내지 않는다. 로컬 저장 없음.
export async function saveUnionForm(file,{title}={},{rt=window.KPTURuntime,fetcher}={}){
  const {category}=await unionFormCategory({rt});
  const name=String(file?.name||'서식.hwp');
  const form=new FormData();
  form.append('file',file instanceof File?file:new File([file],name,{type:/\.hwpx$/i.test(name)?'application/hwp+zip':'application/x-hwp'}));
  form.append('title',String(title||'').trim()||name.replace(/\.hwpx?$/i,'').trim()||category);
  form.append('category',category);
  let response;
  try{response=await send(rt,'/functions/v1/library-files',form,{fetcher})}catch(error){return newFileOutcome({error},'자료실')}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&typeof data.document?.id==='string'){
    try{window.dispatchEvent(new CustomEvent('kptu:documents-changed'))}catch{/* 목록 새로 고침 알림만 */}
    return {kind:'created',document:{id:data.document.id,title:String(data.document.title||''),file_name:String(data.document.file_name||name),category},message:`자료실 '${category}'에 올렸어요.`};
  }
  return newFileOutcome(response.ok?{status:0}:{status:response.status,data},'자료실');
}

// S67-29 상집 논의 요청 문서: 줄에 붙인 한글 파일 원본을 자료실에 새 자료로 등록한다(기존 library-files — 내 Drive 자료실 폴더, owner 전용 자료 1행).
// 분류는 비워 두고(자료실에서 정함), 자료명은 파일 이름에서 정해 보내므로 서버가 내용을 읽어 이름을 짐작하지 않는다. 한 번만 보내고 결과를 모르면 다시 보내지 않는다.
export async function saveDiscussDoc(file,{rt=window.KPTURuntime,fetcher}={}){
  const name=String(file?.name||'논의 요청.hwp');
  const form=new FormData();
  form.append('file',file instanceof File?file:new File([file],name,{type:/\.hwpx$/i.test(name)?'application/hwp+zip':'application/x-hwp'}));
  form.append('title',name.replace(/\.hwpx?$/i,'').trim()||'논의 요청');
  let response;
  try{response=await send(rt,'/functions/v1/library-files',form,{fetcher})}catch(error){return newFileOutcome({error},'자료실')}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&typeof data.document?.id==='string'){
    readTextLater(data.document,{rt});
    try{window.dispatchEvent(new CustomEvent('kptu:documents-changed'))}catch{/* 목록 새로 고침 알림만 */}
    return {kind:'created',document:{id:data.document.id,file_name:String(data.document.file_name||name)},message:'자료실에 올렸어요.'};
  }
  return newFileOutcome(response.ok?{status:0}:{status:response.status,data},'자료실');
}

// WEEKLY-한글초안 2단계 [확정]: the weekly report file made in the browser goes to the library like any upload (library-files:
// the owner's Drive library folder under drive.file, one private app_documents row). Title, category and date are given, so
// the server does not read the content to guess a title. One request, never repeated; an unknown outcome says to check first.
// S53-16 WEEKLY-분류이름바뀜: 저장 분류는 이름 글자가 아니라 '개인 확정본' 역할(document-categories.js weeklySaveCategory). 내 분류 목록을 먼저 읽는다(한 번만, 못 읽으면 옛 이름).
// LIB-기본분류흔적빼기(명진 11/17): 주간보고 분류는 기본 목록에 없다. 처음 [확정] 저장할 때 내 목록에 '개인 확정본' 역할 분류가 없으면
// 그때 기존 분류 추가 함수(app_document_category_add)로 '주간보고'·'주간보고›개인 확정본'을 더한다(있는 것은 건너뜀).
// 목록을 못 읽었거나 30개가 찼거나 추가가 실패해도 저장은 막지 않는다(옛 이름으로 저장되고 바탕 찾기는 옛 이름도 찾음).
export async function ensureWeeklyPersonalCategory({rt=window.KPTURuntime}={}){
  try{await loadDocumentCategories({rt});}catch{return false}
  if(!documentCategoriesLoaded())return false; // 내 목록을 모르면 더하지 않는다(분류 고치기 창과 같은 규칙)
  if(weeklyCategoryOf('personal'))return true;
  const parent=categoryParent(WEEKLY_PERSONAL_CATEGORY),missing=[parent,WEEKLY_PERSONAL_CATEGORY].filter(name=>!documentCategories().includes(name));
  if(documentCategories().length+missing.length>30)return false;
  for(const name of missing){try{if((await addDocumentCategory(name,{rt})).ok!==true)return false;}catch{return false}}
  return !!weeklyCategoryOf('personal');
}
export async function saveWeeklyReport(bytes,{fileName,title,documentDate},{rt=window.KPTURuntime,fetcher}={}){
  await ensureWeeklyPersonalCategory({rt});
  const category=weeklySaveCategory('personal');
  const form=new FormData();
  form.append('file',new File([bytes],fileName,{type:/\.hwpx$/i.test(fileName)?'application/hwp+zip':'application/x-hwp'}));
  form.append('title',title);
  form.append('category',category);
  if(documentDate)form.append('document_date',documentDate);
  let response;
  try{response=await send(rt,'/functions/v1/library-files',form,{fetcher})}catch(error){return newFileOutcome({error},'자료실')}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&typeof data.document?.id==='string'){readTextLater(data.document,{rt});return {kind:'created',document:{id:data.document.id,title:String(data.document.title||'')},message:`자료실에 "${weeklyCategoryLabel('personal')}" 분류로 저장했어요(Drive 자료실 폴더).`};}
  return newFileOutcome(response.ok?{status:0}:{status:response.status,data},'자료실');
}

// WEEKLY-한흐름확정 ②(명진 결정 ②): 같은 주를 다시 확정하면 그 주 개인본 자료의 파일만 새 판으로 바꾼다(library-files replace_document_id —
// 제목·분류·날짜는 그대로, 옛 판은 [이전 파일]에 30일). 자료가 없어졌으면 {kind:'gone'}(부르는 쪽이 새 자료로). 한 번만 보내고 모르는 결과는 확인을 부탁한다.
export async function replaceWeeklyReport(bytes,{fileName,documentId},{rt=window.KPTURuntime,fetcher}={}){
  const form=new FormData();
  form.append('file',new File([bytes],fileName,{type:/\.hwpx$/i.test(fileName)?'application/hwp+zip':'application/x-hwp'}));
  form.append('replace_document_id',documentId);
  let response;
  try{response=await send(rt,'/functions/v1/library-files',form,{fetcher})}catch(error){return newFileOutcome({error},'자료실')}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&data.document?.id===documentId){readTextLater(data.document,{rt});return {kind:'replaced',document:{id:documentId,title:String(data.document.title||'')},message:'자료실 개인 확정본을 새 판으로 바꿨어요. 옛 판은 30일 동안 [이전 파일]에 있어요.'};}
  if(response.status===404)return {kind:'gone',message:'바꿀 개인 확정본이 자료실에 없어요.'};
  return newFileOutcome(response.ok?{status:0}:{status:response.status,data},'자료실');
}

// 바구니: the HWP is added to the same note as a new attachment (basket-files). The note decides the workspace.
export async function saveBasketCopy(target,bytes,{rt=window.KPTURuntime,fetcher}={}){
  const form=new FormData();
  form.append('file',new File([bytes],editedName(target.fileName),{type:'application/x-hwp'}));
  form.append('note_id',target.noteId);
  let response;
  try{response=await send(rt,'/functions/v1/basket-files',form,{fetcher})}catch(error){return newFileOutcome({error},'잊지 말기 업데이트')}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&data.note_id===target.noteId&&Array.isArray(data.attachments)){
    try{window.dispatchEvent(new CustomEvent('kptu:api-saved',{detail:{path:'/functions/v1/basket-files',method:'POST',fields:['attachments'],action:'',projectLinked:false}}))}catch{/* A listener cannot undo a saved attachment. */}
    return {kind:'created',message:'같은 업데이트에 새 첨부로 추가했어요. 원본은 그대로예요.'};
  }
  if(response.status===409&&data?.code==='note_changed')return {kind:'refused',message:'업데이트가 그사이 바뀌어 첨부하지 않았어요. 아무것도 바뀌지 않았어요.'};
  return newFileOutcome(response.ok?{status:0}:{status:response.status,data},'잊지 말기 업데이트');
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
  try{response=await send(rt,'/functions/v1/document-actions',form,{fetcher,doc:target.kind==='library'?target.document.id:''})}
  catch(err){return err.kind==='session'?{kind:'session',message:HWP_TEXT.session}:{kind:'unknown',message:HWP_TEXT.overwriteUnknown}}
  const data=await readJson(response);
  if(response.ok&&data?.ok===true&&data.result==='overwritten'&&typeof data.revision==='string'&&typeof data.md5==='string'&&typeof data.backup?.name==='string')
    return {kind:'overwritten',revision:data.revision,md5:data.md5,message:`원본에 덮어썼어요. 수정 전 사본은 Drive "${backupFolderName(data.backup.folder)}" 폴더에 "${data.backup.name}"으로 보관했어요.`};
  if(response.status===401)return {kind:'session',message:HWP_TEXT.session};
  if(response.status===409&&data?.code==='VERSION_CHANGED')return {kind:'changed',message:'연 뒤에 Drive의 원본이 바뀌어 덮어쓰지 않았어요. [새 파일로 저장]을 써 주세요.'};
  if(response.status===409&&data?.code==='SHARED_CONFIRM_REQUIRED')return {kind:'shared',message:'잊지 말기와 자료실이 같은 원본을 써요. 다시 [원본에 덮어쓰기]를 눌러 확인해 주세요. 아무것도 바뀌지 않았어요.'};
  if(response.status===400&&OLD_SERVER.has(String(data?.error||'')))return {kind:'refused',message:HWP_TEXT.notReady};
  if([400,403,404,405,409].includes(response.status))return {kind:'refused',message:[HWP_TEXT.refused,data?.error].filter(Boolean).join(' ')};
  return {kind:'unknown',message:HWP_TEXT.overwriteUnknown};
}
