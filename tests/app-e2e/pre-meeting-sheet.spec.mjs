import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// FEAT-1029묶음 ② 교섭·회의 전 한 장(명진 결정 10/29 '모두 추천대로'): 담당조직 상세의 '다가오는 교섭 … — 한 장 ›'·접힌 '지난 한 장 n ›',
// 한 장 창(핵심 세 가지 → 근거 묶음, [다시 만들기]), 일정 수정 창의 '교섭 전 한 장 ›', 18시 뒤 업무일지를 열면 내일 일정에 한 번 자동 만들기,
// DB 적용 전 "준비 중". 서버는 가짜(읽기·만들기 흐름만 확인). 이름·글은 모두 합성 값. 시계: 2026-10-06(화) 10:00 KST(자동 시험은 18:30).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',owner='home-test';
const ORG='c0000000-0000-4000-8000-0000000000a1';
const orgs=[{id:ORG,workspace_id:'w',name:'합성 가 사업장',active:true,created_by:owner,updated_at:'2026-09-15T01:00:00Z'}];
const EVENT={id:'pm-evt',calendarId:'c',title:'합성 가 사업장 임금교섭 4차',start:'2026-10-07T14:00:00+09:00',end:'2026-10-07T16:00:00+09:00',location:'본사 회의실',allDay:false,organizationIds:[ORG],description:'',recurring:false,mine:true,source:'google'};
const KEY='c:pm-evt';
const sheetRow=(extra={})=>({event_key:KEY,organization_id:ORG,event_title:EVENT.title,event_start:'2026-10-07T05:00:00.000Z',event_end:'2026-10-07T07:00:00.000Z',event_location:'본사 회의실',
 top_lines:[{text:'3차에서 남은 쟁점은 인상률 한 가지임.',refs:[1]},{text:'자료 회신 약속이 아직 대기임.',refs:[3]}],
 groups:[
  {group:'stage',title:'조정 신청',day:'2026-09-28',source_kind:'stage',source_id:ORG},
  {group:'meetings',title:'합성 임금교섭 3차',day:'2026-09-29',source_kind:'meeting',source_id:'m3'},
  {group:'issues',title:'기본급 인상률 이견',day:'2026-09-29',source_kind:'ledger',source_id:'r1'},
  {group:'commitments',title:'근거 자료 회신',day:'2026-10-08',source_kind:'ledger',source_id:'r2'},
  {group:'feed',title:'통화 · 사측 실무자',day:'2026-10-05',source_kind:'call',source_id:'f1'},
  {group:'issues',title:'인상률 이견 남음.',day:null,source_kind:'ai',source_id:'',refs:[2]},
  {group:'docs',title:'합성 임금 요구안',day:'2026-09-20',source_kind:'document',source_id:'d1'},
 ],ai_status:'ok',made_by:'auto',created_at:'2026-10-05T09:20:00Z',updated_at:'2026-10-05T09:20:00Z',...extra});
const PAST={...sheetRow(),event_key:'c:pm-old',event_title:'합성 가 사업장 임금교섭 3차',event_start:'2026-09-29T05:00:00.000Z'};

