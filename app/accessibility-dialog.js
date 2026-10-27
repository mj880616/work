(()=>{
  if(window.KPTUA11y?.dialog)return;
  const state=new WeakMap();
  let active=null;
  const focusable='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const resolve=(modal,value)=>typeof value==='string'?modal.querySelector(value):value;
  const items=modal=>[...modal.querySelectorAll(focusable),...document.querySelectorAll('#versionNotice button')].filter(el=>!el.closest('.hidden')&&el.getClientRects().length);

  // UI-키보드하단바: the one phone keyboard detector for the whole app (popup footers, bottom tabs, docked inputs,
  // the full-screen editor). It sets body.kptu-mobile-keyboard (CSS hides the bottom tabs, --kptu-mobile-tab-height 0),
  // --kptu-keyboard-inset (how far the keyboard covers a page that does not resize), and data-keyboard-open on the
  // focused popup's .modal-action-footer. Phone width (760px or less) only.
  // A keyboard either shrinks the layout (interactive-widget=resizes-content: innerHeight drops below the height
  // seen before the field was focused) or only the visual viewport. Compensate for zoom so iOS input auto-zoom
  // still counts as a keyboard, while pinch zoom alone does not.
  const phone=window.matchMedia('(max-width:760px)');
  const editable=el=>!!el?.matches?.('input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="color"]),textarea,select,[contenteditable="true"]');
  let inputFooter=null,keyboardOpen=false,layoutHeight=innerHeight,layoutWidth=innerWidth;
  function syncKeyboard(){
    const viewport=window.visualViewport,focused=document.activeElement,editing=editable(focused);
    if((!editing&&!keyboardOpen)||!phone.matches||innerWidth!==layoutWidth){layoutHeight=innerHeight;layoutWidth=innerWidth}
    const scale=viewport?viewport.scale||1:1;
    const covered=viewport?Math.max(layoutHeight,innerHeight)-viewport.height*scale-viewport.offsetTop:0;
    // A tap on a button blurs the field during its mousedown, before the click: dropping the state there would
    // bring the tab bar back under the finger. Keep it until the viewport actually grows back.
    const keyboard=phone.matches&&(editing||keyboardOpen)&&(viewport?covered>120:editing);
    keyboardOpen=!!keyboard;
    document.body?.classList.toggle('kptu-mobile-keyboard',keyboardOpen);
    // Where the layout viewport already shrinks with the keyboard this stays 0.
    const inset=keyboardOpen&&viewport?Math.max(0,Math.round(innerHeight-viewport.height*scale-viewport.offsetTop)):0;
    document.documentElement.style.setProperty('--kptu-keyboard-inset',inset+'px');
    const modal=focused?.closest?.('.modal')||active;
    const footer=modal&&!modal.classList.contains('hidden')?modal.querySelector('.modal-action-footer'):null;
    if(inputFooter!==footer)inputFooter?.removeAttribute('data-keyboard-open');
    inputFooter=footer;
    footer?.toggleAttribute('data-keyboard-open',keyboardOpen&&editing&&modal.contains(focused));
  }
  window.visualViewport?.addEventListener('resize',syncKeyboard);
  window.visualViewport?.addEventListener('scroll',syncKeyboard);
  window.addEventListener('resize',syncKeyboard);
  phone.addEventListener?.('change',syncKeyboard);
  document.addEventListener('focusin',syncKeyboard);
  document.addEventListener('focusout',()=>queueMicrotask(syncKeyboard));

  // companions (optional): a function returning controls outside the dialog that stay in its Tab cycle (the full-screen
  // editor on a wide screen keeps the app's menu beside it). The cycle is the dialog, then these, then the version notice.
  function activate(modal,{trigger=document.activeElement,initialFocus=null,onRequestClose=null,companions=null}={}){
    if(!modal)return;
    active?.querySelector('.modal-action-footer')?.removeAttribute('data-keyboard-open');
    state.set(modal,{trigger,onRequestClose,companions});
    active=modal;
    window.dispatchEvent(new CustomEvent('kptu:dialog-opened',{detail:{modal}}));
    const target=resolve(modal,initialFocus)||items(modal)[0]||modal;
    if(target===modal&&!modal.hasAttribute('tabindex'))modal.setAttribute('tabindex','-1');
    target.focus({preventScroll:true});
    syncKeyboard();
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
    const extra=[...state.get(active)?.companions?.()||[]].filter(el=>!el.closest('.hidden')&&el.getClientRects().length);
    if(extra.length){
      const own=list.filter(el=>active.contains(el)),notice=list.filter(el=>el.closest('#versionNotice')&&!active.contains(el));
      const rings=[own,extra,notice].filter(ring=>ring.length),at=document.activeElement,i=rings.findIndex(ring=>ring.includes(at));
      if(i>=0){
        const ring=rings[i];
        if(!e.shiftKey&&at===ring.at(-1)){e.preventDefault();rings[(i+1)%rings.length][0].focus()}
        else if(e.shiftKey&&at===ring[0]){e.preventDefault();rings[(i+rings.length-1)%rings.length].at(-1).focus()}
        return;
      }
    }
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

  window.KPTUA11y={...(window.KPTUA11y||{}),dialog:{activate,deactivate},keyboard:{sync:syncKeyboard,isOpen:()=>keyboardOpen}};
})();
