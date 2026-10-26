// CALL-손고치기 (docs/design/call-user-edit.md): 통화 제목(줄 안 바로 고치기·F2)·조직/이름·핵심내용을 손으로 고치고, 고친 값이 서버에 사용자 값으로 저장돼
// AI가 다시 채워도 덮이지 않는지, [업무 · 개인] 버튼이 작은 글자 버튼인지 본다. 서버는 흉내(app_feed_items·app_call_edits·app_call_edit·원장 처리 표)다.
// 이름·내용은 모두 지어낸 것이다.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const ORG='30000000-0000-4000-8000-0000000000c1',ORG2='30000000-0000-4000-8000-0000000000c2';
const W1='61000000-0000-4000-8000-000000000001',W2='61000000-0000-4000-8000-000000000002';
const U1='62000000-0000-4000-8000-000000000011';
const workBase={workspace_id:'w',source:'call',room_key:null,room_label:null,summary:null,speaker_split:false,raw_count:0,project_id:null,drive_url:null,pinned_at:null,hidden_at:null,updated_at:'2026-10-06T00:00:00Z'};
const perBase={workspace_id:'w',summary:null,speaker_split:false,drive_url:null,hidden_at:null,moved_at:null,updated_at:'2026-10-06T00:00:00Z'};
const data=()=>({
 work:[
  {...workBase,id:W1,day:'2026-10-06',occurred_at:'2026-10-06T00:42:00Z',title:'가상 교섭 일정 조정',points:['[확정] 다음 주 화요일로 변경','자료는 금요일까지'],counterpart:'예시지부 홍길동 팀장',organization_id:ORG,raw_text:'가상 전문 하나'},
  {...workBase,id:W2,day:'2026-10-05',occurred_at:'2026-10-05T05:00:00Z',title:'가상 자료 전달 확인',points:['금요일까지 전달'],counterpart:null,organization_id:null,raw_text:null},
 ],
 personal:[{...perBase,id:U1,kind:'unsure',day:'2026-10-06',occurred_at:'2026-10-06T00:10:00Z',title:'가상 처음 걸려 온 번호',points:['내용 확인 필요'],counterpart:null,raw_text:null}],
});
async function fixture(page,{width=1280,ledgerSeen=[],editsMissing=false}={}){
 await page.setViewportSize({width,height:860});
 const db=data(),edits=new Map(),calls=[],errors=[];
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
   const q=new URL(r.request().url()).searchParams;
   if(Number(q.get('offset')||0))return r.fulfill({json:[]});
   return r.fulfill({json:db.personal.filter(x=>!x.hidden_at).map(x=>fields(q,x))});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_call_edits',r=>{
   if(editsMissing)return r.fulfill({status:404,json:{code:'PGRST205',message:"Could not find the table 'public.app_call_edits' in the schema cache"}});
   if(r.request().method()!=='GET')return r.fulfill({status:405,json:{}});
   const q=new URL(r.request().url()).searchParams;
   if(Number(q.get('offset')||0))return r.fulfill({json:[]});
   return r.fulfill({json:[...edits].map(([call_id,vals])=>({call_id,vals}))});
  });
  // 서버 함수의 흉내: 칸 검사(제목 1~80자, 핵심내용 8줄·150자), 개인 통화는 조직 불가, reset은 사용자 값을 지움.
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_call_edit',r=>{
   const body=r.request().postDataJSON();calls.push(body);
   const row=db.work.find(x=>x.id===body.p_id)||db.personal.find(x=>x.id===body.p_id);
   if(!row)return r.fulfill({status:400,json:{message:'CALL_NOT_FOUND'}});
   const cur=edits.get(row.id)||{},next={...cur};
   for(const [k,v] of Object.entries(body.p_patch)){
    if(k==='reset'){for(const f of v)delete next[f];continue;}
    if(k==='title'&&(!v||v.length>80))return r.fulfill({status:400,json:{message:'CALL_EDIT_TITLE'}});
    if(k==='organization_id'&&row.kind)return r.fulfill({status:400,json:{message:'CALL_EDIT_PERSONAL_ORG'}});
    next[k]=v;
   }
   const changed=JSON.stringify(next)!==JSON.stringify(cur);
   if(Object.keys(next).length)edits.set(row.id,next);else edits.delete(row.id);
   return r.fulfill({json:{ok:true,id:row.id,changed,vals:next}});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_ledger_auto_sources',r=>{
   const id=eq(new URL(r.request().url()).searchParams,'source_id');
   return r.fulfill({json:ledgerSeen.includes(id)?[{source_id:id}]:[]});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_days',r=>r.fulfill({json:[]}));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganizations',r=>r.fulfill({json:Number(new URL(r.request().url()).searchParams.get('offset')||0)?[]:[{id:ORG,workspace_id:'w',name:'예시지부',active:true},{id:ORG2,workspace_id:'w',name:'가상본부',active:true}]}));
 }});
 return {db,edits,calls,errors};
}
async function openCalls(page,width){
 if(width>=1024){const item=page.locator('#appView>.app-nav').getByRole('button',{name:'통화',exact:true});await expect(item).toBeVisible();await item.click();}
 else{await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu nav').getByRole('button',{name:'통화',exact:true}).click();}
 await expect(page.locator('#callsView')).toBeVisible();
}
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();}
// 상세 열기: 전문(사본)이 도착하면 상세를 한 번 다시 그린다. 그 뒤에 누른다.
async function openDetail(page,view,id,width){
 await tap(page,view.locator(`[data-cf-row="${id}"]`),width);
 await expect(view.locator('#cfDetail [data-cf-script],#cfDetail [data-cf-raw-empty]')).toHaveCount(1);
}
// 메뉴 열기: PC는 줄 오른쪽 클릭, 폰은 상세의 ⋯ (상세를 먼저 연다).
async function openMenu(page,view,id,width){
 if(width>=1024){await view.locator(`[data-cf-row="${id}"]`).click({button:'right'});}
 else{await openDetail(page,view,id,width);await tap(page,view.locator('#cfDetail [data-cf-more]'),width);}
 await expect(page.locator('#cfMenu')).toBeVisible();
}
const statusOf=(view,width)=>width>=1024?view.locator('#cfList [data-cf-status]'):view.locator('#cfDetail [data-cf-detail-status]');
const titleField=(view,width)=>width>=1024?view.locator('#cfList [data-cf-title-input]'):view.locator('#cfDetail [data-cf-title-input]');

