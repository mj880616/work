// LIB-받는폴더나누기(S60-18, 시안 docs/design/mockups/lib-receive-sort.html, 명진 11/12 09:52~09:53): 받는 폴더(잡동사니)에 쌓인 자료를 알맞은 폴더로 나누는 창.
// [폴더로 나누기](받는 폴더 위치 줄·두 칸 칸 머리·폴더 메뉴)를 누르면 창이 바로 뜨고, 제안은 뒤에서 채운다:
//   ① 지금 규칙(library-sort-model.mjs ruleSuggestions — AI 없음) ② 못 찾은 것만 서버 AI(ai-assist kind=library_sort, 내 작업공간 자료·폴더 이름만)
//   ③ 기존 폴더로 담기 어려우면 새 폴더(이름 + 놓을 자리) 제안. 명진이 체크를 풀거나 '📁 … ▾'로 폴더를 바꾸고, 새 폴더 이름·자리도 그 자리에서 고친다.
// [옮기기]를 눌러야 새 폴더를 만들고 옮긴다(AI는 제안까지). 쓰기는 기존 소유자 RLS 표 두 개(app_library_folders·app_library_folder_items).
// 옮기기는 '지금 받는 폴더에 든 연결'만 바꾼다(folder_id=받는 폴더 조건) — 그 사이 다른 기기에서 옮긴 자료는 건드리지 않는다.
// 되돌리기 한 번: 이번에 옮긴 것 중 아직 그 폴더에 있는 것만 받는 폴더로, 이번에 만든 폴더는 비어 있으면 지운다(휴지통을 거쳐 영구 삭제).
// 저절로 뜨는 알림 없음, 기기 저장 없음.
import {callAiAssist} from './basket-ai-summary.js';
import {createMovePicker} from './library-move-picker.js';
import {pickerRows} from './library-move.mjs';
import {ftIconHtml} from './folder-tree-ui.mjs';
import {waitInlineHtml,emptyHtml} from './wait-state.js';
import {fileKindOf,folderSiblings,nextSortOrder,canAddChild,folderErrorText} from './library-tree.js';
import {receiveUnits,ruleSuggestions,startRows,aiBatches,mergeAi,settleRows,renameGroup,placeGroup,applyPlan,sortSummary,doneText,tidyUnits,tidyGroups,tidyPlan,retargetGroup,tidyAtText,tidySummary} from './library-sort-model.mjs';

const T_FOLDERS='/rest/v1/app_library_folders',T_ITEMS='/rest/v1/app_library_folder_items',CHUNK=100;
const enc=encodeURIComponent;
export const SORT_LABEL='폴더로 나누기';
export const sortButtonHtml=(extra='')=>`<button type="button" class="row-act lu-sort-btn${extra?' '+extra:''}" data-lu-sort>${SORT_LABEL}</button>`;

