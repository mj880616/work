// 임시 진단(MTG-프로젝트합치기 이어받기 3차): CI에서만 원인을 보려고 실패 때 상태를 오류 문구에 붙인다. 원인을 찾으면 지운다.
export const diagInit=()=>{
  window.__diag=[];const log=(k,v)=>{try{window.__diag.push([Math.round(performance.now()),k,v]);if(window.__diag.length>80)window.__diag.shift()}catch{}};
  const watch=new Set(['ps3DetailModal','areaWindow','projectGrid']);
  window.addEventListener('popstate',e=>log('pop',JSON.stringify(e.state)+' '+location.search),true);
  const conf=window.confirm;window.confirm=function(m){log('confirm',String(m).slice(0,20));return conf.call(window,m)};
  const ps=history.pushState,rs=history.replaceState,bk=history.back;
  history.pushState=function(s,t,u){log('push',JSON.stringify(s)+' '+u);return ps.call(history,s,t,u)};
  history.replaceState=function(s,t,u){log('repl',JSON.stringify(s)+' '+u);return rs.call(history,s,t,u)};
  history.back=function(){log('back',new Error().stack.split('\n').slice(2,4).join('|').replace(/https?:\/\/[^ )]*\/app\//g,''));return bk.call(history)};
  new MutationObserver(ms=>{for(const m of ms){const el=m.target;if(!watch.has(el.id))continue;const now=el.classList.contains('hidden')+'/'+(el.dataset.ps3Ready||'')+'/'+(el.parentElement?.id||el.parentElement?.tagName);if(el.__last!==now){el.__last=now;log(el.id,now)}}}).observe(document,{subtree:true,attributes:true,attributeFilter:['class','data-ps3-ready']});
};
export async function diagDump(page,sel){
  return page.evaluate(sel=>{
    const q=s=>document.querySelector(s),d=el=>el?{hidden:el.classList.contains('hidden'),ds:{...el.dataset},parent:el.parentElement?.id||el.parentElement?.tagName}:null;
    const chain=[];let el=sel?document.querySelector(sel):null;const r=el?.getBoundingClientRect();
    for(let x=el;x&&x!==document.documentElement;x=x.parentElement){const cs=getComputedStyle(x),b=x.getBoundingClientRect();if(cs.display==='none'||cs.visibility!=='visible'||b.width===0||b.height===0)chain.push((x.id||x.className||x.tagName).toString().slice(0,40)+':'+cs.display+'/'+cs.visibility+'/'+Math.round(b.width)+'x'+Math.round(b.height))}
    return {url:location.pathname+location.search,len:history.length,state:history.state,router:window.KPTURouter?.current,area:d(q('#areaWindow')),detail:d(q('#ps3DetailModal')),body:q('#ps3Body')?.dataset.project,forms:document.querySelectorAll('[data-link-summary-form]').length,
      modals:[...document.querySelectorAll('.modal:not(.hidden)')].map(m=>m.id),target:sel?{n:document.querySelectorAll(sel).length,rect:r?[r.x,r.y,r.width,r.height].map(Math.round):null,chain}:null,vw:innerWidth,log:window.__diag};
  },sel||null);
}
export async function withDiag(page,sel,fn){try{return await fn()}catch(e){let d;try{d=await diagDump(page,sel)}catch(x){d='dump failed '+x.message}e.message+='\nDIAG '+JSON.stringify(d);throw e}}
