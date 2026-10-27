// MTG-사업보고 6~8단계: 연결 규칙(순수), 양쪽 연결 일치(가짜 서버), DB-2 적용 전 대체 동작, 주간보고 칸 표시, 화면에 남은 '회의' 문구.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from '../app/report-links-model.mjs';

const P1={kind:'project',id:'11111111-1111-4111-8111-111111111111'},P2={kind:'project',id:'22222222-2222-4222-8222-222222222222'},O1={kind:'organization',id:'33333333-3333-4333-8333-333333333333'};

test('연결 목록: 같은 곳은 한 번, 모르는 종류는 버림, 20곳 한도', () => {
  assert.deepEqual(M.targetList([P1,P1,{kind:'x',id:'1'},null,O1]), [P1,O1]);
  assert.deepEqual(M.withTarget([P1],P1), [P1]);
  assert.deepEqual(M.withTarget([P1],O1), [P1,O1]);
  const full=Array.from({length:20},(_, i)=>({kind:'project',id:'p'+i}));
  assert.equal(M.withTarget(full,O1), null);
  assert.deepEqual(M.withoutTarget([P1,O1],P1), [O1]);
  assert.throws(()=>M.rpcTargets([...full,O1]), RangeError);
  assert.deepEqual(M.rpcTargets([P1,O1]), [{kind:'project',target_id:P1.id},{kind:'organization',target_id:O1.id}]);
  assert.equal(M.firstProjectId([O1,P2,P1]), P2.id);
  assert.equal(M.firstProjectId([O1]), null);
});

test('연결 줄 → 곳: 보낸 기록(요약)이 있는 줄을 표시한다', () => {
  const t=M.targetsFromLinkRows([{id:'a',project_id:P1.id,summary:null},{id:'b',organization_id:O1.id,summary:'  보낸 글 '},{id:'c',project_id:P1.id}]);
  assert.deepEqual(t.map(x=>[x.kind,x.id,x.hasSummary]), [['project',P1.id,false],['organization',O1.id,true]]);
});

test('프로젝트·조직 목록: 연결 줄과 옛 project_id 를 합치고 모든 종류를 최근 순으로, 칸 없는 옛 행은 회의', () => {
  const press={id:'m2',series_name:'철도 파업 출정 기자회견',meeting_at:'2026-10-21T01:00:00Z',activity_kind:'press'};
  const old={id:'m1',series_name:'궤도집행국회의',round_no:12,meeting_at:'2026-10-20T05:00:00Z'};
  const rows=M.linkedReportRows([{id:'l1',report:press},{id:'l2',report:old},{id:'l3',report:null}],[old,{id:'m0',title:'옛 회의',meeting_at:'2026-09-01T00:00:00Z'}]);
  assert.deepEqual(rows.map(r=>r.id), ['m2','m1','m0']);
  assert.equal(rows.find(r=>r.id==='m1').linked, true);   // 같은 id 는 연결 줄이 이긴다
  assert.equal(rows.find(r=>r.id==='m0').linked, false);
  assert.deepEqual(rows.map(M.reportKindTag), ['언론','회의','회의']);
  assert.equal(M.reportTitle(old), '궤도집행국회의 12차');
  assert.equal(M.reportTitle({}), '이름 없음');
  assert.equal(M.targetsLabel([P1,O1,P2], t=>t.id===P1.id?'가':'나'), '가 외 2');
  assert.equal(M.targetsLabel([], ()=>'x', '연결 안 함'), '연결 안 함');
});

test('연결 고르기 목록: 이미 연결된 보고는 빼고 최근 순, 한 줄은 [종류] 이름', () => {
  const list=M.pickableReports([{id:'a',series_name:'가',meeting_at:'2026-01-01T00:00:00Z'},{id:'b',series_name:'나',meeting_at:'2026-02-01T00:00:00Z',activity_kind:'policy'}],new Set(['a']));
  assert.deepEqual(list.map(x=>x.id), ['b']);
  assert.equal(M.pickerLine(list[0]), '[정책] 나');
});

