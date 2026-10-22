// LIB-토글트리 ②(설계 docs/design/library-tree.md 5절): 자료실 목록을 토글 안 토글로 묶는 순수 함수.
// 상태 주인과 그리기는 library-upload.js의 luRenderLibrary 하나다. 이 파일은 노드 목록 만들기·HTML 바꾸기만 하고
// 화면·저장소·네트워크에 닿지 않는다(node --test로 시험).
// 노드 모양(묶기 4가지 공통): {kind:'group'|'folder', key, label, depth, count, kinds, files, children, more, ...}
// source는 나중에 Drive 폴더 보기(DRIVE-자료트리)를 더할 자리다(결정 D10). 지금은 늘 'library'.

export const GROUP_BY=Object.freeze(['project','organization','category','month']);
export const GROUP_LABELS=Object.freeze({project:'프로젝트',organization:'담당조직',category:'종류',month:'월별'});
// 결정 D12: 한 토글에 파일이 20개를 넘으면 20개만 보이고 [N건 더].
export const FILE_LIMIT=20;
// 결정 D3: 폴더 안 폴더는 3단까지(DB 트리거가 강제, 화면은 그 이상을 만들지 않음).
export const FOLDER_DEPTH=3;
// 접힌 줄의 종류 색 점 순서(기존 --ds-file-* 색). 최대 5개.
export const KIND_ORDER=Object.freeze(['HWP','PDF','XLS','DOC','PPT','파일']);
const KIND_DOTS=5;

const byKey=(a,b)=>a.key===b.key?a.i-b.i:!a.key?1:!b.key?-1:a.key<b.key?1:-1;
// 파일 순서(결정 D6): 날짜 최신순(자료 날짜 → 올린 날), 같으면 받은 순서.
export function sortFiles(files,sortKey){return files.map((d,i)=>({d,i,key:sortKey(d)})).sort(byKey).map(x=>x.d)}
const folderOrder=(a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id));

function node(kind,key,label,extra={}){return {kind,key,label,source:'library',depth:0,files:[],children:[],count:0,kinds:[],...extra}}
// 아래에서 위로 자료 수·종류를 모은다(거른 뒤의 수, 결정 D9).
function finish(n,kindOf,sortKey,depth=0){
  n.depth=depth;n.files=sortFiles(n.files,sortKey);
  const kinds=new Set(n.files.map(d=>kindOf(d)));let count=n.files.length;
  for(const c of n.children){finish(c,kindOf,sortKey,depth+1);count+=c.count;c.kinds.forEach(k=>kinds.add(k))}
  n.count=count;n.kinds=KIND_ORDER.filter(k=>kinds.has(k)).slice(0,KIND_DOTS);
  return n;
}
const hasFolder=n=>n.kind==='folder'||n.children.some(hasFolder);
// 거르는 중이면 맞는 파일이 없는 토글·폴더를 숨긴다. 아니면 keep(n)이 남길 빈 토글을 정한다.
function prune(list,keep){return list.filter(n=>{n.children=prune(n.children,keep);return n.count>0||keep(n)})}

// 폴더 나무: 같은 프로젝트 틀(project_id, 비어 있으면 '프로젝트 없음')의 폴더를 parent_id로 잇는다.
// 상위가 없거나 다른 틀이면 맨 위로 둔다. 순환이 섞여 들어와도(DB가 막지만) 한 번만 그린다.
function folderForest(folders,frame){
  const mine=folders.filter(f=>(f.project_id||null)===frame).sort(folderOrder),ids=new Set(mine.map(f=>f.id)),made=new Map();
  for(const f of mine)made.set(f.id,node('folder','f:'+f.id,String(f.name||'이름 없는 폴더'),{id:f.id,projectId:frame,parentId:f.parent_id||null}));
  const roots=[];
  for(const f of mine){const n=made.get(f.id),parent=f.parent_id&&ids.has(f.parent_id)&&f.parent_id!==f.id?made.get(f.parent_id):null;(parent?parent.children:roots).push(n)}
  // 순환 고리 안의 폴더는 roots에 닿지 않는다: 닿지 않은 폴더를 맨 위로 올린다.
  const seen=new Set(),walk=n=>{if(seen.has(n.key))return;seen.add(n.key);n.children.forEach(walk)};roots.forEach(walk);
  for(const n of made.values())if(!seen.has(n.key)){for(const m of made.values())m.children=m.children.filter(c=>c!==n);roots.push(n);walk(n)}
  return {roots,byId:made};
}

