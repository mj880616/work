// UPDATE-운영자전용기록업데이트소식 PR3·FEEDBACK-의견보내기 PR5: 작은 입력 창 한 곳(머리 제목·닫기 ×, 몸통은 부르는 쪽이 채움, 상태 한 줄, [취소]·[확인]).
// 모양은 기존 작은 창(.modal + .modal-card.small-card, hwp-convert.js와 같은 틀)이고, 폰 뒤로가기는 data-kptu-history-all(mobile-modal-history.js)이 닫는다.
// 키보드: 공용 KPTUA11y.dialog(초점 가두기·Esc 닫기). 저장은 onSubmit이 서버로 하고, 실패하면 문구를 돌려받아 상태 줄에 쓴다(창은 열린 채).
const esc=text=>String(text??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const open=new Map();

/**
 * @param {{id:string,title:string,okLabel?:string,fill:(body:HTMLElement)=>(string|null|void),onSubmit:()=>Promise<string|true>,foot?:string,className?:string,trigger?:Element}} options
 * fill은 몸통을 채우고 처음 초점 줄 선택자를 돌려줄 수 있다. onSubmit은 성공이면 true, 아니면 상태 줄에 쓸 한 줄.
 */
export function openFormModal({id,title,okLabel='확인',fill,onSubmit,foot='',className='',trigger=document.activeElement}){
  closeFormModal(id,{restoreFocus:false});
  document.body.insertAdjacentHTML('beforeend',`<div id="${esc(id)}" data-kptu-history-all="1" class="modal hidden sfm ${esc(className)}" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="${esc(id)}Title"><div class="modal-card small-card sfm-card">
<div class="modal-head"><h2 id="${esc(id)}Title">${esc(title)}</h2><button type="button" class="icon-btn" data-sfm-close aria-label="닫기">×</button></div>
<div class="sfm-body" data-sfm-body></div>
${foot?`<p class="sfm-note">${esc(foot)}</p>`:''}<p class="sfm-status" data-sfm-status role="status" aria-live="polite"></p>
<div class="sfm-foot"><button type="button" class="secondary" data-sfm-cancel>취소</button><button type="button" class="primary" data-sfm-ok>${esc(okLabel)}</button></div>
</div></div>`);
  const modal=document.getElementById(id),body=modal.querySelector('[data-sfm-body]'),status=modal.querySelector('[data-sfm-status]'),ok=modal.querySelector('[data-sfm-ok]');
  const first=fill(body);
  let busy=false;
  const close=()=>closeFormModal(id);
  modal.addEventListener('input',()=>{if(!busy)status.textContent=''});
  modal.addEventListener('click',event=>{
    if(event.target===modal||event.target.closest('[data-sfm-close],[data-sfm-cancel]')){event.stopPropagation();close();return}
    if(event.target.closest('[data-sfm-ok]'))void submit();
  });
  async function submit(){
    if(busy)return;busy=true;ok.disabled=true;status.textContent='';
    let result;
    try{result=await onSubmit()}catch{result='보내지 못했어요. 잠시 뒤 다시 해 주세요'}
    busy=false;ok.disabled=false;
    if(result===true){close();return}
    status.textContent=typeof result==='string'?result:'보내지 못했어요';
  }
  // 창이 바깥(공용 뒤로가기)에서 숨겨지면 여기서도 정리한다.
  const watch=new MutationObserver(()=>{if(modal.classList.contains('hidden')&&open.get(id)?.shown)closeFormModal(id,{restoreFocus:false})});
  modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  open.set(id,{modal,watch,shown:true});
  watch.observe(modal,{attributes:true,attributeFilter:['class']});
  window.KPTUA11y?.dialog?.activate?.(modal,{trigger,initialFocus:first||'[data-sfm-ok]',onRequestClose:close});
  return {modal,body,status,close};
}

export function closeFormModal(id,{restoreFocus=true}={}){
  const entry=open.get(id);
  if(!entry)return;
  open.delete(id);entry.watch.disconnect();
  entry.modal.classList.add('hidden');entry.modal.setAttribute('aria-hidden','true');
  window.KPTUA11y?.dialog?.deactivate?.(entry.modal,{restoreFocus});
  entry.modal.remove();
}
