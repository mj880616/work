// TG-발언자이름 4단계: 텔레그램 소식 원문에서 A·B 대신 이름(손 이름 > 나 > 수집기 이름 > A), [이름 붙이기], 소식 머리줄 ⋯ → 보낸 사람 이름(고치기·합치기·지우기).
// 서버는 흉내(app_feed_items·이름표 두 표·DB 함수 세 개)이고 쓴 값을 기억한다. 이름·방·내용은 모두 지어낸 것이다. 고정 부분(소식 흉내)은 call-telegram-feed.spec.mjs와 같다.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const ORG='30000000-0000-4000-8000-0000000000c1';
const C1='60000000-0000-4000-8000-000000000001',C2='60000000-0000-4000-8000-000000000002',C3='60000000-0000-4000-8000-000000000003';
const T1='70000000-0000-4000-8000-000000000001',T2='70000000-0000-4000-8000-000000000002',T3='70000000-0000-4000-8000-000000000003';
const base={workspace_id:'w',drive_url:null,pinned_at:null,hidden_at:null,archived_at:null,project_id:null,updated_at:'2026-10-06T00:00:00Z'};
function rows(){
 return [
  {...base,id:C1,source:'call',day:'2026-10-06',occurred_at:'2026-10-06T00:42:00Z',room_key:null,room_label:null,title:'가상 교섭 일정 다음 주로 조정',summary:null,points:['가상 교섭 다음 주 화요일로 변경','[확정] 요구안 12명 유지','[예정] 회신 10. 12.(월)까지','[확인] 장소 다시 확인'],counterpart:'예시지부 홍길동 위원장',speaker_split:false,raw_count:0,organization_id:ORG,raw_text:'네 사측에서 목요일은 어렵다고 해서요 그럼 화요일 두 시는 어때요',drive_url:'https://drive.google.com/file/d/fake-id/view'},
  {...base,id:C2,source:'call',day:'2026-10-06',occurred_at:'2026-10-05T23:10:00Z',room_key:null,room_label:null,title:'가상 자료집 원고 마감 확인',summary:null,points:['원고 금요일 마감'],counterpart:null,speaker_split:true,raw_count:0,organization_id:null,raw_text:'나: 원고 언제까지예요?\n화자2: 금요일까지요.'},
  {...base,id:C3,source:'call',day:'2026-10-04',occurred_at:'2026-10-04T05:00:00Z',room_key:null,room_label:null,title:'가상 공문 회신 기한 문의',summary:null,points:[],counterpart:null,speaker_split:false,raw_count:0,organization_id:null,raw_text:null},
  {...base,id:T1,source:'telegram',day:'2026-10-06',occurred_at:'2026-10-06T00:31:00Z',room_key:'room-a',room_label:'가상지부 단톡',title:'교섭 연기',summary:'가상 교섭 다음 주 화요일로 미뤄짐. 서면 회신 월요일까지.',points:[],counterpart:null,speaker_split:false,raw_count:3,organization_id:null,raw_text:'09:31 A: 사측에서 목요일 어렵다고 연락 왔습니다\n09:33 B: 그럼 언제로요?\n09:40 A (전달): 다음 주 화요일 두 시로 잡혔어요'},
  {...base,id:T2,source:'telegram',day:'2026-10-06',occurred_at:'2026-10-05T23:12:00Z',room_key:'room-b',room_label:'예시 간부방',title:'원고 마감',summary:'자료집 원고 금요일 18시 마감.',points:[],counterpart:null,speaker_split:false,raw_count:2,organization_id:null,raw_text:'08:12 A: 원고 금요일 18시 마감입니다\n08:13 B: 확인'},
  {...base,id:T3,source:'telegram',day:'2026-10-05',occurred_at:'2026-10-05T01:05:00Z',room_key:'room-a',room_label:'가상지부 단톡',title:'기자회견',summary:'공동 기자회견 10. 8. 11시 확정.',points:[],counterpart:null,speaker_split:false,raw_count:1,organization_id:null,raw_text:'10:05 A: 기자회견 10. 8. 11시 확정',pinned_at:'2026-10-05T02:00:00Z'},
 ];
}
const days=[
 {workspace_id:'w',day:'2026-10-06',source:'call',total_count:5,kept_count:2,room_count:0,personal_count:2,unsure_count:1,failed_count:0},
 {workspace_id:'w',day:'2026-10-03',source:'call',total_count:2,kept_count:0,room_count:0,personal_count:1,unsure_count:0,failed_count:1},
 {workspace_id:'w',day:'2026-10-06',source:'telegram',total_count:412,kept_count:2,room_count:2,personal_count:0,unsure_count:0,failed_count:0},
];

