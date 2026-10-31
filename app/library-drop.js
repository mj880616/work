// LIB-화면끌어놓기 (2026-10-26 명진 요청): PC에서 자료실을 연 채로 화면 어디에나 파일을 끌어다 놓으면 [+ 자료 등록]과 같은 서버 길로 바로 올린다.
// 이 파일은 끌어오기 감지·올리기 순서·안내 문구만 맡는다. 실제 올리기(library-files 요청, AI 채우기)는 library-upload.js가 넘겨 주는 upload 함수다.
// 저장은 서버(Drive 원본 + 자료 표)뿐이고 이 화면은 아무것도 따로 저장하지 않는다.
export const DROP_HINT='놓으면 바로 올려요';
// LIB-폴더로올리기 (2026-10-30 명진 요청): 폴더 묶기에서 폴더 줄 위에 놓으면 그 폴더로 올린다. 안내·결과 문구에 폴더 이름.
export const folderHint=name=>`놓으면 ‘${name}’ 폴더로 올려요`;
export const DROP_RESULT_CLEAR_MS=8000;
// S46-25 묶음으로올리기 (2026-10-31 명진 결정): 사업영역·담당조직·분류 묶기에서 그 묶음 머리(또는 그 묶음 안 자료 줄)에 놓으면 그 값을 달아 올린다.
// 월별 묶기와 '값 없음' 묶음(사업영역 없음·조직 없음)은 지금처럼 화면 끌어놓기. 값 확인(있는 사업영역·조직·분류인지)은 resolve가 하고, 서버가 다시 본다.
export const VALUE_GROUPS=Object.freeze({
  project:Object.freeze({prefix:'p:',field:'project_id',none:'none'}),
  organization:Object.freeze({prefix:'o:',field:'organization_id',none:'none'}),
  category:Object.freeze({prefix:'c:',field:'category',none:null})
});
// 받침에 맞는 '로/으로'('공공기관사업본부로', '교섭으로'). 받침 ㄹ과 한글이 아닌 끝 글자는 '로'.
export function ro(name){
  const c=String(name??'').trim().slice(-1).charCodeAt(0);
  if(!(c>=0xAC00&&c<=0xD7A3))return '로';
  const jong=(c-0xAC00)%28;return jong===0||jong===8?'로':'으로';
}
export const valueHint=name=>`놓으면 ‘${name}’${ro(name)} 올려요`;
// 손 아래에서 가장 가까운 토글이 그 묶기의 묶음일 때만(하위 사업영역은 그 하위 사업영역). 사업영역 안 폴더 위는 묶음이 아니라서 지금처럼(폴더로 올리기는 폴더 묶기에서).
// resolve(raw)는 {name} 또는 null(없는 값·확인할 수 없는 값).
export function groupDropTarget(e,groupBy,{resolve,root='#documentList'}={}){
  const g=VALUE_GROUPS[groupBy];if(!g||typeof resolve!=='function')return null;
  const node=e?.target?.closest?.('details.lu-node');
  if(!node||!String(node.dataset?.luNode||'').startsWith(g.prefix)||!node.closest?.(root))return null;
  const key=node.dataset.luNode,raw=key.slice(g.prefix.length);
  if(!raw||(g.none&&raw===g.none))return null;
  const hit=resolve(raw);if(!hit?.name)return null;
  const head=node.querySelector(':scope > summary.lu-node-head');if(!head)return null;
  return {head,ok:true,kind:groupBy==='category'?'category':'into',key,field:g.field,value:raw,name:hit.name,hint:valueHint(hit.name)};
}

export const hasFiles=event=>[...(event?.dataTransfer?.types||[])].includes('Files');

export const progressText=({index,total,name})=>total>1?`올리는 중 ${index}/${total} · ${name}`:`올리는 중 · ${name}`;

// done: 올라간 개수, failed: [{name,message}], rest: 중간에 멈춰 시도하지 못한 개수.
// folder: 폴더에 놓았으면 그 폴더 이름('주간보고에 2개 올렸어요'). unfiled: 올라갔지만 폴더에 넣지 못한 개수(자료는 폴더 밖에 남음).
// value: 묶음 머리에 놓았으면 그 값 이름('공공기관사업본부로 2개 올렸어요'). unlinked: 올라갔지만 그 값을 달지 못한 개수.
export function resultText({done=0,failed=[],rest=0,folder='',unfiled=0,value='',unlinked=0}={}){
  const bad=failed.length+rest,ok=folder?`${folder}에 ${done}개 올렸어요`:value?`${value}${ro(value)} ${done}개 올렸어요`:`${done}개 올렸어요`;
  const loose=(unfiled?` · ${unfiled}개는 폴더에 넣지 못해 폴더 밖에 있어요`:'')+(unlinked?` · ${unlinked}개는 ${value||'그 묶음'}에 붙이지 못했어요`:'');
  if(!bad)return ok+loose;
  const head=(done?`${ok} · ${bad}개 못 올렸어요`:`${bad}개 못 올렸어요`)+loose;
  const why=failed[0]?.message;
  return why?`${head}. ${why}`:head;
}

