// MEET-결과정리 ②③⑤ → MEET-결과3단: 회의 종류 색 겹침 없음, 차수 대신 짧은 이름, PC 3단 배치(종류 목록 / 고른 종류의 차수 / 고른 차수의 읽기용 결과).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assignMeetingColors,meetingPaletteColor,MEETING_PALETTE,meetingColumns,columnsHtml,pickMeeting,resultHtml,resultText,tasksHtml,roundLabel,meetingShortName,NONE_KEY} from '../app/meeting-columns.js';

const nameOf=m=>String(m?.series_name||m?.title||'').trim(),keyOf=n=>String(n||'').replace(/\s+/g,'').toLowerCase();
const row=(name,day,extra={})=>({id:`${name}-${day}`,title:name,series_name:name,round_no:1,meeting_at:`2026-09-${String(day).padStart(2,'0')}T01:00:00Z`,...extra});
const oldHash=key=>{let h=0;for(const c of key)h=(Math.imul(h,31)+c.codePointAt(0))>>>0;return h%8};

test('서로 다른 종류는 서로 다른 색 칸(16종류까지), 같은 종류는 같은 칸',()=>{
  for(const count of [2,5,8,9,16]){
    const names=Array.from({length:count},(_,i)=>`가상 회의 ${i+1}`);
    const meetings=names.flatMap((n,i)=>[row(n,i+1),row(n,i+10)]);
    const slots=assignMeetingColors(meetings,{nameOf,keyOf});
    assert.equal(slots.size,count);
    assert.equal(new Set(slots.values()).size,count,`${count}종류 겹침`);
    for(const s of slots.values())assert.ok(s>=0&&s<MEETING_PALETTE);
    // 8종류까지는 기본 단(1~8)만 쓰고, 넘으면 진한 단(9~16)으로 이어 간다.
    if(count<=8)for(const s of slots.values())assert.ok(s<8);
  }
});

test('예전 해시로 같은 색이던 두 종류도 다른 색',()=>{
  // 예전 방식(이름 해시 % 8)에서 같은 칸이 되는 가짜 회의 이름 두 개를 찾는다.
  const pool=Array.from({length:200},(_,i)=>`가짜회의${i}`),seen=new Map();let pair=null;
  for(const n of pool){const h=oldHash(keyOf(n));if(seen.has(h)){pair=[seen.get(h),n];break}seen.set(h,n)}
  assert.ok(pair);
  const slots=assignMeetingColors([row(pair[0],1),row(pair[1],2)],{nameOf,keyOf});
  assert.notEqual(slots.get(keyOf(pair[0])),slots.get(keyOf(pair[1])));
});

test('새 종류가 생겨도 기존 종류 색은 그대로(처음 결과가 있는 순)',()=>{
  const base=[row('가상 운영위',1),row('가상 집행위',2),row('가상 간담회',3)];
  const before=assignMeetingColors(base,{nameOf,keyOf});
  const after=assignMeetingColors([...base,row('가상 신규회의',20)],{nameOf,keyOf});
  for(const [k,v] of before)assert.equal(after.get(k),v);
  // 회의명 없는 결과는 색 칸을 받지 않는다(회색).
  assert.equal(assignMeetingColors([row('',1,{title:'',series_name:''})],{nameOf,keyOf}).size,0);
});

test('색 칸은 테마 색 값으로 그리고, 밝은·어두운 화면 모두 16칸이 정의돼 있다',()=>{
  assert.equal(meetingPaletteColor(0),'var(--ds-meeting-1)');assert.equal(meetingPaletteColor(15),'var(--ds-meeting-16)');assert.equal(meetingPaletteColor(16),'var(--ds-meeting-1)');
  const css=readFileSync(new URL('../app/theme-tokens.css',import.meta.url),'utf8');
  const dark=css.slice(css.indexOf('@media (prefers-color-scheme:dark)'));const light=css.slice(0,css.indexOf('@media (prefers-color-scheme:dark)'));
  const values=part=>Array.from({length:16},(_,i)=>part.match(new RegExp(`--ds-meeting-${i+1}:(#[0-9a-f]{6})`))?.[1]);
  const lum=hex=>{const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2]};
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
  for(const [part,backgrounds] of [[light,['#fffefa','#f7f5ee','#f3f1ea','#ffffff','#efede6']],[dark,['#161613','#1f1f1b','#292924','#2d2c27']]]){
    const list=values(part);
    assert.equal(list.filter(Boolean).length,16);assert.equal(new Set(list).size,16);
    // 그림 요소(점·띠) 대비 기준 3:1 이상.
    for(const c of list)for(const b of backgrounds)assert.ok(ratio(c,b)>=3,`${c} on ${b}`);
  }
});

test('차수 대신 짧은 이름: 차수 → 짧은 이름(제목이 종류 이름과 다를 때) → 차수 없음',()=>{
  assert.equal(roundLabel({series_name:'가상협의회',title:'가상협의회',round_no:3}),'3차');
  assert.equal(roundLabel({series_name:'가상협의회',title:'파생 간담회',round_no:null}),'파생 간담회');
  assert.equal(roundLabel({series_name:'가상협의회',title:'가상협의회',round_no:null}),'차수 없음');
  assert.equal(roundLabel({series_name:'가상협의회',title:'파생 간담회',round_no:''}),'파생 간담회');
  // 제목만 있는 옛 결과는 제목이 곧 종류 이름이라 짧은 이름이 아니다.
  assert.equal(meetingShortName({series_name:null,title:'제목만 회의'}),'');
  assert.equal(roundLabel({series_name:null,title:'제목만 회의',round_no:null}),'차수 없음');
});

