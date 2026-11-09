// HOTFIX-회의첨부칸 ②(S48-53): 사업 보고 창(보기·고치기 면)에 PC로 파일을 끌어 놓을 때의 공용 판단.
// - 놓은 자리(data-drop-zone): result = 결과 칸(보기의 결과 원문, 고치기의 결과 원문 칸), material = 회의자료 줄, photo = 사진 줄.
//   자리가 정해지지 않은 파일은 '파일·글로 만들기'(meeting-from-files.js)와 같은 이름 규칙(roleOf)으로 고르고, 그래도 모르면 작은 고르기 창으로 묻는다.
// - 결과 파일(PDF·HWP)은 놓자마자 결과 칸에 넣을지 한 번 묻고(askDropped), 넣기면 뒤에서 '파일·글로 만들기'와 같은 읽기(readFileText, 이 기기 안에서만)로 읽는다.
// - 파일 올리기는 부르는 쪽(meeting-round-detail.js → meeting-drop-queue.mjs)이 창 없이 같은 자료실 올리기 길(library-files, meeting_id, AI 채우기)로 뒤에서 한다. 서버·DB 변경 없음.
// - 폰은 끌어 놓기가 없으니 첨부 [+] 버튼 그대로다.
import {roleOf,appendResult} from './meeting-file-parse.mjs';
import {readFileText,createHwpReader,kindOf} from './meeting-file-text.js';
import {askChoice,askConfirm} from './small-notice.js';

export {appendResult};

// 놓은 자리: 가장 가까운 [data-drop-zone]. 없으면 ''(창 아무 데나).
export function dropZoneOf(target){
  const el=target&&typeof target.closest==='function'?target.closest('[data-drop-zone]'):null;
  return el?String(el.dataset.dropZone||''):'';
}

// 파일마다 결과·자료를 정한다. 자리가 결과·자료면 그 자리를 따르고, 아니면 이름 규칙, 모르면 묻는다(닫으면 자료).
export async function sortDropped(files,{zone='',anchor=null,ask=askChoice}={}){
  const results=[],materials=[];
  for(const file of files||[]){
    let role=zone==='result'||zone==='material'?zone:roleOf(file?.name);
    if(!role){
      role=await ask(anchor,{text:`${file?.name||'파일'} — 결과 파일인가요, 회의자료인가요?`,choices:[{value:'result',label:'결과',note:'본문을 결과 칸에 넣을지 물어요'},{value:'material',label:'회의자료',note:'파일만 붙여요'}]})||'material';
    }
    (role==='result'?results:materials).push(file);
  }
  return {results,materials};
}

// 결과 파일 본문을 읽어 하나로 잇는다. PDF·HWP만 읽고, 못 읽은 파일은 파일만 붙는다.
export async function readResultText(files,{read=readFileText}={}){
  const targets=(files||[]).filter(f=>kindOf(f?.name));
  if(!targets.length)return '';
  let hwp=null;const texts=[];
  try{
    for(const file of targets){
      if(kindOf(file.name)==='hwp'&&!hwp&&read===readFileText)hwp=createHwpReader();
      const r=await read(file,{hwp});
      if(r?.text)texts.push(r.text);
    }
  }finally{hwp?.close?.()}
  return texts.join('\n\n');
}

// UX-먼저묻고뒤에처리(11/09): 놓자마자 묻는다 — 본문을 읽기 전에. 결과 파일 중 읽을 수 있는 것(PDF·HWP)이 있으면
// '본문도 결과 칸에 넣을까요? [파일만][넣기]'를 바로 띄우고, 넣기면 readFiles에 그 파일들을 돌려준다(읽기·더하기는 뒤에서, meeting-drop-queue.mjs).
// 예전(resultBodyFor)에는 HWP를 이 기기에서 다 읽은 뒤에야 물어 창이 늦게 떴다.
export async function askDropped(files,{zone='',anchor=null,ask=askChoice,askOk=askConfirm}={}){
  const {results,materials}=await sortDropped(files,{zone,anchor,ask});
  const readable=results.filter(f=>kindOf(f?.name));
  if(!readable.length)return {results,materials,readFiles:[]};
  const ok=await askOk(anchor,{text:'본문도 결과 칸에 넣을까요?',note:readable.map(f=>f.name).join(', '),ok:'넣기',cancel:'파일만'});
  return {results,materials,readFiles:ok?readable:[]};
}

// 끌고 있는 동안 놓일 자리에만 '여기에 놓기' 테두리. 정해진 자리가 없으면 지금 보이는 면(보기·고치기)을 칠한다.
// 카드 자체의 끌기 판단(drop-active)은 meeting-compact.js bindDropTarget이 하고, 이 함수는 그 뒤에 자리 표시만 더한다.
export function bindDropZones(card,{face=()=>null}={}){
  if(!card||card.dataset.dropZones)return;
  card.dataset.dropZones='1';
  const clear=()=>card.querySelectorAll('.drop-zone-active').forEach(el=>el.classList.remove('drop-zone-active'));
  card.addEventListener('dragover',e=>{
    if(!card.classList.contains('drop-active')){clear();return}
    const zone=e.target?.closest?.('[data-drop-zone]'),want=zone&&card.contains(zone)&&zone.getClientRects().length?zone:face();
    card.querySelectorAll('.drop-zone-active').forEach(el=>{if(el!==want)el.classList.remove('drop-zone-active')});
    want?.classList.add('drop-zone-active');
  });
  card.addEventListener('dragleave',e=>{if(!card.contains(e.relatedTarget))clear()});
  for(const type of ['drop','dragend'])card.addEventListener(type,clear);
}
