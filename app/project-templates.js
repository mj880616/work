(()=>{
  'use strict';
  const rt=window.KPTURuntime;
  if(!rt)throw new Error('KPTURuntime is required by project-templates');

  let currentProjectId=null,currentUser=null,canEdit=false,installed=false,applying=false;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=(path,opts={})=>rt.api(path,opts);
  const toast=msg=>{const t=document.querySelector('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.add('hidden'),2600)};

  const TEMPLATES=[
    {
      id:'basic-status',
      title:'기본 사업현황',
      desc:'핵심 지표·현재 단계·다음 조치를 한 화면에 정리합니다.',
      tags:['지표','현황','일정'],
      sections:[
        {title:'핵심 현황',blocks:[
          {type:'metrics',title:'핵심 지표',content:{items:[
            {label:'진행률',value:'입력',note:'예: 60%'},{label:'핵심 과제',value:'입력',note:'예: 4건'},{label:'다음 일정',value:'입력',note:'예: 10. 7.'}
          ]}},
          {type:'status',title:'현재 상황',content:{items:[
            {label:'현재 단계',value:'내용을 입력하세요'},{label:'핵심 목표',value:'내용을 입력하세요'},{label:'다음 조치',value:'내용을 입력하세요'}
          ]}}
        ]},
        {title:'주요 일정',collapsed:true,blocks:[
          {type:'timeline',title:'추진 일정',content:{items:[
            {date:'YYYY-MM-DD',title:'주요 일정',body:'내용을 입력하세요'}
          ]}}
        ]}
      ]
    },
    {
      id:'policy-response',
      title:'정책·입법 대응',
      desc:'쟁점, 기관별 대응, 향후 일정을 정책사업용으로 구성합니다.',
      tags:['정책','기관 대응','타임라인'],
      sections:[
        {title:'핵심 쟁점',blocks:[
          {type:'status',title:'쟁점 정리',content:{items:[
            {label:'요구',value:'핵심 요구를 입력하세요'},{label:'정부·기관 입장',value:'확인된 입장을 입력하세요'},{label:'현재 쟁점',value:'쟁점과 판단을 입력하세요'}
          ]}},
          {type:'table',title:'기관별 대응',content:{columns:['기관·주체','현재 상태','다음 대응'],rows:[['기관명','상태 입력','계획 입력']]}}
        ]},
        {title:'대응 일정',collapsed:true,blocks:[
          {type:'timeline',title:'협의·국회·현장 일정',content:{items:[{date:'YYYY-MM-DD',title:'일정명',body:'목표와 준비사항을 입력하세요'}]}}
        ]}
      ]
    },
    {
      id:'campaign-action',
      title:'투쟁·캠페인',
      desc:'공동요구, 조직화 현황, 행동계획을 빠르게 공유하는 형식입니다.',
      tags:['공동요구','조직화','행동계획'],
      sections:[
        {title:'공동 요구와 현황',blocks:[
          {type:'status',title:'핵심 요구',content:{items:[
            {label:'요구 1',value:'내용을 입력하세요'},{label:'요구 2',value:'내용을 입력하세요'},{label:'조직화 현황',value:'현재 상황을 입력하세요'}
          ]}},
          {type:'metrics',title:'참여 현황',content:{items:[
            {label:'참여 조직',value:'입력',note:'개'},{label:'목표 규모',value:'입력',note:'명'},{label:'현재 준비율',value:'입력',note:'%'}
          ]}}
        ]},
        {title:'행동 계획',blocks:[
          {type:'timeline',title:'공동행동 일정',content:{items:[
            {date:'YYYY-MM-DD',title:'행동명',body:'장소·규모·핵심 준비를 입력하세요'}
          ]}}
        ]}
      ]
    },
    {
      id:'event-prep',
      title:'행사·기자회견 준비',
      desc:'행사 개요, 역할 분담, 당일 진행을 한 번에 정리합니다.',
      tags:['행사','역할','진행'],
      sections:[
        {title:'행사 개요',blocks:[
          {type:'status',title:'기본 정보',content:{items:[
            {label:'일시',value:'입력하세요'},{label:'장소',value:'입력하세요'},{label:'목표',value:'입력하세요'},{label:'참석 대상',value:'입력하세요'}
          ]}},
          {type:'table',title:'역할 분담',content:{columns:['역할','담당','상태'],rows:[['사회','담당자 입력','준비 전'],['발언·자료','담당자 입력','준비 전']]}}
        ]},
        {title:'당일 진행',collapsed:true,blocks:[
          {type:'timeline',title:'프로그램',content:{items:[
            {date:'00:00',title:'순서명',body:'진행 내용과 담당을 입력하세요'}
          ]}}
        ]}
      ]
    },
    {
      id:'organization-map',
      title:'사업장·조직 현황',
      desc:'여러 사업장이나 조직의 상태를 비교하고 핵심 수치를 보여줍니다.',
      tags:['사업장','조직','비교표'],
      sections:[
        {title:'전체 현황',blocks:[
          {type:'metrics',title:'전체 지표',content:{items:[
            {label:'대상 조직',value:'입력',note:'개'},{label:'진행 중',value:'입력',note:'개'},{label:'완료',value:'입력',note:'개'}
          ]}},
          {type:'table',title:'조직별 현황',content:{columns:['조직·사업장','현재 상태','핵심 쟁점','다음 계획'],rows:[['조직명','상태 입력','쟁점 입력','계획 입력']]}}
        ]}
      ]
    },
    {
      id:'resource-hub',
      title:'자료·링크 허브',
      desc:'핵심 설명과 자주 쓰는 자료·외부 링크를 묶어둡니다.',
      tags:['자료실','링크','메모'],
      sections:[
        {title:'안내',blocks:[
          {type:'text',title:'이 프로젝트 안내',content:{text:'프로젝트 목적, 자료 사용법, 공유할 내용을 입력하세요.'}},
          {type:'links',title:'주요 링크',content:{items:[
            {label:'링크 이름',url:'https://example.com',note:'설명을 입력하세요'}
          ]}}
        ]}
      ]
    }
  ];

  function templatePreview(t){
    const chips=t.tags.map(x=>`<span>${esc(x)}</span>`).join('');
    const bars=t.sections.slice(0,3).map((s,i)=>`<i style="width:${78-i*12}%"></i>`).join('');
    return `<article class="pvt-card" data-pvt-card="${t.id}"><div class="pvt-mini"><b>${esc(t.title)}</b><div>${bars}</div></div><div class="pvt-card-body"><h3>${esc(t.title)}</h3><p>${esc(t.desc)}</p><div class="pvt-tags">${chips}</div></div><button class="secondary" type="button" data-pvt-apply="${t.id}">이 템플릿 사용</button></article>`;
  }

  function install(){
    if(installed)return;
    const add=document.querySelector('#pvAddSection');
    if(!add)return;
    installed=true;
    add.insertAdjacentHTML('afterend','<button id="pvtOpen" class="mini hidden" type="button">템플릿으로 추가</button>');
    document.body.insertAdjacentHTML('beforeend',`<div id="pvtModal" class="modal hidden" aria-hidden="true"><div class="modal-card pvt-modal-card"><div class="modal-head"><div><div class="eyebrow">PROJECT TEMPLATES</div><h2>프로젝트 디자인 템플릿</h2><p class="pvt-intro">원하는 틀을 고르면 예시 구조가 프로젝트에 추가됩니다. 추가 후 각 블록의 <b>수정</b> 버튼으로 자기 내용으로 바꾸면 됩니다.</p></div><button class="icon-btn" id="pvtClose" type="button">×</button></div><div id="pvtGrid" class="pvt-grid">${TEMPLATES.map(templatePreview).join('')}</div><div id="pvtStatus" class="status"></div></div></div>`);
    const style=document.createElement('style');style.id='projectTemplatesStyle';style.textContent=`#pvtOpen{margin-left:5px}.pvt-modal-card{width:min(920px,94vw);max-height:88vh;overflow:auto}.pvt-intro{margin:5px 0 0;color:#6f7d88;font-size:12px;line-height:1.5}.pvt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.pvt-card{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:12px;align-items:center;border:1px solid #e0e6ea;border-radius:14px;padding:12px;background:#fff}.pvt-mini{height:82px;border:1px solid #dfe6eb;border-radius:10px;padding:10px;background:linear-gradient(145deg,#f8fafb,#eef3f6);overflow:hidden}.pvt-mini>b{display:block;font-size:10px;margin-bottom:9px;color:#334b5e}.pvt-mini>div{display:grid;gap:6px}.pvt-mini i{display:block;height:8px;border-radius:4px;background:#d6e0e7}.pvt-mini i:first-child{height:18px;background:#c9d6df}.pvt-card-body h3{margin:0 0 4px;font-size:13px}.pvt-card-body p{margin:0;color:#6f7d88;font-size:10.5px;line-height:1.45}.pvt-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px}.pvt-tags span{font-size:9px;padding:3px 6px;border-radius:999px;background:#eef3f6;color:#536b7d}.pvt-card>button{white-space:nowrap;font-size:10px}.pvt-card.pvt-working{opacity:.55;pointer-events:none}@media(max-width:760px){.pvt-grid{grid-template-columns:1fr}.pvt-card{grid-template-columns:88px minmax(0,1fr)}.pvt-card>button{grid-column:1/-1;width:100%}.pvt-mini{height:72px}}`;
    document.head.appendChild(style);
    document.querySelector('#pvtOpen')?.addEventListener('click',openGallery);
    document.querySelector('#pvtClose')?.addEventListener('click',closeGallery);
    document.querySelector('#pvtGrid')?.addEventListener('click',e=>{const b=e.target.closest('[data-pvt-apply]');if(b)applyTemplate(b.dataset.pvtApply)});
  }

  function openGallery(){
    if(!canEdit)return;
    const m=document.querySelector('#pvtModal');if(!m)return;
    const st=document.querySelector('#pvtStatus');if(st){st.textContent='';st.className='status'}
    m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
  }
  function closeGallery(){const m=document.querySelector('#pvtModal');if(m){m.classList.add('hidden');m.setAttribute('aria-hidden','true')}}

  async function refreshPermission(){
    install();
    const btn=document.querySelector('#pvtOpen');if(!btn)return;
    canEdit=false;
    if(!currentProjectId||!(await rt.session.ensure())){btn.classList.add('hidden');return}
    try{
      currentUser=await api('/auth/v1/user');
      const [projects,members]=await Promise.all([
        api(`/rest/v1/app_spaces?id=eq.${encodeURIComponent(currentProjectId)}&select=id,owner_id&limit=1`),
        api(`/rest/v1/app_space_members?project_id=eq.${encodeURIComponent(currentProjectId)}&user_id=eq.${currentUser.id}&select=role&limit=1`)
      ]);
      canEdit=projects?.[0]?.owner_id===currentUser.id||['edit','manage'].includes(members?.[0]?.role);
      btn.classList.toggle('hidden',!canEdit);
    }catch(_){btn.classList.add('hidden')}
  }

  async function insertSection(projectId,section,index){
    const rows=await api('/rest/v1/app_project_sections',{method:'POST',prefer:'return=representation',body:{project_id:projectId,title:section.title,sort_order:900+(index+1)*10,collapsed_default:!!section.collapsed,created_by:currentUser.id}});
    const created=Array.isArray(rows)?rows[0]:rows;
    if(!created?.id)throw new Error('템플릿 섹션 생성 결과를 받지 못했습니다.');
    for(let i=0;i<section.blocks.length;i++){
      const b=section.blocks[i];
      await api('/rest/v1/app_project_blocks',{method:'POST',prefer:'return=representation',body:{project_id:projectId,section_id:created.id,block_type:b.type,title:b.title||null,content:b.content,sort_order:(i+1)*10,created_by:currentUser.id}});
    }
  }

  async function applyTemplate(id){
    if(applying||!currentProjectId||!canEdit)return;
    const t=TEMPLATES.find(x=>x.id===id);if(!t)return;
    const st=document.querySelector('#pvtStatus'),card=document.querySelector(`[data-pvt-card="${CSS.escape(id)}"]`);
    applying=true;card?.classList.add('pvt-working');
    if(st){st.textContent=`“${t.title}” 템플릿을 추가하는 중…`;st.className='status'}
    try{
      for(let i=0;i<t.sections.length;i++)await insertSection(currentProjectId,t.sections[i],i);
      if(st){st.textContent='템플릿을 추가했습니다. 각 블록의 수정 버튼으로 내용을 바꾸세요.';st.className='status ok'}
      window.dispatchEvent(new CustomEvent('kptu:project-template-applied',{detail:{project_id:currentProjectId,template:id}}));
      window.dispatchEvent(new CustomEvent('kptu:tasks-changed',{detail:{project_id:currentProjectId,source:'project-template'}}));
      toast(`“${t.title}” 템플릿을 추가했습니다.`);
      setTimeout(closeGallery,650);
    }catch(e){if(st){st.textContent=e.message||String(e);st.className='status error'}}
    finally{applying=false;card?.classList.remove('pvt-working')}
  }

  function pickProjectFromUrl(){return new URLSearchParams(location.search).get('project')||null}
  currentProjectId=pickProjectFromUrl();
  const boot=()=>{install();refreshPermission()};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else setTimeout(boot,0);
  document.addEventListener('click',e=>{const p=e.target.closest?.('[data-project]');if(p?.dataset.project){currentProjectId=p.dataset.project;setTimeout(refreshPermission,160)}},true);
  const projectModal=document.querySelector('#projectModal');
  if(projectModal)new MutationObserver(()=>{if(!projectModal.classList.contains('hidden')){currentProjectId=pickProjectFromUrl()||currentProjectId;setTimeout(refreshPermission,80)}}).observe(projectModal,{attributes:true,attributeFilter:['class']});
  window.addEventListener('popstate',()=>{currentProjectId=pickProjectFromUrl()||currentProjectId;refreshPermission()});
  window.addEventListener('kptu:session-changed',()=>setTimeout(refreshPermission,100));
})();
