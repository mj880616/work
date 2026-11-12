// LIB-받는폴더나누기(S60-18, 시안 docs/design/mockups/lib-receive-sort.html): 받는 폴더(잡동사니)에 쌓인 자료를 알맞은 폴더로 나누는 제안 — 순수 규칙.
// 화면·저장·네트워크에 닿지 않는다(node --test). 창은 library-sort.js, 쓰기는 기존 소유자 RLS 표(app_library_folders·app_library_folder_items).
// 제안 차례: ① 지금 규칙(library-tree.js folderSuggestions, AI 없음) ② 못 찾은 것만 서버 AI(ai-assist kind=library_sort)가 기존 폴더 중 고름
// ③ 기존 폴더로 담기 어려우면 새 폴더(이름 + 놓을 자리) 제안 — 같은 이름·같은 자리 새 폴더는 하나로 묶는다. AI는 제안까지, 옮기기·만들기는 [옮기기]를 눌러야.
import {folderSuggestions,cleanFolderName,canAddChild,titleWord} from './library-tree.js';

export const SORT_AI_BATCH=40; // 한 번에 서버 AI에 보내는 자료 수(서버도 같은 수로 거절)
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 받는 폴더 '바로 안'의 자료 단위. listDocs = 목록 계산 뒤 자료(사진 묶음은 한 줄). 사진 묶음은 안 사진이 모두 받는 폴더에 있을 때만 한 단위.
// 단위: {key, ids(실제 자료 id들), title, category, project_id, photoset, doc}
export function receiveUnits(listDocs,items,receiveId){
  if(!receiveId)return [];
  const where=new Map((Array.isArray(items)?items:[]).map(x=>[x?.document_id,x?.folder_id]));
  const out=[];
  for(const d of Array.isArray(listDocs)?listDocs:[]){
    if(!d?.id)continue;
    if(d.photoset){
      const ids=(d.photos||[]).map(p=>p?.id).filter(Boolean);
      if(ids.length&&ids.every(id=>where.get(id)===receiveId))out.push({key:d.id,ids,title:String(d.title||'사진'),category:d.category||null,project_id:d.project_id||null,photoset:true,doc:d});
      continue;
    }
    if(where.get(d.id)===receiveId)out.push({key:d.id,ids:[d.id],title:String(d.title||d.file_name||'자료'),category:d.category||null,project_id:d.project_id||null,photoset:false,doc:d});
  }
  return out;
}
export const receiveCount=(listDocs,items,receiveId)=>receiveUnits(listDocs,items,receiveId).length;

// 고를 수 있는 폴더: 받는 폴더 자신은 빼고(그 안 하위 폴더는 넣음).
export const targetFolders=(folders,receiveId)=>(Array.isArray(folders)?folders:[]).filter(f=>f?.id&&f.id!==receiveId);

// ① 규칙 제안. 받는 폴더 연결을 '폴더 밖'으로 보고 folderSuggestions를 그대로 쓴다(받는 폴더 자신은 후보에서 빠짐).
// 반환 Map(unit.key → 폴더 id).
export function ruleSuggestions(units,{docs=[],items=[],folders=[],receiveId,categoryOf=c=>c}={}){
  const open=targetFolders(folders,receiveId),rest=(Array.isArray(items)?items:[]).filter(x=>x?.folder_id!==receiveId);
  const loose=units.filter(u=>!u.photoset).map(u=>u.doc);
  const hit=folderSuggestions(loose,{docs,items:rest,folders:open,categoryOf});
  const out=new Map();for(const u of units){const f=!u.photoset&&hit.get(u.doc.id);if(f)out.set(u.key,f)}
  return out;
}

