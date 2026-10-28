// UI-업데이트안내(docs/design/update-notice-release-notes.md 9.4·9.5): 내 프로필 맨 아래 [업데이트 기록] 칸 안을 그린다.
// 칸 자리(#psReleaseNotes, 접힘 <details>)는 profile-settings.js가 만들고 이 모듈은 그 안만 맡는다(한 칸 = 한 renderer).
// 읽는 것은 배포물 app/release-notes.json 하나(빌드가 만든 공개 파일). 서버·기기 저장 없음. 글자는 textContent로만 넣는다.
import {parseReleaseNotes,shortDate,PAGE_SIZE} from './release-notes-model.mjs';

const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node};

function noteRow(note,current){
  const row=el('details','rn-note');
  if(note.v===current)row.open=true;
  const head=el('summary','rn-head');
  head.append(el('span','rn-ver',note.v),el('span','rn-date',shortDate(note.date)));
  if(note.v===current)head.append(el('span','rn-now','지금'));
  else head.append(el('span','rn-one',note.changes[0]));
  const body=el('div','rn-body'),list=el('ul','rn-changes');
  for(const line of note.changes)list.append(el('li',null,line));
  body.append(list);
  if(note.checks.length){
    const check=el('p','rn-check');
    check.append(el('span','rn-check-label','폰에서 볼 것'),document.createTextNode(' '+note.checks.join(' · ')));
    body.append(check);
  }
  row.append(head,body);
  return row;
}

/** slot = #psReleaseNotes(<details>). 기록을 못 읽거나 하나도 없으면 칸을 숨긴 채 둔다. */
export async function mountReleaseNotes(slot){
  if(!slot||slot.dataset.rnMounted)return;
  slot.dataset.rnMounted='1';
  const url=new URL('./release-notes.json',import.meta.url);
  // 배포마다 이 모듈 주소(내용 해시)가 바뀌므로 그 값을 붙여 Pages 보관본 대신 이번 배포의 기록을 받는다.
  const deploy=new URL(import.meta.url).searchParams.get('v');if(deploy)url.searchParams.set('d',deploy);
  let list=null;
  try{const res=await fetch(url.href,{cache:'no-store'});if(res.ok)list=parseReleaseNotes(await res.json())}catch{list=null}
  if(!list||!list.notes.length)return;
  const head=el('summary','rn-title');
  head.append(el('span','rn-title-text','업데이트 기록'),el('span','rn-title-ver',list.current?`현재 ${list.current}`:''));
  const box=el('div','rn-list');
  let shown=0;
  const more=el('button','rn-more mini','이전 기록 더 보기');more.type='button';
  const page=()=>{for(const note of list.notes.slice(shown,shown+PAGE_SIZE))box.append(noteRow(note,list.current));shown=Math.min(list.notes.length,shown+PAGE_SIZE);more.hidden=shown>=list.notes.length};
  more.addEventListener('click',page);
  page();
  slot.replaceChildren(head,box,more);
  slot.hidden=false;
}
