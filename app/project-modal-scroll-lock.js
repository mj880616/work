(()=>{
  'use strict';

  const MODAL_SELECTOR='[id^="pm2"][id$="Modal"].modal';
  let locked=false;
  let savedScrollY=0;
  let shellStyle=null;

  const openModals=()=>[...document.querySelectorAll(MODAL_SELECTOR)].filter(el=>!el.classList.contains('hidden'));

  function lockPage(){
    if(locked)return;
    locked=true;
    savedScrollY=window.scrollY||window.pageYOffset||0;
    const shell=document.querySelector('.shell');
    document.documentElement.classList.add('pm2-page-locked');
    document.body.classList.add('pm2-page-locked');
    if(shell){
      shellStyle={position:shell.style.position||'',top:shell.style.top||'',left:shell.style.left||'',right:shell.style.right||'',width:shell.style.width||'',overflow:shell.style.overflow||''};
      shell.style.position='fixed';
      shell.style.top=`-${savedScrollY}px`;
      shell.style.left='0';
      shell.style.right='0';
      shell.style.width='100%';
      shell.style.overflow='hidden';
      shell.classList.add('pm2-background-locked');
    }
  }

  function unlockPage(){
    if(!locked)return;
    locked=false;
    const shell=document.querySelector('.shell');
    document.documentElement.classList.remove('pm2-page-locked');
    document.body.classList.remove('pm2-page-locked');
    if(shell&&shellStyle){
      shell.style.position=shellStyle.position;
      shell.style.top=shellStyle.top;
      shell.style.left=shellStyle.left;
      shell.style.right=shellStyle.right;
      shell.style.width=shellStyle.width;
      shell.style.overflow=shellStyle.overflow;
      shell.classList.remove('pm2-background-locked');
    }
    shellStyle=null;
    window.scrollTo(0,savedScrollY);
  }

  function sync(){
    if(openModals().length)lockPage();
    else unlockPage();
  }

  function attach(){
    const modals=[...document.querySelectorAll(MODAL_SELECTOR)];
    if(!modals.length)return false;
    modals.forEach(modal=>{
      if(modal.dataset.pm2ScrollWatch==='1')return;
      modal.dataset.pm2ScrollWatch='1';
      new MutationObserver(sync).observe(modal,{attributes:true,attributeFilter:['class','aria-hidden']});
    });
    sync();
    return true;
  }

  if(!document.querySelector('#pm2ScrollLockStyle')){
    const style=document.createElement('style');
    style.id='pm2ScrollLockStyle';
    style.textContent=`
      html.pm2-page-locked,body.pm2-page-locked{overflow:hidden!important;overscroll-behavior:none!important;height:100%!important}
      .shell.pm2-background-locked{overflow:hidden!important;overscroll-behavior:none!important}

      /* 프로젝트 상세 위에서 호출되는 공용 입력창은 항상 상세창보다 위에 표시 */
      #taskModal,#documentModal,#meetingModal,#editorModal{z-index:80!important}

      /* Android WebView에서도 카드 자체가 아니라 오버레이가 스크롤을 담당하도록 통일 */
      ${MODAL_SELECTOR}{
        display:block;
        overflow-y:auto!important;
        overflow-x:hidden!important;
        overscroll-behavior:contain!important;
        -webkit-overflow-scrolling:touch;
        touch-action:pan-y!important;
        padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom))!important;
      }
      ${MODAL_SELECTOR}.hidden{display:none!important}
      ${MODAL_SELECTOR} .modal-card{
        max-height:none!important;
        overflow:visible!important;
        margin:0 auto!important;
        touch-action:auto!important;
      }
      #pm2DetailModal .pm2-detail-card{max-height:none!important;overflow:visible!important}

      @media(max-width:760px){
        ${MODAL_SELECTOR}{
          padding:max(8px,env(safe-area-inset-top)) 0 calc(var(--kptu-mobile-dock,72px) + 12px)!important;
          scroll-padding-bottom:calc(var(--kptu-mobile-dock,72px) + 12px)!important;
        }
        ${MODAL_SELECTOR} .modal-card{
          width:100%!important;
          max-height:none!important;
          min-height:0!important;
          border-radius:18px 18px 0 0!important;
          padding-bottom:28px!important;
        }
        #pm2DetailModal .pm2-detail-card{min-height:calc(100dvh - var(--kptu-mobile-dock,72px) - 12px)!important}
        #pm2MilestoneModal .small-card,#pm2DecisionModal .small-card,#pm2ProgressModal .small-card,#pm2WorkstreamModal .small-card,#pm2ModulesModal .small-card{
          margin-top:8px!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  if(!attach()){
    const bootObserver=new MutationObserver(()=>{
      if(attach())bootObserver.disconnect();
    });
    bootObserver.observe(document.body,{childList:true,subtree:true});
  }
})();
