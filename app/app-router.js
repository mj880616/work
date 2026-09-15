(()=>{
  if(window.KPTURouter)return;
  const hooks=new Map();
  const VIEW_PARAM='view';
  let visibilityObserver=null;

  function appReady(){
    const app=document.querySelector('#appView');
    return !!app&&!app.classList.contains('hidden');
  }

  function viewExists(view){
    return !!view&&!!document.getElementById(view+'View');
  }

  function viewFromUrl(){
    const params=new URLSearchParams(location.search);
    const requested=params.get(VIEW_PARAM);
    if(viewExists(requested))return requested;
    if(params.get('project')&&viewExists('projects'))return 'projects';
    return viewExists('home')?'home':null;
  }

  function syncUrl(view,{replace=false}={}){
    if(!viewExists(view))return;
    const u=new URL(location.href);
    if(view==='home')u.searchParams.delete(VIEW_PARAM);
    else u.searchParams.set(VIEW_PARAM,view);
    const next=u.pathname+(u.search||'')+u.hash;
    const current=location.pathname+location.search+location.hash;
    if(next===current)return;
    const state={...(history.state||{}),kptuView:view};
    if(replace)history.replaceState(state,'',next);
    else history.pushState(state,'',next);
  }

  function scrollControlIntoView(container,control,behavior='smooth'){
    if(!container||!control||container.scrollWidth<=container.clientWidth+1)return;
    const box=container.getBoundingClientRect(),item=control.getBoundingClientRect();
    const pad=Math.min(24,Math.max(8,container.clientWidth*.06));
    const visible=item.left>=box.left+pad&&item.right<=box.right-pad;
    if(visible)return;
    const current=container.scrollLeft;
    const delta=(item.left-box.left)-(container.clientWidth-item.width)/2;
    const max=Math.max(0,container.scrollWidth-container.clientWidth);
    const left=Math.max(0,Math.min(max,current+delta));
    try{container.scrollTo({left,behavior})}catch{container.scrollLeft=left}
  }

  function keepActiveNavigationVisible(view,{behavior='smooth'}={}){
    const nav=document.querySelector('#appView>.app-nav')||document.querySelector('.app-nav');
    const navButton=nav?[...nav.querySelectorAll('.nav-btn[data-view]')].find(btn=>btn.dataset.view===view):null;
    scrollControlIntoView(nav,navButton,behavior);

    const dock=document.querySelector('#ccMobileDock');
    const dockButton=dock?[...dock.querySelectorAll('[data-cc-view]')].find(btn=>btn.dataset.ccView===view):null;
    scrollControlIntoView(dock,dockButton,behavior);
  }

  function go(view,{scroll=true,source='api',updateUrl=true,replaceUrl=false}={}){
    if(!view)return false;
    const target=document.getElementById(view+'View');
    if(!target)return false;
    document.querySelectorAll('#appView .view-panel').forEach(panel=>panel.classList.toggle('hidden',panel!==target));
    document.querySelectorAll('.app-nav .nav-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===view));
    document.querySelectorAll('#ccMobileDock [data-cc-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.ccView===view));
    api.current=view;
    const navBehavior=['initial','restore','visibility'].includes(source)?'auto':'smooth';
    requestAnimationFrame(()=>keepActiveNavigationVisible(view,{behavior:navBehavior}));
    if(updateUrl&&appReady())syncUrl(view,{replace:replaceUrl||source==='api'});
    if(scroll)window.scrollTo({top:0,behavior:'instant'});
    const detail={view,source};
    window.dispatchEvent(new CustomEvent('kptu:view-changed',{detail}));
    for(const fn of hooks.get(view)||[]){
      try{fn(detail)}catch(err){console.error('view hook',view,err)}
    }
    return true;
  }

  function restoreFromUrl(source='restore'){
    if(!appReady())return false;
    const view=viewFromUrl();
    if(!view)return false;
    const target=document.getElementById(view+'View');
    if(api.current===view&&target&&!target.classList.contains('hidden')){
      requestAnimationFrame(()=>keepActiveNavigationVisible(view,{behavior:'auto'}));
      return true;
    }
    return go(view,{scroll:false,source,updateUrl:false});
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

  function watchVisibility(){
    if(visibilityObserver)return;
    const app=document.querySelector('#appView');
    if(!app)return;
    visibilityObserver=new MutationObserver(()=>{
      if(appReady())setTimeout(()=>restoreFromUrl('visibility'),0);
    });
    visibilityObserver.observe(app,{attributes:true,attributeFilter:['class']});
  }

  function bind(){
    if(document.documentElement.dataset.kptuRouterBound==='1')return;
    document.documentElement.dataset.kptuRouterBound='1';
    api.current=detect();
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
    watchVisibility();
    setTimeout(()=>restoreFromUrl('initial'),0);
  }

  const api={current:null,go,on,detect,bind,restoreFromUrl,keepActiveNavigationVisible};
  window.KPTURouter=api;
  window.addEventListener('popstate',()=>restoreFromUrl('popstate'));
  window.addEventListener('kptu:session-changed',()=>setTimeout(()=>restoreFromUrl('session'),50));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
