// WEEKLY-요약표수기(S49-39) → WEEKLY-메뉴짝짓기 P5: 사업 보고 위 접는 칸 '이번 주 주간보고'(팝업·[HWP로 내려받기] 없음, 맨 아래 [주간 정리에서 보기 ›])
// ① 내부 정례 회의(상집·집행위·집행국 등)와 늘 빼기로 정한 종류는 표·세부 내용에 나오지 않는다(뺀 n건 안내 없음).
// ② '진행 상황 및 이후 계획'·'담당' 칸을 누르면 글 칸, Ctrl+Enter 저장 — BIZ-기록하나로 B-3부터 사업 '지금 상황'(app_business_now)에, 보고 없는 줄도 쓸 수 있다.
//    그 주 사업 보고 제목은 칸 아래 흐린 '이번 주 기록 n'을 펼치면 보인다(이어 쓰기·처음 채우기는 biz-summary-now.spec.mjs).
// ③ AI 제안 없음(ai-assist 호출 0, [AI 초안]·(고침) 없음). 예전에 저장된 AI 값은 보이지 않고 데이터는 그대로.
// PC 1440·폰 412. 모든 이름·글은 합성 값.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const AREA='공공기관 기능개혁 대응',TASK_WITH='국토부 대응',TASK_EMPTY='산자부 대응';
const seoul=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(d);
// 이번 주(서울 월~일)의 화요일·수요일 오전 10시(서울) = 01:00Z.
function weekDay(offsetFromMonday){
  const today=seoul(new Date()),d=new Date(`${today}T00:00:00Z`),back=(d.getUTCDay()+6)%7;
  const day=new Date(d.getTime()-back*864e5+offsetFromMonday*864e5).toISOString().slice(0,10);
  return {day,at:`${day}T01:00:00Z`,monday:new Date(d.getTime()-back*864e5).toISOString().slice(0,10)};
}
const OLD_AI={text:'예전에 저장된 AI 한 줄',hash:'a1:'+'0'.repeat(32),edited:false,at:'2026-10-28T01:00:00.000Z'};

function state(){
  const s=baseState();s.meetingWrites=[];s.aiCalls=[];s.draftWrites=[];
  const row=(id,title,at,area)=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:1,meeting_at:at,transcript_text:'합성 결과 글',activity_kind:'meeting',business_area_id:area,next_plan:'합성 후속 일',created_by:s.user.id,created_at:at,updated_at:at,notes:'',decisions:''});
  const tue=weekDay(1).at,wed=weekDay(2).at;
  s.meetings=[row('m-ok','합성 간담회',tue,'child-a1'),row('m-int1','합성 노조 상집 45차',tue,'child-a1'),row('m-int2','합성 본부 집행위 42차',wed,'child-a1'),row('m-int3','합성 궤도 집행국 회의 40차',wed,'top-a'),row('m-hid','합성 늘 빼는 종류',wed,'child-a1')];
  s.week=weekDay(0).monday;
  s.draftRow={id:'wk-1',workspace_id:s.workspace.id,week_start:s.week,items:[],draft:{v:1,base:null,me:'',me_from:'',date:'',rows:[],titles:[],area_summaries:{['11111111-1111-4111-8111-111111111111']:OLD_AI}},draft_saved_at:'2026-11-01T00:00:00.000Z',updated_at:'2026-11-01T00:00:00.000Z'};
  s.hiddenKinds=['합성늘빼는종류'];
  return s;
}
async function open(page,s,width){
  await page.setViewportSize({width,height:900});await mockApp(page,s);
  // 이 spec 의 서버: 그 주 임시저장 행(조건부 쓰기)·내 프로필의 늘 빼는 회의 종류. 나중에 등록한 길이 먼저 맞는다.
  await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(method==='GET')return ok([s.draftRow]);
    const body=req.postDataJSON();
    if(method==='PATCH'){
      const guard=decodeURIComponent(url.searchParams.get('draft_saved_at')||'').replace(/^eq\./,'');
      if(guard&&guard!==s.draftRow.draft_saved_at)return ok([]);
      s.draftWrites.push(body);s.draftRow={...s.draftRow,...body};return ok([s.draftRow]);
    }
    return ok([]);
  });
  await page.route(`${SB}/rest/v1/app_profiles**`,route=>{
    const url=new URL(route.request().url());
    if(route.request().method()==='GET'&&(url.searchParams.get('select')||'').includes('weekly_hidden_meeting_kinds'))
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{weekly_hidden_meeting_kinds:s.hiddenKinds}])});
    return route.fallback();
  });
  s.bizNow=await installBusinessNowServer(page);
  await page.route(`${SB}/functions/v1/ai-assist`,route=>{s.aiCalls.push(route.request().postDataJSON());return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})})});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();
}
async function openPreview(page){
  const box=page.locator('#meetingsView #bizWeekBox');
  await expect(box).toBeVisible();
  if(!(await box.evaluate(el=>el.open)))await box.locator(':scope > summary').click();
  await expect(box.locator('.biz-sum-table')).toBeVisible();
  return box;
}
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1);

