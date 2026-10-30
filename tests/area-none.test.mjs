// MTG-사업영역없음(요청 10/30 07:51): 사업영역 고르기 [없음] — 규칙(business-area-model.mjs)과 화면 연결(정적 검사).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as m from '../app/business-area-model.mjs';

const read=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
const tree=[{project:{id:'A',name:'사업영역 A'},depth:0},{project:{id:'A1',name:'세부'},depth:1},{project:{id:'B',name:'사업영역 B'},depth:0}];

test('[없음] = 칸 business_area_none true + 꼬리표 빈 것. 꼬리표가 있으면 꼬리표가 이긴다. 칸 없는 줄은 [없음] 없음',()=>{
  assert.equal(m.isAreaNone({business_area_id:null,business_area_none:true}),true);
  assert.equal(m.isAreaNone({business_area_id:'A',business_area_none:true}),false);
  assert.equal(m.isAreaNone({business_area_id:null,business_area_none:false}),false);
  assert.equal(m.isAreaNone({business_area_id:null}),false);
  assert.equal(m.hasAreaNone({business_area_id:null}),false);
  assert.equal(m.hasAreaNone({business_area_none:false}),true);
  // 옛 보고의 첫 연결 사업영역은 [없음]이면 빌려 보이지 않는다(꼬리표 안 붙음).
  assert.deepEqual(m.shownArea({business_area_id:null,business_area_none:true,project_id:'A'}),{id:'',legacy:false,none:true});
  assert.deepEqual(m.shownArea({business_area_id:null,business_area_none:false,project_id:'A'}),{id:'A',legacy:true});
  assert.deepEqual(m.shownArea({business_area_id:'B',business_area_none:true}),{id:'B',legacy:false});
});

test('저장 몸통: [없음] → 꼬리표 비움 + true, 사업영역 → 그 id + false, 고르기 → 둘 다 비움. 칸 없는 서버는 business_area_none을 보내지 않는다',()=>{
  assert.deepEqual(m.areaBody(m.AREA_NONE),{business_area_id:null,business_area_none:true});
  assert.deepEqual(m.areaBody('A'),{business_area_id:'A',business_area_none:false});
  assert.deepEqual(m.areaBody(''),{business_area_id:null,business_area_none:false});
  assert.deepEqual(m.areaBody('A',false),{business_area_id:'A'});
  assert.deepEqual(m.areaBody('',false),{business_area_id:null});
});

test("[없음]을 고른 보고는 '안 단 보고' 개수·[달기] 창·미리보기 '안 단 보고'에서 빠진다",()=>{
  const ms=[
    {id:'a',business_area_id:null,business_area_none:false,meeting_at:'2026-10-27T01:00:00Z'},
    {id:'n',business_area_id:null,business_area_none:true,meeting_at:'2026-10-28T01:00:00Z'},
    {id:'t',business_area_id:'A',business_area_none:false,meeting_at:'2026-10-29T01:00:00Z'}
  ];
  assert.deepEqual(m.untaggedInWeek(ms,'2026-10-26').map(x=>x.id),['a']);
  const p=m.previewRecords(ms,{from:'2026-10-26',to:'2026-11-01'});
  assert.deepEqual(p.untagged.map(x=>x.id),['a']);
  assert.deepEqual(p.records.map(r=>r.meeting),['t']);
  assert.equal(p.all.length,3);
});

test("사업 보고 거르기: [없음] 보고는 '사업영역 없음 n' 한 묶음, 안 고른 보고는 '안 단 보고 n'",()=>{
  const ms=[
    {id:'n1',business_area_id:null,business_area_none:true,project_id:'A'},
    {id:'n2',business_area_id:null,business_area_none:true},
    {id:'u',business_area_id:null,business_area_none:false},
    {id:'t',business_area_id:'A1',business_area_none:false}
  ];
  assert.deepEqual(m.areaChipOptions(ms,tree),[{value:'all',label:'전체'},{value:'A',label:'사업영역 A'},{value:m.AREA_NONE,label:'사업영역 없음 2'},{value:m.NO_AREA,label:'안 단 보고 1'}]);
  const roots=m.areaRoots(tree);
  assert.deepEqual(ms.filter(x=>m.matchesAreaChip(x,m.AREA_NONE,roots)).map(x=>x.id),['n1','n2']);
  assert.deepEqual(ms.filter(x=>m.matchesAreaChip(x,m.NO_AREA,roots)).map(x=>x.id),['u']);
  assert.deepEqual(ms.filter(x=>m.matchesAreaChip(x,'A',roots)).map(x=>x.id),['t']);
  assert.notEqual(m.AREA_NONE,m.NO_AREA);
});

test('화면 연결(전수): [달기] 창·쓰기/고치기 창은 [없음]을 두고, 한 줄 업데이트 창은 두지 않는다. AI 추천은 [없음]을 미리 고르지 않는다',()=>{
  const tag=read('report-area-tag.js');
  assert.match(tag,/<option value="">고르기<\/option>\$\{options\}/);
  assert.match(tag,/withNone\?`<option value="\$\{AREA_NONE\}" class="area-tag-none">\$\{NONE_LABEL\}<\/option>`:''\)\+\(places\?\.projects/); // '고르기' 바로 아래
  assert.match(tag,/withNone:list\.every\(hasAreaNone\)/);
  assert.match(tag,/areaBody\(value,withNone\)/);
  assert.doesNotMatch(tag,/presetArea\([^)]*AREA_NONE/);
  const sheet=read('report-places-sheet.js');
  assert.match(sheet,/allowNone\?\[\{project:\{id:'',name:'고르지 않음'\},depth:0\},\{project:\{id:AREA_NONE,name:'없음'\}/);
  const fields=read('business-area-fields.js');
  assert.match(fields,/allowNone:noneReady/);
  assert.match(fields,/const pickArea=id=>\{const v=String\(id\|\|''\);none=noneReady&&v===AREA_NONE;area=v===AREA_NONE\?'':v;legacy=false;touched=true;/);
  assert.match(fields,/noneReady=hasAreaNone\(meeting\)/);
  assert.match(fields,/areaNoneAvailable\(\)\.then/);
  assert.match(fields,/Object\.assign\(out,areaBody\(none\?AREA_NONE:legacy\?'':area,noneReady\)\)/);
  assert.match(fields,/suggest\(id\)\{if\(touched\|\|none\|\|/);
  assert.doesNotMatch(read('report-oneline.js'),/allowNone/);
  assert.match(read('report-links.js'),/areaNoneAvailable=\(rt\)=>probe\('areaNone','\/rest\/v1\/app_meetings\?select=business_area_none&limit=1'/);
  const team=read('team.js');
  assert.match(team,/noteAreaNoneFromMeetings\(meetings\)/);
  assert.match(team,/areaChip!==NO_AREA&&areaChip!==AREA_NONE\?areaChip:''/);
  // 기기 저장 없음은 저장소 전체 검사(Browser storage audit)가 본다.
});