// 제안 줄 만들기(①만). AI를 기다리는 줄은 to=null, wait=true.
// 줄: {key, ids, title, kind, checked, to:{folder:id}|{group:gid}|null, why, wait, from:'rule'|'ai'|null}
export function startRows(units,rule){
  return units.map(u=>{const f=rule.get(u.key);return {key:u.key,ids:u.ids,title:u.title,photoset:u.photoset,checked:!!f,to:f?{folder:f}:null,why:f?'같은 낱말로 시작하는 자료가 이 폴더에 있어요':'',wait:!f,from:f?'rule':null}});
}
// 서버 AI에 보낼 자료 id(사진 묶음은 첫 사진 하나), SORT_AI_BATCH개씩.
export function aiBatches(rows){
  const ids=rows.filter(r=>r.wait).map(r=>r.ids[0]).filter(id=>UUID.test(id||''));
  const out=[];for(let i=0;i<ids.length;i+=SORT_AI_BATCH)out.push(ids.slice(i,i+SORT_AI_BATCH));
  return out;
}

// ②③ 서버 답 합치기. answer.items: [{id, folder_id|null, new:{name,parent_id|null}|null, why}]. 서버 답도 다시 검사한다:
// 기존 폴더는 지금 고를 수 있는 폴더일 때만, 새 폴더는 이름 규칙(1~40자)·놓을 자리(고를 수 있는 폴더 또는 맨 위, 100단 안)일 때만.
// 같은 이름·같은 자리의 새 폴더는 한 묶음(gid). 이미 같은 이름 폴더가 그 자리에 있으면 그 폴더로 바꾼다(겹치는 폴더 만들지 않음).
export function mergeAi(rows,groups,answer,{folders=[],receiveId}={}){
  const open=targetFolders(folders,receiveId),ok=new Set(open.map(f=>f.id));
  const byId=new Map();for(const it of Array.isArray(answer?.items)?answer.items:[])if(it&&typeof it.id==='string')byId.set(it.id.toLowerCase(),it);
  const nextRows=rows.map(r=>({...r})),nextGroups=groups.map(g=>({...g}));
  for(const r of nextRows){
    if(!r.wait)continue;
    const it=byId.get(String(r.ids[0]||'').toLowerCase());if(!it)continue;
    const why=typeof it.why==='string'?it.why.trim().slice(0,80):'';
    if(it.folder_id&&ok.has(it.folder_id)){Object.assign(r,{to:{folder:it.folder_id},checked:true,why:why||'AI가 선택한 폴더예요',wait:false,from:'ai'});continue}
    const name=cleanFolderName(it.new?.name),parent=it.new?.parent_id||null;
    if(name&&(parent===null||ok.has(parent))&&canAddChild(folders,parent)){
      const same=open.find(f=>(f.parent_id||null)===parent&&String(f.name).trim()===name);
      if(same){Object.assign(r,{to:{folder:same.id},checked:true,why:why||'AI가 선택한 폴더예요',wait:false,from:'ai'});continue}
      let g=nextGroups.find(x=>x.name===name&&(x.parent||null)===parent);
      if(!g){g={gid:'n'+(nextGroups.length+1),name,parent};nextGroups.push(g)}
      Object.assign(r,{to:{group:g.gid},checked:true,why:why||'맞는 폴더가 없어 새 폴더를 제안해요',wait:false,from:'ai'});
    }
  }
  return {rows:nextRows,groups:nextGroups};
}
// AI를 못 쓰면(실패·한도) 기다리던 줄은 '그대로 둬요'로.
export const settleRows=rows=>rows.map(r=>r.wait?{...r,wait:false,checked:false,to:null}:r);

// 새 폴더 묶음 이름·자리 고치기(같은 묶음을 쓰는 줄 모두에 반영). 이름이 규칙에 맞지 않으면 null.
export function renameGroup(groups,gid,raw){const name=cleanFolderName(raw);if(!name)return null;return groups.map(g=>g.gid===gid?{...g,name}:g)}
export function placeGroup(groups,gid,parent){return groups.map(g=>g.gid===gid?{...g,parent:parent||null}:g)}

// 지금 쓰이는 새 폴더 묶음(체크된 줄이 가리키는 것만 — 체크를 다 풀면 만들지 않음).
export function usedGroups(rows,groups){const used=new Set(rows.filter(r=>r.checked&&r.to?.group).map(r=>r.to.group));return groups.filter(g=>used.has(g.gid))}

