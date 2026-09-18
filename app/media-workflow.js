(()=>{
'use strict';
if(window.KPTUMediaWorkflow)return;
const rt=window.KPTURuntime,caps=window.KPTUCapabilities;
let rows=[],bound=false;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusLabel={draft:'작성중',review:'검토중',published:'확정',archived:'종료'};
const el=id=>document.getElementById(id);
function workspaceId(){return caps?.workspaceId?.()||null}
function caseTitle(v){return String(v||'').replace(/^\[언론대응\]\s*/,'')}
function fmt(v){return v?new Date(v).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}
function newSlug(){const d=new Date(),s=String;return 'media-'+d.getFullYear()+s(d.getMonth()+1).padStart(2,'0')+s(d.getDate()).padStart(2,'0')+'-'+Math.random().toString(36).slice(2,6)}
function template(){
return '# 사건 팩트시트\n\n'+
'## 오늘 새로 생긴 사실\n- \n\n'+
'## 핵심 숫자\n1. 숫자 / 기준 / 출처:\n2. 숫자 / 기준 / 출처:\n\n'+
'## 근거·원문\n- 문서명:\n- 작성기관·작성일:\n- 원문 위치:\n- 정확한 문구:\n- 해석상 주의점:\n\n'+
'## 현장 사례\n1. \n2. \n\n'+
'## 상대방 입장·예상 반론\n- 공식 입장:\n- 예상 반론:\n- 답변 근거:\n\n'+
'## 노조 판단\n- 한 문장:\n- 근거 1:\n- 근거 2:\n\n'+
'## 요구\n1. \n2. \n3. \n\n'+
'---\n\n# 취재요청 초안\n\n[취재요청] 제목\n\n■ 일시:\n■ 장소:\n\n왜 지금 취재해야 하는가\n\n핵심 숫자·현장 사례\n\n노조의 판단과 요구\n\n기자회견 순서\n- 모두발언:\n- 현장발언:\n- 기자회견문:\n\n'+
'---\n\n# 보도자료 초안\n\n[보도자료] 제목\n\n## 오늘 새로 확인된 사실\n\n## 가장 강한 숫자\n\n## 핵심 인용\n> “ ”\n\n## 요구와 다음 일정\n\n## source pack\n- 모두발언\n- 현장발언\n- 기자회견문\n- 원문·연구자료\n- 사진\n\n'+
'---\n\n# 성명 초안\n\n[성명] 제목\n\n## 무슨 일이 있었나\n\n## 우리는 어떻게 판단하나\n\n## 왜 그렇게 판단하나\n\n## 요구\n\n'+
'---\n\n# 배포 전 QA\n\n'+
'- [ ] 날짜·요일·시간 확인\n'+
'- [ ] 이름·직책 확인\n'+
'- [ ] 숫자·분모·기준일 확인\n'+
'- [ ] 근거 원문 직접 확인\n'+
'- [ ] 상대방 공식 입장 또는 반론 확인\n'+
'- [ ] 판정·결정의 결론과 이유 구분\n'+
'- [ ] 확인 사실과 노조 평가 구분\n'+
'- [ ] 사망·질병·사고 인과관계 귀속 확인\n'+
'- [ ] 가장 강한 새 사실·숫자가 첫 화면에 있음\n'+
'- [ ] 본문·발언문·원자료가 분리되어 있음\n'+
'- [ ] 첨부파일이 해당 사건의 최종본과 일치\n\n'+
'## Web1 공개\n- 공개 URL:\n- 게시 확인:\n- 기사클리핑:\n';
}
function filtered(){
  const q=(el('mediaSearch')?.value||'').trim().toLowerCase();
  const st=el('mediaStatusFilter')?.value||'all';
  return rows.filter(x=>(st==='all'||x.status===st)&&(!q||((x.title||'')+' '+(x.summary||'')).toLowerCase().includes(q)));
}
function render(){
  const box=el('mediaCaseList');if(!box)return;
  const list=filtered();
  el('mediaCaseEmpty')?.classList.toggle('hidden',list.length>0);
  box.innerHTML=list.map(x=>'<article class="media-case-card" data-media-id="'+esc(x.id)+'"><div><div class="badges"><span class="badge '+esc(x.status)+'">'+esc(statusLabel[x.status]||x.status)+'</span><span class="badge workspace">내부</span></div><h3>'+esc(caseTitle(x.title))+'</h3><p>'+esc(x.summary||'언론대응 사건')+'</p><small>'+esc(fmt(x.updated_at))+'</small></div><button class="secondary" type="button" data-media-edit="'+esc(x.id)+'">열기</button></article>').join('');
}
async function refresh(){
  const wid=workspaceId();if(!rt||!wid)return false;
  rows=await rt.api('/rest/v1/app_pages?workspace_id=eq.'+wid+'&slug=like.media-*&select=id,slug,title,summary,visibility,status,owner_id,created_at,updated_at&order=updated_at.desc');
  render();return true;
}
async function createCase(){
  if(!window.KPTUPageSave?.open)return;
  await window.KPTUPageSave.open(null);
  const title=el('pageTitle'),slug=el('pageSlug'),summary=el('pageSummary'),body=el('pageBody'),status=el('pageStatus'),visibility=el('pageVisibility');
  if(title)title.value='[언론대응] ';
  if(slug){slug.value=newSlug();slug.dispatchEvent(new Event('input',{bubbles:true}))}
  if(summary)summary.value='언론대응 · 사건 팩트시트 → 초안 → QA';
  if(body)body.value=template();
  if(status)status.value='draft';
  if(visibility)visibility.value='workspace';
  title?.focus();
}
async function editCase(id){if(window.KPTUPageSave?.open)await window.KPTUPageSave.open(id)}
function bind(){
  if(bound)return;bound=true;
  el('newMediaCaseBtn')?.addEventListener('click',createCase);
  el('mediaSearch')?.addEventListener('input',render);
  el('mediaStatusFilter')?.addEventListener('change',render);
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-media-edit]');if(b)editCase(b.dataset.mediaEdit)});
  window.KPTURouter?.on?.('media',()=>refresh().catch(console.error));
  window.addEventListener('kptu:pages-rendered',()=>refresh().catch(()=>{}));
}
async function init(){if(!rt||!workspaceId())return false;bind();await refresh();return true}
window.KPTUMediaWorkflow={refresh,create:createCase};
window.__KPTU_MEDIA_WORKFLOW_READY__=init().catch(e=>{console.error('media workflow',e);return false});
})();