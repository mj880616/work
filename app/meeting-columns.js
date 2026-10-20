// UI-PC회의(2026-10-20 사용자 확정) → MEET-결과정리 ⑤(2026-10-20 시안 C 승인): PC(≥1024) 회의 결과는
// 왼쪽 회의 종류 목록(색 점·이름·건수) + 오른쪽 고른 종류의 차수 목록(화면 아래 끝까지 세로로, 가로 넘기기·더 보기 없음).
// 그리는 주인은 team.js의 renderMeetings 하나다. 이 파일은 묶기·정렬·색 배정·차수 글자(순수 함수)와 배치 HTML만 맡는다.
// 폰·중간 폭은 이 파일의 배치를 쓰지 않고 지금 한 줄 목록 그대로 그린다(색·차수 글자는 함께 쓴다).
export const PC_QUERY='(min-width:1024px)';
export const NONE_KEY='__none__';
// UI-회의자료표시(2026-10-20): 회의에 붙은 자료가 있으면 개수 없이 이 문구만 보인다(PC 차수 카드·폰 목록 공통). 없으면 표시 없음.
export const MEETING_DOCS_LABEL='회의자료 있음';

const time=m=>{const t=new Date(m?.meeting_at).getTime();return Number.isFinite(t)?t:-Infinity};
const round=m=>{const n=Number(m?.round_no);return Number.isFinite(n)?n:-Infinity};
const byRecent=(a,b)=>time(b)-time(a)||round(b)-round(a);

// 회의 유형별로 묶는다. 종류 순서 = 가장 최근 결과가 있는 순, 종류 안 = 최신 위. 결과가 없는 유형은 생기지 않는다.
export function meetingColumns(meetings,{nameOf,keyOf}){
  const groups=new Map();
  for(const m of meetings||[]){
    const name=String(nameOf(m)||'').trim(),key=name?keyOf(name):NONE_KEY;
    if(!groups.has(key))groups.set(key,{key,name,meetings:[]});
    groups.get(key).meetings.push(m);
  }
  const columns=[...groups.values()];
  // 종류 이름은 가장 최근 결과의 이름(만들기 창의 회의명 고르기 목록과 같은 기준).
  for(const c of columns){c.meetings.sort(byRecent);if(c.key!==NONE_KEY)c.name=String(nameOf(c.meetings[0])||'').trim()}
  return columns.sort((a,b)=>byRecent(a.meetings[0],b.meetings[0])||String(a.name).localeCompare(String(b.name),'ko'));
}

// MEET-결과정리 ②: 회의 종류 색. 예전에는 이름 해시 % 8색이라 서로 다른 두 종류가 같은 색이 될 수 있었다.
// 이제 종류마다 칸을 하나씩 나눠 준다: 색 칸은 theme-tokens.css의 --ds-meeting-1~16(8가지 색 × 진하기 2단, 밝은·어두운 화면 각각
// 바탕 대비 3:1 이상). 처음 결과가 있는 순(오래된 종류 먼저 — 새 종류가 생겨도 기존 종류 색이 덜 바뀜)으로 이름 해시가 가리키는
// 1단 칸을 먼저 쓰고, 이미 쓰였으면 1단의 다음 빈 칸, 1단이 다 차면 2단(명도 변형). 16종류를 넘으면 그때부터만 다시 돈다.
export const MEETING_HUES=8,MEETING_PALETTE=16;
export const meetingPaletteColor=index=>`var(--ds-meeting-${(((index%MEETING_PALETTE)+MEETING_PALETTE)%MEETING_PALETTE)+1})`;
export function nameHash(key){let hash=0;for(const char of String(key))hash=(Math.imul(hash,31)+char.codePointAt(0))>>>0;return hash}
export function assignMeetingColors(meetings,{nameOf,keyOf}){
  const first=new Map();
  for(const m of meetings||[]){
    const name=String(nameOf(m)||'').trim();if(!name)continue;
    const key=keyOf(name),t=time(m),prev=first.get(key);
    if(!prev||t<prev.t)first.set(key,{key,name,t});
  }
  const kinds=[...first.values()].sort((a,b)=>a.t-b.t||String(a.name).localeCompare(String(b.name),'ko')||(a.key<b.key?-1:a.key>b.key?1:0));
  const used=new Set(),out=new Map();
  kinds.forEach((k,n)=>{
    const start=nameHash(k.key)%MEETING_HUES;let slot=-1;
    for(let tier=0;tier<MEETING_PALETTE/MEETING_HUES&&slot<0;tier++)for(let i=0;i<MEETING_HUES;i++){const s=tier*MEETING_HUES+(start+i)%MEETING_HUES;if(!used.has(s)){slot=s;break}}
    if(slot<0)slot=n%MEETING_PALETTE;
    used.add(slot);out.set(k.key,slot);
  });
  return out;
}

