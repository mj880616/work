// MEET-파일로만들기: 파일 이름·글 첫 줄에서 날짜·차수·회의명·결과/자료를 읽고 회의별로 묶는 순수 함수.
// 화면·저장은 meeting-from-files.js가 맡는다. 여기서는 DOM·네트워크를 쓰지 않는다(단위 검사 대상).

const pad=n=>String(n).padStart(2,'0');
function validDate(y,m,d){
  if(!(y>=2000&&y<=2099&&m>=1&&m<=12&&d>=1&&d<=31))return '';
  const t=new Date(Date.UTC(y,m-1,d));
  return t.getUTCMonth()===m-1&&t.getUTCDate()===d?`${y}-${pad(m)}-${pad(d)}`:'';
}
// 날짜: 2025.10.15 · 2025-10-15 · 2025. 10. 15. · 2025년 10월 15일 · 20251015 · 251015 · 25.10.15
const DATE_PATTERNS=[
  [/(?<!\d)(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?(?!\d)/,m=>validDate(+m[1],+m[2],+m[3])],
  [/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/,m=>validDate(+m[1],+m[2],+m[3])],
  [/(?<!\d)(\d{2})\.(\d{1,2})\.(\d{1,2})(?![\d.]*\d)/,m=>validDate(2000+ +m[1],+m[2],+m[3])],
  [/(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/,m=>validDate(2000+ +m[1],+m[2],+m[3])],
];
const TIME=/(?<![\d:])([01]?\d|2[0-3])\s*[:시]\s*([0-5]\d)?\s*분?(?![\d:])/;
const ROUND=/(?:제\s*)?(\d{1,3})\s*차(?!\s*년)/;
const RESULT_WORDS=/회의\s*결과|결과|회의록|속기록|녹취/;
const MATERIAL_WORDS=/회의\s*자료|자료|안건|첨부|붙임/;
const NOISE=/회의\s*결과|회의\s*자료|결과\s*보고|결과|회의록|속기록|녹취록?|자료집?|안건지?|첨부|붙임|최종본?|수정본?|사본|초안|\(\d+\)|\bcopy\b|\bfinal\b/gi;
// 회의 제목 줄로 볼 낱말(붙여 넣은 글을 회의별로 나눌 때).
const MEETING_WORD=/회의|위원회|운영위|집행위|중집|상집|대의원|총회|협의회|간담회|워크숍|확대간부/;
const LIST_MARK=/^\s*(?:[-*•·○●□■▶▷※◇◆>]|\d+[.)]|[가-하][.)]|\(\d+\)|\[\d+\])/;

