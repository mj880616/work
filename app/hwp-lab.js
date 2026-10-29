// HWP-편집기 화면(?view=hwp, ☰ 메뉴·사이드바 [HWP 편집]. 옛 시험판 주소 ?view=hwp-lab도 여기로 온다). 이 화면의 유일한 renderer다.
// - 내 기기 파일: [파일 선택]으로 고른 HWP/HWPX를 이 기기 브라우저 안에서만 열고, [내 기기에 저장](HWP 다운로드) 또는
//   [자료실에 올리기](기존 자료실 [+ 자료 등록] 창에 고친 HWP를 채워 넘김, library-upload-request.js)를 한다.
// - Drive 편집(2단계): 자료실·바구니의 [편집]이 hwp-drive.js 1회용 요청으로 넘긴 파일을 서버에서 열고,
//   [새 파일로 저장](기본)·[원본에 덮어쓰기](HWP 원본만)로 Drive에 저장한다. 저장 형식은 HWP 하나다.
// - 노조 서식으로 만들기(HWP-서식변환): 붙여 넣은 글을 AI(ai-assist hwp_convert)가 노조 문서 규칙 문단으로 나누고, 자료실 "양식"의 빈 양식에 칸막이 안
//   보조 스크립트(studio-convert.js)가 채워 편집기에 연다. 위 줄의 [내려받기]·[자료실에 저장]으로 마친다(기기 저장소는 쓰지 않는다).
// 편집기는 hwp-frame.js의 sandbox iframe(allow-same-origin 없음)에서 돈다. Web2 창·저장소·API에 닿지 못한다.
// HWP-화면가득: 폰·폴드(1023px 이하)와 PC [전체 화면]에서는 카드가 화면을 가득 채우고(data-focus), 위 얇은 한 줄(#hwpLabBar:
// [✕]·파일 이름·[파일 ▾]·[저장 ▾])과 편집기만 보인다. 두 메뉴는 공용 anchored-menu로 열고, 항목은 아래 기존 버튼을 그대로 누른다
// (버튼의 켜짐·꺼짐·숨김은 sync()가 정하고 메뉴는 열 때 그 상태를 읽어 그린다).
import {createSandboxedEditor} from './hwp-frame.js';
import {HWP_EDIT_MAX_BYTES,editedName,takeHwpEditRequest,requestHwpEdit,openHwpFromDrive,saveLibraryCopy,saveBasketCopy,overwriteHwp,findUnionTemplate,UNION_TEMPLATE_CATEGORY,findConvertTemplate,saveConvertedCopy} from './hwp-drive.js';
import {callAiAssist} from './basket-ai-summary.js';
import {openConvertDialog,requestEngineBuild,CONVERT_TEXT,ENGINE_TEXT,convertRetryable} from './hwp-convert.js';
import {DOC_TYPES,convertAnswer,buildPlan,convertedFileName} from './hwp-convert-model.mjs';
import {requestLibraryDocument} from './basket-library-send.js';
import {requestBasketNote} from './basket-note-tasks.js';
import {requestLibraryUpload} from './library-upload-request.js';
import {createAnchoredMenu} from './anchored-menu.js';
(()=>{
'use strict';
if(window.__KPTU_HWP_LAB_READY__)return;
const MAX_BYTES=30*1024*1024;
const MAGIC={hwp:[0xd0,0xcf,0x11,0xe0],hwpx:[0x50,0x4b,0x03,0x04]};
const $=id=>document.getElementById(id);
const rt=window.KPTURuntime;
// Device file: {name,format,savedSeq,latestSeq}. Drive mode: {target,info,name,savedSeq,latestSeq,lockNew,lockOverwrite,created}
let editorFlight=null,current=null,busy=false;
let drive=null,watchTimer=0,leaving=false,away=false;
const VIEW='hwp';
const here=()=>window.KPTURouter?.current===VIEW;

function status(text,state='info'){
  const box=$('hwpLabStatus');
  if(!box)return;
  box.textContent=text;
  box.dataset.state=state;
}
// 오래 걸리는 열기(편집기 부품 내려받기 포함)가 멈춘 것처럼 보이지 않게 경과 초를 보인다.
// 화면 낭독이 매초 읽지 않도록 초 표시는 aria-hidden 조각이고, 읽히는 글은 단계가 바뀔 때만 바뀐다.
const ELAPSED_AFTER_MS=3000;
function trackElapsed(stillOpening){
  const started=performance.now();
  const mark=document.createElement('span');
  mark.className='hwp-lab-elapsed';mark.setAttribute('aria-hidden','true');
  const timer=setInterval(()=>{
    const box=$('hwpLabStatus'),ms=performance.now()-started;
    if(!box||!stillOpening()){mark.remove();return}
    if(ms<ELAPSED_AFTER_MS)return;
    mark.textContent=` (${Math.floor(ms/1000)}초)`;
    if(mark.parentNode!==box)box.append(mark);
  },500);
  return ()=>{clearInterval(timer);mark.remove()};
}
function sync(){
  const label=$('hwpLabName');
  if(label){label.textContent=(drive?drive.name:current?.name)||'HWP 편집';label.title=label.textContent}
  const save=$('hwpLabSave'),pick=$('hwpLabPick'),upload=$('hwpLabUpload');
  if(save)save.disabled=busy||!current||!!drive;
  if(upload)upload.disabled=busy||!current||!!drive;
  if(pick)pick.disabled=busy||!!drive;
  const tpl=$('hwpLabTemplate');
  if(tpl)tpl.disabled=busy||!!drive;
  const convert=$('hwpLabConvert');
  if(convert)convert.disabled=busy;
  // 노조 서식으로 만든 문서: 위 줄에 파일 이름과 [내려받기]·[자료실에 저장]. 기기 파일용 저장 버튼 둘은 숨긴다.
  const made=!!current?.converted&&!drive;
  if(save)save.hidden=made;
  if(upload)upload.hidden=made;
  const conv=$('hwpConvBar');
  if(conv){
    conv.hidden=!made;
    if(made){
      $('hwpConvName').textContent=current.name;
      $('hwpConvDownload').disabled=busy;
      $('hwpConvLibrary').disabled=busy||!!current.lockLibrary;
    }
  }
  const bar=$('hwpDriveBar');
  if(!bar)return;
  const ready=!!drive?.info;
  $('hwpDriveNew').disabled=busy||!ready||drive.lockNew;
  const over=$('hwpDriveOverwrite');
  // 양식에서 시작한 문서는 양식 원본에 덮어쓰지 않는다(버튼을 숨기고 새 파일로만 저장).
  over.hidden=!ready||!drive.info.can_overwrite||!!drive.target.template;
  over.disabled=busy||!ready||drive.lockOverwrite;
  $('hwpDriveBack').disabled=busy;
  const view=$('hwpDriveView');
  view.hidden=!drive?.created;
}
function formatOf(name,bytes){
  const ext=String(name||'').toLowerCase().match(/\.(hwpx?)$/)?.[1];
  const magic=ext&&MAGIC[ext];
  if(!magic)return null;
  return magic.every((byte,index)=>bytes[index]===byte)?ext:null;
}

// 위 한 줄 메뉴: 지금 모드(기기 파일·노조 서식으로 만든 문서·Drive 편집)에 보이는 기존 버튼을 같은 이름으로 늘어놓는다.
const MENU_ITEMS={
  file:()=>['hwpLabPick','hwpLabTemplate','hwpLabConvert'],
  save:()=>drive?['hwpDriveNew','hwpDriveOverwrite','hwpDriveView']:current?.converted?['hwpConvDownload','hwpConvLibrary']:['hwpLabSave','hwpLabUpload'],
};
const escapeText=text=>String(text).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[ch]);
let barMenu=null;
function mountBarMenu(card){
  if(barMenu)return;
  barMenu=createAnchoredMenu({id:'hwpBarMenu',className:'hwp-bar-panel',label:'HWP 편집 메뉴',historyKey:'kptuHwpBarMenu',
    // 전체 화면(브라우저)에서는 카드 안쪽만 보이므로 메뉴 판도 카드 안에 둔다.
    parent:()=>card,key:trigger=>trigger.dataset.hwpMenu,
    render:key=>(MENU_ITEMS[key]?.()||[]).map(id=>{
      const source=$(id);
      if(!source||source.hidden)return '';
      return `<button type="button" data-hwp-act="${id}"${source.disabled?' disabled':''}>${escapeText(source.textContent.trim())}</button>`;
    }).join(''),
    onAction:button=>{const source=$(button.dataset.hwpAct);if(source&&!source.disabled&&!source.hidden)source.click()}});
  for(const trigger of card.querySelectorAll('[data-hwp-menu]')){
    trigger.setAttribute('aria-controls','hwpBarMenu');
    trigger.addEventListener('click',()=>barMenu.open(trigger));
  }
}
// 폰·폴드 폭이거나 PC [전체 화면]이면 화면 가득(data-focus). 폭이 바뀌면(돌리기·펼침) 바로 다시 정한다.
const NARROW=window.matchMedia('(max-width: 1023px)');
function layout(){
  const card=document.querySelector('#hwpView .hwp-lab');
  if(!card)return;
  const focus=NARROW.matches||card.hasAttribute('data-full');
  if(!focus&&barMenu?.active)void barMenu.close();
  card.toggleAttribute('data-focus',focus);
}
NARROW.addEventListener?.('change',layout);

// Lab controls and Drive controls share the card; only one set is shown.
function mount(){
  const card=document.querySelector('#hwpView .hwp-lab');
  if(!card)return;
  mountBarMenu(card);
  layout();
  if($('hwpDriveBar'))return;
  const bar=document.createElement('div');
  bar.id='hwpDriveBar';bar.className='hwp-lab-actions hwp-drive-bar';bar.hidden=true;
  bar.innerHTML='<button id="hwpDriveNew" class="primary" type="button" disabled>새 파일로 저장</button><button id="hwpDriveOverwrite" class="secondary" type="button" hidden disabled>원본에 덮어쓰기</button><a id="hwpDriveView" href="./?view=library" hidden>자료실에서 보기</a><button id="hwpDriveBack" class="secondary" type="button">돌아가기</button>';
  card.querySelector('.hwp-lab-actions')?.after(bar);
  const conv=document.createElement('div');
  conv.id='hwpConvBar';conv.className='hwp-lab-actions hwp-conv-bar';conv.hidden=true;
  conv.innerHTML='<span id="hwpConvName" class="hwp-conv-name"></span><button id="hwpConvDownload" class="primary" type="button">내려받기</button><button id="hwpConvLibrary" class="secondary" type="button">자료실에 저장</button>';
  $('hwpLabEditor')?.before(conv);
  $('hwpConvDownload').addEventListener('click',()=>void save());
  $('hwpConvLibrary').addEventListener('click',()=>void saveConvertedToLibrary());
  $('hwpDriveNew').addEventListener('click',()=>void saveNew());
  $('hwpDriveOverwrite').addEventListener('click',()=>void overwrite());
  $('hwpDriveBack').addEventListener('click',()=>void back());
  $('hwpDriveView').addEventListener('click',event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    if(busy||!drive?.created)return;
    void refreshDirty().then(()=>{
      if(!drive?.created||busy||!leaveOk())return;
      requestLibraryDocument(drive.created,rt);leaving=true;window.KPTURouter.go('library',{source:'delegated'});
    });
  });
}
function showMode(){
  const driveMode=!!drive;
  const card=document.querySelector('#hwpView .hwp-lab');
  if(!card)return;
  card.querySelector('.hwp-lab-actions:not(.hwp-drive-bar)').hidden=driveMode;
  $('hwpDriveBar').hidden=!driveMode;
  sync();
}

