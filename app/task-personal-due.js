const TPD_TASK_PATH='/rest/v1/app_tasks';

function tpdToday(){
  const d=new Date(),p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function tpdDateOnly(value){
  if(!value)return null;
  const s=String(value);
  const m=s.match(/^(\d{4}-\d{2}-\d{2})/);
  if(m)return m[1];
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return null;
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function tpdNormalizePayload(payload){
  const rows=Array.isArray(payload)?payload:[payload];
  rows.forEach(row=>{
    if(!row||typeof row!=='object'||!Object.prototype.hasOwnProperty.call(row,'due_at'))return;
    row.due_at=row.due_at?tpdDateOnly(row.due_at):null;
  });
  return payload;
}
function tpdInstallFetchPatch(){
  if(window.__KPTU_TASK_DUE_DATE_PATCH__)return;
  window.__KPTU_TASK_DUE_DATE_PATCH__=true;
  const previous=window.fetch.bind(window);
  window.fetch=async function(input,init={}){
    try{
      const url=typeof input==='string'?input:(input?.url||'');
      const method=String(init.method||'GET').toUpperCase();
      if(url.includes(TPD_TASK_PATH)&&['POST','PATCH'].includes(method)&&typeof init.body==='string'){
        const payload=tpdNormalizePayload(JSON.parse(init.body));
        init={...init,body:JSON.stringify(payload)};
      }
    }catch(_){ }
    return previous(input,init);
  };
}
function tpdPrepareInput(){
  const input=document.querySelector('#taskDue');
  if(!input)return;
  const previous=tpdDateOnly(input.value);
  if(input.type!=='date')input.type='date';
  input.value=previous||input.value||tpdToday();
  if(!input.dataset.tpdPicker){
    input.dataset.tpdPicker='1';
    input.addEventListener('click',()=>{try{input.showPicker?.()}catch(_){ }});
  }
}
function tpdInit(){
  tpdInstallFetchPatch();
  tpdPrepareInput();
  document.addEventListener('click',e=>{
    if(e.target.closest?.('#quickTaskBtn,#newTaskBtn'))setTimeout(tpdPrepareInput,0);
  },true);
  const modal=document.querySelector('#taskModal');
  if(modal)new MutationObserver(()=>{
    if(!modal.classList.contains('hidden'))setTimeout(tpdPrepareInput,0);
  }).observe(modal,{attributes:true,attributeFilter:['class']});
}

tpdInit();
