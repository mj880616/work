(()=>{
  'use strict';

  const MODAL_SELECTOR='[id^="pm2"][id$="Modal"].modal';
  let locked=false;
  let savedScrollY=0;

  const openModals=()=>[...document.querySelectorAll(MODAL_SELECTOR)].filter(el=>!el.classList.contains('hidden'));

  function lockPage(){
    if(locked)return;
    locked=true;
    savedScrollY=window.scrollY||window.pageYOffset||0;
    document.documentElement.classList.add('pm2-page-locked');
    document.body.classList.add('pm2-page-locked');
    document.body.style.position='fixed';
    document.body.style.top=`-${savedScrollY}px`;
    document.body.style.left='0';
    document.body.style.right='0';
    document.body.style.width='100%';
  }

  function unlockPage(){
    if(!locked)return;
    locked=false;
    document.documentElement.classList.remove('pm2-page-locked');
    document.body.classList.remove('pm2-page-locked');
    document.body.style.position='';
    document.body.style.top='';
    document.body.style.left='';
    document.body.style.right='';
    document.body.style.width='';
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
      html.pm2-page-locked,body.pm2-page-locked{overflow:hidden!important;overscroll-behavior:none!important}
      ${MODAL_SELECTOR}{overscroll-behavior:contain}
      ${MODAL_SELECTOR} .modal-card{overflow-y:auto!important;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y}
      @media(max-width:760px){${MODAL_SELECTOR} .modal-card{max-height:calc(100dvh - env(safe-area-inset-top) - 10px)!important}}
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
