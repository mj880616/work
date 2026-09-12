(()=>{
  'use strict';
  if(!location.pathname.includes('/rail-council/2026-1007-delegates/'))return;
  if(window.__rail1007ControlsInstalled)return;
  window.__rail1007ControlsInstalled=true;

  const PLAN='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/rail-1007-plan';
  let unlocked=false, authenticating=false, masterPassword='';

  const style=document.createElement('style');
  style.id='rail-1007-ui-v4';
  style.textContent=`
    /* 기본은 읽기 모드: 내용이 먼저 보이고 관리 UI는 최소화 */
    body:not(.rail-edit-mode) #editablePlan .editable-unit:not(tr){padding-right:0!important}
    body:not(.rail-edit-mode) #editablePlan .unit-tools,
    body:not(.rail-edit-mode) #editablePlan .row-tools{display:none!important}
    body:not(.rail-edit-mode) #editablePlan h2>.unit-tools{display:flex!important}
    body:not(.rail-edit-mode) #editablePlan h2>.unit-tools .unit-btn:not(.copy){display:none!important}
    body:not(.rail-edit-mode) #editablePlan .program-section>.unit-tools{display:flex!important}
    body:not(.rail-edit-mode) #editablePlan .program-section>.unit-tools .unit-btn:not(.copy){display:none!important}

    /* 별도 단락 복사 버튼을 쓰므로 h2의 복사 버튼은 읽기/편집 모두 동일 위치 */
    #editablePlan h2.editable-unit{padding-right:0!important;display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:12px;align-items:start}
    #editablePlan h2>.unit-tools{position:static!important;grid-column:2;grid-row:1;display:flex;gap:6px;justify-content:flex-end;align-items:center;margin:0!important}
    #editablePlan h2>.unit-tools .unit-btn{min-height:34px;padding:6px 10px!important;font-size:11px!important}

    /* 편집 모드에서만 수정·삭제 노출 */
    .rail-edit-mode #editablePlan .unit-tools,
    .rail-edit-mode #editablePlan .row-tools{display:flex!important}
    .rail-edit-mode #editablePlan .editable-unit:not(tr){padding-right:0!important}
    .rail-edit-mode #editablePlan .unit-btn.copy{display:inline-flex!important}

    /* 목록 항목: 문장 바로 아래 오른쪽에 작업줄 배치 */
    .rail-edit-mode #editablePlan .section>ul>li.editable-unit,
    .rail-edit-mode #editablePlan .decision ol>li.editable-unit{padding-right:0!important;margin-bottom:8px}
    .rail-edit-mode #editablePlan .section>ul>li.editable-unit>.unit-tools,
    .rail-edit-mode #editablePlan .decision ol>li.editable-unit>.unit-tools{
      position:static!important;width:max-content;max-width:100%;margin:5px 0 0 auto!important;
      gap:6px!important;justify-content:flex-end!important
    }

    /* 카드형·요약형 항목 */
    .rail-edit-mode #editablePlan .summary-card.editable-unit,
    .rail-edit-mode #editablePlan .req.editable-unit,
    .rail-edit-mode #editablePlan .point.editable-unit{padding-right:112px!important}
    .rail-edit-mode #editablePlan .summary-card>.unit-tools,
    .rail-edit-mode #editablePlan .req>.unit-tools,
    .rail-edit-mode #editablePlan .point>.unit-tools{right:10px!important;top:10px!important;gap:6px!important}

    /* 흐름·주석은 아래쪽 작업줄 */
    .rail-edit-mode #editablePlan .flow.editable-unit>.unit-tools,
    .rail-edit-mode #editablePlan .note.editable-unit>.unit-tools{
      position:static!important;width:max-content;margin:7px 0 0 auto!important;gap:6px!important
    }

    /* 편집 버튼 터치영역 */
    #editablePlan .unit-btn,
    #editablePlan .program-add,
    #editablePlan .program-row-delete{min-height:34px;padding:6px 10px!important;font-size:11px!important;border-radius:8px!important}
    #editablePlan .row-tools{gap:5px!important;margin-left:6px!important}

    /* 핵심구호는 모두 같은 목록 기호·여백 사용 */
    #editablePlan .rail-slogan-section>ul{padding-left:21px!important}
    #editablePlan .rail-slogan-section>ul>li,
    #editablePlan .rail-slogan-section>ul>li.slogan-final{list-style:disc!important;margin-left:0!important}

    /* 프로그램: 제목/복사/편집 도구와 표를 서로 겹치지 않게 분리 */
    #editablePlan .program-section.editable-unit{padding-right:0!important}
    #editablePlan .program-section>h2{margin-bottom:10px!important}
    #editablePlan .program-section>.unit-tools{
      position:static!important;width:100%;justify-content:flex-end;gap:7px!important;
      margin:0 0 12px!important
    }
    #editablePlan .program-section>.unit-tools .unit-btn{min-height:36px;padding:7px 11px!important;font-size:11px!important}
    #editablePlan .program-section .table-wrap{width:100%!important}
    #editablePlan .program-section .plan-table{width:100%!important}
    #editablePlan .program-rowbar{gap:7px;justify-content:flex-end!important;margin:10px 0 0!important}
    #editablePlan .program-row-delete{display:inline-flex!important;margin:6px 0 0!important}

    /* 표 복사는 표와 분리된 아래 작업줄 */
    #editablePlan .table-copy-wrap{margin:9px 0 0!important;justify-content:flex-end!important}
    #editablePlan .table-copy-btn{min-height:34px;padding:6px 10px!important;font-size:11px!important}

    /* 상단 도구 */
    #railEditToggle{min-height:36px}
    .rail-edit-mode #railEditToggle{background:#17324d;color:#fff;border-color:#17324d}
    .rail-edit-mode #state::before{content:'편집 모드 · ';font-weight:800;color:#245786}

    /* 데스크톱 가독성 */
    @media(min-width:1200px){.wrap{max-width:1080px!important}}

    /* 태블릿 */
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

    /* 모바일: 제목 버튼은 아래 행, 표는 억지로 찌그러뜨리지 않고 좌우 스크롤 */
    @media(max-width:620px){
      .toolbar{gap:8px!important}
      .page-actions{display:grid!important;grid-template-columns:1fr 1fr;gap:7px!important;width:100%;margin-top:9px!important}
      .page-actions .action-btn{width:auto!important;min-height:38px}
      #editablePlan h2.editable-unit{display:block!important}
      #editablePlan h2>.unit-tools{position:static!important;display:flex!important;justify-content:flex-end!important;margin:8px 0 0!important}
      body:not(.rail-edit-mode) #editablePlan h2>.unit-tools .unit-btn:not(.copy){display:none!important}
      .rail-edit-mode #editablePlan .summary-card.editable-unit,
      .rail-edit-mode #editablePlan .req.editable-unit,
      .rail-edit-mode #editablePlan .point.editable-unit{padding-right:0!important;padding-top:15px!important}
      .rail-edit-mode #editablePlan .summary-card>.unit-tools,
      .rail-edit-mode #editablePlan .req>.unit-tools,
      .rail-edit-mode #editablePlan .point>.unit-tools{
        position:static!important;width:max-content;margin:8px 0 0 auto!important
      }
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
      #railEditToggle,#editablePlan .unit-tools,#editablePlan .row-tools,#editablePlan .program-rowbar,#editablePlan .program-row-delete{display:none!important}
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
    b.type='button';b.id='railEditToggle';b.className='action-btn';b.textContent='편집 모드';
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
    const pw=prompt('편집 모드로 전환하려면 마스터 비밀번호를 입력해 주세요.');
    if(pw===null)return false;
    authenticating=true;
    const ok=await validMaster(pw.trim());
    authenticating=false;
    if(!ok){alert('마스터 비밀번호가 올바르지 않습니다.');return false}
    masterPassword=pw.trim();unlocked=true;return true;
  }

  async function toggleEditMode(){
    const entering=!document.body.classList.contains('rail-edit-mode');
    if(entering){
      if(!await unlock())return;
      document.body.classList.add('rail-edit-mode');
      document.getElementById('railEditToggle').textContent='편집 종료';
      const guide=document.querySelector('.guide');if(guide)guide.textContent='편집 모드 · 각 항목 수정·삭제 가능 · 복사·인쇄는 계속 사용 가능';
    }else{
      if(document.querySelector('#editablePlan .unit-active'))return alert('수정 중인 항목을 먼저 저장하거나 취소해 주세요.');
      document.body.classList.remove('rail-edit-mode');
      document.getElementById('railEditToggle').textContent='편집 모드';
      const guide=document.querySelector('.guide');if(guide)guide.textContent='읽기 모드 · 단락/표 복사와 인쇄는 비밀번호 없이 사용 가능';
    }
    syncUi();
  }

  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    try{
      const url=typeof input==='string'?input:(input?.url||'');
      if(url.startsWith(PLAN)&&init?.method?.toUpperCase()==='POST'){
        let body={};
        if(typeof init.body==='string')body=JSON.parse(init.body||'{}');
        if(body?.action==='save'){
          /* 페이지 전용 UI가 저장 데이터에 섞이지 않도록 방어 */
          if(typeof body.content==='string'){
            const host=document.createElement('div');host.innerHTML=body.content;
            host.querySelectorAll('.kptu-copy-wrap,.kptu-copy-btn,.rail-ui,#railEditToggle').forEach(x=>x.remove());
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

  /* 편집 버튼은 편집 모드에서만 동작. 혹시 직접 노출돼도 인증을 우회하지 못하게 함 */
  document.addEventListener('click',async e=>{
    const btn=e.target.closest('.unit-btn.edit,.unit-btn.delete,.program-add,.program-row-delete');
    if(!btn||btn.dataset.authBypass==='1')return;
    if(document.body.classList.contains('rail-edit-mode')&&unlocked)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(await unlock()){
      document.body.classList.add('rail-edit-mode');
      const t=document.getElementById('railEditToggle');if(t)t.textContent='편집 종료';
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
    /* 프로그램 도구는 제목 아래 별도 줄로 고정 */
    const h=sec.querySelector(':scope > h2');
    if(h&&h.nextElementSibling!==tools)h.after(tools);
  }

  function syncUi(){
    installTopToggle();
    const plan=document.getElementById('editablePlan');if(!plan||plan.querySelector('.loading'))return;
    plan.querySelectorAll('.section').forEach(sec=>{
      sec.classList.toggle('rail-slogan-section',isSlogans(sec));
      if(isSlogans(sec))sec.querySelectorAll(':scope > ul > li').forEach(li=>li.classList.remove('slogan-final'));
      if(isProgram(sec)){
        sec.classList.add('program-section');
        ensureProgramCopy(sec);
      }
    });
    const guide=document.querySelector('.guide');
    if(guide&&!document.body.classList.contains('rail-edit-mode'))guide.textContent='읽기 모드 · 단락/표 복사와 인쇄는 비밀번호 없이 사용 가능';
  }

  let syncTimer=0;
  const observer=new MutationObserver(()=>{
    clearTimeout(syncTimer);syncTimer=setTimeout(syncUi,80);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});

  installTopToggle();
  syncUi();
})();