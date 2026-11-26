// LIB-토글트리 ②(설계 docs/design/library-tree.md 5절): 자료실 목록을 토글 안 토글로 묶는 순수 함수.
// 상태 주인과 그리기는 library-upload.js의 luRenderLibrary 하나다. 이 파일은 노드 목록 만들기·HTML 바꾸기만 하고
// 화면·저장소·네트워크에 닿지 않는다(node --test로 시험).
// 노드 모양(묶기 4가지 공통): {kind:'group'|'folder', key, label, depth, count, files, children, more, ...}
// source는 나중에 Drive 폴더 보기(DRIVE-자료트리)를 더할 자리다(결정 D10). 지금은 늘 'library'.

import {FOLDER_DEPTH_LIMIT,folderIndent,folderDepthLimitFrom} from './folder-limits.mjs';
// FOLDER-나무새기준(S51-12): 폴더 그림(닫힌/열린)·'n개 더 보기' 줄은 노트·파일·사진과 같은 공용 부품(folder-tree-ui.mjs). 점(●)은 그리지 않는다.
import {ftIconHtml,ftMoreRowHtml} from './folder-tree-ui.mjs';
import {treeIconHtml} from './tree-icons.js';
import {emptyHtml} from './wait-state.js';
import {folderFileText,folderFileLabel} from './folder-count.mjs';
import {word as brandWord} from './brand/brand.mjs';
export const GROUP_BY=Object.freeze(['project','organization','category','month','folder']);
export const GROUP_LABELS=Object.freeze({project:brandWord('사업영역'),organization:brandWord('담당조직'),category:'분류',month:'월별',folder:'폴더'});
// 결정 D12: 한 토글에 파일이 20개를 넘으면 20개만 보이고 [N건 더].
export const FILE_LIMIT=20;
// 결정 D3 → LIB-폴더100단(10/28): 폴더 안 폴더는 100단까지(DB 트리거가 강제, 화면은 그 이상을 만들지 않음). 숫자는 folder-limits.mjs 한 곳.
export const FOLDER_DEPTH=FOLDER_DEPTH_LIMIT;
// LIB-정리보충 ⑤(10:41): 웹 페이지 원본(.html, 성명·보도자료 옮겨 올 때 생긴 것)은 '파일' 대신 '웹'.
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

function node(kind,key,label,extra={}){return {kind,key,label,source:'library',depth:0,files:[],children:[],count:0,...extra}}
// 아래에서 위로 자료 수를 모은다(거른 뒤의 수, 결정 D9). 폴더 옆 종류 점(파랑=한글·빨강=PDF 등)은 S51-12에서 화면에서 뺐고 S51-28에서 계산도 뺐다.
function finish(n,sortKey,depth=0){
  n.depth=depth;n.files=sortFiles(n.files,sortKey);
  let count=n.files.length;
  for(const c of n.children){finish(c,sortKey,depth+1);count+=c.count}
  n.count=count;
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
  for(const f of mine)made.set(f.id,node('folder','f:'+f.id,String(f.name||'이름 없는 폴더'),{id:f.id,projectId:f.project_id||null,parentId:f.parent_id||null,fc:Number.isInteger(f.color)&&f.color>=1&&f.color<=8?f.color:null}));
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
  const {docs,tree=[],folders=[],items=[],projectName,filtering}=o;
  const top=[],groups=new Map(),stack=[];
  for(const {project,depth} of tree){
    const g=node('group','p:'+project.id,String(project.name||brandWord('이름 없는 사업영역')),{projectId:project.id,projectDepth:depth});
    groups.set(project.id,g);stack.length=depth;const parent=depth>0?stack[depth-1]:null;stack[depth]=g;(parent?parent.children:top).push(g);
  }
  const stale=[];
  const groupFor=id=>{if(!id)return null;if(groups.has(id))return groups.get(id);const g=node('group','p:'+id,projectName?.(id)||brandWord('[확인할 수 없는 사업영역]'),{projectId:id,projectDepth:0,stale:true});groups.set(id,g);stale.push(g);return g};
  const none=node('group','p:none',brandWord('사업영역 없음'),{projectId:null,projectDepth:0});
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
  list.forEach(n=>finish(n,o.sortKey));
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
  // LIB-정리보충 ②(10:41): 사진 묶음 줄(계산으로 만든 한 줄)은 묶음 안 실제 사진들이 모두 같은 폴더에 있으면 그 폴더 안에, 아니면 폴더 밖에 한 줄로.
  const folderOf=d=>{if(!d?.photoset)return where.get(d.id);const ids=(d.photos||[]).map(p=>where.get(p.id));return ids.length&&ids.every(x=>x&&x===ids[0])?ids[0]:undefined};
  for(const d of docs){const fid=folderOf(d),f=fid?byId.get(fid):null;(f||outside).files.push(d)}
  const list=[outside,...roots];
  list.forEach(n=>finish(n,o.sortKey));
  if(filtering)return prune(list,()=>false);
  // LIB-정리보충(10:34 '폴더 밖은 비우고 싶음'): '폴더 밖'이 비면(0개) 그 줄을 없앤다. 폴더가 하나도 없을 때만 첫 폴더를 만들 자리로 남긴다.
  // 맨 위 새 폴더는 맨 위 폴더 메뉴의 [맨 위에 새 폴더], 폴더 밖으로 빼기는 [폴더로 옮기기 ›]의 [폴더 밖으로]·끄는 동안 왼쪽 팝업이 맡는다.
  return prune(list,n=>n.kind==='folder'||(n.key===OUTSIDE_KEY&&(n.count>0||!roots.length)));
}

