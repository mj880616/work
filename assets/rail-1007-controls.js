(()=>{
  'use strict';
  if(!location.pathname.includes('/rail-council/2026-1007-delegates/'))return;
  if(window.__rail1007ControlsInstalled)return;
  window.__rail1007ControlsInstalled=true;

  const PLAN='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/rail-1007-plan';
  let unlocked=false, authenticating=false, masterPassword='';

  const style=document.createElement('style');
  style.textContent=`
    .program-section.editable-unit{padding-right:25px!important}
    .program-section.editable-unit>h2{padding-right:130px}

    /* 세부항목 수정·삭제 버튼은 해당 문장 바로 뒤에 배치 */
    .section>ul>li.editable-unit,
    .decision ol>li.editable-unit{padding-right:0!important}
    .section>ul>li.editable-unit>.unit-tools,
    .decision ol>li.editable-unit>.unit-tools{
      position:static!important;display:inline-flex!important;gap:4px!important;
      margin-left:8px!important;vertical-align:middle!important;transform:translateY(-1px)
    }
    .section>ul>li.editable-unit>.unit-tools .unit-btn,
    .decision ol>li.editable-unit>.unit-tools .unit-btn{padding:3px 7px!important;font-size:9.5px!important}

    @media(max-width:900px){
      .program-section.editable-unit{padding-right:18px!important}
      .program-section.editable-unit>h2{padding-right:130px}
      .program-section .table-wrap{width:100%!important;overflow-x:visible!important}
      .program-section .plan-table{width:100%!important;min-width:0!important;table-layout:fixed!important}
      .program-section .plan-table th:nth-child(1),.program-section .plan-table td:nth-child(1){width:16%!important}
      .program-section .plan-table th:nth-child(2),.program-section .plan-table td:nth-child(2){width:14%!important}
      .program-section .plan-table th:nth-child(3),.program-section .plan-table td:nth-child(3){width:46%!important}
      .program-section .plan-table th:nth-child(4),.program-section .plan-table td:nth-child(4){width:24%!important}
    }
    @media(max-width:480px){
      .program-section .table-wrap{overflow-x:auto!important;-webkit-overflow-scrolling:touch}
      .program-section .plan-table{min-width:560px!important;table-layout:auto!important}
      .program-section .plan-table th,.program-section .plan-table td{font-size:11px!important;padding:8px 7px!important;word-break:keep-all!important;overflow-wrap:normal!important}
      .section>ul>li.editable-unit>.unit-tools,
      .decision ol>li.editable-unit>.unit-tools{margin-left:5px!important}
    }
  `;
  document.head.append(style);

  async function validMaster(password){
    try{
      const r=await fetch(PLAN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check',password})});
      return r.ok;
    }catch{return false}
  }

  async function unlock(){
    if(unlocked)return true;
    if(authenticating)return false;
    const pw=prompt('수정하려면 마스터 비밀번호를 입력해 주세요.');
    if(pw===null)return false;
    authenticating=true;
    const ok=await validMaster(pw.trim());
    authenticating=false;
    if(!ok){alert('마스터 비밀번호가 올바르지 않습니다.');return false}
    masterPassword=pw.trim();
    unlocked=true;
    return true;
  }

  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    try{
      const url=typeof input==='string'?input:(input?.url||'');
      if(url.startsWith(PLAN)&&init?.method?.toUpperCase()==='POST'&&masterPassword){
        let body={};
        if(typeof init.body==='string')body=JSON.parse(init.body||'{}');
        if(body&&body.action==='save'&&!body.master_password&&!body.password){
          body.master_password=masterPassword;
          init={...init,headers:{...(init.headers||{}),'Content-Type':'application/json'},body:JSON.stringify(body)};
        }
      }
    }catch{}
    return nativeFetch(input,init);
  };

  document.addEventListener('click',async e=>{
    const btn=e.target.closest('.unit-btn.edit,.unit-btn.delete,.program-add,.program-row-delete');
    if(!btn||btn.classList.contains('copy')||btn.dataset.authBypass==='1')return;
    if(unlocked)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(await unlock()){
      btn.dataset.authBypass='1';
      btn.click();
      delete btn.dataset.authBypass;
    }
  },true);

  function heading(sec){return sec.querySelector(':scope > h2')?.textContent.replace(/[\u200B-\u200D\uFEFF]/g,'').trim()||''}
  function cleanText(li){
    const c=li.cloneNode(true);
    c.querySelectorAll('.unit-tools,.row-tools,.program-row-delete,.kptu-copy-wrap,.kptu-copy-btn').forEach(x=>x.remove());
    return c.textContent.replace(/^[\s·ㆍ•]+/,'').trim();
  }
  function cleanPlanHtml(plan){
    const c=plan.cloneNode(true);
    c.querySelectorAll('.unit-tools,.row-tools,.program-rowbar,.program-row-delete,.table-copy-wrap,.kptu-copy-wrap,.kptu-copy-btn').forEach(x=>x.remove());
    c.querySelectorAll('[contenteditable]').forEach(x=>x.removeAttribute('contenteditable'));
    c.querySelectorAll('.editable-unit,.unit-active,.program-editing,.program-section').forEach(x=>x.classList.remove('editable-unit','unit-active','program-editing','program-section'));
    return c.innerHTML.trim();
  }
  async function persistPlan(plan){
    try{await nativeFetch(PLAN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',content:cleanPlanHtml(plan)})})}catch{}
  }

  async function ensureSlogans(){
    const plan=document.getElementById('editablePlan');
    if(!plan||plan.querySelector('.loading'))return false;
    const sec=[...plan.querySelectorAll('.section')].find(s=>heading(s).startsWith('7. 핵심 구호'));
    if(!sec)return false;
    let ul=sec.querySelector(':scope > ul');if(!ul){ul=document.createElement('ul');sec.append(ul)}

    const firstText='궤도노동자 총단결로 공동투쟁 승리하자';
    const secondText='궤도노동자 공동투쟁으로 산별노조 완성하자!';
    const privateText='안전 사각지대 민자철도 최소 인력기준을 즉각 제도화하라';
    let changed=false;

    const normalizeOne=(text,klass='')=>{
      let matches=[...ul.querySelectorAll(':scope > li')].filter(li=>cleanText(li)===text);
      let keep=matches.shift();
      if(!keep){keep=document.createElement('li');keep.textContent=text;changed=true}
      matches.forEach(li=>{li.remove();changed=true});
      if(cleanText(keep)!==text||keep.childNodes.length!==1||keep.firstChild?.nodeType!==3){keep.textContent=text;changed=true}
      if(klass&&!keep.classList.contains(klass)){keep.classList.add(klass);changed=true}
      return keep;
    };

    const first=normalizeOne(firstText);
    const second=normalizeOne(secondText,'slogan-final');
    normalizeOne(privateText);

    if(ul.firstElementChild!==first){ul.insertBefore(first,ul.firstElementChild);changed=true}
    if(first.nextElementSibling!==second){ul.insertBefore(second,first.nextElementSibling);changed=true}

    if(changed)await persistPlan(plan);
    setTimeout(()=>window.KPTURichCopy?.enhance?.(),50);
    return true;
  }

  let tries=0;
  const timer=setInterval(async()=>{
    tries++;
    if(await ensureSlogans()||tries>40)clearInterval(timer);
  },250);
})();