for(const width of [1440,412])test(`${width}: 이번 주 주간보고 칸 — 내부 정례 회의 없음, 진행·담당 직접 쓰기(보고 없는 줄 포함), AI 없음`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  const dlg=await openPreview(page);
  const paper=dlg.locator('[data-bp-paper]');
  // ① 보고 제목(사실 기록)은 나오고, 내부 정례 회의·늘 빼는 종류는 표와 세부 내용 어디에도 없다. 안내 글·[다시 올리기]도 없다.
  await expect(paper).toContainText('합성 간담회');
  for(const hidden of ['노조 상집','본부 집행위','궤도 집행국','늘 빼는 종류','뺀 회의','다시 올리기'])await expect(paper).not.toContainText(hidden);
  // ③ AI: 호출 0, [AI 초안]·(고침)·예전에 저장된 AI 값은 보이지 않는다.
  for(const gone of ['AI 초안','(수정됨)','예전에 저장된 AI 한 줄'])await expect(dlg).not.toContainText(gone);
  // 보고가 있는 줄(세부 과제 '국토부 대응')과 보고가 없는 줄('산자부 대응')이 모두 표에 있다.
  const rowOf=name=>dlg.locator('.biz-sum-table tbody tr',{has:page.locator('td:nth-child(1)',{hasText:name})});
  const withReport=dlg.locator('.biz-sum-table tbody tr',{hasText:TASK_WITH}).first();
  const empty=dlg.locator('.biz-sum-table tbody tr',{hasText:TASK_EMPTY}).first();
  await expect(withReport.locator('[data-bp-rec-list]')).toHaveCount(0); // 보고 제목은 칸 아래 '이번 주 기록 n'에 접혀 있다
  await withReport.locator('[data-bp-recs]').click();
  await expect(withReport.locator('[data-bp-recs]')).toHaveAttribute('aria-expanded','true');
  await expect(withReport.locator('[data-bp-rec-list]')).toContainText('합성 간담회');
  await expect(empty).toBeVisible();
  await expect(empty.locator('[data-bp-recs]')).toHaveCount(0); // 그 주 기록이 없으면 '이번 주 기록'도 없다
  // ② 보고 없는 줄의 진행 칸: 누르면 글 칸, Ctrl+Enter 저장.
  await empty.locator('[data-bp-cell="progress"]').click();
  const box=empty.locator('textarea[data-bp-field]');
  await expect(box).toBeFocused();
  await box.fill('직접 쓴 진행 첫 줄\n직접 쓴 둘째 줄');
  await box.press('Control+Enter');
  await expect(dlg.locator('[data-bp-status]')).toHaveText('저장했어요.');
  await expect(empty.locator('.biz-hand-line')).toHaveText(['직접 쓴 진행 첫 줄','직접 쓴 둘째 줄']);
  // 이번 주 행(그 사업·이번 주)에 저장한다. 임시저장(옛 칸)에는 쓰지 않는다.
  const nowRow=space=>s.bizNow.now.filter(r=>r.space_id===space&&r.week_start<=s.week).sort((a,b)=>b.week_start.localeCompare(a.week_start))[0];
  expect(nowRow('child-a2')).toMatchObject({week_start:s.week,body:'직접 쓴 진행 첫 줄\n직접 쓴 둘째 줄'});
  expect(s.draftWrites).toEqual([]);
  // 담당 칸: 보고 있는 줄에도 쓸 수 있다(Enter 저장).
  await withReport.locator('[data-bp-cell="owner"]').click();
  const owner=withReport.locator('input[data-bp-field]');
  await expect(owner).toBeFocused();
  await owner.fill('합성 담당 가');
  await owner.press('Enter');
  await expect(withReport.locator('[data-bp-box="owner"]')).toContainText('합성 담당 가');
  expect(nowRow('child-a1')).toMatchObject({week_start:s.week,owner_text:'합성 담당 가'});
  expect(nowRow('child-a2').body).toBe('직접 쓴 진행 첫 줄\n직접 쓴 둘째 줄'); // 진행 칸 저장 값은 그대로 남음
  // 쓰던 칸은 Esc 로 닫히고 저장하지 않는다.
  const writes=s.bizNow.writes.length;
  await empty.locator('[data-bp-cell="progress"]').click();
  await empty.locator('textarea[data-bp-field]').fill('저장하지 않을 글');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('textarea[data-bp-field]')).toHaveCount(0);
  expect(s.bizNow.writes.length).toBe(writes);
  // 팝업·HWP 버튼은 없고, 위 ⋯ 메뉴에도 미리보기 줄이 없다.
  await expect(dlg.locator('[data-bp-hwpx]')).toHaveCount(0);
  await expect(dlg.locator('[data-bw-journal]')).toHaveText('주간 정리에서 보기 ›');
  await expect(dlg.locator('.week-pick-label')).toHaveText(/^\d+\.\d+~\d+\.\d+$/);
  // 접었다 다시 펼쳐도 서버에 저장된 값이 그대로 보인다(같은 칸 = 홈 [주간 정리]와 같은 저장 자리).
  await dlg.locator(':scope > summary').click();
  await expect(dlg.locator('.biz-sum-table')).toBeHidden();
  const again=await openPreview(page);
  await expect(again.locator('.biz-sum-table tbody tr',{hasText:TASK_EMPTY}).first().locator('.biz-hand-line')).toHaveCount(2);
  await expect(again.locator('.biz-sum-table tbody tr',{hasText:TASK_WITH}).first()).toContainText('합성 담당 가');
  expect(s.aiCalls).toEqual([]);
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});
