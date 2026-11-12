// LIB-받는폴더나누기(S60-18, 시안 docs/design/mockups/lib-receive-sort.html): 받는 폴더(잡동사니)에 쌓인 자료를 알맞은 폴더로 나누는 제안 — 순수 규칙.
// 화면·저장·네트워크에 닿지 않는다(node --test). 창은 library-sort.js, 쓰기는 기존 소유자 RLS 표(app_library_folders·app_library_folder_items).
// 제안 차례: ① 지금 규칙(library-tree.js folderSuggestions, AI 없음) ② 못 찾은 것만 서버 AI(ai-assist kind=library_sort)가 기존 폴더 중 고름
// ③ 기존 폴더로 담기 어려우면 새 폴더(이름 + 놓을 자리) 제안 — 같은 이름·같은 자리 새 폴더는 하나로 묶는다. AI는 제안까지, 옮기기·만들기는 [옮기기]를 눌러야.
import {folderSuggestions,cleanFolderName,canAddChild} from './library-tree.js';

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
    if(it.folder_id&&ok.has(it.folder_id)){Object.assign(r,{to:{folder:it.folder_id},checked:true,why:why||'AI가 고른 폴더예요',wait:false,from:'ai'});continue}
    const name=cleanFolderName(it.new?.name),parent=it.new?.parent_id||null;
    if(name&&(parent===null||ok.has(parent))&&canAddChild(folders,parent)){
      const same=open.find(f=>(f.parent_id||null)===parent&&String(f.name).trim()===name);
      if(same){Object.assign(r,{to:{folder:same.id},checked:true,why:why||'AI가 고른 폴더예요',wait:false,from:'ai'});continue}
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
  return `${total}개 중 `+(parts.length?parts.join(', ')+'를 제안해요':'맞는 폴더를 아직 못 찾았어요')+(stay?` · 그대로 둬요 ${stay}개`:'')+(wait?` · 나머지 ${wait}개 찾는 중`:'')+'. 체크한 것만 옮겨요.';
}
// 옮긴 뒤 한 줄.
export const doneText=(moved,made,failed=0)=>`${moved}개를 폴더로 옮겼어요${made?` · 새 폴더 ${made}개`:''}${failed?` · ${failed}개는 옮기지 못했어요`:''} ·`;