for(const width of [390,1280])test(`통화 ${width}: 제목 바꾸기 — 줄 안 입력칸이 전체 선택으로 열리고 Enter로 저장, 서버에는 사용자 값으로, 되돌리기`,async({page})=>{
 const f=await fixture(page,{width});
 await openCalls(page,width);
 const view=page.locator('#callsView');
 await openMenu(page,view,W1,width);
 await expect(page.locator('#cfMenu button').first()).toHaveText(/^제목 바꾸기/);
 await page.locator('#cfMenu').getByRole('button',{name:/^제목 바꾸기/}).click();
 const input=titleField(view,width);
 await expect(input).toBeFocused();
 expect(await input.evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length&&e.value.length>0)).toBe(true);
 await input.fill('손으로 고친 제목');
 await input.press('Enter');
 await expect.poll(()=>f.calls).toEqual([{p_id:W1,p_patch:{title:'손으로 고친 제목'}}]);
 await expect(statusOf(view,width)).toContainText('제목을 바꿨어요');
 await expect(statusOf(view,width).locator('[data-cf-undo]')).toBeVisible();
 expect(f.edits.get(W1)).toEqual({title:'손으로 고친 제목'});
 expect(f.db.work[0].title).toBe('가상 교섭 일정 조정'); // AI 원래 값은 그대로
 await expect(view.locator(`[data-cf-row="${W1}"] .feed-title`)).toHaveText('손으로 고친 제목');
 await statusOf(view,width).locator('[data-cf-undo]').click();
 await expect.poll(()=>f.calls.length).toBe(2);
 expect(f.calls[1]).toEqual({p_id:W1,p_patch:{reset:['title']}});
 await expect(view.locator(`[data-cf-row="${W1}"] .feed-title`)).toHaveText('가상 교섭 일정 조정');
 expect(f.errors).toEqual([]);
});

