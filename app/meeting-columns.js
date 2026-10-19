// UI-PC회의(2026-10-20 사용자 확정): PC(≥1024) 회의 결과를 회의 유형별 열로 보여 주는 조각.
// 그리는 주인은 team.js의 renderMeetings 하나다. 이 파일은 묶기·정렬(순수 함수), 열 HTML, "보일 열" 기억만 맡는다.
// 폰·중간 폭은 이 파일을 쓰지 않고 지금 한 줄 목록 그대로 그린다.
export const PC_QUERY='(min-width:1024px)';
export const COLUMN_RECENT=4;
export const NONE_KEY='__none__';

const time=m=>{const t=new Date(m?.meeting_at).getTime();return Number.isFinite(t)?t:-Infinity};
const round=m=>{const n=Number(m?.round_no);return Number.isFinite(n)?n:-Infinity};
const byRecent=(a,b)=>time(b)-time(a)||round(b)-round(a);

// 회의 유형별로 묶는다. 열 순서 = 가장 최근 결과가 있는 순, 열 안 = 최신 위. 결과가 없는 유형은 열이 생기지 않는다.
export function meetingColumns(meetings,{nameOf,keyOf}){
  const groups=new Map();
  for(const m of meetings||[]){
    const name=String(nameOf(m)||'').trim(),key=name?keyOf(name):NONE_KEY;
    if(!groups.has(key))groups.set(key,{key,name,meetings:[]});
    groups.get(key).meetings.push(m);
  }
  const columns=[...groups.values()];
  // 열 이름은 가장 최근 결과의 이름(만들기 창의 회의명 고르기 목록과 같은 기준).
  for(const c of columns){c.meetings.sort(byRecent);if(c.key!==NONE_KEY)c.name=String(nameOf(c.meetings[0])||'').trim()}
  return columns.sort((a,b)=>byRecent(a.meetings[0],b.meetings[0])||String(a.name).localeCompare(String(b.name),'ko'));
}

// 기기에 남기는 것은 회의명이 아니라 짧은 해시뿐이다(사용자 글을 브라우저 저장소에 두지 않음).
export function columnHash(key){let h=0x811c9dc5;for(const ch of String(key)){h^=ch.codePointAt(0);h=Math.imul(h,0x01000193)>>>0}return h.toString(36)}

// "보일 열 고르기": 숨긴 열만 이 기기 브라우저에 기억한다. 계정별 칸(kptu_owner_cache:)이라 로그아웃·계정 변경 때 함께 지워진다.
// 저장소가 막혀 있으면(사생활 창 등) 기억 없이 전부 보인다. DB 변경 없음.
const mcStoreKey=owner=>owner?'kptu_owner_cache:meeting-columns-v1:'+owner:'';
export function readHiddenColumns(owner){
  const key=mcStoreKey(owner);if(!key)return new Set();
  try{const v=JSON.parse(localStorage.getItem(mcStoreKey(owner))||'null');return new Set(Array.isArray(v?.hidden)?v.hidden.filter(x=>typeof x==='string'):[])}catch{return new Set()}
}
export function writeHiddenColumns(owner,hidden){
  const key=mcStoreKey(owner);if(!key)return;
  try{if(hidden.size)localStorage.setItem(mcStoreKey(owner),JSON.stringify({hidden:[...hidden]}));else localStorage.removeItem(mcStoreKey(owner))}catch{}
}

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// 열 HTML. 카드는 지금 목록 줄과 같은 data-mrd-meeting(누르면 그 회의 결과 창)을 쓴다.
export function columnsHtml(columns,{hidden=new Set(),expanded=new Set(),colorOf,whenOf,docsOf}){
  const shown=columns.filter(c=>!hidden.has(columnHash(c.key)));
  if(!columns.length)return '<div class="empty">회의 결과가 없습니다.</div>';
  if(!shown.length)return '<div class="empty">보일 열을 위에서 골라 주세요.</div>';
  return `<div class="mcol-scroller" role="region" aria-label="회의 유형별 열" tabindex="0">${shown.map((c,i)=>{
    const label=c.name||'회의명 미지정',open=expanded.has(c.key),list=open?c.meetings:c.meetings.slice(0,COLUMN_RECENT),rest=c.meetings.length-COLUMN_RECENT,headId=`mcolHead${i}`;
    const cards=list.map(m=>{
      const r=Number(m.round_no),roundText=Number.isFinite(r)&&m.round_no!=null&&m.round_no!==''?`${r}차`:'차수 없음',when=whenOf(m),docs=docsOf(m);
      const aria=[label,roundText,when,docs?`자료 ${docs}`:''].filter(Boolean).join(' · ');
      return `<li><article class="mcol-card" data-mrd-meeting="${esc(m.id)}" role="button" tabindex="0" aria-label="${esc(aria)}"><b class="mcol-round">${esc(roundText)}</b><span class="mcol-meta"><span class="mcol-when">${esc(when)}</span>${docs?`<span class="mcol-docs">자료 ${docs}</span>`:''}</span></article></li>`;
    }).join('');
    return `<section class="mcol" data-meeting-column="${esc(c.key)}" style="--meeting-color:${esc(colorOf(c.name))}" aria-labelledby="${headId}">`
      +`<h3 class="mcol-head" id="${headId}"><span class="mcol-dot" aria-hidden="true"></span><span class="mcol-name">${esc(label)}</span><span class="mcol-count" aria-label="${c.meetings.length}건">${c.meetings.length}</span></h3>`
      +`<ol class="mcol-cards">${cards}</ol>`
      +(rest>0?`<button class="mcol-more" type="button" data-meeting-more="${esc(c.key)}" aria-expanded="${open}">${open?'접기':`더 보기 ${rest}`}</button>`:'')
      +`<button class="mcol-add" type="button" data-meeting-add="${esc(c.key)}" aria-label="${esc(label)} 회의 결과 등록">+ 이 회의 결과</button>`
      +`</section>`;
  }).join('')}</div>`;
}
