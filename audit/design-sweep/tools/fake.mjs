// 디자인 점검용 가짜 서버: 모든 이름·내용은 지어낸 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const W='workspace-1',U='user-1';
const iso=(d,h=1)=>`2026-10-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:00:00Z`;
const DAY=86400000;
const kst=(o=0)=>new Date(Date.now()+9*3600000+o*DAY).toISOString().slice(0,10);
const at=(o,h)=>new Date(Date.parse(kst(o)+'T00:00:00+09:00')+h*3600000).toISOString();
const V2={project_system:'v2',management_version:2};
export function tables(){
 const sp=(id,name,sort,extra={})=>({id,workspace_id:W,name,description:'가상 프로젝트 설명',parent_id:null,status:'active',visibility:'private',owner_id:U,created_by:U,sort_order:sort,created_at:iso(1),updated_at:iso(20),metadata:{...V2},...extra});
 const orgs=['가상 철도 가 지부','가상 메트로 나 지부','가상 공항철도 다 지부','가상 교통공사 라 지부','가상 경전철 마 지부','가상 버스 바 지부'].map((n,i)=>({id:'org-'+i,workspace_id:W,name:n,active:true,created_by:U,updated_at:iso(20-i),created_at:iso(1)}));
 const note=(id,kind,day,text,extra={})=>({id,workspace_id:W,kind,title:null,raw_text:text,occurred_at:iso(day,2),created_at:iso(day,2),updated_at:iso(day,3),archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...extra});
 const notes=[
  note('10000000-0000-4000-8000-000000000001','basket',26,'가상 지부 위원장 통화: 다음 주 화요일 2차 교섭, 요구안 12명 충원 유지. 서면 회신 월요일까지.'),
  note('10000000-0000-4000-8000-000000000002','basket',26,'국회 토론회 자료집 원고 금요일 18시 마감 — 초안 공유 요청 받음',{attachments:[{name:'자료집_초안.hwpx',size:120000}]}),
  note('10000000-0000-4000-8000-000000000003','basket',25,'가상 공사 사장 면담 결과 정리\n- 인력 충원 검토\n- 안전 예산 증액 요구 전달'),
  note('10000000-0000-4000-8000-000000000004','basket',24,'https://example.org/news/abcdefg 가상 기사 링크: 민자철도 공공성 강화 법안 발의'),
  note('10000000-0000-4000-8000-000000000005','basket',23,'다음 달 교육 일정 확인 필요'),
  note('20000000-0000-4000-8000-000000000001','note',20,'## 쟁점\n\n- **기본급** 인상\n- 수당 정비',{title:'가상 임금협상 정리'}),
  note('20000000-0000-4000-8000-000000000002','note',15,'회의 준비 메모',{title:'토론회 준비 메모'}),
  note('30000000-0000-4000-8000-000000000001','work',27,'가상 지부 교섭 준비 회의\n자료집 원고 검토\n국회 의원실 면담',{journal_day:kst(0)}),
  note('40000000-0000-4000-8000-000000000001','diary',26,'오늘은 바빴다. 저녁에 산책.',{journal_day:kst(-1),ai_export_allowed:false}),
 ];
 const KINDS=['meeting','policy','negotiation','press','assembly','struggle','education','other'];
 const meetings=KINDS.map((k,i)=>({id:'m-'+i,workspace_id:W,title:['가상 지부 2차 임금교섭','민자철도 정책 간담회','가상 공사 단체교섭','공공성 기자회견','조합원 결의대회','안전인력 투쟁 선전전','신임 간부 교육','기타 회의'][i],meeting_name:null,series_name:null,round_no:i%3?null:i+1,meeting_at:iso(26-i*2,5),activity_kind:k,transcript_text:'가상 회의 내용 요약. 다음 회의는 다음 주.',summary:'핵심 결정 2건, 후속 할 일 3건.',created_by:U,project_id:i<3?'top-a':null,created_at:iso(26-i*2),updated_at:iso(26-i*2)}));
 const docs=['정부자료','정책자료','성명·보도자료','회의자료','기타','정부자료','정책자료','기타'].map((c,i)=>({id:'doc-'+i,workspace_id:W,project_id:i<3?'top-a':null,title:['국토부 민자철도 개선방안(가상)','공공성 강화 정책 제안서','가상 기자회견 보도자료','2차 교섭 회의자료','현장 사진 모음','철도안전 법령 개정안','국회 토론회 발제문','참고 기사 스크랩'][i],category:c,tags:[],source:'가상 출처',file_name:'file-'+i+'.pdf',mime_type:'application/pdf',file_id:'f'+i,document_date:kst(-i*3),created_at:iso(26-i),updated_at:iso(26-i),created_by:U}));
 const ledger=[
  {id:'L1',workspace_id:W,kind:'decision',ledger_id:'DEC-0901',title:'가상 지부 2차 교섭 요구안 확정',summary:'충원 12명 요구 유지.',scope:'work',sensitivity:'S1',importance:'high',validity:'current',date_start:'2026-10-20',date_precision:'day',note:'',created_at:iso(20),updated_at:iso(20)},
  {id:'L2',workspace_id:W,kind:'change',ledger_id:'CHG-0901',title:'가상 교섭 2차 일정 확정',summary:'2차 교섭 날짜 확정.',scope:'work',sensitivity:'S2',importance:'normal',validity:'current',date_start:'2026-10-21',date_precision:'day',note:'',created_at:iso(21),updated_at:iso(21)},
  {id:'L3',workspace_id:W,kind:'commitment',ledger_id:'COM-0901',title:'가상 기관 자료 회신',summary:'자료 회신 약속.',scope:'work',sensitivity:'S1',importance:'normal',validity:'current',date_start:null,date_precision:'unknown',counterparty:'가상 기관',commitment_status:'waiting',follow_up_on:'2026-10-30',note:'',created_at:iso(22),updated_at:iso(22)},
  {id:'L4',workspace_id:W,kind:'event',ledger_id:'EVT-0905',title:'가상 공동 기자회견',summary:'10. 8. 11시 국회 소통관.',scope:'work',sensitivity:'S0',importance:'low',validity:'current',date_start:'2026-10-08',date_precision:'day',event_status:'done',note:'',created_at:iso(8),updated_at:iso(8)}
 ];
 const base={workspace_id:W,drive_url:null,pinned_at:null,hidden_at:null,archived_at:null,project_id:null,organization_id:null,counterpart:null,speaker_split:false,points:[],updated_at:iso(26)};
 const feed=[
  {...base,id:'60000000-0000-4000-8000-000000000001',source:'call',day:kst(0),occurred_at:at(0,9),title:'가상 교섭 일정 다음 주로 조정',points:['가상 교섭 다음 주 화요일로 변경','[확정] 요구안 12명 유지','[예정] 회신 월요일까지'],counterpart:'예시지부 위원장',raw_count:0,organization_id:'org-0',raw_text:'네 사측에서 목요일은 어렵다고 해서요'},
  {...base,id:'60000000-0000-4000-8000-000000000002',source:'call',day:kst(0),occurred_at:at(0,8),title:'가상 자료집 원고 마감 확인',points:['원고 금요일 마감'],speaker_split:true,raw_count:0,raw_text:'나: 원고 언제까지예요?\n화자2: 금요일까지요.'},
  {...base,id:'60000000-0000-4000-8000-000000000003',source:'call',day:kst(-2),occurred_at:at(-2,14),title:'가상 공문 회신 기한 문의',raw_count:0},
  {...base,id:'70000000-0000-4000-8000-000000000001',source:'telegram',day:kst(0),occurred_at:at(0,9),room_key:'room-a',room_label:'가상지부 단톡',title:'교섭 연기',summary:'가상 교섭 다음 주 화요일로 미뤄짐. 서면 회신 월요일까지.',raw_count:3,raw_text:'09:31 A: 사측에서 목요일 어렵다고 연락 왔습니다'},
  {...base,id:'70000000-0000-4000-8000-000000000002',source:'telegram',day:kst(0),occurred_at:at(0,8),room_key:'room-b',room_label:'예시 간부방',title:'원고 마감',summary:'자료집 원고 금요일 18시 마감.',raw_count:2,raw_text:'08:12 A: 원고 금요일 18시 마감입니다'},
 ];
 const feedDays=[{workspace_id:W,day:kst(0),source:'call',total_count:5,kept_count:2,room_count:0,personal_count:2,unsure_count:1,failed_count:0},{workspace_id:W,day:kst(0),source:'telegram',total_count:412,kept_count:2,room_count:2,personal_count:0,unsure_count:0,failed_count:0}];
 const updates=Array.from({length:8},(_,i)=>({id:'ou-'+i,workspace_id:W,organization_id:'org-'+(i%3),raw_text:['가상 지부 임단협 1차 상견례','현장 순회 간담회','안전인력 충원 요구 공문 발송','위원장 면담','조합원 설명회','성과급 지급 기준 협의','근무체계 변경 설명','쟁의조정 신청 검토'][i],detail_text:null,occurred_at:iso(26-i*2,3),created_by:U,created_at:iso(26-i*2)}));
 const share=[{id:'sp-1',workspace_id:W,title:'가상 민자철도 교섭 현황',status:'published',project_id:'top-a',blocks:[{type:'summary',text:'3차 교섭 결렬, 조정 신청 예정'},{type:'schedule',title:'다가오는 일정',items:[{date:'10/31',text:'조정 신청'}]}],updated_at:iso(25)},{id:'sp-2',workspace_id:W,title:'가상 공공성 토론회 안내',status:'draft',project_id:null,blocks:[{type:'summary',text:'초안'}],updated_at:iso(20)}];
 const milestones=[{id:'ms-1',workspace_id:W,project_id:'top-a',title:'국회 토론회',due_on:kst(5),status:'open',created_at:iso(10)},{id:'ms-2',workspace_id:W,project_id:'top-a',title:'정책 제안서 제출',due_on:kst(15),status:'open',created_at:iso(10)}];
 const progress=[{id:'pp-1',workspace_id:W,project_id:'top-a',raw_text:'의원실 3곳 면담 완료, 공동 발의 검토 중',occurred_at:iso(24),created_by:U},{id:'pp-2',workspace_id:W,project_id:'top-a',raw_text:'토론회 발제자 확정',occurred_at:iso(20),created_by:U}];
 return {
  app_spaces:[sp('top-a','공공기관 기능개혁 대응',10),sp('child-a1','국토부 대응',20,{parent_id:'top-a'}),sp('child-a2','산자부 대응',30,{parent_id:'top-a'}),sp('top-b','민자철도 정책 대응',40),sp('child-b1','9/29 국회토론회',50,{parent_id:'top-b',status:'done'}),sp('top-d','안전인력 충원 투쟁',60)],
  app_suborganizations:orgs,
  app_suborganization_assignees:orgs.map(o=>({organization_id:o.id,user_id:U,workspace_id:W})),
  app_suborganization_updates:updates,
  app_notes:notes,app_meetings:meetings,app_documents:docs,app_ledger_records:ledger,
  app_feed_items:feed,app_feed_days:feedDays,app_share_pages:share,app_project_milestones:milestones,app_project_progress_updates:progress,
 };
}
export function gEvents(){
 const e=(id,title,o,h,len=1,extra={})=>({id,title,start:at(o,h),end:at(o,h+len),allDay:false,calendarId:'primary',source:'google',location:'',description:'',recurring:false,organizationIds:[],...extra});
 return [e('e1','가상 지부 2차 교섭',0,10,2,{location:'가상 회의실'}),e('e2','국회 의원실 면담',0,14),e('e3','토론회 준비 회의',1,9),e('e4','조합원 설명회',2,18,2),e('e5','안전인력 선전전',3,7),e('e6','가상 공사 단체교섭',-1,15),e('e7','주간 회의',5,10),e('e8','정책 간담회',-3,13),e('e9','기자회견',7,11),e('e10','교육',8,14,3),
  {id:'e11',title:'가상 하루 종일 일정',start:kst(4),end:kst(5),allDay:true,calendarId:'primary',source:'google',organizationIds:[]}];
}
export function gTasks(){
 const t=(id,title,o,extra={})=>({id,title,taskListId:'l1',taskListTitle:'업무',due:kst(o)+'T00:00:00.000Z',notes:'',status:'needsAction',completed:null,source:'google-task',...extra});
 return [t('t1','자료집 원고 검토',0),t('t2','의원실 회신 확인',0),t('t3','교섭 요구안 최종본 공유',1),t('t4','지난주 회의록 정리',-2),t('t5','기자회견문 초안',3),t('t6','교육 자료 준비',9),t('t7','완료된 할 일',-1,{status:'completed',completed:at(-1,10)})];
}
export async function install(page,{user={id:U,email:'owner@example.org',user_metadata:{display_name:'가상 사용자'}}}={}){
 const db=tables(),ev=gEvents(),tk=gTasks();
 await page.route(`${SB}/**`,async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method(),q=url.searchParams;
  let body=null;try{body=req.postDataJSON()}catch{}
  const ok=(d,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(d??null)});
  if(path==='/auth/v1/token')return ok({access_token:'e2e',refresh_token:'e2e',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user});
  if(path==='/auth/v1/user')return ok(user);
  if(path.startsWith('/auth/'))return ok({});
  if(path==='/functions/v1/google-calendar'){
   const action=q.get('action')||(method==='POST'?body?.action:'status');
   if(action==='status')return ok({connected:true,enabled:true,selected:['primary'],colors:{},eventColors:{},calendars:[{id:'primary',summary:'내 캘린더',primary:true,backgroundColor:'#4285f4',accessRole:'owner'}]});
   if(action==='events'){const min=Date.parse(q.get('timeMin')||0),max=Date.parse(q.get('timeMax')||'2100-01-01');return ok({events:ev.filter(e=>Date.parse(e.start)<max&&Date.parse(e.end)>min),eventColors:{}})}
   return ok({});
  }
  if(path==='/functions/v1/google-tasks'){
   const action=q.get('action');
   if(action==='links')return ok({links:[],meeting_links:[]});
   if(action==='overview'||!action)return ok({connected:true,authorized:true,needs_reconnect:false,pending_scope:'all',tasks:tk});
   return ok({links:[],tasks:[]});
  }
  if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(path.startsWith('/functions/v1/'))return ok({});
  if(path==='/rest/v1/rpc/app_trash_list'){const k=body?.p_kind;const all=[{id:'tr-1',kind:'project',name:'옛 정책 대응',deleted_at:iso(20),child_count:1,file_count:2},{id:'tr-2',kind:'project',name:'9/15 간담회 준비',deleted_at:iso(18),parent_id:'tr-1',parent_in_trash:true},{id:'tr-3',kind:'organization',name:'가상 폐지 지부',deleted_at:iso(22)},{id:'tr-4',kind:'report',title:'가상 정책 간담회',series_name:'가상 정책 간담회',round_no:2,deleted_at:iso(23)},{id:'tr-5',kind:'note',raw_text:'지운 메모 한 줄',note_kind:'basket',deleted_at:iso(24)}];return ok(all.filter(r=>!k||r.kind===k))}
  if(path==='/rest/v1/rpc/app_feed_room_day_lines')return ok([]);
  if(path.startsWith('/rest/v1/rpc/'))return ok(null);
  if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:W,user_id:user.id,role:'owner',email:user.email,workspace:{id:W,slug:'team',name:'웹2'},created_at:iso(1)}]);
  if(path==='/rest/v1/app_workspaces')return ok([{id:W,slug:'team',name:'웹2'}]);
  if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'가상 사용자',title:'국장',library_view:null}]);
  if(path.startsWith('/rest/v1/')){
   const t=path.slice(9);
   if(method!=='GET'){
     if(method==='POST')return ok(Array.isArray(body)?body:[{...(body||{}),id:'new-'+Date.now()}],201);
     return ok([]);
   }
   if(Number(q.get('offset')||0)>0)return ok([]);
   let rows=db[t];
   if(!rows)return ok([]);
   for(const [k,v] of q){
     if(['select','order','limit','offset','or','and'].includes(k))continue;
     if(v.startsWith('eq.')){const val=decodeURIComponent(v.slice(3));if(['workspace_id'].includes(k))continue;rows=rows.filter(r=>!(k in r)||String(r[k])===val);}
     else if(v.startsWith('in.(')){const vals=v.slice(4,-1).split(',').map(s=>s.replace(/"/g,''));rows=rows.filter(r=>!(k in r)||vals.includes(String(r[k])));}
     else if(v==='is.null')rows=rows.filter(r=>r[k]==null);
     else if(v==='not.is.null')rows=rows.filter(r=>r[k]!=null);
   }
   const lim=Number(q.get('limit')||0);if(lim)rows=rows.slice(0,lim);
   if(req.headers()['accept']?.includes('vnd.pgrst.object'))return ok(rows[0]||null);
   return ok(rows);
  }
  return ok({});
 });
}
