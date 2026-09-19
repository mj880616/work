(()=>{
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function render(task,{scope,context='',origin='',canDelete=false}){
    const id=esc(task.id),title=esc(task.title||'제목 없음'),done=task.status==='done';
    const note=String(task.note||'').trim();
    const menuId=`${scope}-menu-${id}`;
    return `<article class="tl-task-row${done?' done':''}" data-${scope}-task-row="${id}">
      <label class="tl-task-check-wrap"><input type="checkbox" data-${scope}-toggle="${id}" ${done?'checked':''} aria-label="${title} ${done?'미완료로 변경':'완료'}"></label>
      <button class="tl-task-main" type="button" data-${scope}-open="${id}" aria-label="${title} 상세 및 수정">
        <span class="tl-task-title">${title}</span>
        <span class="tl-task-sub">${context?`<span class="tl-task-context">${esc(context)}</span>`:''}<span class="tl-task-due">${esc(task.dueLabel||'기한 미정')}</span>${origin?`<span class="tl-origin">${esc(origin)}</span>`:''}${task.description?`<span class="tl-task-description">${esc(task.description)}</span>`:''}</span>
        ${note?`<span class="tl-task-note"><span class="tl-note-prefix">메모</span>${esc(note)}</span>`:''}
      </button>
      <div class="tl-task-menu">
        <button class="tl-menu-trigger" type="button" data-${scope}-menu="${id}" aria-label="${title} 메뉴" aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId}">⋮</button>
        <div class="tl-menu-items" id="${menuId}" data-${scope}-menu-items role="menu" hidden>
          <button type="button" role="menuitem" data-${scope}-menu-edit="${id}">수정</button>
          <button type="button" role="menuitem" data-${scope}-menu-note="${id}">메모 ${note?'수정':'추가'}</button>
          ${canDelete?`<button type="button" role="menuitem" data-${scope}-delete="${id}" aria-label="${title} 삭제">삭제</button>`:''}
        </div>
      </div>
    </article>`;
  }
  window.KPTUTaskRowView={render};
})();
