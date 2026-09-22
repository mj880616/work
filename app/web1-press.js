(()=>{
'use strict';
if(window.KPTUWeb1Press)return;
const ARCHIVE=new URL('../press/archive.json',location.href).href;
const WEB1='https://work.bokdoong.com/work/press/';
const typeLabel={statement:'성명',release:'보도자료',request:'취재요청'};
let items=[],type='all',loaded=false,bound=false;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=id=>document.getElementById(id);
function internalUrl(href){
  return new URL(href,new URL('../press/',location.href)).href;
}
function filtered(){
  const q=(el('pressSearch')?.value||'').trim().toLowerCase();
  return items.filter(x=>(type==='all'||x.type===type)&&(!q||[x.title,x.publisher,x.type_label,x.date].join(' ').toLowerCase().includes(q)));
}
function render(){
  const host=el('pressArchiveList'),empty=el('pressArchiveEmpty');if(!host)return;
  const rows=filtered(),years=[...new Set(rows.map(x=>x.year))].sort((a,b)=>b-a);
  host.innerHTML=years.map(year=>{
    const list=rows.filter(x=>x.year===year);
    return '<section class="w1p-year"><h3>'+esc(year)+'</h3><div class="w1p-table"><div class="w1p-head" aria-hidden="true"><span>날짜</span><span>구분</span><span>제목</span><span>발행</span></div><div class="w1p-list">'+list.map(x=>
      '<button class="w1p-item" type="button" data-press-href="'+esc(x.href)+'" data-press-title="'+esc(x.title)+'">'+
      '<span class="w1p-date">'+esc(x.display_date)+'</span>'+
      '<span class="w1p-tag '+esc(x.type)+'">'+esc(typeLabel[x.type]||x.type_label)+'</span>'+
      '<span class="w1p-title">'+esc(x.title)+'</span><span class="w1p-publisher">'+esc(x.publisher)+'</span></button>'
     ).join('')+'</div></div></section>';
  }).join('');
  empty?.classList.toggle('hidden',rows.length>0);
  el('mediaView')?.setAttribute('data-press-ready','1');
}
function closeDetail(){
  const modal=el('pressDetailModal'),frame=el('pressDetailFrame');if(!modal)return;
  modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');if(frame)frame.src='about:blank';
}
function openDetail(href,title){
  const modal=el('pressDetailModal'),frame=el('pressDetailFrame'),heading=el('pressDetailTitle');if(!modal||!frame)return;
  if(heading)heading.textContent=title||'성명·보도자료';
  frame.title=(title||'성명·보도자료')+' 본문';
  frame.src=internalUrl(href);
  modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  modal.querySelector('[data-close-press]')?.focus();
}
function bind(){
  if(bound)return;bound=true;
  el('pressSearch')?.addEventListener('input',render);
  document.querySelectorAll('[data-press-type]').forEach(btn=>btn.addEventListener('click',()=>{
    type=btn.dataset.pressType||'all';
    document.querySelectorAll('[data-press-type]').forEach(x=>x.classList.toggle('active',x===btn));
    render();
  }));
  document.addEventListener('click',e=>{
    const row=e.target.closest?.('[data-press-href]');if(row)openDetail(row.dataset.pressHref,row.dataset.pressTitle);
    if(e.target.closest?.('[data-close-press]'))closeDetail();
  });
  el('pressArchiveSource')?.addEventListener('click',()=>window.open(WEB1,'_blank','noopener'));
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el('pressDetailModal')?.classList.contains('hidden'))closeDetail()});
}
async function load(){
  bind();
  if(loaded){render();return true}
  const r=await fetch(ARCHIVE,{cache:'no-store'});if(!r.ok)throw new Error('성명·보도자료 목록을 불러오지 못했습니다.');
  const data=await r.json();items=Array.isArray(data?.items)?data.items:[];loaded=true;render();return true;
}
window.KPTUWeb1Press={load,render,openDetail};
window.__KPTU_WEB1_PRESS_READY__=load().catch(e=>{
  console.error('web1 press archive',e);
  const box=el('pressArchiveEmpty');if(box){box.textContent='성명·보도자료 목록을 불러오지 못했습니다.';box.classList.remove('hidden')}
  return false;
});
})();