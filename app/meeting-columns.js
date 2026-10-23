// UI-PC회의(2026-10-20 사용자 확정) → MEET-결과정리 ⑤(시안 C) → MEET-결과3단(2026-10-21 시안 승인): PC(≥1024) 회의 결과는
// 왼쪽 회의 종류 목록(색 점·이름·건수) / 가운데 고른 종류의 차수·날짜·시간 / 오른쪽 고른 차수의 회의 결과(읽기용) 3단.
// 그리는 주인은 team.js의 renderMeetings 하나다. 이 파일은 묶기·정렬·색 배정·차수 글자(순수 함수)와 배치 HTML만 맡는다.
// 폰·중간 폭은 이 파일의 배치를 쓰지 않고 지금 한 줄 목록 그대로 그린다(색·차수 글자는 함께 쓴다).
export const PC_QUERY='(min-width:1024px)';
export const NONE_KEY='__none__';
// UI-회의자료표시(2026-10-20): 회의에 붙은 자료가 있으면 개수 없이 이 문구만 보인다(폰 목록). 없으면 표시 없음. PC 3단 가운데 줄에는 보이지 않는다(MEET-결과3단).
export const MEETING_DOCS_LABEL='회의자료 있음';

const time=m=>{const t=new Date(m?.meeting_at).getTime();return Number.isFinite(t)?t:-Infinity};
const round=m=>{const n=Number(m?.round_no);return Number.isFinite(n)?n:-Infinity};
const byRecent=(a,b)=>time(b)-time(a)||round(b)-round(a);
// 폰·중간 폭 한 줄 목록도 PC와 같은 기준으로 최신이 위(날짜·시간이 같거나 없으면 차수 큰 쪽이 위). 받은 순서에 기대지 않는다.
export const sortRecentFirst=list=>[...(list||[])].sort(byRecent);

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
// 이제 종류마다 칸을 하나씩 나눠 준다: 색 칸은 theme-tokens.css의 --ds-meeting-1~16(빨강 계열 없이 서로 색차 25 이상, 밝은·어두운 화면 각각
// 바탕 대비 3:1 이상). 처음 결과가 있는 순(오래된 종류 먼저 — 새 종류가 생겨도 기존 종류 색이 덜 바뀜)으로 이름 해시가 가리키는
// 1단 칸을 먼저 쓰고, 이미 쓰였으면 1단의 다음 빈 칸, 1단이 다 차면 2단(9~16 추가 색). 1단 순서는 예전 8색 계열과 같아 먼저 생긴 종류는 예전과 비슷한 색. 16종류를 넘으면 그때부터만 다시 돈다.
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

// MEET-결과3단(2026-10-21 시안 승인): PC 3단 = 왼쪽 회의 종류 / 가운데 고른 종류의 차수·날짜·시간 / 오른쪽 고른 차수의 회의 결과(읽기용).
// 회의 종류 + 차수 두 칸을 합쳐 1/3, 오른쪽 결과 2/3(theme-tokens.css --ds-split-*). 가운데 줄에는 "회의자료 있음"을 보이지 않는다(날짜·시간만).
// 가운데 줄을 누르면 오른쪽만 바뀐다(창을 열지 않음). 고칠 때는 오른쪽 머리 ⋯ → [수정]으로 지금의 회의 결과 창(meeting-round-detail.js)을 연다.
// 고른 차수가 없거나 없어졌으면 고른 종류의 가장 최근 차수(처음 열면 가장 최근 결과가 있는 종류의 가장 최근 차수 = 전체에서 가장 최근 결과).
export function pickMeeting(column,selectedId){return column?.meetings.find(m=>String(m.id)===String(selectedId))||column?.meetings[0]||null}