function editor(){
  if(editorFlight)return editorFlight;
  const host=$('hwpLabEditor');
  status('편집기를 불러오는 중입니다… 처음에는 시간이 걸릴 수 있습니다.');
  editorFlight=createSandboxedEditor(host)
    .then(instance=>{
      if(!drive)status('편집기가 준비됐습니다. [파일 선택]으로 HWP·HWPX 파일을 여세요.');
      return instance;
    })
    .catch(err=>{
      editorFlight=null;
      host?.replaceChildren();
      console.error('hwp-lab editor',err);
      status('편집기를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 들어와 주세요.','error');
      throw err;
    });
  return editorFlight;
}
async function changeSeq(instance){
  try{const state=await instance.getDocumentState();return Number.isSafeInteger(state?.changeSeq)?state.changeSeq:null}catch{return null}
}
// The open document: a Drive file once it has opened, otherwise a device file.
const shownDoc=()=>drive?(drive.info?drive:null):current;
const dirty=()=>{const doc=shownDoc();return !!doc&&doc.savedSeq!=null&&(doc.latestSeq??doc.savedSeq)>doc.savedSeq};
// The editor does not push edit events to the page, so while a file is open its change counter is read
// every few seconds. Leaving through the router is synchronous and uses the last reading.
async function refreshDirty(){
  const shown=shownDoc();
  if(!shown||!editorFlight)return;
  const seq=await changeSeq(await editorFlight);
  if(shownDoc()===shown&&seq!=null)shown.latestSeq=Math.max(shown.latestSeq??0,seq);
}
function watchEdits(){
  clearInterval(watchTimer);watchTimer=0;
  if(!shownDoc()||!here())return;
  let reading=false;
  watchTimer=setInterval(()=>{if(reading)return;reading=true;refreshDirty().finally(()=>{reading=false})},2000);
}
window.addEventListener('kptu:view-changed',event=>{if(event.detail?.view!==VIEW){away=true;if(isFull())void exitFull()}watchEdits()});

