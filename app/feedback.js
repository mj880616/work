// FEEDBACK-의견보내기 PR5(사용자 11/15 18:13 '가' — 답장 없음): 계정 메뉴 맨 아래 '의견 보내기'(모든 이용자) 작은 창.
// 글(필수) + 사진·화면 캡처 1~3장(선택, 끌어 놓기 가능) + 자동 정보(지금 보던 화면 이름·폰/폴드/PC·앱/브라우저·판 번호 — 글 내용·화면 안 기록은 넣지 않음).
// 저장은 서버 app_feedback_send 하나(보낸 사람은 서버가 정함, 하루 상한·크기 상한). 보낸 뒤 '보냈어요, 고맙습니다' 한 줄. 기기 저장 없음.
// 의견 글을 다른 곳으로 보내기·공유·지우기와 자동으로 잇지 않는다(운영자가 요청함에 옮길 때는 사람이 직접).
import {openFormModal} from './small-form-modal.js';
import {notify} from './small-notice.js';
import {contextOf,contextLine,feedbackProblem,feedbackError,PHOTOS_MAX,PHOTO_BYTES_MAX} from './feedback-model.mjs';

const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node};

/** 사진을 긴 변 1600px JPEG로 줄여 1MB 안으로(안 되면 더 줄임). 돌려주는 값 {mime,data(base64),bytes,url}. */
async function shrink(file){
  const bitmap=await createImageBitmap(file);
  for(const [side,quality] of [[1600,.82],[1280,.7],[960,.6]]){
    const scale=Math.min(1,side/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
    if(blob&&blob.size<=PHOTO_BYTES_MAX){
      const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=reject;r.readAsDataURL(blob)});
      return {mime:'image/jpeg',data,bytes:blob.size,url:URL.createObjectURL(blob)};
    }
  }
  throw new Error('FEEDBACK_PHOTOS');
}

function screenName(){
  const view=window.KPTURouter?.current||'';
  return document.querySelector('[data-mobile-view-name]')?.textContent?.trim()||window.KPTUViewNames?.[view]||view||'';
}
function appVersion(){try{return new URL(window.__KPTU_APP_SCRIPT_URL__||'',location.href).searchParams.get('v')||''}catch{return ''}}

export function openFeedback(trigger){
  const ctx=contextOf({screen:screenName(),width:window.innerWidth,app:!!window.KPTUAppShell,version:appVersion()});
  const photos=[];
  let area,thumbs,pick,status;
  const paint=()=>{
    thumbs.replaceChildren(...photos.map((p,i)=>{const box=el('span','fb-thumb');const img=el('img');img.src=p.url;img.alt=`붙인 사진 ${i+1}`;const x=el('button','icon-btn fb-thumb-x','×');x.type='button';x.setAttribute('aria-label',`사진 ${i+1} 빼기`);x.onclick=()=>{URL.revokeObjectURL(p.url);photos.splice(i,1);paint()};box.append(img,x);return box}));
    pick.hidden=photos.length>=PHOTOS_MAX;
  };
  async function add(files){
    for(const file of [...files||[]].filter(f=>/^image\//.test(f.type))){
      if(photos.length>=PHOTOS_MAX){status.textContent=`사진은 ${PHOTOS_MAX}장까지예요`;break}
      try{photos.push(await shrink(file))}catch{status.textContent='이 사진은 붙일 수 없어요'}
    }
    paint();
  }
  const modal=openFormModal({id:'feedbackModal',title:'의견 보내기',okLabel:'보내기',trigger,className:'fb-modal',foot:'운영팀만 봐요',
    fill(body){
      area=el('textarea');area.setAttribute('aria-label','의견');area.placeholder='불편한 점·바라는 점을 적어 주세요';area.maxLength=2000;
      const drop=el('div','fb-drop');
      thumbs=el('div','fb-thumbs');
      pick=el('label','fb-pick mini');const input=el('input');input.type='file';input.accept='image/*';input.multiple=true;input.hidden=true;
      input.setAttribute('aria-label','사진·화면 캡처 붙이기');input.onchange=()=>{void add(input.files);input.value=''};
      pick.append(input,document.createTextNode('+ 사진·화면 캡처'));
      drop.append(thumbs,pick);
      for(const type of ['dragenter','dragover'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('is-over')});
      for(const type of ['dragleave','drop'])drop.addEventListener(type,()=>drop.classList.remove('is-over'));
      drop.addEventListener('drop',e=>{e.preventDefault();void add(e.dataTransfer?.files)});
      const auto=el('p','fb-auto',`함께 보내는 정보: ${contextLine(ctx)}`);
      body.append(area,drop,auto);
      return 'textarea';
    },
    async onSubmit(){
      const problem=feedbackProblem({body:area.value,photos});
      if(problem)return problem;
      try{
        await window.KPTURuntime.api('/rest/v1/rpc/app_feedback_send',{method:'POST',singleFlight:false,
          body:{p_body:area.value.trim(),p_context:ctx,p_photos:photos.map(p=>({mime:p.mime,data:p.data}))}});
      }catch(error){return feedbackError(error)}
      photos.forEach(p=>URL.revokeObjectURL(p.url));
      notify('보냈어요, 고맙습니다',{record:false});
      return true;
    }});
  status=modal.status;
  modal.modal.addEventListener('paste',event=>{const files=[...event.clipboardData?.files||[]];if(files.length){event.preventDefault();void add(files)}});
}
