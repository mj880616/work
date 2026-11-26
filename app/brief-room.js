// BRIEF-브리핑룸 ③ 화면(?view=brief, 메뉴 '브리핑 룸'). #briefView의 유일한 그리기 주인. 설계 docs/design/brief-room.md 6절, 시안 PR 2542.
// - 목록: 자료실 '브리핑 요청함' 폴더(그 아래 폴더 포함) 자료 + 브리핑을 받은 자료. 줄마다 [브리핑 받기] / 만드는 중 n/m / 실패 한 줄.
//   S70-84 BRIEF-두칸폴더(명진 11/26 09:28 "미리보기 안보여줘도 되고 파일 이름 기준으로 하고 여기도 폴더 개념이 들어가야하고 폴드펼침과 pc에서는 왼쪽 목록 오른쪽 상세"):
//   줄은 [파일] 목록 줄과 같은 칸(files.css .fx-head·.fx-row — 이름 · 넣은 날 · 크기 · 종류, 한 줄 요지 없음), 정렬은 [파일] sortRows(기본 이름 오름, 머리 칸 누르기,
//   폰은 정렬 고르기, 서버 view_prefs.brief_sort). 폴더는 새 표 없이 자료실 '브리핑 요청함' 아래 폴더(app_library_folders·app_library_folder_items, owner RLS)를
//   공용 폴더 줄(folder-tree-ui.mjs)로 그 자리 펼치기 나무로 그린다(만들기·이름 바꾸기·지우기 = 자료실과 같은 휴지통 길·끌어 옮기기·[폴더로 옮기기] = 공용 '옮길 곳' 창, 맨 아래 '폴더 없음').
//   칸 나누기 폭(600px~, 폴드 펼침·PC)은 왼쪽 목록 | 오른쪽 브리핑 두 칸(공용 split-resize.js, 서버 split_ratio.brief), 폰은 한 칸 그대로. 모델 brief-folders-model.mjs.
// - 보기(S68-56, 명진 11/23 15:06·15:12 "미리 정한 칸에 우겨넣지 말고 걍 요약"): 요지(옅은 띠) → AI가 자료 짜임대로 정한 소제목별 항목
//   (소제목 앞 3개만 펼치고 나머지는 접힘 <details>, 항목 옆 쪽 링크·'우리 관련' 작은 표시) → 원문 인용(접힘, 원문 그대로 + 발언자 + 쪽).
//   고정 칸(챙길 일·대응할 것)과 [할 일로]는 없다. 옛 형식 브리핑은 briefView가 읽을 때 같은 모양으로 옮긴다(S70-29: 위 '예전 방식 브리핑' 띠는 일회용이라 지움).
//   폰은 목록 대신, 600px~(칸 나누기 폭)는 오른쪽 칸.
// - [브리핑 받기]만 AI를 부른다(명진 결정 1). 서버 document-actions brief-start, 진행·결과는 표 app_document_briefs를 owner RLS로 읽기만.
// - [+] [파일 업로드]·놓기(S71-30, 전 [자료 넣기]): 자료실 등록 창을 '브리핑 요청함' 폴더로 연다(자료 원본은 자료실 한 곳, 폴더는 없으면 owner RLS로 하나 만든다).
// - 서버 저장만(기기 저장 없음). 글자는 textContent로만 넣는다.
// - BRIEF-브리핑룸삭제(S63-08): 줄 ⋯는 BRIEF-밀기메뉴로 없앴다(폰 왼쪽 밀기·PC 우클릭 = [수정][삭제], 삭제 = 브리핑+자료, 자료실에 있던 자료는 자료 보존).
//   브리핑만 = 서버 함수 app_document_brief_delete(owner 검사, 만드는 중이면 서버 작업도 멈춤) + '브리핑 요청함' 폴더에 있었으면 폴더 밖으로(owner RLS).
//   자료까지 = 자료실 삭제와 같은 길(document-delete.js → document-actions delete, Drive 휴지통). 여러 개는 공용 선택 부품(select-mode.js·library-select.js)으로 같은 두 가지.
// - BRIEF-자료실에서고르기(S64-10, 명진 11/17 09:31): [자료실에서 고르기] → 공용 고르기 창(library-move-picker.js, 여러 개)으로 내 자료실 자료를 고른다.
//   파일을 다시 올리지 않고 '브리핑 요청함' 폴더에 연결 줄만 넣는다(app_library_folder_items, owner RLS, 이미 있으면 건너뜀). 받기는 줄의 [브리핑 받기]로만.
//   자료 하나는 폴더 하나라(표 기본키), 다른 폴더에 든 자료는 옮기지 않고 그대로 두고 이 화면 목록에만 보인다(브리핑을 받으면 계속 남음).
// - S69-86 BRIEF-밑줄노트(명진 11/25 00:50·00:53): 보기 본문(요지·소제목 줄·원문 인용, [data-br-zone])에서 글을 선택하면 읽을 거리와 같은 공용 줄
//   (text-select-bar.js) [밑줄 저장][답글][노트로][복사][공유]. 밑줄은 공용 text-highlights.js(표 app_news_highlights, 종류 brief, source_id = 자료 id)로
//   저장·칠하기·메뉴(메모·노트로·복사·삭제). [답글] = 고른 글 + 메모 → 새 노트. 머리 [노트로 보관] = 브리핑 한 장 + 이 자료 밑줄 → 새 노트(마크다운).
//   셋 다 글을 복사해 넣고 브리핑·자료를 가리키는 연결(외래 키)을 두지 않아, 브리핑만 삭제·자료까지 삭제 뒤에도 남는다(출처는 이름·날짜 글자).
//   글자 크기 [−][+]는 공용 text-size.js(읽을 거리·News 글 보기와 같은 다섯 단계·같은 서버 값 view_prefs.news_font — 읽는 글자 크기 하나를 함께 쓴다).
//   보기는 머리 줄 [원문 열기] 옆, 목록만 보일 때(폰 목록·보기를 열지 않은 PC)는 목록 머리 줄 끝. 본문·목록 줄 글자만 커지고 머리·단추는 그대로.
// - S70-27 BRIEF-손수정·우클릭(명진 11/25 11:14 "브리핑 ai가 만든걸 수기 수정가능하게 / 여기 우클릭 안먹네"): 머리 [수정](PC는 요약 글 우클릭 [수정]도)
//   = 요지 줄·소제목·줄을 그 자리 칸으로 바꿔 고치고 [저장](Enter)·[취소](Esc). 저장은 서버 함수 app_document_brief_edit(owner 검사, 표 edited 칸) —
//   AI 원문(brief 칸)은 그대로, 보기는 고친 한 장(brief-edit-model.mjs). 고친 브리핑은 줄 아래 '손으로 고침 · [원래 AI 글로 되돌리기]'.
//   다시 만들기(brief-start)는 고친 브리핑이면 먼저 묻는다(취소가 기본 — 지금 다 된 브리핑을 다시 만드는 단추는 없어(S70-29) 막아 두는 몫만). 밑줄은 글자 대조(locate)라 고친 뒤 못 찾은 밑줄은 칠하지 않을 뿐 남는다.
//   PC 요약 글 우클릭(Shift+F10·메뉴 키) = 공용 줄 메뉴(row-menu.js) [고치기] + 고른 글 막대와 같은 항목(text-select-bar selectBarActs).
//   글을 골라 두었으면 그 고른 글에, 아니면 누른 줄 글에. 고치는 칸·입력 칸 위에서는 브라우저 기본 메뉴 그대로.
import {ARCHIVE_LABEL,BRIEF_GONE,archiveNote,briefSource,BRIEF_FOLDER,BRIEF_POLL_MS,BRIEF_SELECT,BRIEF_SELECT_EDIT,DELETE_KINDS,PICK_SECTIONS,PICK_VIEWS,GIST_TITLE,OURS_TAG,QUOTES_TITLE,RETRY_LABEL,SHOW_N,briefView,canRetry,doneDate,deleteConfirm,deleteResult,fileBadge,isStalled,latestByDocument,libraryPickRows,listRows,partialLine,pickResult,sourceUrl,startError} from './brief-room-model.mjs';
import {createMovePicker} from './library-move-picker.js';
import {readLibraryFolders} from './library-folder-data.js';
import {waitHtml,failHtml,emptyEl} from './wait-state.js';
import {notify,askConfirm} from './small-notice.js';
import {firstUseEl} from './first-use.js'; // HELP-처음쓰는사람안내 ③: 넣은 자료가 없을 때 목록 자리 안내
import {createAnchoredMenu} from './anchored-menu.js';
import {createSelectMode} from './select-mode.js';
import {deleteSequentially} from './library-select.js';
import {fitAll} from './auto-grow.js'; // UI-입력칸자동높이: 고치기 줄도 공용 늘어나는 칸
import {loadHighlights,sourceHighlights,sourceMarks,markActions,onHighlights,paintMarks,bindMarks,saveFromSelection,noteFromSelection,replyFromSelection,revealMark} from './text-highlights.js';
import {bindSelectZone,selectBarActs,runSelectBarAct} from './text-select-bar.js';
import {EDIT_LABEL,EDITED_TAG,REDO_ASK,REVERT_ASK,REVERT_LABEL,applyEdits,editFields,fitsServer,isEdited,lineMenuItems,shownBrief} from './brief-edit-model.mjs';
import {openRowMenu,appMenuPoint} from './row-menu.js';
import {textSizeHtml,paintTextSize,setTextSize,textSize} from './text-size.js';
import {createNoteDoc} from './basket-data.js';
import {NONE,NONE_LABEL,BRIEF_SORT_KEYS,BRIEF_SORT_NAME,briefSubtree,cleanSort as cleanBriefSort,canMoveFolder,cleanFolderName,folderOfDoc,kindKey,kindText,sizeOf,toggleOpen,treeRows} from './brief-folders-model.mjs';
import {KIND,dayText} from './files-model.mjs';
import {iconSvg} from './tree-icons.js';
import {ftFolderRowHtml,ftEmptyRowHtml,ftIconHtml} from './folder-tree-ui.mjs';
import {nextSort,headCellHtml,sortSelectHtml,parseSortValue,bindHeadSort} from './head-sort.mjs';
import {viewPrefs} from './view-prefs.js';
import {SPLIT_QUERY} from './screen-width.mjs';
import {mountSplitResize} from './split-resize.js';
import {followPane} from './follow-pane.js';
import {openFolderSheet} from './folder-dest-sheet.js';
import {askText} from './small-notice.js';
import {createLibraryFolder,putDocumentInFolder} from './library-folder-data.js';
import {registerScreenFind,refreshScreenFind,finderOf,toolsBox} from './screen-find.js';
import {bindRowSwipe,PICK,EDIT,DELETE} from './row-swipe.js';
import {stepTextSize} from './text-size-model.mjs';

