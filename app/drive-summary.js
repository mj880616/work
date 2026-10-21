// ORG-사본자동갱신: Drive 읽기용 사본(조직·프로젝트 문서 2개)을 저장 뒤 자동으로 갱신한다.
// 화면 표시·버튼은 없다. 사본에 들어가는 것이 저장되면 마지막 저장 3분 뒤(처음 저장부터 최대 10분)
// drive-summary를 한 번 부른다. 탭을 닫거나 다른 앱으로 넘어가 화면이 가려지면 기다리던 갱신을 바로 보낸다.
// 그래도 놓친 변경은 하루 2번 예약 실행(.github/workflows/drive-summary-refresh.yml)이 채운다.
export const WAIT_MS=3*60*1000;
export const MAX_WAIT_MS=10*60*1000;

// 사본(supabase/functions/drive-summary)이 읽는 표와 열. 이 열이 바뀌는 저장만 갱신을 부른다.
export const SUMMARY_FIELDS={
  app_notes:['raw_text','occurred_at','updated_at','archived_at','ai_export_allowed','attachments','kind','metadata'],
  app_suborganizations:['name','active','recent_month_summary'],
  app_suborganization_updates:['organization_id','raw_text','occurred_at'],
  app_suborganization_assignees:['organization_id','user_id'],
  app_spaces:['name','parent_id','status','sort_order','metadata'],
  app_project_workstreams:['project_id','phase','title','sort_order'],
  app_project_progress_updates:['project_id','workstream_id','effective_on','status_label','summary','next_step'],
  app_project_milestones:['project_id','title','start_at'],
  app_meetings:['title','series_name','meeting_at','round_no','project_id'],
  app_record_links:['project_id','google_task_id','task_completed','status'],
  app_documents:['project_id']
};

// saved = kptu:api-saved detail(경로·방법·바뀐 열 이름·연결 여부만, 원문 없음).
export function affectsSummary(saved,baseUrl){
  if(!saved||typeof saved.path!=='string')return false;
  let path;
  try{path=new URL(saved.path,baseUrl)}catch{return false}
  if(path.origin!==new URL(baseUrl).origin)return false;
  const method=String(saved.method||'').toUpperCase(),fields=Array.isArray(saved.fields)?saved.fields:[];
  const table=path.pathname.startsWith('/rest/v1/')?path.pathname.slice('/rest/v1/'.length):null;
  const relevant=table&&Object.hasOwn(SUMMARY_FIELDS,table)?SUMMARY_FIELDS[table]:null;
  if(relevant){
    if(method==='POST'&&['app_documents','app_record_links'].includes(table))return !!saved.projectLinked;
    return ['POST','DELETE'].includes(method)||fields.some(field=>relevant.includes(field));
  }
  if(path.pathname==='/functions/v1/google-tasks'){
    const action=saved.action||path.searchParams.get('action');
    // update/toggle/delete는 DB의 완료 여부 사본·연결을 바꾼다.
    return ['update','toggle','delete'].includes(action)||(['create','link','unlink'].includes(action)&&!!saved.projectLinked);
  }
  if(path.pathname==='/functions/v1/basket-files')return true;
  if(path.pathname==='/rest/v1/rpc/app_basket_confirm_links')return true;
  // 프로젝트 자료 개수가 바뀌는 업로드.
  return ['/functions/v1/library-files','/functions/v1/meeting-files'].includes(path.pathname)&&!!saved.projectLinked;
}

// 묶기: 저장마다 기다림을 다시 세되, 처음 저장부터 MAX_WAIT_MS를 넘기지 않는다.
// 한 번에 하나만 부르고, 부르는 동안 들어온 저장은 끝난 뒤 한 번 더 묶어 부른다.
export function createRefresher({call,isOwner,now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,waitMs=WAIT_MS,maxWaitMs=MAX_WAIT_MS}){
  let timer=null,firstAt=null,flight=null,dirty=false,generation=0;
  function cancelTimer(){if(timer!==null)clearTimer(timer);timer=null}
  function arm(){
    cancelTimer();
    const delay=Math.max(0,Math.min(waitMs,firstAt+maxWaitMs-now()));
    timer=setTimer(()=>{timer=null;void run()},delay);
  }
  function saved(){
    if(!isOwner())return;
    dirty=true;
    if(firstAt===null)firstAt=now();
    if(!flight)arm();
  }
  async function run(leaving=false){
    if(flight||!dirty)return flight;
    if(!isOwner()){reset();return}
    cancelTimer();dirty=false;firstAt=null;
    const epoch=generation;
    flight=(async()=>{
      // 실패는 화면에 알리지 않는다. 원본 저장은 이미 끝났고 다음 저장이나 예약 실행이 다시 만든다.
      try{await call({leaving})}catch{/* 사본 갱신 실패는 원본 저장 결과를 바꾸지 않는다. */}
      finally{
        flight=null;
        if(epoch===generation&&dirty&&isOwner()){firstAt??=now();arm()}
      }
    })();
    return flight;
  }
  // 화면이 가려지거나 닫힐 때: 기다리던 갱신을 바로 보낸다.
  function flush(){if(timer!==null&&!flight)void run(true)}
  function reset(){cancelTimer();dirty=false;firstAt=null;generation++}
  return {saved,flush,reset,pending:()=>timer!==null||dirty,busy:()=>!!flight};
}

function install(win){
  const rt=win.KPTURuntime;
  if(!rt||win.KPTUDriveSummary)return;
  const owner=()=>{
    const c=rt.context?.read?.(),s=rt.session?.read?.();
    return !!s?.access_token&&c?.user?.id===s?.user?.id&&c?.workspace?.slug==='kptu-work'&&c?.membership?.role==='owner';
  };
  // 본문 없이 부른다. 서버가 작업공간·소유자를 정한다. 세션 갱신·로그아웃 같은 부작용은 없다.
  // 화면을 떠나는 순간에는 탭이 닫혀도 요청이 나가도록 같은 주소·키·현재 토큰으로 keepalive 요청을 보낸다.
  const call=async({leaving})=>{
    if(!leaving)return rt.api('/functions/v1/drive-summary',{method:'POST',refreshSession:false,timeoutMs:120000});
    const token=rt.session.read()?.access_token;
    if(!token)return;
    await fetch(rt.config.url+'/functions/v1/drive-summary',{method:'POST',headers:{apikey:rt.config.key,Authorization:'Bearer '+token},cache:'no-store',keepalive:true});
  };
  const refresher=createRefresher({isOwner:owner,call});
  win.KPTUDriveSummary=Object.freeze({saved:refresher.saved});
  win.addEventListener('kptu:api-saved',event=>{if(owner()&&affectsSummary(event.detail,rt.config.url))refresher.saved()});
  // 자료 삭제는 응답에 프로젝트가 없어서, 지운 쪽이 알고 있는 옛 프로젝트로 알린다.
  win.addEventListener('kptu:documents-changed',event=>{if(event.detail?.project_id)refresher.saved()});
  win.addEventListener('kptu:session-changed',()=>{if(!owner())refresher.reset()});
  win.document?.addEventListener('visibilitychange',()=>{if(win.document.visibilityState==='hidden')refresher.flush()});
  win.addEventListener('pagehide',()=>refresher.flush());
}

if(typeof window!=='undefined')install(window);
