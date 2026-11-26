// S69-16 LIB-정돈본보기(사용자 11/24 08:26 '내가 손으로 다 나눠 둘 테니 이걸 배워서 앞으로 이렇게 정돈'): 순수 계산(node --test).
// 정돈 제안·폴더로 나누기가 미리 정한 낱말 규칙보다 먼저, 그 사람이 이미 폴더에 넣어 둔 자료를 본보기로 삼아 가장 닮은 폴더를 고른다.
// - 재료: 자기 작업공간 자료 목록(화면이 이미 주인 권한으로 읽어 둔 것)의 제목·분류와, 그 자료가 든 폴더 경로(맨 위 › … › 그 폴더) 이름뿐.
//   서버·AI에 보내지 않는다(비용 없음). 낱말 목록을 코드에 두지 않는다 — 특징은 모두 제목·폴더 이름에서 뽑는다.
// - 특징: 날짜 꼴·회차 숫자('3차'·'제5회'·'2026.11.05')를 뺀 낱말과, 한글 낱말의 두 글자 조각(붙여 쓴 이름 '가나다라마바' 안 '가나'·'나다' …).
//   여러 폴더에 고루 나오는 흔한 특징은 가볍게, 드문 특징은 무겁게 센다(드묾 가중치).
// - 손으로 옮긴 것: 본보기는 '지금 폴더에 든 자리'라서 사람이 자료를 A→B로 옮기면 다음 계산부터 B의 본보기가 된다.
//   반대로 정돈 제안·나누기가 옮겨 놓고 사람이 아직 손대지 않은 자료(옮긴 기록 app_library_move_log에 '옮긴 폴더'로 남은 것)는
//   사람이 고른 자리가 아니므로 가볍게 센다(AUTO_WEIGHT) — 잘못 옮겨진 자료가 다음 제안을 끌고 가지 않게.
// - 판정: 가장 닮은 폴더 점수가 LEARN_MIN 아래면 'none'(그대로 — 옮기지 않음), 둘째 폴더가 LEARN_CLOSE 배 이상 가까우면 'pick'(고르기 — 상위 폴더로 뭉뚱그리지 않음),
//   아니면 'move'. why는 그 폴더에서 가장 닮은 자료 이름 2~3개.

export const LEARN_MIN=0.28;     // 이 아래는 닮음이 약함 → 그대로
export const LEARN_CLOSE=0.75;   // 둘째/첫째가 이 위면 비슷한 폴더 여럿 → 고르기
export const AUTO_WEIGHT=0.35;   // 정돈·나누기가 옮겨 두고 사람이 손대지 않은 자료의 본보기 무게
const PATH_WEIGHT=0.8;           // 폴더 경로 이름 특징의 무게(자료 제목 특징은 1)
const WHY_MAX=3;

