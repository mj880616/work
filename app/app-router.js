(()=>{
  if(window.KPTURouter)return;
  const hooks=new Map();

  function go(view,{scroll=true,source='api'}={}){
    if(!view)return false;
    const target=document.getElementById(view+'View');
    if(!target)return false;
    document.querySelectorAll('#appView .view-panel').forEach(panel=>panel.classList.toggle('hidden',panel!==target));
    document.querySelectorAll('.app-nav .nav-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===view));
    document.querySelectorAll('#ccMobileDock [data-cc-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.ccView===view));
    api.current=view;
    if(scroll)window.scrollTo({top:0,behavior:'instant'});
    const detail={view,source};
    window.dispatchEvent(new CustomEvent('kptu:view-changed',{detail}));
    for(const fn of hooks.get(view)||[]){
      try{fn(detail)}catch(err){console.error('view hook',view,err)}
    }
    return true;
  }

  function on(view,fn){
    if(!hooks.has(view))hooks.set(view,new Set());
    hooks.get(view).add(fn);
    return()=>hooks.get(view)?.delete(fn);
  }

  function detect(){
    const panel=[...document.querySelectorAll('#appView .view-panel')].find(x=>!x.classList.contains('hidden'));
    return panel?.id?.replace(/View$/,'')||null;
  }

  function bind(){
    if(document.documentElement.dataset.kptuRouterBound==='1')return;
    document.documentElement.dataset.kptuRouterBound='1';
    document.addEventListener('click',e=>{
      const control=e.target.closest?.('[data-view],[data-goto],[data-cc-view]');
      if(!control)return;
      const view=control.dataset.view||control.dataset.goto||control.dataset.ccView;
      if(view)go(view,{source:'delegated'});
    });
    const brand=document.querySelector('.topbar .brand');
    if(brand&&brand.dataset.coreHomeBound!=='1'){
      brand.dataset.coreHomeBound='1';
      brand.addEventListener('click',e=>{
        if(document.querySelector('#appView')?.classList.contains('hidden'))return;
        e.preventDefault();
        go('home',{source:'brand'});
      });
    }
  }

  const api={current:null,go,on,detect,bind};
  window.KPTURouter=api;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