const P1='80000000-0000-4000-8000-000000000001',P2='80000000-0000-4000-8000-000000000002',P3='80000000-0000-4000-8000-000000000003',KEY1='a1b2c3d4e5f60718',KEY2='0f1e2d3c4b5a6978';
const person=(id,o={})=>({id,workspace_id:'w',name:null,auto_name:null,is_self:false,sender_key:null,...o});
// 이름표 흉내: seed(수집기 이름 가상갑·나·열쇠 없는 사람), empty(표는 있고 비었음), missing(표 없음 404), broken(읽기 실패 500)
function senderSeed(mode){
 if(mode==='seed')return {senders:[person(P1,{auto_name:'가상갑',sender_key:KEY1}),person(P2,{is_self:true,sender_key:KEY2}),person(P3,{name:'손이름',auto_name:'수집이름'})],
  links:[{workspace_id:'w',room_key:'room-a',day:'2026-10-06',label:'A',sender_id:P1},{workspace_id:'w',room_key:'room-a',day:'2026-10-06',label:'B',sender_id:P2},{workspace_id:'w',room_key:'room-b',day:'2026-10-06',label:'A',sender_id:P3}]};
 return {senders:[],links:[]};
}
async function fixture(page,{width=1280,missing=false,empty=false,noArchive=false,senderTables='empty'}={}){
 await page.setViewportSize({width,height:860});
 const items=empty?[]:rows(),writes=[],errors=[],names=senderSeed(senderTables),calls=[];let seq=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource/.test(e.text()))errors.push(e.text());});
 await openHome(page,{beforeLoad:async()=>{
  const fail=senderTables==='missing'?{status:404,json:{code:'PGRST205',message:"Could not find the table 'public.app_tg_senders' in the schema cache"}}:senderTables==='broken'?{status:400,json:{code:'42501',message:'permission denied'}}:null;
  for(const [path,key] of [['app_tg_senders','senders'],['app_tg_day_senders','links']])await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+path,r=>{
   if(fail)return r.fulfill(fail);
   const q=new URL(r.request().url()).searchParams;
   return r.fulfill({json:Number(q.get('offset')||0)?[]:names[key].map(x=>({...x}))});
  });
  // DB 함수 세 개(app_tg_sender_set_name·merge·forget)를 흉내 낸다. 규칙은 20261026190000_tg_sender_names.sql 과 같다.
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_tg_sender_set_name',r=>{
   const b=r.request().postDataJSON();calls.push({fn:'set_name',...b});
   const nm=String(b.p_name||'').trim()||null,link=names.links.find(l=>l.room_key===b.p_room_key&&l.day===b.p_day&&l.label===b.p_label);
   if(!link){
    if(!nm)return r.fulfill({json:{ok:true,changed:false}});
    const id='81000000-0000-4000-8000-00000000000'+(++seq);names.senders.push(person(id,{name:nm}));
    names.links.push({workspace_id:'w',room_key:b.p_room_key,day:b.p_day,label:b.p_label,sender_id:id});
    return r.fulfill({json:{ok:true,changed:true,id,name:nm,keyed:false}});
   }
   const s=names.senders.find(x=>x.id===link.sender_id);s.name=nm;
   return r.fulfill({json:{ok:true,changed:true,id:s.id,name:nm,keyed:!!s.sender_key}});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_tg_sender_merge',r=>{
   const b=r.request().postDataJSON();calls.push({fn:'merge',...b});
   const f=names.senders.find(x=>x.id===b.p_from),t=names.senders.find(x=>x.id===b.p_to);
   if(!f||!t)return r.fulfill({status:404,json:{code:'P0002',message:'TG_SENDER_NOT_FOUND'}});
   names.links.forEach(l=>{if(l.sender_id===f.id)l.sender_id=t.id;});
   Object.assign(t,{sender_key:t.sender_key||f.sender_key,name:t.name||f.name,auto_name:t.auto_name||f.auto_name,is_self:t.is_self||f.is_self});
   names.senders=names.senders.filter(x=>x.id!==f.id);
   return r.fulfill({json:{ok:true,id:t.id,moved:1}});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_tg_sender_forget',r=>{
   const b=r.request().postDataJSON();calls.push({fn:'forget',...b});
   if(!names.senders.some(x=>x.id===b.p_id))return r.fulfill({status:404,json:{code:'P0002',message:'TG_SENDER_NOT_FOUND'}});
   names.senders=names.senders.filter(x=>x.id!==b.p_id);names.links=names.links.filter(l=>l.sender_id!==b.p_id);
   return r.fulfill({json:{ok:true,removed_links:1}});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',r=>{
   if(missing)return r.fulfill({status:404,json:{code:'PGRST205',message:"Could not find the table 'public.app_feed_items' in the schema cache"}});
   const req=r.request(),q=new URL(req.url()).searchParams,eq=k=>q.get(k)?.startsWith('eq.')?decodeURIComponent(q.get(k).slice(3)):null;
   if(req.method()==='GET'){
    if(Number(q.get('offset')||0))return r.fulfill({json:[]});
    let out=items.filter(x=>x.workspace_id===eq('workspace_id'));
    if(eq('id'))out=out.filter(x=>x.id===eq('id'));
    if(eq('source'))out=out.filter(x=>x.source===eq('source'));
    // TG-카드밀기: 보관 칸이 아직 없는 서버(DB 적용 전)는 그 칸을 말하는 조회에 400/42703으로 답한다.
    if(noArchive&&/archived_at/.test(`${q.get('select')||''}&${q.get('archived_at')||''}`))return r.fulfill({status:400,json:{code:'42703',message:'column app_feed_items.archived_at does not exist'}});
    if(q.get('hidden_at')==='is.null')out=out.filter(x=>!x.hidden_at);
    if(q.get('hidden_at')==='not.is.null')out=out.filter(x=>!!x.hidden_at);
    if(q.get('archived_at')==='is.null')out=out.filter(x=>!x.archived_at);
    if(q.get('archived_at')==='not.is.null')out=out.filter(x=>!!x.archived_at);
    const fields=(q.get('select')||'').split(',');
    return r.fulfill({json:out.map(x=>Object.fromEntries(fields.map(f=>[f,x[f]])))});
   }
   if(req.method()==='PATCH'){
    const body=req.postDataJSON();writes.push({id:eq('id'),body});
    const row=items.find(x=>x.id===eq('id')&&x.workspace_id===eq('workspace_id'));if(!row)return r.fulfill({json:[]});
    Object.assign(row,body);return r.fulfill({json:[{...row}]});
   }
   return r.fulfill({status:405,json:{}});
  });
  // TG-카드밀기: DB 함수 app_feed_set_state(p_id, p_state)를 흉내 낸다(텔레그램 줄만, 두 칸을 함께 맞춘다).
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_feed_set_state',r=>{
   const {p_id,p_state}=r.request().postDataJSON(),row=items.find(x=>x.id===p_id);
   if(!row)return r.fulfill({status:404,json:{code:'P0002',message:'FEED_NOT_FOUND'}});
   if(row.source!=='telegram')return r.fulfill({status:400,json:{code:'23514',message:'FEED_STATE_TELEGRAM_ONLY'}});
   writes.push({id:p_id,body:{state:p_state},rpc:true});
   row.archived_at=p_state==='archived'?(row.archived_at||'2026-10-25T10:00:00Z'):null;
   row.hidden_at=p_state==='trashed'?(row.hidden_at||'2026-10-25T10:00:00Z'):null;
   return r.fulfill({json:{ok:true,id:p_id,state:p_state,archived_at:row.archived_at,hidden_at:row.hidden_at,updated_at:'2026-10-25T10:00:00Z'}});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_call_personal',r=>r.fulfill({json:[]}));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_call_edits',r=>r.fulfill({json:[]}));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_days',r=>{
   if(missing)return r.fulfill({status:404,json:{code:'PGRST205'}});
   const q=new URL(r.request().url()).searchParams,src=decodeURIComponent((q.get('source')||'').slice(3));
   return r.fulfill({json:Number(q.get('offset')||0)||empty?[]:days.filter(d=>d.source===src)});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganizations',r=>r.fulfill({json:Number(new URL(r.request().url()).searchParams.get('offset')||0)?[]:[{id:ORG,workspace_id:'w',name:'예시지부',active:true},{id:'o',workspace_id:'w',name:'테스트 조직',active:true}]}));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>{
   if(r.request().method()==='POST'){writes.push({table:'org_update',body:r.request().postDataJSON()});return r.fulfill({status:201,json:[]});}
   return r.fulfill({json:[]});
  });
 }});
 return {items,writes,errors,names,calls};
}
async function openMenu(page,width,label){
 if(width>=1024){
  const item=page.locator('#appView>.app-nav').getByRole('button',{name:label,exact:true});
  await expect(item).toBeVisible();await item.click();
 }else{
  await page.locator('#mobileMenuTab').click();
  await page.locator('#mobileMenu nav').getByRole('button',{name:label,exact:true}).click();
 }
}
// 폰은 손가락 탭(locator.tap): 누르기 전에 보이는지·자리가 멈췄는지·그 자리에서 눌리는지(다른 것에 덮이지 않았는지)를 시험 도구가 확인한다.
// 좌표를 먼저 재고 따로 누르면 카드가 비켜서는 중(.18s)·목록이 다시 그려지는 중의 옛 자리를 누를 수 있다.
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();}
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

