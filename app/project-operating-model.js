(()=>{
'use strict';
// Inactive legacy module. Keep the manual project template until the 31-1 dependency audit.
const rt=window.KPTURuntime;if(!rt)return;
let user=null,currentId=null,current=null,sections=[];
const api=(path,options={})=>rt.api(path,options);

async function ctx(id){
  if(!(await rt.session.ensure()))return false;
  user=await api('/auth/v1/user');
  currentId=id||new URLSearchParams(location.search).get('project');
  if(!currentId)return false;
  const rows=await api(`/rest/v1/app_spaces?id=eq.${encodeURIComponent(currentId)}&select=id,name,parent_id,owner_id,description&limit=1`);
  current=rows?.[0];if(!current)return false;
  sections=await api(`/rest/v1/app_project_sections?project_id=eq.${currentId}&select=*&order=sort_order.asc`);
  return true;
}

function toast(message){
  const element=document.querySelector('#toast');if(!element)return;
  element.textContent=message;element.classList.remove('hidden');
  setTimeout(()=>element.classList.add('hidden'),2300);
}

async function ensureOngoingTemplate(reloadAfter=false){
  if(!current||current.parent_id)return false;
  if(sections.some(section=>section.title==='영역별 진척상황')){
    if(reloadAfter)toast('이미 연중사업 기본구성이 있습니다.');
    return false;
  }
  const definitions=[
    {title:'영역별 진척상황',collapsed:false,blocks:[{type:'table',title:'진척상황',content:{columns:['영역','현재 진척','쟁점','다음 조치'],rows:[['영역 1','내용을 입력하세요','','']]}}]},
    {title:'주요 타임라인',collapsed:false,blocks:[{type:'timeline',title:'사업 타임라인',content:{items:[]}}]},
    {title:'관련 자료',collapsed:true,blocks:[{type:'links',title:'핵심 자료·링크',content:{items:[]}}]},
    {title:'사업 피드백',collapsed:true,blocks:[{type:'text',title:'피드백 요약',content:{text:'프로젝트의 의견·댓글 영역에 판단, 개선점, 현장 피드백을 누적합니다. 중요한 피드백은 여기에 요약합니다.'}}]}
  ];
  for(let i=0;i<definitions.length;i++){
    const definition=definitions[i];
    const rows=await api('/rest/v1/app_project_sections',{method:'POST',prefer:'return=representation',body:{project_id:currentId,title:definition.title,sort_order:100+i*10,collapsed_default:definition.collapsed,created_by:user.id}});
    const sectionId=rows?.[0]?.id;if(!sectionId)throw new Error('프로젝트 기본구성 생성에 실패했습니다.');
    for(let j=0;j<definition.blocks.length;j++){
      const block=definition.blocks[j];
      await api('/rest/v1/app_project_blocks',{method:'POST',body:{project_id:currentId,section_id:sectionId,block_type:block.type,title:block.title,content:block.content,sort_order:(j+1)*10,created_by:user.id}});
    }
  }
  if(reloadAfter){toast('연중사업 기본구성을 추가했습니다.');setTimeout(()=>location.reload(),450)}
  return true;
}

function install(){
  if(document.querySelector('#pomControls'))return;
  const overview=document.querySelector('#pvOverview .pv-overview-main')||document.querySelector('#pvOverview');
  if(!overview)return;
  overview.insertAdjacentHTML('beforeend','<div id="pomControls" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button id="pomTemplate" class="mini" type="button">연중사업 기본구성</button><span id="pomChildBadge" class="badge hidden">하위 프로젝트 · 실행/기획 관리 단위</span></div>');
  document.querySelector('#pomTemplate').onclick=()=>ensureOngoingTemplate(true);
}

async function refresh(){
  const id=new URLSearchParams(location.search).get('project');
  if(!id||!(await ctx(id)))return;
  install();
  const child=!!current.parent_id;
  document.querySelector('#pomTemplate')?.classList.toggle('hidden',child);
  document.querySelector('#pomChildBadge')?.classList.toggle('hidden',!child);
}

document.addEventListener('click',event=>{const control=event.target.closest?.('[data-project]');if(control?.dataset.project)setTimeout(refresh,160)});
window.addEventListener('popstate',()=>setTimeout(refresh,80));
window.addEventListener('kptu:session-changed',()=>setTimeout(refresh,120));
setTimeout(refresh,300);
})();