// state(): {workspace, folders, items, docs, listDocs, receiveId, categoryOf}
// say(text,{error,undo}): '… · 되돌리기' 한 줄. reload(): 폴더·연결 다시 읽고 그리기.
export function createReceiveSort({api,esc,state,reload,say,ai=callAiAssist}){
  let root=null,rows=[],groups=[],busy=false,run=0,trigger=null,picker=null;
  const s=()=>state();
  const units=()=>receiveUnits(s().listDocs,s().items,s().receiveId);
  const folderOf=id=>s().folders.find(f=>f.id===id);
  const pathName=id=>{const out=[];let f=folderOf(id),g=0;while(f&&g++<102){out.unshift(f.name);f=f.parent_id?folderOf(f.parent_id):null}return out.join(' › ')};
  const groupOf=gid=>groups.find(g=>g.gid===gid);
  const groupPath=g=>(g.parent?pathName(g.parent)+' › ':'')+g.name;
  const sharedPicker=()=>(picker||=createMovePicker({esc,id:'luSortPicker',label:'폴더 선택'}));

  function ensure(){
    if(root)return root;
    document.body.insertAdjacentHTML('beforeend',`<div id="librarySortModal" class="modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="librarySortTitle"><div class="modal-card small-card lu-sort-card"><div class="modal-head"><div><h2 id="librarySortTitle">폴더로 나누기 제안</h2><p id="librarySortSub" class="lu-sort-sub" aria-live="polite"></p></div><button class="icon-btn" type="button" data-sort-close aria-label="닫기">×</button></div><div class="lu-sort-list" id="librarySortList"></div><p class="status" id="librarySortStatus" role="status"></p><div class="modal-action-footer"><button class="secondary" type="button" data-sort-close>닫기</button><button class="primary" type="button" data-sort-apply>옮기기</button></div></div></div>`);
    root=document.querySelector('#librarySortModal');
    root.addEventListener('click',onClick);
    root.addEventListener('change',onChange);
    root.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('[data-sort-gname]')){e.preventDefault();e.target.blur()}});
    root.addEventListener('focusout',e=>{if(e.target.matches?.('[data-sort-gname]'))nameChanged(e.target)});
    return root;
  }
  const isOpen=()=>!!root&&!root.classList.contains('hidden');
  function close(){
    if(!isOpen())return;run++;picker?.close?.();
    root.classList.add('hidden');root.setAttribute('aria-hidden','true');
    if(window.KPTUA11y?.dialog?.deactivate)window.KPTUA11y.dialog.deactivate(root);else if(trigger?.isConnected)trigger.focus({preventScroll:true});
  }

  // ---- 그리기 ----
  // 폴더 그림은 나무·고르기 창과 같은 공용 그림(folder-tree-ui.mjs, 고른 색 그대로).
  const icon=id=>ftIconHtml({color:Number.isInteger(folderOf(id)?.color)?folderOf(id).color:null,open:false,className:'ft-ico lu-sort-ico'});
  function rowHtml(r,firstOfGroup){
    const d=s().docs.find(x=>x.id===r.ids[0]),kind=r.photoset?'그림':fileKindOf(d?.file_name||r.title,d?.mime_type),
      target=r.wait?`<span class="lu-sort-wait">${waitInlineHtml()}</span>`
        :r.to?.folder?`<button type="button" class="row-act lu-sort-pick" data-sort-pick="${esc(r.key)}" aria-haspopup="true">${icon(r.to.folder)}${esc(pathName(r.to.folder))} ▾</button>`
        :r.to?.group?`<button type="button" class="row-act lu-sort-pick" data-sort-pick="${esc(r.key)}" aria-haspopup="true">${icon(null)}${esc(groupPath(groupOf(r.to.group)))} ▾</button><span class="lu-sort-nf">새 폴더</span>`
        :`<button type="button" class="row-act lu-sort-pick" data-sort-pick="${esc(r.key)}" aria-haspopup="true">${icon(null)}폴더 선택 ▾</button>`;
    const g=r.to?.group&&firstOfGroup?groupOf(r.to.group):null;
    const edit=g?`<span class="lu-sort-edit"><span class="lu-sort-edit-label" aria-hidden="true">새 폴더 이름</span><input type="text" maxlength="40" autocomplete="off" aria-label="새 폴더 이름" data-sort-gname="${esc(g.gid)}" value="${esc(g.name)}"><button type="button" class="row-act lu-sort-pick" data-sort-place="${esc(g.gid)}" aria-haspopup="true">놓을 자리: ${esc(g.parent?pathName(g.parent):'맨 위')} ▾</button></span>`:'';
    return `<div class="lu-sort-row${r.to?.group?' lu-sort-row-new':''}" data-sort-row="${esc(r.key)}"><input type="checkbox" class="lu-sort-check" data-sort-check="${esc(r.key)}" aria-label="${esc(r.title)} 옮기기"${r.checked?' checked':''}${r.to&&!r.wait?'':' disabled'}><span class="lu-sort-name"><span class="lu-sort-kind">${esc(kind)}</span> ${esc(r.title)}${r.ids.length>1?` <small>(${r.ids.length}장)</small>`:''}</span><span class="lu-sort-to">→ ${target}</span>${r.why&&!r.wait?`<span class="lu-sort-why">${esc(r.why)}</span>`:''}${edit}</div>`;
  }
  function paint(){
    if(!root)return;
    const seen=new Set(),line=r=>{const first=!!r.to?.group&&!seen.has(r.to.group);if(first)seen.add(r.to.group);return rowHtml(r,first)};
    const placed=rows.filter(r=>r.wait||r.to),stay=rows.filter(r=>!r.wait&&!r.to);
    const list=root.querySelector('#librarySortList'),y=list.scrollTop,was=list.querySelector('.lu-sort-stay');
    // '그대로 둬요' 묶음은 다시 그려도 사람이 연 상태 그대로(처음엔 다른 제안이 없을 때만 펼침).
    const openStay=was?was.open:!placed.length;
    list.innerHTML=placed.map(line).join('')+(stay.length?`<details class="lu-sort-stay"${openStay?' open':''}><summary>어디에도 맞지 않는 ${stay.length}개 — 그대로 둬요</summary>${stay.map(line).join('')}</details>`:'')+(rows.length?'':emptyHtml('없음'));
    list.scrollTop=y;
    root.querySelector('#librarySortSub').textContent=sortSummary(rows);
    const n=rows.filter(r=>r.checked&&r.to).length,b=root.querySelector('[data-sort-apply]');
    b.textContent=`선택한 ${n}개 옮기기`;b.disabled=!n||busy;
  }
  const say2=(text,error=false)=>{if(!root)return;const el=root.querySelector('#librarySortStatus');el.textContent=text;el.className=error?'status error':'status'};

  // ---- 열기: 창 먼저, 제안은 뒤에서 ----
  async function open(from){
    const r=s().receiveId;if(!r)return;
    trigger=from||document.activeElement;ensure();
    const list=units(),me=++run;
    groups=[];rows=startRows(list,ruleSuggestions(list,{docs:s().docs,items:s().items,folders:s().folders,receiveId:r,categoryOf:s().categoryOf||(c=>c)}));
    say2('');paint();
    root.classList.remove('hidden');root.setAttribute('aria-hidden','false');
    window.KPTUA11y?.dialog?.activate?.(root,{trigger,initialFocus:root.querySelector('[data-sort-close]'),onRequestClose:close});
    if(!window.KPTUA11y?.dialog)root.querySelector('[data-sort-close]')?.focus();
    let failed='';
    for(const ids of aiBatches(rows)){
      const res=await ai({kind:'library_sort',document_ids:ids});
      if(me!==run)return;
      if(!res?.ok){failed=res?.code||'error';break}
      ({rows,groups}=mergeAi(rows,groups,res.data,{folders:s().folders,receiveId:r}));
      // 이번 묶음에서 답이 없던 줄은 '그대로 둬요'로(다음 묶음을 기다리지 않게).
      const asked=new Set(ids);rows=rows.map(x=>x.wait&&asked.has(x.ids[0])?{...x,wait:false,checked:false,to:null}:x);
      paint();
    }
    if(me!==run)return;
    if(rows.some(x=>x.wait)){rows=settleRows(rows);paint()}
    if(failed)say2(failed==='ai_monthly_cap'?'이번 달 AI 사용 한도(3,000원)를 다 썼어요. 다음 달 1일에 다시 쓸 수 있어요. 규칙으로 찾은 것만 보여요.':failed==='daily_limit'||failed==='monthly_limit'?'오늘 AI 사용량을 다 써서 규칙으로 찾은 것만 보여요.':'AI 제안을 받지 못해 규칙으로 찾은 것만 보여요. 나머지는 폴더를 직접 선택해 주세요.');
  }

  // ---- 고치기 ----
  function onChange(e){
    const c=e.target.closest?.('[data-sort-check]');if(!c)return;
    rows=rows.map(r=>r.key===c.dataset.sortCheck?{...r,checked:c.checked}:r);paint();
  }
  function nameChanged(input){
    const next=renameGroup(groups,input.dataset.sortGname,input.value);
    if(!next){say2('폴더 이름은 1~40자로 써 주세요.',true);input.value=groupOf(input.dataset.sortGname)?.name||'';return}
    if(next.some((g,i)=>g.name!==groups[i].name)){groups=next;say2('');paint()}
  }
  function onClick(e){
    if(e.target.closest('[data-sort-close]')){close();return}
    if(e.target.closest('[data-sort-apply]')){void apply();return}
    const pick=e.target.closest('[data-sort-pick]');if(pick){choose(pick);return}
    const place=e.target.closest('[data-sort-place]');if(place)choosePlace(place);
  }
  // 줄의 폴더 바꾸기: 지금 폴더 고르기 창(공용 부품). 받는 폴더 자신은 '지금 여기'로 흐리게. [+ 새 폴더 만들어 넣기]는 새 폴더 제안(이름은 바로 고침).
  function choose(btn){
    const r=rows.find(x=>x.key===btn.dataset.sortPick);if(!r)return;
    const rc=s().receiveId,docs=r.ids.map(id=>({id,project_id:null})),itemFolder=new Map(r.ids.map(id=>[id,rc]));
    sharedPicker().open({anchor:btn,place:'below',history:false,canNew:true,canOut:false,
      rows:q=>pickerRows({folders:s().folders,docs,itemFolder,free:true,query:q}),
      onPick:id=>{if(id===rc)return;rows=rows.map(x=>x.key===r.key?{...x,to:{folder:id},checked:true,why:x.to?.folder===id?x.why:'직접 선택한 폴더예요'}:x);paint();focusRow(r.key)},
      onNew:()=>{const g={gid:'n'+(groups.length+1)+'u',name:'새 폴더',parent:null};groups=[...groups,g];rows=rows.map(x=>x.key===r.key?{...x,to:{group:g.gid},checked:true,why:'직접 만든 새 폴더예요'}:x);paint();root.querySelector(`[data-sort-gname="${g.gid}"]`)?.select?.()}});
  }
  // 새 폴더 놓을 자리: 기존 폴더 안(100단 안) 또는 맨 위.
  function choosePlace(btn){
    const g=groupOf(btn.dataset.sortPlace);if(!g)return;
    sharedPicker().open({anchor:btn,place:'below',history:false,canNew:false,canOut:true,outLabel:'맨 위',
      rows:q=>{const d=pickerRows({folders:s().folders,docs:[],free:true,query:q});const ok=x=>({...x,enabled:x.enabled&&canAddChild(s().folders,x.id)});return {...d,recent:d.recent.map(ok),all:d.all.map(ok)}},
      onPick:id=>{if(!canAddChild(s().folders,id))return;groups=placeGroup(groups,g.gid,id);paint()},
      onOut:()=>{groups=placeGroup(groups,g.gid,null);paint()}});
  }
  function focusRow(key){root?.querySelector(`[data-sort-pick="${CSS.escape(key)}"]`)?.focus({preventScroll:true})}

  // ---- 옮기기 ----
  async function apply(){
    if(busy)return;
    const plan=applyPlan(rows,groups),rc=s().receiveId,ws=s().workspace;
    if(!plan.count||!rc)return;
    busy=true;paint();say2('옮기는 중…');
    const made=new Map(),moved=[];let failed=0;
    try{
      for(const g of plan.create){
        const sib=folderSiblings(s().folders,{parentId:g.parent,free:true});
        const out=await api(T_FOLDERS+'?select=id',{method:'POST',prefer:'return=representation',body:{workspace_id:ws,project_id:null,parent_id:g.parent||null,name:g.name,sort_order:nextSortOrder([...sib,...[...made.values()].filter(m=>m.parent===g.parent)])},singleFlight:false});
        const id=Array.isArray(out)?out[0]?.id:null;if(!id)throw new Error('folder create failed');
        made.set(g.gid,{id,parent:g.parent,sort_order:0});
      }
      for(const m of plan.moves){
        const to=m.folder||made.get(m.group)?.id;if(!to){failed+=m.ids.length;continue}
        for(let i=0;i<m.ids.length;i+=CHUNK){
          const part=m.ids.slice(i,i+CHUNK);
          try{
            const out=await api(T_ITEMS+`?workspace_id=eq.${enc(ws)}&folder_id=eq.${enc(rc)}&document_id=in.(${part.map(enc).join(',')})&select=document_id`,{method:'PATCH',prefer:'return=representation',body:{folder_id:to},singleFlight:false});
            const done=(Array.isArray(out)?out:[]).map(x=>x?.document_id).filter(Boolean);
            moved.push({to,ids:done});failed+=part.length-done.length;
          }catch{failed+=part.length}
        }
      }
    }catch(e){
      busy=false;say2(folderErrorText(e),true);
      // 만든 폴더가 있고 아무것도 못 옮겼으면 그 폴더도 치운다.
      if(made.size&&!moved.length)await removeEmpty([...made.values()].map(m=>m.id));
      try{await reload()}catch{}paint();return;
    }
    busy=false;
    const count=moved.reduce((n,m)=>n+m.ids.length,0),madeIds=[...made.values()].map(m=>m.id);
    try{await reload()}catch{}
    close();
    if(!count&&!madeIds.length){say('옮기지 못했어요. 목록을 확인해 주세요.',{error:true});return}
    say(doneText(count,madeIds.length,failed),{error:failed>0,undo:()=>undo(moved,madeIds,rc,ws)});
  }
  // 되돌리기: 이번에 옮긴 것 중 아직 그 폴더에 있는 것만 받는 폴더로. 이번에 만든 폴더는 비어 있으면(자료·하위 폴더 없음) 지운다.
  async function undo(moved,madeIds,rc,ws){
    let back=0,miss=0;
    for(const m of moved)for(let i=0;i<m.ids.length;i+=CHUNK){
      const part=m.ids.slice(i,i+CHUNK);
      try{const out=await api(T_ITEMS+`?workspace_id=eq.${enc(ws)}&folder_id=eq.${enc(m.to)}&document_id=in.(${part.map(enc).join(',')})&select=document_id`,{method:'PATCH',prefer:'return=representation',body:{folder_id:rc},singleFlight:false});const n=Array.isArray(out)?out.length:0;back+=n;miss+=part.length-n}
      catch{miss+=part.length}
    }
    const kept=await removeEmpty(madeIds,ws);
    try{await reload()}catch{}
    say(`되돌렸어요 · ${back}개를 받는 폴더로${kept?` · 자료가 남은 새 폴더 ${kept}개는 두었어요`:''}${miss?` · ${miss}개는 그 사이 옮겨져 그대로 두었어요`:''}`,{error:miss>0});
  }
  const removeEmpty=(ids,ws=s().workspace)=>removeEmptyFolders(api,ids,ws);
  return {open,close,count:()=>units().length,get busy(){return busy}};
}

