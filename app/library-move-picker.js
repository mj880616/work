import {pickIconHtml} from './folder-look.js';
import {emptyHtml} from './wait-state.js';
import {placeAnchored,followAnchor,clearAnchored,bottomInset} from './anchored-popup.js';
// LIB-폴더로옮기기 (2026-10-27 17:01 사용자 요청): [폴더로 옮기기 ›]를 누르면 뜨는 작은 폴더 목록(PC·폰 공통, 그리는 곳은 여기 하나).
// 맨 위 '폴더 찾기' 칸 → 최근 넣은 폴더 → 전체 폴더(하위는 들여쓰기) → 아래 [+ 새 폴더 만들어 넣기]·[폴더 밖으로].
// 목록 줄은 library-move.mjs의 pickerRows()가 만든 것을 그대로 그리고, 옮기는 일은 부른 쪽(library-folders.js)이 한다(서버 길은 LIB-폴더탐색기와 같은 하나).
// PC(761px~)는 누른 버튼 옆(자리가 없으면 반대쪽, 버튼이 모서리 도구줄이면 아래)에, 폰(760px 이하)은 아래에서 올라오는 작은 시트로 연다.
// S54-04 UI-고르기창버튼아래(11/08 명진 결정 B): 버튼으로 연 창(place 'below')은 폰·폴드·PC 모두 누른 버튼 바로 아래 작은 창(아래 자리가 모자라면 위)이다.
//   자리는 공용 placeAnchored·followAnchor(anchored-popup.js)가 정하고, 아래 바(하단바·전환 줄)·자판 높이(bottomInset) 위에서 끝난다. 길면 창 안 목록만 밀린다.
//   열 때 목록은 맨 위(첫 줄)부터 보인다. 메뉴 옆에 여는 창(place 'side')은 그대로(PC는 옆, 폰은 아래 시트).
// 닫기: Esc·바깥 누르기·폴더 고르기·왼쪽 화살표(옆 목록일 때)·폰 뒤로가기(history:true일 때). 닫을 때 부른 버튼으로 돌아간다.
// S52-27 UI-창스크롤(11/07 21:24 명진 결정): 열 때 초점은 PC(마우스)면 '폴더 찾기' 칸, 손가락 화면(pointer:coarse)이면 창 자체 —
//   폰에서 자판이 저절로 올라와 목록 절반을 덮지 않고, 찾기 칸을 눌렀을 때만 뜬다. 창 안에서 ↓·↑ 이동은 그대로.
// S52-27: 폰 시트는 아래 바(--kptu-mobile-tab-height·--kptu-switch-dock) 위에서 올라오고(library-upload.css), 높이 한도는 그 위 남은 자리 안.
//   창 안 목록이 밀릴 때 나는 scroll은 자리 다시 맞추기(keep)에서 뺀다(anchored-popup.js followAnchor와 같은 규칙) —
//   전에는 목록 scroll마다 position()이 시트의 inline 높이 한도를 지웠다 다시 써서 그 사이 목록 스크롤이 0으로 되돌아가 끝까지 내려가지 않았다.
const GAP=4,EDGE=8,WIDTH=248;
const wide=()=>typeof matchMedia==='function'&&matchMedia('(min-width:761px)').matches;
const coarse=()=>typeof matchMedia==='function'&&matchMedia('(pointer:coarse)').matches;

