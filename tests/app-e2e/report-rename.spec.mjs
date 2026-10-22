import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// MTG-사업보고 2단계(화면만): '회의' 화면의 이름을 '사업 보고'로 바꾸고, 주소 ?view=reports(옛 ?view=meetings도 열림), PC 사이드바는 [프로젝트] 바로 아래.
// 바구니의 회의 연결은 FK 이름을 지정해 읽는다(연결 표에서 회의로 가는 길이 둘이 되어도 목록이 멈추지 않는다). 모든 이름은 합성 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const LEAD='프로젝트 = 사업영역별 진행상황, 사업 보고 = 날짜별 활동 결과';

test('PC 1280: sidebar shows 사업 보고 right under 프로젝트; screen title, lead line, URL',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const names=await page.locator('#appView>.app-nav :is(.nav-btn,.nav-sub-btn[data-view]):not(#mobileMenuOpen)').allTextContents();
 const i=names.indexOf('프로젝트');
 expect(names[i+1]).toBe('사업 보고');expect(names).not.toContain('회의');
 await clickView(page,'meetings');
 await expect(page.locator('#meetingsView')).toBeVisible();
 await expect(page).toHaveURL(/[?&]view=reports(?:&|$)/);
 await expect(page.locator('#meetingsView [data-report-lead]')).toHaveText(LEAD);
 await expect(page.locator('#meetingsView .add-list-head h2')).toHaveText('사업 보고');
 await expect(page.locator('[data-topline-where]')).toContainText('사업 보고');
 expect(errors).toEqual([]);
});

test('폰 390: the [메뉴] window lists 사업 보고 in the same place; lead line fits without sideways scroll',async({page})=>{
 await page.setViewportSize({width:390,height:800});
 await openHome(page);
 await page.locator('#mobileMenuTab:visible').click();
 const items=await page.locator('#mobileMenu nav button:visible').allTextContents();
 expect(items.slice(0,2)).toEqual(['쓰기','사업 보고']);expect(items).not.toContain('회의');
 await page.locator('#mobileMenu nav button',{hasText:'사업 보고'}).click();
 await expect(page.locator('#meetingsView')).toBeVisible();
 await expect(page.locator('[data-mobile-view-name]')).toHaveText('사업 보고');
 await expect(page.locator('#meetingsView [data-report-lead]')).toHaveText(LEAD);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const [label,query] of [['new address','?view=reports'],['old address','?view=meetings']])for(const width of [390,1280])
 test(`${label} opens the screen at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:800});
  await openHome(page,{query});
  await expect(page.locator('#meetingsView')).toBeVisible();
  await expect(page.locator('#meetingsView [data-report-lead]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp('[?&]view='+(query.endsWith('reports')?'reports':'meetings')+'(?:&|$)'));
 });

test('PC: old and new addresses both survive back/forward between screens',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 await openHome(page,{query:'?view=meetings'});
 await expect(page.locator('#meetingsView')).toBeVisible();
 await clickView(page,'library');await expect(page.locator('#libraryView')).toBeVisible();
 await page.goBack();await expect(page.locator('#meetingsView')).toBeVisible();
 await page.goForward();await expect(page.locator('#libraryView')).toBeVisible();
 await clickView(page,'meetings');await expect(page).toHaveURL(/view=reports/);
 await page.goBack();await expect(page.locator('#libraryView')).toBeVisible();
 await page.goForward();await expect(page.locator('#meetingsView')).toBeVisible();
});

// 바구니: 회의 연결 읽기에 FK 이름이 있어야 한다. 이름 없는 임베드는 PostgREST가 모호하다고(PGRST201) 거절하는 상황을 흉내 낸다.
for(const width of [390,1280])test(`basket list opens with the meeting link chip named 사업 보고 at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const errors=[],selects=[];page.on('pageerror',e=>errors.push(e.message));
 const n='10000000-0000-4000-8000-000000000001',stamp='2026-10-12T01:00:00Z',meetingId='50000000-0000-4000-8000-000000000001';
 await openHome(page);
 await page.route(SB+'/rest/v1/app_notes?**',route=>route.fulfill({json:[{id:n,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:'합성 메모 본문',ai_export_allowed:true,archived_at:null,attachments:[]}]}));
 await page.route(SB+'/rest/v1/app_record_links?**',route=>{
  const q=new URL(route.request().url()).searchParams;
  if(q.get('note_id')===undefined||!q.get('note_id')?.startsWith('in.'))return route.fulfill({json:[]});
  const select=q.get('select')||'';selects.push(select);
  if(/meeting:app_meetings\(/.test(select))return route.fulfill({status:300,json:{code:'PGRST201',message:'Could not embed because more than one relationship was found for app_record_links and app_meetings'}});
  return route.fulfill({json:[{id:'40000000-0000-4000-8000-000000000001',workspace_id:'w',note_id:n,status:'confirmed',summary:null,project_id:null,organization_id:null,meeting_id:meetingId,document_id:null,meeting:{title:'합성 정기 회의',series_name:'합성 정기 회의'}}]});
 });
 await page.evaluate(async()=>{await KPTUViewLoader.load('basket');KPTURouter.go('basket')});
 await expect(page.locator('#basketView')).toBeVisible();
 await page.locator('#basketView').getByRole('button',{name:/분류 완료/}).first().click();
 const chip=page.locator('#basketView .basket-chip[data-chip-kind="meeting"]').first();
 await expect(chip).toContainText('합성 정기 회의');
 await expect(chip.locator('.a11y-only')).toHaveText('사업 보고: ');
 expect(selects.some(s=>s.includes('meeting:app_meetings!app_record_links_meeting_id_fkey(title,series_name)'))).toBe(true);
 expect(errors).toEqual([]);
});

// activity_kind(칸) 열이 없는 응답(지금 운영 DB)에서도 목록이 그대로 뜨고 '회의' 취급이다.
test('PC: meeting rows without activity_kind still list',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 await openHome(page);
 await page.route(SB+'/rest/v1/app_meetings?**',route=>route.fulfill({json:[{id:'60000000-0000-4000-8000-000000000001',workspace_id:'w',title:'합성 정기 회의',series_name:'합성 정기 회의',round_no:3,meeting_at:'2026-10-20T05:00:00Z',project_id:null,transcript_text:'합성 결과',created_at:'2026-10-20T05:00:00Z',updated_at:'2026-10-20T05:00:00Z'}]}));
 await clickView(page,'meetings');
 await expect(page.locator('#meetingsView')).toContainText('합성 정기 회의');
});