// MEET-결과정리 ③: 차수 대신 짧은 이름. 정식 차수가 없는 파생회의는 회의 결과의 제목(title)을 짧은 이름으로 쓴다.
// 회의 종류 이름은 series_name, 이 회의만의 이름은 title(기존 칸 그대로, 새 DB 칸 없음). 둘이 같으면 짧은 이름 없음.
export function meetingShortName(m){const series=String(m?.series_name||'').trim(),title=String(m?.title||'').trim();return series&&title&&title!==series?title:''}
export function hasRound(m){return m?.round_no!=null&&m.round_no!==''&&Number.isFinite(Number(m.round_no))}
// 카드·목록의 차수 자리 글자: N차 → (차수 없으면) 짧은 이름 → 차수 없음.
export function roundLabel(m){return hasRound(m)?`${Number(m.round_no)}차`:meetingShortName(m)||'차수 없음'}

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// PC 배치 HTML. 차수 카드는 지금 목록 줄과 같은 data-mrd-meeting(누르면 그 회의 결과 창)을 쓴다.
// [+ 회의 결과]는 화면 위 공용 버튼 하나(#newMeetingBtn)이고, PC에서는 왼쪽에서 고른 종류를 미리 고른 채 연다(④).
export function columnsHtml(columns,{selectedKey,colorOf,whenOf,docsOf}){
  if(!columns.length)return '<div class="empty">회의 결과가 없습니다.</div>';
  const selected=columns.find(c=>c.key===selectedKey)||columns[0];
  const kinds=columns.map(c=>{
    const label=c.name||'회의명 미지정',on=c===selected;
    return `<li><button type="button" class="mcol-kind" data-meeting-kind="${esc(c.key)}" aria-controls="mcolDetail"${on?' aria-current="true"':''} style="--meeting-color:${esc(colorOf(c.name))}"><span class="mcol-dot" aria-hidden="true"></span><span class="mcol-name">${esc(label)}</span><span class="mcol-count" aria-label="${c.meetings.length}건">${c.meetings.length}</span></button></li>`;
  }).join('');
  const label=selected.name||'회의명 미지정';
  const cards=selected.meetings.map(m=>{
    const roundText=roundLabel(m),when=whenOf(m),docs=docsOf(m);
    const aria=[label,roundText,when,docs?MEETING_DOCS_LABEL:''].filter(Boolean).join(' · ');
    return `<li><article class="mcol-card" data-mrd-meeting="${esc(m.id)}" role="button" tabindex="0" aria-label="${esc(aria)}"><b class="mcol-round">${esc(roundText)}</b><span class="mcol-meta"><span class="mcol-when">${esc(when)}</span>${docs?`<span class="mcol-docs">${MEETING_DOCS_LABEL}</span>`:''}</span></article></li>`;
  }).join('');
  return `<div class="mcol-layout">`
    +`<nav class="mcol-kinds" aria-label="회의 종류"><ul>${kinds}</ul></nav>`
    +`<section id="mcolDetail" class="mcol-detail" data-meeting-column="${esc(selected.key)}" style="--meeting-color:${esc(colorOf(selected.name))}" aria-labelledby="mcolDetailHead">`
    +`<h3 class="mcol-head" id="mcolDetailHead"><span class="mcol-dot" aria-hidden="true"></span><span class="mcol-name">${esc(label)}</span><span class="mcol-count" aria-label="${selected.meetings.length}건">${selected.meetings.length}</span></h3>`
    +`<ol class="mcol-cards">${cards}</ol>`
    +`</section></div>`;
}