async function fixture(page,{width,sheets=[],missing=false,now=null}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const db={sheets:structuredClone(sheets),calls:[]};
 const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 const f=await openHome(page,{beforeLoad:async()=>{
  if(now)await page.clock.setFixedTime(new Date(now));
  await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return json(route,id?orgs.filter(o=>'eq.'+o.id===id):orgs)});
  await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return json(route,q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner})))});
  for(const t of ['app_suborganization_updates','app_notes','app_record_links'])await page.route(SB+`/rest/v1/${t}?**`,route=>json(route,[]));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_pre_meeting_sheets',route=>{
   if(route.request().method()!=='GET')return json(route,{},405);
   if(missing)return json(route,{code:'PGRST205'},404);
   const q=new URL(route.request().url()).searchParams;
   const key=(q.get('event_key')||''),org=(q.get('organization_id')||'').replace(/^eq\./,'');
   let rows=db.sheets;
   if(key.startsWith('eq.'))rows=rows.filter(r=>r.event_key===key.slice(3));
   else if(key.startsWith('in.'))rows=rows.filter(r=>key.includes(`"${r.event_key}"`));
   if(org)rows=rows.filter(r=>r.organization_id===org);
   return json(route,rows);
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/google-calendar',route=>{
   const a=new URL(route.request().url()).searchParams.get('action');
   if(route.request().method()==='GET'&&a==='events')return json(route,{connected:true,events:[EVENT]});
   if(route.request().method()==='GET'&&a==='event')return json(route,{event:EVENT,eventColors:{}});
   return route.fallback();
  });
  await page.route(SB+'/functions/v1/ai-assist',route=>{
   const body=route.request().postDataJSON();
   if(body?.kind!=='pre_meeting_sheet')return route.fallback();
   db.calls.push(body);
   if(missing)return json(route,{ok:false,error:'pre_meeting_sheet_not_ready'},503);
   const sheet=sheetRow({made_by:body.mode,event_key:body.event.event_key,updated_at:`2026-10-06T0${db.calls.length}:30:00Z`});
   const i=db.sheets.findIndex(s=>s.event_key===sheet.event_key);if(i>=0)db.sheets[i]=sheet;else db.sheets.push(sheet);
   return json(route,{ok:true,kind:'pre_meeting_sheet',event_key:sheet.event_key,sheet});
  });
 }});
 return {f,db,errors};
}
async function openOrg(page){
 await clickView(page,'team');
 await page.locator(`#soOrganizationList [data-so-org="${ORG}"]`).click();
 await expect(page.locator('#wdModal')).toBeVisible();
 await expect(page.locator('#wdTitle')).toHaveText(orgs[0].name);
}
// 업무일지: 보이는 쪽(왼쪽 메뉴 또는 아래 [일정] 탭 → 위 전환 줄)으로 연다(journal.spec.mjs openJournalAt과 같은 길).
async function openJournalAt(page,width){
 const nav=page.locator('.app-nav [data-view="journal"]');
 if(width>760&&await nav.isVisible())await nav.click();
 else{
  // [일정] 탭은 마지막으로 본 쪽(달력·할 일·업무일지)을 연다. 업무일지가 아니면 위 전환 줄에서 고른다.
  await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
  await expect(page.locator('#calendarView:visible, #journalView:visible, #tasksView:visible').first()).toBeVisible();
  if(!await page.locator('#journalView').isVisible())await page.locator('.schedule-switch [data-view="journal"]:visible').first().click();
 }
 await expect(page.locator('#journalView')).toBeVisible();
}
const noSideScroll=async page=>expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);

