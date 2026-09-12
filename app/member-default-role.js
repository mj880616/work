(()=>{
  if(window.__KPTU_MEMBER_DEFAULT_ROLE__)return;
  window.__KPTU_MEMBER_DEFAULT_ROLE__=true;
  const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
  const KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
  const SESSION='kptu_collab_session_v1';
  let joining=false,joinAttempted=false,tuneTimer=null;
  function getSession(){try{return JSON.parse(localStorage.getItem(SESSION)||'null')}catch{return null}}
  async function tryJoin(){
    if(joining||joinAttempted)return;
    const boot=document.querySelector('#bootstrapView');
    if(!boot||boot.classList.contains('hidden'))return;
    const s=getSession();if(!s?.access_token)return;
    joinAttempted=true;joining=true;
    try{
      const r=await fetch(SB+'/rest/v1/rpc/app_join_default_team',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:'{}',cache:'no-store'});
      if(r.ok){location.reload();return}
      joinAttempted=false;
    }catch(_){joinAttempted=false}finally{joining=false}
  }
  function tuneUi(){
    const invite=document.querySelector('#inviteRole');
    if(invite){
      const already=invite.options.length===1&&invite.options[0]?.value==='author'&&invite.options[0]?.textContent==='팀원';
      if(!already)invite.innerHTML='<option value="author" selected>팀원</option>';
      if(invite.value!=='author')invite.value='author';
      const lab=invite.closest('label');if(lab&&lab.style.display!=='none')lab.style.display='none';
    }
    const wr=document.querySelector('#workspaceRole');if(wr&&wr.textContent.includes('작성자'))wr.textContent=wr.textContent.replace('작성자','팀원');
    const ub=document.querySelector('#userBadge');if(ub&&ub.textContent.includes(' · 작성자'))ub.textContent=ub.textContent.replace(' · 작성자',' · 팀원');
    document.querySelectorAll('#memberList .member-card span').forEach(x=>{if(x.textContent.trim()==='작성자')x.textContent='팀원'});
    tryJoin();
  }
  function schedule(){clearTimeout(tuneTimer);tuneTimer=setTimeout(tuneUi,60)}
  const mo=new MutationObserver(schedule);
  mo.observe(document.body,{childList:true,subtree:true});
  setTimeout(tuneUi,0);
  setTimeout(()=>mo.disconnect(),15000);
})();