// [옮기기] 계획: {create:[묶음], moves:[{folder|group, ids}], count(옮길 줄 수)}. 체크됐고 곳이 정해진 줄만.
export function applyPlan(rows,groups){
  const moves=new Map();let count=0;
  for(const r of rows){
    if(!r.checked||!r.to)continue;
    const k=r.to.folder?'f:'+r.to.folder:'g:'+r.to.group;
    if(!moves.has(k))moves.set(k,{...(r.to.folder?{folder:r.to.folder}:{group:r.to.group}),ids:[]});
    moves.get(k).ids.push(...r.ids);count++;
  }
  return {create:usedGroups(rows,groups),moves:[...moves.values()],count};
}

// 창 위 한 줄: '17개 중 14개는 있는 폴더, 3개는 새 폴더를 제안해요.'
export function sortSummary(rows){
  const total=rows.length,wait=rows.filter(r=>r.wait).length,old=rows.filter(r=>!r.wait&&r.to?.folder).length,neu=rows.filter(r=>!r.wait&&r.to?.group).length,stay=rows.filter(r=>!r.wait&&!r.to).length;
  if(!total)return '받는 폴더에 나눌 자료가 없어요.';
  const parts=[old?`${old}개는 있는 폴더`:'',neu?`${neu}개는 새 폴더`:''].filter(Boolean);
  return `${total}개 중 `+(parts.length?parts.join(', ')+'를 제안해요':'맞는 폴더를 아직 못 찾았어요')+(stay?` · 그대로 둬요 ${stay}개`:'')+(wait?` · 나머지 ${wait}개는 AI가 보고 있어요`:'')+'. 체크한 것만 옮겨요.';
}
// 옮긴 뒤 한 줄.
export const doneText=(moved,made,failed=0)=>`${moved}개를 폴더로 옮겼어요${made?` · 새 폴더 ${made}개`:''}${failed?` · ${failed}개는 옮기지 못했어요`:''} ·`;

// ---- LIB-정돈제안(S61-13, 시안 docs/design/mockups/lib-tidy-suggest.html, 명진 11/13 04:31·04:36 ㅇ) ----
// 자료실 전체(또는 고른 폴더 안)에서 같은 종류인데 폴더가 둘 이상으로 갈라진 자료를 묶음으로 찾는다 — 순수 규칙(AI 없음, 1차).
// 묶음 낱말: 이름에 든 종류 낱말(합의서·회의록·명단 …) 중 맨 뒤 것(한국어 이름은 뒤 낱말이 종류), 없으면 첫 낱말(받는 폴더 나누기와 같은 titleWord).
// 옮길 곳: 그 묶음이 가장 많이 든 폴더(받는 폴더·폴더 밖은 빼고). 마땅한 폴더가 없으면 묶음 낱말 이름의 새 폴더(정돈하는 폴더 안 또는 맨 위).
// 빼는 것: '회의 녹음' 폴더(와 그 안) 자료, 소리 파일(녹음은 자리를 옮기지 않음 — S61-5c). 사진 묶음은 안 사진이 모두 한 자리에 있을 때만 한 단위.
// 체크를 풀어 두는 것: 이름에 다른 종류 낱말이 함께 든 자료(예: 합의서 … 보도자료), 지금 폴더 이름에 이미 그 종류 낱말이 든 자료.

