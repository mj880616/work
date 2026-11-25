import { isDelegatedToken } from "../_shared/delegated-token-guard.mjs";
import { createClient } from 'npm:@supabase/supabase-js@2';
// Not req.formData() for upload: Deno cuts quoted file names at ';' and '=' (see _shared/multipart.ts).
import { readMultipartForm } from '../_shared/multipart.ts';
import { withWebCors } from "../_shared/web-cors.ts";
import { callerOwnerWorkspace, WorkspaceDriveError, workspaceDriveToken } from '../_shared/workspace-drive-token.ts';
import { safeErrorLog, safeErrorMessage } from "../_shared/safe-error.ts";
// S69-20: 새 사용자 맨 위 드라이브 폴더 이름(이미 있는 폴더는 id로 찾고 이름을 바꾸지 않음).
import { ROOT_FOLDER_NAME } from '../_shared/brand-folders.mjs';
// S69-20 ①: 자료실 저장 위치 한 줄(드라이브 폴더 이름 경로·열기 주소). 폴더 이름만 읽고 파일 내용은 열지 않는다.
import { drivePlace, metaUrl, parsePlaceRequest } from './drive-place.mjs';
// S69-22: [앱 폴더 한곳에 모으기] — 명진이 누를 때만. 내 드라이브 맨 위의 앱 폴더를 맨 위 앱 폴더 아래로(부모만 바꿈, 지우지 않음).
// S69-41: 같은 누름에서 표식으로 알아본 앱 폴더의 옛 이름도 새 이름으로(이름·표식만, 사람이 바꾼 이름은 그대로).
import { gatherCandidates, gatherFolders, gatherIntoNewRoot, GatherError, parseGatherRequest, renameCandidates } from '../_shared/gather-folders.mjs';
// S69-20 ③④⑤: 자료실 앱 폴더 = 드라이브 폴더(앞으로 같게 'auto', [드라이브 폴더 맞추기] 'align'). 규칙은 library-mirror.mjs 한 곳.
import { DriveFail, MIRROR_BUDGET_MS, mirrorLibrary, parseMirrorBody } from '../_shared/library-mirror.mjs';
// S70-29(2026-11-25 명진 '다 없애 1회용 기능'): 자료실 ⋯ [드라이브와 맞는지 보기](POST ?action=drive-check)·[드라이브 폴더 맞추기](drive-mirror mode 'align')는 지웠다.
// 남은 것: drive-mirror 'auto'(앞으로 같게). _shared/library-drive-check.mjs(어긋남 판정)는 S70-29 지시대로 파일로 남긴다(지금 부르는 곳 없음).
const SB=Deno.env.get('SUPABASE_URL')!;const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;const admin=createClient(SB,SERVICE,{auth:{persistSession:false}});
const cors={'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};const json=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
// SEC-정리묶음: Google·AI 쪽 오류 원문은 서버 로그에만 남기고, 응답에는 우리 글(단계)만 싣는다.
const upstreamFail=(stage:string,message:string,status:number,detail:unknown)=>{console.error('workspace-drive '+stage+' failed',{status});return Object.assign(new Error(message),{stage})};
async function sha256(s:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
const authError=(m:string)=>Object.assign(new Error(m),{authRequired:true});
async function getUser(req:Request){const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)throw authError('로그인이 필요합니다.');const {data,error}=await admin.auth.getUser(token);const status=(error as any)?.status;if(error&&typeof status==='number'&&(status===0||status>=500))throw new Error('로그인 세션을 확인할 수 없습니다.');if(error||!data.user)throw authError('로그인 세션을 확인할 수 없습니다.');if(isDelegatedToken(token))throw authError('로그인 세션을 확인할 수 없습니다.');return data.user}
// MULTI ②-2: Drive 토큰은 로그인한 본인의 owner 작업공간(정확히 1개)이 이 요청의 작업공간과 같을 때 그 작업공간 연결만(_shared/workspace-drive-token.ts). id=1의 갱신 열쇠는 읽지 않는다.
async function driveAccessToken(userId:string,workspaceId:string){const own=await callerOwnerWorkspace(admin,userId);if(!own||own!==workspaceId)throw new Error('워크스페이스 소유자 권한이 필요합니다.');try{return await workspaceDriveToken(admin,own,{fetch})}catch(e){if(e instanceof WorkspaceDriveError&&e.code==='drive_not_connected')throw new Error('Google Drive가 아직 연결되지 않았어요. 자료실에서 Drive를 연결해 주세요.');if(e instanceof WorkspaceDriveError&&e.code==='drive_auth_expired')throw new Error('Google Drive 연결이 만료됐어요. 자료실에서 Drive를 다시 연결해 주세요.');throw new Error('Google Drive 토큰 갱신에 실패했습니다.')}}
async function projectAccess(userId:string,projectId:string,_edit=false){const {data:p,error}=await admin.from('app_spaces').select('id,workspace_id,name,visibility,owner_id,created_by').eq('id',projectId).maybeSingle();if(error||!p)throw new Error('프로젝트를 찾을 수 없습니다.');const {data:wm}=await admin.from('app_workspace_members').select('role').eq('workspace_id',p.workspace_id).eq('user_id',userId).maybeSingle();if(wm?.role!=='owner')throw new Error('워크스페이스 소유자 권한이 필요합니다.');return {project:p,role:'owner'}}
// S70-29: 맨 위 앱 폴더를 처음 만들면 그 자리에서 앱 폴더 모으기를 한 번(_shared/gather-folders.mjs gatherIntoNewRoot, 실패해도 멈추지 않음).
const tokenDrive=(token:string)=>(url:string,init:RequestInit={})=>fetch(url,{...init,headers:{...(init.headers||{}),Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
async function ensureRoot(workspaceId:string,token:string){const {data}=await admin.from('app_drive_settings').select('root_folder_id').eq('workspace_id',workspaceId).maybeSingle();if(data?.root_folder_id)return data.root_folder_id;const r=await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:ROOT_FOLDER_NAME,mimeType:'application/vnd.google-apps.folder'})});const d=await r.json();if(!r.ok||!d.id)throw upstreamFail('drive_root_folder','Drive 루트 폴더 생성 실패',r.status,d.error?.message||null);await admin.from('app_drive_settings').upsert({workspace_id:workspaceId,root_folder_id:d.id,updated_at:new Date().toISOString()});await gatherIntoNewRoot({drive:tokenDrive(token),rootId:d.id});return d.id as string}
async function ensureProjectFolder(project:any,token:string){const {data}=await admin.from('app_project_drive_folders').select('folder_id').eq('project_id',project.id).maybeSingle();if(data?.folder_id)return data.folder_id;const root=await ensureRoot(project.workspace_id,token);const r=await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:project.name,mimeType:'application/vnd.google-apps.folder',parents:[root]})});const d=await r.json();if(!r.ok||!d.id)throw upstreamFail('drive_project_folder','프로젝트 Drive 폴더 생성 실패',r.status,d.error?.message||null);await admin.from('app_project_drive_folders').upsert({project_id:project.id,folder_id:d.id,updated_at:new Date().toISOString()});return d.id as string}
async function uploadDrive(file:File,folderId:string,token:string){const init=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,webViewLink,size',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':file.type||'application/octet-stream','X-Upload-Content-Length':String(file.size)},body:JSON.stringify({name:file.name,parents:[folderId]})});if(!init.ok)throw upstreamFail('drive_upload_init','Drive 업로드를 시작하지 못했습니다.',init.status,(await init.text().catch(()=>'')).slice(0,500));const loc=init.headers.get('location');if(!loc)throw new Error('Drive 업로드 주소를 받지 못했습니다.');const up=await fetch(loc,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream','Content-Length':String(file.size)},body:file});const d=await up.json();if(!up.ok)throw upstreamFail('drive_upload','Drive 파일 업로드 실패',up.status,d.error?.message||null);return d}
function classify(name:string){const n=name.replace(/\.[^.]+$/,'');let category='기타';const rules:any=[[/보도자료/,'보도자료'],[/취재요청/,'취재요청'],[/성명|논평/,'성명·논평'],[/회의결과|회의록/,'회의결과'],[/회의|집행위|상집|중집|대표자회의|간담회/,'회의자료'],[/토론회|발제/,'토론회·발제자료'],[/교육|강의|수련회/,'교육자료'],[/교섭|임단협|단협/,'교섭자료'],[/국회|법안|의안|국감/,'국회자료'],[/지침|고시|정부|기재부|재경부|국토부|행안부|고용노동부|노동부/,'정부자료'],[/기자회견|집회|선전|웹자보|카드뉴스/,'선전·언론자료']];for(const [re,c] of rules){if(re.test(n)){category=c;break}}const src=['공공운수노조','민주노총','국토부','기재부','재경부','행안부','고용노동부','노동부','국회','철도노조','궤도협의회'].find(x=>n.includes(x))||null;const kws=['총인건비','정원','인력','인력확충','2인1조','민자철도','철도','지하철','안전','기능개혁','통폐합','산별','필수유지','성과연봉제','임금','교섭','파업','외주화','민영화','운영기준','국감','공공기관','육아휴직'];const tags=kws.filter(k=>n.includes(k));let date=null,m=n.match(/(20\d{2})[._-]?(0[1-9]|1[0-2])[._-]?([0-2]\d|3[01])/);if(m)date=`${m[1]}-${m[2]}-${m[3]}`;else{m=n.match(/(?:^|\D)(\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?:\D|$)/);if(m)date=`20${m[1]}-${m[2]}-${m[3]}`}const title=n.replace(/^\s*(?:20)?\d{6,8}[ _.-]*/,'').replace(/[_]+/g,' ').trim()||n;return {title,category,source:src,tags,date}}
async function createDownloadToken(userId:string,documentId:string){const raw=crypto.randomUUID()+crypto.randomUUID();const hash=await sha256(raw);await admin.from('app_drive_download_tokens').insert({token_hash:hash,document_id:documentId,user_id:userId,expires_at:new Date(Date.now()+5*60*1000).toISOString()});return `${SB}/functions/v1/workspace-drive?action=download&t=${encodeURIComponent(raw)}`}
async function checkDocumentAccess(userId:string,documentId:string){const {data:doc,error}=await admin.from('app_documents').select('*').eq('id',documentId).maybeSingle();if(error||!doc)throw new Error('파일을 찾을 수 없습니다.');const {data:wm}=await admin.from('app_workspace_members').select('role').eq('workspace_id',doc.workspace_id).eq('user_id',userId).maybeSingle();if(wm?.role!=='owner')throw new Error('워크스페이스 소유자 권한이 필요합니다.');return doc}
// S69-20 ①: GET ?action=drive-place → {ok:true, place:{folder_id,url,path}|null}. 작업공간은 로그인한 사람의 owner 작업공간(서버가 정함),
// 폴더는 서버가 적어 둔 자료실 폴더 id로만, 이름은 드라이브의 지금 이름. 드라이브 연결이 없거나 읽기가 실패해도 오류 대신 place:null(화면은 줄을 안 그림).
async function drivePlaceOf(userId:string,auth:string){
  const own=await callerOwnerWorkspace(admin,userId);
  if(!own)return json({error:'워크스페이스 소유자 권한이 필요합니다.'},403);
  const {data:s,error}=await admin.from('app_drive_settings').select('library_folder_id').eq('workspace_id',own).maybeSingle();
  if(error){console.error('workspace-drive place read failed',{code:error.code});return json({ok:true,place:null})}
  if(!s?.library_folder_id)return json({ok:true,place:null});
  let token='';
  try{token=await workspaceDriveToken(admin,own,{fetch})}catch{return json({ok:true,place:null})}
  const place=await drivePlace(s.library_folder_id,async(id:string)=>{const r=await fetch(metaUrl(id),{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});if(!r.ok)return null;return await r.json().catch(()=>null)});
  // S69-20 ③: 폴더 안에 들어가면 그 앱 폴더의 짝 드라이브 폴더로 열도록 짝 id 목록(로그인한 본인 권한으로 읽음 — owner RLS·휴지통 숨김). 칸이 없으면(DB 적용 전) 빈 목록.
  const pairs:Record<string,string>={};
  if(place){try{for(const f of await userRest(auth,`app_library_folders?workspace_id=eq.${own}&drive_folder_id=not.is.null&select=id,drive_folder_id`))if(typeof f?.id==='string'&&typeof f?.drive_folder_id==='string')pairs[f.id]=f.drive_folder_id}catch{}}
  return json({ok:true,place:place?{...place,pairs}:null});
}
// S70-29: 옮기기(dry_run 없음)는 지웠다 — 맨 위 앱 폴더를 처음 만들 때 서버가 저절로 한다(ensureRoot). 이제 세기(dry_run:true)만, 그 밖은 410.
// S69-22: POST ?action=gather-folders {dry_run?} → 세기({root_name,root_url,count,kinds,rename,rename_dup}) 또는 옮기기({root_name,root_url,moved,failed,left,kinds,renamed,rename_failed,rename_left,rename_dup}) — S69-42 rename_dup = 같은 자리에 새 이름 폴더가 있어 합치지 않고 둔 수.
// 작업공간은 로그인한 사람의 owner 작업공간(서버가 정함), 맨 위 앱 폴더는 서버가 적어 둔 root_folder_id(없으면 옮기기 때만 새로 만듦).
async function gatherOf(userId:string,dryRun:boolean){
  const own=await callerOwnerWorkspace(admin,userId);
  if(!own)return json({error:'워크스페이스 소유자 권한이 필요합니다.'},403);
  if(!dryRun)return json({error:'더 이상 쓰지 않는 요청입니다.',code:'gone'},410);
  const {data:s,error}=await admin.from('app_drive_settings').select('root_folder_id').eq('workspace_id',own).maybeSingle();
  if(error){console.error('workspace-drive gather settings read failed',{code:error.code});return json({error:'드라이브 설정을 읽지 못했습니다.',code:'drive_settings'},502)}
  let token='';
  try{token=await workspaceDriveToken(admin,own,{fetch})}catch(e){const code=e instanceof WorkspaceDriveError?e.code:'drive_token_failed';return json({error:code==='drive_not_connected'?'Google Drive가 아직 연결되지 않았어요.':'Google Drive 연결을 확인하지 못했습니다.',code},code==='drive_not_connected'?424:502)}
  const drive=(url:string,init:RequestInit)=>fetch(url,{...init,headers:{...(init.headers||{}),Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  try{
    let root=s?.root_folder_id as string|undefined;
    if(!root&&dryRun){const list=await gatherCandidates(drive,'');const kinds:Record<string,number>={};for(const c of list)kinds[c.kind]=(kinds[c.kind]||0)+1;const rename=(await renameCandidates(drive,'')).length;return json({ok:true,root_name:ROOT_FOLDER_NAME,root_new:true,root_url:null,count:list.length,kinds,rename})}
    return json({ok:true,...await gatherFolders({drive,rootId:root as string,dryRun:true})});
  }catch(e){
    if(e instanceof GatherError){console.error('workspace-drive gather failed',{code:e.code});return json({error:e.code==='app_root_shared'?'맨 위 앱 폴더가 다른 사람과 공유되어 있어 옮기지 않았습니다.':'드라이브 폴더를 확인하지 못했습니다.',code:e.code},e.status)}
    throw e;
  }
}
// S69-20 ③④⑤: 앱 표는 로그인한 본인 토큰(owner RLS)으로만 읽고 쓴다 — service_role에는 자료실 폴더 표 권한이 없다(넓히지 않음).
const ANON=Deno.env.get('SUPABASE_ANON_KEY')||'';
async function userRest(auth:string,path:string,init:RequestInit={}){
  if(!ANON)throw new Error('config');
  const r=await fetch(`${SB}/rest/v1/${path}`,{...init,headers:{apikey:ANON,Authorization:auth,'Content-Type':'application/json',...(init.headers||{})},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Object.assign(new Error('rest '+r.status),{status:r.status});
  return await r.json();
}
const GD='https://www.googleapis.com/drive/v3/files';
function mirrorDrive(token:string){
  const call=async(url:string,init:RequestInit={})=>{let r:Response;try{r=await fetch(url,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(init.headers||{})},signal:AbortSignal.timeout(15000)})}catch{throw new DriveFail(0)}if(!r.ok)throw new DriveFail(r.status);return await r.json().catch(()=>({}))};
  return {
    get:async(id:string)=>{try{return await call(`${GD}/${encodeURIComponent(id)}?fields=id,name,parents,trashed,mimeType,appProperties&supportsAllDrives=true`)}catch(e){if(e instanceof DriveFail&&e.status===404)return null;throw e}},
    children:async(parent:string)=>{const out:any[]=[];let page='';for(let i=0;i<20;i++){const q=new URLSearchParams({q:`'${parent}' in parents and trashed=false`,fields:'nextPageToken,files(id,name,mimeType,parents,appProperties)',pageSize:'1000',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});if(page)q.set('pageToken',page);const d=await call(`${GD}?${q}`);for(const f of Array.isArray(d.files)?d.files:[])out.push(f);page=d.nextPageToken||'';if(!page)break}return out},
    // S69-40: 부모 여러 개 바로 아래를 한 번에(폴더마다 따로 묻다가 한도를 다 써 버리던 것을 막음). 부모 id는 library-mirror가 드라이브 id 모양만 넘긴다.
    list:async(parents:string[])=>{const ok=parents.filter(p=>/^[A-Za-z0-9_-]{10,200}$/.test(p));if(!ok.length)return [];const out:any[]=[];let page='';for(let i=0;i<20;i++){const q=new URLSearchParams({q:`(${ok.map(p=>`'${p}' in parents`).join(' or ')}) and trashed=false`,fields:'nextPageToken,files(id,name,mimeType,parents,appProperties)',pageSize:'1000',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});if(page)q.set('pageToken',page);const d=await call(`${GD}?${q}`);for(const f of Array.isArray(d.files)?d.files:[])out.push(f);page=d.nextPageToken||'';if(!page)break}return out},
    // S69-52: 새 짝 폴더에 처음부터 '마지막으로 맞춘 모양' 표식(appProperties)을 붙인다.
    createFolder:async(name:string,parent:string,appProperties?:Record<string,string|null>)=>{const body:Record<string,unknown>={name,mimeType:'application/vnd.google-apps.folder',parents:[parent]};if(appProperties)body.appProperties=appProperties;const d=await call(`${GD}?fields=id&supportsAllDrives=true`,{method:'POST',body:JSON.stringify(body)});if(typeof d.id!=='string')throw new DriveFail(0);return d.id},
    // S69-52: 표식 칸 null = 그 칸 지우기(드라이브 규칙), trashed:true = 되돌리기 때 우리가 만든 빈 폴더만 드라이브 휴지통으로(영구 삭제 없음).
    patch:async(id:string,p:{name?:string,addParents?:string,removeParents?:string,appProperties?:Record<string,string|null>,trashed?:boolean})=>{const q=new URLSearchParams({fields:'id',supportsAllDrives:'true'});if(p.addParents)q.set('addParents',p.addParents);if(p.removeParents)q.set('removeParents',p.removeParents);const body:Record<string,unknown>={};if(p.name)body.name=p.name;if(p.appProperties)body.appProperties=p.appProperties;if(p.trashed===true)body.trashed=true;await call(`${GD}/${encodeURIComponent(id)}?${q}`,{method:'PATCH',body:JSON.stringify(body)})},
    // S69-52: 이 맞추기 번호 표식이 붙은 것(되돌리기). 번호는 parseCheckBody가 [a-z0-9]만 받는다.
    marked:async(batch:string)=>{if(!/^[a-z0-9]{8,40}$/.test(batch))return [];const out:any[]=[];let page='';for(let i=0;i<20;i++){const q=new URLSearchParams({q:`appProperties has { key='won_sb' and value='${batch}' } and trashed=false`,fields:'nextPageToken,files(id,name,mimeType,parents,appProperties,trashed)',pageSize:'1000',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});if(page)q.set('pageToken',page);const d=await call(`${GD}?${q}`);for(const f of Array.isArray(d.files)?d.files:[])out.push(f);page=d.nextPageToken||'';if(!page)break}return out},
  };
}
// 앱 표 읽기·쓰기 — 모두 로그인한 본인 토큰(owner RLS·칸 권한·나무 검사·휴지통 트리거 그대로). service_role은 쓰지 않는다.
// S69-52: 이름·부모 고치기(드라이브에서 바뀐 것을 따라감), 폴더 만들기(드라이브에만 있는 폴더), 지우기(되돌리기 때 우리가 만든 폴더 — 자료실 휴지통으로).
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function libraryDb(auth:string,own:string){
  const w=`workspace_id=eq.${own}`;
  const one=(id:string)=>{if(!UUID_RE.test(id))throw Object.assign(new Error('bad id'),{status:400});return `app_library_folders?id=eq.${id}&${w}`};
  const changed=(rows:unknown)=>{if(!Array.isArray(rows)||rows.length!==1)throw Object.assign(new Error('not changed'),{status:409});return rows[0]};
  return {
    folders:()=>userRest(auth,`app_library_folders?${w}&select=id,parent_id,name,sort_order,drive_folder_id&limit=5000`),
    items:()=>userRest(auth,`app_library_folder_items?${w}&select=document_id,folder_id&limit=20000`),
    documents:()=>userRest(auth,`app_documents?${w}&file_id=not.is.null&select=id,file_id,title,file_name,classification_note&limit=20000`),
    setDrive:(id:string,drive:string|null,expect:string|null)=>userRest(auth,'rpc/app_library_folder_set_drive',{method:'POST',body:JSON.stringify({p_id:id,p_drive:drive,p_expect:expect})}),
    renameFolder:async(id:string,name:string)=>changed(await userRest(auth,`${one(id)}&select=id`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({name})})),
    moveFolder:async(id:string,parent:string|null)=>{if(parent!==null&&!UUID_RE.test(parent))throw Object.assign(new Error('bad parent'),{status:400});return changed(await userRest(auth,`${one(id)}&select=id`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({parent_id:parent})}))},
    createFolder:async({parent_id,name}:{parent_id:string|null,name:string})=>{if(parent_id!==null&&!UUID_RE.test(parent_id))throw Object.assign(new Error('bad parent'),{status:400});const sib=await userRest(auth,`app_library_folders?${w}&parent_id=${parent_id?'eq.'+parent_id:'is.null'}&select=sort_order&order=sort_order.desc&limit=1`);const sort=(Number(sib?.[0]?.sort_order)||0)+1;return changed(await userRest(auth,'app_library_folders?select=id',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({workspace_id:own,parent_id,name,sort_order:sort})}))},
    deleteFolder:async(id:string)=>{await userRest(auth,`${one(id)}&select=id`,{method:'DELETE',headers:{Prefer:'return=representation'}})},
  };
}
// POST ?action=drive-mirror {mode:'auto'} (S70-29: 'align'은 400) → 숫자만 {ok,state,folders_made,folders_fixed,files_moved,cant,pending,left,more,stopped,stage}.
// 작업공간은 로그인 owner 작업공간, 드라이브 연결도 그 작업공간 것만. 연결이 없거나 DB 칸이 아직 없으면(적용 전) ok:false + code(화면은 조용히 넘어감).
async function driveMirrorOf(userId:string,auth:string,mode:'auto'){
  const own=await callerOwnerWorkspace(admin,userId);
  if(!own)return json({error:'워크스페이스 소유자 권한이 필요합니다.'},403);
  const {data:s,error}=await admin.from('app_drive_settings').select('library_folder_id').eq('workspace_id',own).maybeSingle();
  if(error)return json({ok:false,code:'settings_unavailable'});
  if(!s?.library_folder_id)return json({ok:true,state:'none'});
  let token='';
  try{token=await workspaceDriveToken(admin,own,{fetch})}catch{return json({ok:false,code:'drive_not_connected',stage:'token'})}
  const db=libraryDb(auth,own);
  try{
    const r=await mirrorLibrary({libraryId:s.library_folder_id,mode,db,drive:mirrorDrive(token),budgetMs:MIRROR_BUDGET_MS});
    if(r.pending||r.cant||r.stopped||r.more)console.log('workspace-drive mirror',{mode,pending:r.pending,cant:r.cant,stopped:r.stopped,more:r.more,left:r.left,moved:r.files_moved,stage:r.stage});
    return json(r);
  }catch(e){
    const status=Number((e as any)?.status)||0;
    console.error('workspace-drive mirror failed',{status});
    return json({ok:false,code:status===400||status===404?'not_ready':'mirror_failed',stage:'db'});
  }
}
Deno.serve(withWebCors(async(req:Request)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});const u=new URL(req.url);const action=u.searchParams.get('action')||'';try{if(req.method==='GET'&&action==='download'){const raw=u.searchParams.get('t');if(!raw)return new Response('Invalid download token',{status:400});const hash=await sha256(raw);const {data:tok}=await admin.from('app_drive_download_tokens').select('*').eq('token_hash',hash).is('used_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();if(!tok)return new Response('Download link expired',{status:410});const doc=await checkDocumentAccess(tok.user_id,tok.document_id);if(!doc?.file_id)return new Response('File not found',{status:404});const token=await driveAccessToken(tok.user_id,doc.workspace_id);const dr=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.file_id)}?alt=media`,{headers:{Authorization:`Bearer ${token}`}});if(!dr.ok)return new Response('Drive download failed',{status:502});await admin.from('app_drive_download_tokens').update({used_at:new Date().toISOString()}).eq('id',tok.id);const h=new Headers();h.set('Content-Type',doc.mime_type||dr.headers.get('Content-Type')||'application/octet-stream');h.set('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(doc.file_name||doc.title||'download')}`);h.set('Cache-Control','no-store');return new Response(dr.body,{status:200,headers:h})}const user=await getUser(req);if(req.method==='GET'&&action==='drive-place'){if(!parsePlaceRequest(u))return json({error:'Unknown action'},400);return await drivePlaceOf(user.id,req.headers.get('Authorization')||'')}if(req.method==='POST'&&action==='gather-folders'){const parsed=parseGatherRequest(u,await req.json().catch(()=>null));if(!parsed)return json({error:'Unknown action'},400);return await gatherOf(user.id,parsed.dryRun)}if(req.method==='POST'&&action==='drive-mirror'){if([...u.searchParams.keys()].length!==1)return json({error:'Unknown action'},400);const mode=parseMirrorBody(await req.json().catch(()=>null));if(!mode)return json({error:'Unknown action'},400);return await driveMirrorOf(user.id,req.headers.get('Authorization')||'',mode)}if(req.method==='POST'&&action==='upload'){const form=await readMultipartForm(req);const projectId=String(form.get('project_id')||'');const file=form.get('file');if(!projectId||!(file instanceof File))return json({error:'프로젝트와 파일이 필요합니다.'},400);if(file.size<=0)return json({error:'빈 파일은 업로드할 수 없습니다.'},400);if(file.size>100*1024*1024)return json({error:'현재 프로젝트 파일은 100MB까지 지원합니다.'},413);const {project}=await projectAccess(user.id,projectId,true);const token=await driveAccessToken(user.id,project.workspace_id);const folder=await ensureProjectFolder(project,token);const df=await uploadDrive(file,folder,token);const a=classify(file.name);const explicitTitle=String(form.get('title')||'').trim();const {data:doc,error}=await admin.from('app_documents').insert({workspace_id:project.workspace_id,project_id:project.id,title:explicitTitle||a.title,category:a.category,source:a.source,document_date:a.date,description:null,tags:a.tags,drive_url:df.webViewLink||`https://drive.google.com/file/d/${df.id}/view`,file_id:df.id,file_name:file.name,mime_type:file.type||df.mimeType||'application/octet-stream',file_size:file.size,visibility:'private',uploaded_by:user.id,auto_classified:true,classification_note:'프로젝트 파일 자동분류'}).select('*').single();if(error)throw error;return json({ok:true,document:doc})}if(req.method==='POST'&&action==='download-token'){const body=await req.json().catch(()=>({}));const id=String(body.document_id||'');if(!id)return json({error:'document_id가 필요합니다.'},400);await checkDocumentAccess(user.id,id);const url=await createDownloadToken(user.id,id);return json({url,expires_in:300})}return json({error:'Unknown action'},400)}catch(e){console.error('workspace-drive failed',safeErrorLog(e));return json({error:safeErrorMessage(e),...((e as any)?.stage?{stage:(e as any).stage}:{})},(e as any)?.authRequired===true?401:400)}}));
