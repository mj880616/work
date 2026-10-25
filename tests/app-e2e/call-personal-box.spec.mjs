// CALL-개인통화함 3단계 (docs/design/call-personal.md, B안): 통화 메뉴의 업무 통화함 · 개인 통화함, 확인할 통화(애매), 옮기기.
// 서버는 흉내(app_feed_items·app_call_personal·app_call_move·원장 처리 표)다. 이름·내용은 모두 지어낸 것이다.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const ORG='30000000-0000-4000-8000-0000000000c1';
const W1='61000000-0000-4000-8000-000000000001',W2='61000000-0000-4000-8000-000000000002';
const P1='62000000-0000-4000-8000-000000000001',U1='62000000-0000-4000-8000-000000000011',U2='62000000-0000-4000-8000-000000000012';
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
async function fixture(page,{width=1280,ledgerSeen=[],personalMissing=false,refill='ok'}={}){
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
   const body=r.request().postDataJSON();refills.push(body);
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
async function openCalls(page,width){
 if(width>=1024){const item=page.locator('#appView>.app-nav').getByRole('button',{name:'통화',exact:true});await expect(item).toBeVisible();await item.click();}
 else{await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu nav').getByRole('button',{name:'통화',exact:true}).click();}
 await expect(page.locator('#callsView')).toBeVisible();
}
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();}
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280])test(`통화 ${width}: 업무 통화함 기본 + 맨 위 '개인 통화함 n ›' + 확인할 통화, 개인 통화함은 같은 목록·상세, 조직 연결·고정 없음`,async({page})=>{
 const f=await fixture(page,{width});
 await openCalls(page,width);
 const view=page.locator('#callsView');
 // 업무 통화함: 업무 통화만 날짜 목록에, 개인·애매는 목록에 섞이지 않는다.
 expect(await view.locator('.feed-rows:not(.feed-ask-rows) [data-cf-row]').evaluateAll(a=>a.map(e=>e.dataset.cfRow))).toEqual([W1,W2]);
 await expect(view.locator('[data-cf-box="personal"]')).toHaveText('개인 통화함 1 ›');
 await expect(view.locator('[data-cf-ask-head]')).toContainText('확인할 통화 2');
 await expect(view.locator('.feed-ask [data-cf-decide]')).toHaveText(['업무','개인','업무','개인']);
 await expect(view.locator('[data-cf-filtered]')).toHaveCount(0);
 expect(await noWideScroll(page)).toBe(true);
 // 개인 통화함: 같은 목록 모양, 개인 통화만, 안내 두 줄(옛 걸러짐 개수는 한 줄로).
 await tap(page,view.locator('[data-cf-box="personal"]'),width);
 await expect(view.locator('[data-cf-pcount]')).toHaveText('1건');
 expect(await view.locator('[data-cf-row]').evaluateAll(a=>a.map(e=>e.dataset.cfRow))).toEqual([P1]);
 await expect(view.locator('[data-cf-note]')).toContainText('전체 검색에도 나오지 않아요');
 await expect(view.locator('[data-cf-legacy]')).toContainText('목록 도입 전 걸러진 3건은 개수만 있어요');
 await expect(view.locator('[data-cf-ask-head]')).toHaveCount(0);
 expect(await noWideScroll(page)).toBe(true);
 await tap(page,view.locator(`[data-cf-row="${P1}"]`),width);
 const detail=view.locator('#cfDetail');
 await expect(detail.locator('[data-cf-meta]')).toContainText('가상 친구 · 개인');
 await expect(detail.locator('[data-cf-points] li')).toHaveText(['토요일 저녁 7시']);
 await expect(detail.locator('[data-cf-link-pick],[data-cf-link-text]')).toHaveCount(0);
 // 전문(사본)이 도착하면 상세를 한 번 다시 그린다. 그 뒤에 누른다.
 await expect(detail.locator('[data-cf-script],[data-cf-raw-empty]')).toHaveCount(1);
 await tap(page,detail.locator('[data-cf-more]'),width);
 const menu=page.locator('#cfMenu');await expect(menu).toBeVisible();
 await expect(menu.locator('button')).toHaveText(['업무 통화로 옮기기','요약 복사','지우기 목록에서만']);
 await page.keyboard.press('Escape');
 // 폰: 뒤로가기 한 칸 = 개인 통화함 목록, 한 칸 더 = 업무 통화함.
 if(width<1024){
  await page.goBack();await expect(view.locator('#cfList')).toBeVisible();await expect(view.locator('[data-cf-pcount]')).toBeVisible();
  await page.goBack();await expect(view.locator('[data-cf-box="personal"]')).toBeVisible();
 }else{await tap(page,view.locator('[data-cf-box="work"]'),width);await expect(view.locator('[data-cf-box="personal"]')).toBeVisible();}
 expect(f.moves).toEqual([]);
 expect(f.errors).toEqual([]);
});