async function openRaw(page,width,id){
 const view=page.locator('#telegramView');
 await tap(page,view.locator(`[data-tg-item="${id}"] .feed-bub`),width);
 await expect(view.locator('#tgDetail')).toBeVisible();
 return view;
}
const whoTexts=view=>view.locator('[data-tg-raw] .feed-who');

test('텔레그램 390: 원문에 이름(손 이름 > 나 > 수집기 이름 > A), 이름 없는 라벨은 그 날 첫 줄에만 [이름 붙이기]',async({page})=>{
 const f=await fixture(page,{width:390,senderTables:'seed'});
 await openMenu(page,390,'텔레그램 소식');
 let view=await openRaw(page,390,T1);
 // 수집기 이름 가상갑, 본인 "나", 이름이 이어서 말해도 A·B 줄 수는 그대로.
 await expect(whoTexts(view)).toHaveText(['가상갑','나','가상갑']);
 await expect(view.locator('[data-tg-raw] .feed-rm')).toHaveCount(3);
 await expect(view.locator('[data-tg-name-open]')).toHaveCount(0);
 await page.goBack();await expect(view.locator('#tgList')).toBeVisible();
 // 손으로 붙인 이름(손이름)이 수집기 이름(수집이름)을 이긴다. 이름 없는 B에만 [이름 붙이기].
 await openRaw(page,390,T2);
 await expect(whoTexts(view)).toHaveText(['손이름','B이름 붙이기']);
 await expect(view.locator('[data-tg-raw]')).not.toContainText('수집이름');
 await page.goBack();await expect(view.locator('#tgList')).toBeVisible();
 await openRaw(page,390,T3);
 await expect(whoTexts(view)).toHaveText(['A이름 붙이기']);
 expect(await noWideScroll(page)).toBe(true);
 expect(f.calls).toEqual([]);expect(f.errors).toEqual([]);
});

