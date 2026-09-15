(()=>{
  if(window.__KPTU_PAGE_MANAGEMENT__)return;
  window.__KPTU_PAGE_MANAGEMENT__=true;
  const rt=window.KPTURuntime;
  const pending=new Set();
  let deleteMode=false,saving=false;

  function syncCards(){
    document.querySelectorAll('#pageList .page-card').forEach(card=>{
      const id=card.dataset.pageCardId||card.dataset.inlinePage||card.querySelector('[data-edit-page]')?.dataset.editPage||'';
      card.classList.toggle('page-delete-pending',!!id&&pending.has(id));
    });
    updateControls();
  }

  function updateControls(){
    const view=document.querySelector('#pagesView'),mode=document.querySelector('#pageDeleteModeBtn'),save=document.querySelector('#pageDeleteSaveBtn'),status=document.querySelector('#pageManagementStatus');
    view?.classList.toggle('page-delete-mode',deleteMode);
    if(mode){mode.classList.toggle('active',deleteMode);mode.textContent=deleteMode?'삭제 취소':'페이지 삭제'}
    if(save){save.classList.toggle('hidden',!deleteMode);save.disabled=saving||pending.size===0;save.textContent=saving?'삭제 중…':pending.size?`저장 (${pending.size})`:'저장'}
    if(status&&!saving){status.classList.remove('error');status.textContent=deleteMode?(pending.size?`${pending.size}개 페이지가 삭제 예정입니다.`:'삭제할 페이지를 선택하세요.'):''}
  }

  function toggleMode(){if(saving)return;deleteMode=!deleteMode;if(!deleteMode)pending.clear();syncCards()}
  function toggleCard(card){if(!deleteMode||saving||!card)return;const id=card.dataset.pageCardId||card.dataset.inlinePage||card.querySelector('[data-edit-page]')?.dataset.editPage||'';if(!id)return;if(pending.has(id))pending.delete(id);else pending.add(id);syncCards()}

  async function saveDeletion(){
    if(saving||!pending.size)return;
    const ids=[...pending];
    if(!window.confirm(`선택한 페이지 ${ids.length}개를 정말 삭제하시겠습니까?\n삭제한 페이지는 복구할 수 없습니다.`))return;
    const status=document.querySelector('#pageManagementStatus');saving=true;updateControls();
    try{
      const deleted=await rt.api('/rest/v1/rpc/app_delete_pages',{method:'POST',body:{p_page_ids:ids}});
      if(Number(deleted)!==ids.length)throw new Error('선택한 페이지가 모두 삭제되지 않았습니다.');
      pending.clear();deleteMode=false;saving=false;
      await window.KPTUPageList?.refresh?.();
      if(status){status.classList.remove('error');status.textContent=`${ids.length}개 페이지를 삭제했습니다.`}
      updateControls();
      window.dispatchEvent(new CustomEvent('kptu:pages-changed',{detail:{deleted:ids}}));
    }catch(err){saving=false;if(status){status.classList.add('error');status.textContent=err?.message||'페이지 삭제에 실패했습니다.'}updateControls()}
  }

  function installActions(){
    const view=document.querySelector('#pagesView'),head=view?.querySelector('.section-head'),newBtn=document.querySelector('#newPageBtn');
    if(!view||!head||!newBtn)return false;
    if(!document.querySelector('#pageManagementActions')){
      const actions=document.createElement('div');actions.id='pageManagementActions';actions.className='page-management-actions';actions.innerHTML='<button id="pageDeleteModeBtn" class="secondary" type="button">페이지 삭제</button><button id="pageDeleteSaveBtn" class="primary hidden" type="button" disabled>저장</button><span id="pageManagementStatus" class="page-management-status" aria-live="polite"></span>';newBtn.before(actions);actions.appendChild(newBtn);
      document.querySelector('#pageDeleteModeBtn').onclick=toggleMode;document.querySelector('#pageDeleteSaveBtn').onclick=saveDeletion;
    }
    const list=document.querySelector('#pageList');
    if(list&&!list.dataset.pageDeleteBound){list.dataset.pageDeleteBound='1';list.addEventListener('click',e=>{if(!deleteMode)return;const card=e.target.closest?.('.page-card');if(!card)return;e.preventDefault();e.stopPropagation();toggleCard(card)})}
    window.addEventListener('kptu:pages-rendered',syncCards);
    syncCards();return true;
  }

  window.__KPTU_PAGE_MANAGEMENT_READY__=Promise.resolve(installActions());
})();