async function open(file){
  if(!file||busy||drive)return;
  if(file.size>MAX_BYTES){status('30MB보다 큰 파일은 편집기에서 열지 않습니다.','error');return}
  await refreshDirty();
  if(busy||drive||(dirty()&&!window.confirm('저장하지 않은 고친 내용이 있어요. 다른 파일을 열면 사라져요. 열까요?')))return;
  busy=true;sync();
  let opening=true;
  const stopElapsed=trackElapsed(()=>opening&&!drive);
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());
    const format=formatOf(file.name,bytes);
    if(!format){status('HWP(.hwp) 또는 HWPX(.hwpx) 파일만 열 수 있습니다.','error');return}
    status(`${file.name} 여는 중…`);
    const instance=await editor();
    status(`${file.name} 문서 펼치는 중…`);
    const result=await instance.loadFile(bytes,file.name,{skipUnsavedGuard:true});
    const seq=await changeSeq(instance);
    current={name:file.name,format,savedSeq:seq,latestSeq:seq};
    watchEdits();
    const note=format==='hwpx'?' 저장은 HWP로 합니다.':'';
    status(`${file.name} · ${result?.pageCount??'?'}쪽을 열었습니다.${note} 고친 뒤 [내 기기에 저장] 또는 [자료실에 올리기]를 누르세요.`,'ok');
  }catch(err){
    console.error('hwp-lab open',err);
    status('파일을 열지 못했습니다. 다른 파일로 시도해 주세요.','error');
  }finally{opening=false;stopElapsed();busy=false;sync()}
}

