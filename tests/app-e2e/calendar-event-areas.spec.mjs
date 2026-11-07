// S52-30 CAL-일정사업영역: 일정 창(일정 추가·Google 일정 수정)에 할 일 창과 같은 두 줄 '사업영역 / 관련 담당조직'.
// 일정의 사업영역은 '사업영역 주요 일정' 행(app_project_milestones, 같은 google_event_id, 사업영역마다 한 행)으로 저장한다(DB 변경 없음).
// 고르기 → 저장 → 다시 열면 그대로, 빼면 그 행만 지움, 연결을 읽지 못하면 사업영역 줄만 누를 수 없고 저장은 그대로. 폰 412·PC. 합성 자료만.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openPicker,pressNamesAndSave,chosenKeys,removeKey} from './helpers/area-org-picker.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const event={id:'event',title:'오전 일정',start:'2026-10-06T10:00:00+09:00',end:'2026-10-06T11:00:00+09:00',calendarId:'c',recurring:false,organizationIds:[],location:''};
test.use({timezoneId:'Asia/Seoul'});

// Milestone rows as the database would keep them (google_event_id / project_id filters, POST adds, DELETE id=in.(...) removes).
async function open(page,{readFail=false}={}){
  await openHome(page,{query:'?view=calendar'});
  const rows=[],writes=[],googleWrites=[];
  await page.route(SB+'/**',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,q=u.searchParams;
    if(p.endsWith('google-calendar')&&q.get('action')==='event')return route.fulfill({json:{event}});
    if(p.endsWith('google-calendar')&&req.method()==='POST'){const b=req.postDataJSON();googleWrites.push(b);return route.fulfill({json:{ok:true,event:{...event,id:b.event_id||'created-event',calendarId:b.target_calendar_id||b.calendar_id,title:b.title,location:b.location||'',organizationIds:b.organization_ids||[]}}})}
    if(p.endsWith('app_project_milestones')){
      const m=req.method(),gid=(q.get('google_event_id')||'').replace(/^eq\./,''),pid=(q.get('project_id')||'').replace(/^eq\./,'');
      if(m==='GET'&&gid&&readFail)return route.fulfill({status:500,json:{message:'합성 읽기 실패'}});
      if(m==='GET')return route.fulfill({json:rows.filter(r=>(!gid||r.google_event_id===gid)&&(!pid||r.project_id===pid))});
      if(m==='POST'){const b=req.postDataJSON();writes.push({method:'POST',body:b});rows.push(b);return route.fulfill({status:201,json:[b]})}
      if(m==='DELETE'){const ids=(q.get('id')||'').replace(/^in\.\(|\)$/g,'').split(',').filter(Boolean);writes.push({method:'DELETE',ids,gid});for(const id of ids){const i=rows.findIndex(r=>r.id===id&&r.google_event_id===gid);if(i>=0)rows.splice(i,1)}return route.fulfill({status:204,body:''})}
    }
    return route.fallback();
  });
  await page.waitForFunction(()=>window.__KPTU_RELOAD_SUBORGANIZATIONS__&&window.KPTUCalendarPlus);
  return {rows,writes,googleWrites};
}
const BOX='#soGoogleEditOrgChecks';
async function openEdit(page){
  await page.locator('[data-google-event="event"]').first().click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();await expect(page.locator('#ciGoogleSave')).toBeEnabled();
  await expect(page.locator(`${BOX} [data-aop-line="area"]`)).toBeVisible();await expect(page.locator(`${BOX} [data-aop-line="org"]`)).toBeVisible();
}
async function saveEdit(page){await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden()}