const rt=()=>window.KPTURuntime;
const ws=()=>rt()?.context?.read?.()?.workspace?.id||'';
const enc=encodeURIComponent;
const ACTIONS='/functions/v1/document-actions';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
const btn=(cls,text,data)=>{const b=el('button',cls,text);b.type='button';for(const [k,v] of Object.entries(data||{}))b.dataset[k]=v;return b};

function install(){
  if(document.getElementById('briefView'))return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend','<section id="briefView" class="view-panel hidden" aria-label="브리핑 룸"><div class="br-wrap"><div class="br-list" data-br-list></div><div class="br-detail" data-br-detail hidden></div></div></section>');
}

const state={folderId:null,docs:[],folderDocs:new Set(),allFolders:[],sub:[],itemFolder:new Map(),xopen:new Set(),sort:null,dragging:null,picked:new Set(),pickedWs:'',briefs:new Map(),open:null,loading:false,failed:false,timer:null,asked:new Set(),busy:false,
  editable:true,editing:null};// editing = {doc, focus(칸 key), values: Map(key → 글)} — 이 탭 메모리만, 저장은 서버

// 목록에 보일 자료: '브리핑 요청함' 폴더 자료 + 이번에 고른 다른 폴더 자료(브리핑이 있는 자료는 listRows가 더한다).
// 자료실에 이미 있던 자료를 [자료실에서 선택]으로 넣은 줄(이 화면 '브리핑 요청함' 폴더 밖 자료 + 이번에 고른 자료)은 삭제해도 자료를 남긴다.
// 서버가 이 구분을 모르면 화면 규칙일 뿐이라(PR 본문 '제안'), 자료까지 지우는 길(removeWithDocument)에서도 한 번 더 막는다.
const isLibraryDoc=id=>state.picked.has(id)||!state.folderDocs.has(id);
const roomIds=()=>new Set([...state.folderDocs,...state.picked]);
const roomRows=()=>listRows({docs:state.docs,folderIds:roomIds(),briefs:state.briefs});
const pick=createSelectMode({layer:'brief-select',onBack:()=>draw(),canLeave:()=>!state.busy});
const docName=d=>String(d?.title||d?.file_name||'이름 없는 자료');
const view=()=>document.getElementById('briefView');
const wide=()=>window.matchMedia?.('(min-width: 761px)').matches; // PC 틀(왼쪽 메뉴) — 우클릭 메뉴·글자 고르기 판정에만
// S70-84: 두 칸(왼쪽 목록 | 오른쪽 브리핑)은 앱 공용 칸 나누기 폭(screen-width.mjs 600px~ — 폴드 펼침 포함). 그 아래(폰·접은 폴드)는 목록 → 보기(뒤로 = 목록).
const SPLIT=window.matchMedia?.(SPLIT_QUERY);
const split=()=>!!SPLIT?.matches;
const mouse=()=>!!window.matchMedia?.('(pointer: fine)').matches;
const sortNow=()=>state.sort||=cleanBriefSort(viewPrefs.getBriefSort?.());
// S70-57(명진 11/26 "메뉴별 검색창은 '<메뉴>에서 찾기'로 통일 / 검색창은 하나로만"): 맨 위 칸이 '브리핑 룸에서 찾기' — 목록 줄을
// 자료 이름·파일 이름·한 줄 요지로 거른다. 이 화면 메모리만(서버 검색 없음). 폰에서 보기가 목록 대신일 때는 찾기가 아니다.
let findText='',findQuery='';
// S70-67 SEARCH-비슷한것찾기: 공용 판정(띄어쓰기 무시·오타·초성·앞부분, 비슷한 말), 맞은 정도 순, 맞은 부분 굵게.
const finder=finderOf('brief',()=>findText),rowTexts=row=>[docName(row.doc),row.doc.file_name]; // S71-30: 줄에 보이는 이름으로만(요지는 줄에 없음)
registerScreenFind('brief',{label:'브리핑 룸에서 찾기',marks:'#briefView [data-br-list]',
  active:()=>window.KPTURouter?.current==='brief'&&!!view()&&!view().classList.contains('hidden')&&!view().querySelector('[data-br-list]')?.hidden,
  value:()=>findQuery?findText:'',
  apply:(raw,{again}={})=>{findText=String(raw??'');const next=findText.trim().toLowerCase();if(next===findQuery&&!again)return;findQuery=next;drawList()}});
const here=()=>window.KPTURouter?.current==='brief'&&!document.hidden;

async function findFolder(){
  const rows=await rt().api(`/rest/v1/app_library_folders?workspace_id=eq.${enc(ws())}&project_id=is.null&parent_id=is.null&deleted_at=is.null&name=eq.${enc(BRIEF_FOLDER)}&select=id&order=created_at.asc&limit=1`,{refreshSession:false,singleFlight:false});
  return Array.isArray(rows)&&rows[0]?.id||null;
}
// '회의 녹음' 폴더(PR 2485)와 같은 규칙: 맨 위·프로젝트 없음, 없으면 맨 아래 순서로 하나.
async function ensureFolder(){
  const have=await findFolder();if(have)return have;
  const tops=await rt().api(`/rest/v1/app_library_folders?workspace_id=eq.${enc(ws())}&project_id=is.null&parent_id=is.null&select=sort_order&limit=500`,{refreshSession:false,singleFlight:false});
  const sort=(Array.isArray(tops)?tops:[]).reduce((m,f)=>Math.max(m,Number(f.sort_order)||0),0)+1;
  const made=await rt().api('/rest/v1/app_library_folders',{method:'POST',prefer:'return=representation',body:{workspace_id:ws(),project_id:null,parent_id:null,name:BRIEF_FOLDER,sort_order:sort}});
  window.dispatchEvent(new CustomEvent('kptu:library-folders-changed'));
  return Array.isArray(made)&&made[0]?.id||await findFolder();
}

// S70-27: 고친 한 장 칸(edited)까지 읽는다. DB 적용 전(칸 없음 → 400)이면 예전 칸만 다시 읽고 [고치기]를 끈다.
async function readBriefs(w){
  const get=sel=>rt().api(`/rest/v1/app_document_briefs?workspace_id=eq.${w}&select=${sel}&order=created_at.desc&limit=300`,{refreshSession:false,singleFlight:false});
  if(state.editable){
    try{return await get(BRIEF_SELECT_EDIT)}
    catch(e){if(Number(e?.status)!==400)throw e;state.editable=false}
  }
  return get(BRIEF_SELECT);
}
async function load(){
  if(!ws()||!rt()?.api)return;
  state.loading=true;
  try{
    const w=enc(ws());
    const [folderId,briefRows]=await Promise.all([findFolder(),readBriefs(w)]);
    state.folderId=folderId;
    state.briefs=latestByDocument(briefRows);
    // S70-84: 브리핑 폴더 = '브리핑 요청함' 아래 자료실 폴더(지운 것 빼고). 자료 연결 줄은 그 폴더들(브리핑 요청함 포함)만 읽는다.
    const all=folderId?await rt().api(`/rest/v1/app_library_folders?workspace_id=eq.${w}&deleted_at=is.null&select=id,parent_id,name,sort_order&order=sort_order.asc,created_at.asc&limit=2000`,{refreshSession:false,singleFlight:false}):[];
    state.allFolders=Array.isArray(all)?all:[];
    state.sub=briefSubtree(state.allFolders,folderId);
    const ids0=folderId?[folderId,...state.sub.map(f=>f.id)]:[];
    const items=[];
    for(let i=0;i<ids0.length;i+=100){
      const part=ids0.slice(i,i+100),got=await rt().api(`/rest/v1/app_library_folder_items?workspace_id=eq.${w}&folder_id=${part.length===1?'eq.'+enc(part[0]):`in.(${part.map(enc).join(',')})`}&select=document_id,folder_id&limit=1000`,{refreshSession:false,singleFlight:false});
      if(Array.isArray(got))items.push(...got);
    }
    state.itemFolder=new Map(items.map(i=>[i.document_id,i.folder_id||folderId]));
    state.folderDocs=new Set(items.map(i=>i.document_id));
    const live=new Set(state.sub.map(f=>f.id));for(const id of [...state.xopen])if(!live.has(id))state.xopen.delete(id);
    if(state.pickedWs!==ws()){state.picked=new Set();state.pickedWs=ws()}
    const ids=[...new Set([...state.folderDocs,...state.picked,...state.briefs.keys()])].slice(0,500);
    state.docs=ids.length?await rt().api(`/rest/v1/app_documents?workspace_id=eq.${w}&id=in.(${ids.map(enc).join(',')})&select=id,title,file_name,mime_type,file_id,drive_url,file_size,created_at&limit=500`,{refreshSession:false,singleFlight:false}):[];
    state.failed=false;state.loaded=true;
  }catch{state.failed=true}
  finally{state.loading=false}
}

function stateNode(row){
  const s=row.state;
  if(s.kind==='start'){const b=btn('br-start mini primary','브리핑 받기',{brStart:row.doc.id});return b}
  if(s.kind==='making')return el('span','br-st',s.text);
  // S70-84: 다 된 줄은 상태 칸을 비운다(넣은 날은 날짜 칸, 브리핑 날짜는 칸 위에 마우스를 올리면). 줄을 누르면 보기.
  if(s.kind==='done'){const n=el('span','br-st br-st-done');n.title=s.date?`${s.date} 브리핑`:'';return n}
  // 줄 ⋯를 없앤 뒤에도 못 만든 줄은 줄 안 단추로 다시 만든다(전에는 ⋯ [다시 만들기]).
  const bad=el('span','br-st br-st-bad',s.text);
  if(!canRetry(state.briefs.get(row.doc.id)))return bad;
  const box=el('span','br-st-retry');box.append(bad,btn('br-start br-retry mini',RETRY_LABEL,{brRetry:row.doc.id}));return box;
}

