(()=>{
  window.addEventListener('kptu:session-changed',event=>{
    if(!event.detail?.session)return;
    setTimeout(()=>window.dispatchEvent(new CustomEvent('kptu:tasks-changed',{detail:{source:'session-ready'}})),450);
    setTimeout(()=>window.dispatchEvent(new CustomEvent('kptu:tasks-changed',{detail:{source:'session-stable'}})),1100);
  });
})();
