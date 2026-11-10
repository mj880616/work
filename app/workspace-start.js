// MULTI-노조사용자 ②-4 (S50-19): 접근 거부 화면의 [내 작업공간 만들기]. 이 모듈이 그 버튼과 한 줄 안내의 유일한 주인이다.
// - team.js가 구성원 행이 없을 때(접근 거부) 한 번 부른다. 서버 답(app_workspace_start_status)이 '가입 스위치 켜짐 + 내 owner 행 없음'일 때만 버튼을 만든다.
//   스위치는 서버의 SQL 전용 행이라 화면이 켜거나 속일 수 없다. 답이 없거나 실패하면 버튼을 만들지 않는다(지금처럼 접근 거부·로그아웃만).
// - 누르면 app_workspace_start를 인자 없이 한 번 부른다(누가·어느 작업공간인지는 서버가 로그인 정보로만 정함). 성공하면 페이지를 다시 열어
//   평소 시작 순서(세션 확인 → 구성원 행 → 화면)로 들어간다. 누르는 동안 버튼을 잠가 두 번 보내지 않는다(서버도 두 번 와도 하나만 만듦).
const START_LABEL='내 작업공간 만들기';

function messageFor(err){
  const text=String(err?.message||'');
  if(/SIGNUP_CLOSED/.test(text))return '지금은 새 작업공간을 만들 수 없어요.';
  return '만들지 못했어요. 잠시 뒤 다시 눌러 주세요.';
}

export async function offerWorkspaceStart({rpc,reload=()=>location.reload()}={}){
  const card=document.querySelector('#accessDeniedView');
  if(!card||typeof rpc!=='function'||card.querySelector('[data-workspace-start]'))return false;
  let state=null;
  try{state=await rpc('app_workspace_start_status')}catch{return false}
  if(!state||state.open!==true||state.has_workspace!==false)return false;
  if(card.classList.contains('hidden')||card.querySelector('[data-workspace-start]'))return false;
  const button=document.createElement('button');
  button.type='button';button.className='primary';button.dataset.workspaceStart='';button.textContent=START_LABEL;
  const note=document.createElement('p');
  note.className='workspace-start-note';note.setAttribute('role','status');note.hidden=true;
  button.addEventListener('click',async()=>{
    if(button.disabled)return;
    button.disabled=true;note.hidden=false;note.textContent='만드는 중…';
    try{
      const result=await rpc('app_workspace_start');
      if(result?.ok!==true||typeof result.workspace_id!=='string')throw new Error('WORKSPACE_START_BAD_ANSWER');
      note.textContent='만들었습니다. 다시 엽니다.';
      reload();
    }catch(err){
      note.textContent=messageFor(err);
      button.disabled=false;
    }
  });
  const logout=card.querySelector('#accessDeniedLogoutBtn');
  if(logout)logout.before(button,' ');else card.append(button);
  card.append(note);
  return true;
}