// S70-84: 자료 한 줄 = [파일] 목록 줄 칸(files.css .fx-row — 그림 · 이름 · 넣은 날 · 크기 · 종류)에 브리핑 상태 칸과 ⋯. 폰은 [파일] 폰 줄처럼 이름 / 날짜·크기·종류 두 줄.
// 한 줄 요지(미리보기)는 두지 않는다. 다 된 줄의 상태 칸은 비우고(브리핑 날짜는 title), 보기는 줄을 눌러 연다.
function fileRow(row,depth){
  const d=row.doc,r=el('div','fx-row br-row');r.dataset.brOpen=d.id;r.tabIndex=row.state.kind==='done'?0:-1;r.setAttribute('role',row.state.kind==='done'?'button':'group');
  if(depth)r.style.setProperty('--br-depth',String(depth));
  if(state.open===d.id)r.classList.add('is-open');
  if(!pick.active&&mouse()){r.draggable=true;r.dataset.brDrag=d.id}
  const k=kindKey(d),ico=el('span','fx-ico');ico.dataset.kind=k;ico.setAttribute('aria-hidden','true');
  if(KIND[k]?.svg)ico.innerHTML=iconSvg(KIND[k].svg,{size:14});else ico.textContent=KIND[k]?.icon||'';
  const nm=el('span','fx-nm'),name=el('span','fx-name br-nm',docName(d));name.title=docName(d);nm.append(name);
  const day=dayText(d.created_at),size=sizeOf(d),kind=kindText(d);
  if(pick.active){const c=el('input','br-pick');c.type='checkbox';c.dataset.brPick=d.id;c.checked=pick.has(d.id);c.setAttribute('aria-label','선택: '+docName(d));r.append(c)}
  const st=stateNode(row);
  r.append(ico,nm,el('span','fx-day',day),el('span','fx-size',size),el('span','fx-kind',kind),st,el('span','fx-sub',[day,size,kind].filter(Boolean).join(' · ')));
  return r;
}
const html=h=>{const t=document.createElement('template');t.innerHTML=h;return t.content.firstElementChild};
// 폴더 줄: 공용 폴더 줄 하나(folder-tree-ui.mjs). 이름 누르기 = 그 자리 펼치기·접기(표준 T5), ⋯ = 폴더 메뉴, 끌어 놓을 곳.
function folderRow(t){
  const none=t.type==='none',name=none?NONE_LABEL:t.folder.name;
  const node=html(ftFolderRowHtml({name,count:t.count||'',countLabel:`자료 ${t.count||0}개`,depth:t.depth,open:t.open,hasContent:t.hasContent||!none,
    icon:none?`<span class="ft-ico tree-ico-outside" aria-hidden="true">${iconSvg('outside',{size:15})}</span>`:null,
    className:'br-folder',rowAttrs:{'data-br-drop':t.id,'data-br-folder':none?null:t.id,draggable:!none&&mouse()?'true':null},
    mainAttrs:{'data-br-fold':t.id,'aria-label':`${name} ${t.open?'접기':'펼치기'}`},
    more:{attrs:{'data-br-fmore':t.id},label:`폴더 메뉴: ${name}`}}));
  return node;
}
function listHead(){
  const cur=sortNow();
  return html(`<div class="fx-head br-fhead" role="row" aria-label="정렬 머리"><span aria-hidden="true"></span>${['name','modified','size','kind'].map(key=>headCellHtml({key,label:BRIEF_SORT_NAME[key],cur})).join('')}<span aria-hidden="true"></span></div>`);
}
// S71-30 BRIEF-머리한줄(명진 11/26 17:38 "여기에 파일을 놓아듀 돼요 이 안내멘트 삭제"): 화면 안 머리 줄([자료실에서 선택][자료 넣기][−|+])과
// 점선 놓기 안내 줄은 없다. 머리 단추는 맨 위 줄 단추 상자(screen-find.js toolsBox — 폰·폴드 '브리핑 룸 · 찾기' 오른쪽, PC 상단 줄 검색 칸 오른쪽)의
// [⋯](정렬(폰)·글자 크기·쓰는 법)·[+](자료실에서 선택 · 파일 업로드, 전에 두 단추가 하던 그대로) 둘뿐, [+]가 맨 오른쪽.
// 파일 끌어 놓기는 그대로(화면 어디든 — 끄는 동안 화면 테두리 표시 .br-dropping). 목록 칸은 고르기 막대(⋯ [선택]·오른쪽 밀기)와 목록뿐.
function drawList(){
  const box=view()?.querySelector('[data-br-list]');if(!box)return;
  const rowsNow=roomRows();
  if(pick.prune(rowsNow.map(r=>r.doc.id))&&!pick.size)pick.stop();
  const top=[];
  if(pick.active){const bar=el('div','br-head br-pickbar');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','선택한 자료');bar.append(...pickBar(rowsNow));top.push(bar)}
  // 오른쪽 밀기 고르기 막대(공용 row-swipe.js가 목록 칸 바로 위에 붙임)는 다시 그려도 그 자리에 둔다.
  const swipeBar=box.querySelector(':scope>.row-swipe-pickbar');if(swipeBar)top.push(swipeBar);
  if(state.failed&&!state.docs.length){box.replaceChildren(...top);box.insertAdjacentHTML('beforeend',failHtml({retry:'data-br-retry'}));return}
  view()?.classList.toggle('br-split',split()&&(rowsNow.length>0||state.sub.length>0));
  // HELP-처음쓰는사람안내 ③: 서버에서 읽은 뒤에도 자료·폴더가 하나도 없으면 '처음 쓰는 법' 안내(자료가 생기면 목록이 대신 그려짐). 읽기 전·못 읽음은 지금처럼.
  if(!rowsNow.length&&!state.sub.length&&state.loaded&&!pick.active){box.replaceChildren(...top,firstUseEl('brief'));return}
  const list=el('div','fx-rows br-rows');if(pick.active)list.classList.add('br-picking');list.dataset.textSizeTarget='';list.setAttribute('role','list');
  // 맨 위 칸 '브리핑 룸에서 찾기'를 쓰는 동안은 폴더 없이 맞은 자료만 맞은 정도 순(S70-57·S70-67 공용 판정 — 자료 이름·파일 이름).
  if(findQuery)for(const row of finder().rank(rowsNow,rowTexts))list.append(fileRow(row,0));
  else for(const t of treeRows({sub:state.sub,rows:rowsNow,itemFolder:state.itemFolder,open:state.xopen,sort:sortNow()})){
    if(t.type==='file')list.append(fileRow(t.row,t.depth));
    else if(t.type==='empty')list.append(html(ftEmptyRowHtml({depth:t.depth,attrs:{'data-br-drop':t.id}})));
    else list.append(folderRow(t));
  }
  if(!rowsNow.length&&!state.sub.length)list.append(emptyEl('넣은 자료 없음 — [+]로 긴 자료를 넣고 [브리핑 받기]'));
  const parts=[...top];
  if(split())parts.push(listHead());
  const host=rowsHost();host.replaceChildren(list);parts.push(host);
  box.replaceChildren(...parts);
  paintTextSize(box);
  bindHeadSort(box,key=>{state.sort=nextSort(sortNow(),key);viewPrefs.setBriefSort?.(state.sort);drawList()});
}
// 목록 줄을 담는 고정 칸 하나(줄 밀기 공용 부품이 한 번만 붙는 자리 — 목록을 다시 그려도 같은 칸).
let rowsBox=null;
function rowsHost(){
  if(rowsBox)return rowsBox;
  rowsBox=el('div','br-rows-host');rowsBox.dataset.brRowsHost='';
  bindSwipe(rowsBox);
  return rowsBox;
}

// ---------- S71-30 머리 단추 [⋯][+] ----------
const tools=toolsBox('brief','brief');
tools.innerHTML='<button type="button" class="icon-btn br-tool br-top-more" data-br-top-more data-ctx="screen" aria-haspopup="true" aria-expanded="false" aria-controls="brTopMenu" aria-label="브리핑 룸 메뉴" title="메뉴"><span class="more-dots" aria-hidden="true">⋯</span></button>'
  +'<button type="button" class="icon-btn br-tool br-top-add" data-br-top-add aria-haspopup="true" aria-expanded="false" aria-controls="brAddMenu" aria-label="자료 넣기" title="자료 넣기"></button>';
const addButton=()=>tools.querySelector('[data-br-top-add]');
// [+] 작은 메뉴: 자료실에서 선택(공용 고르기 창 — 다시 올리지 않고 연결만) · 파일 업로드(자료실 등록 창, '브리핑 요청함' 폴더). 메뉴 줄 글자는 클립 없이(ui-words 업로드).
const ADD_ITEMS=Object.freeze([{act:'lib',label:'자료실에서 선택'},{act:'file',label:'파일 업로드'}]);
const addMenu=createAnchoredMenu({id:'brAddMenu',className:'topline-add-menu br-add-menu',label:'자료 넣기',historyKey:'kptuBriefAddMenu',key:()=>'add',boxWidth:180,
  render:()=>ADD_ITEMS.map(i=>`<button type="button" class="row-act" data-br-add-act="${i.act}"${i.act==='lib'?' aria-haspopup="dialog"':''}>${i.label}</button>`).join(''),
  onAction:button=>{const a=button.dataset.brAddAct,at=addButton();if(a==='lib'&&at)void openLibraryPick(at);else if(a==='file')void add()}});
// [⋯] 화면 메뉴: 정렬(폰 — 머리 칸이 없는 한 칸 목록, 표준 H1의 정렬 고르기) · 글자 크기 [−][+](보기 머리 줄에 있을 때는 그쪽 하나만) · 쓰는 법.
const topMenu=createAnchoredMenu({id:'brTopMenu',className:'topline-add-menu br-top-menu',label:'브리핑 룸 메뉴',historyKey:'kptuBriefTopMenu',key:()=>'top',boxWidth:220,
  render:()=>(split()?'':`<div class="br-menu-line"><span class="br-menu-tx">정렬</span>${sortSelectHtml({keys:BRIEF_SORT_KEYS,names:BRIEF_SORT_NAME,cur:sortNow(),label:'정렬',className:'fx-sort br-sort',attrs:'data-br-sort'})}</div>`)
    +(detailShown()?'':`<div class="br-menu-line" data-br-menu-size><span class="br-menu-tx">글자 크기</span>${textSizeHtml()}</div>`)
    +'<button type="button" class="row-act" data-br-top-act="help">쓰는 법</button>',
  onAction:button=>{if(button.dataset.brTopAct==='help')void import('./help-link.js').then(m=>m.openHelp('brief'))}});
{
  const panel=document.getElementById('brTopMenu');
  // 글자 크기 단추는 메뉴를 닫지 않고 그 자리에서 한 단계씩(공용 메뉴는 단추를 누르면 닫히므로 여기서 먼저 받는다).
  panel?.addEventListener('click',e=>{const b=e.target.closest?.('[data-text-size-step]');if(!b)return;e.stopPropagation();if(b.disabled)return;
    setTextSize(stepTextSize(textSize(),Number(b.dataset.textSizeStep)));paintTextSize(panel);if(b.disabled)b.closest('[data-text-size-ctl]')?.querySelector('[data-text-size-step]:not(:disabled)')?.focus({preventScroll:true})},true);
  panel?.addEventListener('change',e=>{const sel=e.target.closest?.('[data-br-sort]');if(!sel)return;const next=parseSortValue(sel.value,BRIEF_SORT_KEYS);if(!next)return;state.sort=next;viewPrefs.setBriefSort?.(next);drawList()});
}
tools.addEventListener('click',e=>{
  const more=e.target.closest?.('[data-br-top-more]');if(more){e.stopPropagation();topMenu.open(more);return}
  const plus=e.target.closest?.('[data-br-top-add]');if(plus){e.stopPropagation();if(libPicker?.isOpen){void libPicker.close(false,true);return}addMenu.open(plus)}
});

// ---------- S71-30 BRIEF-밀기: 폰 목록 줄 밀기(공용 row-swipe.js — 파일·조직·사업 기록과 같은 부품) ----------
// 왼쪽 밀기 = 메뉴 칸만(표준 P5·W1, 끝까지 밀어도 바로 하지 않음) [주 동작][⋯][삭제](W2): 주 동작 = 못 만든 줄은 [다시 만들기], 그 밖은 [옮기기](⋯ [폴더로 옮기기…]와 같은 창),
// 가운데 = 고칠 것이 없는 줄이라 그 줄 ⋯ 메뉴(W2 '대표 일'), [삭제] = ⋯ [브리핑만 삭제]와 같은 길(확인 한 번, 자료는 자료실에 남음). [자료까지 삭제]는 ⋯에 그대로.
// 오른쪽 밀기 = 여러 개 선택(W3, 공용 고르기 막대 [전체 선택] · [옮기기] · [삭제](= 브리핑만 삭제)). 폴더 줄은 밀지 않는다.
function bindSwipe(root){
  bindRowSwipe(root,{row:'.br-row[data-br-open]',enabled:()=>!state.busy&&!pick.active&&!state.editing&&here(),
    actions:row=>{const id=row.dataset.brOpen;if(!state.docs.some(d=>d.id===id))return null;
      return {start:PICK,end:canEditRow(id)?[EDIT,DELETE]:[DELETE]}},
    run:(key,row)=>{const id=row.dataset.brOpen;if(!state.docs.some(d=>d.id===id))return;
      if(key==='edit')editRow(id);
      else if(key==='delete')void removeMany([id],'auto',row)},
    select:{attr:'data-br-open',label:'선택한 자료',acts:()=>[{key:'move',label:'옮기기'},{key:'delete',label:'삭제',danger:true}],
      run:async(key,ids)=>{const at=view()?.querySelector(`.br-row[data-br-open="${CSS.escape(ids[0])}"]`)||null;
        if(key==='move')openMoveSheet(at,{docs:ids});else if(key==='delete')await removeMany(ids,'auto',at)}}});
}

// 쪽 링크(쪽을 아는 PDF는 원문 그 쪽, 원문 주소가 없으면 글자만).
function pageNode(doc,page,cls){
  const link=sourceUrl(doc,page),a=el(link?'a':'span',cls,`${page}쪽`);
  if(link){a.href=link;a.target='_blank';a.rel='noopener'}
  return a;
}
// 본문 항목 한 줄: 글 + (우리 관련 작은 표시) + (쪽 링크).
function itemNode(it,doc,key){
  const li=el('li','br-it');li.dataset.brLine=key;li.tabIndex=-1;
  li.append(el('span','br-tx',it.text));
  if(it.ours)li.append(el('span','br-ours',OURS_TAG));
  if(it.page)li.append(pageNode(doc,it.page,'br-ref'));
  return li;
}
// 원문 인용 한 줄: 원문 그대로(누르면 원문 그 자리) + 발언자 · 쪽 · 소제목.
function quoteNode(it,doc){
  const li=el('li','br-it br-it-quote'),q=el('blockquote','br-q'),link=sourceUrl(doc,it.page);
  if(link){const a=el('a','br-qt',`“${it.text}”`);a.href=link;a.target='_blank';a.rel='noopener';q.append(a)}
  else q.append(el('span','br-qt',`“${it.text}”`));
  const meta=el('span','br-pg');
  if(it.speaker)meta.append(el('span','br-who',it.speaker));
  if(it.page){if(meta.childNodes.length)meta.append(document.createTextNode(' · '));meta.append(pageNode(doc,it.page,null))}
  if(it.heading){if(meta.childNodes.length)meta.append(document.createTextNode(' · '));meta.append(document.createTextNode(it.heading))}
  if(meta.childNodes.length)q.append(meta);
  li.append(q);
  return li;
}

// 보기가 그려질 자료인가(다 된 브리핑을 연 상태). 목록 머리 글자 크기 단추를 둘지 정한다.
function detailShown(){const b=state.open?state.briefs.get(state.open):null;return !!(b?.status==='done'&&b.brief&&state.docs.some(d=>d.id===state.open))}
function drawDetail(){
  const box=view()?.querySelector('[data-br-detail]'),listBox=view()?.querySelector('[data-br-list]');if(!box)return;
  const doc=state.docs.find(d=>d.id===state.open),b=doc?state.briefs.get(doc.id):null;
  if(!doc||b?.status!=='done'||!b.brief){state.editing=null;box.hidden=true;box.replaceChildren();if(listBox)listBox.hidden=false;view()?.classList.remove('br-reading');refreshScreenFind();return}
  if(state.editing&&state.editing.doc!==doc.id)state.editing=null;
  // 고치는 중에는 4초마다 다시 그리기·창 크기·밑줄 알림이 와도 칸을 새로 만들지 않는다(쓰던 글·커서 그대로).
  if(state.editing&&box.dataset.brDoc===doc.id&&box.querySelector('[data-br-form]')){if(listBox)listBox.hidden=!split();return}
  view()?.classList.add('br-reading');
  if(listBox)listBox.hidden=!split();
  refreshScreenFind();
  const bar=el('div','br-head');
  if(!split()){const back=btn('br-back icon-btn','‹',{brBack:'1'});back.setAttribute('aria-label','목록으로');bar.append(back)}
  bar.append(el('h2','br-title br-doc',String(doc.title||doc.file_name||'')));
  const src=sourceUrl(doc);
  if(src){const a=el('a','br-src mini','원문 열기');a.href=src;a.target='_blank';a.rel='noopener';bar.append(a)}
  bar.insertAdjacentHTML('beforeend',textSizeHtml());
  bar.append(btn('br-archive mini',ARCHIVE_LABEL,{brArchive:doc.id}));
  if(state.editable&&!state.editing)bar.append(btn('br-edit mini',EDIT_LABEL,{brEdit:doc.id}));
  const meta=el('p','br-meta',[fileBadge(doc.file_name,doc.mime_type),b.page_count?`${b.page_count}쪽`:'',b.finished_at?`${doneDate(b.finished_at)} 브리핑`:''].filter(Boolean).join(' · '));
  const head=[bar,meta];
  const part=partialLine(b.brief);if(part)head.push(el('p','br-meta br-partial',part));
  const v=briefView(shownBrief(b));
  // 손으로 고친 브리핑: 작은 줄 하나 '손으로 수정함 · [원래 AI 글로 되돌리기]'(줄마다 표시는 두지 않는다 — 고친 줄 비교는 줄을 빼면 어긋나 틀린 표시가 됨).
  if(isEdited(b)&&!state.editing){const p=el('p','br-meta br-edited',`${EDITED_TAG} · `);p.append(btn('br-revert row-act',REVERT_LABEL,{brRevert:doc.id}));head.push(p)}
  // 본문 = 글 선택·밑줄 칸(data-br-zone)이자 글자 크기 대상. 머리·단추는 밖에 둔다.
  const parts=[];
  if(v.gist.length){
    const g=el('section','br-gist');g.setAttribute('aria-label',GIST_TITLE);
    v.gist.forEach((line,i)=>{const p=el('p',null,line);p.dataset.brLine=`g:${i}`;p.tabIndex=-1;g.append(p)});
    parts.push(g);
  }
  v.sections.forEach((sec,i)=>{
    const list=el('ul','br-items');sec.items.forEach((it,j)=>list.append(itemNode(it,doc,`i:${i}:${j}`)));
    // 제목 없는 묶음은 접지 않고 그대로. 제목 있는 묶음은 앞 SHOW_N개만 펼친다.
    if(!sec.title){const s=el('section','br-sec br-sec-plain');s.append(list);parts.push(s);return}
    const s=el('details','br-sec');s.dataset.brKey='sec-'+i;s.dataset.brSec='';
    const sum=el('summary'),h=el('h3',null,sec.title);h.dataset.brLine=`t:${i}`;h.append(el('small',null,` ${sec.items.length}`));sum.append(h);
    s.append(sum,list);if(i<SHOW_N)s.open=true;
    parts.push(s);
  });
  if(v.quotes.length){
    const s=el('details','br-sec br-sec-quotes');s.dataset.brKey='quotes';s.dataset.brSec='quotes';
    const sum=el('summary'),h=el('h3',null,QUOTES_TITLE);h.append(el('small',null,` ${v.quotes.length}`));sum.append(h);
    const ul=el('ul','br-items');for(const it of v.quotes)ul.append(quoteNode(it,doc));
    s.append(sum,ul);parts.push(s);
  }
  // 만드는 중 4초마다 다시 그려도, 같은 자료면 사람이 펼치거나 접은 상태는 그대로 둔다.
  if(box.dataset.brDoc===doc.id){
    const was=new Map([...box.querySelectorAll('details[data-br-key]')].map(d=>[d.dataset.brKey,d.open]));
    for(const p of parts)if(p.matches?.('details[data-br-key]')&&was.has(p.dataset.brKey))p.open=was.get(p.dataset.brKey);
  }
  box.dataset.brDoc=doc.id;
  if(state.editing){box.replaceChildren(...head,editForm(doc,b));box.hidden=false;paintTextSize(box);focusEdit(box);return}
  // 줄 옮겨 다니기(↑↓)는 첫 줄부터: 첫 줄만 Tab으로 닿고, 나머지는 ↑↓로(줄마다 Tab 칸을 두지 않는다).
  const first=parts.map(p=>p.querySelector?.('[data-br-line][tabindex]')).find(Boolean);if(first)first.tabIndex=0;
  const body=el('div','br-body');body.dataset.brZone=doc.id;body.dataset.textSizeTarget='';body.append(...parts);
  box.replaceChildren(...head,body);box.hidden=false;
  paintTextSize(box);
  paintMarks(body,sourceMarks('brief',doc.id)); // S70-16: 밑줄 + 형광펜(글 안 표시)
}

// ---------- S70-27 손으로 고치기 ----------
// 고치는 칸: 보이는 한 장(고친 것이 있으면 그것)의 요지 줄·소제목·줄을 같은 순서로. 칸은 글 길이만큼 늘어나는 여러 줄 칸(줄바꿈은 넣지 않음).
// 원문 인용은 '원문 그대로'라 고치지 않는다(칸 없음). 위 줄 '고치는 중 · [취소][저장]', Enter = 저장, Esc = 취소.
function editForm(doc,b){
  const ed=state.editing,form=el('div','br-body br-edit');form.dataset.brForm=doc.id;form.dataset.textSizeTarget='';
  const top=el('div','br-edit-bar');top.append(el('span','br-muted','수정 중 · 비운 줄은 빠져요'),btn('br-edit-cancel secondary','취소',{brEditCancel:'1'}),btn('br-edit-save secondary','저장',{brEditSave:'1'}));
  form.append(top);
  let group=null,last='';
  for(const f of editFields(shownBrief(b))){
    const head=f.kind==='gist'?'gist':`s${f.section}`;
    if(head!==last){group=el('section','br-edit-group');if(f.kind==='gist')group.append(el('p','br-edit-head','요지'));form.append(group);last=head}
    const t=el('textarea','br-edit-in'+(f.kind==='title'?' br-edit-title':''));
    t.rows=1;t.dataset.autogrow='';t.dataset.brField=f.key;t.maxLength=2000;
    t.value=ed.values.has(f.key)?ed.values.get(f.key):f.text;
    t.placeholder=f.kind==='title'?'소제목(비우면 제목 없이)':'비우면 이 줄을 빼요';
    t.setAttribute('aria-label',f.kind==='gist'?'요지 줄':f.kind==='title'?'소제목':'줄');
    group.append(t);
  }
  return form;
}
function focusEdit(box){
  const all=[...box.querySelectorAll('textarea[data-br-field]')];fitAll(box); // UI-입력칸자동높이: 공용 auto-grow.js
  const t=all.find(x=>x.dataset.brField===state.editing?.focus)||all[0];
  if(t){t.focus({preventScroll:false});t.setSelectionRange(t.value.length,t.value.length)}
}
function startEdit(docId,focus=''){
  const b=state.briefs.get(docId);if(!state.editable||b?.status!=='done'||!b.brief)return;
  state.open=docId;state.editing={doc:docId,focus,values:new Map()};drawDetail();
}
function stopEdit(){state.editing=null;drawDetail();view()?.querySelector('[data-br-edit]')?.focus?.()}
async function saveEdit(button){
  const ed=state.editing,b=ed?state.briefs.get(ed.doc):null;if(!ed||!b||state.busy)return;
  for(const t of view()?.querySelectorAll('textarea[data-br-field]')||[])ed.values.set(t.dataset.brField,t.value);
  const edited=applyEdits(shownBrief(b),ed.values);
  if(!edited){stopEdit();return}
  if(!edited.gist.length&&!edited.sections.length){toast('모든 줄을 비울 수는 없어요',true);return}
  if(!fitsServer(edited)){toast('글이 너무 길어요 · 조금 줄여 주세요',true);return}
  state.busy=true;if(button)button.disabled=true;
  try{
    const at=await api('/rest/v1/rpc/app_document_brief_edit',{method:'POST',body:{p_brief_id:b.id,p_edited:edited}});
    b.edited=edited;b.edited_at=typeof at==='string'?at:new Date().toISOString();
    state.editing=null;toast('수정한 글을 저장했어요');draw();
  }catch{toast('저장하지 못했어요 · 잠시 뒤 다시',true)}
  finally{state.busy=false;if(button?.isConnected)button.disabled=false}
}
async function revertEdit(docId,anchor){
  const b=state.briefs.get(docId);if(!isEdited(b)||state.busy)return;
  if(!(await askConfirm(anchor,REVERT_ASK)))return;
  state.busy=true;
  try{await api('/rest/v1/rpc/app_document_brief_edit',{method:'POST',body:{p_brief_id:b.id,p_edited:null}});b.edited=null;b.edited_at=null;toast('AI가 만든 글로 되돌렸어요');draw()}
  catch{toast('되돌리지 못했어요 · 잠시 뒤 다시',true)}
  finally{state.busy=false}
}

// PC 요약 글 우클릭·Shift+F10·메뉴 키: 공용 줄 메뉴. 글을 골라 두었으면 고른 글에, 아니면 누른 줄 글에 막대와 같은 일을 한다.
const EDITABLE='input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';
function selectedIn(zone){
  const sel=window.getSelection?.();
  return !!(sel&&!sel.isCollapsed&&sel.toString().trim()&&zone.contains(sel.anchorNode)&&zone.contains(sel.focusNode));
}
function selectLine(line){
  const r=document.createRange();
  const h=line.matches('h3')?line.firstChild:line.querySelector('.br-tx,.br-qt')||line;
  if(!h)return false;
  if(h.nodeType===3)r.selectNodeContents(h);else r.selectNodeContents(h);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);
  return !sel.isCollapsed;
}
function onContextMenu(e){
  const zone=e.target?.closest?.('[data-br-zone]');if(!zone||e.target.closest(EDITABLE))return;
  const line=e.target.closest('[data-br-line]');
  let at;
  if(selectedIn(zone)){
    // 고른 글 위: appMenuPoint는 글을 고르면 기본 메뉴로 두므로 같은 규칙(폰 폭·손가락·Shift 등)을 여기서 본다.
    if(e.defaultPrevented||e.pointerType==='touch'||!wide()||(e.button===2&&(e.shiftKey||e.ctrlKey||e.altKey||e.metaKey)))return;
    const r=(line||zone).getBoundingClientRect();
    at=e.button!==2||(!e.clientX&&!e.clientY)?{x:Math.round(r.left+Math.min(r.width/2,24)),y:Math.round(r.top+Math.min(r.height,28))}:{x:e.clientX,y:e.clientY};
  }else{
    if(!line)return;
    at=appMenuPoint(e,line);if(!at)return;
  }
  const picked=selectedIn(zone),range=picked?window.getSelection().getRangeAt(0).cloneRange():null;
  const items=lineMenuItems(selectBarActs(zone),state.editable&&!!line);
  if(!items.length)return;
  e.preventDefault();
  const docId=zone.dataset.brZone;
  openRowMenu(line||zone,{key:`br-line:${line?.dataset.brLine||'sel'}`,label:picked?'선택한 글':'브리핑 줄',items,at,row:line||null,
    run:id=>{
      if(id==='edit'){startEdit(docId,line?.dataset.brLine||'');return}
      // 메뉴를 누르는 사이 고른 글이 풀려도, 메뉴를 연 때 고른 글로 한다.
      if(range&&range.startContainer.isConnected){const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range)}
      else if(!(line&&selectLine(line)))return;
      void runSelectBarAct(id,null);
    }});
}
function onLineKey(e){
  const line=e.target?.closest?.('[data-br-line][tabindex]');if(!line||e.target!==line)return;
  if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
  const zone=line.closest('[data-br-zone]');if(!zone)return;
  const all=[...zone.querySelectorAll('[data-br-line][tabindex]')].filter(x=>x.getClientRects().length);
  const next=all[all.indexOf(line)+(e.key==='ArrowDown'?1:-1)];if(!next)return;
  e.preventDefault();line.tabIndex=-1;next.tabIndex=0;next.focus();
}