// ---- 가짜 서버: 연결 표 + 사업 보고 표를 메모리에 두고 report-links.js 가 부르는 길만 흉내 낸다 ----
function fakeRuntime({dbTwo=true}={}){
  const meetings=new Map([['m1',{id:'m1',series_name:'본부집행위',meeting_at:'2026-10-20T05:00:00Z',updated_at:'v1',project_id:null,activity_kind:'meeting'}]]);
  const links=[];const calls=[];
  const ws='w1';
  const rt={context:{read:()=>({user:{id:'u1'},workspace:{id:ws}})},
    async api(path,{method='GET',body}={}){
      calls.push(method+' '+path.split('?')[0]);
      const err=(status,message)=>Object.assign(new Error(message),{status});
      if(path.startsWith('/rest/v1/app_record_links?select=source_meeting_id&limit=1')){if(!dbTwo)throw err(400,'column app_record_links.source_meeting_id does not exist');return[]}
      if(path.startsWith('/rest/v1/rpc/app_meeting_set_links')){
        if(!dbTwo)throw err(404,'Could not find the function public.app_meeting_set_links');
        const m=meetings.get(body.p_meeting_id);if(!m)return {ok:false,error:'MEETING_MISSING'};
        if(m.updated_at!==body.p_meeting_updated_at)return {ok:false,error:'MEETING_CHANGED'};
        const keys=body.p_targets.map(t=>t.kind+':'+t.target_id);
        for(let i=links.length-1;i>=0;i--)if(links[i].source_meeting_id===m.id&&!keys.includes((links[i].project_id?'project:'+links[i].project_id:'organization:'+links[i].organization_id)))links.splice(i,1);
        for(const t of body.p_targets){const has=links.some(l=>l.source_meeting_id===m.id&&(l.project_id===t.target_id||l.organization_id===t.target_id));if(!has)links.push({id:'l'+links.length+t.target_id,source_meeting_id:m.id,project_id:t.kind==='project'?t.target_id:null,organization_id:t.kind==='organization'?t.target_id:null,summary:null})}
        m.project_id=body.p_targets.find(t=>t.kind==='project')?.target_id||null;m.updated_at='v'+(Number(m.updated_at.slice(1))+1);
        return {ok:true,updated_at:m.updated_at};
      }
      if(path.startsWith('/rest/v1/app_record_links?')&&method==='GET'){
        const q=new URLSearchParams(path.split('?')[1]);
        let rows=links.slice();
        if(q.get('source_meeting_id')?.startsWith('eq.'))rows=rows.filter(l=>l.source_meeting_id===q.get('source_meeting_id').slice(3));
        else if(q.get('source_meeting_id')==='not.is.null')rows=rows.filter(l=>l.source_meeting_id);
        for(const col of ['project_id','organization_id'])if(q.get(col)?.startsWith('eq.'))rows=rows.filter(l=>l[col]===q.get(col).slice(3));
        return rows.map(l=>({...l,report:meetings.get(l.source_meeting_id)}));
      }
      if(path.startsWith('/rest/v1/app_meetings?')){
        const q=new URLSearchParams(path.split('?')[1]);
        if(method==='PATCH'){const m=meetings.get(q.get('id').slice(3));Object.assign(m,body);return [{...m}]}
        if(q.get('id'))return [meetings.get(q.get('id').slice(3))].filter(Boolean).map(m=>({...m}));
        if(q.get('project_id'))return [...meetings.values()].filter(m=>m.project_id===q.get('project_id').slice(3));
        return [...meetings.values()];
      }
      throw err(500,'unexpected '+path);
    }};
  return {rt,meetings,links,calls};
}
const R=await import('../app/report-links.js');

test('양쪽 연결 일치: 프로젝트 쪽에서 연결하면 사업 보고 쪽에도, 조직 쪽에서 해제하면 프로젝트 쪽은 그대로', async()=>{
  const {rt,meetings}=fakeRuntime();R.resetProbes();
  let r=await R.changeOneTarget('m1',P1,'add',rt);assert.equal(r.ok,true);
  r=await R.changeOneTarget('m1',O1,'add',rt);assert.equal(r.ok,true);
  assert.deepEqual((await R.readReportTargets('m1',rt)).map(t=>t.kind+':'+t.id),[`project:${P1.id}`,`organization:${O1.id}`]);
  assert.deepEqual((await R.readLinkedReports(P1,rt)).rows.map(m=>m.id),['m1']);
  assert.deepEqual((await R.readLinkedReports(O1,rt)).rows.map(m=>m.id),['m1']);
  assert.equal(meetings.get('m1').project_id,P1.id);               // 옛 칸은 첫 프로젝트
  r=await R.changeOneTarget('m1',O1,'remove',rt);assert.equal(r.ok,true);
  assert.deepEqual((await R.readLinkedReports(O1,rt)).rows,[]);
  assert.deepEqual((await R.readLinkedReports(P1,rt)).rows.map(m=>m.id),['m1']);
  // 5초 되돌리기: 해제 전 목록으로 다시 맞춘다
  const back=await R.restoreTargets('m1',r.previous,rt);assert.equal(back.ok,true);
  assert.deepEqual((await R.readLinkedReports(O1,rt)).rows.map(m=>m.id),['m1']);
});

