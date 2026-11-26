import {pickIconHtml} from './folder-look.js';
import {emptyHtml,waitInlineHtml} from './wait-state.js';
import {placeAnchored,followAnchor,clearAnchored,bottomInset} from './anchored-popup.js';
import {partStyles} from './part-styles.js';
// S67-41: 이 부품의 모양 파일(part-styles.js 표)을 부품이 열리기 전에 붙인다 — 화면 모양 목록에 없어도 꾸밈 없이 그려지지 않게.
await partStyles('library-move-picker');
// LIB-폴더로옮기기 (2026-10-27 17:01 사용자 요청): [폴더로 옮기기 ›]를 누르면 뜨는 작은 폴더 목록(PC·폰 공통, 그리는 곳은 여기 하나).
// 맨 위 '폴더 찾기' 칸 → 최근 넣은 폴더 → 전체 폴더(하위는 들여쓰기) → 아래 [+ 새 폴더 만들어 넣기](canNew+onNew일 때만)·[폴더 밖으로](canOut+onOut일 때만).
// 목록 줄은 library-move.mjs의 pickerRows()가 만든 것을 그대로 그리고, 옮기는 일은 부른 쪽(library-folders.js)이 한다(서버 길은 LIB-폴더탐색기와 같은 하나).
// PC(761px~)는 누른 버튼 옆(자리가 없으면 반대쪽, 버튼이 모서리 도구줄이면 아래)에, 폰(760px 이하)은 아래에서 올라오는 작은 시트로 연다.
// S54-04 UI-고르기창버튼아래(11/08 사용자 결정 B): 버튼으로 연 창(place 'below')은 폰·폴드·PC 모두 누른 버튼 바로 아래 작은 창(아래 자리가 모자라면 위)이다.
//   자리는 공용 placeAnchored·followAnchor(anchored-popup.js)가 정하고, 아래 바(하단바·전환 줄)·자판 높이(bottomInset) 위에서 끝난다. 길면 창 안 목록만 밀린다.
//   열 때 목록은 맨 위(첫 줄)부터 보인다. 메뉴 옆에 여는 창(place 'side')은 그대로(PC는 옆, 폰은 아래 시트).
// 닫기: Esc·바깥 누르기·폴더 고르기·왼쪽 화살표(옆 목록일 때)·폰 뒤로가기(history:true일 때). 닫을 때 부른 버튼으로 돌아간다.
// S52-27 UI-창스크롤(11/07 21:24 사용자 결정): 열 때 초점은 PC(마우스)면 '폴더 찾기' 칸, 손가락 화면(pointer:coarse)이면 창 자체 —
//   폰에서 자판이 저절로 올라와 목록 절반을 덮지 않고, 찾기 칸을 눌렀을 때만 뜬다. 창 안에서 ↓·↑ 이동은 그대로.
// S52-27: 폰 시트는 아래 바(--kptu-mobile-tab-height·--kptu-switch-dock) 위에서 올라오고(library-upload.css), 높이 한도는 그 위 남은 자리 안.
//   창 안 목록이 밀릴 때 나는 scroll은 자리 다시 맞추기(keep)에서 뺀다(anchored-popup.js followAnchor와 같은 규칙) —
//   전에는 목록 scroll마다 position()이 시트의 inline 높이 한도를 지웠다 다시 써서 그 사이 목록 스크롤이 0으로 되돌아가 끝까지 내려가지 않았다.
// LIB-폴더창들어가기(사용자 11/24 18:04 "상위 폴더를 누르면 그 안에 폴더가 열려야 되고 어떤 폴더든지 누르고 확인을 눌러야"):
//   폴더 줄(rows가 parent를 준 줄, library-move.mjs pickerRows)을 그리는 한 개 고르기 창은 '들어가기 + 선택 + 확인'이다(drill).
//   하위 폴더가 있는 폴더를 누르면 그 안으로 들어가고(위에 경로 · ‹ 위로, 맨 위에 '이 폴더로'), 하위 폴더 없는 폴더를 누르면 '선택됨' 표시만 한다.
//   아래 [취소]·[okLabel(기본 '여기로 옮기기')]의 실행 단추를 눌러야 onPick/onOut이 불린다. [폴더 밖으로]도 선택만(눌린 상태).
//   찾는 중에는 경로 이름 목록에서 누르면 선택만. [+ 새 폴더 만들어 넣기]는 이름을 묻는 창이 따로 확인하므로 그대로 바로 한다.
//   여러 개 고르기(multi)·아래 단추 없는 창(foot:false — 매체·자료 고르기)은 전처럼 누르면 바로.
const GAP=4,EDGE=8,WIDTH=248,OUT='\u0000out';
const wide=()=>typeof matchMedia==='function'&&matchMedia('(min-width:761px)').matches;
const coarse=()=>typeof matchMedia==='function'&&matchMedia('(pointer:coarse)').matches;