function draw(){drawList();drawDetail();mountSplit();schedule();autoOpen()}
// ---------- S70-84 두 칸(왼쪽 목록 | 오른쪽 브리핑) ----------
// 경계는 공용 split-resize.js(기본 2 : 3 — 목록에 이름·날짜 칸이 들어가게, 칸 최소 240·320px — 펼친 폴드 약 690px에서도 기본 비율), 끌면 서버 view_prefs.split_ratio.brief에 기억. 두 번 누르면 기본.
// 오른쪽 칸은 follow-pane.js가 화면 위에 붙인다(그 칸만 스크롤). 두 칸에서 연 보기가 없으면 목록 순서로 맨 위 다 된 브리핑을 오른쪽에 연다.
let followed='';
function mountSplit(){
  const wrap=view()?.querySelector('.br-wrap');if(!wrap)return;
  mountSplitResize({container:wrap,name:'brief',label:'목록과 브리핑 칸 폭 조절',query:SPLIT_QUERY,columns:[
    {el:()=>wrap.querySelector('[data-br-list]'),varName:'--ds-split-list',minVar:'--ds-split-list-min',minFallback:240,share:2},
    {el:()=>wrap.querySelector('[data-br-detail]'),varName:'--ds-split-detail',minVar:'--ds-split-detail-min',minFallback:320,share:3},
  ],active:()=>split()&&!!view()?.classList.contains('br-split')&&!view()?.classList.contains('hidden')});
  const box=wrap.querySelector('[data-br-detail]');
  if(split()&&box&&!box.hidden){followPane(box,{narrow:!wide(),reset:followed!==state.open});followed=state.open||''}
}
// 한 칸 폭(폰·접은 폴드)에서 보기를 열면 뒤로가기 한 겹(공용 라우터 layer) — 뒤로 = 목록(표준 P2). 두 칸에서는 겹 없이 오른쪽만 바뀐다.
let layer=null;
function openDoc(id){
  state.open=id;
  if(!split()&&!layer)layer=window.KPTURouter?.layer?.open?.('brief-detail',{reopen:()=>{state.open=id;draw()},close:()=>{layer=null;closeDetail({fromBack:true});return true}})||null;
  draw();
}
function closeDetail({fromBack=false}={}){
  state.open=null;state.editing=null;
  if(!fromBack&&layer){const l=layer;layer=null;void l.close?.()}
  layer=null;draw();
}
function autoOpen(){
  if(!split()||!here()||!state.loaded||state.open||state.editing)return;
  const first=treeRows({sub:state.sub,rows:roomRows(),itemFolder:state.itemFolder,open:state.xopen,sort:sortNow()}).find(t=>t.type==='file'&&t.row.state.kind==='done');
  if(first){state.open=first.row.doc.id;drawList();drawDetail();mountSplit()}
}

