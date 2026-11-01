// UI-앱안알림 1단계(docs/design/in-app-notices.md 7절): 화면 맨 위 알림 줄의 자리 주인 하나.
// 손님(업데이트 안내 version-notice.js 등)은 자기 줄(.kptu-notice-line)을 만들어 putNotice로 맡기고, 상태가 풀리면 removeNotice로 뺀다.
// 자리 주인은 #noticeBar 하나만 화면 맨 위에 두고, 급한 순서(priority 작은 것)대로 한 번에 한 줄만 보인다.
// 줄이 떠 있는 동안 body에 kptu-notice-bar-open과 --kptu-notice-bar-height(실제 높이)를 두어
// 본문·폰 머리줄·PC 메뉴·작은 알림 자리가 그만큼 비켜선다(notice-bar.css·base-ui.css). 자리·높이 처리는 여기 한 곳만 한다.
const guests=new Map();
let bar=null,observer=null,order=0;

function layout(){
  document.body.style.setProperty('--kptu-notice-bar-height',`${bar?.getBoundingClientRect().height||0}px`);
}
function render(){
  const list=[...guests.values()].sort((a,b)=>a.priority-b.priority||a.order-b.order);
  if(!list.length){
    if(bar){observer?.unobserve(bar);bar.remove();bar=null}
    document.body.classList.remove('kptu-notice-bar-open');
    document.body.style.removeProperty('--kptu-notice-bar-height');
    return;
  }
  if(!bar){
    bar=document.createElement('div');bar.id='noticeBar';
    document.body.prepend(bar);
    observer??=new ResizeObserver(layout);observer.observe(bar);
    document.body.classList.add('kptu-notice-bar-open');
  }
  const top=list[0].element;
  for(const guest of list){
    if(guest.element.parentNode!==bar)bar.append(guest.element);
    guest.element.hidden=guest.element!==top;
  }
  layout();
}
// key: 손님 이름(같은 이름이면 바꿔 끼움). priority: 작을수록 급함(4절 표 순서). element: 손님이 만든 줄.
export function putNotice(key,{priority=50,element}){
  if(!key||!element)return;
  const old=guests.get(key);
  if(old&&old.element!==element)old.element.remove();
  guests.set(key,{priority,element,order:old?.order??++order});
  render();
}
export function removeNotice(key){
  const guest=guests.get(key);
  if(!guest)return;
  guests.delete(key);guest.element.remove();
  render();
}
// 모듈이 아닌 화면 조각·시험에서도 같은 자리 주인을 쓰게 한 이름으로 둔다(배포 빌드는 모듈 주소에 해시를 붙이므로 import 대신 이 이름).
window.KPTUNoticeBar={put:putNotice,remove:removeNotice};
