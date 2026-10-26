// TG-방날짜묶기 4단계 시험용 서버 흉내: 소식 표(app_feed_items)·방 날 요약 표(app_feed_room_days)·DB 함수(app_feed_room_day_lines, app_feed_set_state)와
// 화면이 함께 읽는 몇 가지 표. 쓴 값은 기억하고 writes에 남긴다. 방·사람·내용은 모두 지어낸 것이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
export const ORG='30000000-0000-4000-8000-0000000000c1';
export const T={
 a1:'70000000-0000-4000-8000-000000000001',b1:'70000000-0000-4000-8000-000000000002',a0:'70000000-0000-4000-8000-000000000003',
 a2:'70000000-0000-4000-8000-000000000004',c1:'70000000-0000-4000-8000-000000000005',aOld:'70000000-0000-4000-8000-000000000006',b0:'70000000-0000-4000-8000-000000000007',b0b:'70000000-0000-4000-8000-000000000008',
};
const base={workspace_id:'w',drive_url:null,pinned_at:null,hidden_at:null,archived_at:null,project_id:null,organization_id:null,counterpart:null,speaker_split:false,points:[],updated_at:'2026-10-06T00:00:00Z'};
const tg=(id,o)=>({...base,id,source:'telegram',...o});
export function telegramRows(){
 return [
  tg(T.a1,{day:'2026-10-06',occurred_at:'2026-10-06T00:31:00Z',room_key:'room-a',room_label:'가상지부 단톡',title:'교섭 연기',summary:'가상 교섭 다음 주 화요일로 미뤄짐. 서면 회신 월요일까지.',raw_count:3,raw_text:'09:31 A: 사측에서 목요일 어렵다고 연락 왔습니다\n09:33 B: 그럼 언제로요?\n09:40 A (전달): 다음 주 화요일 두 시로 잡혔어요'}),
  tg(T.a2,{day:'2026-10-06',occurred_at:'2026-10-06T04:10:00Z',room_key:'room-a',room_label:'가상지부 단톡',title:'자료 요청',summary:'자료집 초안 공유 요청.',raw_count:2,raw_text:'13:10 B: 자료집 초안 올려 주세요\n13:12 A: 네'}),
  tg(T.b1,{day:'2026-10-06',occurred_at:'2026-10-05T23:12:00Z',room_key:'room-b',room_label:'예시 간부방',title:'원고 마감',summary:'자료집 원고 금요일 18시 마감.',raw_count:2,raw_text:'08:12 A: 원고 금요일 18시 마감입니다\n08:13 B: 확인'}),
  tg(T.c1,{day:'2026-10-06',occurred_at:'2026-10-06T02:00:00Z',room_key:'-1001234567',room_label:'가상 채널',title:'공지',summary:'가상 공지 한 건.',raw_count:1,raw_text:'11:00 A: 공지합니다'}),
  tg(T.a0,{day:'2026-10-05',occurred_at:'2026-10-05T01:05:00Z',room_key:'room-a',room_label:'가상지부 단톡',title:'기자회견',summary:'공동 기자회견 10. 8. 11시 확정.',raw_count:1,raw_text:'10:05 A: 기자회견 10. 8. 11시 확정',pinned_at:'2026-10-05T02:00:00Z'}),
  tg(T.b0,{day:'2026-10-03',occurred_at:'2026-10-03T03:00:00Z',room_key:'room-b',room_label:'예시 간부방',title:'옛 안건 정리',summary:'옛 안건 정리 내용.',raw_count:1,raw_text:'12:00 A: 안건 정리'}),
  tg(T.b0b,{day:'2026-10-03',occurred_at:'2026-10-03T05:00:00Z',room_key:'room-b',room_label:'예시 간부방',title:'옛 일정 확인',summary:'옛 일정 확인 내용.',raw_count:2,raw_text:'14:00 A: 일정 확인'}),
  tg(T.aOld,{day:'2026-09-20',occurred_at:'2026-09-20T03:00:00Z',room_key:'room-a',room_label:'가상지부 단톡',title:'아주 옛 공지',summary:'아주 옛 공지 내용.',raw_count:1,raw_text:'12:00 A: 옛 공지'}),
 ];
}
export const roomInfo={'room-a':{chat_kind:'group',chat_username:'fake_room_a'},'room-b':{chat_kind:'user',chat_username:null},'-1001234567':{chat_kind:'channel',chat_username:null}};
// 요약 묶음: room-b의 10/03은 요약이 없는 옛 날(소식 제목 모음으로 물러남).
export function roomDayRows(){
 return [
  {room_key:'room-a',day:'2026-10-06',hidden_at:null,parts:[
   {batch:'b2',first_at:'2026-10-06T04:10:00Z',headline:'',lines:['오후에 자료집 초안 공유를 요청받았다.']},
   {batch:'b1',first_at:'2026-10-06T00:31:00Z',headline:'교섭 일정 연기와 자료 요청',lines:['교섭이 다음 주 화요일로 미뤄졌다.','서면 회신은 월요일까지다.','담당은 아직 정해지지 않았다.'],open_ref:'41'}]},
  {room_key:'room-b',day:'2026-10-06',hidden_at:null,parts:[{batch:'b3',first_at:'2026-10-05T23:12:00Z',headline:'원고 마감 확인',lines:['자료집 원고는 금요일 18시 마감이다.','확인 답이 달렸다.','추가 안건은 없다.']}]},
  {room_key:'-1001234567',day:'2026-10-06',hidden_at:null,parts:[{batch:'b4',first_at:'2026-10-06T02:00:00Z',headline:'가상 공지',lines:['가상 공지가 한 건 올라왔다.','답글은 없다.','후속 일정은 없다.'],open_ref:'77'}]},
  {room_key:'room-a',day:'2026-10-05',hidden_at:null,parts:[{batch:'b5',first_at:'2026-10-05T01:05:00Z',headline:'기자회견 확정',lines:['공동 기자회견이 10월 8일 11시로 확정됐다.','장소는 따로 공지한다.','참석자는 아직 모른다.']}]},
 ];
}
const eq=(q,k)=>q.get(k)?.startsWith('eq.')?decodeURIComponent(q.get(k).slice(3)):null;
function sorted(rows,order){
 const keys=(order||'').split(',').filter(Boolean).map(s=>s.split('.'));
 return [...rows].sort((x,y)=>{for(const [k,d] of keys){const a=String(x[k]??''),b=String(y[k]??'');if(a!==b)return (a<b?-1:1)*(d==='desc'?-1:1);}return 0;});
}
export const F={work:'80000000-0000-4000-8000-000000000001',misc:'80000000-0000-4000-8000-000000000002'};
export function linesFor(items,roomDays,from,to,rooms=[]){
 const live=items.filter(x=>x.source==='telegram'&&x.day>=from&&x.day<=to),groups=new Map();
 for(const x of live){const k=x.room_key+'|'+x.day;(groups.get(k)||groups.set(k,[]).get(k)).push(x);}
 const out=[];
 for(const [k,list] of groups){
  const shown=list.filter(x=>!x.hidden_at);if(!shown.length)continue;
  const [room,day]=[k.slice(0,k.lastIndexOf('|')),k.slice(k.lastIndexOf('|')+1)],rs=rooms.find(r=>r.room_key===room)||{},rd=roomDays.find(r=>r.room_key===room&&r.day===day),info=roomInfo[room]||{};
  const parts=[...(rd?.parts||[])].sort((a,b)=>a.first_at.localeCompare(b.first_at));
  out.push({room_key:room,room_label:list[0].room_label,day,last_at:list.map(x=>x.occurred_at).sort().at(-1),item_count:shown.length,raw_count:shown.reduce((n,x)=>n+x.raw_count,0),
   headline:parts.find(p=>p.headline)?.headline||null,part_count:parts.length,chat_kind:info.chat_kind||null,chat_username:info.chat_username||null,folder_id:rs.folder_id||null,archived_at:rs.archived_at||null,day_hidden_at:rd?.hidden_at||null});
 }
 return out.sort((a,b)=>b.day.localeCompare(a.day)||b.last_at.localeCompare(a.last_at));
}
export async function installTgServer(page,{items,roomDays=roomDayRows(),writes=[],missing=false,empty=false,calls=[],folders=[],rooms=[],noFolderFns=false}={}){
 const days=[
  {workspace_id:'w',day:'2026-10-06',source:'call',total_count:5,kept_count:2,room_count:0,personal_count:2,unsure_count:1,failed_count:0},
  {workspace_id:'w',day:'2026-10-06',source:'telegram',total_count:412,kept_count:5,room_count:3,personal_count:0,unsure_count:0,failed_count:0},
 ];
 const route=(path,fn)=>page.route(u=>u.origin===SB&&u.pathname===path,fn);
 await route('/rest/v1/app_feed_items',r=>{
  if(missing)return r.fulfill({status:404,json:{code:'PGRST205',message:"Could not find the table 'public.app_feed_items' in the schema cache"}});
  const req=r.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='GET'){
   if(Number(q.get('offset')||0))return r.fulfill({json:[]});
   let out=items.filter(x=>x.workspace_id===eq(q,'workspace_id'));
   for(const k of ['id','source','room_key','day'])if(eq(q,k))out=out.filter(x=>String(x[k])===eq(q,k));
   const dayIn=/^in\.\((.*)\)$/.exec(q.get('day')||'');if(dayIn)out=out.filter(x=>dayIn[1].split(',').includes(x.day));
   if(q.get('hidden_at')==='is.null')out=out.filter(x=>!x.hidden_at);
   if(q.get('hidden_at')==='not.is.null')out=out.filter(x=>!!x.hidden_at);
   if(q.get('pinned_at')==='not.is.null')out=out.filter(x=>!!x.pinned_at);
   out=sorted(out,q.get('order'));
   const fields=(q.get('select')||'').split(',');
   return r.fulfill({json:out.map(x=>Object.fromEntries(fields.map(f=>[f,x[f]])))});
  }
  if(req.method()==='PATCH'){
   const body=req.postDataJSON();writes.push({id:eq(q,'id'),body});
   const row=items.find(x=>x.id===eq(q,'id')&&x.workspace_id===eq(q,'workspace_id'));if(!row)return r.fulfill({json:[]});
   Object.assign(row,body);return r.fulfill({json:[{...row}]});
  }
  return r.fulfill({status:405,json:{}});
 });
 await route('/rest/v1/rpc/app_feed_set_state',r=>{
  const {p_id,p_state}=r.request().postDataJSON(),row=items.find(x=>x.id===p_id);
  if(!row)return r.fulfill({status:404,json:{code:'P0002',message:'FEED_NOT_FOUND'}});
  writes.push({id:p_id,body:{state:p_state},rpc:true});
  row.hidden_at=p_state==='trashed'?(row.hidden_at||'2026-10-06T01:00:00Z'):null;
  return r.fulfill({json:{ok:true,id:p_id,state:p_state,archived_at:row.archived_at,hidden_at:row.hidden_at,updated_at:'2026-10-06T01:00:00Z'}});
 });
 await route('/rest/v1/rpc/app_feed_room_day_lines',r=>{
  if(missing)return r.fulfill({status:404,json:{code:'PGRST202',message:'Could not find the function public.app_feed_room_day_lines'}});
  const {p_from,p_to}=r.request().postDataJSON();calls.push({fn:'lines',p_from,p_to});
  return r.fulfill({json:empty?[]:linesFor(items,roomDays,p_from,p_to,rooms)});
 });
 await route('/rest/v1/app_feed_room_days',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(q.get('hidden_at')==='not.is.null')return r.fulfill({json:roomDays.filter(x=>x.hidden_at).map(x=>({room_key:x.room_key,day:x.day,hidden_at:x.hidden_at}))});
  const rd=roomDays.find(x=>x.room_key===eq(q,'room_key')&&x.day===eq(q,'day'));
  return r.fulfill({json:rd?[{parts:rd.parts,hidden_at:rd.hidden_at}]:[]});
 });
 await route('/rest/v1/app_feed_folders',r=>r.fulfill({json:Number(new URL(r.request().url()).searchParams.get('offset')||0)?[]:folders.map((f,i)=>({id:f.id,name:f.name,sort_order:i}))}));
 await route('/rest/v1/app_feed_rooms',r=>r.fulfill({json:Number(new URL(r.request().url()).searchParams.get('offset')||0)?[]:rooms.map(x=>({room_label:'',folder_id:null,archived_at:null,...x}))}));
 const fn=(name,handler)=>route('/rest/v1/rpc/'+name,r=>{
  if(noFolderFns)return r.fulfill({status:404,json:{code:'PGRST202',message:'Could not find the function public.'+name}});
  const body=r.request().postDataJSON();writes.push({rpc:name,body});return handler(r,body);
 });
 const bad=(r,code)=>r.fulfill({status:400,json:{code:'P0001',message:code}});
 await fn('app_feed_room_set',(r,b)=>{
  const known=items.find(x=>x.room_key===b.p_room_key);if(!known)return bad(r,'TGDG_NO_ROOM');
  let row=rooms.find(x=>x.room_key===b.p_room_key);if(!row){row={room_key:b.p_room_key,room_label:known.room_label,folder_id:null,archived_at:null};rooms.push(row);}
  row.folder_id=b.p_folder||null;row.archived_at=b.p_archived?(row.archived_at||'2026-10-06T01:00:00Z'):null;
  return r.fulfill({json:{ok:true,room_key:b.p_room_key,folder_id:row.folder_id,archived:!!row.archived_at}});
 });
 await fn('app_feed_room_day_set',(r,b)=>{
  let rd=roomDays.find(x=>x.room_key===b.p_room_key&&x.day===b.p_day);
  if(!rd){if(!items.some(x=>x.room_key===b.p_room_key&&x.day===b.p_day))return bad(r,'TGDG_NOT_FOUND');rd={room_key:b.p_room_key,day:b.p_day,hidden_at:null,parts:[]};roomDays.push(rd);}
  rd.hidden_at=b.p_state==='trashed'?'2026-10-06T01:00:00Z':null;
  return r.fulfill({json:{ok:true,room_key:b.p_room_key,day:b.p_day,state:b.p_state}});
 });
 await fn('app_feed_folder_create',(r,b)=>{
  const name=String(b.p_name||'').trim();
  if(folders.some(f=>f.name===name))return bad(r,'TGDG_FOLDER_NAME_TAKEN');
  if(folders.length>=30)return bad(r,'TGDG_FOLDER_LIMIT');
  const f={id:'80000000-0000-4000-8000-0000000001'+String(folders.length+10),name};folders.push(f);
  return r.fulfill({json:{ok:true,id:f.id,name}});
 });
 await fn('app_feed_folder_rename',(r,b)=>{
  const f=folders.find(x=>x.id===b.p_id);if(!f)return bad(r,'TGDG_NOT_FOUND');
  if(folders.some(x=>x.id!==f.id&&x.name===b.p_name))return bad(r,'TGDG_FOLDER_NAME_TAKEN');
  f.name=b.p_name;return r.fulfill({json:{ok:true,id:f.id,name:f.name}});
 });
 await fn('app_feed_folder_delete',(r,b)=>{
  const i=folders.findIndex(x=>x.id===b.p_id);if(i<0)return bad(r,'TGDG_NOT_FOUND');
  folders.splice(i,1);for(const x of rooms)if(x.folder_id===b.p_id)x.folder_id=null;
  return r.fulfill({json:{ok:true,id:b.p_id,rooms_released:0}});
 });
 await route('/rest/v1/app_feed_days',r=>{
  if(missing)return r.fulfill({status:404,json:{code:'PGRST205'}});
  const q=new URL(r.request().url()).searchParams,src=decodeURIComponent((q.get('source')||'').slice(3));
  return r.fulfill({json:Number(q.get('offset')||0)||empty?[]:days.filter(d=>d.source===src)});
 });
 await route('/rest/v1/app_call_personal',r=>r.fulfill({json:[]}));
 await route('/rest/v1/app_call_edits',r=>r.fulfill({json:[]}));
 await route('/rest/v1/app_suborganizations',r=>r.fulfill({json:Number(new URL(r.request().url()).searchParams.get('offset')||0)?[]:[{id:ORG,workspace_id:'w',name:'예시지부',active:true},{id:'o',workspace_id:'w',name:'테스트 조직',active:true}]}));
 await route('/rest/v1/app_suborganization_updates',r=>{
  if(r.request().method()==='POST'){writes.push({table:'org_update',body:r.request().postDataJSON()});return r.fulfill({status:201,json:[]});}
  return r.fulfill({json:[]});
 });
 return {items,roomDays,writes,calls,folders,rooms};
}
