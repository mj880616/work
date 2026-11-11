// REC-한회의로잇기 PR-4·PR-5 화면 시험의 가짜 Supabase(page.route). 이름·글은 모두 지어낸 것(시안 docs/design/mockups/rec-join.html과 같은 '예시 …').
// 서버(Edge meeting-transcribe join_* · DB 함수 app_meeting_join_apply/undo)가 하는 일을 흉내만 낸다: 두 글 칸 바꾸기, 합치기면 없어질 보고를 휴지통으로·
// 자료 옮기기, 되돌리기(before·joined·all). 보고 목록은 휴지통 보고를 보이지 않는다(RLS app_meetings_trash_hidden과 같음).
import {expect} from '@playwright/test';
import {signInWithSession} from './session-login.mjs';
import {appOrigin} from './test-origin.mjs';

export const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
export const NOW='2026-11-11T02:30:00Z'; // 11:30(서울)
export const id=(p,n)=>`00000000-0000-4000-8000-0000000000${p}${n}`;
export const M1=id('c',1),M2=id('c',2),M3=id('c',3),M4=id('c',4),JOB1=id('b',1),JJ=n=>id('d',n);
export const BEFORE_RESULT='결정\n- 예시 앞 녹음 결정';
export const FIRST_NOTES='예시 첫 녹음 전사 글입니다.';
export const LATER_RESULT='결정\n- 예시 뒤 회의 결정';
export const LATER_NOTES='예시 뒤 회의 전사 글입니다.';
export const RESULT='결정\n- 두 전사 전체로 다시 요약한 예시 결정\n\n공유\n- 예시 공유 사항';
export const DRAFT={decisions:'두 전사 전체로 다시 요약한 예시 결정',information:'예시 공유 사항',attendees:[],actions:[{task:'예시 회의실 잡기',assignee:'',due:''}]};

export function makeState(){
  const meeting=(mid,name,at,extra={})=>({id:mid,workspace_id:'rec-ws',title:name,series_name:name,round_no:null,meeting_at:at,activity_kind:'meeting',project_id:null,
    location:null,attendees:null,transcript_text:'',notes:'',deleted_at:null,created_by:'rec-user',created_at:at,updated_at:'2026-11-11T01:40:00.123456+00:00',...extra});
  const doc=(n,mid,name,at)=>({id:id('e',n),workspace_id:'rec-ws',project_id:null,meeting_id:mid,title:name,category:'회의자료',tags:['회의자료','회의녹음'],file_id:`drive-file-000${n}`,
    file_name:`${name}.webm`,mime_type:'audio/webm',file_size:204800,created_at:at});
  return {
    meetings:[
      meeting(M1,'예시 집행위','2026-11-11T01:02:00Z',{transcript_text:BEFORE_RESULT,notes:FIRST_NOTES}),
      meeting(M2,'예시 간담회','2026-11-11T06:00:00Z'),
      meeting(M3,'예시 집행위','2026-11-04T01:00:00Z',{transcript_text:'결정\n- 지난주 예시 결정',notes:'지난주 예시 전사'}),
      meeting(M4,'예시 집행위','2026-11-11T02:05:00Z',{transcript_text:LATER_RESULT,notes:LATER_NOTES}),
    ],
    docs:[doc(1,M1,'녹음 10-02','2026-11-11T01:40:00Z'),doc(4,M4,'녹음 11-05','2026-11-11T02:20:00Z')],
    tasks:{},candidates:[],candidatePosts:[],joinRows:[],calls:[],meetingWrites:[],
    candidatesFor:{[M4]:[{meeting_id:M1,seconds:2280}]},
    joinListJobs:[],unknown:false,applyNow:false,refuse:{},jobId:0,
  };
}
export const joinView=r=>({id:r.id,mode:r.mode,status:r.status,stage:r.stage,step_no:r.step_no||0,step_total:r.step_total||1,error_code:r.error_code||null,target_meeting_id:r.target_meeting_id,
  source_job_id:r.source_job_id||null,source_meeting_id:r.source_meeting_id||null,applied_at:r.applied_at||null,undone_at:r.undone_at||null,seen_at:r.seen_at||null,
  candidates_closed_at:r.candidates_closed_at||null,created_at:r.created_at,finished_at:r.finished_at||null});
