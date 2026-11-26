// LIB-받는폴더나누기(S60-18, 시안 docs/design/mockups/lib-receive-sort.html): 받는 폴더(잡동사니)에 쌓인 자료를 알맞은 폴더로 나누는 제안 — 순수 규칙.
// 화면·저장·네트워크에 닿지 않는다(node --test). 창은 library-sort.js, 쓰기는 기존 소유자 RLS 표(app_library_folders·app_library_folder_items).
// 제안 차례: ① 지금 규칙(library-tree.js folderSuggestions, AI 없음) ② 못 찾은 것만 서버 AI(ai-assist kind=library_sort)가 기존 폴더 중 고름
// ③ 기존 폴더로 담기 어려우면 새 폴더(이름 + 놓을 자리) 제안 — 같은 이름·같은 자리 새 폴더는 하나로 묶는다. AI는 제안까지, 옮기기·만들기는 [옮기기]를 눌러야.
import {learnModel,nearestFolder,learnWhy,pickWhy,folderPath} from './library-learn-model.mjs';
import {folderSuggestionReasons,cleanFolderName,canAddChild,titleWord,fileKindOf,cleanTitle,titleSubject,subjectKey,sameSubject,subjectHasName,folderHomes} from './library-tree.js';

// S68-16: 40개 한 묶음은 답이 올 때까지(최대 75초) 모든 줄이 '⋯'였다. 10개씩 차례로 보내 묶음마다 줄이 바로 채워지게 한다
// (서버 상한 40개는 그대로, 하루 횟수·월 예산 검사도 그대로 — 묶음 하나가 한 번으로 잡힌다).
export const SORT_AI_BATCH=10;
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
// 반환 Map(unit.key → 폴더 id). 까닭 글까지 필요하면 ruleReasons(unit.key → {folder, why}).
// S69-16: 먼저 본보기(library-learn-model.mjs — 이미 폴더에 든 내 자료와 가장 닮은 폴더). 닮은 폴더가 하나면 {folder, why:'닮은 자료: …', learn:true},
// 비슷한 폴더가 여럿이면 {folder:null, pick:true, why}(고르기 — AI에도 보내지 않음), 닮음이 약하면 아래 옛 규칙(낱말·이름) → 그다음 AI.
// auto: 정돈·나누기가 옮겨 두고 사람이 손대지 않은 자료 id(본보기 무게를 낮춤).
export function ruleReasons(units,{docs=[],items=[],folders=[],receiveId,categoryOf=c=>c,auto=null}={}){
  const open=targetFolders(folders,receiveId),rest=(Array.isArray(items)?items:[]).filter(x=>x?.folder_id!==receiveId);
  const learned=learnReasons(units,{docs,items:rest,folders,targets:open.filter(f=>String(f.name||'').trim()!==TIDY_SKIP_FOLDER).map(f=>f.id),auto});
  const loose=units.filter(u=>!u.photoset&&!learned.has(u.key)).map(u=>u.doc);
  const hit=folderSuggestionReasons(loose,{docs,items:rest,folders:open,categoryOf,kinds:TIDY_KIND_WORDS});
  const out=new Map();for(const u of units){const l=learned.get(u.key);if(l){out.set(u.key,l);continue}const f=!u.photoset&&hit.get(u.doc.id);if(f)out.set(u.key,f)}
  return out;
}
export function ruleSuggestions(units,opts={}){return new Map([...ruleReasons(units,opts)].filter(([,v])=>v.folder).map(([k,v])=>[k,v.folder]))}