test('텔레그램 390: [이름 붙이기] → 이름 상자(범위 안내·칩), 빈 이름은 막고, 저장하면 그 방·그 날 줄에 이름, 뒤로가기는 상자만 닫음',async({page})=>{
 const f=await fixture(page,{width:390,senderTables:'seed'});
 await openMenu(page,390,'텔레그램 소식');
 const view=await openRaw(page,390,T3);
 await tap(page,view.locator('[data-tg-name-open="A"]'),390);
 const box=view.locator('[data-tg-sbox]');await expect(box).toBeVisible();
 await expect(box).toContainText('A에 이름 붙이기');
 await expect(box.locator('.feed-scope')).toHaveText('이 방 이 날 소식에만 적용돼요');
 await expect(box.locator('[data-tg-sbox-chip]')).toHaveText(['가상갑','손이름']);
 // 상자는 [이름 붙이기] 줄 바로 아래, 원문 줄 수에는 들어가지 않는다.
 await expect(view.locator('[data-tg-raw] .feed-rm')).toHaveCount(1);
 expect(await noWideScroll(page)).toBe(true);
 // 폰 뒤로가기는 상자만 닫고 원문은 그대로.
 await page.goBack();await expect(box).toBeHidden();await expect(view.locator('#tgDetail')).toBeVisible();
 await tap(page,view.locator('[data-tg-name-open="A"]'),390);
 await expect(box).toBeVisible();
 // 빈 이름은 서버로 가지 않는다.
 await tap(page,box.locator('[data-tg-sbox-save]'),390);
 await expect(box.locator('.feed-status')).toHaveText('이름을 적어 주세요.');
 expect(f.calls).toEqual([]);
 await box.locator('[data-tg-sbox-input]').fill('가상을');
 await tap(page,box.locator('[data-tg-sbox-save]'),390);
 await expect.poll(()=>f.calls).toEqual([{fn:'set_name',p_room_key:'room-a',p_day:'2026-10-05',p_label:'A',p_name:'가상을'}]);
 await expect(whoTexts(view)).toHaveText(['가상을']);
 await expect(view.locator('[data-tg-sbox]')).toHaveCount(0);
 await expect(view.locator('[data-tg-detail-status]')).toHaveText('이름을 붙였어요.');
 // 다른 날의 같은 라벨에는 퍼지지 않는다(열쇠 없는 사람은 그 방·그 날에만).
 expect(f.names.links.filter(l=>l.label==='A'&&l.room_key==='room-a').map(l=>l.day).sort()).toEqual(['2026-10-05','2026-10-06']);
 expect(f.errors).toEqual([]);
});