// 이번에 만든 폴더 중 비어 있는 것(자료·하위 폴더 없음)만 지운다 — 받는 폴더 나누기·정돈 제안의 되돌리기가 같이 쓴다. 반환: 자료가 남아 둔 폴더 수.
async function removeEmptyFolders(api,ids,ws){
  let kept=0;
  for(const id of [...ids].reverse()){
    try{
      const [it,sub]=await Promise.all([api(T_ITEMS+`?workspace_id=eq.${enc(ws)}&folder_id=eq.${enc(id)}&select=document_id&limit=1`),api(T_FOLDERS+`?workspace_id=eq.${enc(ws)}&parent_id=eq.${enc(id)}&select=id&limit=1`)]);
      if((Array.isArray(it)&&it.length)||(Array.isArray(sub)&&sub.length)){kept++;continue}
      // 폴더 DELETE는 서버가 휴지통 표시로 바꾼다(TRASH-다른삭제). 이번에 만든 빈 폴더라 휴지통에 남기지 않고 바로 영구 삭제한다.
      await api(T_FOLDERS+`?id=eq.${enc(id)}&workspace_id=eq.${enc(ws)}`,{method:'DELETE',prefer:'return=minimal',singleFlight:false});
      try{await api('/rest/v1/rpc/app_trash_purge',{method:'POST',body:{p_kind:'library_folder',p_id:id},singleFlight:false})}catch{}
    }catch{kept++}
  }
  return kept;
}