export function columnsHtml(columns,{selectedKey,selectedId,colorOf,whenOf,resultHtml=()=>''}){
  if(!columns.length)return '<div class="empty">회의 결과가 없습니다.</div>';
  const selected=columns.find(c=>c.key===selectedKey)||columns[0],current=pickMeeting(selected,selectedId);
  const kinds=columns.map(c=>{
    const label=c.name||'회의명 미지정',on=c===selected;
    return `<li><button type="button" class="mcol-kind" data-meeting-kind="${esc(c.key)}" aria-controls="mcolRounds"${on?' aria-current="true"':''} style="--meeting-color:${esc(colorOf(c.name))}"><span class="mcol-dot" aria-hidden="true"></span><span class="mcol-name" title="${esc(label)}">${esc(label)}</span><span class="mcol-count" aria-label="${c.meetings.length}건">${c.meetings.length}</span></button></li>`;
  }).join('');
  const label=selected.name||'회의명 미지정';
  const rows=selected.meetings.map(m=>{
    const roundText=roundLabel(m),when=whenOf(m),on=m===current;
    return `<li><button type="button" class="mcol-card" data-meeting-round="${esc(m.id)}" aria-controls="mcolResult" aria-label="${esc([label,roundText,when].filter(Boolean).join(' · '))}"${on?' aria-current="true"':''}><b class="mcol-round" title="${esc(roundText)}">${esc(roundText)}</b><span class="mcol-meta"><span class="mcol-when" title="${esc(when)}">${esc(when)}</span></span></button></li>`;
  }).join('');
  return `<div class="mcol-layout">`
    +`<div class="mcol-lists">`
    +`<nav class="mcol-kinds" aria-label="회의 종류"><ul>${kinds}</ul></nav>`
    +`<section id="mcolRounds" class="mcol-rounds" data-meeting-column="${esc(selected.key)}" style="--meeting-color:${esc(colorOf(selected.name))}" aria-labelledby="mcolRoundsHead">`
    +`<h3 class="mcol-head" id="mcolRoundsHead"><span class="mcol-dot" aria-hidden="true"></span><span class="mcol-name" title="${esc(label)}">${esc(label)}</span><span class="mcol-count" aria-label="${selected.meetings.length}건">${selected.meetings.length}</span></h3>`
    +`<ol class="mcol-cards">${rows}</ol>`
    +`</section></div>`
    +`<section id="mcolResult" class="mcol-result" style="--meeting-color:${esc(colorOf(selected.name))}" aria-label="회의 결과"${current?` data-meeting-result="${esc(current.id)}"`:''}>${current?resultHtml(current,{kindName:label}):''}</section>`
    +`</div>`;
}

// MTG-사업보고 4단계: [회의] 칩이 아닐 때(PC) 2단 = 왼쪽 '날짜·이름 목록'(최신 위) / 오른쪽 고른 건의 결과(3단의 오른쪽과 같은 resultHtml).
// 왼쪽 줄은 3단 가운데 줄과 같은 단추(data-meeting-round)라 고르기·화살표·⋯ 메뉴를 그대로 쓴다. [전체]에서는 줄에 칸 글자(kindOf)도 보인다.
export function listHtml(rows,{selectedId,label,nameOf,kindOf=()=>'',colorOf,whenOf,resultHtml=()=>''}){
  if(!rows.length)return `<div class="empty">이 칸에 사업 보고가 없습니다.</div>`;
  const current=rows.find(m=>String(m.id)===String(selectedId))||rows[0];
  const items=rows.map(m=>{
    const name=nameOf(m),when=whenOf(m),kind=kindOf(m),round=hasRound(m)||meetingShortName(m)?roundLabel(m):'',on=m===current;
    const meta=[kind,when,round].filter(Boolean);
    return `<li><button type="button" class="mcol-card" data-meeting-round="${esc(m.id)}" aria-controls="mcolResult" aria-label="${esc([name,...meta].join(' · '))}"${on?' aria-current="true"':''} style="--meeting-color:${esc(colorOf(m))}"><b class="mcol-round" title="${esc(name)}">${esc(name)}</b><span class="mcol-meta">${meta.map((x,i)=>`<span class="${i===meta.indexOf(when)?'mcol-when':'mcol-kind-tag'}">${esc(x)}</span>`).join('<span class="mcol-sep" aria-hidden="true"> · </span>')}</span></button></li>`;
  }).join('');
  return `<div class="mcol-layout mcol-two">`
    +`<section id="mcolRounds" class="mcol-rounds" aria-labelledby="mcolRoundsHead">`
    +`<h3 class="mcol-head" id="mcolRoundsHead"><span class="mcol-name" title="${esc(label)}">${esc(label)}</span><span class="mcol-count" aria-label="${rows.length}건">${rows.length}</span></h3>`
    +`<ol class="mcol-cards">${items}</ol></section>`
    +`<section id="mcolResult" class="mcol-result" style="--meeting-color:${esc(colorOf(current))}" aria-label="회의 결과" data-meeting-result="${esc(current.id)}">${resultHtml(current)}</section>`
    +`</div>`;
}

