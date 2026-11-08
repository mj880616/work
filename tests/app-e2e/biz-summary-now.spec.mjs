// BIZ-기록하나로 B-3(설계 docs/design/record-one.md 2-4·2-7·3-1): 사업 보고 '이번 주 주간보고' 1) 사업요약표 = 사업 '지금 상황' 창.
// ① 처음 한 번 채우기: 지금 상황 행이 없는 사업만 전환 주(11.9) 행으로 — 그 주 임시저장의 같은 칸 글·담당, 없으면 '—'. 다시 그려도 또 채우지 않는다.
// ② 이어 쓰기: 지난주(11.9) 글이 이번 주(11.16)에 보이고, 이번 주에 고치면 이번 주 행만 생긴다(지난주 행·지난주 표는 그대로).
// ③ 칸 아래 흐린 '이번 주 기록 n' = 그 주 사업 보고 줄 + 그 주 사업 기록(지난주 기록은 세지 않음), 누르면 펼침.
// ④ 전환 주 앞(11.2)은 옛 보고 — 고칠 수 없다. 폰 390·폴드 884·PC 1280. 서버는 가짜, 이름·글은 모두 합성 값. 시계 2026-11-17(화).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',NOW='2026-11-17T01:00:00Z',FROM='2026-11-09',W='2026-11-16';
const AREA='공공기관 기능개혁 대응',TASK='국토부 대응',EMPTY='산자부 대응';

function state(){
  const s=baseState();s.draftWrites=[];
  const row=(id,title,at,area)=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:1,meeting_at:at,transcript_text:'합성 결과 글',activity_kind:'meeting',business_area_id:area,next_plan:'',created_by:s.user.id,created_at:at,updated_at:at,notes:'',decisions:''});
  s.meetings=[row('m-now','합성 이번 주 간담회','2026-11-18T01:00:00Z','child-a1'),row('m-old','합성 지난주 간담회','2026-11-11T01:00:00Z','child-a1')];
  // 전환 주 임시저장: 국토부 대응 칸에 명진이 쓴 줄과 담당. 산자부 대응 칸은 없음 → '—'.
  s.drafts={[FROM]:{id:'wk-1',workspace_id:s.workspace.id,week_start:FROM,items:[],draft:{v:1,base:null,me:'',me_from:'',date:'',rows:[{section:'summary',key:`${AREA}›${TASK}`,n:0,lines:['- 합성 지난 상황']}],titles:[],owners:{[`${AREA}›${TASK}`]:'합성 담당'}},draft_saved_at:'2026-11-10T00:00:00.000Z',updated_at:'2026-11-10T00:00:00.000Z'}};
  return s;
}
async function open(page,s,width,{records=[]}={}){
  await page.setViewportSize({width,height:900});
  await page.clock.setFixedTime(new Date(NOW));
  await mockApp(page,s);
  await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()!=='GET'){s.draftWrites.push(req.postDataJSON());return route.fulfill({status:200,contentType:'application/json',body:'[]'})}
    const week=(url.searchParams.get('week_start')||'').replace(/^eq\./,'');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(s.drafts[week]?[s.drafts[week]]:[])});
  });
  const db=await installBusinessNowServer(page,{records});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();
  const box=page.locator('#meetingsView #bizWeekBox');
  await expect(box).toBeVisible();
  if(await box.evaluate(el=>el.tagName==='DETAILS'&&!el.open))await box.locator(':scope > summary').click();
  await expect(box.locator('.biz-sum-table')).toBeVisible();
  return {box,db};
}
// 주 넘기기: 칸 안 주 고르기가 있으면 그것, 없으면(BIZ-위쪽정돈 뒤) 사업 보고 위 주 고르기.
async function step(page,box,dir){
  const own=box.locator(`[data-week-step="${dir}"]`);
  if(await own.count())return own.click();
  return page.locator(`#reportWeekFilter [data-report-week="${dir<0?'prev':'next'}"]`).click();
}
const rowOf=(box,name)=>box.locator('.biz-sum-table tbody tr',{has:box.page().locator('td:nth-child(1), td:nth-child(2)',{hasText:name})}).first();
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1);

