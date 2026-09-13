(()=>{
  'use strict';
  if(!location.pathname.includes('/rail-council/2026-1007-delegates/'))return;
  if(window.__rail1007ControlsInstalled)return;
  window.__rail1007ControlsInstalled=true;

  const PLAN='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/rail-1007-plan';
  let unlocked=false, authenticating=false, masterPassword='';

  const style=document.createElement('style');
  style.id='rail-1007-ui-v5';
  style.textContent=`
    /* 단락별 수정: 개별 문장·행 단위 수정 도구는 숨김 */
    #editablePlan .editable-unit:not(tr){padding-right:0!important}
    #editablePlan .row-tools{display:none!important}
    #editablePlan .summary-card>.unit-tools,
    #editablePlan .section>ul>li>.unit-tools,
    #editablePlan .decision ol>li>.unit-tools,
    #editablePlan .requirements>.req>.unit-tools,
    #editablePlan .section>.lead>.unit-tools,
    #editablePlan .section>.flow>.unit-tools,
    #editablePlan .section>.note>.unit-tools,
    #editablePlan .section>.point>.unit-tools{display:none!important}

    /* 제목 우측: 단락 복사 + 단락 수정만 표시 */
    #editablePlan h2.editable-unit{
      padding-right:0!important;
      display:grid;
      grid-template-columns:minmax(0,1fr) auto;
      column-gap:12px;
      align-items:start
    }
    #editablePlan h2>.unit-tools{
      position:static!important;
      grid-column:2;
      grid-row:1;
      display:flex!important;
      gap:6px;
      justify-content:flex-end;
      align-items:center;
      margin:0!important
    }
    #editablePlan h2>.unit-tools .unit-btn{display:none!important}
    #editablePlan h2>.unit-tools .unit-btn.copy,
    #editablePlan h2>.unit-tools .rail-section-edit{display:inline-flex!important}

    .rail-section-edit{
      min-height:34px;
      padding:6px 10px!important;
      border:1px solid #c7d3dd;
      background:#fff;
      color:#245786;
      border-radius:8px;
      font-size:11px!important;
      font-weight:900;
      cursor:pointer;
      align-items:center;
      justify-content:center;
      white-space:nowrap
    }

    /* 단락 전체 수정 중에는 하위 도구를 숨기고 저장·취소만 표시 */
    #editablePlan .unit-active h2>.unit-tools{display:none!important}
    #editablePlan .unit-active>.unit-tools{
      position:static!important;
      display:flex!important;
      width:100%;
      justify-content:flex-end;
      gap:7px!important;
      margin:10px 0 0!important
    }
    #editablePlan .unit-active>.unit-tools .unit-btn.save,
    #editablePlan .unit-active>.unit-tools .unit-btn.cancel{display:inline-flex!important}

    /* 프로그램 단락: 표 전체에 수정 1개 */
    #editablePlan .program-section>h2{margin-bottom:10px!important}
    #editablePlan .program-section>.unit-tools{
      position:static!important;
      display:flex!important;
      width:100%;
      justify-content:flex-end;
      gap:7px!important;
      margin:0 0 12px!important
    }
    #editablePlan .program-section>.unit-tools .unit-btn{display:none!important}
    #editablePlan .program-section>.unit-tools .unit-btn.copy,
    #editablePlan .program-section>.unit-tools .rail-section-edit{display:inline-flex!important}
    #editablePlan .program-section.unit-active>.unit-tools .unit-btn.save,
    #editablePlan .program-section.unit-active>.unit-tools .unit-btn.cancel{display:inline-flex!important}
    #editablePlan .program-section .table-wrap{width:100%!important}
    #editablePlan .program-section .plan-table{width:100%!important}
    #editablePlan .program-rowbar{gap:7px;justify-content:flex-end!important;margin:10px 0 0!important}
    #editablePlan .program-editing .program-row-delete{display:inline-flex!important;margin:6px 0 0!important}

    /* 버튼 터치영역 */
    #editablePlan .unit-btn,
    #editablePlan .program-add,
    #editablePlan .program-row-delete{min-height:34px;padding:6px 10px!important;font-size:11px!important;border-radius:8px!important}

    /* 핵심구호 목록 기호 통일 */
    #editablePlan .rail-slogan-section>ul{padding-left:21px!important}
    #editablePlan .rail-slogan-section>ul>li,
    #editablePlan .rail-slogan-section>ul>li.slogan-final{list-style:disc!important;margin-left:0!important}

    /* 표 복사 */
    #editablePlan .table-copy-wrap{margin:9px 0 0!important;justify-content:flex-end!important}
    #editablePlan .table-copy-btn{min-height:34px;padding:6px 10px!important;font-size:11px!important}

    /* 상단 도구 */
    #railEditToggle{min-height:36px}
    .rail-edit-mode #railEditToggle{background:#17324d;color:#fff;border-color:#17324d}
    .rail-edit-mode #state::before{content:'편집 인증됨 · ';font-weight:800;color:#245786}

    @media(min-width:1200px){.wrap{max-width:1080px!important}}

    @media(max-width:900px){
      #editablePlan h2.editable-unit{grid-template-columns:minmax(0,1fr) auto;column-gap:9px}
      #editablePlan .program-section .table-wrap{overflow-x:visible!important}
      #editablePlan .program-section .plan-table{min-width:0!important;table-layout:fixed!important}
      #editablePlan .program-section .plan-table th:nth-child(1),#editablePlan .program-section .plan-table td:nth-child(1){width:16%!important}
      #editablePlan .program-section .plan-table th:nth-child(2),#editablePlan .program-section .plan-table td:nth-child(2){width:14%!important}
      #editablePlan .program-section .plan-table th:nth-child(3),#editablePlan .program-section .plan-table td:nth-child(3){width:46%!important}
      #editablePlan .program-section .plan-table th:nth-child(4),#editablePlan .program-section .plan-table td:nth-child(4){width:24%!important}
      #editablePlan .program-section .plan-table th,#editablePlan .program-section .plan-table td{word-break:keep-all!important;overflow-wrap:break-word!important}
    }

    @media(max-width:620px){
      .toolbar{gap:8px!important}
      .page-actions{display:grid!important;grid-template-columns:1fr 1fr;gap:7px!important;width:100%;margin-top:9px!important}
      .page-actions .action-btn{width:auto!important;min-height:38px}
      #editablePlan h2.editable-unit{display:block!important}
      #editablePlan h2>.unit-tools{position:static!important;display:flex!important;justify-content:flex-end!important;margin:8px 0 0!important}
      #editablePlan .program-section .table-wrap{overflow-x:auto!important;-webkit-overflow-scrolling:touch!important}
      #editablePlan .program-section .plan-table{min-width:700px!important;table-layout:auto!important}
      #editablePlan .program-section .plan-table th,#editablePlan .program-section .plan-table td{
        font-size:11.5px!important;padding:9px 8px!important;word-break:keep-all!important;overflow-wrap:normal!important
      }
      #editablePlan .program-section .plan-table th:nth-child(1),#editablePlan .program-section .plan-table td:nth-child(1){width:110px!important}
      #editablePlan .program-section .plan-table th:nth-child(2),#editablePlan .program-section .plan-table td:nth-child(2){width:120px!important}
      #editablePlan .program-section .plan-table th:nth-child(3),#editablePlan .program-section .plan-table td:nth-child(3){width:330px!important}
      #editablePlan .program-section .plan-table th:nth-child(4),#editablePlan .program-section .plan-table td:nth-child(4){width:180px!important}
    }

    @media print{
      #railEditToggle,#editablePlan .unit-tools,#editablePlan .row-tools,#editablePlan .rail-section-edit,
      #editablePlan .program-rowbar,#editablePlan .program-row-delete{display:none!important}
      #editablePlan .editable-unit:not(tr){padding-right:0!important}
      #editablePlan .program-section .table-wrap{overflow:visible!important}
      #editablePlan .program-section .plan-table{min-width:0!important;table-layout:auto!important}
      #editablePlan .plan-table tr{break-inside:avoid;page-break-inside:avoid}
    }
  `;
  document.head.append(style);

  function heading(sec){return sec?.querySelector?.(':scope > h2')?.textContent.replace(/[\u200B-\u200D\uFEFF]/g,'').trim()||''}
  const isProgram=sec=>heading(sec).startsWith('5. 대회 프로그램');
  const isSlogans=sec=>heading(sec).startsWith('7. 핵심 구호');

  function installTopToggle(){
    if(document.getElementById('railEditToggle'))return;
    const actions=document.querySelector('.page-actions');
    if(!actions)return;
    const b=document.createElement('button');
    b.type='button';b.id='railEditToggle';b.className='action-btn';b.textContent='편집 인증';
    b.addEventListener('click',toggleEditMode);
    actions.append(b);
  }

  async function validMaster(password){
    try{
      const r=await nativeFetch(PLAN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check',password})});
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
    masterPassword=pw.trim();unlocked=true;return true;
  }

  async function toggleEditMode(){
    if(!unlocked){
      if(!await unlock())return;
      document.body.classList.add('rail-edit-mode');
      const t=document.getElementById('railEditToggle');if(t)t.textContent='인증 완료';
      const guide=document.querySelector('.guide');if(guide)guide.textContent='단락별 수정 가능 · 각 단락의 수정 버튼을 눌러 편집';
      return;
    }
    document.body.classList.toggle('rail-edit-mode');
    const on=document.body.classList.contains('rail-edit-mode');
    const t=document.getElementById('railEditToggle');if(t)t.textContent=on?'인증 완료':'편집 인증';
  }

  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    try{
      const url=typeof input==='string'?input:(input?.url||'');
      if(url.startsWith(PLAN)&&init?.method?.toUpperCase()==='POST'){
        let body={};
        if(typeof init.body==='string')body=JSON.parse(init.body||'{}');
        if(body?.action==='save'){
          if(typeof body.content==='string'){
            const host=document.createElement('div');host.innerHTML=body.content;
            host.querySelectorAll('.kptu-copy-wrap,.kptu-copy-btn,.rail-ui,#railEditToggle,.rail-section-edit').forEach(x=>x.remove());
            host.querySelectorAll('.slogan-final').forEach(x=>x.classList.remove('slogan-final'));
            body.content=host.innerHTML.trim();
          }
          if(masterPassword)body.master_password=masterPassword;
          init={...init,headers:{...(init.headers||{}),'Content-Type':'application/json'},body:JSON.stringify(body)};
        }
      }
    }catch{}
    return nativeFetch(input,init);
  };

  /* 프로그램 수정 중 행 추가·삭제 등은 인증된 상태에서만 동작 */
  document.addEventListener('click',async e=>{
    const btn=e.target.closest('.program-add,.program-row-delete');
    if(!btn||btn.dataset.authBypass==='1'||unlocked)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(await unlock()){
      btn.dataset.authBypass='1';btn.click();delete btn.dataset.authBypass;
    }
  },true);

  function ensureProgramCopy(sec){
    const tools=sec.querySelector(':scope > .unit-tools');
    if(!tools)return;
    if(!tools.querySelector('.unit-btn.copy')){
      const b=document.createElement('button');b.type='button';b.className='unit-btn copy';b.textContent='단락 복사';
      tools.append(b);
    }
    const h=sec.querySelector(':scope > h2');
    if(h&&h.nextElementSibling!==tools)h.after(tools);
  }

  function ensureSectionEdit(sec){
    if(sec.classList.contains('unit-active'))return;
    let tools;
    if(isProgram(sec)){
      tools=sec.querySelector(':scope > .unit-tools');
      if(!tools){
        tools=document.createElement('span');tools.className='unit-tools';
        sec.querySelector(':scope > h2')?.after(tools);
      }
    }else{
      const h=sec.querySelector(':scope > h2');
      if(!h)return;
      tools=h.querySelector(':scope > .unit-tools');
      if(!tools){tools=document.createElement('span');tools.className='unit-tools';h.append(tools)}
    }
    if(tools.querySelector('.rail-section-edit'))return;
    const b=document.createElement('button');
    b.type='button';b.className='rail-section-edit';b.textContent='수정';
    b.addEventListener('click',async e=>{
      e.preventDefault();e.stopPropagation();
      if(document.querySelector('#editablePlan .unit-active'))return alert('수정 중인 단락을 먼저 저장하거나 취소해 주세요.');
      if(!await unlock())return;
      if(typeof window.startEdit!=='function')return alert('수정 기능을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
      sec.classList.add('rail-section-wide-edit');
      window.startEdit(sec);
    });
    tools.prepend(b);
  }

  function syncUi(){
    installTopToggle();
    const plan=document.getElementById('editablePlan');if(!plan||plan.querySelector('.loading'))return;
    plan.querySelectorAll('.section,.decision').forEach(sec=>{
      sec.classList.toggle('rail-slogan-section',isSlogans(sec));
      if(isSlogans(sec))sec.querySelectorAll(':scope > ul > li').forEach(li=>li.classList.remove('slogan-final'));
      if(isProgram(sec)){
        sec.classList.add('program-section');
        ensureProgramCopy(sec);
      }
      ensureSectionEdit(sec);
    });
    const guide=document.querySelector('.guide');
    if(guide)guide.textContent='단락별 수정 · 각 단락당 수정 버튼 1개 · 복사·인쇄 가능';
  }

  let syncTimer=0;
  const observer=new MutationObserver(()=>{
    clearTimeout(syncTimer);syncTimer=setTimeout(syncUi,80);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});

  installTopToggle();
  syncUi();
})();