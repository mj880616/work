(()=>{
  'use strict';
  const PF_RT=window.KPTURuntime;
  if(!PF_RT)throw new Error('KPTURuntime is required by project-files');

  let pfProjectId=null,pfRows=[];

  const pfApi=(path,opts={})=>PF_RT.api(path,opts);
  const pfEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pfSize=n=>{n=Number(n)||0;if(n<1024)return n+'B';if(n<1048576)return(n/1024).toFixed(1)+'KB';return(n/1048576).toFixed(1)+'MB'};

  function pfEnsureUi(){
    const modal=document.querySelector('#projectModal .project-modal, #projectModal .modal-card');
    if(!modal||document.querySelector('#projectFilesSection'))return;
    const sec=document.createElement('section');
    sec.id='projectFilesSection';
    sec.className='project-files-section';
    sec.innerHTML='<div class="project-files-head"><div><h3>관련 파일</h3><p>파일은 Google Drive에 저장되고 자료실에도 자동 등록됩니다.</p></div><label class="project-file-upload"><input id="projectFileInput" type="file" hidden><span>+ 파일 업로드</span></label></div><div id="projectFileStatus" class="status"></div><div id="projectFileList" class="stack-list"><div class="empty compact">불러오는 중…</div></div>';
    const grid=modal.querySelector('.project-detail-grid');
    const comments=modal.querySelector('#projectComments')?.closest('section');
    if(grid)grid.insertAdjacentElement('afterend',sec);
    else if(comments)comments.insertAdjacentElement('beforebegin',sec);
    else modal.append(sec);
    sec.querySelector('#projectFileInput')?.addEventListener('change',pfUpload);
    sec.querySelector('#projectFileList')?.addEventListener('click',pfHandleAction);

    if(!document.querySelector('#projectFilesStyle')){
      const style=document.createElement('style');style.id='projectFilesStyle';
      style.textContent='.project-files-section{margin-top:18px;padding-top:18px;border-top:1px solid #e7ebef}.project-files-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.project-files-head h3{margin:0 0 3px}.project-files-head p{margin:0;color:#7b8792;font-size:12px}.project-file-upload span{display:inline-block;padding:9px 12px;border:1px solid #cfd7df;border-radius:10px;font-weight:750;cursor:pointer;background:#fff}.project-file-row{display:flex;justify-content:space-between;gap:12px;align-items:center}.project-file-row>div{min-width:0}.project-file-row b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.project-file-row small{color:#7a8590}.project-file-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;flex-shrink:0}.project-file-actions .danger{color:#a33b45;border-color:#ead2d5;background:#fff}@media(max-width:700px){.project-files-head{align-items:flex-start}.project-file-row{display:block}.project-file-actions{justify-content:flex-start;margin-top:9px}.project-file-actions .mini{padding:6px 8px;font-size:11px}}';
      document.head.appendChild(style);
    }
  }

  async function pfList(){
    if(!pfProjectId)return;
    pfEnsureUi();
    const box=document.querySelector('#projectFileList');
    if(!box)return;
    box.innerHTML='<div class="empty compact">불러오는 중…</div>';
    try{
      pfRows=await pfApi('/rest/v1/app_documents?project_id=eq.'+encodeURIComponent(pfProjectId)+'&file_id=not.is.null&select=id,title,file_name,mime_type,file_size,category,source,document_date,tags,description,drive_url,file_id,project_id,created_at&order=created_at.desc');
      box.innerHTML=pfRows.length?pfRows.map(d=>`<div class="list-item project-file-row"><div><b>${pfEsc(d.file_name||d.title)}</b><small>${pfEsc(d.category||'기타')} · ${new Date(d.created_at).toLocaleDateString('ko-KR')}${d.file_size?' · '+pfSize(d.file_size):''}</small></div><div class="project-file-actions"><button class="mini" type="button" data-pf-open="${d.id}">열기</button><button class="mini" type="button" data-pf-download="${d.id}">다운로드</button><button class="mini" type="button" data-pf-edit="${d.id}">정보 수정</button><button class="mini danger" type="button" data-pf-delete="${d.id}">삭제</button></div></div>`).join(''):'<div class="empty compact">등록된 파일이 없습니다.</div>';
    }catch(e){box.innerHTML='<div class="empty compact">'+pfEsc(e.message)+'</div>'}
  }

  async function pfUpload(e){
    const input=e.target,file=input.files?.[0],st=document.querySelector('#projectFileStatus');
    if(!file||!pfProjectId)return;
    if(st){st.textContent='파일 업로드 중…';st.className='status'}
    input.disabled=true;
    try{
      const fd=new FormData();fd.append('file',file);fd.append('project_id',pfProjectId);
      const d=await pfApi('/functions/v1/library-files',{method:'POST',body:fd});
      if(d?.error)throw new Error(d.error);
      if(st){st.textContent='업로드 완료 · 자료실에도 등록되었습니다.';st.className='status ok'}
      input.value='';
      await pfList();
      window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:pfProjectId}}));
      setTimeout(()=>{if(st?.textContent?.startsWith('업로드 완료'))st.textContent=''},1800);
    }catch(err){if(st){st.textContent=err.message||String(err);st.className='status error'}}
    finally{input.disabled=false}
  }

  async function pfDownload(id){
    try{
      const d=await pfApi('/functions/v1/workspace-drive?action=download-token',{method:'POST',body:{document_id:id}});
      if(!d?.url)throw new Error('다운로드 주소를 받지 못했습니다.');
      location.href=d.url;
    }catch(e){const st=document.querySelector('#projectFileStatus');if(st){st.textContent=e.message;st.className='status error'}}
  }

  async function pfOpen(id){
    const d=pfRows.find(x=>x.id===id);
    if(d?.drive_url){window.open(d.drive_url,'_blank','noopener');return}
    await pfDownload(id);
  }

  async function pfDelete(id){
    const d=pfRows.find(x=>x.id===id);if(!d)return;
    if(!confirm(`“${d.file_name||d.title}” 파일을 삭제할까요?\nGoogle Drive 원본과 자료실 기록이 함께 삭제됩니다.`))return;
    const st=document.querySelector('#projectFileStatus');
    try{
      if(st){st.textContent='삭제 중…';st.className='status'}
      await pfApi('/functions/v1/document-actions',{method:'POST',body:{action:'delete',document_id:id}});
      if(st){st.textContent='삭제했습니다.';st.className='status ok'}
      await pfList();
      window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:pfProjectId}}));
    }catch(e){if(st){st.textContent=e.message||String(e);st.className='status error'}}
  }

  async function pfHandleAction(e){
    const open=e.target.closest('[data-pf-open]');if(open){await pfOpen(open.dataset.pfOpen);return}
    const dl=e.target.closest('[data-pf-download]');if(dl){await pfDownload(dl.dataset.pfDownload);return}
    const edit=e.target.closest('[data-pf-edit]');if(edit){window.dispatchEvent(new CustomEvent('kptu:edit-document',{detail:{id:edit.dataset.pfEdit}}));return}
    const del=e.target.closest('[data-pf-delete]');if(del)await pfDelete(del.dataset.pfDelete);
  }

  function pfOpenProject(id){pfProjectId=id;setTimeout(()=>{pfEnsureUi();pfList()},120)}

  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-project]');if(b?.dataset.project)pfOpenProject(b.dataset.project)},true);
  const pm=document.querySelector('#projectModal');
  if(pm)new MutationObserver(()=>{if(!pm.classList.contains('hidden')&&pfProjectId){pfEnsureUi();pfList()}}).observe(pm,{attributes:true,attributeFilter:['class']});
  window.addEventListener('kptu:documents-changed',e=>{if(pfProjectId&&(!e.detail?.project_id||e.detail.project_id===pfProjectId))pfList()});
  window.addEventListener('kptu:session-changed',()=>{if(pfProjectId)setTimeout(pfList,80)});
  pfEnsureUi();
})();
