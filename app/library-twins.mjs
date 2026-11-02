// LIB-정리보충 ⑤ 남은 일(빠짐10, 요청 2026-10-28 10:41 ⑤): 같은 글의 원본 두 개(웹 + PDF/HWP 등)를 자료실 목록에서 한 줄로 묶는 순수 규칙.
// 화면에서만 묶는다. 실제 자료 행(app_documents)은 그대로 두고 지우거나 합치지 않는다(DOM·네트워크 없음, 단위 시험 대상).
// 묶는 조건: 같은 토글(폴더·묶음) 안에서 제목(없으면 확장자 뺀 파일 이름)이 같고, 자료 날짜가 같고(둘 다 없으면 같다고 봄),
//           웹 원본(.html 등)이 하나 이상 + 웹이 아닌 원본(PDF·HWP 등)이 하나 이상. 사진 묶음 줄은 묶지 않는다.
// 대표 줄 = 토글 차례에서 처음 나오는 웹이 아닌 원본. 나머지는 '같은 글' 줄로 대표 줄 아래 접힌다(펼치면 모두 보임).

const WEB=/\.(html?|mhtml?)$/i;
const EXT=/\.[A-Za-z0-9]{1,6}$/;
export const isWebOriginal=d=>WEB.test(String(d?.file_name||''))||/^text\/html\b/i.test(String(d?.mime_type||''));
const base=v=>String(v||'').replace(EXT,'');
// 같은 글인지 보는 열쇠(대소문자·띄어쓰기 차이는 무시).
export function twinKey(d){
  const name=base(String(d?.title||'').trim())||base(d?.file_name);
  const clean=name.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
  return clean?clean+'\u0000'+String(d?.document_date||''):'';
}

// files: 한 토글 안 자료 차례. 반환 Map(대표 자료 id → 같은 글 자료 목록[대표 먼저, 나머지는 토글 차례]). 두 개 이상만 담는다.
export function findTwins(files){
  const groups=new Map();
  for(const d of Array.isArray(files)?files:[]){
    if(!d?.id||d.photoset)continue;
    const key=twinKey(d);if(!key)continue;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(d);
  }
  const out=new Map();
  for(const list of groups.values()){
    if(list.length<2)continue;
    const web=list.filter(isWebOriginal);
    if(!web.length||web.length===list.length)continue;
    const primary=list.find(d=>!isWebOriginal(d));
    out.set(primary.id,[primary,...list.filter(d=>d!==primary)]);
  }
  return out;
}

// 여러 토글을 한 번에: Map(자료 id → {primary, members, isPrimary}). 대표가 아닌 자료는 접힌 같은 글 줄.
export function twinPlan(nodes){
  const plan=new Map();
  const walk=list=>{for(const n of list||[]){for(const [pid,members] of findTwins(n.files))for(const d of members)plan.set(d.id,{primary:pid,members:members.map(x=>x.id),isPrimary:d.id===pid});walk(n.children)}};
  walk(nodes);
  return plan;
}

// 고르기: 접힌 대표 줄을 고르면 그 안의 같은 글 자료도 함께(한 줄로 보이므로). 펼친 묶음은 줄마다 따로.
export function withTwins(ids,plan,isOpen=()=>false){
  const out=[];
  for(const id of ids||[]){
    const t=plan?.get(id);
    if(t&&t.isPrimary&&!isOpen(t.primary)){for(const m of t.members)if(!out.includes(m))out.push(m)}
    else if(!out.includes(id))out.push(id);
  }
  return out;
}

// 고른 개수 글자. hidden = 고른 것 중 지금 목록에 줄로 보이지 않는 것(접힌 토글·'n건 더'·접힌 같은 글).
export function pickCountText(total,hidden){
  return hidden>0?`${total}개 골랐음 — 접힌 ${hidden}개 포함`:`${total}개 골랐음`;
}
