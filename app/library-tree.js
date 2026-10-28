// LIB-토글트리 ②(설계 docs/design/library-tree.md 5절): 자료실 목록을 토글 안 토글로 묶는 순수 함수.
// 상태 주인과 그리기는 library-upload.js의 luRenderLibrary 하나다. 이 파일은 노드 목록 만들기·HTML 바꾸기만 하고
// 화면·저장소·네트워크에 닿지 않는다(node --test로 시험).
// 노드 모양(묶기 4가지 공통): {kind:'group'|'folder', key, label, depth, count, kinds, files, children, more, ...}
// source는 나중에 Drive 폴더 보기(DRIVE-자료트리)를 더할 자리다(결정 D10). 지금은 늘 'library'.

import {FOLDER_DEPTH_LIMIT,folderIndent,folderDepthLimitFrom} from './folder-limits.mjs';
export const GROUP_BY=Object.freeze(['project','organization','category','month','folder']);
export const GROUP_LABELS=Object.freeze({project:'프로젝트',organization:'담당조직',category:'분류',month:'월별',folder:'폴더'});
// 결정 D12: 한 토글에 파일이 20개를 넘으면 20개만 보이고 [N건 더].
export const FILE_LIMIT=20;
// 결정 D3 → LIB-폴더100단(10/28): 폴더 안 폴더는 100단까지(DB 트리거가 강제, 화면은 그 이상을 만들지 않음). 숫자는 folder-limits.mjs 한 곳.
export const FOLDER_DEPTH=FOLDER_DEPTH_LIMIT;
// 접힌 줄의 종류 색 점 순서(기존 --ds-file-* 색 + LIB-그림형식의 그림). 최대 6개.
// LIB-정리보충 ⑤(10:41): 웹 페이지 원본(.html, 성명·보도자료 옮겨 올 때 생긴 것)은 '파일' 대신 '웹'.
export const KIND_ORDER=Object.freeze(['HWP','PDF','XLS','DOC','PPT','그림','웹','파일']);
const KIND_DOTS=6;
// 자료 한 건의 파일 형식 글자(자료실 줄의 종류 표시). 확장자를 먼저 보고, 확장자가 없으면 Drive가 알려 준 mime_type을 본다.
const KIND_BY_EXT=Object.freeze({HWP:'HWP',HWPX:'HWP',PDF:'PDF',XLS:'XLS',XLSX:'XLS',DOC:'DOC',DOCX:'DOC',PPT:'PPT',PPTX:'PPT',JPG:'그림',JPEG:'그림',PNG:'그림',GIF:'그림',WEBP:'그림',HEIC:'그림',BMP:'그림',HTML:'웹',HTM:'웹',MHT:'웹',MHTML:'웹'});
const KIND_BY_MIME=Object.freeze([[/^application\/pdf$/,'PDF'],[/hwp|hancom|haansoft/,'HWP'],[/spreadsheet|ms-excel/,'XLS'],[/wordprocessing|msword|google-apps\.document/,'DOC'],[/presentation|powerpoint/,'PPT'],[/^image\//,'그림'],[/^text\/html$|xhtml/,'웹']]);
export function fileKindOf(name,mime){
  const ext=String(name||'').includes('.')?String(name).split('.').pop().toUpperCase():'';
  if(KIND_BY_EXT[ext])return KIND_BY_EXT[ext];
  const type=String(mime||'').toLowerCase();
  return KIND_BY_MIME.find(([re])=>re.test(type))?.[1]||'파일';
}

// 그림 크게 보기 규칙(file-actions.js clickKind가 이 함수 하나를 쓴다): '그림'(fileKindOf)이면서 브라우저가 그릴 수 있는 형식만.
// HEIC·BMP 등 그림이지만 브라우저가 못 그리거나 믿기 어려운 형식은 크게 보기 대신 Drive 열기/내려받기로 간다.
const VIEWABLE_IMAGE=Object.freeze(['JPG','JPEG','PNG','GIF','WEBP']);
export function isViewableImage(name,mime){
  if(fileKindOf(name,mime)!=='그림')return false;
  const ext=String(name||'').includes('.')?String(name).split('.').pop().toUpperCase():'';
  if(KIND_BY_EXT[ext]==='그림')return VIEWABLE_IMAGE.includes(ext);
  const sub=/^image\/([a-z0-9.+-]+)$/i.exec(String(mime||'').trim())?.[1]?.toUpperCase()||'';
  return VIEWABLE_IMAGE.includes(sub);
}
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
function folderForest(folders,frame){return forestOf(folders.filter(f=>(f.project_id||null)===frame))}
// 폴더 보기(LIB-폴더탐색기)는 프로젝트 틀을 보지 않고 parent_id만 따라 한 나무로 잇는다. 상위가 없으면 맨 위.
function forestOf(list){
  const mine=[...list].sort(folderOrder),ids=new Set(mine.map(f=>f.id)),made=new Map();
  for(const f of mine)made.set(f.id,node('folder','f:'+f.id,String(f.name||'이름 없는 폴더'),{id:f.id,projectId:f.project_id||null,parentId:f.parent_id||null}));
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

// 폴더 보기(탐색기): 맨 위 '폴더 밖'(폴더에 안 든 자료, 놓으면 폴더 밖으로) → 폴더 나무. 프로젝트와 무관하게 parent_id만 따른다.
// 자료의 프로젝트 연결은 보지 않는다. 폴더는 비어도 보이고, 거르는 중이면 맞는 파일이 없는 토글을 숨긴다.
export const OUTSIDE_KEY='x:out';
function byFolder(o){
  const {docs,folders=[],items=[],filtering}=o,{roots,byId}=forestOf(folders),outside=node('group',OUTSIDE_KEY,'폴더 밖',{outside:true});
  const where=new Map(items.map(x=>[x.document_id,x.folder_id]));
  for(const d of docs){const fid=where.get(d.id),f=fid?byId.get(fid):null;(f||outside).files.push(d)}
  const list=[outside,...roots];
  list.forEach(n=>finish(n,o.kindOf,o.sortKey));
  if(filtering)return prune(list,()=>false);
  return prune(list,n=>n.kind==='folder'||n.key===OUTSIDE_KEY);
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

// 묶기에 맞는 노드 목록. 담당조직·종류·월별 묶기에는 폴더가 없다(결정 D11). 폴더 묶기는 프로젝트와 무관한 폴더 나무(설계 12절).
export function buildTree(o){
  const groupBy=GROUP_BY.includes(o.groupBy)?o.groupBy:'project';
  return groupBy==='organization'?byOrganization(o):groupBy==='category'?byCategory(o):groupBy==='month'?byMonth(o):groupBy==='folder'?byFolder(o):byProject(o);
}
export function walk(list,fn,parents=[]){for(const n of list){fn(n,parents);walk(n.children,fn,[...parents,n])}}
export function keys(list){const out=[];walk(list,n=>out.push(n.key));return out}
// 거르는 중 펼칠 토글: 맞는 파일이 든 모든 토글(위 단까지).
export function matchedKeys(list){const out=new Set();walk(list,n=>{if(n.count>0)out.add(n.key)});return out}
// 한 자료가 든 토글과 그 위 토글들(열어서 보여 줄 때).
export function pathTo(list,documentId){let found=null;walk(list,(n,parents)=>{if(!found&&n.files.some(d=>d.id===documentId))found=[...parents,n].map(x=>x.key)});return found||[]}

// 노드 목록 → HTML. 접힌 줄은 <details>/<summary>(키보드·터치 기본 지원). 펼침은 isOpen(key)가 정한다.
// fileHtml(d, node)는 지금의 파일 줄(luRowHtml)을 그대로 쓴다. node는 그 줄이 든 토글(종류로 묶었을 때 같은 종류 표를 빼는 데 쓴다).
// menu(n): 그 토글 머리에 ⋯ 버튼을 둘 때 접근성 이름(없으면 버튼 없음). 버튼 누르기는 토글을 여닫지 않는다(그리는 쪽이 막음).
// canDrag(n): 폴더 머리를 끌 수 있게 할지(PC 끌어 놓기). 파일 줄의 끌기는 fileHtml이 정한다.
// emoji: 폴더로 묶었을 때(LIB-폴더보기, 2026-10-28 명진 요청 08:25 ③) ▸ 삼각형 대신 닫힌 📁 / 열린 📂 글자, '폴더 밖'은 🗂 + 흐린 글자.
export function treeHtml(list,{isOpen,showAll,fileHtml,esc,kindKey,menu=null,canDrag=null,pick=null,emoji=false}){
  const head=n=>{
    const dots=n.kinds.map(k=>`<i class="lu-kdot" data-lu-kind="${esc(kindKey(k))}"></i>`).join('');
    const face=emoji&&(n.kind==='folder'||n.key==='x:out');
    const mark=face?(n.key==='x:out'?'<span class="lu-folder-emoji" aria-hidden="true">\u{1F5C2}</span>':'<span class="lu-folder-emoji" aria-hidden="true"><span class="lu-fe-closed">\u{1F4C1}</span><span class="lu-fe-open">\u{1F4C2}</span></span>')
      :n.kind==='folder'?'<svg class="lu-folder-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.999a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'
      :n.color?`<span class="lu-pdot" data-color="${esc(n.color)}"${n.tone?` data-tone="${esc(n.tone)}"`:''} aria-hidden="true"></span>`:'';
    const more=menu?.(n);
    return `<summary class="lu-node-head${face?' lu-node-emoji':''}${face&&n.key==='x:out'?' lu-node-out':''}"${n.depth===0?' data-lu-top':''}${n.kind==='folder'&&canDrag?.(n)?' draggable="true"':''}>${pick?.(n)||''}${mark}<span class="lu-node-name">${esc(n.label)}</span><span class="lu-node-count" aria-label="자료 ${n.count}건">${n.count}</span>${dots?`<span class="lu-kdots" aria-hidden="true">${dots}</span>`:''}${more?`<button type="button" class="icon-btn lu-node-more" data-lu-node-menu="${esc(n.key)}" aria-label="${esc(more)}" aria-expanded="false" aria-haspopup="true">⋯</button>`:''}</summary>`;
  };
  const body=n=>{
    const all=showAll(n.key),files=all?n.files:n.files.slice(0,FILE_LIMIT),rest=n.files.length-files.length;
    return n.children.map(one).join('')+files.map(d=>fileHtml(d,n)).join('')+(rest>0?`<button type="button" class="lu-more-files" data-lu-more="${esc(n.key)}">${rest}건 더</button>`:'');
  };
  const one=n=>`<details class="lu-node" data-lu-node="${esc(n.key)}" data-lu-node-kind="${n.kind}" style="--lu-depth:${folderIndent(n.depth)}"${isOpen(n.key)?' open':''}>${head(n)}<div class="lu-node-body">${body(n)}</div></details>`;
  return list.map(one).join('');
}

// ---- 폴더 편집(LIB-토글트리 ③, 설계 4·6절) — 순수 함수. 저장은 library-upload.js가 기존 소유자 RLS REST로 한다. ----
// 폴더 깊이(맨 위 폴더 = 1)와 그 아래 단 수(자기 포함). DB 트리거가 같은 규칙(3단, 순환 금지, 같은 프로젝트 틀)을 다시 지킨다.
const byIdMap=folders=>new Map(folders.map(f=>[f.id,f]));
export function folderDepth(folders,id){const map=byIdMap(folders);let n=0,cur=map.get(id),seen=new Set();while(cur&&!seen.has(cur.id)){seen.add(cur.id);n++;cur=cur.parent_id?map.get(cur.parent_id):null}return n}
export function folderHeight(folders,id){const kids=folders.filter(f=>f.parent_id===id&&f.id!==id);return 1+(kids.length?Math.max(...kids.map(k=>folderHeight(folders.filter(f=>f.id!==id),k.id))):0)}
export function folderSubtree(folders,id){const out=new Set([id]);let grew=true;while(grew){grew=false;for(const f of folders)if(f.parent_id&&out.has(f.parent_id)&&!out.has(f.id)){out.add(f.id);grew=true}}return out}
const frameOf=f=>f?.project_id||null;
// 같은 상위(같은 틀) 형제, 차례대로.
// free=true(폴더 보기)면 프로젝트 틀을 보지 않고 같은 상위의 형제 전부.
export function folderSiblings(folders,{projectId=null,parentId=null,free=false}){return folders.filter(f=>(free||frameOf(f)===(projectId||null))&&(f.parent_id||null)===(parentId||null)).sort(folderOrder)}
// 새 폴더를 만들 수 있나(상위 폴더 깊이 < 3).
export const canAddChild=(folders,parentId)=>!parentId||folderDepth(folders,parentId)<FOLDER_DEPTH;
// 폴더를 옮길 수 있는 곳: 같은 틀의 맨 위(null) 또는 자기·자기 아래가 아니고 합친 깊이가 FOLDER_DEPTH(100단) 이하인 폴더. 지금 상위는 뺀다.
export function folderMoveTargets(folders,id,free=false){
  const f=folders.find(x=>x.id===id);if(!f)return [];
  const inside=folderSubtree(folders,id),h=folderHeight(folders,id),out=[];
  if(f.parent_id)out.push(null);
  // 트리 차례(맨 위 폴더 → 그 안)로 내놓는다.
  const walkFrame=parent=>{for(const t of folderSiblings(folders,{projectId:frameOf(f),parentId:parent,free})){if(!inside.has(t.id)&&t.id!==f.parent_id&&folderDepth(folders,t.id)+h<=FOLDER_DEPTH)out.push(t.id);if(!inside.has(t.id))walkFrame(t.id)}};walkFrame(null);
  return out;
}
// 새 자리의 sort_order: 맨 아래(가장 큰 값 + 1024).
export const SORT_GAP=1024;
export function nextSortOrder(siblings){return siblings.length?Math.max(...siblings.map(s=>Number(s.sort_order)||0))+SORT_GAP:SORT_GAP}
// 위로·아래로: 바로 옆 형제와 sort_order를 맞바꾼다. 값이 같아 맞바꿔도 차례가 안 바뀌면 그 상위 형제만 1024 간격으로 다시 매긴다.
// 돌려주는 값: [{id, sort_order}] 바꿀 행들(없으면 빈 배열).
export function folderReorderPlan(folders,id,dir,free=false){
  const f=folders.find(x=>x.id===id);if(!f)return [];
  const sib=folderSiblings(folders,{projectId:frameOf(f),parentId:f.parent_id||null,free}),i=sib.findIndex(x=>x.id===id),j=dir==='up'?i-1:i+1;
  if(i<0||j<0||j>=sib.length)return [];
  const a=Number(sib[i].sort_order)||0,b=Number(sib[j].sort_order)||0;
  if(a!==b)return [{id:sib[i].id,sort_order:b},{id:sib[j].id,sort_order:a}];
  const order=sib.map(x=>x.id);[order[i],order[j]]=[order[j],order[i]];
  return order.map((x,k)=>({id:x,sort_order:(k+1)*SORT_GAP})).filter(p=>Number(sib.find(s=>s.id===p.id).sort_order)!==p.sort_order);
}
// TRASH-다른삭제 3단계: 휴지통으로 가는 묶음(그 폴더 + 아래 폴더 전부)의 아래 폴더 수와 그 안 자료 수. 화면 확인 창 글에만 쓴다.
export function folderTrashCounts(folders,items,id){const ids=new Set([id]);let grew=true;while(grew){grew=false;for(const f of folders)if(f.parent_id&&ids.has(f.parent_id)&&!ids.has(f.id)){ids.add(f.id);grew=true}}return {folders:ids.size-1,files:items.filter(x=>ids.has(x.folder_id)).length}}
// 자료실 목록에서 함께 숨길 자료: 연결된 폴더가 지금 보이는 폴더 목록에 없는 자료(그 폴더가 휴지통에 있다). 폴더 목록을 읽지 못했으면 아무것도 숨기지 않는다.
export function documentsInTrashedFolders(folders,items,ready=true){if(!ready)return new Set();const seen=new Set(folders.map(f=>f.id));return new Set(items.filter(x=>x.folder_id&&!seen.has(x.folder_id)).map(x=>x.document_id))}
// 폴더 이름 검사(DB 검사와 같음: 1~40자, 앞뒤 공백·제어문자 없음). 앞뒤 공백은 잘라서 쓴다.
export function cleanFolderName(raw){const name=String(raw??'').replace(/[\u0000-\u001f\u007f]/g,'').trim();return name.length>=1&&[...name].length<=40?name:null}
// DB 거절(23514 + LIB_FOLDER_*)을 일상어로.
export function folderErrorText(e){const m=String(e?.message||'');if(/LIB_FOLDER_DEPTH/.test(m))return `폴더는 ${folderDepthLimitFrom(m)}단까지만 만들 수 있어요.`;if(/LIB_FOLDER_CYCLE/.test(m))return '폴더를 자기 안으로 옮길 수 없어요.';if(/LIB_FOLDER_SCOPE|row-level security|42501/.test(m))return '프로젝트가 다른 폴더로 옮기는 기능은 아직 준비 중이에요. 같은 프로젝트 안에서는 옮길 수 있어요.';if(/name_check|23514/.test(m))return '폴더 이름은 1~40자로 써 주세요.';return '저장하지 못했어요. 잠시 뒤 다시 해 주세요.'}
