(()=>{
  if(window.__KPTU_MEMBER_DEFAULT_ROLE__)return;
  window.__KPTU_MEMBER_DEFAULT_ROLE__=true;
  let tuneTimer=null;
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
  }
  function schedule(){clearTimeout(tuneTimer);tuneTimer=setTimeout(tuneUi,60)}
  const mo=new MutationObserver(schedule);
  mo.observe(document.body,{childList:true,subtree:true});
  setTimeout(tuneUi,0);
  setTimeout(()=>mo.disconnect(),15000);
})();
