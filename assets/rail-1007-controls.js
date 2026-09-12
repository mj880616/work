(()=>{
  'use strict';
  if(!location.pathname.includes('/rail-council/2026-1007-delegates/'))return;
  if(window.__rail1007ControlsInstalled)return;
  window.__rail1007ControlsInstalled=true;

  const AUTH='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/pc0921-board?mode=summary';
  const PLAN='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/rail-1007-plan';
  let unlocked=false, authenticating=false, masterPassword='';

  const style=document.createElement('style');
  style.textContent=`
    .program-section.editable-unit{padding-right:25px!important}
    .program-section.editable-unit>h2{padding-right:130px}
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
    }
  `;
  document.head.append(style);

  async function validMaster(password){
    try{
      const r=await fetch(AUTH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check',id:1,password})});
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
  function cleanText(li){return li.textContent.replace(/^[\s·ㆍ•]+/,'').trim()}

  function ensureSlogans(){
    const plan=document.getElementById('editablePlan');
    if(!plan||plan.querySelector('.loading'))return false;
    const sec=[...plan.querySelectorAll('.section')].find(s=>heading(s).startsWith('7. 핵심 구호'));
    if(!sec)return false;
    let ul=sec.querySelector(':scope > ul');if(!ul){ul=document.createElement('ul');sec.append(ul)}
    const firstText='궤도노동자 총단결로 공동투쟁 승리하자';
    const secondText='궤도노동자 공동투쟁으로 산별노조 완성하자!';
    const privateText='안전 사각지대 민자철도 최소 인력기준을 즉각 제도화하라';
    let items=[...ul.querySelectorAll(':scope > li')];
    let first=items.find(li=>cleanText(li)===firstText);
    if(!first){first=document.createElement('li');first.textContent=firstText}
    let second=items.find(li=>cleanText(li)===secondText);
    if(!second){second=document.createElement('li');second.textContent=secondText}
    second.textContent=secondText;
    second.classList.add('slogan-final');
    items=[...ul.querySelectorAll(':scope > li')];
    if(!items.some(li=>cleanText(li)===privateText)){const li=document.createElement('li');li.textContent=privateText;ul.append(li)}
    if(ul.firstElementChild!==first)ul.insertBefore(first,ul.firstElementChild);
    if(first.nextElementSibling!==second)ul.insertBefore(second,first.nextElementSibling);
    setTimeout(()=>window.KPTURichCopy?.enhance?.(),50);
    return true;
  }

  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    if(ensureSlogans()||tries>40)clearInterval(timer);
  },250);
})();