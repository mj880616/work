(()=>{
  if(window.__KPTU_MOBILE_MODAL_HISTORY__)return;
  window.__KPTU_MOBILE_MODAL_HISTORY__=true;
  const mq=window.matchMedia('(max-width:760px)');
  const watched=new WeakSet();
  const isVisible=el=>!!el&&!el.classList.contains('hidden')&&getComputedStyle(el).display!=='none';

  function sync(modal){
    if(!mq.matches||!modal.id)return;
    const open=isVisible(modal),tracked=modal.dataset.kptuHistoryOpen==='1';
    if(open&&!tracked){
      modal.dataset.kptuHistoryOpen='1';
      history.pushState({...(history.state||{}),kptuOverlay:modal.id},'',location.href);
      return;
    }
    if(!open&&tracked){
      modal.dataset.kptuHistoryOpen='0';
      if(modal.dataset.kptuHistoryClosing==='pop'){
        delete modal.dataset.kptuHistoryClosing;
        return;
      }
      if(history.state?.kptuOverlay===modal.id)history.back();
    }
  }

  function watch(modal){
    if(!modal||watched.has(modal))return;
    watched.add(modal);
    new MutationObserver(()=>sync(modal)).observe(modal,{attributes:true,attributeFilter:['class','aria-hidden']});
    if(isVisible(modal))sync(modal);
  }

  function attach(){document.querySelectorAll('.modal').forEach(watch)}
  attach();
  new MutationObserver(attach).observe(document.body,{childList:true,subtree:true});

  window.addEventListener('popstate',event=>{
    if(!mq.matches)return;
    const open=[...document.querySelectorAll('.modal')].filter(m=>isVisible(m)&&m.dataset.kptuHistoryOpen==='1').pop();
    if(!open||event.state?.kptuOverlay===open.id)return;
    open.dataset.kptuHistoryClosing='pop';
    const button=open.querySelector(`[data-close="${open.id}"],[data-pm2-close="${open.id}"]`);
    if(button)button.click();
    else{
      open.classList.add('hidden');
      open.setAttribute('aria-hidden','true');
    }
  });
})();
