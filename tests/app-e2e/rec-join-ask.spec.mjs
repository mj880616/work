// REC-한회의로잇기 PR-3(S59-14, 설계 docs/design/rec-join.md 3-3·3-4·3-5절, 시안 docs/design/mockups/rec-join.html ①②③): 두 번 녹음한 회의를 한 보고로.
// ① PC 노트북 녹음: 같은 날 녹음으로 쓴 보고가 있으면 정리 결과를 열기 전에 한 번 묻고, [그 보고에 잇기]면 창 없이 서버가 뒤에서 잇는다(띠는 바로 닫힘) →
//    맨 위 '○○에 잇는 중' → '○○ 보고에 이어 붙였어요 [열기][되돌리기]' → 할 일은 후보로만(이미 붙은 할 일 제목은 뺌) → 보고 상세 [합치기 전 글로 되돌리기].
// ② 서버가 잇기를 모르면(옛 Edge·표 적용 전) 묻지 않고 지금 길, [새로 만들기]도 지금 길(초안 창).
// ③ 폰 412: [다른 보고 선택](같은 날 보고부터) → 거절되면 결과는 띠 [초안 열기]에 → 다시 [그 보고에 잇기] → 끝 줄 [되돌리기](통째로) → 띠 [초안 열기].
// ④ 수정 저장은 '읽었을 때 그대로일 때만': 그 사이 바뀌면 덮지 않고 묻고, [내 글로 저장]을 골라야 지금 판 위에 저장한다.
// ⑤ 앱을 다시 열면 잇지 못한 줄이 다시 보이고 [새 보고로 열기]는 묻지 않고 초안 창, 폰 알림 주소(?join_job=)는 그 보고를 연다.
// 실제 마이크·운영 서버는 쓰지 않는다: 가짜 녹음기와 가짜 Supabase(page.route). 이름·글은 모두 지어낸 것(시안과 같은 '예시 …').
// KPTU_SHOTS=1이면 docs/design/screens/s59-14/에 화면 사진을 남긴다(PR 첨부용).
import {test,expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';
import {appOrigin} from './helpers/test-origin.mjs';

test.use({timezoneId:'Asia/Seoul'});

const BASE=appOrigin;
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOTS=process.env.KPTU_SHOTS==='1';
const shot=async(page,name)=>{if(SHOTS){await page.waitForTimeout(250);await page.screenshot({path:`docs/design/screens/s59-14/${name}.png`})}};
const NOW='2026-11-11T02:30:00Z'; // 11:30(서울)
const id=(p,n)=>`00000000-0000-4000-8000-0000000000${p}${n}`;
const M1=id('c',1),M2=id('c',2),M3=id('c',3),JOB1=id('b',1),JOB2=id('b',2),JJ=n=>id('d',n);
const BEFORE_RESULT='결정\n- 예시 앞 녹음 결정';
const FIRST_NOTES='예시 첫 녹음 전사 글입니다.';
const MERGED_NOTES=`${FIRST_NOTES}\n\n― 이어서 · 11:06 녹음 ―\n예시 둘째 녹음 전사 글입니다.`;
const RESULT='결정\n- 두 녹음 전체로 다시 요약한 예시 결정\n\n공유\n- 예시 공유 사항';
const DRAFT={decisions:'두 녹음 전체로 다시 요약한 예시 결정',information:'예시 공유 사항',attendees:[],
  actions:[{task:'예시 자료 돌리기',assignee:'예시 간사',due:'2026-11-13'},{task:'예시 회의실 잡기',assignee:'',due:''}]};

function makeState(){
  const meeting=(mid,name,at,extra={})=>({id:mid,workspace_id:'rec-ws',title:name,series_name:name,round_no:null,meeting_at:at,activity_kind:'meeting',project_id:null,
    location:null,attendees:null,transcript_text:'',notes:'',created_by:'rec-user',created_at:at,updated_at:'2026-11-11T01:40:00.123456+00:00',...extra});
  return {
    meetings:[
      meeting(M1,'예시 집행위','2026-11-11T01:02:00Z',{transcript_text:BEFORE_RESULT,notes:FIRST_NOTES}),
      meeting(M2,'예시 간담회','2026-11-11T06:00:00Z'),
      meeting(M3,'예시 집행위','2026-11-04T01:00:00Z',{transcript_text:'결정\n- 지난주 예시 결정',notes:'지난주 예시 전사'}),
    ],
    docs:[{id:id('e',1),workspace_id:'rec-ws',project_id:null,meeting_id:M1,title:'녹음 10-02',category:'회의자료',tags:['회의자료','회의녹음'],file_id:'drive-file-0001',file_name:'녹음 10-02.webm',mime_type:'audio/webm',file_size:204800,created_at:'2026-11-11T01:40:00Z'}],
    tasks:{[M1]:[{id:'gt-1',title:'예시 자료 돌리기 (예시 간사)',due:null,status:'needsAction'}]},
    candidates:[],candidatePosts:[],joinRows:[],calls:[],meetingWrites:[],patchUrls:[],
    candidatesFor:{[JOB1]:[{meeting_id:M1,seconds:2280}],[JOB2]:[{meeting_id:M1,seconds:2280}]},
    joinListJobs:[],applyNow:false,refuse:{},jobId:0,
  };
}
const joinView=r=>({id:r.id,mode:r.mode,status:r.status,stage:r.stage,step_no:r.step_no||0,step_total:r.step_total||1,error_code:r.error_code||null,target_meeting_id:r.target_meeting_id,
  source_job_id:r.source_job_id||null,source_meeting_id:null,applied_at:r.applied_at||null,undone_at:r.undone_at||null,seen_at:r.seen_at||null,candidates_closed_at:r.candidates_closed_at||null,created_at:r.created_at,finished_at:r.finished_at||null});
// 서버(Edge app_meeting_join_apply)가 하는 일을 흉내: 두 글 칸 바꾸기 + 녹음 자료 행 하나 + 작업 행 끝.
function apply(s,row){
  const m=s.meetings.find(x=>x.id===row.target_meeting_id);
  Object.assign(row,{before_result:m.transcript_text,before_notes:m.notes,result_text:RESULT,draft:DRAFT,status:'done',stage:'done',applied_at:'2026-11-11T02:31:00Z',finished_at:'2026-11-11T02:31:00Z'});
  Object.assign(m,{transcript_text:RESULT,notes:MERGED_NOTES,updated_at:'2026-11-11T02:31:00.654321+00:00'});
  s.docs.push({id:id('e',2),workspace_id:'rec-ws',project_id:null,meeting_id:m.id,title:'녹음 11-06',category:'회의자료',tags:['회의자료','회의녹음'],file_id:'drive-file-0002',file_name:'녹음 11-06.webm',mime_type:'audio/webm',file_size:153600,created_at:'2026-11-11T02:31:00Z'});
}
const serverJob=n=>({id:n===2?JOB2:JOB1,kind:'recording',status:'done',stage:'done',session_id:id('a',n),created_at:'2026-11-11T02:28:00Z',seconds:1320,
  jobs:[id('f',n)],parts:[{job:id('f',n),seconds:1320}],parts_done:1,parts_total:1,step_no:1,step_total:1,
  transcript_text:'예시 둘째 녹음 전사 글입니다.',draft:{decisions:'예시 둘째 결정',information:'예시 둘째 공유',actions:[],meeting_date:'',attendees:[]}});

async function fakeRecorder(page){
  await page.addInitScript(()=>{
    class FakeRecorder extends EventTarget{
      constructor(stream,opts={}){super();this.mimeType=opts.mimeType||'';this.state='inactive';this.n=0;window.__recs=(window.__recs||[]).concat(this)}
      static isTypeSupported(t){return String(t).startsWith('audio/webm')}
      start(){this.state='recording'}
      pause(){this.state='paused'}
      resume(){this.state='recording'}
      requestData(){this.chunk()}
      chunk(){const e=new Event('dataavailable');e.data=new Blob([`piece-${++this.n}-`.repeat(40)],{type:'audio/webm'});this.dispatchEvent(e)}
      stop(){if(this.state==='inactive')return;this.state='inactive';setTimeout(()=>{this.chunk();this.dispatchEvent(new Event('stop'))},0)}
    }
    window.MediaRecorder=FakeRecorder;
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
  });
}

async function mock(page,s){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method(),q=url.searchParams;
    const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
    const eq=k=>String(q.get(k)||'').replace(/^eq\./,'');
    if(path==='/auth/v1/token')return ok({access_token:'join-access',refresh_token:'join-refresh',expires_in:86400,user:{id:'rec-user'}});
    if(path==='/auth/v1/user')return ok({id:'rec-user',email:'rec@example.org',user_metadata:{display_name:'예시 사용자'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rec-ws',user_id:'rec-user',role:'owner',email:'rec@example.org',workspace:{id:'rec-ws',name:'예시 공간'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'rec-ws',name:'예시 공간'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'rec-user',display_name:'예시 사용자'}]);
    if(path==='/rest/v1/app_meetings'){
      if(method==='POST'){s.meetingWrites.push('POST');return ok([{id:id('c',9),workspace_id:'rec-ws',title:'새 보고',series_name:'새 보고',meeting_at:NOW,activity_kind:'meeting'}])}
      if(method==='PATCH'){
        s.patchUrls.push(url.search);
        const m=s.meetings.find(x=>x.id===eq('id'));
        const want=q.get('updated_at');
        if(!m||(want&&want!=='eq.'+m.updated_at))return ok([]);
        const body=req.postDataJSON();s.meetingWrites.push({id:m.id,body});Object.assign(m,body);return ok([m]);
      }
      const ids=(q.get('id')||'').match(/^in\.\((.*)\)$/)?.[1]?.split(',')||(eq('id')?[eq('id')]:null);
      let rows=s.meetings.filter(m=>!ids||ids.includes(m.id));
      if(q.get('select')==='id,updated_at')rows=rows.map(m=>({id:m.id,updated_at:m.updated_at}));
      return ok(rows);
    }
    if(path==='/rest/v1/app_documents'){const mid=eq('meeting_id');return ok(method==='GET'?s.docs.filter(d=>!mid||d.meeting_id===mid):[])}
    if(path==='/rest/v1/app_meeting_join_jobs'){
      const jid=eq('id'),target=eq('target_meeting_id');
      let rows=s.joinRows.filter(r=>(!jid||r.id===jid)&&(!target||r.target_meeting_id===target));
      if(target)rows=rows.filter(r=>r.status==='done'&&r.applied_at);
      return ok(rows);
    }
    if(path==='/rest/v1/app_todo_candidates'){
      if(method==='POST'){
        const body=req.postDataJSON();s.candidatePosts.push(body);const made=[];
        for(const r of body){if(s.candidates.some(c=>c.dedupe_key===r.dedupe_key))continue;const row={...r,id:`c0000000-0000-4000-8000-${String(s.candidates.length+1).padStart(12,'0')}`,status:'open',task_id:null,task_due:null,created_at:NOW,decided_at:null};s.candidates.push(row);made.push({id:row.id})}
        return ok(made,201);
      }
      const src=q.get('source_id');return ok(s.candidates.filter(c=>!src||'eq.'+c.source_id===src));
    }
    if(path==='/functions/v1/meeting-transcribe'){
      const action=q.get('action');
      const body=action==='rec_piece'?null:(()=>{try{return JSON.parse(req.postData()||'{}')}catch{return {}}})();
      s.calls.push({action,body});
      if(action==='rec_pending')return ok({ok:true,sessions:[],live:[]});
      if(action==='rec_start')return ok({ok:true,recording_id:id('0',1),session_id:id('a',1),segment_no:1,piece_seconds:300,segment_seconds:3540});
      if(action==='rec_piece')return ok({ok:true,pieces:1});
      if(action==='job_list')return ok({ok:true,jobs:[]});
      if(action==='job_start')return ok({ok:true,job:{id:JOB1,kind:'recording',status:'queued',stage:'combine',session_id:body.session_id,parts_done:0,parts_total:0,step_no:0,step_total:0,jobs:[]}});
      if(action==='job_read')return ok({ok:true,job:serverJob(body.job_id===JOB2?2:1)});
      if(action==='join_candidates'){
        if(s.unknown)return ok({ok:false,code:'bad_request',error:'요청을 확인하지 못했어요.'},400); // 옛 Edge: 모르는 action
        return ok({ok:true,candidates:s.candidatesFor[body.job_id]||[]});
      }
      if(action==='join_start'){
        const refuse=s.refuse[body.target_meeting_id];
        if(refuse)return ok({ok:false,code:refuse.code,error:refuse.error},refuse.status);
        const row={id:JJ(++s.jobId),mode:'job',status:'queued',stage:'summary',step_no:0,step_total:1,target_meeting_id:body.target_meeting_id,source_job_id:body.source.job_id,created_at:NOW};
        s.joinRows.push(row);return ok({ok:true,job:joinView(row)});
      }
      if(action==='join_read'){
        const row=s.joinRows.find(r=>r.id===body.job_id);if(!row)return ok({ok:false,code:'not_found',error:'전사 작업을 찾지 못했어요.'},404);
        if(['queued','running'].includes(row.status)){if(s.applyNow)apply(s,row);else row.status='running'}
        return ok({ok:true,job:joinView(row)});
      }
      if(action==='join_list')return ok({ok:true,jobs:s.joinListJobs.map(joinView)});
      if(action==='join_seen'){const row=s.joinRows.find(r=>r.id===body.job_id);if(row){if(body.candidates)row.candidates_closed_at=NOW;else row.seen_at=NOW}return ok({ok:true})}
      if(action==='join_retry'){
        const old=s.joinRows.find(r=>r.id===body.job_id);old.seen_at=NOW;
        const row={...old,id:JJ(++s.jobId),status:'queued',stage:'summary',error_code:null,seen_at:null};s.joinRows.push(row);
        return ok({ok:true,job:joinView(row),restarted:true});
      }
      if(action==='join_undo'){
        const row=s.joinRows.find(r=>r.id===body.job_id),m=s.meetings.find(x=>x.id===row.target_meeting_id);
        if(body.scope==='all'){Object.assign(m,{transcript_text:row.before_result,notes:row.before_notes,updated_at:'2026-11-11T02:40:00.000001+00:00'});s.docs=s.docs.filter(d=>d.id!==id('e',2));Object.assign(row,{status:'undone',undone_at:NOW})}
        else Object.assign(m,{transcript_text:body.scope==='before'?row.before_result:row.result_text,updated_at:`2026-11-11T02:3${body.scope==='before'?5:6}:00.000001+00:00`});
        return ok({ok:true,scope:body.scope,undone:body.scope==='all',kept:false});
      }
      return ok({ok:true});
    }
    if(path==='/functions/v1/google-tasks'){
      if(q.get('action')==='linked')return ok({tasks:s.tasks[q.get('meeting_id')]||[],needs_reconnect:false});
      s.calls.push({action:'google-tasks:'+q.get('action')});return ok({tasks:[],needs_reconnect:false});
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page,s,{width=1280,view='reports',extra=''}={}){
  await page.setViewportSize({width,height:width>760?860:915});
  await page.clock.setFixedTime(new Date(NOW));
  await fakeRecorder(page);
  await mock(page,s);
  const returnTo=`${BASE}/app/?view=${view}${extra}`;
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(returnTo)}`);
  await signInWithSession(page,'rec@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await page.waitForFunction(()=>!!window.KPTUMeetingJoin&&!!window.KPTUMeetingRecorder);
}
const calls=(s,action)=>s.calls.filter(c=>c.action===action);
const askBox=page=>page.locator('.kptu-ask.rec-join-ask');
const joinLine=page=>page.locator('#noticeBar [data-notice="join"]');
// 서버 정리 결과 하나를 띠에 넘긴다(폰 앱 녹음이 쓰는 길, phone-recorder.js → KPTUMeetingRecorder.watch).
const watchResult=(page,job)=>page.evaluate(j=>window.KPTUMeetingRecorder.watch({id:j}),job);




test('④ 수정 저장은 읽었을 때 그대로일 때만: 그 사이 바뀌면 덮지 않고 묻고, [내 글로 저장]이면 지금 판 위에 저장한다',async({page})=>{
  test.setTimeout(90000);
  const s=makeState();
  await signIn(page,s);
  await page.evaluate(m=>window.KPTUMeetingRoundDetail.open(m),M1);
  const detail=page.locator('#meetingRoundDetailModal');
  await expect(detail.locator('#mrdResult')).toContainText('예시 앞 녹음 결정',{timeout:15000});
  await expect(detail.locator('#mrdJoinTools')).toBeHidden(); // 이은 줄이 없는 보고는 잇기 기록을 읽지 않는다
  await detail.locator('#mrdMore').click();
  await page.locator('[data-mrd-more="edit"]').click();
  await expect(page.locator('#mrdEditTranscript')).toHaveValue(BEFORE_RESULT);
  await page.locator('#mrdEditTranscript').fill('내가 수정한 예시 결과');
  // 그 사이 서버에서 이 보고에 녹음을 이어 붙임(다른 기기).
  const m1=s.meetings.find(m=>m.id===M1);
  Object.assign(m1,{transcript_text:RESULT,notes:MERGED_NOTES,updated_at:'2026-11-11T02:31:00.654321+00:00'});
  await page.locator('#mrdSaveEdit').click();
  const status=page.locator('#mrdEditStatus');
  await expect(status).toContainText('그 사이 다른 곳에서 이 보고가 바뀌어 저장하지 않았어요. 입력은 남겨 뒀어요.');
  await expect(status.getByRole('button')).toHaveText(['바뀐 글 보기','내 글로 저장']);
  expect(s.patchUrls[0]).toContain('updated_at=eq.2026-11-11T01%3A40%3A00.123456%2B00%3A00');
  expect(m1.transcript_text).toBe(RESULT);
  await expect(page.locator('#mrdEditTranscript')).toHaveValue('내가 수정한 예시 결과');
  await shot(page,'pc-1280-edit-conflict');
  // [내 글로 저장]: 지금 판을 다시 읽어 그 위에 내 글로.
  await status.getByRole('button',{name:'내 글로 저장'}).click();
  await expect(detail.locator('#mrdResult')).toContainText('내가 수정한 예시 결과',{timeout:15000});
  expect(s.patchUrls.at(-1)).toContain('updated_at=eq.2026-11-11T02%3A31%3A00.654321%2B00%3A00');
  expect(m1.transcript_text).toBe('내가 수정한 예시 결과');
});


test('⑥ 폰 알림 주소(?join_job=)는 끝난 잇기의 보고를 바로 열고 끝 줄은 닫는다',async({page})=>{
  test.setTimeout(90000);
  const s=makeState();
  const row={id:JJ(8),mode:'job',status:'queued',stage:'summary',target_meeting_id:M1,source_job_id:JOB1,created_at:NOW};
  apply(s,row);row.candidates_closed_at=NOW;s.joinRows.push(row);s.joinListJobs=[row];
  await signIn(page,s,{extra:`&join_job=${JJ(8)}`});
  const detail=page.locator('#meetingRoundDetailModal');
  await expect(detail.locator('#mrdResult')).toContainText('두 녹음 전체로 다시 요약한 예시 결정',{timeout:15000});
  await expect(joinLine(page)).toHaveCount(0);
  expect(calls(s,'join_seen').map(c=>c.body)).toContainEqual({job_id:JJ(8)});
  expect(new URL(page.url()).searchParams.get('join_job')).toBeNull();
});