// S51-8 NEWS-전면개편 P4b: News [매체: 전체 ▾]도 같은 창을 쓴다 — id·창 이름·찾기 칸 글자·아래 단추 줄(foot:false면 없음)만 바꿔 연다. 기본값은 지금 그대로(폴더로 옮기기).
//   줄에 dot(색 토큰 var(...))이 있으면 폴더 그림 대신 작은 색 점, current 표시 글자는 currentTag로 바꾼다.
//   folderIcons:false면(매체 고르기) 점 없는 줄에 폴더 그림을 그리지 않는다.
//   S67-39: 줄에 tag가 있으면 그 줄만 currentTag 대신 그 글자를 꼬리표로 단다(예: 사업 보고 자료 고르기의 '다른 보고에 있음').
export function createMovePicker({esc,id='luMovePicker',label='폴더로 옮기기',findLabel='폴더 찾기',foot:withFoot=true,currentTag='지금 여기',folderIcons=true}){
  let panel=null,input=null,tabs=null,list=null,note=null,foot=null,state=null,popover=false,closing=null,historyOwned=false,outside=null,keep=null,stopFollow=null;
  const HISTORY_KEY='kptuLibraryMovePicker';

  function ensure(){
    if(panel)return;
    panel=document.createElement('div');panel.id=id;panel.className='lu-move-picker';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label',label);panel.tabIndex=-1;
    panel.innerHTML=`<input type="search" class="lu-move-find" placeholder="${esc(findLabel)}" aria-label="${esc(findLabel)}" autocomplete="off" enterkeyhint="search"><div class="lu-move-tabs ds-seg" role="group" aria-label="자료 보기" hidden></div><div class="lu-move-list" role="group" aria-label="${esc(label)} 목록"></div><p class="lu-move-note" role="status" hidden></p><div class="lu-move-foot"${withFoot?'':' hidden'}></div>`;
    input=panel.querySelector('.lu-move-find');tabs=panel.querySelector('.lu-move-tabs');list=panel.querySelector('.lu-move-list');note=panel.querySelector('.lu-move-note');foot=panel.querySelector('.lu-move-foot');
    popover=typeof panel.showPopover==='function'&&typeof panel.hidePopover==='function'&&'popover' in panel;if(popover)panel.setAttribute('popover','manual');
    document.body.append(panel);
    input.addEventListener('input',()=>paint());
    input.addEventListener('keydown',e=>{
      if(e.isComposing||e.keyCode===229)return;
      if(e.key==='Enter'){e.preventDefault();const first=items().find(b=>b.getAttribute('aria-disabled')!=='true'&&!b.classList.contains('lu-move-nav'));if(first)first.click();return}
      if(e.key==='ArrowDown'){e.preventDefault();items()[0]?.focus()}
    });
    panel.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b||!state)return;
      e.stopPropagation();
      if(b.getAttribute('aria-disabled')==='true'||b.disabled)return;
      const s=state;
      // S67-41 보기 단추([최근]·[폴더])와 폴더 줄(nav): 고르기가 아니라 목록만 바꾼다(고른 것은 그대로).
      if(b.dataset.luMoveTab){if(s.view!==b.dataset.luMoveTab){s.view=b.dataset.luMoveTab;s.onView?.(s.view);paintKeep(false)}return}
      if(b.dataset.luMoveNav!==undefined){if(s.drillOn)s.at=b.dataset.luMoveNav||null;else s.onNav?.(b.dataset.luMoveNav||null);paintKeep(false);list.querySelector('.lu-move-item')?.focus({preventScroll:true});return}
      // drill: 하위 폴더가 있는 줄 = 들어가기(옮기지 않음), 다른 줄·'이 폴더로'·[폴더 밖으로] = 선택만, [취소]·실행 단추로 끝낸다.
      if(s.drillOn){
        if(b.hasAttribute('data-lu-move-kids')){enter(b.dataset.luMoveFolder);return}
        const id=b.hasAttribute('data-lu-move-here')?s.at:b.hasAttribute('data-lu-move-out')?OUT:b.dataset.luMoveFolder;
        if(id){const keepId=b.dataset.luMoveFolder,here=b.hasAttribute('data-lu-move-here'),out=b.hasAttribute('data-lu-move-out');s.pick=s.pick===id?null:id;paintKeep(true);
          (here?list.querySelector('[data-lu-move-here]'):out?foot.querySelector('[data-lu-move-out]'):list.querySelector(`[data-lu-move-folder="${CSS.escape(keepId)}"]`))?.focus({preventScroll:true});return}
        if(b.hasAttribute('data-lu-move-cancel')){void close(false,true);return}
        if(b.hasAttribute('data-lu-move-ok')){const id=s.pick;if(!id)return;void finish(()=>id===OUT?s.onOut():s.onPick(id));return}
      }
      // 여러 개 고르기(multi): 줄을 누르면 고름·풀기만 하고, 아래 [넣기 n개]로 한 번에 넘긴다.
      if(s.multi&&b.dataset.luMoveFolder){const id=b.dataset.luMoveFolder;if(s.chosen.has(id))s.chosen.delete(id);else s.chosen.add(id);const top=list.scrollTop;paint();list.scrollTop=top;list.querySelector(`[data-lu-move-folder="${CSS.escape(id)}"]`)?.focus({preventScroll:true});return}
      if(s.multi&&b.hasAttribute('data-lu-move-done')){const ids=[...s.chosen];if(ids.length)void finish(()=>s.onPickMany(ids));return}
      if(b.dataset.luMoveFolder)void finish(()=>s.onPick(b.dataset.luMoveFolder));
      // 값 없는 표시(data-lu-move-new·data-lu-move-out)는 dataset 값이 ''라 참/거짓으로 보면 안 된다: 있는지로 본다.
      else if(b.hasAttribute('data-lu-move-new'))void finish(()=>s.onNew());
      else if(b.hasAttribute('data-lu-move-out'))void finish(()=>s.onOut());
    });
    panel.addEventListener('keydown',e=>{
      if(!state)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();void close(false,true);return}
      // drill: → = 하위 폴더 있는 줄로 들어가기, ← = 한 단계 위(맨 위이고 옆 목록이면 닫기).
      if(state.drillOn&&e.target!==input&&e.key==='ArrowRight'&&e.target.hasAttribute?.('data-lu-move-kids')){e.preventDefault();enter(e.target.dataset.luMoveFolder);return}
      if(state.drillOn&&e.target!==input&&e.key==='ArrowLeft'&&state.at){e.preventDefault();state.at=parentOf(state.at);paintKeep(false);items()[0]?.focus({preventScroll:true});return}
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
  // drill 도움: 폴더 줄 전체(찾지 않은 rows 결과), 위 폴더, 들어가기.
  const drillRows=()=>state?.rows('',state.view)?.all||[];
  const parentOf=id=>drillRows().find(r=>r.id===id)?.parent||null;
  function enter(id){if(!state||!id)return;state.at=id;paintKeep(false);items()[0]?.focus({preventScroll:true})}
  const paintKeep=keep=>{const top=list.scrollTop;paint();list.scrollTop=keep?top:0};
  // S67-41: 줄 앞 형식 꼬리표(kind: PDF·HWP·사진), 뒤 날짜(meta), 폴더로 들어가는 줄(nav: id 또는 '' = 위로)은 고르기 없이 목록만 바꾼다.
  const extra=r=>`${r.kind?`<span class="lu-move-kind">${esc(r.kind)}</span>`:''}`;
  // 줄 하나의 그리는 곳. nav 줄(폴더로 들어가기·위로)은 고르기 표시 없이 data-lu-move-nav만 단다.
  const item=(r,labeled)=>{
    const nav=r.nav!==undefined,chev=t=>`<span class="lu-move-chev" aria-hidden="true">${t}</span>`;
    const attrs=nav?` class="lu-move-item lu-move-nav${r.back?' lu-move-back':''}" data-lu-move-nav="${esc(r.nav)}" title="${esc(r.label||r.name)}" style="--lu-depth:0"`
      :` class="lu-move-item${r.here?' lu-move-here':''}" ${r.here?'data-lu-move-here':`data-lu-move-folder="${esc(r.id)}"`}${r.into?' data-lu-move-kids':''}${r.enabled||r.into?'':' aria-disabled="true"'}${r.current?' aria-current="true"':''}${state?.multi&&r.enabled?` aria-pressed="${state.chosen.has(r.id)}"`:''}${state?.drillOn&&!r.into&&r.enabled?` aria-pressed="${state.pick===r.id}"`:''}${r.reason?` title="${esc(r.reason)}"`:` title="${esc(r.label)}"`} style="--lu-depth:${labeled||state?.drillOn?0:r.depth}"`;
    const lead=nav?(r.back?chev('‹'):pickIconHtml(r)):r.dot?`<span class="lu-move-dot ui-color-dot" style="--lu-dot:${esc(r.dot)}" aria-hidden="true"></span>`:folderIcons?pickIconHtml(r):'';
    const name=nav?r.name:r.here?'이 폴더로':labeled?r.label:r.name;
    const tag=nav?'':state?.drillOn&&state.pick===r.id?'선택됨':(r.current||r.tag)?(r.tag||currentTag):'';
    return `<button type="button"${attrs}>${lead}${nav?'':extra(r)}<span class="lu-move-name">${esc(name)}</span>${tag?`<span class="lu-move-tag">${esc(tag)}</span>`:''}${r.meta?`<span class="lu-move-meta">${esc(r.meta)}</span>`:''}${nav&&!r.back?chev('›'):''}${r.into?'<span class="lu-move-chev lu-move-into" aria-hidden="true"></span>':''}</button>`;
  };

  function paint(){
    if(!state)return;
    const q=input.value.trim(),data=state.rows(q,state.view),searching=!!q;
    // 폴더 줄(parent를 준 줄)·한 개 고르기·아래 단추 있는 창이면 drill.
    state.drillOn=!state.multi&&withFoot&&[...data.recent,...data.all].some(r=>r&&'parent' in r);
    panel.classList.toggle('lu-move-drill',!!state.drillOn);
    paintTabs();
    if(state.drillOn){paintDrill(data,searching);return}
    const parts=[];
    const sec={recent:'최근 넣은 폴더',all:'전체 폴더',found:'찾은 폴더',...state.sections};
    if(data.recent.length)parts.push(`<p class="lu-move-sec">${esc(sec.recent)}</p>`+data.recent.map(r=>item(r,true)).join(''));
    const row=r=>item(r,searching);
    const allLabel=data.allLabel||(searching?sec.found:sec.all);
    if(data.all.length)parts.push((data.recent.length||searching||state.sections||data.allLabel?`<p class="lu-move-sec">${esc(allLabel)}</p>`:'')+data.all.map(row).join(''));
    if(!parts.length)parts.push(data.waiting?waitInlineHtml():emptyHtml());
    list.innerHTML=parts.join('');
    const reason=[...data.recent,...data.all].find(r=>r.reason)?.reason;
    note.hidden=!reason;note.textContent=reason?`흐린 폴더는 ${reason}. 묶기를 ‘폴더’로 바꾸면 선택할 수 있어요.`:'';
    if(state.multi){
      const n=state.chosen.size;
      foot.innerHTML=`<button type="button" class="primary lu-move-done" data-lu-move-done${n?'':' disabled'}>${esc(state.doneLabel?.(n)||`넣기 ${n}개`)}</button>`;
      foot.hidden=false;position();return;
    }
    if(!withFoot){foot.replaceChildren();position();return}
    // S61-46 UI-새폴더넣기안됨: [+ 새 폴더 만들어 넣기]는 만들 수 있는 곳(canNew + onNew)에만 그린다 — 흐린 채 눌러도 안 되는 단추는 두지 않는다.
    const canNew=!!state.canNew&&typeof state.onNew==='function',canOut=!!state.canOut&&typeof state.onOut==='function';
    foot.innerHTML=footHtml(canNew,canOut,null);
    foot.hidden=!canNew&&!canOut;
    position();
  }

  // drill 그리기: 찾는 중이면 경로 이름 목록(누르면 선택), 아니면 지금 들어간 폴더 바로 안 폴더들(하위 있는 줄은 › = 들어가기).
  function paintDrill(data,searching){
    const s=state,all=drillRows(),byId=new Map(all.map(r=>[r.id,r]));
    if(s.at&&!byId.has(s.at))s.at=null;
    if(s.pick&&s.pick!==OUT&&!byId.has(s.pick))s.pick=null;
    const kids=new Set(all.map(r=>r.parent).filter(Boolean));
    const parts=[];
    if(searching){
      if(data.all.length)parts.push(`<p class="lu-move-sec">찾은 폴더</p>`+data.all.map(r=>item({...r,into:false},true)).join(''));
    }else{
      if(s.at){
        const here=byId.get(s.at),up=here?.parent||null,trail=[];let c=here,guard=0;while(c&&guard++<100){trail.unshift(c.name);c=c.parent?byId.get(c.parent):null}
        parts.push(`<p class="lu-move-sec lu-move-path">${esc(['맨 위',...trail].join(' › '))}</p>`);
        parts.push(item({nav:up||'',back:true,name:up?byId.get(up)?.name||'위로':'맨 위',label:'위로'},true));
        if(here)parts.push(item({...here,here:true,into:false},false));
      }else if(data.recent.length)parts.push(`<p class="lu-move-sec">최근 넣은 폴더</p>`+data.recent.map(r=>item({...r,into:false},true)).join(''));
      const rows=all.filter(r=>(r.parent||null)===(s.at||null)).map(r=>({...r,into:kids.has(r.id)}));
      if(rows.length)parts.push((!s.at&&data.recent.length?`<p class="lu-move-sec">전체 폴더</p>`:'')+rows.map(r=>item(r,false)).join(''));
    }
    if(!parts.length)parts.push(data.waiting?waitInlineHtml():emptyHtml());
    list.innerHTML=parts.join('');
    const reason=all.find(r=>r.reason)?.reason;
    note.hidden=!reason;note.textContent=reason?`흐린 폴더는 ${reason}. 묶기를 ‘폴더’로 바꾸면 선택할 수 있어요.`:'';
    const canNew=!!s.canNew&&typeof s.onNew==='function',canOut=!!s.canOut&&typeof s.onOut==='function';
    const picked=s.pick===OUT?(s.outLabel||'폴더 밖으로'):s.pick?byId.get(s.pick)?.label||'':'';
    foot.innerHTML=footHtml(canNew,canOut,s.pick===OUT)
      +`<p class="lu-move-chosen" role="status">${picked?`선택: ${esc(picked)}`:'폴더를 눌러 선택하세요'}</p>`
      +`<div class="lu-move-acts"><button type="button" class="secondary lu-move-cancel" data-lu-move-cancel>취소</button><button type="button" class="primary lu-move-ok" data-lu-move-ok${s.pick?'':' disabled'}>${esc(s.okLabel||'여기로 옮기기')}</button></div>`;
    foot.hidden=false;
    position();
  }

  // 아래 [+ 새 폴더 만들어 넣기]·[폴더 밖으로] 한 곳. outPressed: drill에서 [폴더 밖으로]를 선택했나(null = 누르면 바로).
  function footHtml(canNew,canOut,outPressed){
    return `${canNew?'<button type="button" class="lu-move-foot-btn" data-lu-move-new>+ 새 폴더 만들어 넣기</button>':''}${canOut?`<button type="button" class="lu-move-foot-btn" data-lu-move-out${outPressed===null?'':` aria-pressed="${outPressed}"`}>${esc(state.outLabel||'폴더 밖으로')}</button>`:''}`;
  }

  function paintTabs(){
    const list=state?.views||[];
    tabs.hidden=!list.length;
    tabs.innerHTML=list.map(v=>`<button type="button" class="ds-seg-btn" data-lu-move-tab="${esc(v.id)}" aria-pressed="${v.id===state.view}">${esc(v.label)}</button>`).join('');
  }

  function position(){
    if(!state||panel.hidden)return;
    const maxH=Math.max(160,Math.min(440,innerHeight-EDGE*2));
    if(state.place==='below'){
      // S54-04: 버튼 아래 창은 폰·PC 모두 공용 자리 함수 하나로(새 자리 계산 없음).
      panel.classList.remove('lu-move-sheet');
      placeAnchored(panel,state.anchor,{maxWidth:state.width||WIDTH,maxHeight:440,gap:GAP,edge:EDGE,bottomInset:bottomInset()});
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

  // 여러 개 고르기: opts.multi=true면 줄은 고름 표시(aria-pressed)만 바꾸고 아래 [doneLabel(n)]이 onPickMany(ids)를 부른다. sections로 줄 묶음 이름을 바꾼다.
  // S67-41: views:[{id,label}]·view·onView(id) = 찾기 칸 아래 보기 단추, rows(query, view)의 둘째 값. width = 창 폭 한도(기본 248). onNav(id|null) = nav 줄.
  // 줄(rows): kind(형식 꼬리표)·meta(날짜)·nav(폴더로 들어가는 줄, back:true면 위로)·allLabel(아래 묶음 이름 바꾸기, data에).
  // okLabel(drill 실행 단추 글자, 기본 '여기로 옮기기' — 옮기지 않고 정하기만 하는 곳은 '선택').
  // opts: {anchor, place:'side'|'below', rows(query)->{recent,all,total}, multi, doneLabel(n), onPickMany(ids), sections:{recent,all,found}, canOut, outLabel(기본 '폴더 밖으로'), canNew, history, onPick(id), onNew(), onOut(), onClosed()}
  function open(opts){
    ensure();
    if(closing){closing.then(()=>open(opts));return}
    if(state)void close();
    state={...opts,place:opts.place||'below',chosen:new Set(),view:opts.view||opts.views?.[0]?.id||null,at:null,pick:null,drillOn:false};
    panel.style.setProperty('--lu-move-width',(opts.width||WIDTH)+'px');
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
  return {open,close,reposition:position,refresh:()=>{if(state&&!panel.hidden)paintKeep(true)},get isOpen(){return !!state},contains:n=>!!panel&&panel.contains(n),get element(){return panel}};
}