const meetingOf=(s,mid)=>s.meetings.find(x=>x.id===mid);
// DB 함수 app_meeting_join_apply 흉내: 두 글 칸 바꾸기(+ 합치기면 자료를 옮기고 없어질 보고를 휴지통으로).
export function apply(s,row){
  const m=meetingOf(s,row.target_meeting_id),src=row.source_meeting_id?meetingOf(s,row.source_meeting_id):null;
  const merged=`${m.notes}\n\n― 이어서 · 11:05 녹음 ―\n${src?src.notes:'예시 둘째 전사 글입니다.'}`;
  Object.assign(row,{before_result:m.transcript_text,before_notes:m.notes,result_text:RESULT,draft:DRAFT,transcript_text:merged,status:'done',stage:'done',applied_at:'2026-11-11T02:31:00Z',finished_at:'2026-11-11T02:31:00Z',moved:[]});
  Object.assign(m,{transcript_text:RESULT,notes:merged,updated_at:'2026-11-11T02:31:00.654321+00:00'});
  if(src){
    for(const d of s.docs)if(d.meeting_id===src.id){d.meeting_id=m.id;row.moved.push(d.id)}
    src.deleted_at='2026-11-11T02:31:00Z';
  }
}
// DB 함수 app_meeting_join_undo 흉내.
export function undo(s,row,scope){
  const m=meetingOf(s,row.target_meeting_id);
  if(scope!=='all'){Object.assign(m,{transcript_text:scope==='before'?row.before_result:row.result_text,updated_at:`2026-11-11T02:3${scope==='before'?5:6}:00.000001+00:00`});return}
  Object.assign(m,{transcript_text:row.before_result,notes:row.before_notes,updated_at:'2026-11-11T02:40:00.000001+00:00'});
  if(row.source_meeting_id){const src=meetingOf(s,row.source_meeting_id);src.deleted_at=null;for(const d of s.docs)if(row.moved.includes(d.id))d.meeting_id=src.id}
  Object.assign(row,{status:'undone',undone_at:NOW});
}

