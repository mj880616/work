// CALL-통화메뉴 4단계 (docs/design/call-telegram-feed.md 10절 시안): 사이드바 맨 아래 [통화]·[텔레그램 소식]. 텔레그램 화면 본 시험은 tg-room-day.spec.mjs.
// 서버는 흉내(app_feed_items·app_feed_days·조직 기록)이고 고정·지우기·조직 연결을 기억한다. 이름·방·내용은 모두 지어낸 것이다.
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

async function fixture(page,{width=1280,missing=false,empty=false}={}){
 await page.setViewportSize({width,height:860});
 const items=empty?[]:rows(),writes=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource/.test(e.text()))errors.push(e.text());});
 await openHome(page,{beforeLoad:async()=>{
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',r=>{
   if(missing)return r.fulfill({status:404,json:{code:'PGRST205',message:"Could not find the table 'public.app_feed_items' in the schema cache"}});
   const req=r.request(),q=new URL(req.url()).searchParams,eq=k=>q.get(k)?.startsWith('eq.')?decodeURIComponent(q.get(k).slice(3)):null;
   if(req.method()==='GET'){
    if(Number(q.get('offset')||0))return r.fulfill({json:[]});
    let out=items.filter(x=>x.workspace_id===eq('workspace_id'));
    if(eq('id'))out=out.filter(x=>x.id===eq('id'));
    if(eq('source'))out=out.filter(x=>x.source===eq('source'));
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
  // TG-방날짜묶기: 텔레그램 화면의 방·날 목록 함수(이 파일의 텔레그램 시험은 빈 상태뿐이고, 본 시험은 tg-room-day.spec.mjs).
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_feed_room_day_lines',r=>missing?r.fulfill({status:404,json:{code:'PGRST202',message:'Could not find the function'}}):r.fulfill({json:[]}));
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
 return {items,writes,errors};
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

test('PC 1280: 사이드바 맨 아래 [통화]·[텔레그램 소식], 자주 가는 링크 바로 위',async({page})=>{
 const f=await fixture(page,{width:1280});
 const items=await page.locator('#appView>.app-nav .nav-btn:visible').allTextContents();
 expect(items.slice(-3,-1)).toEqual(['통화','텔레그램 소식']);
 // 빈 공간(.sidebar-spacer) 아래에 있다: 사이드바 맨 아래 묶음.
 const below=await page.evaluate(()=>{const s=document.querySelector('#appView>.app-nav .sidebar-spacer').getBoundingClientRect(),c=document.querySelector('#appView>.app-nav [data-view="calls"]').getBoundingClientRect();return c.top>=s.bottom-1});
 expect(below).toBe(true);
 // 하단 탭은 늘지 않는다.
 await page.setViewportSize({width:390,height:860});
 await expect(page.locator('.mobile-tabs > button')).toHaveText(['홈','정리함','일정','사업 보고','담당조직','메뉴']);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`통화 ${width}: 날짜별 목록 → 상세(핵심내용 머리표·전문 펼치기) → 뒤로, 걸러짐 개수, 고정·지우기 저장`,async({page})=>{
 const f=await fixture(page,{width});
 await openMenu(page,width,'통화');
 const view=page.locator('#callsView');await expect(view).toBeVisible();
 await expect(page).toHaveURL(/view=calls/);
 await expect(view.locator('[data-cf-day]')).toHaveText(['10. 6. (화)','10. 4. (일)']);
 const first=view.locator(`[data-cf-row="${C1}"]`);
 await expect(first.locator('.feed-time')).toHaveText('09:42');await expect(first.locator('.feed-title')).toHaveText('가상 교섭 일정 다음 주로 조정');await expect(first.locator('.feed-org')).toHaveText('예시지부');
 // 같은 날은 시각 내림차순.
 await expect(view.locator('[data-cf-row]')).toHaveCount(3);
 expect(await view.locator('[data-cf-row]').evaluateAll(els=>els.map(e=>e.dataset.cfRow))).toEqual([C1,C2,C3]);
 // 맨 위 오른쪽 작은 '개인 통화함 n ›'(개인 통화함 줄이 없으면 0).
 await expect(view.locator('[data-cf-box="personal"]')).toHaveText('개인 통화함 0 ›');
 expect(await noWideScroll(page)).toBe(true);

 await tap(page,first,width);
 const detail=view.locator('#cfDetail');
 await expect(detail.locator('[data-cf-meta]')).toHaveText('10. 6. (화) · 09:42 · 예시지부 · 홍길동 위원장');
 await expect(detail.locator('[data-cf-points] li')).toHaveText(['가상 교섭 다음 주 화요일로 변경','요구안 12명 유지확정','회신 10. 12.(월)까지예정','장소 다시 확인확인']);
 await expect(detail.locator('[data-cf-points] .feed-tag')).toHaveText(['확정','예정','확인']);
 if(width>=1024){await expect(page.locator('[data-topline-where] [aria-current="page"]')).toHaveText('가상 교섭 일정 다음 주로 조정');await expect(detail.locator('[data-cf-title]')).toHaveCount(0);}
 else await expect(detail.locator('[data-cf-title]')).toHaveText('가상 교섭 일정 다음 주로 조정');
 // 전문(사본)이 도착하면 상세를 한 번 다시 그린다. 위치를 재기 전에 그 다시 그리기를 기다린다.
 await expect(detail.locator('[data-cf-script],[data-cf-raw-empty]')).toHaveCount(1);
 // UI-더보기제목줄: ⋯는 빈 줄을 따로 차지하지 않고 첫 줄(폰은 제목, PC는 날짜·시간 줄) 오른쪽 끝에 같은 줄로 놓인다.
 {const first=await detail.locator(width>=1024?'[data-cf-meta]':'[data-cf-title]').boundingBox(),more=await detail.locator('[data-cf-more]').boundingBox();
  expect(first&&more).toBeTruthy();expect(Math.abs(more.y+more.height/2-(first.y+Math.min(first.height,more.height)/2))).toBeLessThan(more.height);
  expect(more.x).toBeGreaterThan(first.x+first.width-1);expect(more.y).toBeLessThan(first.y+first.height);
  expect(await detail.locator('.feed-detail-head').evaluateAll(a=>a.filter(h=>h.querySelector('[data-cf-more]')).length)).toBe(0);}
 // 전문은 접혀 있다가 펼치면 한 문단 + "화자 구분은 전사 수정 뒤".
 const full=detail.locator('[data-cf-full]');await expect(full).not.toHaveAttribute('open','');
 await tap(page,full.locator('summary'),width);
 await expect(full.locator('[data-cf-script="one"]')).toContainText('사측에서 목요일은 어렵다고');
 await expect(full.locator('.feed-badge')).toHaveText('화자 구분은 전사 수정 뒤');
 await expect(full.locator('summary')).toContainText('전문 접기');

 // 핵심내용 제목 줄 오른쪽 [복사] → 클립보드에 제목·날짜·본문, 짧게 "복사했어요".
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 const copy=detail.locator('[data-cf-copy]');await expect(copy).toHaveCount(1);
 await tap(page,copy,width);
 await expect(detail.locator('[data-cf-detail-status]')).toHaveText('복사했어요');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('예시지부 · 홍길동 위원장 · 가상 교섭 일정 다음 주로 조정\n10. 6. (화) 09:42\n\n- 가상 교섭 다음 주 화요일로 변경\n- 요구안 12명 유지 [확정]\n- 회신 10. 12.(월)까지 [예정]\n- 장소 다시 확인 [확인]');
 // 폰의 '‹ 통화'는 본문 글자 크기(14px 이상)이고 누르는 자리가 글자보다 넓다.
 if(width<1024){const back=detail.locator('[data-cf-back]');await expect(back).toHaveText('‹ 통화');await expect(page.locator('.mobile-shell-header [data-mobile-view-name]')).toBeHidden();expect(await back.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14);}
 // 고정: ⋯ → 고정 → 서버에 pinned_at.
 await tap(page,detail.locator('[data-cf-more]'),width);
 const menu=page.locator('#cfMenu');await expect(menu).toBeVisible();
 await expect(menu.locator('button')).toHaveText([/^제목 바꾸기/,'조직·이름 고치기','요약 고치기','고정','조직 연결','요약 복사','Drive 원본 열기','개인 통화로 옮기기','지우기 목록에서만']);
 await tap(page,menu.getByRole('button',{name:'고정',exact:true}),width);
 await expect.poll(()=>f.writes.filter(w=>w.id===C1&&w.body.pinned_at).length).toBe(1);
 await expect(detail.locator('[data-cf-meta]')).toContainText('· 고정');

 if(width<1024){
  // 폰 뒤로가기 한 칸 = 목록.
  await page.goBack();await expect(view.locator('#cfList')).toBeVisible();await expect(detail).toBeHidden();
  await expect(view.locator('#callsView, #cfList')).toHaveCount(1);await expect(view).toBeVisible();
  await expect(first.locator('.feed-pin')).toHaveText('고정');
  await tap(page,view.locator(`[data-cf-row="${C2}"]`),width);
 }else await view.locator(`[data-cf-row="${C2}"]`).click();
 // 화자 구분이 있는 통화는 줄 단위.
 await expect(detail.locator('[data-cf-script],[data-cf-raw-empty]')).toHaveCount(1);
 await tap(page,detail.locator('[data-cf-full] summary'),width);
 await expect(detail.locator('[data-cf-script="lines"] p')).toHaveText(['나원고 언제까지예요?','화자2금요일까지요.']);
 await expect(detail.locator('[data-cf-script="lines"] p.is-me b')).toHaveText('나');
 await expect(detail.locator('.feed-badge')).toHaveCount(0);

 // 지우기: 목록에서 빠지고 hidden_at 저장, 되돌리기 가능.
 await tap(page,detail.locator('[data-cf-more]'),width);
 await tap(page,page.locator('#cfMenu').getByRole('button',{name:/^지우기/}),width);
 await expect.poll(()=>f.writes.filter(w=>w.id===C2&&w.body.hidden_at).length).toBe(1);
 await expect(view.locator(`[data-cf-row="${C2}"]`)).toHaveCount(0);
 await expect(view.locator('[data-cf-status]')).toContainText('목록에서 지웠어요');
 await tap(page,view.locator('[data-cf-undo]'),width);
 await expect.poll(()=>f.writes.filter(w=>w.id===C2&&w.body.hidden_at===null).length).toBe(1);
 await expect(view.locator(`[data-cf-row="${C2}"]`)).toHaveCount(1);
 // 바뀐 칸은 허용된 칸뿐(고정·지우기 + updated_at).
 for(const w of f.writes)for(const k of Object.keys(w.body))expect(['pinned_at','hidden_at','raw_text','organization_id','project_id','updated_at']).toContain(k);
 expect(f.errors).toEqual([]);
});

// CALL-원장재료 L-3: 지우기 뒤 "원장에 들어간 기록 N개는 남아요 · [원장에서도 틀림으로]" → 그 통화만 근거인 기록만 수정 요청 retire.
test('통화 1280: 지운 통화에서 원장에 들어간 기록 안내와 [원장에서도 틀림으로](그 통화만 근거인 기록만)',async({page})=>{
 const f=await fixture(page,{width:1280});
 const S1='80000000-0000-4000-8000-000000000001',R1='81000000-0000-4000-8000-000000000001',R2='81000000-0000-4000-8000-000000000002',R3='81000000-0000-4000-8000-000000000003',S2='80000000-0000-4000-8000-000000000002';
 const reads=[],fixes=[];
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_ledger_sources',r=>{reads.push(decodeURIComponent(new URL(r.request().url()).searchParams.get('location')||'').replace(/^eq\./,''));return r.fulfill({json:[{id:S1}]});});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_ledger_record_sources',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(q.get('source_id'))return r.fulfill({json:[{record_id:R1,source_id:S1},{record_id:R2,source_id:S1},{record_id:R3,source_id:S1}]});
  return r.fulfill({json:[{record_id:R1,source_id:S1},{record_id:R2,source_id:S1},{record_id:R2,source_id:S2},{record_id:R3,source_id:S1}]});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_ledger_records',r=>r.fulfill({json:[
  {id:R1,ledger_id:'COM-0951',validity:'needs_check'},{id:R2,ledger_id:'EVT-0952',validity:'current'},{id:R3,ledger_id:'DEC-0953',validity:'retired'}]}));
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_apply_ledger_fix',r=>{fixes.push(r.request().postDataJSON());return r.fulfill({json:{fix_request_id:'82000000-0000-4000-8000-000000000001',applied:1}});});
 await openMenu(page,1280,'통화');
 await page.locator(`#callsView [data-cf-row="${C1}"]`).click();
 await page.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:/^지우기/}).click();
 const status=page.locator('#callsView [data-cf-status]');
 await expect(status).toContainText('목록에서 지웠어요');
 await expect(status).toContainText('원장에 들어간 기록 2개는 남아요');
 expect(reads).toEqual([`web2:call:${C1}`]);
 await status.locator('[data-cf-ledger-retire]').click();
 await expect.poll(()=>fixes.length).toBe(1);
 expect(fixes[0].p_dry_run).toBe(false);
 expect(fixes[0].p_request.received_from).toBe('user');
 expect(fixes[0].p_request.items.map(i=>[i.target,i.do])).toEqual([['COM-0951','retire']]);
 await expect(status).toContainText('원장에서 1개를 틀린 기록으로 표시했어요');
 await expect(status).toContainText('다른 근거가 있는 1개는 그대로 뒀어요');
 await expect(status.locator('[data-cf-ledger-retire]')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});