// S69-16: 정돈·나누기가 옮겨 두고 사람이 아직 손대지 않은 자료 id — 옮긴 기록(S69-12 app_library_move_log, 30일)의 '옮긴 폴더'에 지금도 있는 자료.
// 사람이 그 뒤 손으로 다른 폴더로 옮겼으면 빠진다(그 자리는 사람이 고른 자리라 본보기 무게 그대로). batches: library-sort.js moveBatches 결과.
export function autoMovedIds(batches,items){
  const at=new Map((Array.isArray(items)?items:[]).map(x=>[x?.document_id,x?.folder_id])),out=new Set();
  for(const b of Array.isArray(batches)?batches:[])for(const r of b?.rows||[])if(r?.document_id&&r.to&&at.get(r.document_id)===r.to)out.add(r.document_id);
  return out;
}
// 본보기 판정(받는 폴더 나누기·정돈 제안 공용). items: 본보기로 쓸 연결(받는 폴더 연결은 부르는 쪽이 뺌). 반환 Map(unit.key → 판정 글).
const pathTail=(folders,id)=>folderPath(folders,id).slice(-2).join(' › ');
export function learnReasons(units,{docs=[],items=[],folders=[],targets=null,auto=null}={}){
  const byDoc=new Map((Array.isArray(docs)?docs:[]).map(d=>[d?.id,d])),alive=new Set((Array.isArray(folders)?folders:[]).map(f=>f?.id));
  const examples=(Array.isArray(items)?items:[]).filter(x=>alive.has(x?.folder_id)&&byDoc.has(x.document_id)).map(x=>{const d=byDoc.get(x.document_id);return {key:x.document_id,title:d.title||d.file_name,folder:x.folder_id,category:d.category||null,auto:!!auto?.has?.(x.document_id)}});
  const out=new Map();
  // 폴더에 든 자료가 하나도 없으면(처음 쓰는 사람) 본보기 없음 — 옛 규칙(폴더 이름 포함 찾기)에 맡긴다.
  if(!examples.length)return out;
  const model=learnModel(examples,folders,{targets});
  // S69-12와 같은 막이: 제목 앞 임자(단체·회의체)가 그 폴더 주인 임자와 다르면 그 폴더는 고르지 않는다('회의자료'처럼 흔한 말만 닮은 경우).
  const homes=folderHomes(examples.map(e=>({folder:e.folder,subject:tidySubject(e.title)})));
  const nameOf=id=>String((folders||[]).find(f=>f?.id===id)?.name||'');
  // 막이를 조금 푸는 경우: 이 임자가 주인인 폴더가 하나도 없으면(예: 사람이 그 자료들을 손으로 다른 폴더에 옮겨 섞어 둠) 같은 임자 자료가 든 폴더는 막지 않는다.
  const bySubj=new Map();for(const e of examples){const t=tidySubject(e.title);if(!t)continue;if(!bySubj.has(e.folder))bySubj.set(e.folder,[]);bySubj.get(e.folder).push({key:e.key,s:t})}
  for(const u of Array.isArray(units)?units:[]){
    const subject=tidySubject(u.title),self=new Set(u.ids||[u.key]);
    const strict=!!subject&&[...homes.values()].some(h=>sameSubject(h,subject));
    const veto=subject?id=>{const h=homes.get(id);if(!h||sameSubject(h,subject)||subjectHasName(subject,nameOf(id)))return false;return strict||!(bySubj.get(id)||[]).some(x=>!self.has(x.key)&&sameSubject(x.s,subject))}:null;
    const r=nearestFolder(model,{title:u.title,category:u.doc?.category||u.category||null},{exclude:new Set(u.ids||[u.key]),veto});
    if(r.state==='move')out.set(u.key,{folder:r.folder,why:learnWhy(r.why),learn:true,like:r.why});
    else if(r.state==='pick')out.set(u.key,{folder:null,pick:true,alt:r.alt,why:pickWhy(r.alt,id=>pathTail(folders,id)),learn:true});
  }
  return out;
}