function flat(list,o){list.forEach(n=>finish(n,o.sortKey));return list.filter(n=>n.count>0)}
function byOrganization(o){
  const {docs,organizations=[]}=o,known=new Map(organizations.map(x=>[x.id,x])),groups=new Map(),unknown=[];
  for(const x of organizations)groups.set(x.id,node('group','o:'+x.id,String(x.name||brandWord('이름 없는 조직')),{organizationId:x.id}));
  const none=node('group','o:none',brandWord('조직 없음'),{organizationId:null});
  for(const d of docs){
    const id=d.organization_id||null;
    if(!id){none.files.push(d);continue}
    if(!groups.has(id)){const g=node('group','o:'+id,brandWord('[확인할 수 없는 조직]'),{organizationId:id,stale:true});groups.set(id,g);unknown.push(g)}
    groups.get(id).files.push(d);
  }
  return flat([...organizations.map(x=>groups.get(x.id)),...unknown,none].filter(Boolean),o).filter(n=>!n.organizationId||known.has(n.organizationId)||n.stale);
}
function byCategory(o){
  // LIB-소분류: 소분류는 '선전 › 투쟁속보' 이름의 묶음(큰 분류 바로 뒤). 끌어 분류 바꾸기도 그 묶음 이름(전체 이름 값)으로 한다.
  const {docs,categories=[],categoryOf,categoryLabel=name=>name}=o,group=name=>node('group','c:'+name,categoryLabel(name),{category:name}),groups=new Map(categories.map(name=>[name,group(name)]));
  for(const d of docs){const name=categoryOf(d.category);if(!groups.has(name))groups.set(name,group(name));groups.get(name).files.push(d)}
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
  const list=groupBy==='organization'?byOrganization(o):groupBy==='category'?byCategory(o):groupBy==='month'?byMonth(o):groupBy==='folder'?byFolder(o):byProject(o);
  // LIB-받는폴더(S59-11): 받는 폴더로 켠 폴더 줄에 표시(rc). 한 칸·두 칸·왼쪽 나무가 모두 이 표시 하나를 읽어 '받는 폴더'를 붙인다.
  if(o.receiveId)walk(list,n=>{if(n.kind==='folder'&&n.id===o.receiveId)n.rc=true});
  return list;
}
// LIB-폴더개수(명진 11/24 18:04): 폴더 줄 회색 개수 — 하위 폴더가 있으면 '폴더 N · 파일 M'(M = 바로 안 자료, 0이면 '폴더 N'), 없으면 숫자.
// 폴더가 아닌 묶음(사업영역·분류·월·'폴더 밖')은 지금처럼 안의 자료 모두(숫자). 한 칸 목록·탐색기·PC 나무·두 칸이 이 하나를 쓴다.
export function folderCountOf(n){
  if(n?.kind!=='folder')return {text:String(n?.count??0),label:`자료 ${n?.count??0}건`};
  const subs=(n.children||[]).filter(c=>c.kind==='folder').length,files=(n.files||[]).length;
  return {text:folderFileText(subs,files),label:folderFileLabel(subs,files,{fileWord:'자료',unit:'건'})};
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
// emoji: 폴더로 묶었을 때(LIB-폴더보기, 2026-10-28 명진 요청 08:25 ③) ▸ 삼각형 대신 닫힌/열린 폴더 그림, '폴더 밖'은 회색 점선 폴더 그림 + 흐린 글자(S51-25: 그림 문자 🗂은 PC에서 깨짐).
// LIB-외줄합치기없애기(명진 11/26 08:43): 하위 폴더 하나뿐인 폴더도 '가 › 나'로 접지 않는다 — 어디서나 자기 이름·자기 개수, 누르면 안에 하위 폴더.
// LIB-사진숨김(S60-10): isPhoto를 주면 묶음 안 사진은 줄에서 빼고(줄 수·[더 보기]도 사진 뺀 줄 기준) 줄 끝에 photoTail(묶음, 사진들) 하나.
// S69-28 LIB-한칸탐색기(명진 11/24 '윈도우 탐색기처럼'): flat={node}이면 탐색기 오른쪽 칸 — list(그 자리 바로 안 폴더)를 0단 줄(data-lu-enter)로 두고
// (S69-68: 누르면 그 자리 펼치기·접기 — 들어가지 않음), 이어서 node(지금 폴더·맨 위면 '폴더 밖' 묶음)의 자료 줄을 감싸지 않고 그린다.
// 지금 폴더 줄 자신(위치 줄과 겹치는 제목)은 그리지 않는다. 자료 줄 모양·'n개 더 보기'·[사진 n]은 펼친 폴더 안과 같다.
export function treeHtml(list,{isOpen,showAll,fileHtml,esc,menu=null,canDrag=null,pick=null,emoji=false,isPhoto=null,photoTail=null,flat=null}){
  // LIB-받는폴더: 받는 폴더 줄에 작은 '받는 폴더' 표시(시안 ①③).
  const receiveTag=n=>n.rc?'<span class="lu-receive-mark">받는 폴더</span>':'';
  const head=n=>{
    const face=emoji&&(n.kind==='folder'||n.key==='x:out');
    // FOLDER-나무새기준 ③⑥: 폴더는 닫힌/열린 폴더 그림 하나(색을 고른 폴더는 그 색, 안 고른 폴더는 기본 노랑). 펼침에 따라 CSS가 둘 중 하나를 보이고,
    // 안에 아무것도 없는 폴더는 처음부터 닫힌 그림만. '폴더 밖'은 회색 점선 폴더(공용 tree-icons.js) + 흐린 글자. ⑨ 종류 점·색 점은 없다.
    const empty=n.kind==='folder'&&!n.count&&!n.children.length&&!n.files.length;
    const shapes=empty?ftIconHtml({color:n.fc,open:false,className:'ft-ico lu-fe-closed lu-fe-only'}):`${ftIconHtml({color:n.fc,open:false,className:'ft-ico lu-fe-closed'})}${ftIconHtml({color:n.fc,open:true,className:'ft-ico lu-fe-open'})}`;
    // S51-25 FOLDER-세모0: 폴더가 아닌 묶음(사업영역·하위 프로젝트·담당조직·분류·소분류·종류·월)도 펼치는 나무라 세모 대신 같은 열린/닫힌 폴더 그림.
    const mark=face&&n.key==='x:out'?`<span class="lu-folder-emoji lu-folder-shape" aria-hidden="true">${treeIconHtml('outside',{className:'ft-ico'})}</span>`:`<span class="lu-folder-emoji lu-folder-shape" aria-hidden="true">${shapes}</span>`;
    const more=menu?.(n);
    const cnt=folderCountOf(n);
    return `<summary class="lu-node-head lu-node-emoji${face&&n.key==='x:out'?' lu-node-out':''}"${n.depth===0?' data-lu-top':''}${n.kind==='folder'&&canDrag?.(n)?' draggable="true"':''}>${pick?.(n)||''}${mark}<span class="lu-node-name">${esc(n.label)}</span><span class="lu-node-count" aria-label="${esc(cnt.label)}">${esc(cnt.text)}</span>${receiveTag(n)}${more?`<button type="button" class="icon-btn lu-node-more" data-lu-node-menu="${esc(n.key)}" aria-label="${esc(more)}" aria-expanded="false" aria-haspopup="true"><span class="more-dots" aria-hidden="true">⋯</span></button>`:''}</summary>`;
  };
  const filesOf=n=>{
    const rows=isPhoto?n.files.filter(d=>!isPhoto(d)):n.files,photos=isPhoto?n.files.filter(isPhoto):[];
    const all=showAll(n.key),files=all?rows:rows.slice(0,FILE_LIMIT),rest=rows.length-files.length;
    return files.map(d=>fileHtml(d,n)).join('')+(rest>0?ftMoreRowHtml({rest,depth:0,attrs:{'data-lu-more':n.key},hint:n.kind==='folder'}).replace('class="ft-btn ft-row ft-more-row"','class="ft-btn ft-row ft-more-row lu-more-row"'):'')+(photos.length&&photoTail?photoTail(n,photos):'');
  };
  // UI-폴더이름펼치기(명진 11/24 18:09): 폴더 이름 누르기 = 늘 그 자리 펼치기·접기라, 안이 빈 폴더를 펼치면 안에 '빈 폴더' 한 줄(들어가지 않음).
  const emptyIn=n=>n.kind==='folder'&&!n.children.length&&!n.files.length?`<div class="lu-node-empty">${emptyHtml('빈 폴더')}</div>`:'';
  // lazy(탐색기 칸): 접힌 폴더는 안쪽을 그리지 않는다(보이는 줄만 화면에 — 고르기 수·사각형 고르기가 지금처럼). 펼치면 다시 그린다(library-upload.js luOnHeadClick).
  const body=(n,lazy=false)=>n.children.map(c=>one(c,'',lazy)).join('')+filesOf(n)+emptyIn(n);
  const one=(n,top='',lazy=false)=>{const open=isOpen(n.key);return `<details class="lu-node${top?' lu-enter':''}" data-lu-node="${esc(n.key)}" data-lu-node-kind="${n.kind}"${top} style="--lu-depth:${folderIndent(n.depth)}"${open?' open':''}>${head(n)}<div class="lu-node-body">${lazy&&!open?'':body(n,lazy)}</div></details>`};
  // S69-68 UI-오른쪽목록펼치기(명진 11/24 20:09 '노조를 클릭하면 노조가 펼쳐지는거야 거기로 들어가는게 아니고 들어가는건 무조건 왼쪽에서'):
  //  탐색기 오른쪽 칸 폴더 줄도 그 자리에서 펼치기·접기(한 칸 나무와 같은 줄 — 안의 하위 폴더·자료가 들여 보임). 들어가기는 왼쪽 나무·⋯ 첫 줄 [이 폴더로 들어가기]만.
  //  단(depth)은 이 칸 기준 0부터 다시 센다(지금 폴더 줄 자신은 그리지 않으므로). data-lu-enter는 '탐색기 칸 0단 폴더 줄' 표시(고르기·사각형 고르기가 읽음 — 이름은 옛 그대로).
  const shift=(n,d)=>({...n,depth:d,children:(n.children||[]).map(c=>shift(c,d+1))});
  if(flat)return list.map(n=>one(shift(n,0),' data-lu-enter',true)).join('')+(flat.node?filesOf(flat.node):'');
  return list.map(n=>one(n)).join('');
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
export function folderErrorText(e){const m=String(e?.message||'');if(/LIB_PHOTOSET_PARTIAL/.test(m))return e?.partial?'사진 묶음 일부를 되돌리지 못했어요. 목록을 확인해 주세요.':'사진 묶음을 옮기지 못해 그대로 두었어요.';if(/LIB_FOLDER_DEPTH/.test(m))return `폴더는 ${folderDepthLimitFrom(m)}단까지만 만들 수 있어요.`;if(/LIB_FOLDER_CYCLE/.test(m))return '폴더를 자기 안으로 옮길 수 없어요.';if(/LIB_FOLDER_SCOPE|row-level security|42501/.test(m))return brandWord('사업영역이 다른 폴더로 옮기는 기능은 아직 준비 중이에요. 같은 사업영역 안에서는 옮길 수 있어요.');if(/name_check|23514/.test(m))return '폴더 이름은 1~40자로 써 주세요.';return '저장하지 못했어요. 잠시 뒤 다시 해 주세요.'}

// LIB-정리보충 ③(2026-10-28 10:41): '폴더 밖' 자료의 폴더 추천(AI 쓰지 않음). 이미 폴더에 든 자료 중
// 제목 첫 낱말(흔한 말 '자료·파일·사본' 등과 숫자는 건너뜀)이 같은 자료가 든 폴더만 후보이고, 분류·프로젝트가 같으면 1점씩 더한다.
// 가장 높은 점수의 폴더가 하나뿐일 때만 추천(헷갈리면 추천하지 않음).
const COMMON_WORDS=new Set(['자료','파일','문서','사본','복사본','최종','수정','수정본','첨부','붙임','new','copy','file']);
export const titleWord=t=>String(t||'').replace(/\.[a-z0-9]{2,5}$/i,'').split(/[\s_\-·.,()[\]{}<>「」『』"'~]+/).map(w=>w.toLowerCase()).find(w=>w.length>=2&&!/^\d+$/.test(w)&&!COMMON_WORDS.has(w))||'';
// S68-16(명진 11/22 14:45 '폴더로 나누기 제안 못하는 것들'): 첫 낱말이 똑같은 자료만 보던 규칙이 날짜 앞붙이('20261113 …')·대괄호('[취재요청]…')·
// 붙은 낱말('제8차노사정')·회사 이름이 앞에 오는 제목을 못 맞췄다. 그래서 ㉠ 제목을 정리(날짜·괄호 번호·대괄호 떼기)하고
// ㉡ 폴더 이름이 제목 안에 들어 있으면 그 폴더('제8차노사정' ⊃ '노사정'), ㉢ 아니면 같은 첫 낱말이거나 같은 회차 낱말('제7차노사정'·'제8차노사정' → '노사정')·
// 같은 낱말 둘 이상이 든 자료가 있는 폴더를 고른다. 헷갈리면(같은 점수 둘 이상) 여전히 추천하지 않는다.
const DATE_RE=/(?:(?:19|20)\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?)|(?:(?<!\d)(?:19|20)\d{6}(?!\d))|(?:(?<!\d)\d{6}(?!\d))|(?:(?:19|20)\d{2}\s*년)|(?:(?<!\d)\d{1,2}\s*월\s*\d{1,2}\s*일)/g;
const SPLIT_RE=/[\s_\-·.,()[\]{}<>「」『』"'~!?:;/\\|&+=*#@%^`’‘“”…]+/;
const ORDINAL_RE=/^(?:제?\d+(?:차|회|호|기|번째|번|부|편|탄))+/;
// 제목 정리: 확장자·날짜·끝 괄호 번호 '(2)'를 떼고, 대괄호 안 말은 낱말로 남긴다('[취재요청]철도' → '취재요청 철도').
export function cleanTitle(t){
  return String(t||'').replace(/\.[a-z0-9]{2,5}$/i,'').replace(/\s*\(\s*\d+\s*\)\s*$/,'').replace(DATE_RE,' ').replace(/[[\]【】〔〕]/g,' ').replace(/\s+/g,' ').trim();
}
// 제목 낱말: [{w, series}] — series는 '제8차노사정'에서 회차를 뗀 '노사정'처럼 회차 앞붙이를 떼어 생긴 낱말.
function titleTokens(t){
  const out=[];
  for(const raw of cleanTitle(t).split(SPLIT_RE)){
    const w=raw.toLowerCase();if(!w||/^\d+$/.test(w)||/^제?\d+(?:차|회|호|기|번째|번|부|편|탄)$/.test(w))continue;
    const s=w.replace(ORDINAL_RE,'');
    if(s!==w&&s.length>=2&&!COMMON_WORDS.has(s)){out.push({w:s,series:true});continue}
    if(w.length>=2&&!COMMON_WORDS.has(w))out.push({w,series:false});
  }
  return out;
}
const compact=t=>cleanTitle(t).replace(/\s+/g,'').toLowerCase();
// S69-12(명진 11/24 08:09 '본부 집행위가 아닌 다른 단체 회의 자료를 집행위 폴더로 옮겨 버림'): 제목의 '임자'(단체·회의체) 낱말.
// 종류 낱말(kinds: 회의자료·합의서 …)을 떼고 날짜·회차('43차')·숫자·흔한 말을 건너뛴 첫 낱말이다 — 이름 목록을 코드에 두지 않고 제목에서만 뽑는다.
// '43차 본부집행위원회 회의자료' → '본부집행위원회', '다른협의회 6차대표자회의자료' → '다른협의회'. 없으면 ''.
export function titleSubject(t,kinds=[]){
  let s=cleanTitle(t);
  for(const k of [...kinds].sort((a,b)=>b.length-a.length))if(k)s=s.split(k).join(' ');
  return titleTokens(s)[0]?.w||'';
}
// 같은 임자인지: '위원회'와 줄임 '위'는 같게 보고('본부집행위원회' = '본부집행위'), 한쪽이 다른 쪽의 앞부분이면 같게 본다('본부' ⊂ '본부집행위').
export const subjectKey=s=>String(s||'').toLowerCase().replace(/\s+/g,'').replace(/위원회$/,'위');
export function sameSubject(a,b){
  const x=subjectKey(a),y=subjectKey(b);if(!x||!y)return false;
  return x===y||([...x].length>=2&&[...y].length>=2&&(x.startsWith(y)||y.startsWith(x)));
}
// 폴더 이름이 임자 안에 들어 있는지('집행위' ⊂ '본부집행위원회'). 두 글자 이상 이름만.
export function subjectHasName(subject,name){
  const s=String(subject||'').toLowerCase(),k=subjectKey(subject),n=String(name||'').toLowerCase().replace(/\s+/g,'');
  return [...n].length>=2&&!!s&&(s.includes(n)||k.includes(subjectKey(n)));
}
// 폴더의 '주인 임자': 그 폴더 자료 임자 중 가장 많은 것(2개 이상이고 다음 것보다 많을 때만). [{folder, subject}] → Map(폴더 → 임자).
export function folderHomes(entries){
  const by=new Map();
  for(const e of entries){if(!e?.folder||!e.subject)continue;const k=subjectKey(e.subject);if(!by.has(e.folder))by.set(e.folder,new Map());const m=by.get(e.folder),c=m.get(k)||{raw:e.subject,n:0};c.n++;m.set(k,c)}
  const out=new Map();
  for(const [f,m] of by){const top=[...m.values()].sort((a,b)=>b.n-a.n);if(top[0].n>=2&&(!top[1]||top[0].n>top[1].n))out.set(f,top[0].raw)}
  return out;
}
// 폴더 이름 조각: 이름 전체(띄어쓰기 없앰)와 '·, /' 등으로 나눈 조각. 흔한 말·숫자·날짜뿐인 이름·한 글자는 뺀다.
function folderNameParts(name){
  const all=String(name||'').toLowerCase(),out=new Set();
  for(const p of [all,...all.split(/[·,/&+|]|\s및\s/)]){const c=p.replace(/\s+/g,'');if([...c].length>=2&&!COMMON_WORDS.has(c)&&!/^\d+(?:년|월|일|차|호)?$/.test(c))out.add(c)}
  return [...out];
}
const WHY_NAME=name=>`제목에 폴더 이름 '${String(name).slice(0,20)}' 포함`;
export const WHY_FIRST='같은 낱말로 시작하는 자료가 이 폴더에 있어요';
export const WHY_LIKE='비슷한 제목의 자료가 이 폴더에 있어요';
// 반환 Map(자료 id → {folder, why}). folderSuggestions는 폴더 id만.
export function folderSuggestionReasons(outside,{docs=[],items=[],folders=[],categoryOf=c=>c,kinds=[]}={}){
  const alive=new Set(folders.map(f=>f.id)),where=new Map(items.filter(x=>alive.has(x.folder_id)).map(x=>[x.document_id,x.folder_id]));
  const parentOf=new Map(folders.map(f=>[f.id,f.parent_id||null]));
  const isAncestor=(a,b)=>{let c=parentOf.get(b),g=0;while(c&&g++<FOLDER_DEPTH+2){if(c===a)return true;c=parentOf.get(c)}return false};
  const named=folders.filter(f=>f?.id).map(f=>({id:f.id,name:f.name,parts:folderNameParts(f.name)})).filter(f=>f.parts.length);
  const inside=docs.filter(d=>!d?.photoset&&where.has(d.id)).map(d=>{const t=d.title||d.file_name,tk=titleTokens(t);return {folder:where.get(d.id),first:tk[0]?.w||'',words:new Set(tk.map(x=>x.w)),series:new Set(tk.filter(x=>x.series).map(x=>x.w)),category:categoryOf(d.category),project:d.project_id||null}});
  // S69-12: 폴더 이름이 제목에 들었어도 그 폴더 자료의 임자(단체·회의체)가 이 자료와 다르면 그 폴더로 보내지 않는다
  // ('다른협의회 3차집행위원회회의자료'는 '본부집행위원회' 자료가 든 '집행위' 폴더가 아니다). 임자가 같거나 폴더 이름이 임자 안에 있으면 그대로.
  const homes=folderHomes(docs.filter(d=>!d?.photoset&&where.has(d.id)).map(d=>({folder:where.get(d.id),subject:titleSubject(d.title||d.file_name,kinds)})));
  const out=new Map();
  for(const d of outside){
    if(!d||d.photoset||where.has(d.id))continue;
    const t=d.title||d.file_name,tk=titleTokens(t),c=compact(t),subj=titleSubject(t,kinds);
    // ㉡ 폴더 이름이 제목 안에: 가장 긴 이름이 이긴다. 같은 길이면 더 안쪽(하위) 폴더, 그래도 둘 이상이면 아래 ㉢이 가린다.
    // 제목 낱말과 통째로 같은 이름 조각은 반 점 더(낱말 안에 우연히 든 '국가철도공단' ⊃ '철도'보다 따로 쓴 '교섭'이 이긴다).
    const whole=new Set(tk.map(x=>x.w));let hits=[];
    for(const f of named){const len=Math.max(0,...f.parts.filter(p=>c.includes(p)).map(p=>[...p].length+(whole.has(p)?0.5:0)));if(len)hits.push({id:f.id,name:f.name,len})}
    if(hits.length){const top=Math.max(...hits.map(h=>h.len));hits=hits.filter(h=>h.len===top);hits=hits.filter(h=>!hits.some(o=>o!==h&&isAncestor(h.id,o.id)))}
    if(hits.length===1){
      const home=homes.get(hits[0].id);
      if(!(subj&&home&&!sameSubject(subj,home)&&!subjectHasName(subj,hits[0].name))){out.set(d.id,{folder:hits[0].id,why:WHY_NAME(hits[0].name)});continue}
      hits=[];
    }
    // ㉢ 비슷한 자료가 든 폴더.
    if(!tk.length)continue;
    const first=tk[0].w,words=new Set(tk.map(x=>x.w)),series=tk.filter(x=>x.series).map(x=>x.w),category=categoryOf(d.category),project=d.project_id||null,best=new Map();
    for(const x of inside){
      const same=x.first===first,like=series.some(w=>x.series.has(w))||[...words].filter(w=>x.words.has(w)).length>=2;
      if(!same&&!like)continue;
      const score=2+(category&&x.category===category?1:0)+(project&&x.project===project?1:0),why=same?WHY_FIRST:WHY_LIKE;
      const prev=best.get(x.folder);if(!prev||score>prev.score||(score===prev.score&&same&&prev.why!==WHY_FIRST))best.set(x.folder,{score,why});
    }
    const top=Math.max(0,...[...best.values()].map(v=>v.score));if(top<2)continue;
    let winners=[...best].filter(([,v])=>v.score===top);
    if(hits.length>1){const inHits=winners.filter(([f])=>hits.some(h=>h.id===f));if(inHits.length)winners=inHits}
    if(winners.length===1)out.set(d.id,{folder:winners[0][0],why:winners[0][1].why});
  }
  return out;
}
export function folderSuggestions(outside,opts={}){return new Map([...folderSuggestionReasons(outside,opts)].map(([k,v])=>[k,v.folder]))}
