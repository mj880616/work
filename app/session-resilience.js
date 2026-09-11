const SR_KEY='kptu_collab_session_v1';
const SR_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SR_APIKEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
let srExplicitLogout=false,srRefreshing=false,srReloaded=false;
const srOriginalRemove=Storage.prototype.removeItem;
function srRead(){try{return JSON.parse(localStorage.getItem(SR_KEY)||'null')}catch{return null}}
function srHasSession(){const s=srRead();return !!(s?.refresh_token||s?.access_token)}
function srAllowRemoval(){return srExplicitLogout||/type=recovery/.test(location.hash)||new URLSearchParams(location.search).get('password')==='changed'}
Storage.prototype.removeItem=function(key){
  if(this===localStorage&&key===SR_KEY&&srHasSession()&&!srAllowRemoval())return;
  return srOriginalRemove.call(this,key);
};
document.addEventListener('click',e=>{if(e.target.closest('#logoutBtn'))srExplicitLogout=true},true);
async function srRefreshStoredSession(){
  if(srRefreshing)return false;const s=srRead();if(!s?.refresh_token)return false;srRefreshing=true;
  try{
    const r=await fetch(SR_SB+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:SR_APIKEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh_token})});
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d?.access_token){d.expires_at=d.expires_at||Math.floor(Date.now()/1000)+(d.expires_in||3600);localStorage.setItem(SR_KEY,JSON.stringify(d));return true}
    const text=JSON.stringify(d).toLowerCase();
    if(r.status===400&&/refresh.*token|invalid.*grant|session.*not.*found/.test(text)){srOriginalRemove.call(localStorage,SR_KEY);return false}
    return null;
  }catch{return null}finally{srRefreshing=false}
}
async function srCheck(){
  const app=document.querySelector('#appView'),auth=document.querySelector('#authView'),status=document.querySelector('#authStatus');
  if(app&&!app.classList.contains('hidden')){srReloaded=false;return}
  if(!auth||auth.classList.contains('hidden')||!srHasSession()||srExplicitLogout)return;
  const msg=status?.textContent||'';
  if(!/세션을 다시 확인|요청 실패|권한 확인 실패|로그인이 필요|처리 중/i.test(msg))return;
  const refreshed=await srRefreshStoredSession();
  if(refreshed===true&&!srReloaded){srReloaded=true;setTimeout(()=>location.reload(),180);return}
  if(refreshed===null){if(status){status.textContent='네트워크 연결을 다시 확인하는 중입니다. 로그인 정보는 유지됩니다.';status.className='status'}return}
}
const srObserver=new MutationObserver(()=>{setTimeout(srCheck,20)});
srObserver.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
window.addEventListener('online',()=>srCheck());
setTimeout(srCheck,400);