async function save(){
  const shown=current;
  if(!shown||busy||drive)return;
  busy=true;sync();
  try{
    const {bytes,seq}=await exportCurrent();
    const name=shown.converted?shown.name:editedName(shown.name);
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/x-hwp'}));
    const link=document.createElement('a');
    link.href=url;link.download=name;link.hidden=true;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    if(current===shown)shown.savedSeq=seq;
    status(shown.converted?`${name}(${Math.max(1,Math.round(bytes.length/1024))}KB)을 내려받았습니다. 한글에서 열어 확인해 보세요.`:`${name}(${Math.max(1,Math.round(bytes.length/1024))}KB)을 내려받았습니다. 원본과 비교해 보세요.`,'ok');
  }catch(err){
    console.error('hwp-lab save',err?.kind||err);
    status(err?.kind?err.message:'파일을 만들지 못했습니다. 다시 시도해 주세요.','error');
  }finally{busy=false;sync()}
}
// Hands the edited HWP to the library's own [+ 자료 등록] dialog. The person picks project and category and
// presses [등록] there; this screen sends nothing to the server.
async function uploadToLibrary(){
  const shown=current;
  if(!shown||busy||drive)return;
  busy=true;sync();
  let handed=false;
  try{
    const {bytes,seq}=await exportCurrent();
    const file=new File([bytes],editedName(shown.name),{type:'application/x-hwp'});
    if(!requestLibraryUpload(file,rt)){status('로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.','error');return}
    // The file now sits in the library dialog; the editor keeps this copy until another file is opened.
    if(current===shown)shown.savedSeq=seq;
    status(`${file.name}을 자료실 등록 창으로 넘겼습니다. 사업영역·분류를 고른 뒤 [등록]을 누르세요.`,'ok');
    handed=true;
  }catch(err){
    console.error('hwp-lab upload',err?.kind||err);
    status(err?.kind?err.message:'파일을 만들지 못했습니다. 다시 시도해 주세요.','error');
  }finally{busy=false;sync()}
  if(!handed)return;
  leaving=true;
  if(!window.KPTURouter.go('library',{source:'delegated'})&&window.KPTUViewLoader?.isLoaded?.('library'))leaving=false;
}

async function openDrive(target){
  drive={target,info:null,name:target.kind==='library'?target.document.file_name:target.fileName};
  current=null;showMode();
  busy=true;sync();
  const shown=drive;
  // 두 일이 동시에 진행된다: ① Drive 파일 받기(서버) ② 편집기 부품 불러오기. 어느 쪽이 남았는지 단계 글로 보인다.
  const got={file:false,editor:false};
  const stage=()=>{
    if(drive!==shown||shown.info)return;
    status(`${shown.name||'파일'} 여는 중… 파일 ${got.file?'받음':'받는 중'} · 편집기 ${got.editor?'준비됨':'준비 중'}`);
  };
  const stopElapsed=trackElapsed(()=>drive===shown&&!shown.info);
  try{
    const editorPromise=editor();
    const fileFlight=openHwpFromDrive(target,{rt});
    stage();
    editorPromise.then(()=>{got.editor=true;stage()},()=>{});
    fileFlight.then(()=>{got.file=true;stage()},()=>{});
    const [instance,file]=await Promise.all([editorPromise,fileFlight]);
    if(drive!==shown)return;
    if(file.bytes.length>HWP_EDIT_MAX_BYTES)throw Object.assign(new Error('30MB보다 큰 파일은 편집기에서 열지 않아요.'),{kind:'refused'});
    status(`${file.info.file_name} 문서 펼치는 중…`);
    const result=await instance.loadFile(file.bytes,file.info.file_name,{skipUnsavedGuard:true});
    if(drive!==shown)return;
    const seq=await changeSeq(instance);
    Object.assign(shown,{info:file.info,name:file.info.file_name,savedSeq:seq,latestSeq:seq});
    watchEdits();
    const notes=[
      file.info.format==='hwpx'?'HWPX 원본은 새 HWP 파일로만 저장해요.':'',
      file.info.shared?'이 파일은 정리함과 자료실이 같은 원본을 써요.':'',
    ].filter(Boolean).join(' ');
    status(shown.target.template
      ?`노조 양식 · ${result?.pageCount??'?'}쪽을 열었어요. 양식 원본은 그대로 두고, 고친 뒤 [새 파일로 저장]에서 제목을 정해요. 스타일은 Ctrl+1~0(예비 Alt+1~0) 또는 위쪽 스타일 버튼으로 입혀요.`
      :`${file.info.file_name} · ${result?.pageCount??'?'}쪽을 열었어요. ${notes?notes+' ':''}고친 뒤 [새 파일로 저장]을 누르세요.`,'ok');
  }catch(err){
    if(drive!==shown)return;
    console.error('hwp-lab drive open',err?.kind||err);
    status(err?.kind?err.message:'파일을 열지 못했어요. 아무것도 바뀌지 않았어요.','error');
  }finally{stopElapsed();if(drive===shown){busy=false;sync()}}
}

