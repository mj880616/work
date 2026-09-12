(()=>{
  if(window.__KPTU_MEMBER_DEFAULT_ROLE__)return;
  window.__KPTU_MEMBER_DEFAULT_ROLE__=true;
  const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
  const KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
  const SESSION='kptu_collab_session_v1';
  let joining=false;
  function getSession(){try{return JSON.parse(localStorage.getItem(SESSION)||'null')}catch{return null}}
  async function tryJoin(){
    if(joining)return;
    const boot=document.querySelector('#bootstrapView');
    if(!boot||boot.classList.contains('hidden'))return;
    const s=getSession();if(!s?.access_token)return;
    joining=true;
    try{
      const r=await fetch(SB+'/rest/v1/rpc/app_join_default_team',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:'{}',cache:'no-store'});
      if(r.ok){location.reload();return}
    }catch(_){}finally{joining=false}
  }
  function tuneUi(){
    const invite=document.querySelector('#inviteRole');
    if(invite){invite.innerHTML='<option value="author" selected>팀원</option>';invite.value='author';const lab=invite.closest('label');if(lab)lab.style.display='none'}
    const wr=document.querySelector('#workspaceRole');if(wr)wr.textContent=wr.textContent.replace('작성자','팀원');
    const ub=document.querySelector('#userBadge');if(ub)ub.textContent=ub.textContent.replace(' · 작성자',' · 팀원');
    document.querySelectorAll('#memberList .member-card span').forEach(x=>{if(x.textContent.trim()==='작성자')x.textContent='팀원'});
    tryJoin();
  }
  const mo=new MutationObserver(()=>tuneUi());
  mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  setTimeout(tuneUi,0);
})();
