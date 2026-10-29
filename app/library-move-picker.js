import {emptyHtml} from './wait-state.js';
// LIB-폴더로옮기기 (2026-10-27 17:01 사용자 요청): [폴더로 옮기기 ›]를 누르면 뜨는 작은 폴더 목록(PC·폰 공통, 그리는 곳은 여기 하나).
// 맨 위 '폴더 찾기' 칸 → 최근 넣은 폴더 → 전체 폴더(하위는 들여쓰기) → 아래 [+ 새 폴더 만들어 넣기]·[폴더 밖으로].
// 목록 줄은 library-move.mjs의 pickerRows()가 만든 것을 그대로 그리고, 옮기는 일은 부른 쪽(library-folders.js)이 한다(서버 길은 LIB-폴더탐색기와 같은 하나).
// PC(761px~)는 누른 버튼 옆(자리가 없으면 반대쪽, 버튼이 모서리 도구줄이면 아래)에, 폰(760px 이하)은 아래에서 올라오는 작은 시트로 연다.
// 닫기: Esc·바깥 누르기·폴더 고르기·왼쪽 화살표(옆 목록일 때)·폰 뒤로가기(history:true일 때). 열 때 '폴더 찾기' 칸에 초점, 닫을 때 부른 버튼으로 돌아간다.
const GAP=4,EDGE=8,WIDTH=248;
const wide=()=>typeof matchMedia==='function'&&matchMedia('(min-width:761px)').matches;

