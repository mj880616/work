import {waitHtml} from './wait-state.js';
import {leAddHtml,leRowHtml,leInlineHtml,leMove,leStep} from './list-edit.mjs';
import {mountListEdit} from './list-edit.js';
import {askConfirm} from './small-notice.js';
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {
  LOCKED_CATEGORY,CATEGORY_NAME_LIMIT,documentCategories,documentCategoriesLoaded,loadDocumentCategories,categoryNameProblem,categoryErrorText,
  addDocumentCategory,renameDocumentCategory,deleteDocumentCategory,storedValuesOf,documentCountOf,
  orderedDocumentCategories,topDocumentCategories,subcategoriesOf,isSubcategory,categoryParent,categoryLeaf,categoryLabel,subcategoryName,subcategoryNameLimit,
  renameDocumentCategoryGroup,deleteDocumentCategoryGroup,deleteDocumentSubcategory,reorderDocumentCategories,
} from './document-categories.js';

// UI-바구니첨부메모 PR 3: 자료 분류 목록 편집(추가·이름 바꾸기·삭제). 자료실의 [분류 수정] 창 맨 위에 붙는다.
// 목록은 document-categories.js가 읽어 둔 내 목록 하나뿐이고(여기에 따로 저장하지 않음), 바꾸는 일은 DB 함수 3개로만 한다.
// '기타'는 고정이다. 이름을 바꾸면 그 분류 자료도 새 이름으로, 지우면 그 분류 자료는 '기타'로 함께 바뀐다(함수가 한 번에 한다).
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const CATEGORY_EDITOR_TEXT=Object.freeze({
  deleteConfirm:(name,count)=>`‘${name}’ 분류를 지울까요?\n\n${count?`이 분류의 자료 ${count}개는 ‘${LOCKED_CATEGORY}’로 옮겨져요. `:''}자료와 파일은 지워지지 않아요.`,
  loadFailed:'분류 목록을 불러오지 못했어요. 목록을 모르는 채로 고치지 않도록 잠시 막아 두었어요.',
  saving:'저장하는 중…',
  // LIB-소분류: 소분류는 큰 분류 줄 바로 아래에 한 칸 들여 보인다. 지워도 그 자료는 큰 분류에 그대로 남는다(DB 함수).
  groupDeleteConfirm:(name,count,subs)=>`‘${name}’ 분류와 소분류 ${subs}개를 지울까요?\n\n${count?`이 분류의 자료 ${count}개는 ‘${LOCKED_CATEGORY}’로 옮겨져요. `:''}자료와 파일은 지워지지 않아요.`,
  subDeleteConfirm:(name,count)=>`‘${categoryLabel(name)}’ 소분류를 지울까요?\n\n${count?`이 소분류의 자료 ${count}개는 ‘${categoryParent(name)}’에 그대로 남아요. `:''}자료와 파일은 지워지지 않아요.`,
});
// host 안에 편집 화면을 그린다. documents(): 지금 불러온 자료들. refresh(): 자료를 다시 읽는다(이름 바꾸기·삭제 직전). onChanged(): 목록이나 자료가 바뀐 뒤.
// S51-28 LIB-화면정리 ②(시안 docs/design/mockups/library-category-edit.html): 공용 '목록 고치기' 모양(list-edit.mjs·list-edit.js) —
// 맨 위 '새 분류 이름 [추가]', 줄 = ⠿ · 이름(누르면 그 자리 고침) · 자료 수 · ⋯([+ 소분류]·[이름 바꾸기]·[지우기]), '기타'는 맨 아래 🔒 고정.
// ⠿ 끌기 = 큰 분류 순서(자료실 분류 칩 순서, 서버 저장). onCount(n): 창 제목 옆 수.
export function mountCategoryEditor(host,{documents=()=>[],refresh=async()=>documents(),onChanged=()=>{},onCount=()=>{},rt=window.KPTURuntime}={}){
  let editing=null,busy=false,loading=false,status={text:'',error:false},addDraft='',renameDraft='',addSubFor='',subDraft='';
  const say=(text,error=false)=>{status={text,error};};
  const countOf=name=>documentCountOf(name,documents());
  const groupCountOf=name=>documentCountOf(name,documents(),{group:true});
  // 지우기는 빨강 없이 한 번 묻기(UI-지우기빨강빼기). 다시 그려져 단추가 바뀌었으면 같은 이름의 새 ⋯에 붙인다.
  const ask=(text,name)=>askConfirm(host.querySelector(`[data-le-menu="${CSS.escape(name)}"]`)||host,{text,ok:'지우기'});
  // 큰 분류의 ⋯ → [+ 소분류]: 그 묶음 끝(소분류들 뒤)에 이름 칸이 열린다.
  function subForm(parent){
    return leInlineHtml({label:`‘${parent}’에 만들 소분류 이름`,value:subDraft,limit:Math.max(subcategoryNameLimit(parent),1),sub:true,button:'추가',disabled:busy,formAttrs:{'data-dce-sub-form':parent},inputAttrs:{'data-dce-sub-input':true}});
  }
  function row(name){
    const sub=isSubcategory(name),label=sub?categoryLabel(name):name,shown=sub?categoryLeaf(name):name;
    const subs=sub?0:subcategoriesOf(name).length,count=sub?countOf(name):groupCountOf(name);
    const meta=subs?`${count} · 소분류 ${subs}`:String(count);
    if(editing===name){
      const limit=sub?Math.max(subcategoryNameLimit(categoryParent(name)),1):CATEGORY_NAME_LIMIT;
      return leInlineHtml({id:name,label:`‘${label}’의 새 이름`,value:renameDraft,limit,sub,disabled:busy,formAttrs:{'data-dce-rename-form':name},inputAttrs:{'data-dce-rename-input':true}});
    }
    return leRowHtml({id:name,label,shown,meta,sub,drag:!sub&&name!==LOCKED_CATEGORY,locked:name===LOCKED_CATEGORY,disabled:busy,rowAttrs:{'data-dce-row':name}});
  }
  // 큰 분류마다 그 소분류가 바로 뒤에, 소분류 만들기 칸은 그 묶음 끝에. '기타'는 맨 아래.
  function rows(){
    const tops=topDocumentCategories(),order=[...tops.filter(n=>n!==LOCKED_CATEGORY),...tops.filter(n=>n===LOCKED_CATEGORY)];
    const shown=new Set(),out=[];
    for(const top of order){
      for(const name of [top,...subcategoriesOf(top)]){out.push(row(name));shown.add(name);}
      if(addSubFor===top)out.push(subForm(top));
    }
    for(const name of orderedDocumentCategories())if(!shown.has(name))out.push(row(name));
    return out.join('');
  }
  function paint(){
    if(loading){host.innerHTML='<section class="dce" aria-label="분류 목록">'+waitHtml({rows:3})+'</section>';return;}
    if(!documentCategoriesLoaded()){
      onCount(null);
      host.innerHTML=`<section class="dce" aria-label="분류 목록"><p class="le-status" role="status">${esc(CATEGORY_EDITOR_TEXT.loadFailed)}</p><button type="button" class="le-add-btn" data-dce-reload ${busy?'disabled':''}>다시 불러오기</button></section>`;
      return;
    }
    const list=documentCategories();onCount(list.length);
    host.innerHTML=`<section class="dce" aria-label="분류 목록">${leAddHtml({name:'새 분류 이름',value:addDraft,limit:CATEGORY_NAME_LIMIT,disabled:busy,inputId:'dceNewName',formAttrs:{'data-dce-add':true}})}<ul class="le-list dce-list" data-reorder-list="categories">${rows()}</ul><p class="le-status dce-status${status.error?' error':''}" data-dce-status role="${status.error?'alert':'status'}">${esc(status.text)}</p></section>`;
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
    await finish(result,{success:()=>`‘${categoryLabel(name)}’ 소분류를 추가했어요.`,focusAfter:`[data-le-menu="${CSS.escape(parent)}"]`});
  }
  async function rename(form){
    if(busy)return;
    const from=form.dataset.dceRenameForm,input=form.querySelector('[data-dce-rename-input]'),typed=input.value.trim();
    const sub=isSubcategory(from),parent=sub?categoryParent(from):'',to=sub?subcategoryName(parent,typed):typed;
    renameDraft=input.value;
    if(to===from){editing=null;say('');paint();focus(`[data-le-rename="${CSS.escape(from)}"]`);return;}
    const problem=categoryNameProblem(typed,{except:from,parent});
    if(problem){say(problem,true);paint();focus('[data-dce-rename-input]');return;}
    busy=true;say(CATEGORY_EDITOR_TEXT.saving);paint();
    let docs;try{docs=await refresh();}catch{docs=documents();}
    const stored=storedValuesOf(from,docs);
    if(stored===null){busy=false;say(categoryErrorText('INVALID_INPUT'),true);paint();return;}
    // 소분류가 있는 큰 분류는 소분류 이름 앞부분·자료 값까지 한 번에 바꾸는 함수로(LIB-소분류). 나머지는 기존 함수 그대로.
    const group=!sub&&subcategoriesOf(from).length>0;
    const result=await (group?renameDocumentCategoryGroup:renameDocumentCategory)(from,to,stored,{rt});
    await finish(result,{success:r=>`‘${categoryLabel(from)}’을(를) ‘${categoryLabel(to)}’(으)로 바꿨어요.${r.documents?` 자료 ${r.documents}개의 분류도 함께 바뀌었어요.`:''}`,focusAfter:`[data-le-rename="${CSS.escape(to)}"]`});
  }
  async function remove(name){
    if(busy)return;
    let docs;try{docs=await refresh();}catch{docs=documents();}
    const sub=isSubcategory(name),subs=sub?0:subcategoriesOf(name).length;
    const text=sub?CATEGORY_EDITOR_TEXT.subDeleteConfirm(name,documentCountOf(name,docs))
      :subs?CATEGORY_EDITOR_TEXT.groupDeleteConfirm(name,documentCountOf(name,docs,{group:true}),subs)
      :CATEGORY_EDITOR_TEXT.deleteConfirm(name,documentCountOf(name,docs));
    if(!(await ask(text,name))||busy)return;
    if(sub){
      // 소분류 지우기: 목록에서만 빼고 그 자료는 큰 분류로 남는다.
      busy=true;say(CATEGORY_EDITOR_TEXT.saving);paint();
      const result=await deleteDocumentSubcategory(name,{rt});
      await finish(result,{success:r=>`‘${categoryLabel(name)}’ 소분류를 지웠어요.${r.documents?` 자료 ${r.documents}개는 ‘${categoryParent(name)}’에 그대로 있어요.`:''}`,focusAfter:`[data-le-menu="${CSS.escape(categoryParent(name))}"]`});
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
  function startRename(name){editing=name;addSubFor='';renameDraft=isSubcategory(name)?categoryLeaf(name):name;say('');paint();focus('[data-dce-rename-input]');}
  // ⠿ 끌기·키보드 위아래: 큰 분류 순서(= 자료실 분류 칩 순서)를 서버에 저장한다. '기타'는 늘 맨 끝.
  const movable=()=>topDocumentCategories().filter(name=>name!==LOCKED_CATEGORY);
  async function move(next,name){
    if(busy)return;
    if(next.every((x,i)=>x===movable()[i]))return;
    busy=true;say(CATEGORY_EDITOR_TEXT.saving);paint();
    const result=await reorderDocumentCategories(next,{rt});
    await finish(result,{success:()=>'순서를 바꿨어요.',focusAfter:`[data-reorder-id="${CSS.escape(name)}"] [data-reorder-handle]`});
  }
  mountListEdit(host,{key:'dce',label:'분류 고치기',
    items:name=>isSubcategory(name)?[{key:'rename',label:'이름 바꾸기'},{key:'delete',label:'지우기'}]:[{key:'sub',label:'+ 소분류'},{key:'rename',label:'이름 바꾸기'},{key:'delete',label:'지우기'}],
    onAct:(name,act)=>{if(busy||!documentCategories().includes(name))return;if(act==='sub')startAddSub(name);else if(act==='rename')startRename(name);else if(act==='delete')void remove(name);},
    onMove:(name,index)=>void move(leMove(movable(),name,index),name),
    onStep:(name,dir)=>void move(leStep(movable(),name,dir),name),
    canDrag:()=>!busy});
  host.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.leRename!==undefined)startRename(button.dataset.leRename);
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
    if(event.key==='Escape'&&addSubFor&&!editing&&!busy&&host.contains(event.target)){event.stopPropagation();const parent=addSubFor;addSubFor='';subDraft='';say('');paint();focus(`[data-le-menu="${CSS.escape(parent)}"]`);return;}
    if(event.key==='Escape'&&editing&&!busy&&host.contains(event.target)){event.stopPropagation();const name=editing;editing=null;say('');paint();focus(`[data-le-rename="${CSS.escape(name)}"]`);}
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
