(()=>{
  'use strict';
  if(window.KPTUWeb1Board)return;
  const rt=window.KPTURuntime;
  const RAW='https://raw.githubusercontent.com/mj880616/work/main/';
  const items=[
    {key:'2in1',title:'위험업무 2인1조 법제화',description:'법안 보완 · 노동부 대응 · 국회토론회 · 국정감사 · 궤도 공동투쟁',badge:'진행 중',href:'https://work.bokdoong.com/work/2in1/'},
    {key:'workforce',title:'공공기관 인력확충',description:'증원 연계 2% 인력감축 방침 철회와 안전·공공서비스 인력 확충 대응',badge:'당면 대응',href:'https://work.bokdoong.com/work/workforce/'},
    {key:'private-rail',title:'민자철도 사업 현황',description:'공영화 · 운영기준 · 사업장별 임단투 · 민간철도·지하철 부실운영 방지법 진행 현황',badge:'현장 공유',href:'https://work.bokdoong.com/work/private-rail/'},
    {key:'rail-council',title:'궤도협의회',description:'철도·지하철 공동투쟁 · 확대간부수련회 · 산별전환 등 궤도 공동사업',badge:'궤도 공동사업',href:'https://work.bokdoong.com/work/rail-council/'},
    {key:'sanbyeol',title:'산별전환 업무 현황',description:'철도 · 지하철 · 국토정보공사 등 조직별 교육·간담회·의결 경과와 교육 피드백',badge:'중앙 사무처',href:'https://work.bokdoong.com/work/sanbyeol/'}
  ];
  let state=new Map(),loaded=false;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const card=x=>`<button class="w1b-card" type="button" data-web1-board-href="${esc(x.href)}" data-web1-board-title="${esc(x.title)}"><div class="w1b-card-top"><span class="badge">${esc(x.badge)}</span><span class="w1b-open">내용 보기</span></div><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p></button>`;
  function render(){
    const host=document.querySelector('#pagesView');
    const active=document.querySelector('#web1BoardActive');
    const archived=document.querySelector('#web1BoardArchived');
    const archivedWrap=document.querySelector('#web1BoardArchivedWrap');
    if(!host||!active||!archived||!archivedWrap)return;
    const aa=items.filter(x=>state.get(x.key)!==true),zz=items.filter(x=>state.get(x.key)===true);
    active.innerHTML=aa.length?aa.map(card).join(''):'<div class="empty">진행 중인 Web1 사업 페이지가 없습니다.</div>';
    archived.innerHTML=zz.length?zz.map(card).join(''):'<div class="empty">지나간 업무·사업이 없습니다.</div>';
    archivedWrap.classList.toggle('hidden',!zz.length);
    host.dataset.web1BoardReady='1';
  }
  let detailTrigger=null;
  function repoPath(href){
    const u=new URL(href);
    let p=u.pathname.replace(/^\/work\//,'');
    if(p.endsWith('/'))p+='index.html';
    return p;
  }
  function sourceUrl(href){return RAW+repoPath(href)}
  function sanitizeSource(html,href){
    const base='<base href="'+href.replace(/"/g,'&quot;')+'">';
    let out=/<head[^>]*>/i.test(html)?html.replace(/<head([^>]*)>/i,'<head$1>'+base):base+html;
    out=out.replace(/<script[^>]+src=["']\/work\/app\/web1-(?:admin-auth|page-capabilities)\.js[^"']*["'][^>]*><\/script>/gi,'');
    return out;
  }
  function closeDetail(){
    const modal=document.querySelector('#web1BoardDetailModal');
    const frame=document.querySelector('#web1BoardDetailFrame');
    if(!modal)return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden','true');
    if(frame){frame.removeAttribute('srcdoc');frame.src='about:blank'}
    window.KPTUA11y?.dialog.deactivate(modal,{restoreFocus:true,fallbackFocus:'#pagesView h2'});
    detailTrigger=null;
  }
  async function openDetail(href,title){
    const modal=document.querySelector('#web1BoardDetailModal');
    const frame=document.querySelector('#web1BoardDetailFrame');
    const heading=document.querySelector('#web1BoardDetailTitle');
    if(!modal||!frame)return;
    detailTrigger=document.activeElement;
    if(heading)heading.textContent=title||'게시판';
    frame.title=(title||'게시판')+' 본문';
    frame.removeAttribute('srcdoc');frame.src='about:blank';
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden','false');
    const close=modal.querySelector('[data-close-web1-board]');
    window.KPTUA11y?.dialog.activate(modal,{trigger:detailTrigger,initialFocus:close,onRequestClose:closeDetail});
    close?.focus();
    try{
      const r=await fetch(sourceUrl(href),{cache:'no-store'});
      if(!r.ok)throw new Error('게시판 본문을 불러오지 못했습니다.');
      frame.srcdoc=sanitizeSource(await r.text(),href);
    }catch(e){
      frame.srcdoc='<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans KR",sans-serif;padding:24px;color:#26323d}p{line-height:1.6}</style><p>게시판 본문을 불러오지 못했습니다.</p>';
      console.error('web1 board detail load',e);
    }
  }
  document.addEventListener('click',e=>{
    const card=e.target.closest?.('[data-web1-board-href]');
    if(card){e.preventDefault();openDetail(card.dataset.web1BoardHref,card.dataset.web1BoardTitle);return}
    if(e.target.closest?.('[data-close-web1-board]'))closeDetail();
  });
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('#web1BoardDetailModal')?.classList.contains('hidden'))closeDetail()});
  async function load(){
    if(loaded){render();return}
    loaded=true;
    try{
      const rows=await rt.api('/rest/v1/main_project_archive_state?select=card_key,archived',{auth:false});
      state=new Map((rows||[]).map(x=>[x.card_key,!!x.archived]));
    }catch(e){console.warn('web1 board archive state unavailable',e)}
    render();
  }
  window.KPTUWeb1Board={render:load,openDetail,closeDetail};
  window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='pages')load()});
  load();
})();