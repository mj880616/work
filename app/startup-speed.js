const SS_SESSION='kptu_collab_session_v1';
const SS_CACHE='kptu_workspace_shell_v1';
function ssRead(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
function ssShowCachedShell(){
  const session=ssRead(SS_SESSION),cache=ssRead(SS_CACHE);
  if(!session?.access_token||!cache||Date.now()-(cache.savedAt||0)>7*86400000)return;
  const app=document.querySelector('#appView'),auth=document.querySelector('#authView'),boot=document.querySelector('#bootstrapView');
  if(!app)return;
  auth?.classList.add('hidden');boot?.classList.add('hidden');app.classList.remove('hidden');
  const n=document.querySelector('#workspaceName'),r=document.querySelector('#workspaceRole'),u=document.querySelector('#userBadge'),l=document.querySelector('#logoutBtn');
  if(n&&cache.workspaceName)n.textContent=cache.workspaceName;
  if(r&&cache.workspaceRole)r.textContent=cache.workspaceRole;
  if(u&&cache.userBadge){u.textContent=cache.userBadge;u.classList.remove('hidden')}
  l?.classList.remove('hidden');
  document.documentElement.dataset.fastShell='1';
}
function ssCapture(){
  const app=document.querySelector('#appView'),role=document.querySelector('#workspaceRole'),badge=document.querySelector('#userBadge');
  if(!app||app.classList.contains('hidden')||!role?.textContent.trim())return false;
  try{localStorage.setItem(SS_CACHE,JSON.stringify({workspaceName:document.querySelector('#workspaceName')?.textContent||'공공기관사업팀 Workspace',workspaceRole:role.textContent,userBadge:badge?.textContent||'',savedAt:Date.now()}))}catch{}
  return true;
}
ssShowCachedShell();
let tries=0;const timer=setInterval(()=>{tries++;if(ssCapture()||tries>20)clearInterval(timer)},500);