// files를 차례로 올린다(한 번에 하나, 서버 부담을 같게). preflight(file)이 실패를 돌려주면 그 파일만 건너뛴다.
// classify(error)는 {message,stop}을 돌려준다: stop이면(로그인 만료·Drive 연결 만료 등) 남은 파일은 시도하지 않는다.
export async function runDropUpload(files,{upload,classify,preflight=()=>null,onProgress=()=>{}}){
  const list=Array.from(files||[]);
  const out={done:0,failed:[],rest:0,stopped:null};
  for(let i=0;i<list.length;i++){
    const file=list[i],bad=preflight(file);
    if(bad){out.failed.push({name:file.name,message:bad.message});continue}
    onProgress({index:i+1,total:list.length,name:file.name});
    try{await upload(file);out.done++}
    catch(error){
      const failure=classify(error)||{};
      out.failed.push({name:file.name,message:failure.message||'올리지 못했어요.',kind:failure.kind});
      if(failure.stop){out.rest=list.length-i-1;out.stopped={error,failure};break}
    }
  }
  return out;
}

// 끌어오는 동안 화면 전체에 얇은 점선 테두리와 한 줄 안내(overlay)를 보이고, 놓으면 onFiles로 넘긴다.
// pick(e): 지금 손 아래의 폴더({name,...})·값 묶음({name,hint,field,value}) 또는 null. mark(t): 그 폴더 줄 표시(null이면 지움). 놓으면 onFiles(files,t) — t가 없으면 지금처럼.
// active()가 거짓이면(자료실이 아니거나, 창이 열려 있거나, 모바일) 아무것도 하지 않아 기존 동작(등록 창의 놓기 칸 등)이 그대로다.
// 파일이 아닌 끌기(자료를 폴더로 옮기기 등)는 건드리지 않는다.
export function bindLibraryDrop({doc=document,overlay,active,onFiles,place=()=>{},pick=()=>null,mark=()=>{}}){
  if(!overlay||doc.__luDropBound)return ()=>{};
  doc.__luDropBound=true;
  let depth=0,hint='',last=null;
  const say=t=>{const text=t?.hint||(t?.name?folderHint(t.name):DROP_HINT);if(text===hint)return;hint=text;const el=overlay.firstChild||overlay;if(el)el.textContent=text};
  const show=on=>{if(on&&overlay.hidden)place();overlay.hidden=!on};
  const reset=()=>{depth=0;last=null;show(false);mark(null);say(null)};
  const enter=e=>{if(!hasFiles(e)||!active())return;e.preventDefault();depth++;show(true)};
  const over=e=>{if(!hasFiles(e)||!active()){if(!overlay.hidden)reset();return}e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='copy';show(true);const t=pick(e);last=t;mark(t);say(t)};
  const leave=e=>{if(!hasFiles(e))return;depth=Math.max(0,depth-1);if(!depth||e.relatedTarget===null)reset()};
  const drop=e=>{
    if(!hasFiles(e)||!active()){reset();return}
    // 놓은 자리가 폴더면 그 폴더, 아니면 마지막으로 표시해 보여 준 곳(사람이 본 표시 그대로).
    e.preventDefault();const t=pick(e)||last;reset();
    const files=Array.from(e.dataTransfer?.files||[]);
    if(files.length)onFiles(files,t||null);
  };
  doc.addEventListener('dragenter',enter);doc.addEventListener('dragover',over);doc.addEventListener('dragleave',leave);
  doc.addEventListener('drop',drop);doc.addEventListener('dragend',reset);
  return ()=>{doc.removeEventListener('dragenter',enter);doc.removeEventListener('dragover',over);doc.removeEventListener('dragleave',leave);doc.removeEventListener('drop',drop);doc.removeEventListener('dragend',reset);delete doc.__luDropBound};
}
