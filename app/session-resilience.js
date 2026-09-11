const SR_KEY='kptu_collab_session_v1';
const SR_RETRY='kptu_session_boot_retry';
let srGuarding=true;
const srOriginalRemove=Storage.prototype.removeItem;
function srHasUsableSession(){
  try{const s=JSON.parse(localStorage.getItem(SR_KEY)||'null');return !!(s?.refresh_token||s?.access_token)}catch{return false}
}
Storage.prototype.removeItem=function(key){
  if(srGuarding&&this===localStorage&&key===SR_KEY&&srHasUsableSession()){
    sessionStorage.setItem('kptu_preserved_session',localStorage.getItem(SR_KEY)||'');
    return;
  }
  return srOriginalRemove.call(this,key);
};
function srRestoreRemove(){if(!srGuarding)return;srGuarding=false;Storage.prototype.removeItem=srOriginalRemove}
function srCheck(){
  const app=document.querySelector('#appView'),auth=document.querySelector('#authView'),status=document.querySelector('#authStatus');
  if(app&&!app.classList.contains('hidden')){sessionStorage.removeItem(SR_RETRY);srRestoreRemove();return true}
  if(auth&&!auth.classList.contains('hidden')&&srHasUsableSession()){
    const msg=status?.textContent||'';
    if(/세션을 다시 확인|요청 실패|권한 확인 실패|로그인이 필요/i.test(msg)){
      const n=Number(sessionStorage.getItem(SR_RETRY)||0);
      if(n<1){sessionStorage.setItem(SR_RETRY,String(n+1));setTimeout(()=>location.reload(),350);return true}
      srOriginalRemove.call(localStorage,SR_KEY);sessionStorage.removeItem(SR_RETRY);srRestoreRemove();return true;
    }
  }
  return false;
}
const srObserver=new MutationObserver(srCheck);
srObserver.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
setTimeout(()=>{srCheck();srRestoreRemove();srObserver.disconnect()},8000);