for(const width of [390,884,1280])test(`${width}px: 사업요약표 지금 상황 — 처음 채우기, 지난주 글 이어 보임, 이번 주 고치면 이번 주 행만, 이번 주 기록 n`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();
  const records=[{id:'br-1',workspace_id:s.workspace.id,space_id:'child-a1',day:'2026-11-18',end_day:null,body:'합성 사업 기록 줄',source_kind:'update',source_id:'n1',created_at:NOW},
    {id:'br-2',workspace_id:s.workspace.id,space_id:'child-a1',day:'2026-11-12',end_day:null,body:'합성 지난주 기록 줄',source_kind:'user',source_id:null,created_at:NOW}];
  const {box,db}=await open(page,s,width,{records});
  const task=rowOf(box,TASK),empty=rowOf(box,EMPTY);
  // ① 처음 채우기: 한 번, 전환 주 행으로(국토부 = 임시저장 칸 글·담당, 산자부 = 빈 글).
  await expect(task.locator('.biz-hand-line')).toHaveText(['- 합성 지난 상황']);
  await expect(task.locator('[data-bp-box="owner"]')).toContainText('합성 담당');
  await expect(empty.locator('.biz-now-empty')).toHaveText('—');
  expect(db.fills).toHaveLength(1);
  expect(db.fills[0].every(r=>r.week_start===FROM&&r.workspace_id===s.workspace.id)).toBe(true);
  expect(db.fills[0].find(r=>r.space_id==='child-a1')).toMatchObject({body:'- 합성 지난 상황',owner_text:'합성 담당'});
  expect(db.fills[0].find(r=>r.space_id==='child-a2')).toMatchObject({body:'',owner_text:''});
  expect(s.draftWrites).toEqual([]); // 임시저장에는 쓰지 않는다
  // ③ 이번 주 기록 n: 이번 주 사업 보고 1 + 이번 주 사업 기록 1(지난주 것은 세지 않음). 누르면 펼침.
  const recs=task.locator('[data-bp-recs]');
  await expect(recs).toHaveText(/이번 주 기록 2/);
  await expect(recs).toHaveAttribute('aria-expanded','false');
  await recs.click();
  await expect(task.locator('[data-bp-recs]')).toHaveAttribute('aria-expanded','true');
  const list=task.locator('[data-bp-rec-list]');
  await expect(list).toContainText('합성 이번 주 간담회');
  await expect(list).toContainText('- 11.18. 합성 사업 기록 줄');
  await expect(list).not.toContainText('지난주');
  // ② 이번 주에 고치면 이번 주 행이 새로 생기고(담당은 앞 행에서 이어 받음), 전환 주 행은 그대로.
  await task.locator('[data-bp-cell="progress"]').click();
  const field=task.locator('textarea[data-bp-field]');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('- 합성 지난 상황');
  await field.fill('합성 이번 주 상황');
  await field.press('Control+Enter');
  await expect(box.locator('[data-bp-status]')).toHaveText('저장했어요.');
  await expect(task.locator('.biz-hand-line')).toHaveText(['합성 이번 주 상황']);
  expect(db.writes.at(-1)).toMatchObject({m:'POST',workspace_id:s.workspace.id,space_id:'child-a1',week_start:W,body:'합성 이번 주 상황',owner_text:'합성 담당'});
  expect(db.now.find(r=>r.space_id==='child-a1'&&r.week_start===FROM).body).toBe('- 합성 지난 상황');
  // 같은 주 담당만 고치면 이번 주 행만 고친다.
  await task.locator('[data-bp-cell="owner"]').click();
  await task.locator('input[data-bp-field]').fill('합성 새 담당');
  await task.locator('input[data-bp-field]').press('Enter');
  await expect(task.locator('[data-bp-box="owner"]')).toContainText('합성 새 담당');
  expect(db.writes.at(-1)).toMatchObject({m:'PATCH',owner_text:'합성 새 담당'});
  expect(db.now.find(r=>r.space_id==='child-a1'&&r.week_start===FROM).owner_text).toBe('합성 담당');
  // 지난주(전환 주)로 넘기면 그때 글 그대로.
  await step(page,box,-1);
  await expect(rowOf(box,TASK).locator('.biz-hand-line')).toHaveText(['- 합성 지난 상황']);
  await expect(rowOf(box,TASK).locator('[data-bp-box="owner"]')).toContainText('합성 담당');
  expect(db.fills).toHaveLength(1); // 다시 그려도 또 채우지 않는다
  // 전환 주 앞(옛 보고)은 고칠 수 없다.
  await step(page,box,-1);
  await expect(box.locator('[data-bp-status]')).toHaveText('옛 보고라 수정할 수 없어요.');
  await expect(box.locator('[data-bp-cell]')).toHaveCount(0);
  // 다시 이번 주로: 이번 주 글.
  await step(page,box,1);await step(page,box,1);
  await expect(rowOf(box,TASK).locator('.biz-hand-line')).toHaveText(['합성 이번 주 상황']);
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('지금 상황 표가 아직 없으면(DB 적용 전) 쓰기를 막고 표는 그대로', async({page})=>{
  const s=state();
  await page.setViewportSize({width:1280,height:900});
  await page.clock.setFixedTime(new Date(NOW));
  await mockApp(page,s);
  await installBusinessNowServer(page,{missing:true});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  const box=page.locator('#meetingsView #bizWeekBox');
  await expect(box).toBeVisible();
  if(await box.evaluate(el=>el.tagName==='DETAILS'&&!el.open))await box.locator(':scope > summary').click();
  await expect(box.locator('.biz-sum-table')).toBeVisible();
  await expect(box.locator('[data-bp-status]')).toHaveText('저장 칸이 아직 준비되지 않아 지금은 쓸 수 없어요.');
  await expect(box.locator('[data-bp-cell]')).toHaveCount(0);
});