test('통화 1280: F2로 제목 입력, Esc는 취소(서버 호출 없음), 바깥을 누르면 저장, 비우면 그대로',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openCalls(page,1280);
 const view=page.locator('#callsView'),row=view.locator(`[data-cf-row="${W2}"]`);
 await row.focus();await page.keyboard.press('F2');
 const input=view.locator('#cfList [data-cf-title-input]');
 await expect(input).toBeFocused();
 await input.fill('저장하지 않을 글');await page.keyboard.press('Escape');
 await expect(input).toHaveCount(0);
 await expect(row.locator('.feed-title')).toHaveText('가상 자료 전달 확인');
 expect(f.calls).toEqual([]);
 await row.focus();await page.keyboard.press('F2');
 await input.fill('바깥을 눌러 저장');
 await view.locator('#cfDetail').click({position:{x:20,y:200}});
 await expect.poll(()=>f.calls).toEqual([{p_id:W2,p_patch:{title:'바깥을 눌러 저장'}}]);
 await expect(view.locator('#cfList [data-cf-status]')).toContainText('제목을 바꿨어요');
 await row.focus();await page.keyboard.press('F2');
 await input.fill('   ');await input.press('Enter');
 await expect(view.locator('#cfList [data-cf-status]')).toContainText('제목은 비울 수 없어서 그대로 뒀어요');
 expect(f.calls.length).toBe(1);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`통화 ${width}: 조직·이름 고치기 — 상세의 상대 표를 눌러 이름·직함·조직을 고치고 서버에 사용자 값으로 저장`,async({page})=>{
 const f=await fixture(page,{width});
 await openCalls(page,width);
 const view=page.locator('#callsView');
 await openDetail(page,view,W1,width);
 const detail=view.locator('#cfDetail');
 await expect(detail.locator('[data-cf-who-open]')).toContainText('홍길동');
 await tap(page,detail.locator('[data-cf-who-open]'),width);
 const box=detail.locator('[data-cf-who-box]');
 await expect(box).toBeVisible();
 await expect(box.locator('[data-cf-who-name]')).toHaveValue('홍길동');
 await expect(box.locator('[data-cf-who-role]')).toHaveValue('팀장');
 await box.locator('[data-cf-who-name]').fill('김가상');
 await box.locator('[data-cf-who-role]').fill('지부장');
 await tap(page,box.locator('[data-cf-who-pick]'),width);
 await page.locator('[data-sheet-value="'+ORG2+'"]').click();
 await expect(box.locator('[data-cf-who-pick]')).toContainText('가상본부');
 await tap(page,box.locator('[data-cf-who-save]'),width);
 await expect.poll(()=>f.calls).toEqual([{p_id:W1,p_patch:{counterpart:'김가상 지부장',organization_id:ORG2}}]);
 await expect(detail.locator('[data-cf-meta]')).toContainText('김가상 지부장');
 await expect(detail.locator('[data-cf-meta]')).toContainText('고침');
 expect(f.db.work[0].counterpart).toBe('예시지부 홍길동 팀장'); // AI 값은 그대로
 expect(f.db.work[0].organization_id).toBe(ORG);
 // AI 값으로
 await tap(page,detail.locator('[data-cf-who-open]'),width);
 await tap(page,detail.locator('[data-cf-who-reset]'),width);
 await expect.poll(()=>f.calls.at(-1)).toEqual({p_id:W1,p_patch:{reset:['counterpart','organization_id']}});
 await expect(detail.locator('[data-cf-meta]')).toContainText('홍길동');
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`통화 ${width}: 핵심내용 고치기 — 줄마다 고치기·지우기·더하기, 취소는 서버 호출 없음, 저장하면 복사 글도 고친 값`,async({page})=>{
 const f=await fixture(page,{width,ledgerSeen:[W1]});
 await openCalls(page,width);
 const view=page.locator('#callsView'),detail=view.locator('#cfDetail');
 await openDetail(page,view,W1,width);
 await tap(page,detail.locator('[data-cf-sum-open]').first(),width);
 const lines=detail.locator('[data-cf-sum-line]');
 await expect(lines.first()).toHaveValue('[확정] 다음 주 화요일로 변경');
 await tap(page,detail.locator('[data-cf-sum-cancel]'),width);
 expect(f.calls).toEqual([]);
 await tap(page,detail.locator('[data-cf-sum-open]').first(),width);
 await lines.nth(0).fill('[확정] 다음 주 수요일로 변경');
 await tap(page,detail.locator('[data-cf-sum-del="1"]'),width);
 await tap(page,detail.locator('[data-cf-sum-add]'),width);
 await detail.locator('[data-cf-sum-line]').nth(1).fill('회의실 예약');
 await tap(page,detail.locator('[data-cf-sum-save]'),width);
 await expect.poll(()=>f.calls).toEqual([{p_id:W1,p_patch:{points:['[확정] 다음 주 수요일로 변경','회의실 예약']}}]);
 await expect(detail.locator('[data-cf-points] li')).toHaveCount(2);
 await expect(detail.locator('[data-cf-points]')).toContainText('수요일로 변경');
 expect(f.db.work[0].points).toEqual(['[확정] 다음 주 화요일로 변경','자료는 금요일까지']);
 // 이미 원장에 읽힌 통화이므로 원장은 그대로라는 한 줄만 알린다.
 await expect(detail.locator('[data-cf-detail-status]')).toContainText('이미 원장에 들어갔어요');
 await expect(detail.locator('[data-cf-detail-status]')).toContainText('원장은 그대로예요');
 expect(f.errors).toEqual([]);
});

test('통화 1280: 고친 값은 AI가 같은 칸을 다시 써도 그대로(사용자 값이 앞선다), 다시 불러와도 유지',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator(`[data-cf-row="${W1}"]`).click({button:'right'});
 await page.locator('#cfMenu').getByRole('button',{name:/^제목 바꾸기/}).click();
 await view.locator('#cfList [data-cf-title-input]').fill('내가 고친 제목');await page.keyboard.press('Enter');
 await expect.poll(()=>f.calls.length).toBe(1);
 // 서버의 AI 다시 채우기가 제목·상대를 덮어쓴 것처럼 흉내 낸다.
 Object.assign(f.db.work[0],{title:'AI가 다시 쓴 제목',counterpart:'예시지부 다른사람 과장'});
 await page.evaluate(()=>window.KPTUCallFeed.reload());
 await expect(view.locator(`[data-cf-row="${W1}"] .feed-title`)).toHaveText('내가 고친 제목');
 await view.locator(`[data-cf-row="${W1}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-meta]')).toContainText('다른사람');
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`통화 ${width}: 확인할 통화의 업무 · 개인은 작은 글자 버튼이고 상세 위 줄도 같다`,async({page})=>{
 const f=await fixture(page,{width});
 await openCalls(page,width);
 const view=page.locator('#callsView'),btns=view.locator('.feed-ask [data-cf-decide]');
 await expect(btns).toHaveText(['업무','개인']);
 for(const b of await btns.all()){
  expect(await b.evaluate(e=>e.classList.contains('feed-text-btn')&&!e.classList.contains('feed-small'))).toBe(true);
  expect(await b.evaluate(e=>e.getBoundingClientRect().height)).toBeLessThanOrEqual(32);
 }
 await tap(page,view.locator(`[data-cf-row="${U1}"]`),width);
 const bar=view.locator('#cfDetail [data-cf-decide-bar] [data-cf-decide]');
 await expect(bar).toHaveText(['업무','개인']);
 expect(await bar.first().evaluate(e=>e.classList.contains('feed-text-btn'))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.errors).toEqual([]);
});

test('통화 1280: 개인 통화도 제목·이름·핵심내용은 고치지만 조직은 고치는 칸이 없다',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await view.locator(`[data-cf-row="${U1}"]`).click();
 await view.locator('#cfDetail [data-cf-more]').click();
 await expect(page.locator('#cfMenu').getByRole('button',{name:'이름 고치기'})).toBeVisible();
 await page.locator('#cfMenu').getByRole('button',{name:'이름 고치기'}).click();
 await expect(view.locator('#cfDetail [data-cf-who-pick]')).toHaveCount(0);
 await view.locator('#cfDetail [data-cf-who-name]').fill('가상 상대');
 await view.locator('#cfDetail [data-cf-who-save]').click();
 await expect.poll(()=>f.calls).toEqual([{p_id:U1,p_patch:{counterpart:'가상 상대'}}]);
 expect(f.errors).toEqual([]);
});

test('통화 1280: 고친 값 표가 아직 없으면(DB 적용 전) 고치기 항목만 없고 목록·상세는 그대로 열린다',async({page})=>{
 const f=await fixture(page,{width:1280,editsMissing:true});
 await openCalls(page,1280);
 const view=page.locator('#callsView');
 await expect(view.locator('[data-cf-row]')).toHaveCount(3);
 await view.locator(`[data-cf-row="${W1}"]`).click({button:'right'});
 await expect(page.locator('#cfMenu')).toBeVisible();
 await expect(page.locator('#cfMenu').getByRole('button',{name:/제목 바꾸기|고치기/})).toHaveCount(0);
 await page.keyboard.press('Escape');
 await view.locator(`[data-cf-row="${W1}"]`).click();
 await expect(view.locator('#cfDetail [data-cf-who-open],#cfDetail [data-cf-sum-open]')).toHaveCount(0);
 await view.locator(`[data-cf-row="${W1}"]`).focus();await page.keyboard.press('F2');
 await expect(view.locator('[data-cf-title-input]')).toHaveCount(0);
 expect(f.calls).toEqual([]);
});