// ---------- S70-84 브리핑 폴더(자료실 '브리핑 요청함' 아래 폴더) ----------
// 쓰기는 자료실과 같은 길(owner RLS REST): 만들기 = createLibraryFolder, 이름 = PATCH name, 옮기기 = PATCH parent_id, 지우기 = 공용 휴지통(trash-actions.js, 종류 library_folder —
// 서버 트리거가 그 폴더와 아래 폴더를 휴지통으로, 자료는 그대로). 자료 옮기기 = 자료 연결 줄 하나(putDocumentInFolder). 기기 저장 없음.
const FOLDERS='/rest/v1/app_library_folders';
const folderName=id=>id===NONE||!id?NONE_LABEL:state.sub.find(f=>f.id===id)?.name||'';
const sheetFolders=()=>state.sub.map(f=>({id:f.id,parent_id:f.parent_id||null,name:f.name}));
const nextOrder=parent=>state.allFolders.filter(f=>(f.parent_id||null)===(parent||null)).reduce((m,f)=>Math.max(m,Number(f.sort_order)||0),0)+1;
async function afterFolderChange(text,error=false){
  if(text)toast(text,error);
  window.dispatchEvent(new CustomEvent('kptu:library-folders-changed'));
  await load();draw();
}
const folderError=e=>Number(e?.status)===409||/23505|duplicate/i.test(`${e?.code||''} ${e?.message||''}`)?'같은 이름의 폴더가 이미 있어요':'폴더를 바꾸지 못했어요 · 잠시 뒤 다시';
async function askFolderName(anchor,value=''){
  const typed=await askText(anchor,{text:`${value?'폴더 이름':'새 폴더 이름'} (40자까지)`,value,ok:value?'바꾸기':'만들기',max:40});
  if(typed===null)return null;
  const name=cleanFolderName(typed);if(!name)toast('폴더 이름은 1~40자로 써 주세요',true);
  return name||null;
}
// 새 폴더: parent = 브리핑 폴더 id(없으면 맨 위 = '브리핑 요청함' 바로 안). 만든 폴더 줄(id) 또는 null.
async function makeFolder(parent,name){
  const root=await ensureFolder();if(!root)throw new Error('folder');
  const made=await createLibraryFolder(api,{workspace:ws(),project_id:null,parent_id:parent||root,name,sort_order:nextOrder(parent||root)});
  if(parent)state.xopen.add(parent);
  return made;
}
async function newFolder(parent,anchor){
  if(state.busy)return;
  const name=await askFolderName(anchor);if(!name)return;
  state.busy=true;
  try{await makeFolder(parent,name);state.busy=false;await afterFolderChange('폴더를 만들었어요')}
  catch(e){state.busy=false;toast(folderError(e),true)}
}
async function renameFolder(id,anchor){
  const f=state.sub.find(x=>x.id===id);if(!f||state.busy)return;
  const name=await askFolderName(anchor,f.name);if(!name||name===f.name)return;
  state.busy=true;
  try{await api(`${FOLDERS}?workspace_id=eq.${enc(ws())}&id=eq.${enc(id)}`,{method:'PATCH',prefer:'return=minimal',body:{name}});state.busy=false;await afterFolderChange('이름을 바꿨어요')}
  catch(e){state.busy=false;toast(folderError(e),true)}
}
async function moveFolder(id,to){
  if(!canMoveFolder(state.sub,id,to)||state.busy)return false;
  const f=state.sub.find(x=>x.id===id);if(!f||(f.parent_id||null)===(to||null))return false;
  state.busy=true;
  try{const root=state.folderId;await api(`${FOLDERS}?workspace_id=eq.${enc(ws())}&id=eq.${enc(id)}`,{method:'PATCH',prefer:'return=minimal',body:{parent_id:to||root,sort_order:nextOrder(to||root)}});state.busy=false;await afterFolderChange('폴더를 옮겼어요');return true}
  catch(e){state.busy=false;toast(folderError(e),true);return false}
}
async function trashFolder(id,anchor){
  const f=state.sub.find(x=>x.id===id);if(!f||state.busy)return;
  const {deleteToTrash}=await import('./trash-actions.js');
  const r=await deleteToTrash({kind:'library_folder',id,name:f.name,remove:()=>api(`${FOLDERS}?workspace_id=eq.${enc(ws())}&id=eq.${enc(id)}`,{method:'DELETE',prefer:'return=minimal'}),
    afterChange:async()=>{state.xopen.delete(id);await afterFolderChange('')},notify:text=>toast(text,true),...(anchor?.isConnected?{anchor}:{})});
  if(r?.status==='failed')toast('폴더를 삭제하지 못했어요 · 잠시 뒤 다시',true);
}
// 자료를 브리핑 폴더로(to = 폴더 id, NONE·null = '브리핑 요청함' 바로 안 = 폴더 없음). 자료실의 다른 폴더에 든 자료면 먼저 묻는다(자료실에서도 옮겨짐).
async function moveDocs(ids,to,anchor=null){
  ids=[...new Set(ids)].filter(id=>state.docs.some(d=>d.id===id));
  if(!ids.length||state.busy)return false;
  const target=to&&to!==NONE?to:null,subIds=new Set(state.sub.map(f=>f.id));
  const now=ids.filter(id=>folderOfDoc(id,state.itemFolder,subIds)!==target||!state.itemFolder.has(id));if(!now.length)return false;
  // 브리핑 폴더 밖 자료(자료실 ⋯에서 받았거나 [자료실에서 선택]으로 고른 것) 중 자료실의 다른 폴더에 든 것만 센다.
  const outside=now.filter(id=>!state.itemFolder.has(id));let elsewhere=0;
  try{if(outside.length){const got=await api(`/rest/v1/app_library_folder_items?workspace_id=eq.${enc(ws())}&document_id=in.(${outside.slice(0,100).map(enc).join(',')})&select=document_id`);elsewhere=Array.isArray(got)?got.length:0}}catch{}
  if(elsewhere&&!(await askConfirm(anchor,{text:`자료실의 다른 폴더에 든 자료 ${elsewhere}개도 '${folderName(target)}'(으)로 옮길까요? 자료실에서도 이 폴더로 옮겨져요.`,ok:'옮기기'})))return false;
  state.busy=true;let done=0;
  try{
    const root=await ensureFolder();
    for(const id of now)if(await putDocumentInFolder(api,{workspace:ws(),documentId:id,folderId:target||root}))done++;
  }catch{}
  finally{state.busy=false}
  if(target)state.xopen.add(target);
  await afterFolderChange(done===now.length?`'${folderName(target)}'(으)로 옮겼어요`:'옮기지 못한 자료가 있어요 · 잠시 뒤 다시',done!==now.length);
  return done>0;
}
// [폴더로 옮기기…]: 공용 '옮길 곳' 창(표준 F1) — 맨 위 = 폴더 없음, [새 폴더]는 고른 폴더 안에. 폴더 옮기기도 같은 창(자기·자기 아래는 고를 수 없음).
function openMoveSheet(anchor,{docs=[],folder=null}={}){
  const subIds=new Set(state.sub.map(f=>f.id));
  const cur=folder?(state.sub.find(f=>f.id===folder)?.parent_id||null):docs.length===1?folderOfDoc(docs[0],state.itemFolder,subIds):undefined;
  openFolderSheet({anchor,title:folder?'폴더 옮길 곳':'옮길 폴더',rootName:NONE_LABEL,folders:sheetFolders,current:cur,start:cur??null,goLabel:'여기에 옮기기',
    blocked:id=>folder&&!canMoveFolder(state.sub,folder,id)?'자기 안으로는 옮길 수 없어요':'',
    mkdir:async(parent,typed)=>{const name=cleanFolderName(typed);if(!name)throw new Error('폴더 이름은 1~40자로 써 주세요');const made=await makeFolder(parent,name);await load();return made||null},
    onGo:fid=>{if(folder)void moveFolder(folder,fid||null);else void moveDocs(docs,fid||NONE,anchor)}});
}
const folderMenu=createAnchoredMenu({id:'brFolderMenu',className:'feed-menu',label:'브리핑 폴더 메뉴',historyKey:'kptuBriefFolderMenu',
  key:t=>t.dataset.brFmore||'',row:t=>t.closest('.ft-row'),
  render:id=>id===NONE?'<button type="button" class="row-act" data-brf-act="new">새 폴더</button>'
    :state.sub.some(f=>f.id===id)?'<button type="button" class="row-act" data-brf-act="new">이 안에 새 폴더</button><button type="button" class="row-act" data-brf-act="rename">이름 바꾸기</button><button type="button" class="row-act" data-brf-act="move">옮기기…</button><button type="button" class="row-act feed-menu-danger" data-brf-act="trash">삭제</button>':'',
  onAction:(button,active)=>{
    const id=active.id,act=button.dataset.brfAct,at=view()?.querySelector(`[data-br-fmore="${CSS.escape(id)}"]`)||null;
    if(act==='new')void newFolder(id===NONE?null:id,at);
    else if(act==='rename')void renameFolder(id,at);
    else if(act==='move')openMoveSheet(at,{folder:id});
    else if(act==='trash')void trashFolder(id,at);
  }});