// 오른쪽 칸(읽기용): 지금 회의 결과 창 보기 면과 같은 정보 — 회의 이름·차수(짧은 이름)·회의 시각(연도 포함)·프로젝트·기존 제목,
// 회의 결과 원문, 특이사항(있을 때만), 후속 할 일(읽기만, 따로 불러옴), 회의자료(이름을 누르면 내려받기). 입력칸·저장 버튼 없음.
// 원문은 결과 창과 같은 규칙: 원문 → 옛 구조화 기록 → '기록 없음'.
export function resultText(m){if(m?.transcript_text!=null&&String(m.transcript_text).length)return String(m.transcript_text);if(String(m?.decisions||'').trim())return `[기존 회의결과 기록]\n${m.decisions}`;return '기록 없음'}
// MTG-사업보고 4단계: kindLabel(칸 글자, 예: '언론')이 오면 메타 줄 맨 앞에 'X 칸'으로 보인다(data-report-kind-label).
// UI-중복제목삭제: 이 칸은 PC(≥1024)에서만 그려지고 상단 줄이 이미 "회의 이름 차수"를 보이므로, 머리에는 제목 줄이 없고 메타 줄(칸·시각·프로젝트)과 ⋯만 둔다.
export function resultHtml(m,{kindLabel='',when='',project='',legacyTitle='',docs=[],fileLine,tasksHtml=''}){
  const meta=[legacyTitle&&hasRound(m)?`기존 제목: ${legacyTitle}`:'',when,project?`프로젝트 ${project}`:''].filter(Boolean);
  const notes=String(m?.notes||'');
  const files=docs.length?docs.map(d=>{const name=d.file_name||d.title;return fileLine({name,meta:[d.title&&d.title!==name?d.title:'',d.file_size?Math.max(1,Math.round(d.file_size/1024))+'KB':''].filter(Boolean).join(' · '),cls:'mcol-file',end:`<button class="file-line-open" type="button" data-meeting-doc="${esc(d.id)}" aria-label="${esc(name)} 내려받기"></button>`})}).join(''):'<p class="mcol-empty">회의자료가 없습니다.</p>';
  return `<header class="mcol-result-head"><div class="mcol-result-title">${meta.length||kindLabel?`<p class="mcol-result-meta">${kindLabel?`<span data-report-kind-label>${esc(kindLabel)} 칸</span>`:''}${meta.map(x=>`<span>${esc(x)}</span>`).join('')}</p>`:''}</div>`
    +`<button type="button" class="icon-btn mcol-more" data-meeting-more="${esc(m.id)}" aria-label="회의 결과 관리" aria-haspopup="true" aria-expanded="false" aria-controls="mcolMenu"><span aria-hidden="true">⋯</span></button></header>`
    +`<div class="mcol-result-body">`
    +`<section class="mcol-block" aria-labelledby="mcolTextHead"><h4 id="mcolTextHead">회의 결과 원문</h4><div class="mcol-text">${esc(resultText(m))}</div></section>`
    +(notes.trim()?`<section class="mcol-block" aria-labelledby="mcolNotesHead"><h4 id="mcolNotesHead">특이사항</h4><div class="mcol-text mcol-notes">${esc(notes)}</div></section>`:'')
    +`<section class="mcol-block" aria-labelledby="mcolTasksHead"><h4 id="mcolTasksHead">후속 할 일</h4><div id="mcolTasks" class="mcol-tasks" aria-live="polite">${tasksHtml}</div></section>`
    +`<section class="mcol-block" aria-labelledby="mcolDocsHead"><h4 id="mcolDocsHead">회의자료</h4><div class="mcol-files">${files}</div></section>`
    +`</div>`;
}
// 후속 할 일 읽기 줄: 동그라미(완료면 채움)·이름·기한. 누르는 곳 없음(고칠 때는 ⋯ → 수정).
export function tasksHtml(tasks,{dueOf=()=>''}={}){
  if(tasks==null)return '<p class="mcol-empty">불러오는 중…</p>';
  if(tasks==='error')return '<p class="mcol-empty">후속 할 일을 불러오지 못했습니다.</p>';
  if(!tasks.length)return '<p class="mcol-empty">후속 할 일이 없습니다.</p>';
  return `<ul class="mcol-task-list">${tasks.map(t=>{const done=t.status==='completed',due=dueOf(t);return `<li class="mcol-task${done?' completed':''}"><span class="mcol-task-check" aria-hidden="true"></span><span class="mcol-task-title">${esc(t.title||'제목 없음')}${done?'<span class="mcol-sr"> (완료)</span>':''}</span>${due?`<span class="mcol-task-due">${esc(due)}</span>`:''}</li>`}).join('')}</ul>`;
}