// 프로젝트 묶기: 1단 프로젝트(프로젝트 화면 순서) → 2·3단 → 그 프로젝트의 폴더 → 파일. 보관·옛 공간·확인 불가 연결은
// 활성 프로젝트 뒤에 따로 두고, 맨 아래 '프로젝트 없음'. 폴더 연결이 자료의 프로젝트와 어긋나면 연결이 없는 것으로 본다(설계 3.2).
function byProject(o){
  const {docs,tree=[],folders=[],items=[],projectName,colorOf,filtering}=o;
  const top=[],groups=new Map(),stack=[];
  for(const {project,depth} of tree){
    const g=node('group','p:'+project.id,String(project.name||'이름 없는 프로젝트'),{projectId:project.id,projectDepth:depth,...(colorOf?.(project)||{})});
    groups.set(project.id,g);stack.length=depth;const parent=depth>0?stack[depth-1]:null;stack[depth]=g;(parent?parent.children:top).push(g);
  }
  const stale=[];
  const groupFor=id=>{if(!id)return null;if(groups.has(id))return groups.get(id);const g=node('group','p:'+id,projectName?.(id)||'[확인할 수 없는 프로젝트]',{projectId:id,projectDepth:0,stale:true});groups.set(id,g);stale.push(g);return g};
  const none=node('group','p:none','프로젝트 없음',{projectId:null,projectDepth:0});
  const frames=new Map();
  const frameOf=pid=>{const key=pid||null;if(!frames.has(key))frames.set(key,folderForest(folders,key));return frames.get(key)};
  for(const pid of new Set(folders.map(f=>f.project_id||null))){const g=pid?groupFor(pid):none,{roots}=frameOf(pid);g.children.push(...roots)}
  const where=new Map(items.map(x=>[x.document_id,x.folder_id]));
  for(const d of docs){
    const pid=d.project_id||null,g=pid?groupFor(pid):none,fid=where.get(d.id),folder=fid?frameOf(pid).byId.get(fid):null;
    (folder||g).files.push(d);
  }
  // 하위 프로젝트 토글보다 폴더가 뒤에 오도록(2·3단 → 폴더 → 파일).
  const order=n=>{n.children.sort((a,b)=>(a.kind==='folder')-(b.kind==='folder'));n.children.forEach(order)};
  const list=[...top,...stale,none];list.forEach(order);
  list.forEach(n=>finish(n,o.kindOf,o.sortKey));
  if(filtering)return prune(list,()=>false);
  // 1단 프로젝트와 '프로젝트 없음'은 늘 보인다. 빈 하위 프로젝트는 숨기고(폴더가 있으면 남김), 폴더는 비어도 보인다.
  return prune(list,n=>n.kind==='folder'||hasFolder(n)||(n.kind==='group'&&!n.stale&&n.projectDepth===0));
}