test('통화 1280: 개인 통화를 업무 통화로 옮기기(⋯ 메뉴) — app_call_move 한 번, 목록이 두 함 모두 바뀜, 되돌리기',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator('[data-cf-box="personal"]').click();
 await view.locator(`[data-cf-row="${P1}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-script],#cfDetail [data-cf-raw-empty]')).toHaveCount(1);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'업무 통화로 옮기기'}).click();
 await expect.poll(()=>f.moves).toEqual([{p_id:P1,p_to:'work'}]);
 await expect(view.locator('[data-cf-empty="personal"]')).toHaveText('개인 통화함이 비어 있어요.');
 await expect(view.locator('[data-cf-status]')).toContainText('업무 통화로 옮겼어요.');
 await view.locator('[data-cf-undo]').click();
 await expect.poll(()=>f.moves.length).toBe(2);
 expect(f.moves[1]).toEqual({p_id:P1,p_to:'personal'});
 await expect(view.locator(`[data-cf-row="${P1}"]`)).toHaveCount(1);
 await view.locator('[data-cf-box="work"]').click();
 await expect(view.locator('[data-cf-box="personal"]')).toHaveText('개인 통화함 1 ›');
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`통화 ${width}: 확인할 통화에서 바로 [업무][개인]으로 정한다`,async({page})=>{
 const f=await fixture(page,{width});
 await openCalls(page,width);
 const view=page.locator('#callsView');
 await tap(page,view.locator(`[data-cf-item="${U1}"] [data-cf-decide="personal"]`),width);
 await expect.poll(()=>f.moves).toEqual([{p_id:U1,p_to:'personal'}]);
 await expect(view.locator('[data-cf-ask-head]')).toContainText('확인할 통화 1');
 await expect(view.locator('[data-cf-box="personal"]')).toHaveText('개인 통화함 2 ›');
 await expect(view.locator('[data-cf-status]')).toContainText('개인 통화로 정했어요.');
 await tap(page,view.locator(`[data-cf-item="${U2}"] [data-cf-decide="work"]`),width);
 await expect.poll(()=>f.moves.length).toBe(2);
 expect(f.moves[1]).toEqual({p_id:U2,p_to:'work'});
 await expect(view.locator('[data-cf-ask-head]')).toHaveCount(0);
 await expect(view.locator(`[data-cf-row="${U2}"]`)).toHaveCount(1);
 expect(f.errors).toEqual([]);
});

test('통화 1280: 업무→개인은 원장에 이미 쓰인 통화면 먼저 안내하고, [개인 통화로 옮기기]를 눌러야 옮긴다. 안 쓰였고 연결도 없으면 바로 옮긴다',async({page})=>{
 const f=await fixture(page,{width:1280,ledgerSeen:[W1]});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator(`[data-cf-row="${W1}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-script],#cfDetail [data-cf-raw-empty]')).toHaveCount(1);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'개인 통화로 옮기기'}).click();
 const warn=view.locator('#cfDetail [data-cf-confirm]');
 await expect(warn).toContainText('원장 기록은 지워지지 않아요');
 await expect(warn).toContainText('고정과 조직 연결은');
 expect(f.moves).toEqual([]);
 await warn.getByRole('button',{name:'취소'}).click();
 await expect(warn).toHaveCount(0);expect(f.moves).toEqual([]);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'개인 통화로 옮기기'}).click();
 await view.locator('#cfDetail [data-cf-confirm-go]').click();
 await expect.poll(()=>f.moves).toEqual([{p_id:W1,p_to:'personal'}]);
 await expect(view.locator(`[data-cf-row="${W1}"]`)).toHaveCount(0);
 await expect(view.locator('[data-cf-box="personal"]')).toHaveText('개인 통화함 2 ›');
 // 연결도 원장 흔적도 없는 통화는 묻지 않고 옮긴다.
 await view.locator(`[data-cf-row="${W2}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-script],#cfDetail [data-cf-raw-empty]')).toHaveCount(1);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'개인 통화로 옮기기'}).click();
 await expect.poll(()=>f.moves.length).toBe(2);
 expect(f.moves[1]).toEqual({p_id:W2,p_to:'personal'});
 expect(f.errors).toEqual([]);
});

test('통화 1280: 목록 줄을 오른쪽 클릭하면 같은 메뉴가 누른 자리에서 열리고 옮길 수 있다',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator(`[data-cf-row="${W2}"]`).click({button:'right'});
 const menu=page.locator('#cfMenu');await expect(menu).toBeVisible();
 await expect(menu.locator('button')).toHaveText(['고정','요약 복사','개인 통화로 옮기기','지우기 목록에서만']);
 await menu.getByRole('button',{name:'개인 통화로 옮기기'}).click();
 await expect.poll(()=>f.moves).toEqual([{p_id:W2,p_to:'personal'}]);
 expect(f.errors).toEqual([]);
});

test('통화 390: 줄을 길게 누르면 같은 메뉴가 열린다',async({page})=>{
 const f=await fixture(page,{width:390});
 await openCalls(page,390);
 const view=page.locator('#callsView');
 const row=view.locator(`[data-cf-row="${W2}"]`);await row.scrollIntoViewIfNeeded();
 const b=await row.boundingBox();
 await row.dispatchEvent('pointerdown',{pointerType:'touch',clientX:b.x+40,clientY:b.y+b.height/2,bubbles:true});
 await page.waitForTimeout(700);
 const menu=page.locator('#cfMenu');await expect(menu).toBeVisible();
 await expect(menu.getByRole('button',{name:'개인 통화로 옮기기'})).toBeVisible();
 expect(f.moves).toEqual([]);
 expect(f.errors).toEqual([]);
});

test('통화 390: 개인 표가 아직 없으면 업무 통화는 그대로 보이고 개인 통화함 칩만 없다',async({page})=>{
 const f=await fixture(page,{width:390,personalMissing:true});
 await openCalls(page,390);
 const view=page.locator('#callsView');
 await expect(view.locator('[data-cf-row]')).toHaveCount(2);
 await expect(view.locator('[data-cf-box]')).toHaveCount(0);
 await expect(view.locator('[data-cf-ask-head]')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});

test('통화 1280: 개인→업무로 옮기면 그 한 건만 call_refill로 다시 채우고(제목·조직·상대), 핵심내용은 그대로, 안내 줄에 알린다',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator('[data-cf-box="personal"]').click();
 await view.locator(`[data-cf-row="${P1}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-script],#cfDetail [data-cf-raw-empty]')).toHaveCount(1);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'업무 통화로 옮기기'}).click();
 await expect.poll(()=>f.moves).toEqual([{p_id:P1,p_to:'work'}]);
 await expect.poll(()=>f.refills).toEqual([{kind:'call_refill',id:P1}]);
 await view.locator('[data-cf-box="work"]').click();
 const row=view.locator(`[data-cf-row="${P1}"]`);
 await expect(row.locator('.feed-title')).toContainText('임금교섭 3차 일정 협의');
 await expect(row.locator('.feed-org')).toHaveText('예시지부');
 await expect(view.locator('[data-cf-status]')).toContainText('제목·조직·상대를 채웠어요');
 await row.click();
 await expect(view.locator('#cfDetail [data-cf-points] li')).toHaveText(['토요일 저녁 7시']);
 expect(f.refills.length).toBe(1);
 expect(f.errors).toEqual([]);
});

test('통화 1280: 다시 채우기가 실패하면 통화는 업무함에 옛 값 그대로 있고 한 줄로만 알린다. 업무→개인·확인할 통화 "개인"은 AI를 부르지 않는다',async({page})=>{
 const f=await fixture(page,{width:1280,refill:'fail'});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator('[data-cf-box="personal"]').click();
 await view.locator(`[data-cf-row="${P1}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-script],#cfDetail [data-cf-raw-empty]')).toHaveCount(1);
 await view.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'업무 통화로 옮기기'}).click();
 await expect.poll(()=>f.refills.length).toBe(1);
 await expect(view.locator('[data-cf-status]')).toContainText('채우지 못해 옛 값 그대로예요');
 await view.locator('[data-cf-box="work"]').click();
 await expect(view.locator(`[data-cf-row="${P1}"] .feed-title`)).toContainText('가상 저녁 약속 정하기');
 // 개인으로 보내는 길은 AI를 부르지 않는다.
 await view.locator(`[data-cf-row="${W2}"]`).click({button:'right'});
 await page.locator('#cfMenu').getByRole('button',{name:'개인 통화로 옮기기'}).click();
 await expect.poll(()=>f.moves.length).toBe(2);
 await tap(page,view.locator(`[data-cf-item="${U1}"] [data-cf-decide="personal"]`),1280);
 await expect.poll(()=>f.moves.length).toBe(3);
 expect(f.refills.length).toBe(1);
 expect(f.errors).toEqual([]);
});