export function createMovePicker({esc}){
  let panel=null,input=null,list=null,note=null,foot=null,state=null,popover=false,closing=null,historyOwned=false,outside=null,keep=null;
  const HISTORY_KEY='kptuLibraryMovePicker';

  function ensure(){
    if(panel)return;
    panel=document.createElement('div');panel.id='luMovePicker';panel.className='lu-move-picker';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','폴더로 옮기기');
    panel.innerHTML='<input type="search" class="lu-move-find" placeholder="폴더 찾기" aria-label="폴더 찾기" autocomplete="off" enterkeyhint="search"><div class="lu-move-list" role="group" aria-label="폴더 목록"></div><p class="lu-move-note" role="status" hidden></p><div class="lu-move-foot"></div>';
    input=panel.querySelector('.lu-move-find');list=panel.querySelector('.lu-move-list');note=panel.querySelector('.lu-move-note');foot=panel.querySelector('.lu-move-foot');
    popover=typeof panel.showPopover==='function'&&typeof panel.hidePopover==='function'&&'popover' in panel;if(popover)panel.setAttribute('popover','manual');
    document.body.append(panel);
    input.addEventListener('input',()=>paint());
    input.addEventListener('keydown',e=>{
      if(e.isComposing||e.keyCode===229)return;
      if(e.key==='Enter'){e.preventDefault();const first=items().find(b=>b.getAttribute('aria-disabled')!=='true');if(first)first.click();return}
      if(e.key==='ArrowDown'){e.preventDefault();items()[0]?.focus()}
    });
    panel.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b||!state)return;
      e.stopPropagation();
      if(b.getAttribute('aria-disabled')==='true'||b.disabled)return;
      const s=state;
      if(b.dataset.luMoveFolder)void finish(()=>s.onPick(b.dataset.luMoveFolder));
      // 값 없는 표시(data-lu-move-new·data-lu-move-out)는 dataset 값이 ''라 참/거짓으로 보면 안 된다: 있는지로 본다.
      else if(b.hasAttribute('data-lu-move-new'))void finish(()=>s.onNew());
      else if(b.hasAttribute('data-lu-move-out'))void finish(()=>s.onOut());
    });
    panel.addEventListener('keydown',e=>{
      if(!state)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();void close(false,true);return}
      if(e.key==='ArrowLeft'&&state.place==='side'&&e.target!==input){e.preventDefault();void close(false,true);return}
      const target=e.target;if(!(target instanceof Element)||target===input)return;
      const all=[...panel.querySelectorAll('.lu-move-item,.lu-move-foot button')],i=all.indexOf(target);if(i<0)return;
      const to=e.key==='ArrowDown'?i+1:e.key==='ArrowUp'?i-1:e.key==='Home'?0:e.key==='End'?all.length-1:null;
      if(to===null)return;
      e.preventDefault();
      if(to<0){input.focus();return}
      all[Math.min(all.length-1,to)]?.focus();
    },true);
  }
  const items=()=>[...(list?.querySelectorAll('.lu-move-item')||[])];
  const item=(r,labeled)=>`<button type="button" class="lu-move-item" data-lu-move-folder="${esc(r.id)}"${r.enabled?'':' aria-disabled="true"'}${r.current?' aria-current="true"':''}${r.reason?` title="${esc(r.reason)}"`:` title="${esc(r.label)}"`} style="--lu-depth:${labeled?0:r.depth}"><span class="lu-move-name">${esc(labeled?r.label:r.name)}</span>${r.current?'<span class="lu-move-tag">지금 여기</span>':''}</button>`;

  function paint(){
    if(!state)return;
    const q=input.value.trim(),data=state.rows(q),searching=!!q;
    const parts=[];
    if(data.recent.length)parts.push('<p class="lu-move-sec">최근 넣은 폴더</p>'+data.recent.map(r=>item(r,true)).join(''));
    if(data.all.length)parts.push((data.recent.length||searching?`<p class="lu-move-sec">${searching?'찾은 폴더':'전체 폴더'}</p>`:'')+data.all.map(r=>item(r,searching)).join(''));
    if(!parts.length)parts.push(emptyHtml());
    list.innerHTML=parts.join('');
    const reason=[...data.recent,...data.all].find(r=>r.reason)?.reason;
    note.hidden=!reason;note.textContent=reason?`흐린 폴더는 ${reason}. 묶기를 ‘폴더’로 바꾸면 고를 수 있어요.`:'';
    foot.innerHTML=`<button type="button" class="lu-move-foot-btn" data-lu-move-new${state.canNew?'':' aria-disabled="true"'}>+ 새 폴더 만들어 넣기</button>${state.canOut?'<button type="button" class="lu-move-foot-btn" data-lu-move-out>폴더 밖으로</button>':''}`;
    position();
  }

  function position(){
    if(!state||panel.hidden)return;
    const maxH=Math.max(160,Math.min(440,innerHeight-EDGE*2));
    panel.classList.toggle('lu-move-sheet',!wide());
    if(!wide()){panel.style.cssText='';panel.style.maxHeight=Math.min(Math.round(innerHeight*0.7),maxH+80)+'px';return}
    panel.style.width=Math.min(WIDTH,innerWidth-EDGE*2)+'px';panel.style.maxHeight=maxH+'px';
    const a=state.anchor.getBoundingClientRect(),h=Math.min(panel.getBoundingClientRect().height||maxH,maxH),w=Math.min(WIDTH,innerWidth-EDGE*2);
    let left,top;
    if(state.place==='side'){
      left=a.right+GAP;if(left+w>innerWidth-EDGE)left=a.left-w-GAP;
      if(left<EDGE)left=Math.max(EDGE,Math.min(a.left,innerWidth-w-EDGE));
      top=a.top;
    }else{left=Math.max(EDGE,Math.min(a.left,innerWidth-w-EDGE));top=a.bottom+GAP}
    if(top+h>innerHeight-EDGE){state.place==='below'&&a.top-GAP-h>=EDGE?top=a.top-GAP-h:top=innerHeight-EDGE-h}
    panel.style.left=Math.round(left)+'px';panel.style.top=Math.round(Math.max(EDGE,top))+'px';panel.style.right='auto';panel.style.bottom='auto';
  }

  // opts: {anchor, place:'side'|'below', rows(query)->{recent,all,total}, canOut, canNew, history, onPick(id), onNew(), onOut(), onClosed()}
  function open(opts){
    ensure();
    if(closing){closing.then(()=>open(opts));return}
    if(state)void close();
    state={...opts,place:opts.place||'below'};
    input.value='';panel.hidden=false;
    if(popover){try{panel.showPopover()}catch{popover=false;panel.removeAttribute('popover')}}
    paint();
    historyOwned=!!opts.history;
    if(historyOwned)history.pushState({...history.state,[HISTORY_KEY]:true},'',location.href);
    outside=e=>{if(!state||panel.contains(e.target)||state.anchor.contains?.(e.target)||state.keepOpen?.(e.target))return;void close(false,false)};
    keep=()=>position();
    document.addEventListener('pointerdown',outside,true);
    window.addEventListener('resize',keep);window.addEventListener('scroll',keep,true);
    window.addEventListener('popstate',onPop);
    input.focus({preventScroll:true});
  }
  function onPop(e){if(state&&historyOwned&&!e.state?.[HISTORY_KEY]){historyOwned=false;void close(true,true)}}
  // 닫기. 끝난 뒤 resolve. fromBack=true는 이미 뒤로가기로 기록이 빠진 경우, restoreFocus=true는 부른 버튼으로 초점을 돌려준다(Esc·왼쪽 화살표·뒤로가기).
  function close(fromBack=false,restoreFocus=false){
    const s=state;if(!s)return closing||Promise.resolve();
    state=null;
    document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',keep);window.removeEventListener('scroll',keep,true);window.removeEventListener('popstate',onPop);
    if(popover){try{panel.hidePopover()}catch{}}
    panel.hidden=true;
    let release;const pending=new Promise(r=>{release=r});closing=pending;
    const done=()=>queueMicrotask(()=>{if(closing===pending)closing=null;release();if(restoreFocus&&s.anchor?.isConnected)s.anchor.focus?.({preventScroll:true});s.onClosed?.(fromBack)});
    if(historyOwned&&!fromBack&&history.state?.[HISTORY_KEY]){historyOwned=false;window.addEventListener('popstate',done,{once:true});history.back()}else{historyOwned=false;done()}
    return pending;
  }
  // 고른 뒤: 목록을 닫고(기록 정리까지 기다림) 일을 한다.
  async function finish(work){await close(false,false);await work()}
  return {open,close,reposition:position,get isOpen(){return !!state},contains:n=>!!panel&&panel.contains(n),get element(){return panel}};
}