// HWP-노조양식: 자료실 분류 "양식"에 등록된 노조 문서 양식 HWP를 새 문서의 시작으로 연다. 양식이 없으면 등록 방법을 안내한다.
async function openTemplate(){
  if(busy||drive)return;
  await refreshDirty();
  if(busy||drive||(dirty()&&!window.confirm('저장하지 않은 고친 내용이 있어요. 양식을 열면 사라져요. 열까요?')))return;
  busy=true;sync();
  try{
    status('자료실에서 노조 양식을 찾는 중…');
    const found=await findUnionTemplate({rt});
    if(!found.chosen){
      status(`자료실에 분류 "${UNION_TEMPLATE_CATEGORY}"으로 등록된 HWP가 없어요. 노조 문서 양식 HWP를 자료실에 분류 "${UNION_TEMPLATE_CATEGORY}"으로 한 번 등록해 주세요.`,'error');
      return;
    }
    const row=found.chosen;
    if(!requestTemplate(row)){status('로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.','error');return}
  }catch(err){
    console.error('hwp-lab template',err?.kind||err);
    status(err?.kind==='session'?err.message:'노조 양식을 찾지 못했어요. 아무것도 바뀌지 않았어요.','error');
    return;
  }finally{busy=false;sync()}
  const target=takeHwpEditRequest(rt);
  if(target)void openDrive(target);
}
function requestTemplate(row){
  // Same one-shot hand-off the library [편집] uses; the template flag keeps the original from being overwritten.
  return requestHwpEdit({kind:'library',template:true,document:{id:row.id,title:row.title,file_name:row.file_name,category:row.category}},rt);
}