test('텔레그램 1280: 이미 있는 사람 칩을 고르면 새로 생긴 열쇠 없는 사람을 그 사람에게 합친다(같은 사람을 날마다 새로 만들지 않음)',async({page})=>{
 const f=await fixture(page,{width:1280,senderTables:'seed'});
 await openMenu(page,1280,'텔레그램 소식');
 const view=await openRaw(page,1280,T3);
 await tap(page,view.locator('[data-tg-name-open="A"]'),1280);
 const box=view.locator('[data-tg-sbox]');await expect(box).toBeVisible();
 await expect(box.locator('[data-tg-sbox-input]')).toBeFocused();
 await box.locator('[data-tg-sbox-chip]',{hasText:'가상갑'}).click();
 await expect(box.locator('[data-tg-sbox-input]')).toHaveValue('가상갑');
 await expect(box.locator('[data-tg-sbox-chip]',{hasText:'가상갑'})).toHaveAttribute('aria-pressed','true');
 await box.locator('[data-tg-sbox-save]').click();
 await expect.poll(()=>f.calls.map(c=>c.fn)).toEqual(['set_name','merge']);
 expect(f.calls[0]).toMatchObject({p_room_key:'room-a',p_day:'2026-10-05',p_label:'A',p_name:'가상갑'});
 expect(f.calls[1]).toEqual({fn:'merge',p_from:'81000000-0000-4000-8000-000000000001',p_to:P1});
 await expect(whoTexts(view)).toHaveText(['가상갑']);
 expect(f.names.senders.map(x=>x.id).sort()).toEqual([P1,P2,P3]);
 expect(f.errors).toEqual([]);
});

