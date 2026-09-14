(()=>{
  if(window.__KPTU_PAGE_MANAGEMENT__)return;
  window.__KPTU_PAGE_MANAGEMENT__=true;

  const pending=new Set();
  let deleteMode=false;
  let saving=false;
  let observer=null;

  function installStyle(){
    if(document.querySelector('#pageManagementStyle'))return;
    const style=document.createElement('style');
    style.id='pageManagementStyle';
    style.textContent=`
      #pagesView .page-management-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      #pagesView .page-management-status{font-size:11px;color:#7a8792;min-height:16px;align-self:center}
      #pagesView .page-management-status.error{color:#a33b45}
      #pageList .page-card{position:relative}
      #pageList .card-actions .mini{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:6px 10px;line-height:1;text-decoration:none!important;white-space:nowrap;border-radius:9px;box-sizing:border-box}
      #pageList .page-delete-mark{display:none;position:absolute;top:10px;right:10px;width:30px;height:30px;border:1px solid #d7dee4;border-radius:50%;background:#fff;color:#78838e;font-size:20px;line-height:1;place-items:center;padding:0;z-index:2}
      #pagesView.page-delete-mode #pageList .page-card{padding-right:54px}
      #pagesView.page-delete-mode #pageList .page-delete-mark{display:grid}
      #pagesView.page-delete-mode #pageList .card-actions{opacity:.32;pointer-events:none}
      #pageList .page-card.page-delete-pending{border-color:#c65a64;box-shadow:0 0 0 2px rgba(163,59,69,.10);background:#fff8f8}
      #pageList .page-card.page-delete-pending .page-delete-mark{background:#a33b45;border-color:#a33b45;color:#fff}
      #pageDeleteModeBtn.active{border-color:#b94d57;color:#9c303a;background:#fff6f6}
      #pageDeleteSaveBtn:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:760px){
        #pagesView .section-head{align-items:flex-start}
        #pagesView .page-management-actions{justify-content:flex-end}
        #pagesView .page-management-status{width:100%;text-align:right}
        #pageList .card-actions{gap:6px;flex-wrap:wrap;justify-content:flex-end}
        #pageList .card-actions .mini{min-height:31px;padding:6px 9px}
      }
    `;
    document.head.appendChild(style);
  }

  function getCardId(card){
    return card?.querySelector('[data-edit-page]')?.dataset.editPage||card?.dataset.pageCardId||'';
  }

  function updateControls(){
    const view=document.querySelector('#pagesView');
    const mode=document.querySelector('#pageDeleteModeBtn');
    const save=document.querySelector('#pageDeleteSaveBtn');
    const status=document.querySelector('#pageManagementStatus');
    view?.classList.toggle('page-delete-mode',deleteMode);
    if(mode){
      mode.classList.toggle('active',deleteMode);
      mode.textContent=deleteMode?'삭제 취소':'페이지 삭제';
    }
    if(save){
      save.classList.toggle('hidden',!deleteMode);
      save.disabled=saving||pending.size===0;
      save.textContent=saving?'삭제 중…':pending.size?`저장 (${pending.size})`:'저장';
    }
    if(status&&!saving){
      status.classList.remove('error');
      status.textContent=deleteMode?(pending.size?`${pending.size}개 페이지가 삭제 예정입니다.`:'삭제할 페이지의 ×를 선택하세요.') : '';
    }
  }

  function decorateCards(){
    document.querySelectorAll('#pageList .page-card').forEach(card=>{
      const id=getCardId(card);
      if(!id)return;
      card.dataset.pageCardId=id;
      let mark=card.querySelector('.page-delete-mark');
      if(!mark){
        mark=document.createElement('button');
        mark.type='button';
        mark.className='page-delete-mark';
        mark.dataset.pageDeleteId=id;
        mark.setAttribute('aria-label','삭제할 페이지 선택');
        mark.textContent='×';
        card.appendChild(mark);
      }else mark.dataset.pageDeleteId=id;
      card.classList.toggle('page-delete-pending',pending.has(id));
      mark.setAttribute('aria-pressed',pending.has(id)?'true':'false');
    });
    updateControls();
  }

  function clearSelection(){
    pending.clear();
    document.querySelectorAll('#pageList .page-delete-pending').forEach(card=>card.classList.remove('page-delete-pending'));
    updateControls();
  }

  function toggleMode(){
    if(saving)return;
    deleteMode=!deleteMode;
    if(!deleteMode)clearSelection();
    decorateCards();
  }

  function togglePending(id){
    if(!deleteMode||saving||!id)return;
    if(pending.has(id))pending.delete(id);else pending.add(id);
    decorateCards();
  }

  async function saveDeletion(){
    if(saving||pending.size===0)return;
    const ids=[...pending];
    const ok=window.confirm(`선택한 페이지 ${ids.length}개를 정말 삭제하시겠습니까?\n삭제한 페이지는 복구할 수 없습니다.`);
    if(!ok)return;
    const rt=window.KPTURuntime;
    if(!rt)return;
    saving=true;
    updateControls();
    const status=document.querySelector('#pageManagementStatus');
    try{
      const deleted=await rt.api('/rest/v1/rpc/app_delete_pages',{method:'POST',body:{p_page_ids:ids}});
      if(Number(deleted)!==ids.length)throw new Error('선택한 페이지가 모두 삭제되지 않았습니다.');
      ids.forEach(id=>document.querySelector(`#pageList .page-card[data-page-card-id="${CSS.escape(id)}"]`)?.remove());
      if(status){status.classList.remove('error');status.textContent=`${ids.length}개 페이지를 삭제했습니다.`}
      pending.clear();
      deleteMode=false;
      updateControls();
      setTimeout(()=>location.reload(),180);
    }catch(err){
      saving=false;
      if(status){status.classList.add('error');status.textContent=err?.message||'페이지 삭제에 실패했습니다.'}
      updateControls();
    }
  }

  async function install(){
    const rt=window.KPTURuntime;
    const view=document.querySelector('#pagesView');
    const head=view?.querySelector('.section-head');
    const newBtn=document.querySelector('#newPageBtn');
    const list=document.querySelector('#pageList');
    if(!view||!head||!newBtn||!list||!rt)return;
    installStyle();

    let authenticated=false;
    try{authenticated=await rt.session.ensure()}catch{}
    if(!authenticated){decorateCards();return}

    if(!document.querySelector('#pageManagementActions')){
      const actions=document.createElement('div');
      actions.id='pageManagementActions';
      actions.className='page-management-actions';
      actions.innerHTML='<button id="pageDeleteModeBtn" class="secondary" type="button">페이지 삭제</button><button id="pageDeleteSaveBtn" class="primary hidden" type="button" disabled>저장</button><span id="pageManagementStatus" class="page-management-status" aria-live="polite"></span>';
      newBtn.before(actions);
      actions.appendChild(newBtn);
      document.querySelector('#pageDeleteModeBtn')?.addEventListener('click',toggleMode);
      document.querySelector('#pageDeleteSaveBtn')?.addEventListener('click',saveDeletion);
    }

    list.addEventListener('click',e=>{
      const mark=e.target.closest?.('[data-page-delete-id]');
      if(!mark)return;
      e.preventDefault();e.stopPropagation();
      togglePending(mark.dataset.pageDeleteId);
    });
    observer=new MutationObserver(()=>decorateCards());
    observer.observe(list,{childList:true,subtree:true});
    window.KPTURouter?.on?.('pages',()=>setTimeout(decorateCards,0));
    document.querySelector('#pageSearch')?.addEventListener('input',()=>setTimeout(decorateCards,0));
    document.querySelector('#pageFilter')?.addEventListener('change',()=>setTimeout(decorateCards,0));
    decorateCards();
  }

  const boot=()=>install().catch(console.error);
  if(window.KPTURuntime){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
  }else{
    window.addEventListener('kptu:app-ui-ready',boot,{once:true});
  }
})();
