// HWP-노조양식 2단계: 노조 문서 양식의 스타일 10종을 Ctrl+1~0(예비 Alt+1~0)과 스타일 버튼 줄로 적용한다.
// 편집기 iframe 안에서만 돈다(studio-guard.js와 같은 방식으로 빌드 마무리 때 index.html에 넣는다).
// 새 기능을 만들지 않고 편집기의 스타일 칸(#style-name)을 사람이 고른 것과 똑같이 바꿔 `format:apply-style`을 태운다.
// 스타일은 번호가 아니라 이름으로 찾는다: 양식에서 시작하지 않은 문서(그 이름의 스타일이 없는 문서)에서는 아무 일도 하지 않는다.
(()=>{
  'use strict';
  // docs/hwp-style-map.md 2절. 키 0은 열 번째(중간대제목)다. 이름은 공백을 뺀 형태로 견준다.
  const STYLES=Object.freeze([
    {key:'1',name:'바탕글'},{key:'2',name:'안건제목'},{key:'3',name:'큰 제목'},{key:'4',name:'중간 제목'},{key:'5',name:'작은 제목'},
    {key:'6',name:'최하위 제목[강조]',label:'최하위 제목'},{key:'7',name:'세부 참고사항',label:'참고사항'},{key:'8',name:'표내부'},
    {key:'9',name:'(기타)의결주문',label:'의결주문'},{key:'0',name:'중간대제목'}
  ]);
  const squash=text=>String(text??'').replace(/\s+/g,'');
  const select=()=>document.getElementById('style-name');
  const optionOf=name=>{
    const box=select();
    if(!box)return null;
    const want=squash(name);
    return [...box.options].find(option=>squash(option.textContent)===want)||null;
  };
  function apply(name){
    const box=select(),option=optionOf(name);
    if(!box||!option)return false;
    box.value=option.value;
    box.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  }
  const byKey=new Map(STYLES.map(row=>[row.key,row]));
  const keyOf=event=>/^Digit[0-9]$/.test(event.code)?event.code.slice(5):/^[0-9]$/.test(event.key)?event.key:'';
  window.addEventListener('keydown',event=>{
    if(event.isComposing||event.shiftKey||event.metaKey||event.repeat||event.ctrlKey===event.altKey)return;
    const row=byKey.get(keyOf(event));
    // A dialog's own fields keep their keys.
    if(!row||event.target?.closest?.('[role="dialog"],.dialog,.modal'))return;
    if(!optionOf(row.name))return;
    event.preventDefault();event.stopImmediatePropagation();
    apply(row.name);
  },true);

  // 스타일 버튼 줄: 기본 도구 상자의 기존 묶음(tb-group)·버튼(tb-btn) 부품을 그대로 쓴다. 양식 스타일이 있는 문서에서만 보인다.
  const GROUP_ID='web2-style-buttons';
  function buttons(){
    const track=document.querySelector('#icon-toolbar .tb-scroll-track');
    if(!track)return;
    let group=document.getElementById(GROUP_ID);
    const found=STYLES.filter(row=>optionOf(row.name));
    if(!found.length){group?.remove();return}
    if(!group){
      group=document.createElement('div');
      group.id=GROUP_ID;group.className='tb-group';
      group.setAttribute('role','group');group.setAttribute('aria-label','노조 양식 스타일');
      const sep=document.createElement('span');sep.className='tb-sep';
      group.append(sep);
      track.append(group);
    }
    group.querySelectorAll('button').forEach(button=>button.remove());
    for(const row of found){
      const button=document.createElement('button');
      button.type='button';button.className='tb-btn';button.dataset.styleName=row.name;
      button.title=`${row.name} (Ctrl+${row.key})`;
      const num=document.createElement('span');num.className='tb-icon-text';num.textContent=row.key;
      const label=document.createElement('span');label.className='tb-label';label.textContent=row.label||row.name;
      button.append(num,label);
      // The text caret stays in the document: pressing a button must not take the focus.
      button.addEventListener('mousedown',event=>event.preventDefault());
      button.addEventListener('click',event=>{event.stopPropagation();apply(row.name)});
      group.append(button);
    }
  }
  function watch(){
    const box=select();
    if(!box)return false;
    let queued=false;
    new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;buttons()})}).observe(box,{childList:true});
    buttons();
    return true;
  }
  if(!watch())document.addEventListener('DOMContentLoaded',()=>{if(!watch())window.addEventListener('load',watch,{once:true})},{once:true});
})();
