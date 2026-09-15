(()=>{
  'use strict';
  if(window.__KPTU_LIBRARY_PUBLIC_TOGGLE__)return;
  window.__KPTU_LIBRARY_PUBLIC_TOGGLE__=true;
  const rt=window.KPTURuntime;if(!rt?.api)return;
  let docs=new Map(),workspaceId='',loading=false;

  async function context(){
    if(!(await rt.session.ensure()))return false;
    const user=await rt.api('/auth/v1/user');
    const ms=await rt.api(`/rest/v1/app_workspace_members?user_id=eq.${user.id}&select=workspace_id&limit=1`);
    workspaceId=ms?.[0]?.workspace_id||'';
    return !!workspaceId;
  }
  async function load(){
    if(loading)return;
    loading=true;
    try{
      if(!workspaceId&&!(await context()))return;
      const rows=await rt.api(`/rest/v1/app_documents?workspace_id=eq.${workspaceId}&select=id,visibility&order=created_at.desc`);
      docs=new Map((rows||[]).map(x=>[x.id,x]));
      decorate();
    }finally{loading=false}
  }
  function libraryVisible(){
    const view=document.querySelector('#libraryView');
    return !!view&&!view.classList.contains('hidden');
  }
  function decorate(){
    document.querySelectorAll('#documentList [data-lu-document]').forEach(card=>{
      const id=card.dataset.luDocument,d=docs.get(id),actions=card.querySelector('.lu-document-actions');
      if(!id||!d||!actions)return;
      let btn=actions.querySelector('[data-library-public-toggle]');
      if(!btn){
        btn=document.createElement('button');btn.type='button';btn.className='mini';btn.dataset.libraryPublicToggle=id;actions.prepend(btn);
      }
      const isPublic=d.visibility==='public';
      btn.textContent=isPublic?'공개 해제':'외부 공개';
      btn.title=isPublic?'비로그인 자료실에서 숨기기':'비로그인 자료실에도 표시하기';
      btn.classList.toggle('active',isPublic);
    });
  }
  async function toggle(id,btn){
    const d=docs.get(id);if(!d)return;
    const makePublic=d.visibility!=='public';
    if(makePublic&&!confirm('이 자료를 로그인하지 않은 사용자도 볼 수 있도록 외부 공개할까요?\n자료명·분류·출처·날짜·설명과 연결된 공개 링크가 노출됩니다.'))return;
    btn.disabled=true;
    try{
      await rt.api(`/rest/v1/app_documents?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{visibility:makePublic?'public':'workspace',updated_at:new Date().toISOString()}});
      d.visibility=makePublic?'public':'workspace';
      decorate();
      window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
    }catch(e){alert(e?.message||String(e))}finally{btn.disabled=false}
  }
  function install(){
    const list=document.querySelector('#documentList');if(!list)return;
    list.addEventListener('click',e=>{const b=e.target.closest?.('[data-library-public-toggle]');if(!b)return;e.preventDefault();e.stopPropagation();toggle(b.dataset.libraryPublicToggle,b)});
    new MutationObserver(()=>{if(libraryVisible())decorate()}).observe(list,{childList:true,subtree:true});
    window.KPTURouter?.on?.('library',()=>load().catch(console.error));
    window.addEventListener('kptu:documents-changed',()=>{if(libraryVisible())setTimeout(()=>load().catch(console.error),60)});
    if(window.KPTURouter?.current==='library'||libraryVisible())setTimeout(()=>load().catch(console.error),0);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
