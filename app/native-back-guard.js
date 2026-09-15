(()=>{
  'use strict';
  if(window.__KPTU_NATIVE_BACK_GUARD__)return;
  window.__KPTU_NATIVE_BACK_GUARD__=true;
  const ua=navigator.userAgent||'';
  if(!/KPTUAndroid/i.test(ua))return;

  let current=window.KPTURouter?.current||window.KPTURouter?.detect?.()||null;
  const stack=[];

  window.addEventListener('kptu:view-changed',event=>{
    const d=event?.detail||{},next=d.view;
    if(!next)return;
    if(d.source==='native-back'||d.source==='popstate'){
      if(stack[stack.length-1]===next)stack.pop();
      current=next;
      return;
    }
    if(d.source==='native-back-guard'){
      current=next;
      return;
    }
    if(current&&current!==next&&stack[stack.length-1]!==current)stack.push(current);
    current=next;
  });

  function install(){
    const native=window.KPTUNativeBack;
    if(!native?.handle||native.__kptuGuarded)return false;
    const original=native.handle.bind(native);
    native.__kptuGuarded=true;
    native.handle=function(){
      try{
        if(original())return true;
      }catch{}
      const router=window.KPTURouter;
      const now=router?.current||router?.detect?.()||current;
      while(stack.length){
        const prev=stack.pop();
        if(prev&&prev!==now&&document.getElementById(prev+'View')){
          router?.go?.(prev,{source:'native-back-guard',replaceUrl:true});
          current=prev;
          return true;
        }
      }
      if(now&&now!=='home'&&document.getElementById('homeView')){
        router?.go?.('home',{source:'native-back-guard',replaceUrl:true});
        current='home';
        return true;
      }
      return true;
    };
    return true;
  }

  if(!install()){
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      if(install()||tries>=120)clearInterval(timer);
    },50);
  }
})();