// HWP-서식변환: [노조 서식으로 만들기]. 순서는 ① 자료실 "양식"에서 이 종류의 빈 양식 찾기·받기 ② AI가 글을 노조 문서 규칙 문단으로 나누기 ③ 칸막이 안 보조
// 스크립트가 양식에 채우기 ④ 편집기에 열기. AI가 실패하면 편집기의 지금 문서는 그대로 둔다(양식을 편집기에 여는 것은 ③ 직전).
async function startConvert(){
  if(busy)return;
  await refreshDirty();
  if(busy||(dirty()&&!window.confirm('저장하지 않은 고친 내용이 있어요. 노조 서식으로 새로 만들면 사라져요. 계속할까요?')))return;
  openConvertDialog({onMake:runConvert});
}
async function runConvert({docType,text,progress,cancelled}){
  if(busy)return {ok:false,message:'다른 작업이 진행 중이에요. 잠시 뒤 다시 눌러 주세요.'};
  const label=DOC_TYPES.find(row=>row.id===docType)?.label||'문서';
  busy=true;sync();
  try{
    progress('자료실에서 노조 양식을 찾는 중…');
    let found;
    try{found=await findConvertTemplate(docType,{rt})}
    catch(err){return {ok:false,message:err?.kind==='session'?err.message:'노조 양식을 찾지 못했어요. 아무것도 바뀌지 않았어요.'}}
    if(!found.chosen)return {ok:false,message:`자료실에 분류 "${UNION_TEMPLATE_CATEGORY}"으로 등록된 ${label} 빈 양식 HWP가 없어요. 자료명에 "${label}"이 들어간 노조 양식 HWP를 자료실에 분류 "${UNION_TEMPLATE_CATEGORY}"으로 한 번 등록해 주세요.`};
    let file;
    try{file=await openHwpFromDrive({kind:'library',document:{id:found.chosen.id}},{rt})}
    catch(err){return {ok:false,message:err?.kind?err.message:'양식을 열지 못했어요. 아무것도 바뀌지 않았어요.'}}
    if(file.bytes.length>HWP_EDIT_MAX_BYTES)return {ok:false,message:'양식 파일이 30MB보다 커서 열지 않아요.'};
    if(cancelled())return {ok:false,message:''};
    progress('AI가 노조 문서 규칙에 맞게 다시 짜는 중… 30초 안팎 걸려요.');
    const reply=await callAiAssist({kind:'hwp_convert',doc_type:docType,text},{rt},CONVERT_TEXT);
    if(cancelled())return {ok:false,message:''};
    if(!reply.ok)return {ok:false,message:CONVERT_TEXT[reply.code]||CONVERT_TEXT.internal_error,retry:convertRetryable(reply.code)};
    const answer=convertAnswer(reply.data);
    if(!answer||reply.data.doc_type!==docType)return {ok:false,message:CONVERT_TEXT.ai_invalid_response};
    const now=new Date(),plan=buildPlan(answer,now),name=convertedFileName(docType,now);
    progress('양식에 넣는 중…');
    // 편집기에 지금 열린 문서(기기 파일·Drive 파일)는 여기서부터 새 문서로 바뀐다. 이전 Drive 문서 상태를 먼저 정리한다.
    if(drive){resetToDevice();showMode()}
    const instance=await editor();
    if(cancelled())return {ok:false,message:''};
    const frame=$('hwpLabEditor')?.querySelector('iframe')?.contentWindow;
    if(!frame)return {ok:false,message:ENGINE_TEXT.no_engine};
    let built;
    try{built=await requestEngineBuild(frame,file.bytes,plan)}
    catch(err){return {ok:false,message:err?.kind==='engine'?err.message:ENGINE_TEXT.engine_error}}
    if(cancelled())return {ok:false,message:''};
    progress('편집기에 여는 중…');
    const result=await instance.loadFile(built.bytes,name,{skipUnsavedGuard:true});
    const seq=await changeSeq(instance);
    // 방금 만든 문서는 아직 저장 전이다: 나가거나 다른 파일을 열면 묻도록 저장 기준을 한 칸 뒤에 둔다.
    current={name,format:'hwp',converted:true,title:answer.title,docType,savedSeq:seq==null?null:seq-1,latestSeq:seq};
    watchEdits();
    const notes=[
      found.specific?'':`${label} 전용 빈 양식이 없어 일반 노조 양식에 넣었어요.`,
      built.missing.length?`양식에 없는 스타일(${built.missing.join('·')})은 바탕글로 넣었어요.`:'',
      answer.dropped?`형식이 맞지 않은 문단 ${answer.dropped}개는 뺐어요. 원문과 대조해 주세요.`:'',
    ].filter(Boolean).join(' ');
    status(`${name} · ${result?.pageCount??'?'}쪽 · ${built.inserted}문단을 넣었어요. 확인하고 고친 뒤 [내려받기] 또는 [자료실에 저장]을 누르세요.${notes?' '+notes:''}`,'ok');
    return {ok:true};
  }catch(err){
    console.error('hwp-lab convert',err?.kind||err?.code||'error');
    return {ok:false,message:err?.kind?err.message:'노조 서식으로 만들지 못했어요. 편집기를 확인하고 다시 시도해 주세요.'};
  }finally{busy=false;sync()}
}
// [자료실에 저장]: 만든 문서를 자료실에 새 자료로 등록한다(library-files). 결과를 모르면 다시 보내지 않고 자료실에서 먼저 확인하라고 안내한다.
async function saveConvertedToLibrary(){
  const shown=current;
  if(!shown?.converted||busy||drive||shown.lockLibrary)return;
  busy=true;sync();
  try{
    status('자료실에 저장하는 중…');
    let made;
    try{made=await exportCurrent()}catch(err){status(err?.kind?err.message:'저장할 파일을 만들지 못했어요. 아무것도 바뀌지 않았어요.','error');return}
    const outcome=await saveConvertedCopy(made.bytes,{fileName:shown.name,title:shown.title},{rt});
    if(current!==shown)return;
    if(outcome.kind==='created'){shown.savedSeq=made.seq;status(outcome.message,'ok')}
    else{
      if(outcome.kind==='unknown')shown.lockLibrary=true;
      status(outcome.message,'error');
    }
  }finally{busy=false;sync()}
}