const STOP=new Set(['자료','파일','문서','사본','복사본','최종','수정','수정본','첨부','붙임','초안','new','copy','file','final','ver','the','and']);
const EXT=/\.[a-z0-9]{2,5}$/i;
const DATES=[
  /\d{2,4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?/g, // 2026.11.05 · 26-11-05 · 2026년 11월 5일
  /\d{1,2}\s*월\s*\d{1,2}\s*일/g,                             // 11월 5일
  /\b\d{1,2}[./]\d{1,2}\b/g,                                   // 11.05 · 11/5
  /(?:제\s*)?\d+\s*(?:회차|주차|분기|번째|차|회|기|호|번|년|월|일|부|편|탄|쪽)?/g, // 3차 · 제5회 · 2026 · 1105
];
const HANGUL=/^[가-힣]+$/;

// 제목(또는 폴더 이름) → 특징 목록(겹침 없음). 'w:낱말'과 한글 두 글자 조각 'b:가나'.
export function featuresOf(text){
  let t=String(text||'').toLowerCase().replace(EXT,' ');
  for(const re of DATES)t=t.replace(re,' ');
  const out=new Set();
  for(const raw of t.split(/[^0-9a-z가-힣]+/)){
    const w=raw.trim();if(!w||/^\d+$/.test(w)||STOP.has(w))continue;
    const chars=[...w];if(chars.length<2)continue;
    out.add('w:'+w);
    if(HANGUL.test(w))for(let i=0;i+1<chars.length;i++){const b=chars[i]+chars[i+1];if(!STOP.has(b))out.add('b:'+b)}
  }
  return [...out];
}

// 폴더 id → 맨 위부터 그 폴더까지 이름들(100단 안, 순환 방지).
export function folderPath(folders,id){
  const byId=new Map((Array.isArray(folders)?folders:[]).map(f=>[f?.id,f])),out=[];
  let f=byId.get(id),n=0;while(f&&n++<101){out.unshift(String(f.name||''));f=f.parent_id?byId.get(f.parent_id):null}
  return out;
}

// 본보기 만들기. examples: [{key, title, folder, category?, auto?}] — folder는 지금 든 폴더 id, auto=정돈·나누기가 옮기고 사람이 손대지 않음.
// targets: 고를 수 있는 폴더 id 목록(받는 폴더·녹음 폴더 등은 부르는 쪽이 뺀다). 자료가 없는 폴더도 경로 이름으로 한 줄 본보기를 갖는다.
export function learnModel(examples,folders,{targets=null}={}){
  const fs=Array.isArray(folders)?folders:[],ok=new Set(targets||fs.map(f=>f?.id).filter(Boolean));
  const pathFeat=new Map();
  const featOfFolder=id=>{if(!pathFeat.has(id))pathFeat.set(id,[...new Set(folderPath(fs,id).flatMap(featuresOf))]);return pathFeat.get(id)};
  const rows=[];
  for(const e of Array.isArray(examples)?examples:[]){
    if(!e?.folder||!ok.has(e.folder))continue;
    const own=new Map();
    for(const f of featuresOf(e.title))own.set(f,1);
    if(e.category)own.set('c:'+String(e.category).toLowerCase(),0.6);
    for(const f of featOfFolder(e.folder))if(!own.has(f))own.set(f,PATH_WEIGHT);
    if(own.size)rows.push({key:e.key,title:String(e.title||''),folder:e.folder,weight:e.auto?AUTO_WEIGHT:1,raw:own});
  }
  for(const id of ok){const p=featOfFolder(id);if(p.length)rows.push({key:null,title:'',folder:id,weight:0.7,raw:new Map(p.map(f=>[f,PATH_WEIGHT]))})}
  const df=new Map();for(const r of rows)for(const f of r.raw.keys())df.set(f,(df.get(f)||0)+1);
  const N=rows.length,idf=f=>Math.log(1+N/(df.get(f)||0.5));
  // 특징 → 그 특징이 든 본보기 줄(자료가 많아도 닮은 줄만 훑게).
  const index=new Map();
  for(const r of rows){r.vec=new Map();let s=0;for(const [f,w] of r.raw){const v=w*idf(f);r.vec.set(f,v);s+=v*v;if(!index.has(f))index.set(f,[]);index.get(f).push(r)}r.norm=Math.sqrt(s)||1}
  return {rows,idf,N,folders:fs,index};
}

// 자료 하나 → 판정. unit: {key, title, category?}. exclude: 본보기에서 뺄 자료 key(자기 자신 등).
// 반환 {state:'move'|'pick'|'none', folder|null, alt:[폴더 id](pick일 때 비슷한 폴더들), why:[닮은 자료 이름], score}
// veto(폴더 id)가 참이면 그 폴더는 후보에서 뺀다(부르는 쪽의 막이).
export function nearestFolder(model,unit,{exclude=null,skip=null,veto=null}={}){
  const none={state:'none',folder:null,alt:[],why:[],score:0};
  if(!model?.rows?.length||!unit)return none;
  const q=new Map();
  for(const f of featuresOf(unit.title))q.set(f,model.idf(f));
  if(unit.category){const f='c:'+String(unit.category).toLowerCase();q.set(f,0.6*model.idf(f))}
  // 본보기에 없는 낱말도 무게에 넣는다(낯선 낱말이 많은 자료는 덜 닮음) — 단, 한 번 나온 특징만큼만.
  let qs=0;for(const v of q.values())qs+=v*v;const qn=Math.sqrt(qs)||1;
  const dots=new Map();
  for(const [f,v] of q)for(const r of model.index?.get(f)||[])dots.set(r,(dots.get(r)||0)+v*r.vec.get(f));
  const by=new Map(),vetoed=new Map();
  for(const [r,dot] of dots){
    if(r.key&&exclude&&(exclude===r.key||exclude.has?.(r.key)))continue;
    if(skip&&skip.has?.(r.folder))continue;
    if(veto){if(!vetoed.has(r.folder))vetoed.set(r.folder,!!veto(r.folder));if(vetoed.get(r.folder))continue}
    const sim=dot/(qn*r.norm)*r.weight;
    if(!by.has(r.folder))by.set(r.folder,[]);
    by.get(r.folder).push({sim,title:r.title,key:r.key});
  }
  if(!by.size)return none;
  // 폴더 점수: 가장 닮은 자료 + 둘째의 일부(자료 하나만 우연히 닮은 폴더보다 여럿이 닮은 폴더를 조금 더).
  const scored=[...by].map(([folder,list])=>{list.sort((a,b)=>b.sim-a.sim);return {folder,score:list[0].sim+0.25*(list[1]?.sim||0),list}}).sort((a,b)=>b.score-a.score);
  const best=scored[0],second=scored[1];
  const ranks=scored.slice(0,3).map(x=>({folder:x.folder,score:x.score}));
  const why=best.list.filter(x=>x.key&&x.title&&x.sim>0).slice(0,WHY_MAX).map(x=>x.title);
  if(best.score<LEARN_MIN)return {...none,score:best.score,ranks};
  if(second&&second.score>=best.score*LEARN_CLOSE)return {state:'pick',folder:null,alt:scored.filter(x=>x.score>=best.score*LEARN_CLOSE).slice(0,3).map(x=>x.folder),why,score:best.score,ranks};
  return {state:'move',folder:best.folder,alt:[],why,score:best.score,ranks};
}

// 화면 글. '닮은 자료: 가 · 나'
export const learnWhy=titles=>titles?.length?'닮은 자료: '+titles.map(t=>String(t).slice(0,30)).join(' · '):'폴더 이름과 닮았어요';
export const pickWhy=(alt,nameOf)=>'비슷한 폴더 여럿('+alt.map(nameOf).join(' · ')+') — 직접 선택';
