// S56-13 BIZ-사업영역기억(요청함 11/10 11:20 → 11:22 'ㅇ'): 같은 회의명은 한 번 정한 사업영역·[없음]을 기억해 새 보고에 붙이고 다시 묻지 않는다.
// 기억 = 이미 서버에 있는 지난 보고 값(새 DB 칸·기기 저장 없음). 가짜 이름·id만 쓴다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {untaggedInWeek,areaMemory,rememberedArea,rememberedAreaRows,areaNameKey,AREA_NONE} from '../app/business-area-model.mjs';

const read=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
const row=(id,name,at,extra={})=>({id,title:name,series_name:name,meeting_at:at,business_area_id:null,business_area_none:false,created_at:at,updated_at:at,...extra});

test('회의명 열쇠는 띄어쓰기 빼고 소문자(team.js meetingNameKey와 같은 규칙)',()=>{
  assert.equal(areaNameKey({series_name:' 노조 상집 '}),'노조상집');
  assert.equal(areaNameKey({title:'Area  Meet'}),'areameet');
  assert.match(read('team.js'),/function meetingNameKey\(name\)\{return String\(name\|\|''\)\.replace\(\/\\s\+\/g,''\)\.toLowerCase\(\)\}/);
});

test('이번 주 [없음]·사업영역으로 저장하면 다음 주 같은 회의는 \'안 단 보고\'에 안 뜨고 그 값이 붙는다, 처음 이름은 여전히 묻는다',()=>{
  const ms=[
    row('w1-exec','본부 집행위','2026-11-10T01:00:00Z',{business_area_none:true,updated_at:'2026-11-10T03:00:00Z'}),
    row('w1-board','노조 상집','2026-11-10T02:00:00Z',{business_area_id:'area-1',updated_at:'2026-11-10T03:00:00Z'}),
    row('w2-exec','본부집행위','2026-11-17T01:00:00Z'),
    row('w2-board','노조 상집','2026-11-17T02:00:00Z'),
    row('w2-new','처음 보는 회의','2026-11-17T03:00:00Z')
  ];
  assert.deepEqual(untaggedInWeek(ms,'2026-11-16').map(m=>m.id),['w2-new']);
  assert.deepEqual(rememberedAreaRows(ms).map(x=>[x.meeting.id,x.value]),[['w2-exec',AREA_NONE],['w2-board','area-1']]);
});

test('기억은 그 이름에서 가장 나중에 고른 값 — 옛 보고에서 바꿔도 다음부터 그 값',()=>{
  const ms=[
    row('a','노조 상집','2026-11-03T01:00:00Z',{business_area_id:'area-old',updated_at:'2026-11-03T05:00:00Z'}),
    row('b','노조 상집','2026-11-10T01:00:00Z',{business_area_id:'area-1',updated_at:'2026-11-10T05:00:00Z'}),
    row('c','노조 상집','2026-11-17T01:00:00Z')
  ];
  assert.equal(rememberedArea(ms[2],areaMemory(ms)),'area-1');
  ms[0].business_area_id='area-2';ms[0].updated_at='2026-11-11T00:00:00Z'; // 옛 보고에서 바꿈
  assert.equal(rememberedArea(ms[2],areaMemory(ms)),'area-2');
});

test('붙지 않는 보고: 기억보다 옛 보고(그 뒤에 만든 것도 아님)·한 줄 업데이트·칸 없는 옛 서버 줄·[없음] 칸이 없는 줄의 [없음]·이미 단 것',()=>{
  const src=row('s','노조 상집','2026-11-10T01:00:00Z',{business_area_none:true,updated_at:'2026-11-10T05:00:00Z'});
  const old=row('o','노조 상집','2026-10-01T01:00:00Z');
  const lateMade=row('l','노조 상집','2026-10-02T01:00:00Z',{created_at:'2026-11-10T06:00:00Z'}); // 옛 날짜로 나중에 만든 보고는 새 보고
  const one=row('x','노조 상집','2026-11-12T01:00:00Z',{activity_kind:'oneline'});
  const legacy={id:'g',title:'노조 상집',meeting_at:'2026-11-12T01:00:00Z'};
  const noNoneCol={id:'n',title:'노조 상집',meeting_at:'2026-11-12T01:00:00Z',business_area_id:null};
  const tagged=row('t','노조 상집','2026-11-12T01:00:00Z',{business_area_id:'area-9',updated_at:'2026-11-01T00:00:00Z'});
  const mem=areaMemory([src,old,lateMade,one,legacy,noNoneCol,tagged]);
  assert.equal(rememberedArea(old,mem),'');
  assert.equal(rememberedArea(lateMade,mem),AREA_NONE);
  assert.equal(rememberedArea(one,mem),'');
  assert.equal(rememberedArea(legacy,mem),'');
  assert.equal(rememberedArea(noNoneCol,mem),'');
  assert.equal(rememberedArea(tagged,mem),'');
  // 한 줄 업데이트·이름 없는 보고는 기억을 만들지 않는다.
  assert.equal(areaMemory([row('y','',null,{business_area_id:'area-1'}),row('z','한 줄','2026-11-01T00:00:00Z',{business_area_id:'area-1',activity_kind:'oneline'})]).size,0);
});

test('저장은 기존 PATCH 길(saveOne) 하나, 사업 보고를 읽을 때마다 붙이고 새 DB 칸·기기 저장 없음',()=>{
  const tag=read('report-area-tag.js'),team=read('team.js');
  assert.match(tag,/export async function applyRememberedAreas\(meetings,\{api,workspace\}=\{\}\)/);
  assert.match(tag,/saveOne\(\{api\},workspace,id,value,hasAreaNone\(m\)\)/);
  assert.match(team,/await rememberAreas\(\);\n\}/);
  assert.match(team,/tag\.applyRememberedAreas\(meetings,\{api,workspace:wid\}\)/);
  for(const src of [tag,team.slice(team.indexOf('async function rememberAreas'),team.indexOf('async function rememberAreas')+800)])assert.doesNotMatch(src,new RegExp(['local','session'].map(k=>k+'Storage').join('|'))); // 저장 정책 검사(audit)
});
