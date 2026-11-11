// S58-4 BIZ-보고할일정 PR B: 일정 달력·홈의 ✓(보고 씀)·□(보고할 일정) 표시 시험이 쓰는 서버 흉내(시험 쪽 메모리, 가짜 일정·가짜 이름만).
// report-plan-toggle.spec.mjs(PR A)의 흉내와 같은 응답 모양이다. 화면 사진 스크립트도 같은 흉내를 쓴다.
export const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
export const iso=(d,t)=>new Date(`${d}T${t}:00+09:00`).toISOString();
const event=(id,title,day,time,extra={})=>({id,calendarId:'own',title,start:iso(day,time),end:new Date(Date.parse(iso(day,time))+3600e3).toISOString(),allDay:false,description:'',location:'',organizationIds:[],recurring:false,source:'google',...extra});
const allDay=(id,title,first,endExclusive,extra={})=>({id,calendarId:'own',title,start:first,end:endExclusive,allDay:true,description:'',location:'',organizationIds:[],recurring:false,source:'google',...extra});
// 오늘 = 2026-11-10(화). 같은 이름 '주간 점검 회의'는 지난 회차에 보고를 썼고(✓) 다음 회차는 같은 이름 기억으로 □.
export const EVENTS=()=>[
  event('done1','주간 점검 회의','2026-11-10','10:00',{location:'가짜 회의실'}),
  event('todo2','분기 계획 모임','2026-11-10','14:00'),
  event('off1','자료 정리','2026-11-10','16:00'),
  event('none1','점심 약속','2026-11-11','12:00'),
  allDay('day1','현장 방문','2026-11-12','2026-11-13'),
  event('todo1','주간 점검 회의','2026-11-17','10:00'),
  allDay('trip1','가을 연수','2026-11-18','2026-11-21'),
  event('ref1','참고 일정','2026-11-13','09:00',{calendarId:'ref'})
];
const plan=(id,eventId,state,title,day,startsAt,by='user')=>({id,google_event_id:eventId,google_calendar_id:'own',state,decided_by:by,decided_at:'2026-11-09T01:00:00.000Z',title,event_day:day,starts_at:startsAt});
const report=(id,eventId,title,at)=>({id,workspace_id:'rp-ws',title,series_name:title,activity_kind:'meeting',meeting_at:at,created_at:at,updated_at:at,notes:'',transcript_text:'가짜 결과 내용',result_status:'final',finalized_at:at,google_event_id:eventId,google_calendar_id:'own',deleted_at:null});
// store=false: 새 표·새 칸이 아직 없는 서버(적용 전·되돌린 뒤). tasks=true: 같은 날 칸에 할 일 한 줄(할 일 □와 일정 □ 비교).
export function server({store=true,tasks=true}={}){
  return {store,seq:0,planWrites:[],reportPosts:[],events:EVENTS(),
    plans:[
      plan('plan-a','todo2','on','분기 계획 모임','2026-11-10',iso('2026-11-10','14:00')),
      plan('plan-b','off1','off','자료 정리','2026-11-10',iso('2026-11-10','16:00')),
      plan('plan-c','day1','on','현장 방문','2026-11-12',null)
    ],
    reports:[report('report-a','done1','주간 점검 회의',iso('2026-11-10','10:00')),report('report-b','trip1','가을 연수',iso('2026-11-18','09:00'))],
    tasks:tasks?[{id:'t1',title:'회의록 정리',notes:'',due:'2026-11-10T00:00:00.000Z',status:'needsAction',completed:null,taskListId:'@default',taskListTitle:'QA',source:'google-task'}]:[]};
}
export async function installServer(page,state,{base}){
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();
    if(url.origin===base)return route.continue();
    if(url.origin!==SB)return route.abort();
    const ok=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    const eq=name=>{const v=url.searchParams.get(name);return v&&v.startsWith('eq.')?v.slice(3):null};
    const user={id:'rp-user',email:'qa@example.org',user_metadata:{display_name:'QA'}};
    if(url.pathname==='/auth/v1/token')return ok({access_token:'synthetic',refresh_token:'synthetic',expires_at:4102444800,user});
    if(url.pathname==='/auth/v1/user')return ok(user);
    if(url.pathname==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rp-ws',user_id:user.id,role:'owner'}]);
    if(url.pathname==='/rest/v1/app_workspaces')return ok([{id:'rp-ws',name:'QA'}]);
    if(url.pathname==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'QA'}]);
    if(url.pathname==='/rest/v1/app_calendar_report_plans'){
      if(!state.store)return ok({code:'PGRST205',message:"Could not find the table 'public.app_calendar_report_plans' in the schema cache"},404);
      if(method==='GET'){const id=eq('google_event_id');return ok(state.plans.filter(p=>!id||p.google_event_id===id))}
      const body=req.postDataJSON?.()??null;
      state.planWrites.push({method,query:url.search,body});
      if(method==='POST'){const row={id:'plan-'+(++state.seq),...body};state.plans.push(row);return ok([row],201)}
      if(method==='PATCH'){const row=state.plans.find(p=>p.id===eq('id'));if(!row)return ok([]);Object.assign(row,body);return ok([row])}
      if(method==='DELETE'){state.plans=state.plans.filter(p=>p.google_event_id!==eq('google_event_id'));return ok([])}
      return ok({message:'method'},405);
    }
    if(url.pathname==='/rest/v1/app_meetings'){
      const wantsLink=/google_event_id/.test(url.search);
      if(method==='GET'){
        if(wantsLink&&!state.store)return ok({code:'42703',message:'column app_meetings.google_event_id does not exist'},400);
        const id=eq('id'),rows=state.store?state.reports:state.reports.map(({google_event_id,google_calendar_id,...rest})=>rest);
        return ok(rows.filter(r=>(!id||r.id===id)&&(!wantsLink||r.google_event_id)));
      }
      if(method==='POST'){
        const body=req.postDataJSON();state.reportPosts.push(body);
        if(!state.store&&('google_event_id' in body||'google_calendar_id' in body))return ok({code:'PGRST204',message:"Could not find the 'google_event_id' column of 'app_meetings' in the schema cache"},400);
        const now=new Date().toISOString(),row={id:'report-'+(++state.seq),created_at:now,updated_at:now,deleted_at:null,...body};state.reports.push(row);return ok([row],201);
      }
      return ok([]);
    }
    if(url.pathname==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action');
      if(method==='POST')return ok({ok:true});
      if(action==='event')return ok({event:state.events.find(e=>e.id===url.searchParams.get('eventId')),eventColors:{}});
      const status={connected:true,enabled:true,selected:['own','ref'],calendars:[{id:'own',summary:'내 캘린더',accessRole:'owner',backgroundColor:'#336699'},{id:'ref',summary:'참고 캘린더',accessRole:'reader',backgroundColor:'#7a8a2a'}],colors:{},eventColors:{}};
      return ok(action==='events'?{...status,events:state.events.map(e=>({...e}))}:status);
    }
    if(url.pathname==='/functions/v1/google-tasks'){
      if(url.searchParams.get('action')==='links')return ok({links:[],meeting_links:[]});
      return ok({connected:true,authorized:true,needs_reconnect:false,tasks:state.tasks,links:[],meeting_links:[],pending_scope:'all'});
    }
    return ok([]);
  });
}