// 근거 없는 자료: 그림(사진 묶음 포함)인데 이름이 '붙여넣은 그림 11-13 03:38'·'IMG_1234'·'스크린샷'처럼 기본 이름뿐인 것.
// S68-18(사용자 11/22 15:32): 이름에 주제가 없어도 그림 속 글자(서버가 Drive OCR로 읽어 둔 app_documents.extracted_text, AI 비용 없음)가 있으면
// 그 글자로 ① 규칙(글자 앞부분에 폴더 이름 포함·비슷한 제목)을 먼저 보고, 못 찾으면 ② AI에 보낸다(서버 library_sort가 그 글자 앞 300자를 이미 재료로 씀).
// 이름도 기본이고 그림 글자도 없을 때만 근거 없음 — AI에 보내지 않고 그림 모음 폴더(imageHome)를 제안한다.
const GENERIC_IMAGE=/붙여\s*넣은|그림|사진|이미지|스크린\s*샷|화면\s*캡처|캡처|캡쳐|제목\s*없음|카카오톡|screenshot|screen\s*shot|image|img|photo|pic|pasted|kakaotalk|untitled|dsc|pxl|jpe?g|png|heic|webp|gif|\d+/gi;
export const WHY_NO_BASIS='근거 없음 — 직접 선택';
export const WHY_IMAGES='근거가 없어 그림끼리 모아요';
export const WHY_IMAGES_AI='AI도 맞는 폴더를 찾지 못해 그림끼리 모아요';
export const WHY_IMAGES_READING='그림 글자를 읽기 시작했어요 — 지금은 그림끼리 모아요(다시 열면 글자로 찾아요)';
export const IMAGE_FOLDER_NAME='그림 모음';
export const SORT_TEXT_HEAD=100; // 규칙에 쓰는 그림 글자 앞부분(글자 전체로 폴더 이름을 찾으면 우연히 든 낱말에 걸린다)
export const SORT_OCR_MAX=6;     // 창을 열 때 아직 안 읽은 그림 글자 읽기를 맡기는 수(Drive OCR, AI 비용 없음)
export const isImageUnit=u=>!!u&&(u.photoset||fileKindOf(u.doc?.file_name||u.title,u.doc?.mime_type)==='그림');
// 이름이 기본 이름뿐인 그림(글자 확인 전).
export function genericImage(u){
  if(!isImageUnit(u))return false;
  const rest=cleanTitle(u.title).replace(GENERIC_IMAGE,' ').split(/[\s_\-·.,()[\]{}<>:;'"~!?/\\|&+=*#@%^]+/).filter(w=>[...w].length>=2);
  return !rest.length;
}
const hasText=t=>typeof t==='string'&&/[A-Za-z가-힣]{2,}/.test(t); // 숫자·기호뿐인 글자는 근거가 아니다
// text: 그 자료의 그림 글자(없으면 빈 값). 기본 이름이고 글자도 없을 때만 근거 없음.
export const noBasis=(u,text='')=>genericImage(u)&&!hasText(text);

// 그림 글자가 필요한 자료(기본 이름 그림)의 실제 자료 id들(사진 묶음은 안 사진 모두).
export const textIdsFor=units=>[...new Set(units.filter(genericImage).flatMap(u=>u.ids))];
// 서버에서 읽은 행 [{id, extracted_text, extraction_status, file_name, mime_type}] → {texts: Map(unit.key → 글자), read:[아직 안 읽은 JPEG·PNG 자료 id, SORT_OCR_MAX개까지]}.
// 사진 묶음은 안 사진 중 글자가 있는 첫 사진의 글자, 그 사진 id를 aiId로(AI에 그 사진을 보내야 서버가 그 글자를 읽는다).
const OCR_OK=/\.(jpe?g|png)$/i;
export function textsFrom(units,rows){
  const byId=new Map((Array.isArray(rows)?rows:[]).filter(r=>r?.id).map(r=>[String(r.id).toLowerCase(),r]));
  const texts=new Map(),aiIds=new Map(),read=[];
  for(const u of units){
    if(!genericImage(u))continue;
    for(const id of u.ids){
      const r=byId.get(String(id).toLowerCase());if(!r)continue;
      if(r.extraction_status==='ready'&&hasText(r.extracted_text)){texts.set(u.key,String(r.extracted_text));aiIds.set(u.key,id);break}
      const unread=!['ready','error'].includes(r.extraction_status),ocr=OCR_OK.test(String(r.file_name||''))||/^image\/(jpeg|png)$/i.test(String(r.mime_type||''));
      if(unread&&ocr&&read.length<SORT_OCR_MAX&&!read.includes(id))read.push(id);
    }
  }
  return {texts,aiIds,read};
}
// 그림 글자 앞부분을 제목처럼 써서 ① 규칙. 반환 Map(unit.key → {folder, why}) — 까닭 앞에 '그림 글자: '.
export function textReasons(units,texts,{docs=[],items=[],folders=[],receiveId,categoryOf=c=>c}={}){
  const open=targetFolders(folders,receiveId),rest=(Array.isArray(items)?items:[]).filter(x=>x?.folder_id!==receiveId);
  const fake=units.filter(u=>texts.has(u.key)).map(u=>({id:'t:'+u.key,title:String(texts.get(u.key)).replace(/\s+/g,' ').trim().slice(0,SORT_TEXT_HEAD),category:u.category,project_id:u.project_id}));
  const hit=folderSuggestionReasons(fake,{docs,items:rest,folders:open,categoryOf,kinds:TIDY_KIND_WORDS});
  const out=new Map();for(const f of fake){const v=hit.get(f.id);if(v)out.set(f.id.slice(2),{folder:v.folder,why:'그림 글자: '+v.why})}
  return out;
}

// 그림 모음 폴더: ㉠ 이름에 그림·사진·이미지·스크린샷·캡처가 든 기존 폴더(둘 이상이면 그림이 더 많이 든 것, 같으면 앞 차례)
// ㉡ 아니면 든 자료가 3개 이상이고 80% 이상이 그림인 폴더(그림이 많은 것) ㉢ 없으면 null(→ 새 폴더 '그림 모음'을 맨 위에 제안 — 새 폴더 기본 자리와 같음).
// 받는 폴더 자신·'회의 녹음' 폴더는 빼고, 놓을 수 있는 폴더(targetFolders)만.
const IMAGE_FOLDER_RE=/그림|사진|이미지|스크린\s*샷|캡처|캡쳐|photo|image|picture/i;
export function imageHome({docs=[],items=[],folders=[],receiveId}={}){
  const open=targetFolders(folders,receiveId).filter(f=>String(f.name||'').trim()!==TIDY_SKIP_FOLDER),byDoc=new Map((Array.isArray(docs)?docs:[]).filter(d=>d?.id).map(d=>[d.id,d]));
  const stat=new Map(open.map(f=>[f.id,{n:0,img:0}]));
  for(const x of Array.isArray(items)?items:[]){const st=stat.get(x?.folder_id);if(!st)continue;const d=byDoc.get(x.document_id);if(!d||d.photoset)continue;st.n++;if(fileKindOf(d.file_name||d.title,d.mime_type)==='그림')st.img++}
  const pick=list=>list.map((f,i)=>({f,i,img:stat.get(f.id).img})).sort((a,b)=>b.img-a.img||a.i-b.i)[0]?.f.id||null;
  const named=open.filter(f=>IMAGE_FOLDER_RE.test(String(f.name||'')));
  if(named.length)return pick(named);
  return pick(open.filter(f=>{const st=stat.get(f.id);return st.n>=3&&st.img/st.n>=0.8}));
}
// 근거 없는 그림 줄(또는 AI도 못 고른 그림 줄)에 그림 모음 폴더 제안. home = 기존 폴더 id 또는 null(새 폴더 '그림 모음', 맨 위).
// 체크는 기본 꺼짐(근거가 약하니 사람이 고른다). 같은 새 폴더는 한 묶음 — AI가 같은 이름·같은 자리를 제안했으면 그 묶음을 함께 쓴다.
export function imageFallback(rows,groups,home,{why=WHY_IMAGES,only=null,folders=[]}={}){
  const nextGroups=groups.map(g=>({...g}));let gid=null;
  const target=()=>{
    if(home)return {folder:home};
    const same=(Array.isArray(folders)?folders:[]).find(f=>!f.parent_id&&String(f.name).trim()===IMAGE_FOLDER_NAME);
    if(same)return {folder:same.id};
    if(!gid){let g=nextGroups.find(x=>x.name===IMAGE_FOLDER_NAME&&(x.parent||null)===null);if(!g){g={gid:'img',name:IMAGE_FOLDER_NAME,parent:null};nextGroups.push(g)}gid=g.gid}
    return {group:gid};
  };
  const nextRows=rows.map(r=>{
    if(r.wait||r.to||!r.image||(only&&!only(r)))return r;
    return {...r,to:target(),checked:false,why:typeof why==='function'?why(r):why,from:'image'};
  });
  return {rows:nextRows,groups:nextGroups};
}

// 제안 줄 만들기(①만). AI를 기다리는 줄은 to=null, wait=true.
// 줄: {key, ids, title, image, checked, to:{folder:id}|{group:gid}|null, why, wait, from:'rule'|'ai'|'image'|null, aiId?}
// rule 값은 폴더 id 또는 {folder, why}. texts(unit.key → 그림 글자)·aiIds(unit.key → 그 글자가 든 사진 id).
// 근거 없는 자료(noBasis)는 기다리지 않고 곳 없음(nb) — 창이 imageFallback으로 그림 모음 폴더를 붙인다.
export function startRows(units,rule,{texts=new Map(),aiIds=new Map()}={}){
  return units.map(u=>{
    const v=rule.get(u.key),f=typeof v==='string'?v:v?.folder||null,why=typeof v==='object'&&v?.why?v.why:'같은 낱말로 시작하는 자료가 이 폴더에 있어요';
    const base={key:u.key,ids:u.ids,title:u.title,photoset:u.photoset,image:isImageUnit(u),...(aiIds.has(u.key)?{aiId:aiIds.get(u.key)}:{})};
    if(f)return {...base,checked:true,to:{folder:f},why,wait:false,from:v?.learn?'learn':'rule'};
    // S69-16 비슷한 폴더가 여럿: 고르기(체크 없음, AI에도 보내지 않음).
    if(v?.pick)return {...base,checked:false,to:null,why,wait:false,from:'learn',pick:true};
    const nb=noBasis(u,texts.get(u.key));
    return {...base,checked:false,to:null,why:nb?WHY_NO_BASIS:'',wait:!nb,from:null,...(nb?{nb:true}:{})};
  });
}
// AI에 보내는 자료 id(사진 묶음은 그림 글자가 든 사진, 없으면 첫 사진).
export const aiIdOf=r=>r?.aiId||r?.ids?.[0];
// 서버 AI에 보낼 자료 id(사진 묶음은 그림 글자가 든 사진, 없으면 첫 사진 — aiIdOf), SORT_AI_BATCH개씩.
export function aiBatches(rows){
  const ids=rows.filter(r=>r.wait).map(aiIdOf).filter(id=>UUID.test(id||''));
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
    const it=byId.get(String(aiIdOf(r)||'').toLowerCase());if(!it)continue;
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
// AI를 못 쓰면(실패·한도) 기다리던 줄은 '그대로 둬요'로. why를 주면 그 줄에 까닭 한 줄.
// ids를 주면 그 자료(줄의 첫 id)가 든 줄만 — 묶음 하나가 실패·건너뜀이면 그 묶음 줄만 바로 넘긴다(영원히 '⋯' 없음).
export const settleRows=(rows,why='',ids=null)=>{const only=ids?new Set(ids):null;return rows.map(r=>r.wait&&(!only||only.has(aiIdOf(r)))?{...r,wait:false,checked:false,to:null,...(why?{why}:{})}:r)};
// 묶음 답 뒤 한 줄 까닭: 성공했는데 그 줄 답이 없으면 AI도 못 고른 것, 실패면 코드별.
export const WHY_AI_NONE='AI도 맞는 폴더를 찾지 못했어요';
export function aiFailWhy(code){
  if(code==='skipped:no_folders')return '옮길 폴더가 없어요';
  if(code==='ai_timeout')return 'AI 답이 늦어 건너뛰었어요 — 직접 선택';
  if(code==='daily_limit'||code==='monthly_limit'||code==='ai_monthly_cap')return 'AI 사용 한도 — 직접 선택';
  return 'AI 답을 받지 못했어요 — 직접 선택';
}
// 이 실패면 남은 묶음도 보내지 않는다(한도·로그인·연결 문제는 다음 묶음도 같다). 그 밖(늦음·바쁨·답 모양 틀림)은 다음 묶음을 계속 보낸다.
export const AI_STOP_CODES=Object.freeze(['daily_limit','monthly_limit','ai_monthly_cap','session_required','auth_unavailable','not_ready','offline','ai_not_configured','invalid_request']);
export const aiShouldStop=(code,failsInRow)=>AI_STOP_CODES.includes(code)||failsInRow>=2;

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
// progress {done, total}: 서버 AI에 보낸 자료 중 답이 온 수 / 보낼 전체 수 — 머리줄에 'AI가 보고 있어요(10/34)'.
export function sortSummary(rows,progress=null){
  const total=rows.length,wait=rows.filter(r=>r.wait).length,old=rows.filter(r=>!r.wait&&r.to?.folder).length,neu=rows.filter(r=>!r.wait&&r.to?.group).length,stay=rows.filter(r=>!r.wait&&!r.to).length;
  if(!total)return '받는 폴더에 나눌 자료가 없어요.';
  const parts=[old?`${old}개는 있는 폴더`:'',neu?`${neu}개는 새 폴더`:''].filter(Boolean);
  return `${total}개 중 `+(parts.length?parts.join(', ')+'를 제안해요':'맞는 폴더를 아직 못 찾았어요')+(stay?` · 그대로 둬요 ${stay}개`:'')+(wait?` · 나머지 ${wait}개는 AI가 보고 있어요${progress?.total?`(${Math.min(progress.done,progress.total)}/${progress.total})`:''}`:'')+'. 체크한 것만 옮겨요.';
}
// 옮긴 뒤 한 줄.
export const doneText=(moved,made,failed=0)=>`${moved}개를 폴더로 옮겼어요${made?` · 새 폴더 ${made}개`:''}${failed?` · ${failed}개는 옮기지 못했어요`:''} ·`;

// ---- LIB-정돈제안(S61-13, 시안 docs/design/mockups/lib-tidy-suggest.html, 사용자 11/13 04:31·04:36 ㅇ) ----
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

// S69-12(사용자 11/24 08:09): 묶음은 종류 낱말 하나가 아니라 '임자(단체·회의체) + 종류'로 만든다.
// 예전에는 '본부집행위원회 회의자료'와 '다른협의회 대표자회의자료'가 모두 '회의자료' 한 묶음이 되어 가장 많이 든 폴더(집행위)로 갔다.
// 임자는 제목에서만 뽑는다(library-tree.js titleSubject — 단체 이름 목록을 코드에 두지 않음).
export const tidySubject=title=>titleSubject(title,TIDY_KIND_WORDS);
const lastKind=title=>{const k=kindWords(title);return k.length?k[k.length-1]:''};
export function tidyLabel(subject,kind){return [subject,kind].filter(Boolean).join(' ').slice(0,40)}

// 묶음 찾기. 반환 {groups:[{gid, word, total, at:[{folder|null, n}], to:{folder}|{group}, rows, all, stay, mode, split?}], newGroups(새 폴더)}
// ① 흩어진 묶음: 같은 임자·같은 종류인데 폴더가 둘 이상으로 갈라진 자료. 옮길 곳은 그 묶음이 가장 많이 든 폴더 — 단, 그 폴더의 주인 임자가 같을 때만.
//    아니면 '임자 종류' 이름의 같은 폴더, 그것도 없으면 그 이름의 새 폴더.
// ② 섞인 묶음(폴더 안 정돈일 때만): 폴더 주인 임자와 다른 임자의 자료를 임자별로. 같은 임자 자료가 모인 다른 폴더(또는 이름에 그 임자가 든 폴더)가 있으면 '옮기기',
//    없으면 그 폴더 옆 새 폴더(임자 이름) 제안이되 기본은 '그대로'(애매하면 옮기지 않음 — 사용자가 골라 옮김).
// receiveId(받는 폴더)·폴더 밖(null)은 옮길 곳 후보가 아니다(잡동사니에서 꺼내는 것이 목적). allUnits: 주인 임자를 셀 때 쓰는 자료실 전체 단위(없으면 units).
// S69-16: ⓪ 본보기 먼저 — 폴더 밖·받는 폴더 자료는 이미 폴더에 든 내 자료와 가장 닮은 폴더로(묶음 'e:폴더', 줄마다 '닮은 자료: …').
//    비슷한 폴더가 여럿이면 '고르기' 묶음('p:…', 기본 '그대로'), 닮음이 약하면 아래 ①②의 옛 규칙으로 넘긴다. auto: learnReasons와 같음.
export function tidyGroups(units,{folders=[],receiveId=null,scopeId=null,allUnits=null,auto=null}={}){
  const fs=Array.isArray(folders)?folders:[],byId=new Map(fs.map(f=>[f.id,f])),order=new Map(fs.map((f,i)=>[f.id,i]));
  const subj=new Map(),every=[...(allUnits||units)];for(const u of [...units,...every])if(!subj.has(u.key))subj.set(u.key,tidySubject(u.title));
  const homes=folderHomes(every.filter(u=>u.from).map(u=>({folder:u.from,subject:subj.get(u.key)})));
  const nameOf=id=>String(byId.get(id)?.name||'').trim();
  const usable=id=>id&&id!==receiveId&&byId.has(id)&&nameOf(id)!==TIDY_SKIP_FOLDER;
  // 그 폴더가 이 임자의 자리인지: 주인 임자가 같거나, 주인 임자가 없고(섞였거나 적음) 폴더 이름이 임자 안에 있거나 임자가 없는 묶음.
  const agrees=(id,s)=>{const h=homes.get(id);if(!s)return true;if(h)return sameSubject(h,s);return subjectHasName(s,nameOf(id))};
  const out=[],newGroups=[],taken=new Set();
  const examples=every.filter(u=>u.from&&usable(u.from));
  const lctx={docs:examples.map(u=>({id:u.key,title:u.title,category:u.doc?.category||null})),items:examples.map(u=>({document_id:u.key,folder_id:u.from})),folders:fs,targets:fs.filter(f=>usable(f.id)).map(f=>f.id),auto:auto?new Set(examples.filter(u=>u.ids.some(id=>auto.has(id))).map(u=>u.key)):null};
  {
    const loose=units.filter(u=>!u.from||u.from===receiveId);
    const learned=loose.length&&examples.length?learnReasons(loose,lctx):new Map();
    const lg=new Map();
    for(const u of loose){
      const l=learned.get(u.key);if(!l)continue;
      const gid=l.pick?'p:'+l.alt.join(','):'e:'+l.folder;
      if(!lg.has(gid))lg.set(gid,{gid,word:l.pick?'비슷한 폴더 여럿':nameOf(l.folder),pick:!!l.pick,alt:l.alt||[],to:{folder:l.pick?l.alt[0]:l.folder},all:[]});
      lg.get(gid).all.push({key:u.key,ids:u.ids,title:u.title,from:u.from,photoset:u.photoset,checked:!l.pick,note:l.why});
      taken.add(u.key);
    }
    for(const x of lg.values()){
      const count=new Map();for(const r of x.all)count.set(r.from,(count.get(r.from)||0)+1);
      const at=[...count].map(([folder,n])=>({folder,n}));
      const g=retargetGroup({gid:x.gid,word:x.word,total:x.all.length,at,all:x.all,learn:true,...(x.pick?{pick:true,alt:x.alt}:{})},x.to);
      if(g.rows.length)out.push({...g,mode:x.pick?'keep':'move'});
    }
  }
  const buckets=new Map();
  for(const u of units){
    if(taken.has(u.key))continue;
    const s=subj.get(u.key),k=lastKind(u.title),sk=subjectKey(s);if(!sk&&!k)continue;
    const key=sk+'|'+k;if(!buckets.has(key))buckets.set(key,{kind:k,raw:new Map(),list:[]});
    const b=buckets.get(key);b.list.push(u);if(s)b.raw.set(s,(b.raw.get(s)||0)+1);
  }
  // 같은 자리에 같은 이름 폴더가 있으면 그 폴더('임자 종류' 이름, 또는 종류·임자 이름만인 폴더 — 그 폴더 주인 임자가 다르지 않을 때).
  const newFolder=(label,parent,alts=[],s='')=>{const here=fs.filter(f=>(f.parent_id||null)===parent);const same=here.find(f=>String(f.name).trim()===label)||alts.filter(Boolean).map(a=>here.find(f=>String(f.name).trim()===a&&usable(f.id)&&(!s||!homes.get(f.id)||sameSubject(homes.get(f.id),s)))).find(Boolean);if(same)return {folder:same.id};const g={gid:'t'+(newGroups.length+1),name:label,parent};newGroups.push(g);return {group:g.gid}};
  // S69-16: 사람이 이미 폴더에 넣어 둔 자료가 그 폴더 본보기와 가장 닮았으면(자기 자신은 빼고 계산) 그 자리는 사람이 고른 자리 — 흩어진 묶음에서 체크를 풀어 둔다.
  const placed=[...buckets.values()].flatMap(b=>b.list.length>=TIDY_MIN?b.list.filter(u=>u.from&&usable(u.from)):[]);
  const here=placed.length?learnReasons(placed,lctx):new Map();
  const fitsHere=u=>{const l=here.get(u.key);return !!l&&(l.folder===u.from||!!l.alt?.includes(u.from))};
  // 사람이 넣어 둔 자료: 새 폴더로 가는 묶음에서는 체크하지 않고(폴더 밖·받는 폴더 자료만), 본보기가 옮길 폴더 아닌 다른 폴더를 가리켜도 체크하지 않는다.
  const pointsTo=(u,to)=>{if(!u.from||u.from===receiveId||!usable(u.from))return true;if(!to.folder)return false;const l=here.get(u.key);return !(l?.folder&&l.folder!==to.folder)};
  for(const [key,b] of buckets){
    const list=b.list;if(list.length<TIDY_MIN)continue;
    const count=new Map();for(const u of list)count.set(u.from,(count.get(u.from)||0)+1);
    if(count.size<2)continue;
    const subject=[...b.raw].sort((x,y)=>y[1]-x[1])[0]?.[0]||'',word=tidyLabel(subject,b.kind)||key;
    const at=[...count].map(([folder,n])=>({folder,n})).sort((a,b)=>b.n-a.n||(order.get(a.folder)??1e9)-(order.get(b.folder)??1e9));
    const best=at.find(x=>usable(x.folder)&&x.n>=2&&agrees(x.folder,subject));
    const to=best?{folder:best.folder}:newFolder(word,scopeId||null,[b.kind,subject],subject);
    const all=list.map(u=>{
      const other=kindWords(u.title).find(k=>k!==b.kind),fromName=nameOf(u.from);
      const fits=u.from&&u.from!==receiveId&&((b.kind&&fromName.includes(b.kind))||(subject&&subjectHasName(subject,fromName)&&agrees(u.from,subject)));
      const note=other?`이름에 '${other}' — 체크 풀어 둠`:fits?'지금 폴더 이름과 맞아 체크 풀어 둠':fitsHere(u)?'지금 폴더의 자료와 닮아 체크 풀어 둠':!pointsTo(u,to)?'닮은 자료가 옮길 곳에 없어 체크 풀어 둠':'';
      return {key:u.key,ids:u.ids,title:u.title,from:u.from,photoset:u.photoset,checked:!note,note};
    });
    const g=retargetGroup({gid:'g:'+word,word,total:list.length,at,all},to);
    if(!g.rows.length)continue;
    for(const r of g.rows)taken.add(r.key);
    out.push({...g,mode:g.rows.some(r=>r.checked)?'move':'keep'});
  }
  if(scopeId){
    const inScope=new Set(units.map(u=>u.from).filter(Boolean));
    for(const fid of inScope){
      // 주인 임자: 가장 많은 임자(동률이면 없음) — 없으면 폴더 이름이 든 임자 중 가장 많은 것('집행위' 폴더 → '본부집행위원회').
      let home=homes.get(fid);
      if(!home){const c=new Map();for(const u of units){const s=subj.get(u.key);if(u.from===fid&&s&&subjectHasName(s,nameOf(fid))){const k=subjectKey(s),x=c.get(k)||{raw:s,n:0};x.n++;c.set(k,x)}}home=[...c.values()].sort((a,b)=>b.n-a.n)[0]?.raw||''}
      if(!home)continue;
      const mixed=new Map();
      for(const u of units){
        if(u.from!==fid||taken.has(u.key))continue;
        const s=subj.get(u.key);if(!s||sameSubject(s,home)||subjectHasName(s,nameOf(fid)))continue;
        const k=subjectKey(s);if(!mixed.has(k))mixed.set(k,{raw:s,list:[]});mixed.get(k).list.push(u);
      }
      for(const [k,m] of mixed){
        // 같은 임자의 자리: 주인 임자가 같은 다른 폴더(자료가 많은 쪽), 없으면 이름에 그 임자가 든 폴더.
        const cand=fs.filter(f=>f.id!==fid&&usable(f.id));
        const byHome=cand.filter(f=>homes.get(f.id)&&sameSubject(homes.get(f.id),m.raw)).sort((a,b)=>every.filter(u=>u.from===b.id).length-every.filter(u=>u.from===a.id).length)[0];
        const byName=byHome||cand.find(f=>{const n=String(f.name||'').toLowerCase().replace(/\s+/g,'');return [...n].length>=2&&n.includes(subjectKey(m.raw))&&!(homes.get(f.id)&&!sameSubject(homes.get(f.id),m.raw))});
        const to=byName?{folder:byName.id}:newFolder(m.raw.slice(0,40),byId.get(fid)?.parent_id||null);
        const all=m.list.map(u=>({key:u.key,ids:u.ids,title:u.title,from:u.from,photoset:u.photoset,checked:true,note:''}));
        const g=retargetGroup({gid:'s:'+fid+':'+k,word:m.raw.slice(0,40),total:m.list.length,at:[{folder:fid,n:m.list.length}],all,split:true},to);
        if(!g.rows.length)continue;
        out.push({...g,mode:to.folder?'move':'keep'});
      }
    }
  }
  // 본보기 묶음과 흩어진 묶음이 같은 폴더로 가면 한 묶음으로(같은 폴더 이름이 두 번 나오지 않게) — 흩어진 묶음 이름·체크는 그대로, 본보기 줄은 '닮은 자료' 글.
  for(const g of out.filter(x=>x.learn&&!x.pick)){
    const h=out.find(x=>!x.learn&&!x.split&&x.to.folder&&x.to.folder===g.to.folder);if(!h)continue;
    const at=new Map(h.at.map(x=>[x.folder,x.n]));for(const x of g.at)at.set(x.folder,(at.get(x.folder)||0)+x.n);
    Object.assign(h,{total:h.total+g.total,all:[...h.all,...g.all],rows:[...h.rows,...g.rows],at:[...at].map(([folder,n])=>({folder,n})).sort((a,b)=>b.n-a.n||(order.get(a.folder)??1e9)-(order.get(b.folder)??1e9)),mode:'move'});
    out.splice(out.indexOf(g),1);
  }
  out.sort((a,b)=>(a.pick?1:0)-(b.pick?1:0)||(a.split?1:0)-(b.split?1:0)||b.total-a.total||a.word.localeCompare(b.word,'ko'));
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
  if(!groups.length)return done?'흩어지거나 섞인 자료를 찾지 못했어요.':'';
  const n=groups.reduce((s,g)=>s+g.rows.length,0),mix=groups.filter(g=>g.split).length,learn=groups.filter(g=>g.learn&&!g.pick).length,pick=groups.filter(g=>g.pick).length,spread=groups.length-mix-learn-pick;
  const parts=[learn?`닮은 폴더가 있는 자료 ${learn}묶음`:'',spread?`흩어진 같은 자료 ${spread}묶음`:'',mix?`다른 이름이 섞인 자료 ${mix}묶음`:'',pick?`선택할 자료 ${pick}묶음`:''].filter(Boolean).join(' · ');
  return `${parts}(${n}개)을 찾았어요. 묶음마다 선택하세요.`;
}