// 전체 화면 + 키보드 잠금: 일반 크롬 탭은 Ctrl+1~9를 탭 전환에 먼저 쓰므로, 전체 화면에서 숫자 키만 잠가 편집기가 받게 한다.
// 잠금은 이 창(맨 바깥)에서만 걸 수 있다. HWP-화면가득: 전체 화면은 카드(위 한 줄 + 편집기)를 채운다. 브라우저 전체 화면을 쓸 수
// 없는 곳에서도 카드가 창 안을 꽉 채운다(같은 모양). Esc(브라우저 전체 화면)·[✕]로 원래 화면. 폰 폭은 늘 화면 가득이라 버튼이 없다.
const DIGIT_KEYS=['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'];
const canLockKeys=()=>!!(document.fullscreenEnabled&&navigator.keyboard&&typeof navigator.keyboard.lock==='function');
const cardOf=()=>document.querySelector('#hwpView .hwp-lab');
let fullNative=false;
function setFull(on){
  const card=cardOf();
  if(!card)return;
  card.toggleAttribute('data-full',on);
  $('hwpLabFull')?.setAttribute('aria-pressed',String(on));
  layout();
}
const isFull=()=>!!cardOf()?.hasAttribute('data-full');
async function enterFull(){
  const card=cardOf();
  if(!card||isFull())return;
  setFull(true);
  if(!document.fullscreenEnabled||typeof card.requestFullscreen!=='function'){status('브라우저 전체 화면을 쓸 수 없어 이 창 안에서 꽉 채웠어요. 스타일은 스타일 버튼이나 Alt+숫자를 쓰세요.');return}
  try{
    await card.requestFullscreen();
    fullNative=true;
  }catch(err){
    console.error('hwp-lab fullscreen',err);
    status('브라우저 전체 화면을 쓸 수 없어 이 창 안에서 꽉 채웠어요. 스타일은 스타일 버튼이나 Alt+숫자를 쓰세요.','error');
    return;
  }
  try{
    if(!canLockKeys())throw new Error('keyboard lock unavailable');
    await navigator.keyboard.lock(DIGIT_KEYS);
  }catch(err){
    console.error('hwp-lab keyboard lock',err);
    status('전체 화면이나 키보드 잠금을 쓸 수 없어요. 스타일 버튼이나 Alt+숫자를 쓰세요.','error');
  }
}
async function exitFull(){
  const native=fullNative;
  fullNative=false;
  setFull(false);
  if(native&&document.fullscreenElement)await document.exitFullscreen().catch(()=>{});
}
document.addEventListener('fullscreenchange',()=>{
  if(document.fullscreenElement)return;
  try{navigator.keyboard?.unlock?.()}catch{/* Nothing is locked. */}
  // Esc가 브라우저 전체 화면을 끝냈으면 카드도 원래 화면으로.
  if(fullNative){fullNative=false;setFull(false)}
});
// 브라우저 전체 화면이 아닌 창 안 꽉 채우기에서도 Esc로 원래 화면(열린 메뉴·창이 먼저 Esc를 받는다).
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||event.defaultPrevented||fullNative||!isFull()||!here())return;
  if(event.target?.closest?.('.modal,[role="dialog"]'))return;
  event.preventDefault();
  void exitFull();
});
// [✕]: 전체 화면이면 원래 화면, Drive 편집이면 [돌아가기]와 같고, 그 밖에는 이전 화면(저장 안 한 내용은 화면을 떠날 때 한 번 묻는다).
function closeBar(){
  if(isFull()){void exitFull();return}
  if(drive){void back();return}
  window.KPTURouter?.back?.();
}

async function exportCurrent(){
  const instance=await editor();
  const seq=await changeSeq(instance);
  const bytes=await instance.exportHwp();
  if(!(bytes instanceof Uint8Array)||!bytes.length)throw new Error('empty export');
  if(bytes.length>HWP_EDIT_MAX_BYTES)throw Object.assign(new Error('저장할 파일이 30MB보다 커서 저장하지 않았어요.'),{kind:'refused'});
  return {bytes,seq};
}
async function saveNew(){
  const shown=drive;
  if(!shown?.info||busy||shown.lockNew)return;
  let newTitle;
  if(shown.target.template){
    newTitle=window.prompt('새 문서 제목을 입력하세요. 양식 원본은 그대로 두고 자료실에 새 문서로 저장해요.','');
    if(newTitle==null)return;
    newTitle=newTitle.trim();
    if(!newTitle){status('제목을 입력해야 저장해요. 아무것도 바뀌지 않았어요.','error');return}
  }
  busy=true;sync();
  try{
    status('새 파일로 저장하는 중…');
    let made;
    try{made=await exportCurrent()}catch(err){status(err?.kind?err.message:'저장할 파일을 만들지 못했어요. 아무것도 바뀌지 않았어요.','error');return}
    const outcome=shown.target.kind==='library'?await saveLibraryCopy(shown.target,made.bytes,{rt,newTitle}):await saveBasketCopy(shown.target,made.bytes,{rt});
    if(drive!==shown)return;
    if(outcome.kind==='created'){
      shown.savedSeq=made.seq;
      if(outcome.document)shown.created=outcome.document.id;
      status(outcome.message,'ok');
    }else{
      // An unknown outcome may still have saved: never send this again from here.
      if(outcome.kind==='unknown')shown.lockNew=true;
      status(outcome.message,'error');
    }
  }finally{if(drive===shown){busy=false;sync()}}
}
async function overwrite(){
  const shown=drive;
  if(!shown?.info?.can_overwrite||busy||shown.lockOverwrite)return;
  const lines=[`원본 "${shown.info.file_name}"을 지금 고친 내용으로 바꿔요.`,'바꾸기 전 원본 사본을 Drive "Web2 편집 백업" 폴더에 보관해요.'];
  if(shown.info.shared)lines.push('정리함과 자료실 양쪽에 반영돼요.');
  if(!window.confirm([...lines,'덮어쓸까요?'].join('\n')))return;
  busy=true;sync();
  try{
    status('원본 사본을 보관하고 덮어쓰는 중…');
    let made;
    try{made=await exportCurrent()}catch(err){status(err?.kind?err.message:'저장할 파일을 만들지 못했어요. 아무것도 바뀌지 않았어요.','error');return}
    const outcome=await overwriteHwp(shown.target,made.bytes,shown.info,{confirmShared:!!shown.info.shared,rt});
    if(drive!==shown)return;
    if(outcome.kind==='overwritten'){
      Object.assign(shown.info,{revision:outcome.revision,md5:outcome.md5});
      shown.savedSeq=made.seq;
      status(outcome.message,'ok');
      return;
    }
    if(outcome.kind==='shared')shown.info.shared=true;
    if(outcome.kind==='changed'||outcome.kind==='unknown')shown.lockOverwrite=true;
    status(outcome.message,'error');
  }finally{if(drive===shown){busy=false;sync()}}
}