test('텔레그램 1280: 머리줄 ⋯ → 보낸 사람 이름: 목록, 이름 고치기, 합치기(열쇠 안내), 지우기',async({page})=>{
 const f=await fixture(page,{width:1280,senderTables:'seed'});
 await openMenu(page,1280,'텔레그램 소식');
 const view=page.locator('#telegramView');
 await view.locator('[data-tg-head-more]').click();
 await page.locator('#tgMenu').getByRole('button',{name:'보낸 사람 이름',exact:true}).click();
 await expect(view.locator('.feed-head-title')).toHaveText('보낸 사람 이름 · 3명');
 const rows=view.locator('[data-tg-person]');await expect(rows).toHaveCount(3);
 await expect(view.locator('.feed-grp')).toHaveText(['이름 있음 3명']);
 const row=id=>view.locator(`[data-tg-person="${id}"]`);
 await expect(row(P1)).toContainText('가상갑');await expect(row(P1)).toContainText('자동');await expect(row(P1)).toContainText('방 1 · 10. 6.');
 await expect(row(P2)).toContainText('나');
 await expect(row(P3)).toContainText('손이름');await expect(row(P3)).toContainText('직접');

 // 이름 고치기.
 await row(P1).locator('[data-tg-person-more]').click();
 await page.locator('#tgPersonMenu').getByRole('button',{name:'이름 고치기',exact:true}).click();
 const box=view.locator('[data-tg-sbox]');await expect(box).toBeVisible();
 await expect(box.locator('.feed-scope')).toHaveText('같은 사람의 다른 소식에도 보입니다');
 await box.locator('[data-tg-sbox-input]').fill('새이름');
 await box.locator('[data-tg-sbox-save]').click();
 await expect.poll(()=>f.calls).toEqual([{fn:'set_name',p_room_key:'room-a',p_day:'2026-10-06',p_label:'A',p_name:'새이름'}]);
 await expect(row(P1)).toContainText('새이름');await expect(row(P1)).toContainText('직접');

 // 합치기: 안내문과, 두 사람 모두 열쇠가 있을 때의 강한 안내. 고르기 전에는 [합치기]가 막혀 있다.
 await row(P1).locator('[data-tg-person-more]').click();
 await page.locator('#tgPersonMenu').getByRole('button',{name:'다른 사람과 합치기',exact:true}).click();
 const man=view.locator('[data-tg-sman]');await expect(man).toBeVisible();
 await expect(man).toContainText('두 사람 모두 열쇠가 있으면 앞으로 새 사람이 생길 수 있어요');
 await expect(man).not.toContainText('이 두 사람은 모두 열쇠가 있어요');
 await expect(man.locator('[data-tg-sman-save]')).toBeDisabled();
 await man.locator('[data-tg-sman-to]').selectOption(P2);
 await expect(man).toContainText('이 두 사람은 모두 열쇠가 있어요');
 await man.locator('[data-tg-sman-save]').click();
 await expect.poll(()=>f.calls.at(-1)).toEqual({fn:'merge',p_from:P1,p_to:P2});
 await expect(view.locator('.feed-head-title')).toHaveText('보낸 사람 이름 · 2명');
 await expect(rows).toHaveCount(2);

 // 지우기: 소식 글은 그대로.
 await row(P3).locator('[data-tg-person-more]').click();
 await page.locator('#tgPersonMenu').getByRole('button',{name:/^지우기/}).click();
 await expect(view.locator('[data-tg-sman]')).toContainText('소식 글은 그대로예요');
 await view.locator('[data-tg-sman-save]').click();
 await expect.poll(()=>f.calls.at(-1)).toEqual({fn:'forget',p_id:P3});
 await expect(rows).toHaveCount(1);
 expect(f.items.filter(x=>x.source==='telegram').every(x=>x.raw_text&&x.hidden_at==null)).toBe(true);

 // ‹ 소식 으로 돌아오면 소식 목록, 그때 원문은 지워진 이름 대신 A·B.
 await view.locator('[data-tg-shelf-back]').click();
 await expect(view.locator('[data-tg-item]').first()).toBeVisible();
 await openRaw(page,1280,T2);
 await expect(whoTexts(view)).toHaveText(['A이름 붙이기','B이름 붙이기']);
 expect(f.errors).toEqual([]);
});

test('텔레그램 390: 이름표가 비어 있으면 지금처럼 A·B(+이름 붙이기), 목록은 안내 한 줄',async({page})=>{
 const f=await fixture(page,{width:390,senderTables:'empty'});
 await openMenu(page,390,'텔레그램 소식');
 const view=await openRaw(page,390,T1);
 await expect(whoTexts(view)).toHaveText(['A이름 붙이기','B이름 붙이기','A']);
 await page.goBack();await expect(view.locator('#tgList')).toBeVisible();
 await tap(page,view.locator('[data-tg-head-more]'),390);
 await tap(page,page.locator('#tgMenu').getByRole('button',{name:'보낸 사람 이름',exact:true}),390);
 await expect(view.locator('[data-tg-empty="senders"]')).toContainText('아직 붙인 이름이 없어요');
 await tap(page,view.locator('[data-tg-shelf-back]'),390);
 await expect(view.locator('[data-tg-item]').first()).toBeVisible();
 expect(await noWideScroll(page)).toBe(true);expect(f.errors).toEqual([]);
});

for(const tables of ['missing','broken'])test(`텔레그램 390: 이름표 읽기 실패(${tables})여도 소식과 원문은 A·B 그대로, [이름 붙이기] 없음`,async({page})=>{
 const f=await fixture(page,{width:390,senderTables:tables});
 await openMenu(page,390,'텔레그램 소식');
 const view=await openRaw(page,390,T1);
 await expect(whoTexts(view)).toHaveText(['A','B','A']);
 await expect(view.locator('[data-tg-name-open]')).toHaveCount(0);
 await page.goBack();await expect(view.locator('#tgList')).toBeVisible();
 await tap(page,view.locator('[data-tg-head-more]'),390);
 await tap(page,page.locator('#tgMenu').getByRole('button',{name:'보낸 사람 이름',exact:true}),390);
 await expect(view.locator('[data-tg-empty="senders"]')).toContainText('이름표를 아직 불러오지 못했어요');
 expect(f.calls).toEqual([]);
});
