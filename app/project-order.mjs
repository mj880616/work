// PRJ-순서바꾸기: the one project order (docs/design/project-3-levels.md 6절). app_spaces.sort_order (lower first, empty last,
// as the read's sort_order.asc), then created_at, then the order the rows came in (a stable sort). project-catalog.js sorts its rows with it once, so every list built
// from the catalog (tops, kids, tree, options, basketProjects) — the project screen, 기록할 곳, 할 일 연결, 업무일지, 주간 정리 —
// shows siblings in the same order. Kept apart from project-catalog-model.mjs, whose copy the drive-summary Edge Function ships.
const rank=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?Infinity:Number(v);
export function compareOrder(a,b){
  const x=rank(a?.sort_order),y=rank(b?.sort_order);
  if(x!==y)return x<y?-1:1;
  const p=String(a?.created_at||''),q=String(b?.created_at||'');
  return p===q?0:p<q?-1:1;
}
export const ordered=rows=>[...(Array.isArray(rows)?rows:[])].sort(compareOrder);
// The active projects beside p under the same parent (p included), in the shared order. A project whose parent is not among
// the projects stands with the top projects, as in the catalog's tops().
export function siblings(projects,p){
  if(!p)return [];
  const list=Array.isArray(projects)?projects:[];
  const top=x=>!x.parent_id||!list.some(y=>y.id===x.parent_id);
  return ordered(list.filter(x=>x.status!=='archived'&&(top(p)?top(x):x.parent_id===p.parent_id)));
}
// Moves project `id` to position `to` (0-based, clamped) among its siblings. Returns the sort_order writes [{id, sort_order}]
// for the new order (siblings renumbered 10, 20, 30, …; a row already at its number is not written), or [] when nothing
// moves. Only siblings change and parent_id is never written, so the 3단 rule and its trigger are not involved.
export function reorderPlan(projects,id,to){
  const p=(Array.isArray(projects)?projects:[]).find(x=>x.id===id);
  const row=siblings(projects,p),from=row.findIndex(x=>x.id===id);
  if(from<0)return [];
  const target=Math.max(0,Math.min(row.length-1,Math.trunc(Number(to))||0));
  if(target===from)return [];
  const next=row.slice();next.splice(from,1);next.splice(target,0,p);
  return next.map((x,i)=>({id:x.id,sort_order:(i+1)*10})).filter((w,i)=>rank(next[i].sort_order)!==w.sort_order);
}