function flat(list,o){list.forEach(n=>finish(n,o.kindOf,o.sortKey));return list.filter(n=>n.count>0)}
function byOrganization(o){
  const {docs,organizations=[]}=o,known=new Map(organizations.map(x=>[x.id,x])),groups=new Map(),unknown=[];
  for(const x of organizations)groups.set(x.id,node('group','o:'+x.id,String(x.name||'이름 없는 조직'),{organizationId:x.id}));
  const none=node('group','o:none','조직 없음',{organizationId:null});
  for(const d of docs){
    const id=d.organization_id||null;
    if(!id){none.files.push(d);continue}
    if(!groups.has(id)){const g=node('group','o:'+id,'[확인할 수 없는 조직]',{organizationId:id,stale:true});groups.set(id,g);unknown.push(g)}
    groups.get(id).files.push(d);
  }
  return flat([...organizations.map(x=>groups.get(x.id)),...unknown,none].filter(Boolean),o).filter(n=>!n.organizationId||known.has(n.organizationId)||n.stale);
}
function byCategory(o){
  const {docs,categories=[],categoryOf}=o,groups=new Map(categories.map(name=>[name,node('group','c:'+name,name,{category:name})]));
  for(const d of docs){const name=categoryOf(d.category);if(!groups.has(name))groups.set(name,node('group','c:'+name,name,{category:name}));groups.get(name).files.push(d)}
  return flat([...groups.values()],o);
}
function byMonth(o){
  const {docs,sortKey,monthLabel}=o,groups=new Map();
  for(const d of docs){const key=String(sortKey(d)||'').slice(0,7);if(!groups.has(key))groups.set(key,node('group','m:'+(key||'none'),monthLabel(key),{month:key||null}));groups.get(key).files.push(d)}
  return flat([...groups.values()].sort((a,b)=>!a.month?1:!b.month?-1:a.month<b.month?1:-1),o);
}

// 묶기에 맞는 노드 목록. 담당조직·종류·월별 묶기에는 폴더가 없다(결정 D11).
export function buildTree(o){
  const groupBy=GROUP_BY.includes(o.groupBy)?o.groupBy:'project';
  return groupBy==='organization'?byOrganization(o):groupBy==='category'?byCategory(o):groupBy==='month'?byMonth(o):byProject(o);
}
export function walk(list,fn,parents=[]){for(const n of list){fn(n,parents);walk(n.children,fn,[...parents,n])}}
export function keys(list){const out=[];walk(list,n=>out.push(n.key));return out}
// 거르는 중 펼칠 토글: 맞는 파일이 든 모든 토글(위 단까지).
export function matchedKeys(list){const out=new Set();walk(list,n=>{if(n.count>0)out.add(n.key)});return out}
// 한 자료가 든 토글과 그 위 토글들(열어서 보여 줄 때).
export function pathTo(list,documentId){let found=null;walk(list,(n,parents)=>{if(!found&&n.files.some(d=>d.id===documentId))found=[...parents,n].map(x=>x.key)});return found||[]}

// 노드 목록 → HTML. 접힌 줄은 <details>/<summary>(키보드·터치 기본 지원). 펼침은 isOpen(key)가 정한다.
// fileHtml(d)는 지금의 파일 줄(luRowHtml)을 그대로 쓴다.
export function treeHtml(list,{isOpen,showAll,fileHtml,esc,kindKey}){
  const head=n=>{
    const dots=n.kinds.map(k=>`<i class="lu-kdot" data-lu-kind="${esc(kindKey(k))}"></i>`).join('');
    const mark=n.kind==='folder'?'<svg class="lu-folder-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.999a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'
      :n.color?`<span class="lu-pdot" data-color="${esc(n.color)}"${n.tone?` data-tone="${esc(n.tone)}"`:''} aria-hidden="true"></span>`:'';
    return `<summary class="lu-node-head">${mark}<span class="lu-node-name">${esc(n.label)}</span><span class="lu-node-count" aria-label="자료 ${n.count}건">${n.count}</span>${dots?`<span class="lu-kdots" aria-hidden="true">${dots}</span>`:''}</summary>`;
  };
  const body=n=>{
    const all=showAll(n.key),files=all?n.files:n.files.slice(0,FILE_LIMIT),rest=n.files.length-files.length;
    return n.children.map(one).join('')+files.map(fileHtml).join('')+(rest>0?`<button type="button" class="lu-more-files" data-lu-more="${esc(n.key)}">${rest}건 더</button>`:'');
  };
  const one=n=>`<details class="lu-node" data-lu-node="${esc(n.key)}" data-lu-node-kind="${n.kind}" style="--lu-depth:${Math.min(n.depth,6)}"${isOpen(n.key)?' open':''}>${head(n)}<div class="lu-node-body">${body(n)}</div></details>`;
  return list.map(one).join('');
}
