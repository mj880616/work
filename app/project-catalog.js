(()=>{
'use strict';
if(window.KPTUProjectCatalog)return;
// Canonical Web2 project catalog: one project rule and one hierarchy, shared by the project screen and the library.
const isProject=p=>p?.metadata?.project_system==='v2'||Number(p?.metadata?.management_version)===2;
function select(spaces){
  const rows=Array.isArray(spaces)?spaces:[];
  const included=new Set(rows.filter(isProject).map(x=>x.id));
  let changed=true;
  while(changed){
    changed=false;
    for(const p of rows)if(p.parent_id&&included.has(p.parent_id)&&!included.has(p.id)){included.add(p.id);changed=true}
  }
  return rows.filter(p=>included.has(p.id))
}
const active=projects=>projects.filter(p=>p.status!=='archived');
const archived=projects=>projects.filter(p=>p.status==='archived');
const tops=projects=>active(projects).filter(p=>!p.parent_id||!projects.some(parent=>parent.id===p.parent_id));
const kids=(projects,p)=>active(projects).filter(x=>x.parent_id===p.id);
function tree(projects){
  const out=[],seen=new Set();
  const walk=(p,depth)=>{if(seen.has(p.id))return;seen.add(p.id);out.push({project:p,depth});for(const c of kids(projects,p))walk(c,depth+1)};
  for(const p of tops(projects))walk(p,0);
  return out
}
const label=(name,depth)=>depth>0?'　'.repeat(depth)+'↳ '+name:name;

let state={workspaceId:null,userId:null,spaces:[],projects:[],loaded:false},key='',epoch=0,version=0,flight=null;
function publish({workspaceId,userId,spaces}){
  if(!workspaceId||!userId)return snapshot();
  const rows=Array.isArray(spaces)?spaces:[];
  version+=1;
  state={workspaceId,userId,spaces:rows,projects:select(rows),loaded:true};
  const next=JSON.stringify([workspaceId,userId,rows.map(p=>[p.id,p.name,p.parent_id,p.status,p.updated_at,isProject(p)])]);
  if(next!==key){key=next;window.dispatchEvent(new CustomEvent('kptu:project-catalog-updated',{detail:{workspaceId,userId}}))}
  return snapshot()
}
async function fetchSpaces(workspaceId,userId){
  const api=window.KPTURuntime?.api;
  if(typeof api!=='function')throw new Error('Web2 runtime is not ready.');
  return await api(`/rest/v1/app_spaces?workspace_id=eq.${encodeURIComponent(workspaceId)}&owner_id=eq.${encodeURIComponent(userId)}&select=*&order=sort_order.asc,created_at.asc`)||[]
}
async function load({workspaceId,userId,force=false}={}){
  if(!workspaceId||!userId)return snapshot();
  const same=state.loaded&&state.workspaceId===workspaceId&&state.userId===userId;
  if(same&&!force)return snapshot();
  if(flight&&flight.workspaceId===workspaceId&&flight.userId===userId&&!force)return flight.promise;
  const started=epoch,seen=version;
  // A newer publish (e.g. the project screen after a mutation) wins over this slower read.
  const promise=fetchSpaces(workspaceId,userId).then(rows=>started===epoch&&seen===version?publish({workspaceId,userId,spaces:rows}):snapshot()).finally(()=>{if(flight?.promise===promise)flight=null});
  flight={workspaceId,userId,promise};
  return promise
}
function snapshot(){
  const {spaces,projects}=state;
  return {workspaceId:state.workspaceId,userId:state.userId,loaded:state.loaded,spaces,projects,active:active(projects),archived:archived(projects),tops:tops(projects),tree:tree(projects)}
}
// Classifies any project_id reference: visible project, hidden by archive, non-project space, or unknown.
function describe(id){
  if(!id)return {kind:'none',id:null,name:''};
  const visible=tree(state.projects).find(x=>x.project.id===id);
  if(visible)return {kind:'active',id,name:visible.project.name||'',depth:visible.depth,project:visible.project};
  const project=state.projects.find(p=>p.id===id);
  if(project)return {kind:'archived',id,name:project.name||'',project};
  const space=state.spaces.find(p=>p.id===id);
  if(space)return {kind:'legacy',id,name:space.name||'',project:space};
  return {kind:'missing',id,name:''}
}
function reset(){epoch+=1;flight=null;key='';state={workspaceId:null,userId:null,spaces:[],projects:[],loaded:false}}
window.addEventListener('kptu:session-changed',e=>{const next=e.detail?.session?.user?.id||'';if(next&&next===state.userId)return;reset()});
window.KPTUProjectCatalog={isProject,select,active,archived,tops,kids,tree,label,publish,fetchSpaces,load,snapshot,describe,reset};
})();
