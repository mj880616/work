// LIB-화면끌어놓기 (2026-10-26 명진 요청): PC에서 자료실을 연 채로 화면 어디에나 파일을 끌어다 놓으면 [+ 자료 등록]과 같은 서버 길로 바로 올린다.
// 이 파일은 끌어오기 감지·올리기 순서·안내 문구만 맡는다. 실제 올리기(library-files 요청, AI 채우기)는 library-upload.js가 넘겨 주는 upload 함수다.
// 저장은 서버(Drive 원본 + 자료 표)뿐이고 이 화면은 아무것도 따로 저장하지 않는다.
export const DROP_HINT='놓으면 바로 올려요';
export const DROP_RESULT_CLEAR_MS=8000;

export const hasFiles=event=>[...(event?.dataTransfer?.types||[])].includes('Files');

export const progressText=({index,total,name})=>total>1?`올리는 중 ${index}/${total} · ${name}`:`올리는 중 · ${name}`;

// done: 올라간 개수, failed: [{name,message}], rest: 중간에 멈춰 시도하지 못한 개수.
export function resultText({done=0,failed=[],rest=0}={}){
  const bad=failed.length+rest;
  if(!bad)return `${done}개 올렸어요`;
  const head=done?`${done}개 올렸어요 · ${bad}개 못 올렸어요`:`${bad}개 못 올렸어요`;
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
// active()가 거짓이면(자료실이 아니거나, 창이 열려 있거나, 모바일) 아무것도 하지 않아 기존 동작(등록 창의 놓기 칸 등)이 그대로다.
// 파일이 아닌 끌기(자료를 폴더로 옮기기 등)는 건드리지 않는다.
export function bindLibraryDrop({doc=document,overlay,active,onFiles,place=()=>{}}){
  if(!overlay||doc.__luDropBound)return ()=>{};
  doc.__luDropBound=true;
  let depth=0;
  const show=on=>{if(on&&overlay.hidden)place();overlay.hidden=!on};
  const reset=()=>{depth=0;show(false)};
  const enter=e=>{if(!hasFiles(e)||!active())return;e.preventDefault();depth++;show(true)};
  const over=e=>{if(!hasFiles(e)||!active()){if(!overlay.hidden)reset();return}e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='copy';show(true)};
  const leave=e=>{if(!hasFiles(e))return;depth=Math.max(0,depth-1);if(!depth||e.relatedTarget===null)reset()};
  const drop=e=>{
    if(!hasFiles(e)||!active()){reset();return}
    e.preventDefault();reset();
    const files=Array.from(e.dataTransfer?.files||[]);
    if(files.length)onFiles(files);
  };
  doc.addEventListener('dragenter',enter);doc.addEventListener('dragover',over);doc.addEventListener('dragleave',leave);
  doc.addEventListener('drop',drop);doc.addEventListener('dragend',reset);
  return ()=>{doc.removeEventListener('dragenter',enter);doc.removeEventListener('dragover',over);doc.removeEventListener('dragleave',leave);doc.removeEventListener('drop',drop);doc.removeEventListener('dragend',reset);delete doc.__luDropBound};
}