// ---- LIB-정돈제안(S61-13, 시안 docs/design/mockups/lib-tidy-suggest.html, 명진 11/13 04:31·04:36 ㅇ) ----
// (기다림 표시는 공용 waitInlineHtml — 따로 쓴 기다림 글자 없음.)
// 자료실 맨 위 ⋯·빈 자리 우클릭·폴더 메뉴의 [정돈 제안] → 같은 종류인데 폴더가 둘 이상으로 갈라진 자료를 묶음으로 보여 준다(폴더 메뉴에서 열면 그 폴더 안만).
// 받는 폴더 나누기와 같은 부품: 같은 창 모양(lu-sort-*)·같은 폴더 고르기 창(createMovePicker)·같은 옮기기 길(소유자 RLS 표 두 개)·같은 되돌리기(빈 새 폴더 지우기).
// 묶음 찾기는 1차로 규칙만(library-sort-model.mjs tidyGroups — AI 없음). 녹음('회의 녹음' 폴더·소리 파일)은 묶음에서 뺀다.
// [옮기기]를 눌러야 옮긴다. 옮기기는 '지금 그 폴더에 든 연결'만 바꾸고(folder_id=원래 폴더 조건), 폴더 밖 자료는 연결을 새로 넣는다.
// 되돌리기 한 번: 이번에 옮긴 것 중 아직 옮긴 폴더에 있는 것만 원래 자리로(폴더 밖이던 것은 연결을 지움), 이번에 만든 폴더는 비어 있으면 지운다.
// Drive 원본 파일은 그대로, 자료실 폴더 연결만 바뀐다. 저절로 돌지 않음, 기기 저장 없음.
export const TIDY_LABEL='정돈 제안';
export function createTidySuggest({api,esc,state,reload,say}){
  let root=null,groups=[],made=[],busy=false,run=0,trigger=null,picker=null,scope=null,done=false;
  const s=()=>state();
  const folderOf=id=>s().folders.find(f=>f.id===id);
  const pathName=id=>{const out=[];let f=folderOf(id),g=0;while(f&&g++<102){out.unshift(f.name);f=f.parent_id?folderOf(f.parent_id):null}return out.join(' › ')};
  const shortName=id=>folderOf(id)?.name||'폴더';
  const newOf=gid=>made.find(g=>g.gid===gid);
  const groupOf=gid=>groups.find(g=>g.gid===gid);
  const sharedPicker=()=>(picker||=createMovePicker({esc,id:'luTidyPicker',label:'폴더 선택'}));
  const icon=id=>ftIconHtml({color:Number.isInteger(folderOf(id)?.color)?folderOf(id).color:null,open:false,className:'ft-ico lu-sort-ico'});

  function ensure(){
    if(root)return root;
    document.body.insertAdjacentHTML('beforeend',`<div id="libraryTidyModal" class="modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="libraryTidyTitle"><div class="modal-card small-card lu-sort-card lu-tidy-card"><div class="modal-head"><div><h2 id="libraryTidyTitle">정돈 제안</h2><p id="libraryTidySub" class="lu-sort-sub" aria-live="polite"></p></div><button class="icon-btn" type="button" data-tidy-close aria-label="닫기">×</button></div><div class="lu-sort-list" id="libraryTidyList"></div><p class="status" id="libraryTidyStatus" role="status"></p><div class="modal-action-footer"><button class="secondary" type="button" data-tidy-close>닫기</button><button class="primary" type="button" data-tidy-apply>옮기기</button></div></div></div>`);
    root=document.querySelector('#libraryTidyModal');
    root.addEventListener('click',onClick);
    root.addEventListener('change',onChange);
    root.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('[data-tidy-gname]')){e.preventDefault();e.target.blur()}});
    root.addEventListener('focusout',e=>{if(e.target.matches?.('[data-tidy-gname]'))nameChanged(e.target)});
    return root;
  }
  const isOpen=()=>!!root&&!root.classList.contains('hidden');
  function close(){
    if(!isOpen())return;run++;picker?.close?.();
    root.classList.add('hidden');root.setAttribute('aria-hidden','true');
    if(window.KPTUA11y?.dialog?.deactivate)window.KPTUA11y.dialog.deactivate(root);else if(trigger?.isConnected)trigger.focus({preventScroll:true});
  }

  // ---- 그리기 ----
  const fromText=from=>from?shortName(from):'폴더 밖';
  function targetHtml(g){
    if(g.to.folder)return `<button type="button" class="row-act lu-sort-pick" data-tidy-pick="${esc(g.gid)}" aria-haspopup="true" aria-label="${esc(g.word)} 묶음 옮길 폴더: ${esc(pathName(g.to.folder))}">${icon(g.to.folder)}${esc(pathName(g.to.folder))} ▾</button>`;
    const n=newOf(g.to.group);if(!n)return '';
    return `<button type="button" class="row-act lu-sort-pick" data-tidy-pick="${esc(g.gid)}" aria-haspopup="true" aria-label="${esc(g.word)} 묶음 옮길 폴더: 새 폴더 ${esc(n.name)}">${icon(null)}${esc((n.parent?pathName(n.parent)+' › ':'')+n.name)} ▾</button><span class="lu-sort-nf">새 폴더</span>`
      +`<span class="lu-sort-edit"><span class="lu-sort-edit-label" aria-hidden="true">새 폴더 이름</span><input type="text" maxlength="40" autocomplete="off" aria-label="새 폴더 이름" data-tidy-gname="${esc(n.gid)}" value="${esc(n.name)}"><button type="button" class="row-act lu-sort-pick" data-tidy-place="${esc(n.gid)}" aria-haspopup="true">놓을 자리: ${esc(n.parent?pathName(n.parent):'맨 위')} ▾</button></span>`;
  }
  function rowHtml(g,r){
    const d=s().docs.find(x=>x.id===r.ids[0]),kind=r.photoset?'그림':fileKindOf(d?.file_name||r.title,d?.mime_type);
    return `<div class="lu-sort-row" data-tidy-row="${esc(r.key)}"><input type="checkbox" class="lu-sort-check" data-tidy-check="${esc(g.gid)}" data-tidy-key="${esc(r.key)}" aria-label="${esc(r.title)} 옮기기"${r.checked?' checked':''}><span class="lu-sort-name"><span class="lu-sort-kind">${esc(kind)}</span> ${esc(r.title)}${r.ids.length>1?` <small>(${r.ids.length}장)</small>`:''}</span><span class="lu-sort-why">${esc(r.note||`지금 ${fromText(r.from)}에 있음`)}</span></div>`;
  }
  function groupHtml(g){
    const move=g.mode==='move',n=g.rows.filter(r=>r.checked).length;
    return `<section class="lu-tidy-group${move?'':' lu-tidy-keep'}" data-tidy-group="${esc(g.gid)}" aria-label="${esc(g.word)} 묶음"><div class="lu-tidy-head"><b>${esc(g.word)}</b> <small>${g.total}개</small><span class="lu-tidy-seg ds-seg" role="group" aria-label="${esc(g.word)} 묶음 옮기기 여부"><button type="button" class="ds-seg-btn" data-tidy-mode="move" data-tidy-g="${esc(g.gid)}" aria-pressed="${move}">옮기기</button><button type="button" class="ds-seg-btn" data-tidy-mode="keep" data-tidy-g="${esc(g.gid)}" aria-pressed="${!move}">그대로</button></span></div>`
      +`<p class="lu-tidy-at">${esc(tidyAtText(g.at,fromText))}</p>`
      +(move?`<div class="lu-tidy-to">${n?`선택한 ${n}개 → `:'모두 → '}${targetHtml(g)}</div>${g.rows.map(r=>rowHtml(g,r)).join('')}${g.stay?`<p class="lu-sort-why lu-tidy-stay">이미 그 폴더에 있는 ${g.stay}개는 그대로</p>`:''}`
        :`<p class="lu-sort-why">'그대로'를 선택해 이 묶음은 옮기지 않아요.</p>`)+'</section>';
  }
  function paint(){
    if(!root)return;
    const list=root.querySelector('#libraryTidyList'),y=list.scrollTop;
    list.innerHTML=groups.map(groupHtml).join('')+(done?(groups.length?'':emptyHtml('흩어진 자료 없음')):`<p class="lu-tidy-wait">${waitInlineHtml()}</p>`);
    list.scrollTop=y;
    root.querySelector('#libraryTidySub').textContent=(scope?pathName(scope)+' 안 · ':'')+tidySummary(groups,{done});
    const n=tidyPlan(groups,made).count,b=root.querySelector('[data-tidy-apply]');
    b.textContent=`선택한 ${n}개 옮기기`;b.disabled=!n||busy||!done;
  }
  const say2=(text,error=false)=>{if(!root)return;const el=root.querySelector('#libraryTidyStatus');el.textContent=text;el.className=error?'status error':'status'};

  // ---- 열기: 창 먼저, 묶음은 뒤에서 ----
  async function open(from,scopeId=null){
    trigger=from||document.activeElement;ensure();
    const me=++run;scope=scopeId&&folderOf(scopeId)?scopeId:null;groups=[];made=[];done=false;busy=false;
    say2('');paint();
    root.classList.remove('hidden');root.setAttribute('aria-hidden','false');
    window.KPTUA11y?.dialog?.activate?.(root,{trigger,initialFocus:root.querySelector('[data-tidy-close]'),onRequestClose:close});
    if(!window.KPTUA11y?.dialog)root.querySelector('[data-tidy-close]')?.focus();
    // 창을 먼저 그린 뒤 계산(자료가 많아도 누르는 즉시 창이 뜨게).
    await new Promise(r=>setTimeout(r,0));
    if(me!==run)return;
    const st=s(),units=tidyUnits(st.listDocs,st.items,st.folders,{scopeId:scope});
    ({groups,newGroups:made}=tidyGroups(units,{folders:st.folders,receiveId:st.receiveId||null,scopeId:scope}));
    done=true;paint();
  }

  // ---- 고치기 ----
  const setGroup=(gid,fn)=>{groups=groups.map(g=>g.gid===gid?fn(g):g);paint()};
  function onChange(e){
    const c=e.target.closest?.('[data-tidy-check]');if(!c)return;
    setGroup(c.dataset.tidyCheck,g=>({...g,rows:g.rows.map(r=>r.key===c.dataset.tidyKey?{...r,checked:c.checked}:r)}));
  }
  function nameChanged(input){
    const next=renameGroup(made,input.dataset.tidyGname,input.value);
    if(!next){say2('폴더 이름은 1~40자로 써 주세요.',true);input.value=newOf(input.dataset.tidyGname)?.name||'';return}
    if(next.some((g,i)=>g.name!==made[i].name)){made=next;say2('');paint()}
  }
  function onClick(e){
    if(e.target.closest('[data-tidy-close]')){close();return}
    if(e.target.closest('[data-tidy-apply]')){void apply();return}
    const m=e.target.closest('[data-tidy-mode]');if(m){const gid=m.dataset.tidyG;setGroup(gid,g=>({...g,mode:m.dataset.tidyMode}));root.querySelector(`[data-tidy-g="${CSS.escape(gid)}"][data-tidy-mode="${m.dataset.tidyMode}"]`)?.focus({preventScroll:true});return}
    const pick=e.target.closest('[data-tidy-pick]');if(pick){choose(pick);return}
    const place=e.target.closest('[data-tidy-place]');if(place)choosePlace(place);
  }
  // 묶음의 옮길 폴더 바꾸기: 공용 폴더 고르기 창. [+ 새 폴더 만들어 넣기]는 묶음 낱말 이름의 새 폴더(이름·자리는 바로 고침).
  function choose(btn){
    const g=groupOf(btn.dataset.tidyPick);if(!g)return;
    sharedPicker().open({anchor:btn,place:'below',history:false,canNew:true,canOut:false,
      rows:q=>pickerRows({folders:s().folders,docs:[],free:true,query:q}),
      onPick:id=>{setGroup(g.gid,x=>retarget(x,{folder:id}));root.querySelector(`[data-tidy-pick="${CSS.escape(g.gid)}"]`)?.focus({preventScroll:true})},
      onNew:()=>{const n={gid:'t'+(made.length+1)+'u',name:g.word.slice(0,40),parent:scope};made=[...made,n];setGroup(g.gid,x=>retarget(x,{group:n.gid}));root.querySelector(`[data-tidy-gname="${n.gid}"]`)?.select?.()}});
  }
  const retarget=(g,to)=>retargetGroup(g,to,g.rows);
  function choosePlace(btn){
    const n=newOf(btn.dataset.tidyPlace);if(!n)return;
    sharedPicker().open({anchor:btn,place:'below',history:false,canNew:false,canOut:true,outLabel:'맨 위',
      rows:q=>{const d=pickerRows({folders:s().folders,docs:[],free:true,query:q});const ok=x=>({...x,enabled:x.enabled&&canAddChild(s().folders,x.id)});return {...d,recent:d.recent.map(ok),all:d.all.map(ok)}},
      onPick:id=>{if(!canAddChild(s().folders,id))return;made=placeGroup(made,n.gid,id);paint()},
      onOut:()=>{made=placeGroup(made,n.gid,null);paint()}});
  }

  // ---- 옮기기 ----
  async function apply(){
    if(busy)return;
    const plan=tidyPlan(groups,made),ws=s().workspace;
    if(!plan.count)return;
    busy=true;paint();say2('옮기는 중…');
    const created=new Map(),moved=[];let failed=0;
    try{
      for(const g of plan.create){
        const sib=folderSiblings(s().folders,{parentId:g.parent,free:true});
        const out=await api(T_FOLDERS+'?select=id',{method:'POST',prefer:'return=representation',body:{workspace_id:ws,project_id:null,parent_id:g.parent||null,name:g.name,sort_order:nextSortOrder([...sib,...[...created.values()].filter(m=>m.parent===g.parent)])},singleFlight:false});
        const id=Array.isArray(out)?out[0]?.id:null;if(!id)throw new Error('folder create failed');
        created.set(g.gid,{id,parent:g.parent,sort_order:0});
      }
      for(const m of plan.moves){
        const to=m.folder||created.get(m.group)?.id;if(!to){failed+=m.ids.length;continue}
        for(let i=0;i<m.ids.length;i+=CHUNK){
          const part=m.ids.slice(i,i+CHUNK);
          try{
            if(m.from){
              const out=await api(T_ITEMS+`?workspace_id=eq.${enc(ws)}&folder_id=eq.${enc(m.from)}&document_id=in.(${part.map(enc).join(',')})&select=document_id`,{method:'PATCH',prefer:'return=representation',body:{folder_id:to},singleFlight:false});
              const ok=(Array.isArray(out)?out:[]).map(x=>x?.document_id).filter(Boolean);
              moved.push({from:m.from,to,ids:ok});failed+=part.length-ok.length;
            }else{
              // 폴더 밖 자료: 연결을 새로 넣는다(그 사이 다른 기기에서 폴더에 넣었으면 겹침 오류 — 그 묶음은 옮기지 않음).
              await api(T_ITEMS,{method:'POST',prefer:'return=minimal',body:part.map(id=>({document_id:id,folder_id:to,workspace_id:ws})),singleFlight:false});
              moved.push({from:null,to,ids:part});
            }
          }catch{failed+=part.length}
        }
      }
    }catch(e){
      busy=false;say2(folderErrorText(e),true);
      if(created.size&&!moved.length)await removeEmptyFolders(api,[...created.values()].map(m=>m.id),ws);
      try{await reload()}catch{}paint();return;
    }
    busy=false;
    const count=moved.reduce((n,m)=>n+m.ids.length,0),madeIds=[...created.values()].map(m=>m.id);
    try{await reload()}catch{}
    close();
    if(!count&&!madeIds.length){say('옮기지 못했어요. 목록을 확인해 주세요.',{error:true});return}
    say(doneText(count,madeIds.length,failed),{error:failed>0,undo:()=>undo(moved,madeIds,ws)});
  }
  async function undo(moved,madeIds,ws){
    let back=0,miss=0;
    for(const m of moved)for(let i=0;i<m.ids.length;i+=CHUNK){
      const part=m.ids.slice(i,i+CHUNK),q=`?workspace_id=eq.${enc(ws)}&folder_id=eq.${enc(m.to)}&document_id=in.(${part.map(enc).join(',')})&select=document_id`;
      try{
        const out=m.from?await api(T_ITEMS+q,{method:'PATCH',prefer:'return=representation',body:{folder_id:m.from},singleFlight:false})
          :await api(T_ITEMS+q,{method:'DELETE',prefer:'return=representation',singleFlight:false});
        const n=Array.isArray(out)?out.length:part.length;back+=n;miss+=part.length-n;
      }catch{miss+=part.length}
    }
    const kept=await removeEmptyFolders(api,madeIds,ws);
    try{await reload()}catch{}
    say(`되돌렸어요 · ${back}개를 원래 자리로${kept?` · 자료가 남은 새 폴더 ${kept}개는 두었어요`:''}${miss?` · ${miss}개는 그 사이 옮겨져 그대로 두었어요`:''}`,{error:miss>0});
  }
  return {open,close,get busy(){return busy}};
}
