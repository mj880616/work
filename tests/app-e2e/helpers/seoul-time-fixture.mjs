import {baseState,mockApp,signIn} from './filter-chip-fixture.mjs';
const BASE='http://127.0.0.1:8123',SB='https://xmlkxfjeagycwttklxjw.supabase.co';
export async function openSeoulApp(page,{view='month',target=BASE+'/app/?view=calendar',now='2026-09-30T15:10:00Z'}={}){
  const base=new URL(target).origin;
  await page.clock.setFixedTime(new Date(now));
  const state=baseState();state.meetingWrites=[];state.meetings=[{id:'seoul-meeting',workspace_id:'workspace-1',title:'한국 회의',meeting_at:'2026-09-30T15:30:00Z',transcript_text:'합성 원문',created_by:state.user.id}];
  state.events=[
    {id:'exec',title:'본부 집행위',start:'2026-09-15T01:00:00Z',end:'2026-09-15T02:00:00Z'},
    {id:'early',title:'한국 00:30',start:'2026-09-30T15:30:00Z',end:'2026-09-30T16:30:00Z'},
    {id:'late',title:'한국 23:30',start:'2026-09-30T14:30:00Z',end:'2026-09-30T14:50:00Z'},
    {id:'all',title:'한국 종일',start:'2026-10-01',end:'2026-10-02',allDay:true},
    {id:'boundary',title:'월 경계',start:'2026-09-30T14:30:00Z',end:'2026-09-30T16:00:00Z'},
    {id:'midnight-end',title:'자정 종료',start:'2026-09-30T14:30:00Z',end:'2026-09-30T15:00:00Z'}
  ].map(e=>({calendarId:'primary',color:'#4285f4',source:'google',...e}));
  state.writes=[];state.ranges=[];state.milestones=[{id:'seoul-mile',project_id:'top-a',title:'자정 주요 일정',start_at:'2026-09-30T15:30:00Z',status:'planned'}];
  state.progress=[{id:'progress',project_id:'top-a',workstream_id:'ws',summary:'진행',effective_on:'2026-10-01'}];
  state.comments=[{id:'memo',project_id:'top-a',author_id:state.user.id,body:'기록',created_at:'2026-09-30T15:30:00Z'}];
  const calendar={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner',backgroundColor:'#4285f4'}],colors:{},eventColors:{}};
  await mockApp(page,state);
  // Catch every external request. All application data is synthetic; no production request is sent.
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),body=req.method()==='POST'||req.method()==='PATCH'?req.postDataJSON():null;
    if(url.origin===base)return route.continue();
    if(url.origin!==SB)return route.abort();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(url.pathname==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_at:4102444800,user:state.user});
    if(url.pathname==='/functions/v1/google-calendar'){
      const action=body?.action||url.searchParams.get('action');
      if(action==='create-event'||action==='update-event'){
        state.writes.push(body);const row=action==='create-event'?{id:'saved-'+state.writes.length,calendarId:'primary',source:'google',color:'#4285f4',location:''}:state.events.find(x=>x.id===body.event_id);
        Object.assign(row,{title:body.title,description:body.memo||'',...(Object.hasOwn(body,'location')?{location:String(body.location||'')}:{}),allDay:body.all_day,start:body.all_day?body.start_date:body.start_iso,end:body.all_day?new Date(Date.parse(body.end_date)+86400000).toISOString().slice(0,10):body.end_iso});
        if(action==='create-event')state.events.push(row);return ok({ok:true,event:row});
      }
      if(action==='event')return ok({event:state.events.find(x=>x.id===url.searchParams.get('eventId')),eventColors:{}});
      if(action==='events'){
        const min=url.searchParams.get('timeMin'),max=url.searchParams.get('timeMax');state.ranges.push({min,max});
        const stamp=value=>Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00+09:00':value);
        return ok({...calendar,events:state.events.filter(e=>stamp(e.start)<Date.parse(max)&&stamp(e.end)>Date.parse(min))});
      }
      return ok({...calendar,events:state.events});
    }
    if(url.pathname==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,tasks:[],links:[],meeting_links:[]});
    const tables={app_project_milestones:state.milestones,app_project_progress_updates:state.progress,app_project_comments:state.comments};
    const name=url.pathname.split('/').at(-1),rows=tables[name];
    if(rows){
      if(body){const id=url.searchParams.get('id')?.slice(3),row=id?rows.find(x=>x.id===id):{id:'new-'+name,created_at:'2026-09-30T15:30:00Z'};Object.assign(row,body);if(!id)rows.push(row);return ok([row])}
      return ok(rows);
    }
    return route.fallback();
  });
  await signIn(page,target);
  if(new URL(target).searchParams.get('view')==='calendar'){
    await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('calendar')&&document.querySelector('#appView.kptu-ui-ready'));
    await page.locator(`[data-calendar-view="${view}"]`).click();
    await page.waitForFunction(view=>window.KPTUCalendarView?.current()===view,view);
  }
  return state;
}