export const TIDY_KIND_WORDS=Object.freeze(['합의서','협약서','협정서','확약서','각서','회의록','회의자료','결과보고','보고서','계획서','요구안','제안서','명단','보도자료','성명서','성명','공문','발제문','자료집','회의결과','속기록','결의문','규약','규정','지침','예산','결산','설문','신청서','안내문','소식지','선전물','교육자료','녹취록']);
export const TIDY_SKIP_FOLDER='회의 녹음';
export const TIDY_MIN=2; // 묶음 하나에 든 자료 수 하한
const AUDIO=/\.(m4a|mp3|wav|ogg|oga|aac|webm|weba|amr|3gp|flac)$/i;
const isAudio=d=>/^audio\//i.test(String(d?.mime_type||''))||AUDIO.test(String(d?.file_name||''));
const clean=t=>String(t||'').replace(/\.[a-z0-9]{2,5}$/i,'');
// 이름에 든 종류 낱말(나오는 차례). '성명서' 안 '성명'처럼 겹치면 긴 것만.
export function kindWords(title){
  const t=clean(title),hits=[];
  for(const w of TIDY_KIND_WORDS){let i=t.indexOf(w);while(i>=0){hits.push({w,i,e:i+w.length});i=t.indexOf(w,i+1)}}
  hits.sort((a,b)=>a.i-b.i||b.e-a.e);
  const out=[];let end=-1;for(const h of hits){if(h.i<end)continue;out.push(h.w);end=h.e}
  return out;
}
export function tidyKey(title){const k=kindWords(title);if(k.length)return k[k.length-1];const w=titleWord(title);return w||''}

// 폴더 id → 그 폴더와 모든 하위 폴더 id(정돈 범위·녹음 폴더 빼기).
function subtree(folders,rootId){const out=new Set([rootId]);let grew=true;while(grew){grew=false;for(const f of folders)if(f?.id&&!out.has(f.id)&&out.has(f.parent_id)){out.add(f.id);grew=true}}return out}

// 정돈 단위: {key, ids, title, from(folder id|null), photoset, doc}. scopeId가 있으면 그 폴더(와 하위) 안만, 없으면 자료실 전체(폴더 밖 포함).
export function tidyUnits(listDocs,items,folders,{scopeId=null}={}){
  const fs=Array.isArray(folders)?folders:[],alive=new Set(fs.map(f=>f?.id));
  const where=new Map((Array.isArray(items)?items:[]).filter(x=>alive.has(x?.folder_id)).map(x=>[x.document_id,x.folder_id]));
  const skip=new Set();for(const f of fs)if(String(f?.name||'').trim()===TIDY_SKIP_FOLDER)for(const id of subtree(fs,f.id))skip.add(id);
  const scope=scopeId?subtree(fs,scopeId):null;
  const ok=from=>!(from&&skip.has(from))&&(!scope||(from&&scope.has(from)));
  const out=[];
  for(const d of Array.isArray(listDocs)?listDocs:[]){
    if(!d?.id)continue;
    if(d.photoset){
      const ids=(d.photos||[]).map(p=>p?.id).filter(Boolean);if(!ids.length)continue;
      const at=new Set(ids.map(id=>where.get(id)??null));if(at.size!==1)continue;
      const from=[...at][0];if(ok(from))out.push({key:d.id,ids,title:String(d.title||'사진'),from,photoset:true,doc:d});
      continue;
    }
    if(isAudio(d))continue;
    const from=where.get(d.id)??null;
    if(ok(from))out.push({key:d.id,ids:[d.id],title:String(d.title||d.file_name||'자료'),from,photoset:false,doc:d});
  }
  return out;
}

