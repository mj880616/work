// FEEDBACK-의견보내기 PR5: 운영자 전용 '받은 의견' 화면(?view=feedback). #feedbackView의 유일한 그리기 주인.
// 입구는 운영자 계정 메뉴의 '받은 의견 n'(서버 허용 표 dev_inbox일 때만 줄을 그림). 읽기·처리함은 서버 app_feedback_*가 운영자만 받는다(아니면 42501).
// 보낸 사람 이름·시각·화면·기기·글·사진(누를 때 서버에서 읽음), [처리함] 표시, 거르기 처리 전/처리함/전체. 기기 저장 없음. 글자는 textContent로만.
// 의견 글을 요청함·발송·공유와 자동으로 잇지 않는다(옮길 때는 사람이 직접).
import {waitHtml,failHtml,emptyHtml} from './wait-state.js';
import {DEVICE_LABEL,CLIENT_LABEL} from './feedback-model.mjs';
import {notify} from './small-notice.js';

const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node};
const rpc=(name,body={})=>window.KPTURuntime.api('/rest/v1/rpc/'+name,{method:'POST',body,singleFlight:false});
const FILTERS=[['open','처리 전'],['done','처리함'],['all','전체']];
let state='open',drawing=null;
const when=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})};

function row(item){
  const box=el('article','fb-item');box.dataset.fbId=item.id;if(item.done_at)box.classList.add('is-done');
  const head=el('div','fb-head');
  head.append(el('b','fb-name',item.name),el('span','fb-meta',[when(item.created_at),item.screen,DEVICE_LABEL[item.device],CLIENT_LABEL[item.client],item.version?`판 ${item.version}`:''].filter(Boolean).join(' · ')));
  const done=el('button','mini fb-done',item.done_at?'처리 전으로':'처리함');done.type='button';done.dataset.fbDone=item.done_at?'0':'1';
  head.append(done);
  box.append(head,el('p','fb-body',item.body));
  if(item.photos){
    const photos=el('div','fb-photos');
    for(let i=0;i<item.photos;i++){const b=el('button','mini fb-photo',`사진 ${i+1}`);b.type='button';b.dataset.fbPhoto=String(i);photos.append(b)}
    box.append(photos);
  }
  return box;
}

function install(){
  if(document.getElementById('feedbackView'))return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend','<section id="feedbackView" class="view-panel hidden" aria-label="받은 의견"><div class="panel fb-view"><div class="fb-filters" role="group" aria-label="거르기"></div><div data-fb-root></div></div></section>');
  const filters=document.querySelector('#feedbackView .fb-filters');
  for(const [key,label] of FILTERS){const b=el('button','mini fb-filter',label);b.type='button';b.dataset.fbFilter=key;b.setAttribute('aria-pressed',String(key===state));filters.append(b)}
}

function draw(){
  const root=document.querySelector('#feedbackView [data-fb-root]');
  if(!root)return Promise.resolve();
  if(drawing)return drawing;
  root.innerHTML=waitHtml();
  drawing=rpc('app_feedback_list',{p_state:state}).then(items=>{
    if(!Array.isArray(items)){root.innerHTML=failHtml({retry:'data-fb-retry'});return}
    if(!items.length){root.innerHTML=emptyHtml(state==='open'?'처리 전 의견이 없어요':'없음');return}
    const list=el('div','fb-list');for(const item of items)list.append(row(item));
    root.replaceChildren(list);
  }).catch(error=>{root.innerHTML=/42501|OPERATOR_FEATURE_REQUIRED/.test(String(error?.message||error))?emptyHtml('운영자만 볼 수 있어요'):failHtml({retry:'data-fb-retry'})})
    .finally(()=>{drawing=null;window.dispatchEvent(new CustomEvent('kptu:feedback-changed'))});
  return drawing;
}

async function onClick(event){
  if(event.target.closest('[data-fb-retry]')){void draw();return}
  const filter=event.target.closest('[data-fb-filter]');
  if(filter){state=filter.dataset.fbFilter;document.querySelectorAll('#feedbackView [data-fb-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===filter)));void draw();return}
  const item=event.target.closest('[data-fb-id]');if(!item)return;
  const done=event.target.closest('[data-fb-done]');
  if(done){
    done.disabled=true;
    try{await rpc('app_feedback_done',{p_id:item.dataset.fbId,p_done:done.dataset.fbDone==='1'});notify(done.dataset.fbDone==='1'?'처리함으로 표시했어요':'처리 전으로 돌렸어요',{record:false});void draw()}
    catch{done.disabled=false;notify('바꾸지 못했어요. 잠시 뒤 다시 해 주세요',{record:false,error:true})}
    return;
  }
  const photo=event.target.closest('[data-fb-photo]');
  if(photo&&!photo.dataset.loaded){
    photo.dataset.loaded='1';
    try{
      const p=await rpc('app_feedback_photo',{p_id:item.dataset.fbId,p_idx:Number(photo.dataset.fbPhoto)});
      if(!p?.data||!/^image\/(jpeg|png|webp)$/.test(p.mime))throw new Error('photo');
      const img=el('img','fb-img');img.alt=photo.textContent;img.src=`data:${p.mime};base64,${p.data}`;photo.replaceWith(img);
    }catch{delete photo.dataset.loaded;notify('사진을 읽지 못했어요',{record:false,error:true})}
  }
}

install();
document.querySelector('#feedbackView')?.addEventListener('click',event=>{void onClick(event)});
window.KPTURouter?.on?.('feedback',()=>draw());
void draw();
