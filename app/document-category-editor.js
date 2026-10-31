import {waitHtml} from './wait-state.js';
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {
  LOCKED_CATEGORY,CATEGORY_NAME_LIMIT,documentCategories,documentCategoriesLoaded,loadDocumentCategories,categoryNameProblem,categoryErrorText,
  addDocumentCategory,renameDocumentCategory,deleteDocumentCategory,storedValuesOf,documentCountOf,
  orderedDocumentCategories,topDocumentCategories,subcategoriesOf,isSubcategory,categoryParent,categoryLeaf,categoryLabel,subcategoryName,subcategoryNameLimit,
  renameDocumentCategoryGroup,deleteDocumentCategoryGroup,deleteDocumentSubcategory,
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
  // LIB-소분류: 소분류는 큰 분류 줄 바로 아래에 한 칸 들여 보인다. 지워도 그 자료는 큰 분류에 그대로 남는다(DB 함수).
  groupRenameNote:(count,subs)=>`이름을 바꾸면 소분류 ${subs}개${count?`와 이 분류의 자료 ${count}개`:''}도 새 이름으로 바뀌어요.`,
  groupDeleteConfirm:(name,count,subs)=>`‘${name}’ 분류와 소분류 ${subs}개를 지울까요?\n\n${count?`이 분류의 자료 ${count}개는 ‘${LOCKED_CATEGORY}’로 옮겨져요. `:''}자료와 파일은 지워지지 않아요.`,
  subDeleteConfirm:(name,count)=>`‘${categoryLabel(name)}’ 소분류를 지울까요?\n\n${count?`이 소분류의 자료 ${count}개는 ‘${categoryParent(name)}’에 그대로 남아요. `:''}자료와 파일은 지워지지 않아요.`,
});
// host 안에 편집 화면을 그린다. documents(): 지금 불러온 자료들. refresh(): 자료를 다시 읽는다(이름 바꾸기·삭제 직전). onChanged(): 목록이나 자료가 바뀐 뒤.
export function mountCategoryEditor(host,{documents=()=>[],refresh=async()=>documents(),onChanged=()=>{},rt=window.KPTURuntime}={}){
  let editing=null,busy=false,loading=false,status={text:'',error:false},addDraft='',renameDraft='',addSubFor='',subDraft='';
  const say=(text,error=false)=>{status={text,error};};
  const countOf=name=>documentCountOf(name,documents());
  const groupCountOf=name=>documentCountOf(name,documents(),{group:true});
  const ask=text=>window.confirm(text);
  const dis=busy=>busy?'disabled':'';
  // 큰 분류 줄의 [+ 소분류]: 그 줄 바로 아래(소분류들 뒤)에 이름 칸이 열린다.
  function subForm(parent){
    const limit=subcategoryNameLimit(parent);
    return `<li class="dce-row dce-row-edit dce-row-sub" data-dce-sub-row="${esc(parent)}"><form class="dce-sub-form" data-enter-save data-dce-sub-form="${esc(parent)}"><label class="dce-label">‘${esc(parent)}’에 만들 소분류 이름<input type="text" class="dce-input" data-dce-sub-input maxlength="${Math.max(limit,1)}" value="${esc(subDraft)}" autocomplete="off" placeholder="예: 투쟁속보"></label><div class="dce-actions"><button type="button" class="secondary" data-dce-sub-cancel ${dis(busy)}>취소</button><button type="submit" class="primary" ${dis(busy)}>추가</button></div></form></li>`;
  }
  function row(name){
    const sub=isSubcategory(name),label=sub?categoryLabel(name):name,shown=sub?categoryLeaf(name):name,cls=sub?'dce-row dce-row-sub':'dce-row';
    const subs=sub?0:subcategoriesOf(name).length,count=sub?countOf(name):groupCountOf(name);
    const addSub=sub?'':`<button type="button" class="secondary dce-add-sub" data-dce-add-sub="${esc(name)}" aria-label="${esc(name)}에 소분류 만들기" ${dis(busy)}>+ 소분류</button>`;
    const meta=`자료 ${count}개${subs?` · 소분류 ${subs}개`:''}`;
    if(name===LOCKED_CATEGORY)return `<li class="${cls}" data-dce-row="${esc(name)}"><span class="dce-name">${esc(name)}</span><span class="dce-meta">${meta} · 고정(이름을 바꾸거나 지울 수 없어요)</span></li>`;
    if(editing===name){
      const note=sub?CATEGORY_EDITOR_TEXT.renameNote(count):subs?CATEGORY_EDITOR_TEXT.groupRenameNote(count,subs):CATEGORY_EDITOR_TEXT.renameNote(count);
      const limit=sub?Math.max(subcategoryNameLimit(categoryParent(name)),1):CATEGORY_NAME_LIMIT;
      return `<li class="${cls} dce-row-edit" data-dce-row="${esc(name)}"><form class="dce-rename-form" data-enter-save data-dce-rename-form="${esc(name)}"><label class="dce-label">‘${esc(label)}’의 새 이름<input type="text" class="dce-input" data-dce-rename-input maxlength="${limit}" value="${esc(renameDraft)}" autocomplete="off"></label><p class="dce-note">${esc(note)}</p><div class="dce-actions"><button type="button" class="secondary" data-dce-cancel ${dis(busy)}>취소</button><button type="submit" class="primary" ${dis(busy)}>저장</button></div></form></li>`;
    }
    return `<li class="${cls}" data-dce-row="${esc(name)}"><span class="dce-name">${esc(shown)}</span><span class="dce-meta">${meta}</span><span class="dce-actions">${addSub}<button type="button" class="secondary" data-dce-rename="${esc(name)}" aria-label="${esc(label)} 이름 바꾸기" ${dis(busy)}>이름 바꾸기</button><button type="button" class="danger" data-dce-delete="${esc(name)}" aria-label="${esc(label)} 지우기" ${dis(busy)}>지우기</button></span></li>`;
  }
  // 큰 분류마다 그 소분류가 바로 뒤에, 소분류 만들기 칸은 그 묶음 끝에.
  function rows(){
    const list=orderedDocumentCategories(),out=[];
    list.forEach((name,index)=>{
      out.push(row(name));
      const next=list[index+1],groupEnds=!next||!isSubcategory(next)||categoryParent(next)!==categoryParent(name);
      if(groupEnds&&addSubFor&&categoryParent(name)===addSubFor)out.push(subForm(addSubFor));
    });
    return out.join('');
  }
  function paint(){
    if(loading){host.innerHTML='<section class="dce" aria-labelledby="dceTitle"><h3 id="dceTitle">분류 목록</h3>'+waitHtml({rows:3})+'</section>';return;}
    if(!documentCategoriesLoaded()){
      host.innerHTML=`<section class="dce" aria-labelledby="dceTitle"><h3 id="dceTitle">분류 목록</h3><p class="dce-note" role="status">${esc(CATEGORY_EDITOR_TEXT.loadFailed)}</p><div class="dce-actions"><button type="button" class="secondary" data-dce-reload ${busy?'disabled':''}>다시 불러오기</button></div></section>`;
      return;
    }
    const list=documentCategories();
    host.innerHTML=`<section class="dce" aria-labelledby="dceTitle"><h3 id="dceTitle">분류 목록 <span class="dce-count">${list.length}개</span></h3><p class="dce-note">${esc(CATEGORY_EDITOR_TEXT.help)}</p><ul class="dce-list">${rows()}</ul><form class="dce-add" data-dce-add data-enter-save><label class="dce-label" for="dceNewName">새 분류 이름</label><div class="dce-add-line"><input id="dceNewName" type="text" class="dce-input" maxlength="${CATEGORY_NAME_LIMIT}" placeholder="예: 홍보" value="${esc(addDraft)}" autocomplete="off" ${busy?'disabled':''}><button type="submit" class="primary" ${busy?'disabled':''}>추가</button></div></form><p class="dce-status${status.error?' error':''}" data-dce-status role="${status.error?'alert':'status'}">${esc(status.text)}</p></section>`;
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
  // 소분류 만들기: 기존 추가 함수에 '큰분류›소분류' 전체 이름을 보낸다.
  async function addSub(form){
    if(busy)return;
    const parent=form.dataset.dceSubForm,input=form.querySelector('[data-dce-sub-input]'),leaf=input.value.trim();
    subDraft=input.value;
    if(!topDocumentCategories().includes(parent)){addSubFor='';say(categoryErrorText('CATEGORY_NOT_FOUND'),true);paint();return;}
    const problem=categoryNameProblem(leaf,{parent});
    if(problem){say(problem,true);paint();focus('[data-dce-sub-input]');return;}
    const name=subcategoryName(parent,leaf);
    busy=true;say(CATEGORY_EDITOR_TEXT.saving);paint();
    const result=await addDocumentCategory(name,{rt});
    if(result.ok){addSubFor='';subDraft='';}
    await finish(result,{success:()=>`‘${categoryLabel(name)}’ 소분류를 추가했어요.`,focusAfter:`[data-dce-add-sub="${CSS.escape(parent)}"]`});
  }
  async function rename(form){
    if(busy)return;
    const from=form.dataset.dceRenameForm,input=form.querySelector('[data-dce-rename-input]'),typed=input.value.trim();
    const sub=isSubcategory(from),parent=sub?categoryParent(from):'',to=sub?subcategoryName(parent,typed):typed;
    renameDraft=input.value;
    if(to===from){editing=null;say('');paint();focus(`[data-dce-rename="${CSS.escape(from)}"]`);return;}
    const problem=categoryNameProblem(typed,{except:from,parent});
    if(problem){say(problem,true);paint();focus('[data-dce-rename-input]');return;}
    busy=true;say(CATEGORY_EDITOR_TEXT.saving);paint();
    let docs;try{docs=await refresh();}catch{docs=documents();}
    const stored=storedValuesOf(from,docs);
    if(stored===null){busy=false;say(categoryErrorText('INVALID_INPUT'),true);paint();return;}
    // 소분류가 있는 큰 분류는 소분류 이름 앞부분·자료 값까지 한 번에 바꾸는 함수로(LIB-소분류). 나머지는 기존 함수 그대로.
    const group=!sub&&subcategoriesOf(from).length>0;
    const result=await (group?renameDocumentCategoryGroup:renameDocumentCategory)(from,to,stored,{rt});
    await finish(result,{success:r=>`‘${categoryLabel(from)}’을(를) ‘${categoryLabel(to)}’(으)로 바꿨어요.${r.documents?` 자료 ${r.documents}개의 분류도 함께 바뀌었어요.`:''}`,focusAfter:`[data-dce-rename="${CSS.escape(to)}"]`});
  }
  async function remove(name){
    if(busy)return;
    let docs;try{docs=await refresh();}catch{docs=documents();}
    const sub=isSubcategory(name),subs=sub?0:subcategoriesOf(name).length;
    const text=sub?CATEGORY_EDITOR_TEXT.subDeleteConfirm(name,documentCountOf(name,docs))
      :subs?CATEGORY_EDITOR_TEXT.groupDeleteConfirm(name,documentCountOf(name,docs,{group:true}),subs)
      :CATEGORY_EDITOR_TEXT.deleteConfirm(name,documentCountOf(name,docs));
    if(!ask(text))return;
    if(sub){
      // 소분류 지우기: 목록에서만 빼고 그 자료는 큰 분류로 남는다.
      busy=true;say(CATEGORY_EDITOR_TEXT.saving);paint();
      const result=await deleteDocumentSubcategory(name,{rt});
      await finish(result,{success:r=>`‘${categoryLabel(name)}’ 소분류를 지웠어요.${r.documents?` 자료 ${r.documents}개는 ‘${categoryParent(name)}’에 그대로 있어요.`:''}`,focusAfter:`[data-dce-add-sub="${CSS.escape(categoryParent(name))}"]`});
      return;
    }
    const stored=storedValuesOf(name,docs,{group:subs>0});
    if(stored===null){say(categoryErrorText('INVALID_INPUT'),true);paint();return;}
    busy=true;say(CATEGORY_EDITOR_TEXT.saving);paint();
    const result=await (subs?deleteDocumentCategoryGroup:deleteDocumentCategory)(name,stored,{rt});
    await finish(result,{success:r=>`‘${name}’ 분류를 지웠어요.${r.documents?` 자료 ${r.documents}개는 ‘${LOCKED_CATEGORY}’로 옮겼어요.`:''}`,focusAfter:'#dceNewName'});
  }
  function startAddSub(parent){
    if(!topDocumentCategories().includes(parent))return;
    editing=null;addSubFor=parent;subDraft='';say('');paint();focus('[data-dce-sub-input]');
  }
  host.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.dceAddSub!==undefined)startAddSub(button.dataset.dceAddSub);
    else if(button.hasAttribute('data-dce-sub-cancel')){const parent=addSubFor;addSubFor='';subDraft='';say('');paint();focus(`[data-dce-add-sub="${CSS.escape(parent)}"]`);}
    else if(button.dataset.dceRename!==undefined){editing=button.dataset.dceRename;addSubFor='';renameDraft=isSubcategory(editing)?categoryLeaf(editing):editing;say('');paint();focus('[data-dce-rename-input]');}
    else if(button.dataset.dceDelete!==undefined)void remove(button.dataset.dceDelete);
    else if(button.hasAttribute('data-dce-cancel')){const name=editing;editing=null;say('');paint();focus(`[data-dce-rename="${CSS.escape(name||'')}"]`);}
    else if(button.hasAttribute('data-dce-reload'))void reload();
  });
  host.addEventListener('input',event=>{
    if(event.target.matches('#dceNewName'))addDraft=event.target.value;
    else if(event.target.matches('[data-dce-rename-input]'))renameDraft=event.target.value;
    else if(event.target.matches('[data-dce-sub-input]'))subDraft=event.target.value;
  });
  host.addEventListener('submit',event=>{
    event.preventDefault();
    if(event.target.matches('[data-dce-add]'))void add(event.target);
    else if(event.target.matches('[data-dce-rename-form]'))void rename(event.target);
    else if(event.target.matches('[data-dce-sub-form]'))void addSub(event.target);
  });
  host.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&addSubFor&&!editing&&!busy&&host.contains(event.target)){event.stopPropagation();const parent=addSubFor;addSubFor='';subDraft='';say('');paint();focus(`[data-dce-add-sub="${CSS.escape(parent)}"]`);return;}
    if(event.key==='Escape'&&editing&&!busy&&host.contains(event.target)){event.stopPropagation();const name=editing;editing=null;say('');paint();focus(`[data-dce-rename="${CSS.escape(name)}"]`);}
  });
  async function reload(){
    busy=true;loading=true;paint();
    try{await loadDocumentCategories({rt,force:true});await refresh();}catch{/* 아래에서 그대로 그린다 */}
    busy=false;loading=false;say('');paint();onChanged();
  }
  // 창을 열 때마다: 목록과 자료를 새로 읽고 그린다.
  // addSubTo: 칩 아래 소분류 줄의 [+ 소분류]로 열면 그 큰 분류의 소분류 만들기 칸을 바로 연다.
  async function open({addSubTo=''}={}){editing=null;addDraft='';renameDraft='';addSubFor='';subDraft='';say('');await reload();if(addSubTo)startAddSub(addSubTo);}
  return {open,paint,startAddSub,reset(){editing=null;busy=false;loading=false;addDraft='';renameDraft='';addSubFor='';subDraft='';say('');}};
}