function leaveOk(){
  return !dirty()||window.confirm('저장하지 않은 고친 내용이 있어요. 나가면 사라져요. 나갈까요?');
}
async function back(){
  if(!drive||busy)return;
  await refreshDirty();
  if(!drive||busy||!leaveOk())return;
  if(drive.target.template){resetToDevice();showMode();status('편집기가 준비됐습니다. [파일 선택]으로 HWP·HWPX 파일을 열거나 [노조 양식으로 새 문서]를 누르세요.');editor().catch(()=>{});return}
  leaving=true;
  if(drive.target.kind==='library'){requestLibraryDocument(drive.target.document.id,rt);window.KPTURouter.go('library',{source:'delegated'})}
  else{requestBasketNote(drive.target.noteId,rt);window.KPTURouter.go('basket',{source:'delegated'})}
}
// A Drive save in flight keeps the screen; a device file only asks when it has unsaved edits.
window.addEventListener('kptu:before-view-change',event=>{
  if(!(drive||current)||!here()||event.detail?.view===VIEW)return;
  if(leaving){leaving=false;return}
  if((drive&&busy)||!leaveOk())event.preventDefault();
});
window.addEventListener('kptu:before-reload',event=>{if(here()&&((drive&&busy)||dirty()))event.detail.otherDraft=true});
window.addEventListener('beforeunload',event=>{if(here()&&((drive&&busy)||dirty())){event.preventDefault();event.returnValue=''}});

// Entering from the menu after a Drive file was left (already confirmed on leaving) starts a fresh editor for a
// device file, so the old Drive document is neither shown nor saved from here.
function resetToDevice(){
  clearInterval(watchTimer);watchTimer=0;
  drive=null;current=null;leaving=false;
  const flight=editorFlight;editorFlight=null;
  flight?.then(instance=>instance.destroy?.()).catch(()=>{});
  $('hwpLabEditor')?.replaceChildren();
}

function start(){
  const input=$('hwpLabFile');
  if(!input)return;
  mount();
  if(!input.dataset.bound){
    input.dataset.bound='1';
    $('hwpLabPick')?.addEventListener('click',()=>input.click());
    $('hwpLabTemplate')?.addEventListener('click',()=>void openTemplate());
    $('hwpLabConvert')?.addEventListener('click',()=>void startConvert());
    $('hwpLabFull')?.addEventListener('click',()=>void (isFull()?exitFull():enterFull()));
    $('hwpLabClose')?.addEventListener('click',closeBar);
    input.addEventListener('change',()=>{const file=input.files?.[0];input.value='';void open(file)});
    $('hwpLabSave')?.addEventListener('click',()=>void save());
    $('hwpLabUpload')?.addEventListener('click',()=>void uploadToLibrary());
  }
  leaving=false;
  // Leaving this screen already asked about unsaved edits; choosing [HWP 편집] again while on it asks here.
  const returning=away;away=false;
  const target=takeHwpEditRequest(rt);
  if(target&&!busy){
    if(dirty()&&!window.confirm('저장하지 않은 고친 내용이 있어요. 다른 파일을 열면 사라져요. 열까요?')){showMode();watchEdits();return}
    void openDrive(target);
    return;
  }
  if(drive&&!busy){
    if(!returning&&dirty()&&!window.confirm('저장하지 않은 고친 내용이 있어요. 내 기기 파일 편집으로 바꾸면 사라져요. 바꿀까요?')){showMode();watchEdits();return}
    resetToDevice();
  }
  showMode();
  watchEdits();
  // A failed editor load is retried on the next entry to this view.
  editor().catch(()=>{});
}

window.KPTURouter?.on?.(VIEW,start);
start();
window.__KPTU_HWP_LAB_READY__=Promise.resolve(true);
})();