// 끌어 옮기기(마우스·펜): 자료 줄·폴더 줄을 폴더 줄('폴더 없음' 포함)·펼친 폴더 안 '빈 폴더' 줄에 놓는다. 고르기 중이면 고른 자료 모두.
// 손가락(폰·폴드)은 ⋯ [폴더로 옮기기…]·폴더 ⋯ [옮기기…]로 같은 일을 한다.
const DRAG_TYPE='application/x-kptu-brief';
function bindDrag(v){
  v.addEventListener('dragstart',e=>{
    const doc=e.target.closest?.('[data-br-drag]'),fold=e.target.closest?.('.ft-row[data-br-folder][draggable="true"]');
    if(!doc&&!fold)return;
    state.dragging=doc?{docs:pick.active&&pick.has(doc.dataset.brDrag)?[...pick.items]:[doc.dataset.brDrag]}:{folder:fold.dataset.brFolder};
    try{e.dataTransfer.setData(DRAG_TYPE,'1');e.dataTransfer.effectAllowed='move'}catch{}
    (doc||fold).classList.add('nx-dragging');
  });
  v.addEventListener('dragend',()=>{state.dragging=null;for(const n of v.querySelectorAll('.nx-dragging,.nx-drop'))n.classList.remove('nx-dragging','nx-drop')});
  const target=e=>{const t=e.target.closest?.('[data-br-drop]');return t&&t.dataset.brDrop!=='1'?t:null};
  v.addEventListener('dragover',e=>{
    if(!state.dragging)return;const t=target(e);
    for(const n of v.querySelectorAll('.nx-drop'))if(n!==t)n.classList.remove('nx-drop');
    if(!t)return;const to=t.dataset.brDrop;
    if(state.dragging.folder&&!canMoveFolder(state.sub,state.dragging.folder,to===NONE?null:to))return;
    e.preventDefault();e.stopPropagation();try{e.dataTransfer.dropEffect='move'}catch{}t.classList.add('nx-drop');
  });
  v.addEventListener('drop',e=>{
    const d=state.dragging;if(!d)return;const t=target(e);state.dragging=null;
    for(const n of v.querySelectorAll('.nx-drop,.nx-dragging'))n.classList.remove('nx-drop','nx-dragging');
    if(!t)return;e.preventDefault();e.stopPropagation();const to=t.dataset.brDrop;
    if(d.folder)void moveFolder(d.folder,to===NONE?null:to);else void moveDocs(d.docs,to,t);
  },true);
}
// [노트로 보관]: 브리핑 한 장 + 이 자료에서 저장한 밑줄을 새 노트 한 장(노트 기본 폴더)으로. 글을 복사해 넣으므로 브리핑을 지워도 노트는 남는다.
async function archive(id,button){
  const doc=state.docs.find(d=>d.id===id),row=state.briefs.get(id);
  const n=archiveNote({doc,row,marks:sourceHighlights('brief',id)});
  if(!n){toast('보관할 브리핑이 없어요',true);return}
  if(button)button.disabled=true;
  try{await createNoteDoc({...n,markdown:true},rt());toast('노트로 보관했어요')}
  catch(e){toast(e?.message&&!e?.status?e.message:'노트로 보관하지 못했어요 · 잠시 뒤 다시',true)}
  finally{if(button?.isConnected)button.disabled=false}
}
// 다 됐다·못 했다 알림은 공용 작은 알림(위쪽, 브리핑 룸 화면에 있을 때만 — 폰 알림 없음).
function toast(text,error=false){notify(text,{error,record:false})}

