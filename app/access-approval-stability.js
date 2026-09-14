(()=>{
  'use strict';
  if(window.__KPTU_ACCESS_APPROVAL_STABILITY__)return;
  window.__KPTU_ACCESS_APPROVAL_STABILITY__=true;
  const selectedRoles=new Map();
  const help={
    viewer:'팀의 일정·할 일·프로젝트·자료·회의 등을 볼 수 있음. 새 팀 콘텐츠 작성·수정은 할 수 없음.',
    author:'열람 권한 + 새 일정·할 일·회의·자료·페이지·프로젝트 등을 만들 수 있음. 본인이 만든 항목·담당 업무·권한이 있는 프로젝트 범위에서 수정 가능.',
    editor:'작성자 권한 + 팀 공용 항목을 다른 사람이 만든 경우에도 수정·정리할 수 있음.',
    admin:'편집자 권한 + 가입 승인, 구성원 권한 변경 등 팀 관리 가능.'
  };
  let observer=null,timer=null;

  function sync(){
    const team=document.querySelector('#teamView');if(!team)return;
    const section=document.querySelector('#aaReviewSection');
    const tools=document.querySelector('#tmoTools');
    if(section&&tools&&section.parentElement!==tools)tools.appendChild(section);
    document.querySelectorAll('[data-aa-role]').forEach(select=>{
      const id=select.dataset.aaRole,remembered=selectedRoles.get(id);
      if(remembered&&select.value!==remembered)select.value=remembered;
      const value=remembered||select.value;
      const el=document.querySelector(`[data-aa-help="${CSS.escape(id)}"]`);
      if(el&&help[value])el.textContent=help[value];
    });
    if(section&&section.dataset.aaAutoOpened!=='1'){
      const count=(document.querySelector('#aaPendingCount')?.textContent||'').match(/(\d+)/);
      if(count&&Number(count[1])>0){section.open=true;section.dataset.aaAutoOpened='1'}
    }
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(sync,0)}
  document.addEventListener('change',e=>{
    const select=e.target.closest?.('[data-aa-role]');if(!select)return;
    selectedRoles.set(select.dataset.aaRole,select.value);
    const el=document.querySelector(`[data-aa-help="${CSS.escape(select.dataset.aaRole)}"]`);
    if(el&&help[select.value])el.textContent=help[select.value];
  },true);
  function install(){
    const team=document.querySelector('#teamView');if(!team)return false;
    if(!observer){observer=new MutationObserver(schedule);observer.observe(team,{childList:true,subtree:true,characterData:true})}
    sync();return true;
  }
  window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='team')schedule()});
  if(!install()){
    const retry=setInterval(()=>{if(install())clearInterval(retry)},100);
    setTimeout(()=>clearInterval(retry),10000);
  }
})();
