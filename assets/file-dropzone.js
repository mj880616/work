(()=>{
  'use strict';

  function installStyle(){
    if(document.getElementById('kptu-file-dropzone-style'))return;
    const style=document.createElement('style');
    style.id='kptu-file-dropzone-style';
    style.textContent='.file-dropzone{width:100%;min-height:96px;border:2px dashed #c8d3dd;border-radius:12px;background:#f8fafc;padding:18px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;cursor:pointer;color:#5f6d7b;outline:none;transition:border-color .15s ease,background .15s ease,box-shadow .15s ease}.file-dropzone:hover,.file-dropzone:focus-visible,.file-dropzone.dragover{border-color:#245786;background:#edf4f9;box-shadow:0 0 0 3px rgba(36,87,134,.08)}.file-dropzone.disabled{opacity:.55;cursor:default;box-shadow:none}.file-dropzone .drop-icon{font-size:22px;line-height:1;color:#245786;margin-bottom:2px}.file-dropzone strong{color:#31465a;font-size:13px}.file-dropzone span,.file-dropzone small{font-size:11px}.file-dropzone small{margin-top:4px;color:#245786;font-weight:700;word-break:break-all}.file-dropzone .drop-error{color:#9a3d45}.file-drop-input{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;opacity:0!important;pointer-events:none!important}@media(max-width:720px){.file-dropzone{min-height:86px;padding:14px 12px}.file-dropzone .drop-icon{font-size:20px}}';
    document.head.appendChild(style);
  }

  function sync(input,zone){
    const fileText=zone.querySelector('[data-drop-file]');
    const error=zone.querySelector('[data-drop-error]');
    const files=Array.from(input.files||[]);
    if(error)error.textContent='';
    if(fileText)fileText.textContent=files.length===0?'':files.length===1?files[0].name:`${files[0].name} 외 ${files.length-1}개`;
    zone.classList.toggle('disabled',!!input.disabled);
  }

  function putFiles(input,files,zone){
    const list=Array.from(files||[]);
    if(!list.length)return;
    try{
      if(input.multiple){input.files=files}else{const dt=new DataTransfer();dt.items.add(list[0]);input.files=dt.files}
      input.dispatchEvent(new Event('change',{bubbles:true}));
      sync(input,zone);
    }catch(e){
      const error=zone.querySelector('[data-drop-error]');
      if(error)error.textContent='드롭 업로드를 사용할 수 없습니다. 클릭해서 파일을 선택해주세요.';
    }
  }

  function enhance(input){
    if(!input||input.dataset.dropReady==='1')return;
    input.dataset.dropReady='1';
    installStyle();
    const zone=document.createElement('div');
    zone.className='file-dropzone';zone.tabIndex=0;zone.setAttribute('role','button');zone.setAttribute('aria-label','파일 선택 또는 끌어놓기');
    zone.innerHTML='<div class="drop-icon">⇧</div><strong>파일을 여기로 끌어다 놓으세요</strong><span>또는 클릭해서 파일 선택</span><small data-drop-file></small><small class="drop-error" data-drop-error></small>';
    input.classList.add('file-drop-input');input.insertAdjacentElement('beforebegin',zone);
    const open=e=>{if(input.disabled)return;e.preventDefault();e.stopPropagation();input.click()};
    zone.addEventListener('click',open);zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')open(e)});
    zone.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();if(!input.disabled)zone.classList.add('dragover')});
    zone.addEventListener('dragenter',e=>{e.preventDefault();e.stopPropagation();if(!input.disabled)zone.classList.add('dragover')});
    zone.addEventListener('dragleave',e=>{e.preventDefault();e.stopPropagation();zone.classList.remove('dragover')});
    zone.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();zone.classList.remove('dragover');if(!input.disabled)putFiles(input,e.dataTransfer?.files,zone)});
    input.addEventListener('change',()=>sync(input,zone));new MutationObserver(()=>setTimeout(()=>sync(input,zone),0)).observe(input,{attributes:true,attributeFilter:['disabled']});sync(input,zone);
  }

  function enhanceAll(root=document){root.querySelectorAll?.('input[type="file"]').forEach(enhance)}

  function tuneJointStruggleBoard(){
    if(!location.pathname.includes('/workforce/joint-struggle-0921'))return;
    try{
      if(typeof groups!=='undefined'){
        const idx=groups.findIndex(([id])=>id==='gas_safety');
        if(idx>=0)groups.splice(idx,1);
      }
    }catch(e){}
    document.querySelectorAll('.org-row[data-org="gas_safety"]').forEach(el=>el.remove());
    if(typeof update==='function')update();
    const heading=document.querySelector('main .section h2');if(heading&&heading.textContent.trim()==='확정·완료사항')heading.textContent='사전 준비';
    const style=document.createElement('style');style.textContent='.task-row>.small-btn.save:disabled{display:none!important}.task-row:has(>.small-btn.save:disabled){grid-template-columns:28px minmax(0,1fr) 54px 54px!important}@media(max-width:620px){.task-row:has(>.small-btn.save:disabled){grid-template-columns:25px minmax(0,1fr) 50px 50px!important}.task-row:has(>.small-btn.save:disabled) .danger{grid-column:auto!important;justify-self:stretch!important;width:auto!important;margin-top:0!important}}';document.head.appendChild(style);
  }

  function boot(){enhanceAll();tuneJointStruggleBoard();new MutationObserver(records=>{records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType!==1)return;if(node.matches?.('input[type="file"]'))enhance(node);enhanceAll(node)}))}).observe(document.documentElement,{childList:true,subtree:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();