const making=()=>[...state.briefs.values()].some(b=>b.status==='queued'||b.status==='running');
function schedule(){
  clearTimeout(state.timer);
  if(!making()||!here())return;
  state.timer=setTimeout(poll,BRIEF_POLL_MS);
}
async function poll(){
  if(!here())return;
  const before=new Map([...state.briefs].map(([k,v])=>[k,v.status]));
  await load();
  for(const [doc,b] of state.briefs){
    if(before.get(doc)&&before.get(doc)!=='done'&&b.status==='done'){const d=state.docs.find(x=>x.id===doc);toast(`브리핑이 다 됐어요 — ${d?.title||d?.file_name||''}`)}
    // 서버가 멈춘 작업(시간 다 씀·잇기 실패)은 화면이 한 번씩 이어 달라고 한다.
    if(isStalled(b,Date.now())&&!state.asked.has(b.id+b.updated_at)){state.asked.add(b.id+b.updated_at);void rt().api(ACTIONS,{method:'POST',body:{action:'brief-step',brief_id:b.id},refreshSession:false,singleFlight:false}).catch(()=>{})}
  }
  draw();
}

async function start(id,button){
  // S70-27: 손으로 고친 브리핑을 다시 만들면 먼저 묻는다(취소가 기본 — 고친 글을 그대로 둔다).
  if(isEdited(state.briefs.get(id))&&!(await askConfirm(button?.isConnected?button:null,REDO_ASK)))return;
  if(button)button.disabled=true;
  try{
    const data=await rt().api(ACTIONS,{method:'POST',body:{action:'brief-start',document_id:id},refreshSession:false,singleFlight:false,timeoutMs:30000});
    if(data?.brief?.id)state.briefs.set(id,data.brief);
    // 폴더 밖 자료(자료실 ⋯에서 받은 것)도 목록에 보이게 다시 읽는다.
    if(!state.docs.some(d=>d.id===id))await load();
  }catch(e){toast(startError(e?.status===429?'ai_monthly_cap':e?.status===404?'not_found':''),true)}
  draw();
}

async function add(files=null){
  try{
    const id=await ensureFolder();
    await window.KPTUViewLoader?.load?.('library');
    const ok=await window.KPTULibrary?.startUploadInFolder?.(id,files);
    if(!ok)toast('자료 등록 창을 열지 못했어요',true);
  }catch{toast('자료 넣기를 열지 못했어요',true)}
}

function bind(){
  const v=view();if(!v||v.dataset.brBound)return;v.dataset.brBound='1';
  v.addEventListener('click',e=>{
    const t=e.target;
    const fm=t.closest?.('[data-br-fmore]');if(fm){e.stopPropagation();folderMenu.open(fm);return}
    const fold=t.closest?.('[data-br-fold]');if(fold){state.xopen=toggleOpen(state.xopen,fold.dataset.brFold);drawList();return}
    if(t.closest?.('[data-br-pick-all]')){const ids=roomRows().map(r=>r.doc.id);pick.toggle(ids,{anchor:false});drawList();return}
    if(t.closest?.('[data-br-pick-stop]')){pick.stop();drawList();return}
    const kill=t.closest?.('[data-br-del-many]');if(kill){void removeMany([...(pick.items||[])],kill.dataset.brDelMany,kill);return}
    if(pick.active){const pr=t.closest?.('[data-br-open]');if(pr){if(!t.matches?.('[data-br-pick]'))e.preventDefault();pick.toggle([pr.dataset.brOpen]);drawList();return}}
    const keep=t.closest?.('[data-br-archive]');if(keep){e.stopPropagation();void archive(keep.dataset.brArchive,keep);return}
    const ed=t.closest?.('[data-br-edit]');if(ed){e.stopPropagation();startEdit(ed.dataset.brEdit);return}
    if(t.closest?.('[data-br-edit-cancel]')){stopEdit();return}
    const sv=t.closest?.('[data-br-edit-save]');if(sv){void saveEdit(sv);return}
    const rv=t.closest?.('[data-br-revert]');if(rv){e.stopPropagation();void revertEdit(rv.dataset.brRevert,rv);return}
    const rt2=t.closest?.('[data-br-retry]');if(rt2){e.stopPropagation();void start(rt2.dataset.brRetry,rt2);return}
    const s=t.closest?.('[data-br-start]');if(s){e.stopPropagation();void start(s.dataset.brStart,s);return}
    if(t.closest?.('[data-fu-action="brief"]')){void add();return}
    if(t.closest?.('[data-br-retry]')){void refresh();return}
    if(t.closest?.('[data-br-back]')){closeDetail();return}
    const row=t.closest?.('[data-br-open]');if(row&&state.briefs.get(row.dataset.brOpen)?.status==='done'){openDoc(row.dataset.brOpen);v.querySelector('[data-br-detail]')?.scrollIntoView?.({block:'start'})}
  });
  v.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-br-open][role=button]')){e.preventDefault();e.target.click()}});
  v.addEventListener('keydown',e=>{if(e.key==='Escape'&&pick.active&&!state.busy){e.preventDefault();pick.stop();drawList()}});
  // 고치는 칸: Enter = 저장(줄바꿈 없음), Esc = 취소. 칸은 글 길이만큼 늘어난다. 쓰던 글은 이 탭 메모리에 둔다(다시 그려도 그대로).
  v.addEventListener('keydown',e=>{
    const t=e.target;if(!t?.matches?.('textarea[data-br-field]')||e.isComposing)return;
    if(e.key==='Enter'){e.preventDefault();void saveEdit(v.querySelector('[data-br-edit-save]'));return}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();stopEdit()}
  });
  v.addEventListener('input',e=>{const t=e.target;if(t?.matches?.('textarea[data-br-field]')&&state.editing){state.editing.values.set(t.dataset.brField,t.value)}});
  v.addEventListener('contextmenu',onContextMenu);
  v.addEventListener('change',e=>{const sel=e.target.closest?.('[data-br-sort]');if(!sel)return;const next=parseSortValue(sel.value,BRIEF_SORT_KEYS);if(!next)return;state.sort=next;viewPrefs.setBriefSort?.(next);drawList()});
  bindDrag(v);
  v.addEventListener('keydown',onLineKey);
  v.addEventListener('contextmenu',onRowContextMenu);
  // 밑줄: 칠한 밑줄을 누르면 공용 밑줄 메뉴, 본문에서 글을 선택하면 공용 선택 줄. 출처는 지금 연 자료(이름·브리핑 날짜만, 주소 없음).
  bindMarks(v);
  bindSelectZone(v,{zone:'[data-br-zone]',source:zone=>{const id=zone?.dataset?.brZone;return briefSource(state.docs.find(d=>d.id===id),state.briefs.get(id))},onSave:saveFromSelection,onNote:noteFromSelection,onReply:replyFromSelection,marks:markActions});
  onHighlights(()=>{if(window.KPTURouter?.current==='brief')drawDetail()});
  // 파일 놓기: 화면 아무 곳에나 놓으면 자료 등록 창(브리핑 요청함 폴더)에 담는다.
  v.addEventListener('dragover',e=>{if([...(e.dataTransfer?.types||[])].includes('Files')){e.preventDefault();v.classList.add('br-dropping')}});
  v.addEventListener('dragleave',e=>{if(e.target===v)v.classList.remove('br-dropping')});
  v.addEventListener('drop',e=>{if(state.dragging)return;const files=[...(e.dataTransfer?.files||[])];v.classList.remove('br-dropping');if(!files.length)return;e.preventDefault();void add(files)});
  window.addEventListener('kptu:documents-changed',()=>{if(window.KPTURouter?.current==='brief')void refresh()});
  window.addEventListener('resize',()=>{if(window.KPTURouter?.current==='brief')drawDetail()});
  // 폴드를 펼치거나 접으면(칸 나누기 폭을 넘나들면) 두 칸 ↔ 한 칸으로 다시 그린다(펼침 = 열린 브리핑이 없으면 맨 위 다 된 것).
  SPLIT?.addEventListener?.('change',()=>{if(window.KPTURouter?.current!=='brief')return;if(!split()&&state.open&&!layer)openDoc(state.open);else draw()});
  document.addEventListener('visibilitychange',()=>{if(here())void poll()});
}

// 선택 모드 위쪽 줄: [전체] n개 선택됨 [브리핑만 삭제] [자료까지 삭제] [취소].
function pickBar(rows){
  const ids=rows.map(r=>r.doc.id),n=pick.size,all=ids.length>0&&ids.every(id=>pick.has(id));
  const allBtn=btn('br-all ds-chip','모두 선택',{brPickAll:'1'});allBtn.setAttribute('aria-pressed',String(all));
  const count=el('span','br-count',`${n}개 선택됨`);count.setAttribute('aria-live','polite');
  const one=btn('br-del danger',DELETE_KINDS.brief,{brDelMany:'brief'}),two=btn('br-del danger',DELETE_KINDS.doc,{brDelMany:'doc'});
  one.disabled=two.disabled=!n||state.busy;
  return [allBtn,count,one,two,btn('br-cancel secondary','취소',{brPickStop:'1'})];
}

const api=(path,options)=>rt().api(path,{refreshSession:false,singleFlight:false,...options});
// 브리핑만: 브리핑 행 삭제(서버 함수, owner 검사) → '브리핑 요청함' 폴더에 있었으면 폴더 밖으로. 자료 행·Drive 파일은 그대로.
async function removeBriefOnly(id){
  await api('/rest/v1/rpc/app_document_brief_delete',{method:'POST',body:{p_document_id:id}});
  if(state.folderId&&state.folderDocs.has(id))await api(`/rest/v1/app_library_folder_items?workspace_id=eq.${enc(ws())}&folder_id=eq.${enc(state.folderId)}&document_id=eq.${enc(id)}`,{method:'DELETE',prefer:'return=minimal'});
}
// 자료까지: 자료실 삭제와 같은 서버 길(확인은 위에서 한 번). 자료 행이 지워지면 브리핑 행도 같이 지워진다(표 on delete cascade).
let deleteHelper=null;
async function removeWithDocument(id){
  const d=state.docs.find(x=>x.id===id);if(!d||isLibraryDoc(id))return {ok:false};
  deleteHelper??=await import('./document-delete.js');
  const bulk={};
  await deleteHelper.deleteDocument(Object.freeze({...d}),{api:(p,o)=>rt().api(p,o),bulk});
  return bulk.ok?{ok:true}:{ok:false,stop:!!bulk.stop};
}
async function removeMany(ids,kind,anchor=null){
  ids=ids.filter(id=>state.docs.some(d=>d.id===id));
  if(!ids.length||state.busy||(kind!=='auto'&&!DELETE_KINDS[kind]))return;
  const first=state.docs.find(d=>d.id===ids[0]);
  const keep=kind==='auto'?ids.filter(isLibraryDoc).length:0;
  if(!(await askConfirm(anchor,deleteConfirm(kind,ids.length,docName(first),{keep}))))return;
  state.busy=true;drawList();
  let result;
  try{
    result=await deleteSequentially(ids,async id=>{
      if(kind==='doc'||(kind==='auto'&&!isLibraryDoc(id)))return removeWithDocument(id);
      try{await removeBriefOnly(id);return {ok:true}}catch(e){return {ok:false,stop:e?.status===401||e?.status===403}}
    },{isCurrent:()=>!!ws()});
  }finally{state.busy=false}
  for(const id of result.done){if(state.open===id)state.open=null;pick.remove(id);state.picked.delete(id)}
  if(pick.active&&!result.failed.length&&!result.skipped.length)pick.stop();
  const r=deleteResult(kind==='auto'?'brief':kind,{done:result.done.length,failed:result.failed.length,skipped:result.skipped.length});
  toast(r.text,r.error);
  if(result.done.length)window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:null,meeting_id:null}}));
  await load();draw();
}

