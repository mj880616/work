// UI-회의결과창정리: 회의 결과 창(만들기·수정)과 자료 등록 창이 함께 쓰는 작은 묶음 조각.
// 기한 칸은 FORM-시간입력(#624) 규칙대로 기기 날짜 고르기를 그대로 쓰고, 보이는 것만 [기한 ▾] 작은 칩으로 줄인다.
import {formatSeoulTime} from './meeting-time.js?v=2';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey=v=>String(v||'').match(/^\d{4}-\d{2}-\d{2}/)?.[0]||'';
// 할 일 화면과 같은 기한 글자(예: 10. 25. (토)).
export const dueText=v=>{const key=dateKey(v);return key?formatSeoulTime(key,{month:'numeric',day:'numeric',weekday:'short'}):''};

const KINDS={HWP:'hwp',HWPX:'hwp',PDF:'pdf',XLS:'xls',XLSX:'xls',CSV:'xls',DOC:'doc',DOCX:'doc',PPT:'ppt',PPTX:'ppt'};
// 자료실 종류 표시와 같은 글자·색(PDF·HWP·XLS·DOC·PPT, 나머지는 회색 확장자 또는 '파일').
export function fileKind(name){
  const ext=String(name||'').includes('.')?String(name).split('.').pop().toUpperCase():'';
  const key=KINDS[ext];
  return key?{key,label:key.toUpperCase()}:{key:'other',label:/^[A-Z0-9]{1,4}$/.test(ext)?ext:'파일'};
}
// 파일 한 줄: 종류 · 이름(· 크기) · 상태(진행률) · 끝 버튼(×). state: pending|uploading|success|error|unknown.
export function fileLine({name,meta='',state='',label='',end='',attrs='',cls='',stateAttr='data-file-state'}){
  const kind=fileKind(name);
  return `<div class="file-line${cls?' '+cls:''}${state?' '+state:''}"${attrs}><span class="file-kind" data-kind="${kind.key}" aria-hidden="true">${esc(kind.label)}</span><span class="file-line-main"><b>${esc(name||'파일')}</b>${meta?`<small>${esc(meta)}</small>`:''}</span>${label?`<span class="file-line-state" ${stateAttr}>${esc(label)}</span>`:''}${state==='uploading'?'<span class="file-line-progress" role="progressbar" aria-label="올리는 중"></span>':''}${end}</div>`;
}

export function paintDue(input){
  const box=input?.closest('.due-chip');if(!box)return;
  const label=box.querySelector('.due-chip-label');
  if(label)label.textContent=input.value?dueText(input.value)+' ▾':'기한 ▾';
  box.classList.toggle('has-value',!!input.value);
}
export function bindDue(input){
  if(!input||input.dataset.dueChip)return;
  input.dataset.dueChip='1';
  for(const type of ['input','change'])input.addEventListener(type,()=>paintDue(input));
  // PC 브라우저는 날짜 칸을 눌러도 달력이 바로 열리지 않으므로 칩을 누르면 기기 날짜 고르기를 연다.
  input.addEventListener('click',()=>{try{input.showPicker?.()}catch{}});
  paintDue(input);
}

// PC: 창 전체가 끌어다 놓는 자리. 파일을 끌고 들어올 때만 테두리를 보인다.
export function bindDropTarget(target,onFiles,canDrop=()=>true){
  if(!target||target.dataset.dropTarget)return;
  target.dataset.dropTarget='1';
  const hasFiles=e=>[...(e.dataTransfer?.types||[])].includes('Files');
  const off=()=>target.classList.remove('drop-active');
  target.addEventListener('dragenter',e=>{if(!hasFiles(e)||!canDrop())return;e.preventDefault();target.classList.add('drop-active')});
  target.addEventListener('dragover',e=>{if(!hasFiles(e)||!canDrop())return;e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='copy';target.classList.add('drop-active')});
  target.addEventListener('dragleave',e=>{if(!target.contains(e.relatedTarget))off()});
  target.addEventListener('dragend',off);
  target.addEventListener('drop',e=>{
    off();
    const files=Array.from(e.dataTransfer?.files||[]);
    if(!files.length)return;
    e.preventDefault();e.stopPropagation();
    if(canDrop())onFiles(files);
  });
}
