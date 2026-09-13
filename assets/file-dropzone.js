(()=>{
  const enhance=input=>{
    if(input.dataset.dropReady)return;
    input.dataset.dropReady='1';
    const zone=document.createElement('div');
    zone.className='file-dropzone';
    zone.innerHTML='<strong>파일을 여기로 끌어다 놓으세요</strong><span>또는 클릭해서 파일 선택</span><small></small>';
    input.parentNode.insertBefore(zone,input);
    input.style.display='none';
    zone.addEventListener('click',()=>input.click());
    zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragover')});
    zone.addEventListener('dragleave',()=>zone.classList.remove('dragover'));
    zone.addEventListener('drop',e=>{
      e.preventDefault();
      zone.classList.remove('dragover');
      if(!e.dataTransfer.files.length)return;
      input.files=e.dataTransfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    input.addEventListener('change',()=>{zone.querySelector('small').textContent=input.files?.length?Array.from(input.files).map(f=>f.name).join(', '):''});
  };
  const boot=()=>{
    document.querySelectorAll('input[type="file"]').forEach(enhance);
    const style=document.createElement('style');
    style.textContent='.file-dropzone{min-height:96px;border:2px dashed #c8d3dd;border-radius:12px;background:#f8fafc;padding:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;cursor:pointer;color:#5f6d7b}.file-dropzone:hover,.file-dropzone.dragover{border-color:#245786;background:#edf4f9}.file-dropzone strong{color:#31465a;font-size:13px}.file-dropzone span,.file-dropzone small{font-size:11px}.file-dropzone small{color:#245786;font-weight:700;word-break:break-all}';
    document.head.appendChild(style);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
