// HWP-편집기 1단계 시험판(?view=hwp-lab). 메뉴에 없고 주소로만 연다.
// 고른 HWP/HWPX 파일은 이 기기 브라우저 안의 rhwp 편집기(같은 origin, 고정 버전)에서만 열고 고친다.
// 서버·Drive·외부로 보내지 않으며, 저장은 [내 기기에 저장(다운로드)] 하나뿐이다.
(()=>{
'use strict';
if(window.__KPTU_HWP_LAB_READY__)return;
const RHWP='./hwp-lab/rhwp-0.8.7/';
const MAX_BYTES=30*1024*1024;
const FORMATS={hwp:{magic:[0xd0,0xcf,0x11,0xe0],mime:'application/x-hwp'},hwpx:{magic:[0x50,0x4b,0x03,0x04],mime:'application/hwp+zip'}};
const $=id=>document.getElementById(id);
let editorFlight=null,current=null,busy=false;

function status(text,state='info'){
  const box=$('hwpLabStatus');
  if(!box)return;
  box.textContent=text;
  box.dataset.state=state;
}
function sync(){
  const save=$('hwpLabSave'),pick=$('hwpLabPick');
  if(save)save.disabled=busy||!current;
  if(pick)pick.disabled=busy;
}
function formatOf(name,bytes){
  const ext=String(name||'').toLowerCase().match(/\.(hwpx?)$/)?.[1];
  const format=ext&&FORMATS[ext];
  if(!format)return null;
  return format.magic.every((byte,index)=>bytes[index]===byte)?ext:null;
}
function editedName(name,format){
  const base=String(name||'문서').replace(/\.(hwpx?)$/i,'')||'문서';
  return `${base}-수정.${format}`;
}

function editor(){
  if(editorFlight)return editorFlight;
  const host=$('hwpLabEditor');
  status('편집기를 불러오는 중입니다… 처음에는 시간이 걸릴 수 있습니다.');
  editorFlight=import(RHWP+'sdk/index.js')
    .then(({createEditor})=>createEditor(host,{studioUrl:new URL(RHWP+'studio/index.html',import.meta.url).href,handshakeTimeoutMs:10000}))
    .then(instance=>{status('편집기가 준비됐습니다. [파일 선택]으로 HWP·HWPX 파일을 여세요.');return instance})
    .catch(err=>{
      editorFlight=null;
      host?.replaceChildren();
      console.error('hwp-lab editor',err);
      status('편집기를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 들어와 주세요.','error');
      throw err;
    });
  return editorFlight;
}

async function open(file){
  if(!file||busy)return;
  if(file.size>MAX_BYTES){status('30MB보다 큰 파일은 시험판에서 열지 않습니다.','error');return}
  busy=true;sync();
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());
    const format=formatOf(file.name,bytes);
    if(!format){status('HWP(.hwp) 또는 HWPX(.hwpx) 파일만 열 수 있습니다.','error');return}
    status(`${file.name} 여는 중…`);
    const instance=await editor();
    const result=await instance.loadFile(bytes,file.name,{skipUnsavedGuard:true});
    current={name:file.name,format};
    status(`${file.name} · ${result?.pageCount??'?'}쪽을 열었습니다. 고친 뒤 [내 기기에 저장(다운로드)]을 누르세요.`,'ok');
  }catch(err){
    console.error('hwp-lab open',err);
    status('파일을 열지 못했습니다. 다른 파일로 시도해 주세요.','error');
  }finally{busy=false;sync()}
}

async function save(){
  if(!current||busy)return;
  busy=true;sync();
  try{
    const instance=await editor();
    const bytes=current.format==='hwpx'?await instance.exportHwpx():await instance.exportHwp();
    const name=editedName(current.name,current.format);
    const url=URL.createObjectURL(new Blob([bytes],{type:FORMATS[current.format].mime}));
    const link=document.createElement('a');
    link.href=url;link.download=name;link.hidden=true;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    status(`${name}(${Math.max(1,Math.round(bytes.length/1024))}KB)을 내려받았습니다. 원본과 비교해 보세요.`,'ok');
  }catch(err){
    console.error('hwp-lab save',err);
    status('파일을 만들지 못했습니다. 다시 시도해 주세요.','error');
  }finally{busy=false;sync()}
}

function start(){
  const input=$('hwpLabFile');
  if(!input)return;
  if(!input.dataset.bound){
    input.dataset.bound='1';
    $('hwpLabPick')?.addEventListener('click',()=>input.click());
    input.addEventListener('change',()=>{const file=input.files?.[0];input.value='';void open(file)});
    $('hwpLabSave')?.addEventListener('click',()=>void save());
    sync();
  }
  // A failed editor load is retried on the next entry to this view.
  editor().catch(()=>{});
}

window.KPTURouter?.on?.('hwp-lab',start);
start();
window.__KPTU_HWP_LAB_READY__=Promise.resolve(true);
})();
