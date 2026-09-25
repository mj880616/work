import { createClient } from 'npm:@supabase/supabase-js@2';
import { HwpxReader, hwpToText } from 'npm:@ssabrojs/hwpxjs';

const SB=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI=Deno.env.get('OPENAI_API_KEY')||'';
const admin=createClient(SB,SERVICE,{auth:{persistSession:false}});
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const json=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});

async function getUser(req:Request){const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)throw new Error('로그인이 필요합니다.');const {data,error}=await admin.auth.getUser(token);if(error||!data.user)throw new Error('로그인 세션을 확인할 수 없습니다.');return data.user}
async function driveToken(){const {data:c,error}=await admin.from('public_policy_drive_config').select('google_client_id,google_client_secret,google_refresh_token').eq('id',1).single();if(error||!c?.google_refresh_token)throw new Error('Google Drive 연결 설정이 필요합니다.');const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.google_client_id,client_secret:c.google_client_secret,refresh_token:c.google_refresh_token,grant_type:'refresh_token'})});const d=await r.json();if(!r.ok||!d.access_token)throw new Error(d.error_description||d.error||'Google Drive 토큰 갱신 실패');return d.access_token as string}
async function workspaceFor(userId:string){const {data:wm}=await admin.from('app_workspace_members').select('workspace_id,role').eq('user_id',userId).maybeSingle();if(wm?.role!=='owner')throw new Error('워크스페이스 소유자 권한이 필요합니다.');return wm}
async function canEditProject(userId:string,projectId:string){const {data:p}=await admin.from('app_spaces').select('id,workspace_id,owner_id,created_by').eq('id',projectId).maybeSingle();if(!p)throw new Error('프로젝트를 찾을 수 없습니다.');const {data:wm}=await admin.from('app_workspace_members').select('role').eq('workspace_id',p.workspace_id).eq('user_id',userId).maybeSingle();if(wm?.role!=='owner')throw new Error('워크스페이스 소유자 권한이 필요합니다.');return p}
async function ensureRoot(workspaceId:string,token:string){const {data:s}=await admin.from('app_drive_settings').select('root_folder_id').eq('workspace_id',workspaceId).maybeSingle();if(s?.root_folder_id)return s.root_folder_id;const r=await fetch('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'공공기관사업팀 Workspace',mimeType:'application/vnd.google-apps.folder'})});const d=await r.json();if(!r.ok||!d.id)throw new Error(d.error?.message||'Drive 루트 폴더 생성 실패');await admin.from('app_drive_settings').upsert({workspace_id:workspaceId,root_folder_id:d.id,updated_at:new Date().toISOString()});return d.id}
async function ensureLibrary(workspaceId:string,token:string){const {data:s}=await admin.from('app_drive_settings').select('library_folder_id').eq('workspace_id',workspaceId).maybeSingle();if(s?.library_folder_id)return s.library_folder_id;const root=await ensureRoot(workspaceId,token);const r=await fetch('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'자료실',mimeType:'application/vnd.google-apps.folder',parents:[root]})});const d=await r.json();if(!r.ok||!d.id)throw new Error(d.error?.message||'자료실 폴더 생성 실패');await admin.from('app_drive_settings').upsert({workspace_id:workspaceId,library_folder_id:d.id,updated_at:new Date().toISOString()});return d.id}
async function upload(file:File,folder:string,token:string){const init=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,webViewLink,size',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':file.type||'application/octet-stream','X-Upload-Content-Length':String(file.size)},body:JSON.stringify({name:file.name,parents:[folder]})});if(!init.ok)throw new Error(await init.text());const loc=init.headers.get('location');if(!loc)throw new Error('Drive 업로드 주소를 받지 못했습니다.');const up=await fetch(loc,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream','Content-Length':String(file.size)},body:file});const d=await up.json();if(!up.ok)throw new Error(d.error?.message||'Drive 업로드 실패');return d}

async function setDrivePublic(fileId:string,makePublic:boolean,token:string){
  if(makePublic){
    const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({type:'anyone',role:'reader',allowFileDiscovery:false})});
    if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error?.message||'Drive 공개 권한 설정 실패')}
    return;
  }
  const list=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&fields=permissions(id,type,role)`,{headers:{Authorization:`Bearer ${token}`}});
  const d=await list.json();if(!list.ok)throw new Error(d.error?.message||'Drive 권한 조회 실패');
  for(const p of d.permissions||[]){
    if(p.type==='anyone'){
      const del=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(p.id)}?supportsAllDrives=true`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});
      if(!del.ok&&del.status!==404)throw new Error('Drive 공개 권한 해제 실패');
    }
  }
}
function driveFileId(value:string|null|undefined){
  const s=String(value||'').trim();
  if(!s)return null;
  const patterns=[
    /\/file\/d\/([A-Za-z0-9_-]+)/,
    /\/(?:document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)/,
    /[?&]id=([A-Za-z0-9_-]+)/
  ];
  for(const re of patterns){const m=s.match(re);if(m?.[1])return m[1]}
  return null;
}
async function setDocumentVisibility(user:any,documentId:string,visibility:string){
  if(!['public','workspace','private'].includes(visibility))throw new Error('지원하지 않는 공개범위입니다.');
  const wm=await workspaceFor(user.id);
  const {data:doc,error}=await admin.from('app_documents').select('id,workspace_id,project_id,uploaded_by,file_id,drive_url,visibility').eq('id',documentId).maybeSingle();
  if(error||!doc||doc.workspace_id!==wm.workspace_id)throw new Error('자료를 찾을 수 없습니다.');
  if(doc.project_id)await canEditProject(user.id,doc.project_id);
  else if(doc.uploaded_by!==user.id&&!['owner','admin','editor'].includes(wm.role))throw new Error('자료 공개범위를 변경할 권한이 없습니다.');
  const managedFileId=doc.file_id||driveFileId(doc.drive_url);
  if(managedFileId){
    const token=await driveToken();
    await setDrivePublic(managedFileId,visibility==='public',token);
  }
  const {data:updated,error:updateError}=await admin.from('app_documents').update({visibility,updated_at:new Date().toISOString()}).eq('id',documentId).select('id,visibility').single();
  if(updateError)throw updateError;
  return updated;
}
function ext(name:string){const m=name.toLowerCase().match(/\.([a-z0-9]+)$/);return m?.[1]||''}
function baseName(name:string){return String(name||'').replace(/\.[^.]+$/,'').trim()}
function tidyFileTitle(name:string){
  let s=baseName(name).normalize('NFKC').replace(/[_]+/g,' ').replace(/\s+/g,' ').trim();
  s=s.replace(/\((?:\d+|copy|사본|복사본)\)\s*$/gi,' ');
  s=s.replace(/(?:^|\s)(?:인쇄용|배포용|발송용)(?=\d{2}년)/gi,' ');
  s=s.replace(/(?:^|\s)(?:최종(?:본)?\d*|확정\d*|수정(?:본)?\d*|인쇄용|배포용|발송용|완성(?:본)?\d*|사본|복사본|copy|final|draft|ver(?:sion)?\s*\d+|v\d+|ppt|pptx)(?=\s|$)/gi,' ');
  s=s.replace(/(?:^|\s)(?:20)?\d{6,8}(?=\s|$)/g,' ');
  s=s.replace(/(?:^|\s)\d{6}(?=\s|$)/g,' ');
  s=s.replace(/\s+/g,' ').trim();
  s=s.replace(/(^|\s)(\d{2})년(?=\s|$)/g,(_,lead,yy)=>lead+'20'+yy+'년');
  if(/^회의자료\s+/.test(s)&&s.length>'회의자료'.length+3)s=s.replace(/^회의자료\s+/,'').trim()+' 회의자료';
  return s||baseName(name)||'자료';
}
const GENERIC=new Set(['note','notes','memo','document','doc','file','scan','scanned','untitled','자료','문서','회의자료','최종','확정','수정','수정본','완성','final','draft']);
function weakTitle(title:string){
  const s=String(title||'').trim();
  if(!s)return true;
  const compact=s.replace(/[^0-9a-z가-힣]/gi,'');
  if(compact.length<4)return true;
  if(/^(?:notes?|memo|document|doc|file|scan(?:ned)?|untitled|자료|문서|회의자료|최종|확정|수정(?:본)?|완성|final|draft)\d*$/i.test(compact))return true;
  const tokens=s.toLowerCase().split(/\s+/).map(x=>x.replace(/[^0-9a-z가-힣]/gi,'')).filter(Boolean);
  const meaningful=tokens.filter(t=>!GENERIC.has(t)&&!/^[0-9]+$/.test(t));
  if(!meaningful.length)return true;
  return false;
}
function autoDate(name:string){let m=name.match(/(20\d{2})[._-]?(0[1-9]|1[0-2])[._-]?([0-2]\d|3[01])/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;m=name.match(/(?:^|\D)(\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?:\D|$)/);if(m)return `20${m[1]}-${m[2]}-${m[3]}`;return null}
function classify(text:string){const n=String(text||'');let category='기타';const rules:any=[[/보도자료/,'보도자료'],[/취재요청/,'취재요청'],[/성명|논평/,'성명·논평'],[/회의결과|회의록/,'회의결과'],[/회의|집행위|상집|중집|대표자회의|간담회/,'회의자료'],[/토론회|발제|발제문/,'토론회·발제자료'],[/교육|강의|수련회/,'교육자료'],[/교섭|임단협|단협/,'교섭자료'],[/국회|법안|의안|국정감사|국감/,'국회자료'],[/지침|고시|정부|기재부|재경부|국토부|행안부|고용노동부|노동부/,'정부자료'],[/기자회견|집회|선전|웹자보|카드뉴스/,'선전·언론자료']];for(const [re,c] of rules){if(re.test(n)){category=c;break}}const sourceCandidates=['공공운수노조','민주노총','국토교통부','국토부','기획재정부','기재부','재정경제부','재경부','행정안전부','행안부','고용노동부','노동부','국회','철도노조','궤도협의회'];const source=sourceCandidates.find(x=>n.includes(x))||null;const keywords=['총인건비','정원','인력','인력확충','2인1조','민자철도','철도','지하철','안전','기능개혁','통폐합','산별','필수유지','성과연봉제','임금','교섭','파업','외주화','민영화','운영기준','국감','공공기관','육아휴직'];const tags=keywords.filter(k=>n.includes(k));return {category,source,tags,document_date:autoDate(n)}}
function norm(s:string){return s.toLowerCase().replace(/\s+/g,'').replace(/[^0-9a-z가-힣]/g,'')}
function bytesToDataUrl(bytes:Uint8Array,mime:string){let bin='';for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return `data:${mime||'application/octet-stream'};base64,${btoa(bin)}`}
function outputText(r:any){for(const item of r.output||[]){if(item.type==='message'){for(const c of item.content||[]){if(c.type==='output_text'&&c.text)return c.text}}}return r.output_text||''}
async function openAI(body:any){const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+OPENAI,'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'AI 요청에 실패했습니다.');return d}
async function workspaceModel(workspaceId:string){const {data}=await admin.from('app_ai_workspace_settings').select('default_model').eq('workspace_id',workspaceId).maybeSingle();return data?.default_model||'gpt-5.6-luna'}
async function extractHwpText(bytes:Uint8Array,name:string){if(ext(name)==='hwp')return String(await hwpToText(bytes)).slice(0,18000);const reader=new HwpxReader();const ab=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);await reader.loadFromArrayBuffer(ab as ArrayBuffer);return String(await reader.extractText()).slice(0,18000)}
function firstLikelyTitle(text:string){const lines=String(text||'').replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(x=>x.length>=4&&x.length<=120);return lines.find(x=>/[가-힣A-Za-z]/.test(x)&&!/^[-–—•·※*\d\s.()]+$/.test(x))||null}
async function inferTitleFromText(text:string,fileName:string,model:string){
  const fallback=firstLikelyTitle(text);
  if(!OPENAI)return fallback;
  const schema={type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false};
  const r=await openAI({model,store:false,max_output_tokens:180,input:[{role:'developer',content:'업무 자료의 제목을 식별한다. 표지·첫 페이지·문서 머리말에 실제 제목이 있으면 그것을 우선한다. 파일관리용 표현(최종, 수정본, 확정, 인쇄용, 사본, 버전번호)은 제거한다. 실제 제목이 명시되지 않았다면 문서 내용만 근거로 80자 이내의 간결한 제목을 만든다. 없는 사실을 추가하지 않는다.'},{role:'user',content:`파일명: ${fileName}\n\n문서 앞부분:\n${String(text).slice(0,18000)}`}],text:{format:{type:'json_schema',name:'document_title',strict:true,schema}}});
  try{const p=JSON.parse(outputText(r));return String(p.title||'').trim()||fallback}catch{return fallback}
}
async function inferTitleFromFile(file:File,model:string){
  if(file.size>25*1024*1024)return null;
  const e=ext(file.name),mime=file.type||'application/octet-stream';
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(/^text\//.test(mime)||['txt','md','csv','json','log','xml'].includes(e))return await inferTitleFromText(new TextDecoder().decode(bytes),file.name,model);
  if(['hwp','hwpx'].includes(e)){try{return await inferTitleFromText(await extractHwpText(bytes,file.name),file.name,model)}catch{return null}}
  if(!OPENAI||!(e==='pdf'||mime==='application/pdf'||['doc','docx','ppt','pptx'].includes(e)))return null;
  const schema={type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false};
  const r=await openAI({model,store:false,max_output_tokens:180,input:[{role:'developer',content:'업무 자료의 제목을 식별한다. 표지·첫 페이지에 실제 제목이 있으면 그것을 우선한다. 파일관리용 표현(최종, 수정본, 확정, 인쇄용, 사본, 버전번호)은 제거한다. 실제 제목이 명시되지 않았다면 문서 내용만 근거로 80자 이내의 간결한 제목을 만든다. 없는 사실을 추가하지 않는다.'},{role:'user',content:[{type:'input_text',text:`파일명: ${file.name}\n문서의 실제 제목을 찾아라.`},{type:'input_file',filename:file.name,file_data:bytesToDataUrl(bytes,mime),detail:'auto'}]}],text:{format:{type:'json_schema',name:'document_title',strict:true,schema}}});
  try{const p=JSON.parse(outputText(r));return String(p.title||'').trim()||null}catch{return null}
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const user=await getUser(req);
    if(req.method!=='POST')return json({error:'POST only'},405);
    if((req.headers.get('content-type')||'').includes('application/json')){
      const payload=await req.json();
      if(payload?.action==='set-visibility'){
        const documentId=String(payload.document_id||'').trim();
        if(!documentId)return json({error:'자료 ID가 필요합니다.'},400);
        return json({ok:true,document:await setDocumentVisibility(user,documentId,String(payload.visibility||''))});
      }
      return json({error:'지원하지 않는 작업입니다.'},400);
    }
    const form=await req.formData(),file=form.get('file');
    if(!(file instanceof File))return json({error:'파일을 선택해 주세요.'},400);
    if(file.size<=0)return json({error:'빈 파일은 업로드할 수 없습니다.'},400);
    if(file.size>100*1024*1024)return json({error:'현재 자료실 파일은 100MB까지 지원합니다.'},413);

    const wm=await workspaceFor(user.id);
    let projectId=String(form.get('project_id')||'').trim()||null;
    let meetingId=String(form.get('meeting_id')||'').trim()||null;
    if(meetingId){
      const {data:meeting}=await admin.from('app_meetings').select('id,workspace_id,project_id,created_by').eq('id',meetingId).maybeSingle();
      if(!meeting||meeting.workspace_id!==wm.workspace_id)throw new Error('회의를 찾을 수 없습니다.');
      if(meeting.project_id){if(!projectId)projectId=meeting.project_id;if(meeting.created_by!==user.id)await canEditProject(user.id,meeting.project_id)}
      else if(meeting.created_by!==user.id&&!['owner','admin','editor'].includes(wm.role))throw new Error('회의자료 등록 권한이 없습니다.');
    }
    if(projectId)await canEditProject(user.id,projectId);

    const val=(k:string)=>String(form.get(k)||'').trim();
    const userTitle=val('title');
    let title=userTitle||tidyFileTitle(file.name);
    let titleSource=userTitle?'user':'filename';
    if(!userTitle&&weakTitle(title)){
      try{
        const model=await workspaceModel(wm.workspace_id);
        const inferred=await inferTitleFromFile(file,model);
        if(inferred){title=tidyFileTitle(inferred);titleSource='content'}
      }catch(e){console.warn('content title inference skipped',e)}
    }
    if(!title||weakTitle(title))title=tidyFileTitle(file.name);

    const auto=classify(title+' '+file.name);
    if(!projectId&&!meetingId){
      const {data:spaces}=await admin.from('app_spaces').select('id,name').eq('workspace_id',wm.workspace_id).neq('status','archived');
      const fn=norm(file.name+' '+title);
      const matches=(spaces||[]).filter((s:any)=>{const nn=norm(s.name);return nn.length>=3&&fn.includes(nn)});
      if(matches.length===1)projectId=matches[0].id;
    }

    const category=val('category')||(meetingId?'회의자료':auto.category);
    const source=val('source')||auto.source;
    const documentDate=val('document_date')||auto.document_date;
    const description=val('description')||null;
    const tagInput=val('tags');
    const tags=tagInput?tagInput.split(',').map(x=>x.trim()).filter(Boolean):auto.tags;
    const requestedVisibility=val('visibility');
    if(requestedVisibility&&!['public','workspace','private'].includes(requestedVisibility))throw new Error('지원하지 않는 공개범위입니다.');
    const visibility=requestedVisibility||'workspace';

    const token=await driveToken();
    const folder=await ensureLibrary(wm.workspace_id,token);
    const df=await upload(file,folder,token);
    if(visibility==='public')await setDrivePublic(df.id,true,token);
    const classificationNote=meetingId?'회의자료 자동등록':titleSource==='content'?'파일명 단서 부족 · 본문 기반 제목 추출 및 자동분류':titleSource==='filename'?'파일명 정돈 및 메타정보 기반 자동분류':'사용자 입력 제목 · 메타정보 자동분류';
    const {data:doc,error}=await admin.from('app_documents').insert({
      workspace_id:wm.workspace_id,project_id:projectId,meeting_id:meetingId,title,category,source:source||null,document_date:documentDate||null,description,tags,
      drive_url:df.webViewLink||`https://drive.google.com/file/d/${df.id}/view`,file_id:df.id,file_name:file.name,mime_type:file.type||df.mimeType||'application/octet-stream',file_size:file.size,
      visibility,uploaded_by:user.id,auto_classified:!userTitle,classification_note:classificationNote
    }).select('*').single();
    if(error)throw error;
    return json({ok:true,document:doc,auto:{title,category,source,tags,document_date:documentDate,project_id:projectId,meeting_id:meetingId,title_source:titleSource}});
  }catch(e){console.error(e);return json({error:e instanceof Error?e.message:String(e)},400)}
});