// 묶음 찾기. 반환 [{gid, word, total, at:[{folder|null, n}], to:{folder}|{group}, rows:[{key,ids,title,from,checked,note}], mode:'move'}], groups(새 폴더)
// receiveId(받는 폴더)·폴더 밖(null)은 옮길 곳 후보가 아니다(잡동사니에서 꺼내는 것이 목적).
export function tidyGroups(units,{folders=[],receiveId=null,scopeId=null}={}){
  const fs=Array.isArray(folders)?folders:[],byId=new Map(fs.map(f=>[f.id,f])),order=new Map(fs.map((f,i)=>[f.id,i]));
  const buckets=new Map();
  for(const u of units){const w=tidyKey(u.title);if(!w)continue;if(!buckets.has(w))buckets.set(w,[]);buckets.get(w).push(u)}
  const out=[],newGroups=[];
  for(const [word,list] of buckets){
    if(list.length<TIDY_MIN)continue;
    const count=new Map();for(const u of list)count.set(u.from,(count.get(u.from)||0)+1);
    if(count.size<2)continue;
    const at=[...count].map(([folder,n])=>({folder,n})).sort((a,b)=>b.n-a.n||(order.get(a.folder)??-1)-(order.get(b.folder)??-1));
    const best=at.find(x=>x.folder&&x.folder!==receiveId&&!(byId.get(x.folder)&&String(byId.get(x.folder).name).trim()===TIDY_SKIP_FOLDER));
    let to;
    if(best&&best.n>=2)to={folder:best.folder};
    else{
      const parent=scopeId||null,label=list.map(u=>kindWords(u.title)).flat().find(k=>k===word)||word;
      const same=fs.find(f=>(f.parent_id||null)===parent&&String(f.name).trim()===label);
      if(same)to={folder:same.id};else{const g={gid:'t'+(newGroups.length+1),name:label.slice(0,40),parent};newGroups.push(g);to={group:g.gid}}
    }
    const all=list.map(u=>{
      const other=kindWords(u.title).find(k=>k!==word),fromName=String(byId.get(u.from)?.name||'');
      const fits=u.from&&u.from!==receiveId&&fromName.includes(word);
      const note=other?`이름에 '${other}' — 체크 풀어 둠`:fits?'지금 폴더 이름과 맞아 체크 풀어 둠':'';
      return {key:u.key,ids:u.ids,title:u.title,from:u.from,photoset:u.photoset,checked:!note,note};
    });
    const g=retargetGroup({gid:'g:'+word,word,total:list.length,at,all},to);
    if(!g.rows.length)continue;
    out.push({...g,mode:g.rows.some(r=>r.checked)?'move':'keep'});
  }
  out.sort((a,b)=>b.total-a.total||a.word.localeCompare(b.word,'ko'));
  return {groups:out,newGroups:newGroups.filter(g=>out.some(x=>x.to.group===g.gid))};
}

// 묶음의 옮길 곳 바꾸기: 이미 그 폴더에 든 자료는 줄에서 빼고(그대로), 나머지는 줄로(체크 상태는 그대로 유지).
export function retargetGroup(g,to,prev=null){
  const keep=new Map((prev||[]).map(r=>[r.key,r.checked]));
  const rows=g.all.filter(r=>!to.folder||r.from!==to.folder).map(r=>keep.has(r.key)?{...r,checked:keep.get(r.key)}:{...r});
  return {...g,to,rows,stay:g.all.length-rows.length};
}
// [옮기기] 계획: 묶음이 '옮기기'이고 체크된 줄만. moves: [{from|null, folder|group, ids}].
export function tidyPlan(groups,newGroups){
  const moves=new Map(),used=new Set();let count=0;
  for(const g of groups){
    if(g.mode!=='move')continue;
    for(const r of g.rows){
      if(!r.checked)continue;
      const k=(r.from||'-')+'>'+(g.to.folder?'f:'+g.to.folder:'g:'+g.to.group);
      if(!moves.has(k))moves.set(k,{from:r.from||null,...(g.to.folder?{folder:g.to.folder}:{group:g.to.group}),ids:[]});
      moves.get(k).ids.push(...r.ids);count++;
      if(g.to.group)used.add(g.to.group);
    }
  }
  return {create:newGroups.filter(g=>used.has(g.gid)),moves:[...moves.values()],count};
}
// '지금: 임금협약 5 · 성명·보도자료 2 · 폴더 밖 2'
export const tidyAtText=(at,nameOf)=>'지금: '+at.map(x=>`${x.folder?nameOf(x.folder):'폴더 밖'} ${x.n}`).join(' · ');
export function tidySummary(groups,{done=true}={}){
  if(!groups.length)return done?'흩어진 같은 종류 자료를 찾지 못했어요.':'찾는 중…';
  const n=groups.reduce((s,g)=>s+g.rows.length,0);
  return `같은 종류인데 폴더가 갈라진 자료 ${groups.length}묶음(${n}개)을 찾았어요. 묶음마다 고르세요.`;
}
