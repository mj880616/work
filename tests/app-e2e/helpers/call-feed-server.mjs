// CALL-개인통화함·CALL-상세뒤로가기: 통화 화면 시험이 같이 쓰는 흉내 서버(app_feed_items·app_call_personal·app_call_move·원장 처리 표)와 여는 길.
// 이름·내용은 모두 지어낸 것이다. call-personal-box.spec.mjs에서 옮겨 왔다(내용 그대로).
import {expect} from '@playwright/test';
import {openHome} from './home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
export const ORG='30000000-0000-4000-8000-0000000000c1';
export const W1='61000000-0000-4000-8000-000000000001',W2='61000000-0000-4000-8000-000000000002';
export const P1='62000000-0000-4000-8000-000000000001',U1='62000000-0000-4000-8000-000000000011',U2='62000000-0000-4000-8000-000000000012';
const workBase={workspace_id:'w',source:'call',room_key:null,room_label:null,summary:null,speaker_split:false,raw_count:0,project_id:null,drive_url:null,pinned_at:null,hidden_at:null,updated_at:'2026-10-06T00:00:00Z'};
const perBase={workspace_id:'w',summary:null,speaker_split:false,drive_url:null,hidden_at:null,moved_at:null,updated_at:'2026-10-06T00:00:00Z'};
function data(){
 return {
  work:[
   {...workBase,id:W1,day:'2026-10-06',occurred_at:'2026-10-06T00:42:00Z',title:'가상 교섭 일정 조정',points:['다음 주 화요일로 변경'],counterpart:'예시지부 홍길동',organization_id:ORG,raw_text:'가상 전문 하나'},
   {...workBase,id:W2,day:'2026-10-05',occurred_at:'2026-10-05T05:00:00Z',title:'가상 자료 전달 확인',points:['금요일까지 전달'],counterpart:null,organization_id:null,raw_text:null},
  ],
  personal:[
   {...perBase,id:P1,kind:'personal',day:'2026-10-05',occurred_at:'2026-10-05T09:02:00Z',title:'가상 저녁 약속 정하기',points:['토요일 저녁 7시'],counterpart:'가상 친구',raw_text:'가상 개인 전문'},
   {...perBase,id:U1,kind:'unsure',day:'2026-10-06',occurred_at:'2026-10-06T00:10:00Z',title:'가상 처음 걸려 온 번호',points:['내용 확인 필요'],counterpart:null,raw_text:null},
   {...perBase,id:U2,kind:'unsure',day:'2026-10-05',occurred_at:'2026-10-05T03:00:00Z',title:'가상 짧은 확인 통화',points:[],counterpart:null,raw_text:null},
  ],
  days:[{workspace_id:'w',day:'2026-10-06',source:'call',total_count:3,kept_count:0,room_count:0,personal_count:2,unsure_count:1,failed_count:0}],
 };
}
export async function fixture(page,{width=1280,ledgerSeen=[],personalMissing=false,refill='ok'}={}){
 await page.setViewportSize({width,height:860});
 const db=data(),moves=[],errors=[],refills=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource/.test(e.text()))errors.push(e.text());});
 const fields=(q,x)=>Object.fromEntries((q.get('select')||'').split(',').filter(Boolean).map(f=>[f,x[f]]));
 const eq=(q,k)=>q.get(k)?.startsWith('eq.')?decodeURIComponent(q.get(k).slice(3)):null;
 await openHome(page,{beforeLoad:async()=>{
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',r=>{
   const q=new URL(r.request().url()).searchParams;
   if(r.request().method()!=='GET')return r.fulfill({status:405,json:{}});
   if(Number(q.get('offset')||0))return r.fulfill({json:[]});
   let out=db.work.filter(x=>!x.hidden_at);if(eq(q,'id'))out=out.filter(x=>x.id===eq(q,'id'));
   return r.fulfill({json:out.map(x=>fields(q,x))});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_call_personal',r=>{
   if(personalMissing)return r.fulfill({status:404,json:{code:'PGRST205',message:"Could not find the table 'public.app_call_personal' in the schema cache"}});
   const q=new URL(r.request().url()).searchParams;
   if(r.request().method()!=='GET')return r.fulfill({status:405,json:{}});
   if(Number(q.get('offset')||0))return r.fulfill({json:[]});
   let out=db.personal.filter(x=>!x.hidden_at);if(eq(q,'id'))out=out.filter(x=>x.id===eq(q,'id'));
   return r.fulfill({json:out.map(x=>fields(q,x))});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_call_edits',r=>r.fulfill({json:[]}));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_call_move',r=>{
   const body=r.request().postDataJSON();moves.push(body);
   const w=db.work.find(x=>x.id===body.p_id),p=db.personal.find(x=>x.id===body.p_id);
   if(body.p_to==='personal'&&w){db.work=db.work.filter(x=>x!==w);db.personal.push({...perBase,id:w.id,kind:'personal',day:w.day,occurred_at:w.occurred_at,title:w.title,points:w.points,counterpart:w.counterpart,raw_text:w.raw_text});return r.fulfill({json:{ok:true,id:w.id,changed:true,needs_refill:false}});}
   if(body.p_to==='personal'&&p){const was=p.kind;p.kind='personal';return r.fulfill({json:{ok:true,id:p.id,changed:was!=='personal',needs_refill:false}});}
   if(body.p_to==='work'&&p){db.personal=db.personal.filter(x=>x!==p);db.work.push({...workBase,id:p.id,day:p.day,occurred_at:p.occurred_at,title:p.title,points:p.points,counterpart:p.counterpart,organization_id:null,raw_text:p.raw_text});return r.fulfill({json:{ok:true,id:p.id,changed:true,needs_refill:true}});}
   return r.fulfill({status:400,json:{message:'CALL_NOT_FOUND'}});
  });
  // CALL-개인통화함 4단계: 업무로 옮긴 직후 서버 AI가 한 건을 다시 채운다(call_refill). 서버는 흉내다.
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/ai-assist',r=>{
   if(r.request().method()!=='POST')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization, x-client-info, apikey, content-type'}});
   const body=r.request().postDataJSON();
   if(body.kind!=='call_refill')return r.fulfill({status:503,json:{ok:false,error:'ai_busy',message:'x'}}); // 홈의 다른 AI 호출은 이 시험과 무관
   refills.push(body);
   const w=db.work.find(x=>x.id===body.id);
   if(refill!=='ok'||!w)return r.fulfill({status:503,json:{ok:false,error:'ai_busy',message:'x'}});
   Object.assign(w,{title:'임금교섭 3차 일정 협의',counterpart:'예시지부 김가상 지부장',organization_id:ORG});
   return r.fulfill({json:{ok:true,kind:'call_refill',id:w.id,title:w.title,counterpart:w.counterpart,organization_id:ORG}});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_ledger_auto_sources',r=>{
   const id=eq(new URL(r.request().url()).searchParams,'source_id');
   return r.fulfill({json:ledgerSeen.includes(id)?[{source_id:id}]:[]});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_days',r=>{
   const q=new URL(r.request().url()).searchParams;
   return r.fulfill({json:Number(q.get('offset')||0)||eq(q,'source')!=='call'?[]:db.days});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganizations',r=>r.fulfill({json:Number(new URL(r.request().url()).searchParams.get('offset')||0)?[]:[{id:ORG,workspace_id:'w',name:'예시지부',active:true}]}));
 }});
 return {db,moves,errors,refills};
}
export async function openCalls(page,width){
 if(width>=761){const item=page.locator('#appView>.app-nav').getByRole('button',{name:'통화',exact:true});await expect(item).toBeVisible();await item.click();}
 else{await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu nav').getByRole('button',{name:'통화',exact:true}).click();}
 await expect(page.locator('#callsView')).toBeVisible();
}
export async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.tap();}else await locator.click();}
