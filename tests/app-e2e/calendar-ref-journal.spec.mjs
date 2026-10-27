import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

// 원장 재료 C-4: 업무일지 하루 카드의 접힌 참고 일정 한 줄, 주간 정리 '참고' 묶음, 체크 저장, 주요 일정에 안 섞임.
// 시계는 2026-10-06 10:00 KST(화). 가상 캘린더·일정만 쓴다.
const CAL='cal-a';
const events=()=>[
 {id:'a1',title:'가상 교섭 간담회',calendarId:CAL,start:'2026-10-06T14:00:00+09:00',end:'2026-10-06T15:00:00+09:00',allDay:false,colorId:'3',mine:true},
 {id:'a2',title:'저녁 모임 자리',calendarId:CAL,start:'2026-10-06T19:00:00+09:00',end:'2026-10-06T20:00:00+09:00',allDay:false,colorId:null,mine:true},
 {id:'a3',title:'병원 예약',calendarId:CAL,start:'2026-10-06T18:00:00+09:00',end:'2026-10-06T18:30:00+09:00',allDay:false,colorId:null,mine:true},
];
async function setup(page,{configured=true,eventsFail=false,stored=[]}={}){
 const refs=stored.map(x=>({...x})),writes=[],gcal=[];
 const beforeLoad=async()=>{
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_profiles',async r=>{
   const q=new URL(r.request().url()).searchParams;
   if(r.request().method()==='GET'&&q.get('select')==='ledger_calendar')return r.fulfill({json:[{ledger_calendar:configured?{calendar:CAL,colors:['3'],mine:true}:{}}]});
   return r.fallback();
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/google-calendar',async r=>{
   const q=new URL(r.request().url()).searchParams;
   if(!q.has('onlyCalendarId'))return r.fallback();
   gcal.push(q.get('onlyCalendarId'));
   if(eventsFail)return r.fulfill({status:500,json:{error:'QA failure'}});
   return r.fulfill({json:{events:events()}});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_calendar_work_refs',async r=>{
   const req=r.request(),q=new URL(req.url()).searchParams,m=req.method();
   if(m==='GET'){
    if(q.has('event_key'))return r.fulfill({json:[]});
    const gte=q.getAll('day').find(v=>v.startsWith('gte.')).slice(4),lt=q.getAll('day').find(v=>v.startsWith('lt.')).slice(3);
    return r.fulfill({json:refs.filter(x=>x.day>=gte&&x.day<lt)});
   }
   const body=req.postDataJSON();writes.push({m,body,query:q.get('id')});
   if(m==='POST'){for(const b of body)refs.push({id:'ref-'+refs.length,...b});return r.fulfill({status:201,body:''});}
   if(m==='PATCH'){const id=q.get('id').slice(3),row=refs.find(x=>x.id===id);Object.assign(row,body);return r.fulfill({json:[row]});}
   return r.fulfill({status:204,body:''});
  });
 };
 await openHome(page,{beforeLoad});
 return {refs,writes,gcal};
}
async function openJournal(page,width){
 if(width<=760){
  await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.locator('#calendarView .schedule-switch [data-view="journal"]').click();
 }else await page.locator('.app-nav [data-view="journal"]').click();
 await expect(page.locator('#journalView')).toBeVisible();
 await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 5일 ~ 11일');
}
const fold=page=>page.locator('#journalRoot [data-journal-calref]');

for(const width of [390,1280]){
 test(`하루 카드: 접힌 한 줄(개수·확인·개인 뺌), 펼치면 체크 목록, 애매한 줄을 체크하면 서버에 사용자 결정으로 저장 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const f=await setup(page);
  await openJournal(page,width);
  await expect(fold(page).locator('summary')).toHaveText('개인 공유 캘린더 2 · 확인 1 · 개인 1개 뺌');
  await expect(fold(page)).toHaveJSProperty('open',false);
  // 표에는 업무·애매만, 개인·원문 ID·캘린더 ID는 없다.
  expect(f.refs.map(r=>r.judged).sort()).toEqual(['unsure','work']);
  expect(JSON.stringify(f.writes)).not.toContain(CAL);
  expect(JSON.stringify(f.writes)).not.toContain('병원');
  expect(f.gcal.every(id=>id===CAL)).toBe(true);
  await fold(page).locator('summary').click();
  const boxes=fold(page).locator('[data-journal-calref-check]');
  await expect(fold(page).locator('li')).toHaveText(['14:00 가상 교섭 간담회','19:00 저녁 모임 자리 (애매)']);
  await expect(boxes.nth(0)).toBeChecked();await expect(boxes.nth(1)).not.toBeChecked();
  await boxes.nth(1).check();
  await expect(fold(page).locator('summary')).toHaveText('개인 공유 캘린더 2 · 개인 1개 뺌');
  await expect(fold(page)).toHaveJSProperty('open',true);
  await expect(boxes.nth(1)).toBeChecked();
  const patch=f.writes.filter(w=>w.m==='PATCH');
  expect(patch).toHaveLength(1);
  expect(patch[0].body).toEqual({included:true,decided_by:'user'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}

test('주간 정리: 참고 묶음에 체크 개수, 체크를 끄면 서버 저장, 5. 주요 일정에는 섞이지 않는다',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  const f=await setup(page);
  await openJournal(page,1280);
  await expect(fold(page)).toHaveCount(1);
  await page.locator('#journalRoot [data-journal-mode="week"]').click();
  const part=page.locator('#journalRoot [data-journal-weekly="note-calRefs"]');
  await expect(part.locator('summary')).toHaveText('개인 공유 캘린더(참고) 2 · 체크 1');
  await part.locator('summary').click();
  await expect(part.locator('li')).toHaveCount(2);
  await part.locator('[data-journal-calref-check]').first().uncheck();
  await expect(part.locator('summary')).toHaveText('개인 공유 캘린더(참고) 2 · 체크 0');
  expect(f.writes.filter(w=>w.m==='PATCH').at(-1).body).toEqual({included:false,decided_by:'user'});
  await expect(page.locator('#journalRoot [data-journal-weekly-chapter="calendar"]')).not.toContainText('가상 교섭 간담회');
  await expect(page.locator('#journalRoot [data-journal-weekly-chapter="calendar"]')).not.toContainText('저녁 모임 자리');
});

test('고르지 않았으면 달력도 표도 읽지 않고 화면에 아무것도 더 보이지 않는다',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  const f=await setup(page,{configured:false});
  await openJournal(page,1280);
  await expect(fold(page)).toHaveCount(0);
  await page.locator('#journalRoot [data-journal-mode="week"]').click();
  await expect(page.locator('#journalRoot [data-journal-weekly="note-calRefs"]')).toHaveCount(0);
  expect(f.gcal).toEqual([]);expect(f.writes).toEqual([]);
});

test('달력을 못 읽어도 표에 저장된 줄은 그대로 보인다',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await setup(page,{eventsFail:true,stored:[{id:'s1',event_key:'c'.repeat(32),day:'2026-10-06',start_at:'2026-10-06T05:00:00.000Z',all_day:false,title:'저장돼 있던 줄',judged:'work',included:true,decided_by:'rule',organization_id:null}]});
  await openJournal(page,1280);
  await expect(fold(page).locator('summary')).toHaveText('개인 공유 캘린더 1');
  await fold(page).locator('summary').click();
  await expect(fold(page).locator('li')).toHaveText(['14:00 저장돼 있던 줄']);
});