test('버전이 다르면 거절하고 아무것도 바꾸지 않는다(오류 글자는 일상어)', async()=>{
  const {rt,links}=fakeRuntime();R.resetProbes();
  const r=await R.saveReportTargets({id:'m1',updated_at:'old'},[P1],rt);
  assert.equal(r.ok,false);assert.equal(r.error,'MEETING_CHANGED');assert.match(r.message,/다시 열어/);assert.equal(links.length,0);
});

test('DB-2 적용 전: 칸·함수가 없어도 깨지지 않고 옛 project_id 한 곳으로 읽고 쓰며 담당조직은 건너뛰었다고 알린다', async()=>{
  const {rt,meetings}=fakeRuntime({dbTwo:false});R.resetProbes();
  const r=await R.saveReportTargets({id:'m1',updated_at:'v1'},[P1,O1,P2],rt);
  assert.equal(r.ok,true);assert.equal(r.legacy,true);assert.equal(r.skippedOrgs,2);
  assert.equal(meetings.get('m1').project_id,P1.id);
  assert.deepEqual((await R.readLinkedReports(P1,rt)).rows.map(m=>m.id),['m1']);
  assert.deepEqual((await R.readLinkedReports(O1,rt)).rows,[]);
  assert.deepEqual((await R.readReportTargets('m1',rt)).map(t=>t.id),[P1.id]);
  assert.match(R.LEGACY_NOTE,/서버 준비/);
});

// ---- 8단계 ----
test('주간보고·업무일지 줄: 회의가 아닌 칸은 [칸 이름]을 앞에 붙이고 회의·칸 없는 옛 행은 그대로', async()=>{
  const {meetingLine}=await import('../app/journal-data.js');
  assert.equal(meetingLine({series_name:'본부집행위',round_no:3,meeting_at:'2026-10-20T05:00:00Z'}),'14:00 본부집행위 3차');
  assert.equal(meetingLine({series_name:'본부집행위',round_no:3,meeting_at:'2026-10-20T05:00:00Z',activity_kind:'meeting'}),'14:00 본부집행위 3차');
  assert.equal(meetingLine({series_name:'철도 파업 출정 기자회견',meeting_at:'2026-10-21T01:00:00Z',activity_kind:'press'}),'[언론] 10:00 철도 파업 출정 기자회견');
});

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('화면 문구: 입력·결과 창과 프로젝트·조직 화면은 사업 보고 기준(회의 칸 이름 \'회의\'는 유지)', () => {
  const html=read('app/index.html');
  assert.match(html,/id="meetingModalTitle">사업 보고</);assert.match(html,/>\+ 사업 보고</);assert.match(html,/id="meetingPlaces"/);
  assert.doesNotMatch(html,/회의 결과 저장|\+ 회의 결과|<label>회의명<input id="meetingTitle"/);
  const ps=read('app/project-system-v3.js');assert.match(ps,/<h3>사업 보고 \$\{count/);assert.doesNotMatch(ps,/<h3>회의 \$\{count/);
  const wd=read('app/workplace-detail.js');assert.match(wd,/id="wdReports"/);assert.match(wd,/<h3>사업 보고 </);
  assert.match(read('app/report-kinds.mjs'),/\{value:'meeting',label:'회의'\}/);
  assert.match(read('app/journal-weekly.js'),/meetings:'회의·활동 결과'/);
  assert.doesNotMatch(read('app/journal-weekly.js'),/회의·행사 결과'/);
});
test('연결은 새 서버 경로 없이 기존 함수·표만 쓴다(권한 확대 없음)', () => {
  const src=read('app/report-links.js');
  assert.match(src,/rpc\/app_meeting_set_links/);assert.doesNotMatch(src,new RegExp(`service_role|apikey|local${"Storage"}`));
  assert.match(read('app/basket.js'),/app_record_links',\{method:'POST',body:\{workspace_id:workspaceId,note_id:note\.id,meeting_id:meeting\.id,status:'confirmed'/);
});