export function parseDate(text){
  const s=String(text||'');
  for(const [re,fn] of DATE_PATTERNS){const m=s.match(re);if(m){const v=fn(m);if(v)return {date:v,match:m[0]}}}
  return {date:'',match:''};
}
export function parseRound(text){const m=String(text||'').match(ROUND);return m?{round:Number(m[1])||null,match:m[0]}:{round:null,match:''}}
function cleanName(text){
  return String(text||'')
    .replace(NOISE,' ')
    .replace(/[\[\](){}<>【】「」『』_~+=#,;:|]/g,' ')
    .replace(/(^|\s)[-.]+|[-.]+(\s|$)/g,' ')
    .replace(/\s+/g,' ').trim()
    .replace(/^(?:제|및|과|와)\s+/,'').replace(/\s+(?:회의|및)$/,'').trim();
}
// 파일 이름이나 글 한 줄에서 날짜·차수·회의명(·시각)을 읽는다. 날짜·차수·결과/자료 낱말을 빼고 남은 말이 회의명이다.
export function parseKey(raw){
  let rest=String(raw||'').replace(/\.(hwpx?|pdf|docx?|txt)$/i,'');
  const {date,match:dm}=parseDate(rest);if(dm)rest=rest.replace(dm,' ');
  const {round,match:rm}=parseRound(rest);if(rm)rest=rest.replace(rm,' ');
  let time='';const tm=rest.match(TIME);
  if(tm&&/[:시]/.test(tm[0])){time=`${pad(+tm[1])}:${tm[2]||'00'}`;rest=rest.replace(tm[0],' ')}
  return {date,round,name:cleanName(rest),time};
}
// 파일 이름으로 결과/자료를 나눈다. 둘 다 아니면 ''(표에서 고르기).
export function roleOf(fileName){
  const s=String(fileName||'').replace(/\.[^.]+$/,'');
  if(/회의\s*자료/.test(s)&&!/결과|회의록/.test(s))return 'material';
  if(RESULT_WORDS.test(s))return 'result';
  if(MATERIAL_WORDS.test(s))return 'material';
  return '';
}
export function isHeaderLine(line){
  const s=String(line||'').trim();
  if(!s||s.length>80||LIST_MARK.test(s)||!MEETING_WORD.test(s))return false;
  const k=parseKey(s);
  return !!(k.name&&(k.date||k.round));
}
// 붙여 넣은 글을 회의 제목 줄마다 나눈다. 제목 줄이 없으면 글 전체가 한 덩어리(key 없음).
export function splitPasted(text){
  const body=String(text||'').replace(/\r\n?/g,'\n');
  if(!body.trim())return [];
  const lines=body.split('\n'),starts=[];
  lines.forEach((line,i)=>{if(isHeaderLine(line))starts.push(i)});
  if(!starts.length)return [{text:body.trim(),key:firstLineKey(body)}];
  // 첫 제목 줄 앞의 머리말은 첫 회의 글에 붙인다(key는 제목 줄에서).
  return starts.map((start,i)=>{const from=i===0?0:start;const chunk=lines.slice(from,starts[i+1]??lines.length).join('\n').trim();return {text:chunk,key:parseKey(lines[start])}}).filter(c=>c.text);
}
// 결과 파일 본문의 앞쪽 몇 줄에서 key를 찾는다(파일 이름에 정보가 없을 때).
export function firstLineKey(text,maxLines=6){
  const lines=String(text||'').split(/\n/).map(s=>s.trim()).filter(Boolean).slice(0,maxLines);
  const key={date:'',round:null,name:'',time:''};
  for(const line of lines){
    if(line.length>120)continue;
    const k=parseKey(line);
    if(!key.date&&k.date)key.date=k.date;
    if(!key.round&&k.round)key.round=k.round;
    if(!key.time&&k.time)key.time=k.time;
    if(!key.name&&k.name&&MEETING_WORD.test(line)&&k.name.length<=40)key.name=k.name;
  }
  return key;
}
// 파일 이름 key에 빈 칸이 있으면 본문 key로 채운다.
export function mergeKey(primary,fallback){
  const a=primary||{},b=fallback||{};
  return {date:a.date||b.date||'',round:a.round||b.round||null,name:a.name||b.name||'',time:a.time||b.time||''};
}

export const nameKey=name=>String(name||'').replace(/\s+/g,'').toLowerCase();
// 기존 회의 종류 중 같은 이름(띄어쓰기 무시) 또는 한쪽이 다른 쪽을 품는 이름(2자 이상)을 찾는다.
export function matchKind(name,kinds){
  const k=nameKey(name);if(!k)return '';
  const list=[...new Set((kinds||[]).filter(Boolean))];
  return list.find(n=>nameKey(n)===k)||list.find(n=>{const o=nameKey(n);return o.length>=2&&k.length>=2&&(o.includes(k)||k.includes(o))})||'';
}

const effective=item=>{const o=item.override||{};return {date:o.date||item.key?.date||'',round:o.round||item.key?.round||null,name:o.name||item.key?.name||'',time:o.time||item.key?.time||''}};
const full=k=>!!(k.name&&(k.round||k.date));
const gkey=k=>nameKey(k.name)+(k.round?'#r'+k.round:'#d'+k.date);

// items: [{id, role:'result'|'material'|'', text, key:{date,round,name,time}, override}] → 회의별 묶음.
// 1) 이름과 (차수 또는 날짜)가 있는 것끼리 묶고, 같은 이름의 날짜 묶음은 그 날짜인 차수 묶음에 합친다.
// 2) 정보가 모자란 것은 날짜·차수가 맞는 묶음 하나, 또는 묶음이 하나뿐이면 거기에 붙인다.
// 3) 붙일 곳이 없으면: 묶음이 하나도 없을 때는 남은 것을 한 묶음으로, 있으면 하나씩 따로(주황, 직접 고르기).
export function groupItems(items){
  const groups=new Map(),order=[];
  const add=(key,item,k)=>{if(!groups.has(key)){groups.set(key,{key,items:[]});order.push(key)}groups.get(key).items.push({item,k})};
  const rest=[];
  for(const item of items){const k=effective(item);if(full(k))add(gkey(k),item,k);else rest.push({item,k})}
  for(const key of [...order]){
    if(!key.includes('#d'))continue;
    const g=groups.get(key),date=g.items[0].k.date,name=nameKey(g.items[0].k.name);
    const target=order.find(o=>o!==key&&o.startsWith(name+'#r')&&groups.get(o).items.some(x=>x.k.date===date));
    if(target){groups.get(target).items.push(...g.items);groups.delete(key);order.splice(order.indexOf(key),1)}
  }
  const leftovers=[];
  for(const entry of rest){
    const {k}=entry;
    const candidates=order.filter(o=>{const g=groups.get(o);return (k.date&&g.items.some(x=>x.k.date===k.date))||(k.round&&g.items.some(x=>x.k.round===k.round))||(k.name&&!k.date&&!k.round&&g.items.some(x=>nameKey(x.k.name)===nameKey(k.name)))});
    const target=candidates.length===1?candidates[0]:(order.length===1&&!candidates.length?order[0]:null);
    if(target)groups.get(target).items.push(entry);else leftovers.push(entry);
  }
  if(leftovers.length){
    if(!order.length){const key='?all';groups.set(key,{key,items:leftovers});order.push(key)}
    else leftovers.forEach((entry,i)=>{const key='?'+entry.item.id;groups.set(key,{key,items:[entry]});order.push(key)});
  }
  return order.map(key=>summarize(groups.get(key)));
}
function pick(entries,field){
  const results=entries.filter(x=>x.item.role==='result'),pool=[...results,...entries];
  for(const x of pool){const v=x.k[field];if(v)return v}
  return field==='round'?null:'';
}
function summarize(g){
  const entries=g.items;
  const items=entries.map(x=>x.item);
  return {
    key:g.key,
    ids:items.map(i=>i.id),
    date:pick(entries,'date'),round:pick(entries,'round'),name:pick(entries,'name'),time:pick(entries,'time'),
    results:items.filter(i=>i.role==='result'),
    materials:items.filter(i=>i.role==='material'),
    undecided:items.filter(i=>!i.role),
  };
}
// 같은 종류·차수(차수가 없으면 같은 날짜)의 기존 회의를 찾는다. dateOf는 회의 일시를 YYYY-MM-DD로 바꾸는 함수.
export function findExisting(group,meetings,dateOf){
  const k=nameKey(group.name);if(!k)return null;
  const same=(meetings||[]).filter(m=>nameKey(m.series_name||m.title)===k);
  if(group.round)return same.find(m=>Number(m.round_no)===Number(group.round))||null;
  if(group.date)return same.find(m=>dateOf(m.meeting_at)===group.date)||null;
  return null;
}
// HWP 편집기 SVG의 글자 조각({s,x,y,size,w})을 줄 글로 모은다. 같은 높이(y)는 한 줄, 왼쪽부터, 벌어진 사이는 빈칸.
export function linesFromGlyphs(glyphs){
  const rows=new Map();
  for(const g of glyphs||[]){
    if(!g||!g.s)continue;
    const y=Math.round(Number(g.y)||0),row=rows.get(y)||[];row.push(g);rows.set(y,row);
  }
  return [...rows.keys()].sort((a,b)=>a-b).map(y=>{
    const row=rows.get(y).sort((a,b)=>a.x-b.x);let line='',end=null;
    for(const g of row){
      const size=Number(g.size)||10,width=Number(g.w)||size*[...g.s].reduce((n,c)=>n+(c.charCodeAt(0)<0x2e80?0.55:1),0);
      if(end!==null&&g.x-end>size*0.25)line+=' ';
      line+=g.s;end=g.x+width;
    }
    return line.replace(/\s+$/,'');
  }).filter(line=>line.trim()).join('\n');
}
// 결과 글을 기존 결과에 더한다. 이미 들어 있으면 그대로 둔다.
export function appendResult(existing,addition){
  const a=String(existing||''),b=String(addition||'').trim();
  if(!b||a.includes(b))return a;
  return a.trim()?a.replace(/\s+$/,'')+'\n\n'+b:b;
}
