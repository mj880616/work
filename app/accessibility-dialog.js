(()=>{
  if(window.KPTUA11y?.dialog)return;
  const state=new WeakMap();
  let active=null;
  const focusable='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const resolve=(modal,value)=>typeof value==='string'?modal.querySelector(value):value;
  const items=modal=>[...modal.querySelectorAll(focusable)].filter(el=>!el.closest('.hidden')&&el.getClientRects().length);

  function activate(modal,{trigger=document.activeElement,initialFocus=null,onRequestClose=null}={}){
    if(!modal)return;
    state.set(modal,{trigger,onRequestClose});
    active=modal;
    const target=resolve(modal,initialFocus)||items(modal)[0]||modal;
    if(target===modal&&!modal.hasAttribute('tabindex'))modal.setAttribute('tabindex','-1');
    target.focus({preventScroll:true});
  }

  function deactivate(modal,{restoreFocus=true,fallbackFocus=null}={}){
    if(!modal)return;
    const saved=state.get(modal);
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
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  });

  window.KPTUA11y={...(window.KPTUA11y||{}),dialog:{activate,deactivate}};
})();
