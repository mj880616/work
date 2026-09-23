(()=>{
  'use strict';
  if(window.KPTUWeb1Board)return;
  const rt=window.KPTURuntime;
  const RAW='https://raw.githubusercontent.com/mj880616/work/main/';
  const WORK_ORIGIN='https://work.bokdoong.com';
  const items=[
    {key:'2in1',title:'위험업무 2인1조 법제화',description:'법안 보완 · 노동부 대응 · 국회토론회 · 국정감사 · 궤도 공동투쟁',badge:'진행 중',href:WORK_ORIGIN+'/work/2in1/',source:'2in1/index.html'},
    {key:'workforce',title:'공공기관 인력확충',description:'증원 연계 2% 인력감축 방침 철회와 안전·공공서비스 인력 확충 대응',badge:'당면 대응',href:WORK_ORIGIN+'/work/workforce/',source:'workforce/index.html'},
    {key:'private-rail',title:'민자철도 사업 현황',description:'공영화 · 운영기준 · 사업장별 임단투 · 민간철도·지하철 부실운영 방지법 진행 현황',badge:'현장 공유',href:WORK_ORIGIN+'/work/private-rail/',source:'private-rail/index.html'},
    {key:'rail-council',title:'궤도협의회',description:'철도·지하철 공동투쟁 · 확대간부수련회 · 산별전환 등 궤도 공동사업',badge:'궤도 공동사업',href:WORK_ORIGIN+'/work/rail-council/',source:'rail-council/index.html'},
    {key:'sanbyeol',title:'산별전환 업무 현황',description:'철도 · 지하철 · 국토정보공사 등 조직별 교육·간담회·의결 경과와 교육 피드백',badge:'중앙 사무처',href:WORK_ORIGIN+'/work/sanbyeol/',source:'sanbyeol/index.html'}
  ];
  let state=new Map(),loaded=false,detailTrigger=null,detailEpoch=0;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const card=x=>`<button class="w1b-card" type="button" data-web1-board-href="${esc(x.href)}" data-web1-board-source="${esc(x.source)}" data-web1-board-title="${esc(x.title)}"><div class="w1b-card-top"><span class="badge">${esc(x.badge)}</span><span class="w1b-open">내용 보기</span></div><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p></button>`;
  const rawUrl=path=>RAW+path.split('/').map(encodeURIComponent).join('/')+'?_='+Date.now();
  const loadingDoc=()=>`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans KR",sans-serif;color:#66727f;padding:28px;margin:0}p{margin:0}</style><body><p>본문을 불러오는 중입니다…</p></body></html>`;
  const errorDoc=canonical=>`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans KR",sans-serif;color:#1f2933;padding:28px;margin:0}p{color:#66727f;line-height:1.6}a{display:inline-block;margin-top:12px;color:#355f86;font-weight:700}</style><body><h2>본문을 불러오지 못했습니다.</h2><p>원본 파일을 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도하거나 Web1 원문을 열어 확인해 주세요.</p><a href="${esc(canonical)}" target="_blank" rel="noopener">Web1에서 열기</a></body></html>`;
  function injectReaderBridge(html,canonical){
    const base=`<base href="${esc(canonical)}">`;
    const bridge=`<script>(function(){document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;try{var u=new URL(a.getAttribute('href'),document.baseURI);if(u.hostname==='work.bokdoong.com'&&u.pathname.indexOf('/work/')===0){e.preventDefault();parent.postMessage({type:'kptu:web1-board:navigate',href:u.href},'*')}}catch(_){}})})();<\/script>`;
    const injected=base+bridge;
    if(/<head(?:\s[^>]*)?>/i.test(html))return html.replace(/<head(?:\s[^>]*)?>/i,m=>m+injected);
    return '<head>'+injected+'</head>'+html
  }
  function repoPathFromCanonical(href){
    try{
      const u=new URL(href);
      if(u.origin!==WORK_ORIGIN||!u.pathname.startsWith('/work/'))return null;
      let path=decodeURIComponent(u.pathname.slice('/work/'.length));
      if(!path)return null;
      if(path.endsWith('/'))path+='index.html';
      else if(!/\.[^/]+$/.test(path))path+='/index.html';
      return path
    }catch{return null}
  }
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
    host.dataset.web1BoardReady='1'
  }
  function closeDetail(){
    detailEpoch+=1;
    const modal=document.querySelector('#web1BoardDetailModal');
    const frame=document.querySelector('#web1BoardDetailFrame');
    if(!modal)return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden','true');
    if(frame){frame.removeAttribute('srcdoc');frame.src='about:blank';delete frame.dataset.web1BoardCanonical;delete frame.dataset.web1BoardSource}
    window.KPTUA11y?.dialog.deactivate(modal,{restoreFocus:true,fallbackFocus:'#pagesView h2'});
    detailTrigger=null
  }
  async function loadIntoFrame(sourcePath,canonicalHref,token){
    const frame=document.querySelector('#web1BoardDetailFrame');
    if(!frame||token!==detailEpoch)return;
    frame.src='about:blank';
    frame.srcdoc=loadingDoc();
    frame.dataset.web1BoardCanonical=canonicalHref;
    frame.dataset.web1BoardSource=sourcePath;
    try{
      const response=await fetch(rawUrl(sourcePath),{cache:'no-store',credentials:'omit',mode:'cors'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const html=await response.text();
      if(token!==detailEpoch)return;
      frame.srcdoc=injectReaderBridge(html,canonicalHref)
    }catch(error){
      console.error('Web1 board source load failed',sourcePath,error);
      if(token!==detailEpoch)return;
      frame.srcdoc=errorDoc(canonicalHref)
    }
  }
  function openDetail(sourcePath,title,canonicalHref=''){
    const modal=document.querySelector('#web1BoardDetailModal');
    const frame=document.querySelector('#web1BoardDetailFrame');
    const heading=document.querySelector('#web1BoardDetailTitle');
    if(!modal||!frame||!sourcePath)return;
    const token=++detailEpoch;
    detailTrigger=document.activeElement;
    if(heading)heading.textContent=title||'게시판';
    frame.title=(title||'게시판')+' 본문';
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden','false');
    const close=modal.querySelector('[data-close-web1-board]');
    window.KPTUA11y?.dialog.activate(modal,{trigger:detailTrigger,initialFocus:close,onRequestClose:closeDetail});
    close?.focus();
    loadIntoFrame(sourcePath,canonicalHref||WORK_ORIGIN+'/work/',token)
  }
  document.addEventListener('click',e=>{
    const card=e.target.closest?.('[data-web1-board-href]');
    if(card){e.preventDefault();openDetail(card.dataset.web1BoardSource,card.dataset.web1BoardTitle,card.dataset.web1BoardHref);return}
    if(e.target.closest?.('[data-close-web1-board]'))closeDetail()
  });
  window.addEventListener('message',e=>{
    const frame=document.querySelector('#web1BoardDetailFrame');
    if(!frame||e.source!==frame.contentWindow||e.data?.type!=='kptu:web1-board:navigate')return;
    const path=repoPathFromCanonical(e.data.href);
    if(!path)return;
    const token=++detailEpoch;
    loadIntoFrame(path,e.data.href,token)
  });
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('#web1BoardDetailModal')?.classList.contains('hidden'))closeDetail()});
  async function load(){
    if(loaded){render();return}
    loaded=true;
    try{
      const rows=await rt.api('/rest/v1/main_project_archive_state?select=card_key,archived',{auth:false});
      state=new Map((rows||[]).map(x=>[x.card_key,!!x.archived]))
    }catch(e){console.warn('web1 board archive state unavailable',e)}
    render()
  }
  window.KPTUWeb1Board={render:load,openDetail,closeDetail};
  window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='pages')load()});
  load()
})();