// BRIEF-밀기메뉴(명진 11/26 폰 캡처): 줄 ⋯ 단추와 그 메뉴는 없앤다. 폰 = 왼쪽 밀기 [수정][삭제], PC = 줄 우클릭·Shift+F10 공용 줄 메뉴(row-menu.js) 같은 두 가지.
// 여러 개 고르기·옮기기는 오른쪽 밀기(폰)·끌어 옮기기(PC)로 그대로다.
function canEditRow(id){const b=state.briefs.get(id);return !!(state.editable&&b?.status==='done'&&b.brief)}
function editRow(id){if(!canEditRow(id))return;openDoc(id);startEdit(id)}
function onRowContextMenu(e){
  const row=e.target?.closest?.('.br-row[data-br-open]');if(!row||e.target.closest('[data-br-zone]'))return;
  const id=row.dataset.brOpen;if(!state.docs.some(d=>d.id===id)||state.busy||pick.active)return;
  const at=appMenuPoint(e,row);if(!at)return;
  e.preventDefault();
  const items=[...(canEditRow(id)?[{id:'edit',label:'수정'}]:[]),{id:'delete',label:'삭제',last:true}];
  openRowMenu(row,{key:`br-row:${id}`,label:'브리핑 줄',items,at,row,
    run:act=>{if(act==='edit')editRow(id);else if(act==='delete')void removeMany([id],'auto',row)}});
}
// [자료실에서 고르기]: 내 자료실 자료(최근 순, 이름 찾기)를 여러 개 고른다. 목록은 열 때마다 서버에서 owner RLS로 읽는다(기기 저장 없음).
// S67-41: 찾기 칸 아래 [최근]·[폴더] 두 보기. [폴더]는 처음 누를 때 자료실 폴더·폴더에 든 자료 줄을 읽고(같은 owner RLS 읽기),
// 자료실 나무와 같은 순서(folderSiblings)로 폴더에 들어가며 고른다. 줄마다 형식 꼬리표·이름 한 줄·올린 날짜. 폰은 아래에서 올라오는 판, PC·폴드는 단추 아래 창.
const LIB_PICK_CAP=2000,LIB_ITEM_CAP=5000;
let siblingsOf=null,libPicker=null,libDocs=[],libFolders=null,libItems=new Map(),libFolder=null,libFolderLoad=null,libFolderFailed=false;
function loadLibraryFolders(){
  return libFolderLoad||=Promise.all([
    readLibraryFolders(api,ws()),
    // 폴더 순서는 자료실 나무와 같은 규칙(library-tree.js folderSiblings). 나무 묶음은 [폴더]를 누를 때만 받는다.
    import('./library-tree.js').then(m=>{siblingsOf=m.folderSiblings}),
    import('./library-folder-data.js').then(m=>m.readLibraryFolderItems(api,ws(),{max:LIB_ITEM_CAP}))
  ]).then(([folders,,items])=>{
    libFolders=Array.isArray(folders)?folders:[];
    libItems=new Map((Array.isArray(items)?items:[]).map(r=>[r.document_id,r.folder_id]));
  }).catch(()=>{libFolderLoad=null;libFolders=null;libFolderFailed=true;toast('자료실 폴더를 읽지 못했어요. 잠시 뒤 다시 눌러 주세요.',true)});
}
async function openLibraryPick(anchor){
  if(state.busy||anchor.disabled)return;
  if(libPicker?.isOpen){void libPicker.close(false,true);return}
  anchor.disabled=true;
  try{
    const rows=await api(`/rest/v1/app_documents?workspace_id=eq.${enc(ws())}&select=id,title,file_name,mime_type,created_at&order=created_at.desc&limit=${LIB_PICK_CAP}`);
    libDocs=Array.isArray(rows)?rows:[];
  }catch{toast('자료실 자료를 읽지 못했어요. 잠시 뒤 다시 눌러 주세요.',true);return}
  finally{anchor.disabled=false}
  if(!anchor.isConnected)return;
  libPicker??=createMovePicker({esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),id:'brLibPicker',label:'자료실에서 선택',findLabel:'자료 이름 찾기',foot:false,currentTag:'이미 있음',folderIcons:false});
  const inRoom=new Set(roomRows().map(r=>r.doc.id));
  libFolder=null;libFolderLoad=null;libFolders=null;libFolderFailed=false;
  anchor.setAttribute('aria-expanded','true');
  libPicker.open({anchor,place:wide()?'below':'side',history:!wide(),multi:true,width:340,sections:PICK_SECTIONS,views:PICK_VIEWS,view:'recent',
    doneLabel:n=>n?`넣기 ${n}개`:'넣을 자료를 선택해 주세요',
    rows:(query,view)=>view==='folder'&&!libFolders&&!query.trim()?{recent:[],all:[],total:libDocs.length,waiting:!libFolderFailed}
      :libraryPickRows({docs:libDocs,inRoom,query,view,folder:libFolder,folders:libFolders||[],itemFolder:libItems,siblings:siblingsOf?(all,parentId)=>siblingsOf(all,{free:true,parentId}):null}),
    onView:view=>{if(view==='folder'&&!libFolders){libFolderFailed=false;void loadLibraryFolders().then(()=>libPicker?.refresh?.())}},
    onNav:id=>{libFolder=id||null},
    onPickMany:ids=>putPicked(ids),
    onClosed:()=>{if(anchor.isConnected)anchor.setAttribute('aria-expanded','false')}});
}
// 고른 자료를 '브리핑 요청함' 폴더에 연결만 한다(파일 다시 올리기 없음). 이미 그 폴더면 건너뜀, 다른 폴더면 옮기지 않고 목록에만.
const ITEMS='/rest/v1/app_library_folder_items';
async function putPicked(ids){
  ids=[...new Set(ids)].filter(id=>typeof id==='string'&&id);
  if(!ids.length||state.busy)return;
  state.busy=true;
  let added=0,kept=0,failed=0;
  try{
    const folderId=await ensureFolder();
    const now=new Map();
    for(let i=0;i<ids.length;i+=100){
      const part=ids.slice(i,i+100);
      const rows=await api(`${ITEMS}?workspace_id=eq.${enc(ws())}&document_id=in.(${part.map(enc).join(',')})&select=document_id,folder_id`);
      for(const r of Array.isArray(rows)?rows:[])now.set(r.document_id,r.folder_id);
    }
    const fresh=[];
    for(const id of ids){
      if(!now.has(id))fresh.push(id);
      else if(now.get(id)===folderId)added++;
      else{state.picked.add(id);kept++}
    }
    const row=id=>({document_id:id,folder_id:folderId,workspace_id:ws()});
    for(let i=0;i<fresh.length;i+=100){
      const part=fresh.slice(i,i+100);
      try{await api(ITEMS,{method:'POST',prefer:'return=minimal',body:part.map(row)});added+=part.length}
      catch{
        // 한 덩어리가 거절되면(그 사이 다른 기기에서 다른 폴더에 넣은 자료 등) 하나씩. 겹침(409)은 다른 폴더에 있는 것 — 옮기지 않고 목록에만.
        for(const id of part){
          try{await api(ITEMS,{method:'POST',prefer:'return=minimal',body:row(id)});added++}
          catch(e){if(Number(e?.status)===409||/23505|duplicate/i.test(`${e?.code||''} ${e?.message||''}`)){state.picked.add(id);kept++}else failed++}
        }
      }
    }
  }catch{failed=ids.length-added-kept}
  finally{state.busy=false}
  const r=pickResult({added,kept,failed});
  toast(r.text,r.error);
  if(added)window.dispatchEvent(new CustomEvent('kptu:library-folders-changed'));
  await load();draw();
}

async function refresh(){
  const list=view()?.querySelector('[data-br-list]');
  if(list&&!state.docs.length)list.innerHTML=waitHtml({rows:3});
  // 밑줄은 브리핑 목록과 따로 읽는다(못 읽어도 보기는 그려지고, 읽히면 다시 칠한다).
  void loadHighlights().then(()=>{if(window.KPTURouter?.current==='brief')drawDetail()}).catch(()=>{});
  await load();draw();
}

install();bind();
// 자료실 자료 ⋯ [브리핑 받기]·[브리핑 보기](library-upload.js luOpenBrief): 그 자료를 열고, 받기면 [브리핑 받기]와 같은 길로 시작한다.
async function takeAsked(){
  const ask=window.KPTUBriefOpen;window.KPTUBriefOpen=null;
  if(!ask||typeof ask.id!=='string')return;
  // 노트 › 밑줄 [원문에서 보기](종류 brief): 그 자료를 열고 그 밑줄로. 브리핑이 사라졌으면 그 길만 꺼진다(밑줄·노트는 그대로).
  if(typeof ask.highlight==='string'){
    const b=state.briefs.get(ask.id);
    if(b?.status!=='done'||!b.brief||!state.docs.some(d=>d.id===ask.id)){toast(BRIEF_GONE,true);return}
    openDoc(ask.id);
    await loadHighlights().catch(()=>{});drawDetail();
    revealMark(view()?.querySelector('[data-br-zone]'),ask.highlight);
    return;
  }
  const b=state.briefs.get(ask.id);
  if(ask.start&&(!b||b.status==='failed')){state.open=ask.id;await start(ask.id,null)}
  else if(b?.status==='done')openDoc(ask.id);
  else{state.open=ask.id;draw()}
}
window.KPTURouter?.on?.('brief',()=>{void refresh().then(takeAsked)});
void refresh().then(takeAsked);