for(const [name,viewport] of [['폰 412',{width:412,height:915}],['PC',{width:1280,height:800}]]){
  test.describe(name,()=>{
    test.use({viewport});
    test('Google 일정 수정: 사업영역 두 개 고르기 → 저장 → 다시 열면 그대로, 하나 빼면 그 행만 지움',async({page})=>{
      const s=await open(page);await openEdit(page);
      // 두 줄: 위 '사업영역', 아래 '관련 담당조직'. 고른 것이 없으면 '없음'.
      await expect(page.locator(`${BOX} .aop-label`)).toHaveText(['사업영역','관련 담당조직']);
      await expect(page.locator(`${BOX} [data-aop-line="area"] [data-aop-none]`)).toHaveText('없음');
      await openPicker(page,BOX,'area');await pressNamesAndSave(page,['테스트 프로젝트','자식 프로젝트']);
      expect(await chosenKeys(page,BOX)).toEqual(['p:p','p:child']);
      await saveEdit(page);
      expect(s.googleWrites).toHaveLength(1);expect(s.googleWrites[0]).toMatchObject({action:'update-event',event_id:'event'});
      expect(s.writes.map(w=>w.method)).toEqual(['POST','POST']);
      expect(s.rows.map(r=>r.project_id).sort()).toEqual(['child','p']);
      for(const r of s.rows)expect(r).toMatchObject({google_event_id:'event',google_calendar_id:'c',title:'오전 일정',milestone_type:'action',status:'planned'});
      // 다시 열면 고른 사업영역이 꼬리표로 남아 있다(주요 일정 행에서 읽음).
      await openEdit(page);expect(await chosenKeys(page,BOX)).toEqual(['p:p','p:child']);
      // 하나 빼고 저장 → 그 사업영역의 행만 지운다(새로 만들지 않음).
      const kept=s.rows.find(r=>r.project_id==='child').id,dropped=s.rows.find(r=>r.project_id==='p').id;
      await removeKey(page,BOX,'p:p');expect(await chosenKeys(page,BOX)).toEqual(['p:child']);
      await saveEdit(page);
      expect(s.writes.slice(2)).toEqual([{method:'DELETE',ids:[dropped],gid:'event'}]);
      expect(s.rows.map(r=>r.id)).toEqual([kept]);
      await openEdit(page);expect(await chosenKeys(page,BOX)).toEqual(['p:child']);
      // 바꾸지 않고 저장하면 사업영역 쪽은 아무것도 쓰지 않는다.
      await saveEdit(page);expect(s.writes).toHaveLength(3);
    });
    test('Google 일정 수정: 사업영역 연결을 읽지 못하면 사업영역 줄만 누를 수 없고 일정 저장은 그대로',async({page})=>{
      const s=await open(page,{readFail:true});await openEdit(page);
      await expect(page.locator(`${BOX} [data-aop-add="area"]`)).toBeDisabled();
      await expect(page.locator(`${BOX} [data-aop-add="org"]`)).toBeEnabled();
      await expect(page.locator('#ciGoogleStatus')).toHaveText('');
      await page.locator('#ciGoogleTitle').fill('오전 일정 바꿈');await saveEdit(page);
      expect(s.googleWrites).toHaveLength(1);expect(s.writes).toHaveLength(0);
    });
    test('일정 추가: 사업영역 두 개 → Google 저장 뒤 사업영역마다 주요 일정 한 행, 새 창은 비어 있음',async({page})=>{
      const s=await open(page);await page.locator('#newEventBtn').click();await expect(page.locator('#eventModal')).toBeVisible();
      await expect(page.locator('#eventTaskProject')).toBeHidden();
      await expect(page.locator('#soEventOrgChecks .aop-label')).toHaveText(['사업영역','관련 담당조직']);
      await page.locator('#eventTitle').fill('합성 일정');
      await openPicker(page,'#soEventOrgChecks','area');await pressNamesAndSave(page,['테스트 프로젝트','자식 프로젝트']);
      await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeHidden();
      expect(s.googleWrites).toHaveLength(1);expect(s.googleWrites[0].action).toBe('create-event');
      expect(s.rows.map(r=>[r.project_id,r.google_event_id,r.title]).sort()).toEqual([['child','created-event','합성 일정'],['p','created-event','합성 일정']]);
      // [할 일]은 그대로 한 개 고르기 칸이고, 다음 새 일정 창은 고른 사업영역 없이 열린다.
      await page.locator('#newEventBtn').click();await expect(page.locator('#eventModal')).toBeVisible();
      await expect(page.locator('#soEventOrgChecks [data-aop-line="area"] [data-aop-none]')).toBeVisible();expect(await chosenKeys(page,'#soEventOrgChecks')).toEqual([]);
      await page.locator('[data-event-mode="task"]').click();await expect(page.locator('#eventTaskProject')).toBeVisible();await expect(page.locator('#soEventOrganizations')).toBeHidden();
    });
  });
}