// 원장 근거 ‹원문›(ledger-browse)이 부르는 KPTUCallFeed.open: 목록을 읽은 뒤 그 통화를 열고, 없는 통화는 열지 않는다.
test('통화 1280: KPTUCallFeed.open(id)은 그 통화 상세를 연다',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openMenu(page,1280,'통화');
 await expect(page.locator('#callsView [data-cf-row]').first()).toBeVisible();
 await page.evaluate(id=>window.KPTUCallFeed.open(id),C2);
 await expect(page.locator(`#callsView [data-cf-row="${C2}"]`)).toHaveAttribute('aria-current','true');
 await expect(page.locator(`#cfDetail [data-cf-detail="${C2}"]`)).toBeVisible();
 await page.evaluate(()=>window.KPTUCallFeed.open('60000000-0000-4000-8000-0000000000ff'));
 await expect(page.locator(`#cfDetail [data-cf-detail="${C2}"]`)).toBeVisible();
 expect(f.errors).toEqual([]);
});

test('통화 1280: 조직 연결은 핵심내용을 요약 기본값으로, 저장하면 조직 칸과 조직 기록',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openMenu(page,1280,'통화');
 await page.locator(`#callsView [data-cf-row="${C2}"]`).click();
 await page.locator('#cfDetail [data-cf-more]').click();
 await page.locator('#cfMenu').getByRole('button',{name:'조직 연결'}).click();
 const text=page.locator('#cfDetail [data-cf-link-text]');
 await expect(text).toHaveValue('- 원고 금요일 마감');
 await page.locator('#cfDetail [data-cf-link-pick]').click();
 const sheet=page.locator('#feedOrgSheet');await expect(sheet).toBeVisible();
 await sheet.getByRole('button',{name:'예시지부',exact:true}).click();await expect(sheet).toBeHidden();
 await expect(page.locator('#cfDetail [data-cf-link-pick]')).toHaveText('예시지부 ▾');
 await page.locator('#cfDetail [data-cf-link-save]').click();
 await expect.poll(()=>f.writes.find(w=>w.id===C2&&w.body.organization_id)?.body.organization_id).toBe(ORG);
 await expect.poll(()=>f.writes.find(w=>w.table==='org_update')?.body).toEqual({organization_id:ORG,raw_text:'- 원고 금요일 마감',created_by:'home-test'});
 await expect(page.locator(`#callsView [data-cf-row="${C2}"] .feed-org`)).toHaveText('예시지부');
 await expect(page.locator('#cfDetail [data-cf-detail-status]')).toContainText('예시지부에 연결하고 기록을 남겼어요.');
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`빈 상태 ${width}: 표가 없으면 '준비 중', 비었으면 한 줄(메뉴는 숨기지 않음)`,async({page})=>{
 const f=await fixture(page,{width,missing:true});
 await openMenu(page,width,'통화');
 await expect(page.locator('#callsView [data-cf-empty="ready"]')).toHaveText('준비 중이에요. 통화 수집이 연결되면 여기에 보여요.');
 await expect(page.locator('#callsView [data-cf-box]')).toHaveCount(0);
 await openMenu(page,width,'텔레그램 소식');
 await expect(page.locator('#telegramView [data-tg-empty="ready"]')).toHaveText('준비 중이에요. 텔레그램 수집이 연결되면 여기에 보여요.');
 expect(f.errors).toEqual([]);
});
test('빈 상태: 표는 있고 줄이 없으면 빈 한 줄',async({page})=>{
 const f=await fixture(page,{width:390,empty:true});
 await openMenu(page,390,'통화');
 await expect(page.locator('#callsView [data-cf-empty="none"]')).toHaveText('아직 받은 업무 통화가 없어요.');
 await expect(page.locator('#callsView [data-cf-box="personal"]')).toHaveText('개인 통화함 0 ›');
 await openMenu(page,390,'텔레그램 소식');
 await expect(page.locator('#telegramView [data-tg-empty="none"]')).toHaveText('아직 받은 텔레그램 소식이 없어요.');
 await expect(page.locator('#telegramView [data-tg-today]')).toHaveText('오늘 받은 소식 없음');
 expect(f.errors).toEqual([]);
});
