(()=>{
  if(window.__KPTU_MOBILE_MODAL_HISTORY__)return;
  window.__KPTU_MOBILE_MODAL_HISTORY__=true;
  const mq=window.matchMedia('(max-width:760px)');
  const watched=new WeakSet();
  const touched=new WeakSet();
  const tracks=modal=>mq.matches||modal?.dataset.kptuHistoryAll==='1';
  const isVisible=el=>!!el&&!el.classList.contains('hidden')&&getComputedStyle(el).display!=='none';

  function sync(modal){
    if(!tracks(modal)||!modal.id)return;
    const open=isVisible(modal),tracked=modal.dataset.kptuHistoryOpen==='1';
    if(open&&!tracked){
      modal.dataset.kptuHistoryOpen='1';
      history.pushState({...(history.state||{}),kptuOverlay:modal.id},'',location.href);
      // NAV-PC앞뒤통일: the entry position of this window. Entries added on top of it (a menu, a detail inside the window) do not
      // carry its name, so going back to one of them must not close it: only a step below its own entry does.
      const index=window.navigation?.currentEntry?.index;
      if(Number.isInteger(index))modal.dataset.kptuHistoryIndex=String(index);else delete modal.dataset.kptuHistoryIndex;
      return;
    }
    if(!open)touched.delete(modal);
    if(!open&&tracked){
      modal.dataset.kptuHistoryOpen='0';
      if(modal.dataset.kptuHistoryClosing==='pop'){
        delete modal.dataset.kptuHistoryClosing;
        return;
      }
      if(history.state?.kptuOverlay===modal.id)history.back();
    }
  }

  // Consume the old overlay entry before showing its successor. A microtask runs
  // after every popstate listener has handled the traversal, without a timer.
  function closeThen(modal,openNext){
    const waitForBack=tracks(modal)&&modal?.dataset.kptuHistoryOpen==='1'&&history.state?.kptuOverlay===modal.id;
    if(waitForBack)window.addEventListener('popstate',()=>queueMicrotask(openNext),{once:true});
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden','true');
    window.KPTUA11y?.dialog.deactivate?.(modal,{restoreFocus:false});
    if(modal)sync(modal);
    if(!waitForBack)openNext();
  }
  window.KPTUMobileModalHistory={closeThen};

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
    const open=[...document.querySelectorAll('.modal')].filter(m=>tracks(m)&&isVisible(m)&&m.dataset.kptuHistoryOpen==='1').pop();
    if(!open||event.state?.kptuOverlay===open.id)return;
    const at=Number(open.dataset.kptuHistoryIndex),index=window.navigation?.currentEntry?.index;
    if(open.dataset.kptuHistoryIndex&&Number.isInteger(at)&&Number.isInteger(index)&&index>=at)return;
    open.dataset.kptuHistoryClosing='pop';
    const button=open.querySelector(`[data-close="${open.id}"],[data-pm2-close="${open.id}"]`);
    if(button)button.click();
    else{
      open.classList.add('hidden');
      open.setAttribute('aria-hidden','true');
    }
  });
  // S49-6 CAL-날칸누르기·바깥닫기 ③: 창 바깥(어둡게 가려진 자리)을 한 번 누르면 [×]를 누른 것과 같이 닫는다(공용, 폰·PC).
  // - 닫기는 창의 닫기 버튼(data-close·data-pm2-close)을 그대로 누른다: 뒤로가기 기록·창마다의 닫기 확인이 같은 길로 돈다.
  // - 창 안에서 글을 쓰거나 고른 적이 있으면(input·change) 바깥 누르기로는 닫지 않는다(쓰던 글 보호 — [×]의 '버릴까요' 확인 유지).
  // - 누름이 창 바깥에서 시작해 바깥에서 끝날 때만(창 안에서 끌다 놓은 손가락은 제외). 닫기만 하고 아래 화면은 눌리지 않는다.
  // - 따로 처리하는 창(화면 색·메뉴 편집·사업 보고 큰 창)과 data-no-outside-close 창은 건너뛴다.
  const OUTSIDE_SKIP=new Set(['themeModal','menuEditModal','areaWindow']);
  let downOn=null;
  const fieldEvent=e=>{const m=e.target.closest?.('.modal');if(m&&!e.target.closest('[data-close],[data-pm2-close]'))touched.add(m)};
  document.addEventListener('input',fieldEvent,true);
  document.addEventListener('change',fieldEvent,true);
  window.addEventListener('kptu:dialog-opened',e=>{const m=e.detail?.modal;if(m)touched.delete(m)});
  document.addEventListener('pointerdown',e=>{downOn=e.target?.classList?.contains('modal')?e.target:null},true);
  document.addEventListener('click',e=>{
    const modal=e.target,down=downOn;downOn=null;
    if(!modal?.classList?.contains('modal')||down!==modal||!modal.id||OUTSIDE_SKIP.has(modal.id)||'kptuNoOutsideClose' in modal.dataset)return;
    if(!isVisible(modal)||touched.has(modal))return;
    const button=modal.querySelector(`[data-close="${modal.id}"],[data-pm2-close="${modal.id}"]`);
    if(!button)return;
    e.preventDefault();e.stopPropagation();
    button.click();
  });
})();
