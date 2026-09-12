(()=>{
  'use strict';
  if(!location.pathname.includes('/rail-council/2026-1007-delegates/'))return;
  if(window.__rail1007ControlsInstalled)return;
  window.__rail1007ControlsInstalled=true;

  const AUTH='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/pc0921-board?mode=summary';
  const PLAN='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/rail-1007-plan';
  let unlocked=false, authenticating=false;

  async function validMaster(password){
    try{
      const r=await fetch(AUTH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check',id:1,password})});
      return r.ok;
    }catch{return false}
  }

  async function unlock(){
    if(unlocked)return true;
    if(authenticating)return false;
    const pw=prompt('마스터 비밀번호를 입력해 주세요.');
    if(pw===null)return false;
    authenticating=true;
    const ok=await validMaster(pw.trim());
    authenticating=false;
    if(!ok){alert('마스터 비밀번호가 올바르지 않습니다.');return false}
    unlocked=true;
    return true;
  }

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

  async function persistPlan(plan){
    const clone=plan.cloneNode(true);
    clone.querySelectorAll('.unit-tools,.row-tools,.program-rowbar,.program-row-delete,.table-copy-wrap,.kptu-copy-wrap,.kptu-copy-btn').forEach(x=>x.remove());
    clone.querySelectorAll('[contenteditable]').forEach(x=>x.removeAttribute('contenteditable'));
    clone.querySelectorAll('.editable-unit,.unit-active,.program-editing,.program-section').forEach(x=>x.classList.remove('editable-unit','unit-active','program-editing','program-section'));
    try{
      await fetch(PLAN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',content:clone.innerHTML.trim()})});
    }catch{}
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
    let items=[...ul.querySelectorAll(':scope > li')];
    let first=items.find(li=>cleanText(li)===firstText);
    if(!first){first=document.createElement('li');first.textContent=firstText;changed=true}
    let second=items.find(li=>cleanText(li)===secondText);
    if(!second){second=document.createElement('li');second.textContent=secondText;changed=true}
    if(second.textContent!==secondText){second.textContent=secondText;changed=true}
    second.classList.add('slogan-final');
    items=[...ul.querySelectorAll(':scope > li')];
    if(!items.some(li=>cleanText(li)===privateText)){const li=document.createElement('li');li.textContent=privateText;ul.append(li);changed=true}
    if(ul.firstElementChild!==first){ul.insertBefore(first,ul.firstElementChild);changed=true}
    if(first.nextElementSibling!==second){ul.insertBefore(second,first.nextElementSibling);changed=true}
    if(changed){await persistPlan(plan);setTimeout(()=>window.KPTURichCopy?.enhance?.(),100)}
    return true;
  }

  let tries=0;
  const timer=setInterval(async()=>{
    tries++;
    if(await ensureSlogans()||tries>40)clearInterval(timer);
  },250);
})();