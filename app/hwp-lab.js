// HWP-편집기 화면(?view=hwp, ☰ 메뉴·사이드바 [HWP 편집]. 옛 시험판 주소 ?view=hwp-lab도 여기로 온다). 이 화면의 유일한 renderer다.
// - 내 기기 파일: [파일 선택]으로 고른 HWP/HWPX를 이 기기 브라우저 안에서만 열고, [내 기기에 저장](HWP 다운로드) 또는
//   [자료실에 올리기](기존 자료실 [+ 자료 등록] 창에 고친 HWP를 채워 넘김, library-upload-request.js)를 한다.
// - Drive 편집(2단계): 자료실·바구니의 [편집]이 hwp-drive.js 1회용 요청으로 넘긴 파일을 서버에서 열고,
//   [새 파일로 저장](기본)·[원본에 덮어쓰기](HWP 원본만)로 Drive에 저장한다. 저장 형식은 HWP 하나다.
// 편집기는 hwp-frame.js의 sandbox iframe(allow-same-origin 없음)에서 돈다. Web2 창·저장소·API에 닿지 못한다.
import {createSandboxedEditor} from './hwp-frame.js';
import {HWP_EDIT_MAX_BYTES,editedName,takeHwpEditRequest,openHwpFromDrive,saveLibraryCopy,saveBasketCopy,overwriteHwp} from './hwp-drive.js';
import {requestLibraryDocument} from './basket-library-send.js';
import {requestBasketNote} from './basket-note-tasks.js';
import {requestLibraryUpload} from './library-upload-request.js';
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
function sync(){
  const save=$('hwpLabSave'),pick=$('hwpLabPick'),upload=$('hwpLabUpload');
  if(save)save.disabled=busy||!current||!!drive;
  if(upload)upload.disabled=busy||!current||!!drive;
  if(pick)pick.disabled=busy||!!drive;
  const bar=$('hwpDriveBar');
  if(!bar)return;
  const ready=!!drive?.info;
  $('hwpDriveNew').disabled=busy||!ready||drive.lockNew;
  const over=$('hwpDriveOverwrite');
  over.hidden=!ready||!drive.info.can_overwrite;
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

// Lab controls and Drive controls share the card; only one set is shown.
function mount(){
  const card=document.querySelector('#hwpView .hwp-lab');
  if(!card||$('hwpDriveBar'))return;
  const bar=document.createElement('div');
  bar.id='hwpDriveBar';bar.className='hwp-lab-actions hwp-drive-bar';bar.hidden=true;
  bar.innerHTML='<button id="hwpDriveNew" class="primary" type="button" disabled>새 파일로 저장</button><button id="hwpDriveOverwrite" class="secondary" type="button" hidden disabled>원본에 덮어쓰기</button><a id="hwpDriveView" href="./?view=library" hidden>자료실에서 보기</a><button id="hwpDriveBack" class="secondary" type="button">돌아가기</button>';
  card.querySelector('.hwp-lab-actions')?.after(bar);
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
  card.querySelector('.hwp-lab-note').textContent=driveMode
    ?'Drive 파일을 편집기에서 엽니다. 편집기는 Web2 화면과 분리되어 있고 기기에 남기지 않습니다. 저장은 HWP로만 합니다(HWPX도 HWP로).'
    :'한글이 없는 PC나 폰에서 내 기기의 HWP·HWPX를 열어 고칩니다. 고른 파일은 이 기기 브라우저 안에서만 열고 기기에 남기지 않습니다. 저장은 HWP로만 합니다(HWPX도 HWP로).';
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
window.addEventListener('kptu:view-changed',event=>{if(event.detail?.view!==VIEW)away=true;watchEdits()});

async function open(file){
  if(!file||busy||drive)return;
  if(file.size>MAX_BYTES){status('30MB보다 큰 파일은 편집기에서 열지 않습니다.','error');return}
  await refreshDirty();
  if(busy||drive||(dirty()&&!window.confirm('저장하지 않은 고친 내용이 있어요. 다른 파일을 열면 사라져요. 열까요?')))return;
  busy=true;sync();
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());
    const format=formatOf(file.name,bytes);
    if(!format){status('HWP(.hwp) 또는 HWPX(.hwpx) 파일만 열 수 있습니다.','error');return}
    status(`${file.name} 여는 중…`);
    const instance=await editor();
    const result=await instance.loadFile(bytes,file.name,{skipUnsavedGuard:true});
    const seq=await changeSeq(instance);
    current={name:file.name,format,savedSeq:seq,latestSeq:seq};
    watchEdits();
    const note=format==='hwpx'?' 저장은 HWP로 합니다.':'';
    status(`${file.name} · ${result?.pageCount??'?'}쪽을 열었습니다.${note} 고친 뒤 [내 기기에 저장] 또는 [자료실에 올리기]를 누르세요.`,'ok');
  }catch(err){
    console.error('hwp-lab open',err);
    status('파일을 열지 못했습니다. 다른 파일로 시도해 주세요.','error');
  }finally{busy=false;sync()}
}

async function save(){
  const shown=current;
  if(!shown||busy||drive)return;
  busy=true;sync();
  try{
    const {bytes,seq}=await exportCurrent();
    const name=editedName(shown.name);
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/x-hwp'}));
    const link=document.createElement('a');
    link.href=url;link.download=name;link.hidden=true;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    if(current===shown)shown.savedSeq=seq;
    status(`${name}(${Math.max(1,Math.round(bytes.length/1024))}KB)을 내려받았습니다. 원본과 비교해 보세요.`,'ok');
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
    status(`${file.name}을 자료실 등록 창으로 넘겼습니다. 프로젝트·분류를 고른 뒤 [등록]을 누르세요.`,'ok');
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
  try{
    status(`${shown.name||'파일'} 여는 중…`);
    const [instance,file]=await Promise.all([editor(),openHwpFromDrive(target,{rt})]);
    if(drive!==shown)return;
    if(file.bytes.length>HWP_EDIT_MAX_BYTES)throw Object.assign(new Error('30MB보다 큰 파일은 편집기에서 열지 않아요.'),{kind:'refused'});
    const result=await instance.loadFile(file.bytes,file.info.file_name,{skipUnsavedGuard:true});
    if(drive!==shown)return;
    const seq=await changeSeq(instance);
    Object.assign(shown,{info:file.info,name:file.info.file_name,savedSeq:seq,latestSeq:seq});
    watchEdits();
    const notes=[
      file.info.format==='hwpx'?'HWPX 원본은 새 HWP 파일로만 저장해요.':'',
      file.info.shared?'이 파일은 정리함과 자료실이 같은 원본을 써요.':'',
    ].filter(Boolean).join(' ');
    status(`${file.info.file_name} · ${result?.pageCount??'?'}쪽을 열었어요. ${notes?notes+' ':''}고친 뒤 [새 파일로 저장]을 누르세요.`,'ok');
  }catch(err){
    if(drive!==shown)return;
    console.error('hwp-lab drive open',err?.kind||err);
    status(err?.kind?err.message:'파일을 열지 못했어요. 아무것도 바뀌지 않았어요.','error');
  }finally{if(drive===shown){busy=false;sync()}}
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
  busy=true;sync();
  try{
    status('새 파일로 저장하는 중…');
    let made;
    try{made=await exportCurrent()}catch(err){status(err?.kind?err.message:'저장할 파일을 만들지 못했어요. 아무것도 바뀌지 않았어요.','error');return}
    const outcome=shown.target.kind==='library'?await saveLibraryCopy(shown.target,made.bytes,{rt}):await saveBasketCopy(shown.target,made.bytes,{rt});
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
