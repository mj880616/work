import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {
  LOCKED_CATEGORY,CATEGORY_NAME_LIMIT,documentCategories,documentCategoriesLoaded,loadDocumentCategories,categoryNameProblem,categoryErrorText,
  addDocumentCategory,renameDocumentCategory,deleteDocumentCategory,storedValuesOf,documentCountOf,
} from './document-categories.js';

// UI-바구니첨부메모 PR 3: 자료 분류 목록 편집(추가·이름 바꾸기·삭제). 자료실의 [분류 수정] 창 맨 위에 붙는다.
// 목록은 document-categories.js가 읽어 둔 내 목록 하나뿐이고(여기에 따로 저장하지 않음), 바꾸는 일은 DB 함수 3개로만 한다.
// '기타'는 고정이다. 이름을 바꾸면 그 분류 자료도 새 이름으로, 지우면 그 분류 자료는 '기타'로 함께 바뀐다(함수가 한 번에 한다).
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const CATEGORY_EDITOR_TEXT=Object.freeze({
  help:'자료를 올리거나 고칠 때 이 목록에서 고르고, 자료실 위쪽 분류 칩도 이 목록이에요. 자료와 파일은 지워지지 않아요.',
  renameNote:count=>count?`이름을 바꾸면 이 분류의 자료 ${count}개도 새 이름으로 바뀌어요.`:'이 분류에 자료가 없어서 이름만 바뀌어요.',
  deleteConfirm:(name,count)=>`‘${name}’ 분류를 지울까요?\n\n${count?`이 분류의 자료 ${count}개는 ‘${LOCKED_CATEGORY}’로 옮겨져요. `:''}자료와 파일은 지워지지 않아요.`,
  loadFailed:'분류 목록을 불러오지 못했어요. 목록을 모르는 채로 고치지 않도록 잠시 막아 두었어요.',
  saving:'저장하는 중…',
});
// host 안에 편집 화면을 그린다. documents(): 지금 불러온 자료들. refresh(): 자료를 다시 읽는다(이름 바꾸기·삭제 직전). onChanged(): 목록이나 자료가 바뀐 뒤.
export function mountCategoryEditor(host,{documents=()=>[],refresh=async()=>documents(),onChanged=()=>{},rt=window.KPTURuntime}={}){
  let editing=null,busy=false,loading=false,status={text:'',error:false},addDraft='',renameDraft='';
  const say=(text,error=false)=>{status={text,error};};
  const countOf=name=>documentCountOf(name,documents());
  function row(name){
    if(name===LOCKED_CATEGORY)return `<li class="dce-row" data-dce-row="${esc(name)}"><span class="dce-name">${esc(name)}</span><span class="dce-meta">자료 ${countOf(name)}개 · 고정(이름을 바꾸거나 지울 수 없어요)</span></li>`;
    if(editing===name){
      return `<li class="dce-row dce-row-edit" data-dce-row="${esc(name)}"><form class="dce-rename-form" data-enter-save data-dce-rename-form="${esc(name)}"><label class="dce-label">‘${esc(name)}’의 새 이름<input type="text" class="dce-input" data-dce-rename-input maxlength="${CATEGORY_NAME_LIMIT}" value="${esc(renameDraft)}" autocomplete="off"></label><p class="dce-note">${esc(CATEGORY_EDITOR_TEXT.renameNote(countOf(name)))}</p><div class="dce-actions"><button type="button" class="secondary" data-dce-cancel ${busy?'disabled':''}>취소</button><button type="submit" class="primary" ${busy?'disabled':''}>저장</button></div></form></li>`;
    }
    return `<li class="dce-row" data-dce-row="${esc(name)}"><span class="dce-name">${esc(name)}</span><span class="dce-meta">자료 ${countOf(name)}개</span><span class="dce-actions"><button type="button" class="secondary" data-dce-rename="${esc(name)}" aria-label="${esc(name)} 이름 바꾸기" ${busy?'disabled':''}>이름 바꾸기</button><button type="button" class="danger" data-dce-delete="${esc(name)}" aria-label="${esc(name)} 지우기" ${busy?'disabled':''}>지우기</button></span></li>`;
  }
  function paint(){
    if(loading){host.innerHTML='<section class="dce" aria-labelledby="dceTitle"><h3 id="dceTitle">분류 목록</h3><p class="dce-note" role="status">분류 목록을 불러오는 중…</p></section>';return;}
    if(!documentCategoriesLoaded()){
      host.innerHTML=`<section class="dce" aria-labelledby="dceTitle"><h3 id="dceTitle">분류 목록</h3><p class="dce-note" role="status">${esc(CATEGORY_EDITOR_TEXT.loadFailed)}</p><div class="dce-actions"><button type="button" class="secondary" data-dce-reload ${busy?'disabled':''}>다시 불러오기</button></div></section>`;
      return;
    }
    const list=documentCategories();
    host.innerHTML=`<section class="dce" aria-labelledby="dceTitle"><h3 id="dceTitle">분류 목록 <span class="dce-count">${list.length}개</span></h3><p class="dce-note">${esc(CATEGORY_EDITOR_TEXT.help)}</p><ul class="dce-list">${list.map(row).join('')}</ul><form class="dce-add" data-dce-add data-enter-save><label class="dce-label" for="dceNewName">새 분류 이름</label><div class="dce-add-line"><input id="dceNewName" type="text" class="dce-input" maxlength="${CATEGORY_NAME_LIMIT}" placeholder="예: 홍보" value="${esc(addDraft)}" autocomplete="off" ${busy?'disabled':''}><button type="submit" class="primary" ${busy?'disabled':''}>추가</button></div></form><p class="dce-status${status.error?' error':''}" data-dce-status role="${status.error?'alert':'status'}">${esc(status.text)}</p></section>`;
  }
  function focus(selector){queueMicrotask(()=>host.querySelector(selector)?.focus({preventScroll:true}));}
  // 결과를 모를 때: 다시 보내지 않고 목록과 자료를 다시 읽어 보여 준다.
  async function recover(message){
    say(message,true);
    try{await loadDocumentCategories({rt,force:true});await refresh();}catch{/* 안내 문구로 충분하다 */}
    paint();onChanged();
  }
  async function finish(result,{success,focusAfter}){
    busy=false;
    if(result.ok){
      editing=null;say(success(result));
      // 이름 바꾸기·삭제는 자료의 분류도 바꾸므로 자료를 다시 읽은 뒤 그린다(자료 수가 맞도록).
      if(result.documents>0){try{await refresh();}catch{/* 곧 'kptu:documents-changed'로 다시 읽는다 */}}
      paint();onChanged();focus(focusAfter);return;
    }
    if(result.error==='UNKNOWN'){await recover(categoryErrorText('UNKNOWN'));return;}
    if(['CATEGORY_NOT_FOUND','CATEGORY_EXISTS'].includes(result.error)){
      // 목록이 눈에 보이는 것과 달라졌을 수 있다: 최신 목록을 읽어 다시 그린다.
      editing=null;say(categoryErrorText(result.error),true);
      try{await loadDocumentCategories({rt,force:true});await refresh();}catch{/* 아래에서 그대로 그린다 */}
      paint();onChanged();return;
    }
    say(categoryErrorText(result.error),true);paint();
    focus(editing?'[data-dce-rename-input]':'#dceNewName');
  }
  async function add(form){
    if(busy)return;
    const input=form.querySelector('#dceNewName'),name=input.value.trim(),problem=categoryNameProblem(name);
    addDraft=input.value;
    if(problem){say(problem,true);paint();focus('#dceNewName');return;}
    busy=true;say(CATEGORY_EDITOR_TEXT.saving);paint();
    const result=await addDocumentCategory(name,{rt});
    if(result.ok)addDraft='';
    await finish(result,{success:()=>`‘${name}’ 분류를 추가했어요.`,focusAfter:'#dceNewName'});
  }
  async function rename(form){
    if(busy)return;
    const from=form.dataset.dceRenameForm,input=form.querySelector('[data-dce-rename-input]'),to=input.value.trim();
    renameDraft=input.value;
    if(to===from){editing=null;say('');paint();focus(`[data-dce-rename="${CSS.escape(from)}"]`);return;}
    const problem=categoryNameProblem(to,{except:from});
    if(problem){say(problem,true);paint();focus('[data-dce-rename-input]');return;}
    busy=true;say(CATEGORY_EDITOR_TEXT.saving);paint();
    let docs;try{docs=await refresh();}catch{docs=documents();}
    const stored=storedValuesOf(from,docs);
    if(stored===null){busy=false;say(categoryErrorText('INVALID_INPUT'),true);paint();return;}
    const result=await renameDocumentCategory(from,to,stored,{rt});
    await finish(result,{success:r=>`‘${from}’을(를) ‘${to}’(으)로 바꿨어요.${r.documents?` 자료 ${r.documents}개의 분류도 함께 바뀌었어요.`:''}`,focusAfter:`[data-dce-rename="${CSS.escape(to)}"]`});
  }
  async function remove(name){
    if(busy)return;
    let docs;try{docs=await refresh();}catch{docs=documents();}
    if(!window.confirm(CATEGORY_EDITOR_TEXT.deleteConfirm(name,documentCountOf(name,docs))))return;
    const stored=storedValuesOf(name,docs);
    if(stored===null){say(categoryErrorText('INVALID_INPUT'),true);paint();return;}
    busy=true;say(CATEGORY_EDITOR_TEXT.saving);paint();
    const result=await deleteDocumentCategory(name,stored,{rt});
    await finish(result,{success:r=>`‘${name}’ 분류를 지웠어요.${r.documents?` 자료 ${r.documents}개는 ‘${LOCKED_CATEGORY}’로 옮겼어요.`:''}`,focusAfter:'#dceNewName'});
  }
  host.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.dceRename!==undefined){editing=button.dataset.dceRename;renameDraft=editing;say('');paint();focus('[data-dce-rename-input]');}
    else if(button.dataset.dceDelete!==undefined)void remove(button.dataset.dceDelete);
    else if(button.hasAttribute('data-dce-cancel')){const name=editing;editing=null;say('');paint();focus(`[data-dce-rename="${CSS.escape(name||'')}"]`);}
    else if(button.hasAttribute('data-dce-reload'))void reload();
  });
  host.addEventListener('input',event=>{
    if(event.target.matches('#dceNewName'))addDraft=event.target.value;
    else if(event.target.matches('[data-dce-rename-input]'))renameDraft=event.target.value;
  });
  host.addEventListener('submit',event=>{
    event.preventDefault();
    if(event.target.matches('[data-dce-add]'))void add(event.target);
    else if(event.target.matches('[data-dce-rename-form]'))void rename(event.target);
  });
  host.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&editing&&!busy&&host.contains(event.target)){event.stopPropagation();const name=editing;editing=null;say('');paint();focus(`[data-dce-rename="${CSS.escape(name)}"]`);}
  });
  async function reload(){
    busy=true;loading=true;paint();
    try{await loadDocumentCategories({rt,force:true});await refresh();}catch{/* 아래에서 그대로 그린다 */}
    busy=false;loading=false;say('');paint();onChanged();
  }
  // 창을 열 때마다: 목록과 자료를 새로 읽고 그린다.
  async function open(){editing=null;addDraft='';renameDraft='';say('');await reload();}
  return {open,paint,reset(){editing=null;busy=false;loading=false;addDraft='';renameDraft='';say('');}};
}
