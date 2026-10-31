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
  // A focused iframe (the HWP editor box) also counts: the field is inside it, and the viewport check below still decides.
  const editable=el=>!!el?.matches?.('input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="color"]),textarea,select,[contenteditable="true"],iframe');
  let inputFooter=null,keyboardOpen=false,layoutHeight=innerHeight,layoutWidth=innerWidth;
  // UI-자판가림: the field being typed in carries data-keyboard-field while the keyboard is open (one field at a time).
  // ui-standard.css hides every docked bar at the bottom (quick input, [+], switch row, sticky save row…) unless it holds
  // that field, so the docks never cover it. The mark stays through a tap's blur (like the keyboard state) and goes when
  // the keyboard closes. When the field gets focus, or the keyboard opens or grows, the field is scrolled into the part
  // of the screen above the keyboard with a little room under it; a later scroll by hand is left alone.
  let keyboardField=null,shownHeight=0;
  // A field on a bar that is itself fixed (a quick input dock, a bottom sheet) already sits where it can be seen; only
  // fields in the page or in a popup's scrolling card are moved.
  const pinned=el=>/^(fixed|sticky)$/.test(getComputedStyle(el).position);
  const onFixedBar=el=>{for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){if(getComputedStyle(p).position==='fixed')return !p.matches('.modal')}return false};
  // The pinned bar (a popup's title line, a sticky list head) drawn at this point that does not hold the field.
  function barAt(field,x,y){
    const hit=document.elementFromPoint(x,y);
    for(let p=hit;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){if(pinned(p))return p.contains(field)?null:p.getBoundingClientRect()}
    return null;
  }
  function scrollport(field){
    for(let p=field.parentElement;p&&p!==document.body;p=p.parentElement){
      if(/^(auto|scroll|overlay)$/.test(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight+1){const r=p.getBoundingClientRect();return {el:p,top:r.top,bottom:r.bottom}}
    }
    return {el:document.scrollingElement||document.documentElement,top:0,bottom:innerHeight};
  }
  function revealField(field){
    if(!field?.isConnected||field.matches('iframe')||onFixedBar(field))return;
    const viewport=window.visualViewport,r=field.getBoundingClientRect();
    if(!r.width&&!r.height)return;
    const port=scrollport(field),x=Math.min(Math.max(r.left+r.width/2,1),innerWidth-1);
    let top=Math.max(viewport?viewport.offsetTop:0,port.top),bottom=Math.min(viewport?viewport.offsetTop+viewport.height:innerHeight,port.bottom);
    const head=barAt(field,x,top+2),foot=barAt(field,x,bottom-2);
    if(head)top=Math.max(top,head.bottom);
    if(foot)bottom=Math.min(bottom,foot.top);
    // Room: a little above the field, one to two lines under it.
    top+=8;bottom-=40;
    const tall=r.height>bottom-top;
    if(!(tall?(r.top<bottom&&r.bottom>top):(r.top>=top&&r.bottom<=bottom))){
      field.style.scrollMarginTop=Math.max(0,Math.round(top-port.top))+'px';
      field.style.scrollMarginBottom=Math.max(0,Math.round(port.bottom-bottom))+'px';
      field.scrollIntoView({block:tall?'start':'nearest',inline:'nearest'});
      field.style.scrollMarginTop='';field.style.scrollMarginBottom='';
      if(!field.getAttribute('style'))field.removeAttribute('style');
    }
    // A pinned bar that was not at the edge when measured (a popup title line not yet stuck) can still lie on the
    // field: look at the field's own top and bottom edge and move it clear (twice at most).
    for(let i=0;i<2;i++){
      const now=field.getBoundingClientRect(),over=barAt(field,x,now.top+1),under=tall?null:barAt(field,x,now.bottom-1);
      const delta=over?now.top-over.bottom-8:under?now.bottom-under.top+40:0;
      if(!delta)break;
      port.el.scrollBy(0,delta);
    }
  }
  function syncKeyboard(){
    const viewport=window.visualViewport,focused=document.activeElement,editing=editable(focused);
    if((!editing&&!keyboardOpen)||!phone.matches||innerWidth!==layoutWidth){layoutHeight=innerHeight;layoutWidth=innerWidth}
    const scale=viewport?viewport.scale||1:1;
    const covered=viewport?Math.max(layoutHeight,innerHeight)-viewport.height*scale-viewport.offsetTop:0;
    // A tap on a button blurs the field during its mousedown, before the click: dropping the state there would
    // bring the tab bar back under the finger. Keep it until the viewport actually grows back.
    const keyboard=phone.matches&&(editing||keyboardOpen)&&(viewport?covered>120:editing);
    const opened=!!keyboard&&!keyboardOpen;
    keyboardOpen=!!keyboard;
    const field=keyboardOpen?(editing?focused:keyboardField):null,moved=field!==keyboardField;
    if(moved){keyboardField?.removeAttribute('data-keyboard-field');field?.setAttribute('data-keyboard-field','')}
    keyboardField=field;
    document.body?.classList.toggle('kptu-mobile-keyboard',keyboardOpen);
    // Where the layout viewport already shrinks with the keyboard this stays 0.
    const inset=keyboardOpen&&viewport?Math.max(0,Math.round(innerHeight-viewport.height*scale-viewport.offsetTop)):0;
    document.documentElement.style.setProperty('--kptu-keyboard-inset',inset+'px');
    const modal=focused?.closest?.('.modal')||active;
    const footer=modal&&!modal.classList.contains('hidden')?modal.querySelector('.modal-action-footer'):null;
    if(inputFooter!==footer)inputFooter?.removeAttribute('data-keyboard-open');
    inputFooter=footer;
    footer?.toggleAttribute('data-keyboard-open',keyboardOpen&&editing&&modal.contains(focused));
    const height=viewport?viewport.height*scale:innerHeight;
    if(keyboardOpen&&editing&&(opened||(moved&&field)||height<shownHeight-1))revealField(field);
    shownHeight=keyboardOpen?height:0;
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
