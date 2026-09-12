const SR_KEY='kptu_collab_session_v1';
const SR_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SR_APIKEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const SR_RETRY='kptu_session_boot_retry_v3';
let srExplicitLogout=false,srRefreshing=false,srChecking=false;
const srOriginalRemove=Storage.prototype.removeItem;
function srRead(){try{return JSON.parse(localStorage.getItem(SR_KEY)||'null')}catch{return null}}
function srHasSession(){const s=srRead();return !!(s?.refresh_token||s?.access_token)}
function srAllowRemoval(){return srExplicitLogout||/type=recovery/.test(location.hash)||new URLSearchParams(location.search).get('password')==='changed'}
Storage.prototype.removeItem=function(key){
  if(this===localStorage&&key===SR_KEY&&srHasSession()&&!srAllowRemoval())return;
  return srOriginalRemove.call(this,key);
};
document.addEventListener('click',e=>{if(e.target.closest('#logoutBtn'))srExplicitLogout=true},true);
function srSetAuthMessage(text){const status=document.querySelector('#authStatus');if(status){status.textContent=text;status.className='status'}}
async function srUserValid(token){
  if(!token)return false;
  try{const r=await fetch(SR_SB+'/auth/v1/user',{headers:{apikey:SR_APIKEY,Authorization:'Bearer '+token}});if(r.ok)return true;if(r.status===401||r.status===403)return false;return null}catch{return null}
}
async function srRefreshStoredSession(){
  if(srRefreshing)return null;const s=srRead();if(!s?.refresh_token)return false;srRefreshing=true;
  try{
    const r=await fetch(SR_SB+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:SR_APIKEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh_token})});
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d?.access_token){d.expires_at=d.expires_at||Math.floor(Date.now()/1000)+(d.expires_in||3600);localStorage.setItem(SR_KEY,JSON.stringify(d));return true}
    const text=JSON.stringify(d).toLowerCase();
    if((r.status===400||r.status===401)&&/refresh.*token|invalid.*grant|session.*not.*found|refresh_token_not_found/.test(text)){srOriginalRemove.call(localStorage,SR_KEY);return false}
    return null;
  }catch{return null}finally{srRefreshing=false}
}
async function srRecover(){
  if(srChecking||srExplicitLogout||!srHasSession())return;srChecking=true;
  try{
    let s=srRead();
    const now=Math.floor(Date.now()/1000);
    let valid=(s?.access_token&&(s.expires_at||0)>now+90)?await srUserValid(s.access_token):false;
    if(valid===true){sessionStorage.removeItem(SR_RETRY);return true}
    const refreshed=await srRefreshStoredSession();
    if(refreshed===true){s=srRead();valid=await srUserValid(s?.access_token||'');if(valid===true)return true}
    if(refreshed===false)return false;
    return null;
  }finally{srChecking=false}
}
async function srCheck(){
  const app=document.querySelector('#appView'),auth=document.querySelector('#authView');
  if(app&&!app.classList.contains('hidden')){sessionStorage.removeItem(SR_RETRY);return}
  if(!auth||auth.classList.contains('hidden')||!srHasSession()||srExplicitLogout)return;
  const attempts=Number(sessionStorage.getItem(SR_RETRY)||0);
  if(attempts>=2){srSetAuthMessage('로그인 정보는 유지되어 있습니다. 앱 데이터를 다시 불러오지 못했습니다. 네트워크 연결 후 앱을 다시 열어 주세요.');return}
  srSetAuthMessage('로그인 상태를 복구하는 중입니다…');
  const result=await srRecover();
  if(result===true){sessionStorage.setItem(SR_RETRY,String(attempts+1));setTimeout(()=>location.reload(),180);return}
  if(result===null){srSetAuthMessage('네트워크 연결을 다시 확인하는 중입니다. 로그인 정보는 유지됩니다.');return}
  srSetAuthMessage('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
}
const srObserver=new MutationObserver(()=>setTimeout(srCheck,60));
srObserver.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
window.addEventListener('online',()=>srCheck());
window.addEventListener('pageshow',()=>setTimeout(srCheck,180));
setTimeout(srCheck,700);
