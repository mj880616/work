(()=>{
  if(window.KPTUA11y?.dialog)return;
  const state=new WeakMap();
  let active=null;
  const focusable='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const resolve=(modal,value)=>typeof value==='string'?modal.querySelector(value):value;
  const items=modal=>[...modal.querySelectorAll(focusable),...document.querySelectorAll('#versionNotice button')].filter(el=>!el.closest('.hidden')&&el.getClientRects().length);

  // A visual keyboard can shrink the visual viewport without resizing the layout.
  // Compensate for zoom so iOS input auto-zoom still detects the keyboard,
  // while pinch zoom alone does not count as a keyboard.
  let inputFooter=null;
  function syncInputFooter(){
    const focused=document.activeElement,modal=focused?.closest('.modal')||active;
    const footer=modal&&!modal.classList.contains('hidden')?modal.querySelector('.modal-action-footer'):null;
    if(inputFooter!==footer)inputFooter?.removeAttribute('data-keyboard-open');
    inputFooter=footer;
    if(!footer)return;
    const viewport=window.visualViewport;
    const editing=modal.contains(focused)&&focused.matches('textarea,input:not([type="checkbox"]):not([type="radio"]),select');
    footer.toggleAttribute('data-keyboard-open',innerWidth<=760&&editing&&
      (viewport?viewport.height*viewport.scale:innerHeight)<innerHeight-120);
  }
  window.visualViewport?.addEventListener('resize',syncInputFooter);
  window.addEventListener('resize',syncInputFooter);
  document.addEventListener('focusin',syncInputFooter);
  document.addEventListener('focusout',()=>queueMicrotask(syncInputFooter));

  function activate(modal,{trigger=document.activeElement,initialFocus=null,onRequestClose=null}={}){
    if(!modal)return;
    active?.querySelector('.modal-action-footer')?.removeAttribute('data-keyboard-open');
    state.set(modal,{trigger,onRequestClose});
    active=modal;
    window.dispatchEvent(new CustomEvent('kptu:dialog-opened',{detail:{modal}}));
    const target=resolve(modal,initialFocus)||items(modal)[0]||modal;
    if(target===modal&&!modal.hasAttribute('tabindex'))modal.setAttribute('tabindex','-1');
    target.focus({preventScroll:true});
    syncInputFooter();
  }

  function deactivate(modal,{restoreFocus=true,fallbackFocus=null}={}){
    if(!modal)return;
    const saved=state.get(modal);
    modal.querySelector('.modal-action-footer')?.removeAttribute('data-keyboard-open');
    window.dispatchEvent(new CustomEvent('kptu:dialog-closed',{detail:{modal}}));
    state.delete(modal);
    if(active===modal)active=null;
    if(!restoreFocus)return;
    const target=saved?.trigger?.isConnected?saved.trigger:(typeof fallbackFocus==='string'?document.querySelector(fallbackFocus):fallbackFocus);
    target?.focus?.({preventScroll:true});
  }

  document.addEventListener('keydown',e=>{
    if(!active||active.classList.contains('hidden'))return;
    if(e.key==='Escape'){
      const fn=state.get(active)?.onRequestClose;
      if(fn){e.preventDefault();fn()}
      return;
    }
    if(e.key!=='Tab')return;
    const list=items(active);
    if(!list.length){e.preventDefault();active.focus();return}
    const first=list[0],last=list[list.length-1];
    const noticeFirst=list.find(el=>el.closest('#versionNotice'));
    const modalLast=list.filter(el=>active.contains(el)).at(-1);
    if(noticeFirst&&modalLast){
      if(!e.shiftKey&&document.activeElement===modalLast){e.preventDefault();noticeFirst.focus();return}
      if(e.shiftKey&&document.activeElement===noticeFirst){e.preventDefault();modalLast.focus();return}
    }
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  });

  window.KPTUA11y={...(window.KPTUA11y||{}),dialog:{activate,deactivate}};
})();
