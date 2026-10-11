// Existing canonical project classification and hierarchy, shared by Web2 and Drive.
export const isProject=p=>p?.metadata?.project_system==='v2'||Number(p?.metadata?.management_version)===2;
export function select(spaces){
  const rows=Array.isArray(spaces)?spaces:[];
  const included=new Set(rows.filter(isProject).map(x=>x.id));
  let changed=true;
  while(changed){
    changed=false;
    for(const p of rows)if(p.parent_id&&included.has(p.parent_id)&&!included.has(p.id)){included.add(p.id);changed=true}
  }
  return rows.filter(p=>included.has(p.id))
}
export const active=projects=>projects.filter(p=>p.status!=='archived');
export const archived=projects=>projects.filter(p=>p.status==='archived');
export const tops=projects=>active(projects).filter(p=>!p.parent_id||!projects.some(parent=>parent.id===p.parent_id));
export const kids=(projects,p)=>active(projects).filter(x=>x.parent_id===p.id);
export function tree(projects){
  const out=[],seen=new Set();
  const walk=(p,depth)=>{if(seen.has(p.id))return;seen.add(p.id);out.push({project:p,depth});for(const c of kids(projects,p))walk(c,depth+1)};
  for(const p of tops(projects))walk(p,0);
  return out
}

// Basket guidance narrows the visible screen tree to unfinished destinations.
// Keep completed ancestors in the trail; their unfinished children remain visible.
export function basketProjects(projects){
  const trail=[];
  return tree(projects).flatMap(({project,depth})=>{
    trail.length=depth;trail.push(project.name||'이름 없는 프로젝트');
    return ['done','completed'].includes(project.status)?[]:[{id:project.id,name:trail.join(' › ')}];
  });
}