for(const width of [412,884,1440])test(`담당조직 상세: 다가오는 교섭 줄·지난 한 장·한 장 창·다시 만들기 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width,sheets:[sheetRow(),PAST]});
 await openOrg(page);
 const line=page.locator('#wdPreMeeting');
 await expect(line.locator('[data-pms-org-next]')).toHaveText('다가오는 교섭 10/7(수) 14:00 — 한 장 ›');
 await expect(line.locator('[data-pms-past] summary')).toHaveText('지난 한 장 1 ›');
 await expect(line.locator('[data-pms-past-open]')).toBeHidden();
 // 제목 줄 아래, 기록 입력보다 위.
 const y=await line.evaluate(el=>el.getBoundingClientRect().top),yi=await page.locator('#wdInbox').evaluate(el=>el.getBoundingClientRect().top);expect(y).toBeLessThan(yi);
 await line.locator('[data-pms-org-next]').click();
 const modal=page.locator('#pmsModal'),body=modal.locator('#pmsBody');
 await expect(modal).toBeVisible();
 await expect(modal.locator('#pmsHeading')).toHaveText(EVENT.title);
 await expect(body.locator('.pms-subline')).toContainText('내일 10/7(수) 14:00 · 본사 회의실 · 쟁의 단계: 조정 신청');
 await expect(body.locator('.pms-top li')).toHaveText(['3차에서 남은 쟁점은 인상률 한 가지임.','자료 회신 약속이 아직 대기임.']);
 await expect(body.locator('[data-pms-group="issues"] summary')).toContainText('② 남은 쟁점 2건');
 await expect(body.locator('[data-pms-group="feed"] summary')).toContainText('⑤ 최근 통화·텔레그램 1건 — 통화 1 · 텔레그램 0 (최근 30일)');
 await expect(body.locator('details[open]')).toHaveCount(0);
 // 핵심 줄 → 근거 묶음이 열리고 그 줄로.
 await body.locator('.pms-top [data-pms-ref]').first().click();
 await expect(body.locator('[data-pms-group="meetings"]')).toHaveAttribute('open','');
 await expect(body.locator('[data-pms-item="1"] [data-pms-open]')).toBeFocused();
 await noSideScroll(page);
 if(width<=760){
  const fit=await modal.locator('.pms-card').evaluate(c=>{const tab=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kptu-mobile-tab-height'))||0;return c.getBoundingClientRect().bottom<=innerHeight-tab+1});
  expect(fit).toBe(true);
 }
 // [다시 만들기] → mode=user, 일정 값·조직 id만 보냄.
 await body.locator('[data-pms-make]').click();
 await expect.poll(()=>db.calls.length).toBe(1);
 expect(db.calls[0]).toEqual({kind:'pre_meeting_sheet',mode:'user',organization_id:ORG,event:{event_key:KEY,title:EVENT.title,start:'2026-10-07T05:00:00.000Z',end:'2026-10-07T07:00:00.000Z',location:'본사 회의실'}});
 await expect(body.locator('.pms-note[role="status"]')).toHaveText('한 장을 만들었어요.');
 await expect(body.locator('.pms-meta')).toContainText('10/6(화) 10:30 만듦');
 await modal.locator('[data-pms-close]').click();
 await expect(modal).toBeHidden();
 // 지난 한 장: 접힌 줄을 펴서 연다(만들기 버튼 없음 — 지난 일정).
 await line.locator('[data-pms-past] summary').click();
 await line.locator('[data-pms-past-open]').click();
 await expect(modal.locator('#pmsHeading')).toHaveText(PAST.event_title);
 await expect(body.locator('[data-pms-make]')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('일정 수정 창: 담당조직이 연결된 내일 교섭 일정에 "교섭 전 한 장 ›" 한 줄, 누르면 아직 없는 장을 [지금 만들기]로 만든다 1440px',async({page})=>{
 const {db,errors}=await fixture(page,{width:1440});
 await clickView(page,'calendar');
 await page.locator('[data-google-event="pm-evt"]').first().click();
 await expect(page.locator('#ciGoogleModal')).toBeVisible();
 const line=page.locator('#ciPreMeeting [data-pms-line]');
 await expect(line).toHaveText('교섭 전 한 장 ›');
 await line.click();
 const body=page.locator('#pmsBody');
 await expect(body.locator('.pms-note').first()).toHaveText('전날 18시 뒤 만듦.');
 await body.locator('[data-pms-make]').click();
 await expect.poll(()=>db.calls.length).toBe(1);
 expect(db.calls[0].mode).toBe('user');
 await expect(body.locator('.pms-top li')).toHaveCount(2);
 await expect(body.locator('[data-pms-make]')).toHaveText('다시 만들기');
 expect(errors).toEqual([]);
});

for(const width of [412,884,1440])test(`18시 뒤 업무일지를 열면 내일 교섭 한 장을 한 번만 자동으로 만든다 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width,now:'2026-10-06T09:30:00Z'});
 await openJournalAt(page,width);
 await expect.poll(()=>db.calls.length).toBe(1);
 expect(db.calls[0]).toMatchObject({kind:'pre_meeting_sheet',mode:'auto',organization_id:ORG,event:{event_key:KEY}});
 await clickView(page,'home');
 await openJournalAt(page,width);
 await page.waitForTimeout(300);
 expect(db.calls.length).toBe(1);
 await openOrg(page);
 await expect(page.locator('#wdPreMeeting [data-pms-org-next]')).toHaveText('다가오는 교섭 10/7(수) 14:00 — 한 장 ›');
 expect(errors).toEqual([]);
});

test('DB 적용 전: 자동 만들기는 부르지 않고, 창은 "준비 중" 한 줄 412px',async({page})=>{
 const {db,errors}=await fixture(page,{width:412,missing:true,now:'2026-10-06T09:30:00Z'});
 await openJournalAt(page,412);
 await page.waitForTimeout(500);
 expect(db.calls.length).toBe(0);
 await openOrg(page);
 const line=page.locator('#wdPreMeeting [data-pms-org-next]');
 await expect(line).toHaveText('다가오는 교섭 10/7(수) 14:00 — 한 장 ›');
 await line.click();
 await expect(page.locator('#pmsBody .pms-note')).toHaveText('교섭 전 한 장은 아직 준비 중이에요.');
 expect(errors).toEqual([]);
});