// S51-8 NEWS-전면개편 P4b: News [매체: 전체 ▾]도 같은 창을 쓴다 — id·창 이름·찾기 칸 글자·아래 단추 줄(foot:false면 없음)만 바꿔 연다. 기본값은 지금 그대로(폴더로 옮기기).
//   줄에 dot(색 토큰 var(...))이 있으면 폴더 그림 대신 작은 색 점, current 표시 글자는 currentTag로 바꾼다.
//   folderIcons:false면(매체 고르기) 점 없는 줄에 폴더 그림을 그리지 않는다.
export function createMovePicker({esc,id='luMovePicker',label='폴더로 옮기기',findLabel='폴더 찾기',foot:withFoot=true,currentTag='지금 여기',folderIcons=true}){
  let panel=null,input=null,list=null,note=null,foot=null,state=null,popover=false,closing=null,historyOwned=false,outside=null,keep=null,stopFollow=null;
  const HISTORY_KEY='kptuLibraryMovePicker';

  function ensure(){
    if(panel)return;
    panel=document.createElement('div');panel.id=id;panel.className='lu-move-picker';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label',label);panel.tabIndex=-1;
    panel.innerHTML=`<input type="search" class="lu-move-find" placeholder="${esc(findLabel)}" aria-label="${esc(findLabel)}" autocomplete="off" enterkeyhint="search"><div class="lu-move-list" role="group" aria-label="${esc(label)} 목록"></div><p class="lu-move-note" role="status" hidden></p><div class="lu-move-foot"${withFoot?'':' hidden'}></div>`;
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
  const item=(r,labeled)=>`<button type="button" class="lu-move-item" data-lu-move-folder="${esc(r.id)}"${r.enabled?'':' aria-disabled="true"'}${r.current?' aria-current="true"':''}${r.reason?` title="${esc(r.reason)}"`:` title="${esc(r.label)}"`} style="--lu-depth:${labeled?0:r.depth}">${r.dot?`<span class="lu-move-dot ui-color-dot" style="--lu-dot:${esc(r.dot)}" aria-hidden="true"></span>`:folderIcons?pickIconHtml(r):''}<span class="lu-move-name">${esc(labeled?r.label:r.name)}</span>${r.current?`<span class="lu-move-tag">${esc(currentTag)}</span>`:''}</button>`;

  function paint(){
    if(!state)return;
    const q=input.value.trim(),data=state.rows(q),searching=!!q;
    const parts=[];
    if(data.recent.length)parts.push('<p class="lu-move-sec">최근 넣은 폴더</p>'+data.recent.map(r=>item(r,true)).join(''));
    if(data.all.length)parts.push((data.recent.length||searching?`<p class="lu-move-sec">${searching?'찾은 폴더':'전체 폴더'}</p>`:'')+data.all.map(r=>item(r,searching)).join(''));
    if(!parts.length)parts.push(emptyHtml());
    list.innerHTML=parts.join('');
    const reason=[...data.recent,...data.all].find(r=>r.reason)?.reason;
    note.hidden=!reason;note.textContent=reason?`흐린 폴더는 ${reason}. 묶기를 ‘폴더’로 바꾸면 선택할 수 있어요.`:'';
    if(!withFoot){foot.replaceChildren();position();return}
    foot.innerHTML=`<button type="button" class="lu-move-foot-btn" data-lu-move-new${state.canNew?'':' aria-disabled="true"'}>+ 새 폴더 만들어 넣기</button>${state.canOut?`<button type="button" class="lu-move-foot-btn" data-lu-move-out>${esc(state.outLabel||'폴더 밖으로')}</button>`:''}`;
    position();
  }

  function position(){
    if(!state||panel.hidden)return;
    const maxH=Math.max(160,Math.min(440,innerHeight-EDGE*2));
    if(state.place==='below'){
      // S54-04: 버튼 아래 창은 폰·PC 모두 공용 자리 함수 하나로(새 자리 계산 없음).
      panel.classList.remove('lu-move-sheet');
      placeAnchored(panel,state.anchor,{maxWidth:WIDTH,maxHeight:440,gap:GAP,edge:EDGE,bottomInset:bottomInset()});
      return;
    }
    panel.classList.toggle('lu-move-sheet',!wide());
    if(!wide()){
      // 폰 시트(place 'side'): 자리(left·right·bottom)는 CSS(.lu-move-sheet)가 정하고, 여기서는 옆 목록 때 쓴 inline 자리만 지운 뒤 높이 한도만 둔다(같은 값이면 그대로).
      for(const k of ['inset','margin','left','top','right','bottom','width'])panel.style.removeProperty(k);
      const room=innerHeight-(parseFloat(getComputedStyle(panel).bottom)||0)-EDGE,mh=Math.max(120,Math.min(Math.round(innerHeight*0.7),maxH+80,room))+'px';
      if(panel.style.maxHeight!==mh)panel.style.maxHeight=mh;
      return;
    }
    panel.style.width=Math.min(WIDTH,innerWidth-EDGE*2)+'px';panel.style.maxHeight=maxH+'px';
    const a=state.anchor.getBoundingClientRect(),h=Math.min(panel.getBoundingClientRect().height||maxH,maxH),w=Math.min(WIDTH,innerWidth-EDGE*2);
    let left=a.right+GAP;if(left+w>innerWidth-EDGE)left=a.left-w-GAP;
    if(left<EDGE)left=Math.max(EDGE,Math.min(a.left,innerWidth-w-EDGE));
    let top=a.top;
    if(top+h>innerHeight-EDGE)top=innerHeight-EDGE-h;
    panel.style.left=Math.round(left)+'px';panel.style.top=Math.round(Math.max(EDGE,top))+'px';panel.style.right='auto';panel.style.bottom='auto';
  }

  // opts: {anchor, place:'side'|'below', rows(query)->{recent,all,total}, canOut, outLabel(기본 '폴더 밖으로'), canNew, history, onPick(id), onNew(), onOut(), onClosed()}
  function open(opts){
    ensure();
    if(closing){closing.then(()=>open(opts));return}
    if(state)void close();
    state={...opts,place:opts.place||'below'};
    input.value='';clearAnchored(panel);panel.style.removeProperty('right');panel.classList.remove('lu-move-sheet');panel.hidden=false;
    if(popover){try{panel.showPopover()}catch{popover=false;panel.removeAttribute('popover')}}
    paint();
    list.scrollTop=0; // S54-04 ③: 열 때 목록 맨 위(첫 줄)부터
    historyOwned=!!opts.history;
    if(historyOwned)history.pushState({...history.state,[HISTORY_KEY]:true},'',location.href);
    outside=e=>{if(!state||panel.contains(e.target)||state.anchor.contains?.(e.target)||state.keepOpen?.(e.target))return;void close(false,false)};
    document.addEventListener('pointerdown',outside,true);
    // 버튼 아래 창은 공용 followAnchor로 버튼을 따라간다(창 안 목록 scroll은 뺌). 버튼이 화면에서 없어지면 닫고, 잠깐 화면 밖이면 자리만 둔다.
    if(state.place==='below')stopFollow=followAnchor(panel,state.anchor,{place:position,lost:()=>{if(state&&!state.anchor?.isConnected)void close(false,false)}});
    else{
      keep=e=>{if(e?.type==='scroll'&&e.target instanceof Node&&panel.contains(e.target))return;position()};
      window.addEventListener('resize',keep);window.addEventListener('scroll',keep,true);
    }
    window.addEventListener('popstate',onPop);
    (coarse()?panel:input).focus({preventScroll:true});
  }
  function onPop(e){if(state&&historyOwned&&!e.state?.[HISTORY_KEY]){historyOwned=false;void close(true,true)}}
  // 닫기. 끝난 뒤 resolve. fromBack=true는 이미 뒤로가기로 기록이 빠진 경우, restoreFocus=true는 부른 버튼으로 초점을 돌려준다(Esc·왼쪽 화살표·뒤로가기).
  function close(fromBack=false,restoreFocus=false){
    const s=state;if(!s)return closing||Promise.resolve();
    state=null;
    document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',keep);window.removeEventListener('scroll',keep,true);window.removeEventListener('popstate',onPop);
    stopFollow?.();stopFollow=null;keep=null;
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