test('PC 3단 배치: 왼쪽 종류 목록(건수) / 가운데 고른 종류의 차수 전부(날짜·시간만) / 오른쪽 고른 차수 결과, 결과 등록 버튼·더 보기 없음',()=>{
  const meetings=[...[1,2,3,4,5,6].map(n=>row('가상협의회',n,{id:`a${n}`,round_no:n})),row('가상위원회',20,{id:'b1'}),row('가상협의회',21,{id:'a7',title:'파생 간담회',round_no:null}),row('',22,{id:'n1',title:'',series_name:''})];
  const columns=meetingColumns(meetings,{nameOf,keyOf});
  assert.deepEqual(columns.map(c=>c.key),[NONE_KEY,keyOf('가상협의회'),keyOf('가상위원회')]);
  const seen=[];
  const html=columnsHtml(columns,{selectedKey:keyOf('가상협의회'),colorOf:()=>'var(--ds-meeting-1)',whenOf:()=>'9. 1. 오전 10:00',resultHtml:(m,{kindName})=>{seen.push([m.id,kindName]);return '<p>결과</p>'}});
  assert.equal((html.match(/data-meeting-kind=/g)||[]).length,3);
  // 고른 종류 하나 + 고른 차수 하나.
  assert.equal((html.match(/aria-current="true"/g)||[]).length,2);
  assert.equal((html.match(/data-meeting-round=/g)||[]).length,7);
  assert.equal((html.match(/data-mrd-meeting=/g)||[]).length,0);
  assert.match(html,/>파생 간담회</);
  assert.doesNotMatch(html,/data-meeting-add|이 회의 결과|더 보기|회의자료 있음/);
  // 처음엔 고른 종류의 가장 최근 차수(맨 위)가 오른쪽에.
  assert.deepEqual(seen,[['a7','가상협의회']]);
  assert.match(html,/id="mcolResult"[^>]*data-meeting-result="a7"/);
  // 고른 차수가 있으면 그 차수, 없어졌으면 가장 최근 차수.
  const col=columns.find(c=>c.key===keyOf('가상협의회'));
  assert.equal(pickMeeting(col,'a3').id,'a3');assert.equal(pickMeeting(col,'gone').id,'a7');assert.equal(pickMeeting(null,'a3'),null);
  const picked=columnsHtml(columns,{selectedKey:keyOf('가상협의회'),selectedId:'a3',colorOf:()=>'',whenOf:()=>''});
  assert.match(picked,/data-meeting-round="a3"[^>]*aria-current="true"/);assert.match(picked,/data-meeting-result="a3"/);
  // 고른 종류가 없어졌으면 맨 위 종류.
  const fallback=columnsHtml(columns,{selectedKey:'gone',colorOf:()=>'',whenOf:()=>''});
  assert.match(fallback,/data-meeting-column="__none__"/);assert.match(fallback,/data-meeting-result="n1"/);
  assert.equal(columnsHtml([],{colorOf:()=>'',whenOf:()=>''}),'<div class="empty">회의 결과가 없습니다.</div>');
});

test('오른쪽 결과(읽기용): 원문 규칙·특이사항·프로젝트·회의자료·후속 할 일, 입력칸 없음, 고치는 곳은 ⋯ 하나',()=>{
  assert.equal(resultText({transcript_text:'원문'}),'원문');
  assert.equal(resultText({transcript_text:'',decisions:'옛 결정'}),'[기존 회의결과 기록]\n옛 결정');
  assert.equal(resultText({}),'기록 없음');
  const fileLine=({name,meta,cls,end})=>`<div class="${cls}">${name} ${meta}${end}</div>`;
  const m={id:'x1',series_name:'가상협의회',title:'옛 제목 <b>',round_no:2,transcript_text:'<script>원문</script>',notes:'가상 특이사항'};
  const html=resultHtml(m,{when:'2026. 9. 1.',project:'가상 프로젝트',legacyTitle:'옛 제목 <b>',docs:[{id:'d1',title:'가상 안건지',file_name:'가상 안건지.hwp',file_size:20480}],fileLine,tasksHtml:'<ul></ul>'});
  assert.match(html,/프로젝트 가상 프로젝트/);assert.doesNotMatch(html,/<h3|mcolResultHead|2차/);/* UI-중복제목삭제: 제목·차수 줄은 상단 줄이 보인다 */assert.match(html,/기존 제목: 옛 제목 &lt;b&gt;/);
  assert.match(html,/&lt;script&gt;원문&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.match(html,/가상 특이사항/);assert.match(html,/data-meeting-doc="d1"/);assert.match(html,/20KB/);
  assert.doesNotMatch(html,/<(input|textarea|select)\b/);
  assert.equal((html.match(/data-meeting-more=/g)||[]).length,1);
  const bare=resultHtml({id:'x2',round_no:null},{fileLine});
  assert.match(bare,/회의자료가 없습니다/);assert.doesNotMatch(bare,/특이사항/);
  assert.match(tasksHtml(null),/불러오는 중/);assert.match(tasksHtml('error'),/불러오지 못했습니다/);assert.match(tasksHtml([]),/후속 할 일이 없습니다/);
  const tasks=tasksHtml([{title:'가상 할 일',status:'needsAction'},{title:'끝난 일',status:'completed'}],{dueOf:t=>t.status==='completed'?'':'10. 25.'});
  assert.equal((tasks.match(/class="mcol-task( completed)?"/g)||[]).length,2);assert.match(tasks,/completed[^]*끝난 일/);assert.match(tasks,/10\. 25\./);
});