export async function mock(page,s,extra=null){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method(),q=url.searchParams;
    const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
    const eq=k=>String(q.get(k)||'').replace(/^eq\./,'');
    if(extra&&await extra({req,url,path,method,q,ok,eq}))return;
    if(path==='/auth/v1/token')return ok({access_token:'join-access',refresh_token:'join-refresh',expires_in:86400,user:{id:'rec-user'}});
    if(path==='/auth/v1/user')return ok({id:'rec-user',email:'rec@example.org',user_metadata:{display_name:'예시 사용자'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rec-ws',user_id:'rec-user',role:'owner',email:'rec@example.org',workspace:{id:'rec-ws',name:'예시 공간'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'rec-ws',name:'예시 공간'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'rec-user',display_name:'예시 사용자'}]);
    if(path==='/rest/v1/app_meetings'){
      if(method!=='GET'){s.meetingWrites.push({method,search:url.search});return ok([])}
      const ids=(q.get('id')||'').match(/^in\.\((.*)\)$/)?.[1]?.split(',')||(eq('id')?[eq('id')]:null);
      let rows=s.meetings.filter(m=>!m.deleted_at&&(!ids||ids.includes(m.id))); // 휴지통 보고는 보이지 않음
      if(q.get('notes')==='neq.')rows=rows.filter(m=>String(m.notes||'')!=='');
      const from=q.getAll('meeting_at').find(v=>v.startsWith('gte.'))?.slice(4),to=q.getAll('meeting_at').find(v=>v.startsWith('lt.'))?.slice(3);
      if(from)rows=rows.filter(m=>Date.parse(m.meeting_at)>=Date.parse(from));
      if(to)rows=rows.filter(m=>Date.parse(m.meeting_at)<Date.parse(to));
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
      if(method==='POST'){const body=req.postDataJSON();s.candidatePosts.push(body);return ok(body.map((r,i)=>({id:`c0000000-0000-4000-8000-${String(s.candidatePosts.length*10+i).padStart(12,'0')}`})),201)}
      return ok([]);
    }
    if(path==='/functions/v1/meeting-transcribe'){
      const action=q.get('action');
      const body=action==='rec_piece'||action==='join_text'?null:(()=>{try{return JSON.parse(req.postData()||'{}')}catch{return {}}})();
      s.calls.push({action,body});
      const unknown=()=>ok({ok:false,code:'bad_request',error:'요청을 확인하지 못했어요.'},400); // 옛 Edge: 모르는 action
      if(action==='rec_pending')return ok({ok:true,sessions:[],live:[]});
      if(action==='job_list')return ok({ok:true,jobs:[]});
      if(action.startsWith('join_')&&s.unknown)return unknown();
      if(action==='join_list')return ok({ok:true,jobs:s.joinListJobs.map(joinView)});
      if(action==='join_candidates')return ok({ok:true,candidates:s.candidatesFor[body.meeting_id||body.job_id]||[]});
      if(action==='join_start'){
        const refuse=s.refuse[body.target_meeting_id];
        if(refuse)return ok({ok:false,code:refuse.code,error:refuse.error},refuse.status);
        const report=!!body.source?.meeting_id;
        const row={id:JJ(++s.jobId),mode:report?'report':'job',status:'queued',stage:'summary',step_no:0,step_total:1,target_meeting_id:body.target_meeting_id,
          source_job_id:report?null:body.source.job_id,source_meeting_id:report?body.source.meeting_id:null,created_at:NOW};
        s.joinRows.push(row);return ok({ok:true,job:joinView(row)});
      }
      if(action==='join_read'){
        const row=s.joinRows.find(r=>r.id===body.job_id);if(!row)return ok({ok:false,code:'not_found',error:'전사 작업을 찾지 못했어요.'},404);
        if(['queued','running'].includes(row.status)){if(s.applyNow)apply(s,row);else row.status='running'}
        return ok({ok:true,job:joinView(row)});
      }
      if(action==='join_seen'){const row=s.joinRows.find(r=>r.id===body.job_id);if(row){if(body.candidates)row.candidates_closed_at=NOW;else row.seen_at=NOW}return ok({ok:true})}
      if(action==='join_undo'){
        const row=s.joinRows.find(r=>r.id===body.job_id);
        if(s.undoRefuse)return ok({ok:false,code:s.undoRefuse.code,error:s.undoRefuse.error},409);
        undo(s,row,body.scope);
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

export async function signIn(page,s,{width=1280,view='reports',extra=null,init=null}={}){
  await page.setViewportSize({width,height:width>760?860:915});
  await page.clock.setFixedTime(new Date(NOW));
  if(init)await init(page);
  await mock(page,s,extra);
  const returnTo=`${appOrigin}/app/?view=${view}`;
  await page.goto(`${appOrigin}/app/login/?return=${encodeURIComponent(returnTo)}`);
  await signInWithSession(page,'rec@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await page.waitForFunction(()=>!!window.KPTUMeetingJoin&&!!window.KPTUMeetingRecorder);
  // 앱을 연 뒤 한 번 묻는 join_list(2.5초 뒤)의 답까지 — 그 답으로 메뉴 [다른 보고에 합치기]를 그릴지 정한다.
  await expect.poll(()=>s.calls.filter(c=>c.action==='join_list').length,{timeout:15000}).toBeGreaterThan(0);
}
export const calls=(s,action)=>s.calls.filter(c=>c.action===action);
export const joinLine=page=>page.locator('#noticeBar [data-notice="join"]');
