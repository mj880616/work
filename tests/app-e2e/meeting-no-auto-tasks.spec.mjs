// S59-7 MTG-할일자동생성금지(요청함 11/11 15:25, 명진 "회의결과가 할일을 자동으로 만드는 거 같은데 그러지마. 잊지말기에서 제안은 몰라도 자동생성은 안된다"):
// - 녹음 요약([녹음 요약하기])·서버 정리 결과(fillResult)는 '후속 할 일' 입력 줄을 채우지 않는다 → [사업 보고 저장]해도 Google 할 일 0개.
// - AI가 찾은 할 일은 저장한 그 보고의 챙길 것 후보(app_todo_candidates)로만 올라가고, 보고 상세·잊지 말기에서 [할 일로]를 눌러야 할 일이 생긴다.
// - 명진이 입력 줄에 직접 쓴 할 일은 지금처럼 저장 때 만들어진다.
// 서버는 흉내, 글·이름은 모두 지어낸 것. KPTU_SHOTS=1이면 docs/design/screens/s59-7/에 사진을 남긴다(PR 첨부용).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {showAllReportWeeks} from './helpers/report-week.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';
import {pickReportKind} from './helpers/report-filter.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOTS=process.env.KPTU_SHOTS==='1';
const shot=async(target,name)=>{if(SHOTS)await target.screenshot({path:`docs/design/screens/s59-7/${name}.png`})};
const MEETING='d0000000-0000-4000-8000-000000000001';
const cid=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const DRAFT={decisions:'합성 결정 하나',information:'합성 공유 하나',attendees:['가상 위원 1','가상 위원 2'],
  actions:[{task:'합성 자료 정리',assignee:'',due:'2026-11-20'},{task:'합성 공문 회신',assignee:'가상 담당',due:''}]};

function state(){
  const s=baseState();
  // 화면 사진에 실제 업무 이름이 나오지 않게 사업영역도 지어낸 이름만 둔다.
  const space=(id,name,sort,parent=null)=>({id,workspace_id:'workspace-1',name,description:null,parent_id:parent,status:'active',visibility:'private',owner_id:'user-1',sort_order:sort,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z',metadata:{project_system:'v2',management_version:2}});
  s.spaces=[space('top-x','가상 사업 A',10),space('child-x1','가상 세부 A1',20,'top-x')];s.docs=[];
  Object.assign(s,{meetingWrites:[],googleCreates:[],candidatePosts:[],candidatePatches:[],candidates:[],draftCalls:0,
    meetings:[{id:'m-old',workspace_id:'workspace-1',title:'합성 지난 회의',series_name:'합성 지난 회의',round_no:1,meeting_at:'2026-11-03T01:00:00Z',transcript_text:'합성 지난 결과',activity_kind:'meeting',created_by:'user-1'}]});
  return s;
}
async function routes(page,s){
  await mockApp(page,s);
  // 뒤에 건 길이 먼저 받는다. 이 시험이 보는 요청만 받고 나머지는 mockApp으로 넘긴다.
  await page.route(`${SB}/functions/v1/meeting-ai-draft`,route=>{s.draftCalls++;return route.fulfill({json:{ok:true,draft:DRAFT,warnings:[]}})});
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>{
    const req=route.request(),url=new URL(req.url());
    // 보고 상세의 '후속 할 일' 목록(이 보고에 이어진 할 일) = 지금까지 만든 할 일 중 이 보고와 이은 것.
    if(url.searchParams.get('action')==='linked'){const mid=url.searchParams.get('meeting_id');return route.fulfill({json:{tasks:s.googleCreates.map((c,i)=>({c,i})).filter(({c})=>(c.links||[]).some(l=>l.meeting_id===mid)).map(({c,i})=>({id:`gt-${i+1}`,title:c.title,due:c.due||null,status:'needsAction'}))}})}
    if(url.searchParams.get('action')!=='create')return route.fallback();
    const body=req.postDataJSON();s.googleCreates.push(body);
    return route.fulfill({json:{ok:true,task:{id:`gt-${s.googleCreates.length}`,title:body.title,due:body.due||null,status:'needsAction'}}});
  });
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>{
    const req=route.request();if(req.method()!=='POST')return route.fallback();
    const body=req.postDataJSON(),row={...body,id:MEETING,created_at:'2026-11-10T01:00:00Z',updated_at:'2026-11-10T01:00:00Z'};
    s.meetings.push(row);s.meetingWrites.push(body);return route.fulfill({json:[row]});
  });
  await page.route(`${SB}/rest/v1/app_todo_candidates**`,route=>{
    const req=route.request(),q=new URL(req.url()).searchParams,method=req.method();
    if(method==='POST'){
      const body=req.postDataJSON();s.candidatePosts.push({query:`on_conflict=${q.get('on_conflict')}&select=${q.get('select')}`,prefer:req.headers().prefer||'',body});
      const made=[];
      for(const r of body){if(s.candidates.some(c=>c.dedupe_key===r.dedupe_key))continue;const row={...r,id:cid(s.candidates.length+1),status:'open',task_id:null,task_due:null,created_at:'2026-11-10T01:01:00Z',decided_at:null};s.candidates.push(row);made.push({id:row.id})}
      return route.fulfill({status:201,json:made});
    }
    if(method==='PATCH'){
      const id=q.get('id').replace(/^eq\./,''),from=q.get('status').replace(/^eq\./,''),body=req.postDataJSON(),row=s.candidates.find(c=>c.id===id&&c.status===from);
      s.candidatePatches.push({id,body});if(!row)return route.fulfill({json:[]});
      Object.assign(row,body);return route.fulfill({json:[{id,status:row.status,task_id:row.task_id,decided_at:row.decided_at}]});
    }
    let out=s.candidates;
    const src=q.get('source_id'),st=q.get('status');
    if(src)out=out.filter(c=>'eq.'+c.source_id===src);
    if(st==='eq.open')out=out.filter(c=>c.status==='open');
    return route.fulfill({json:out});
  });
}
async function openWrite(page,s,width){
  await page.setViewportSize({width,height:width>760?900:915});await routes(page,s);
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();await showAllReportWeeks(page);
  await pickReportKind(page,'회의');await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  if(await page.locator('#meetingNameSelect').isVisible())await page.locator('#meetingNameSelect').selectOption('__other__');
  await page.locator('#meetingTitle').fill('합성 운영회의');await fillDateTime(page,'#meetingAt','2026-11-10T10:00');
}
async function summarize(page){
  await page.locator('#mtdOpen').click();
  await page.locator('#mtdText').fill('합성 전사 글 첫 줄\n합성 전사 글 둘째 줄');
  await page.locator('#mtdRun').click();
  await expect(page.locator('#mtdStatus')).toContainText('할 일 후보 2개는 저장하면 잊지 말기에');
}
const actionRows=page=>page.locator('#meetingActionList .meeting-action-row');

for(const width of [412,1280])test(`${width}: 녹음 요약 → 후속 할 일 줄은 비어 있고, 저장해도 할 일 0개 · 후보 2개만 · [할 일로]를 눌러야 1개`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await openWrite(page,s,width);
  await summarize(page);
  // AI 결과는 결과 원문·참석인원 칸에만 들어가고, '후속 할 일' 입력 줄·목록은 비어 있다.
  await expect(page.locator('#meetingTranscript')).toHaveValue(/합성 결정 하나/);
  await expect(actionRows(page)).toHaveCount(0);
  await expect(page.locator('#meetingActionTitle')).toHaveValue('');
  await expect(page.locator('#mtdStatus')).not.toContainText('후속 할 일');
  await page.locator('#mtdStatus').scrollIntoViewIfNeeded();
  await shot(page.locator('#meetingModal .modal-card'),width>760?'pc-1280-draft':'phone-412-draft');
  await page.locator('#meetingActionList').evaluate(el=>el.scrollIntoView({block:'center'}));
  await shot(page.locator('#meetingModal .modal-card'),width>760?'pc-1280-draft-followup':'phone-412-draft-followup');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  // 저장한 보고 id로 후보 2개를 한 번에 올린다(상태 칸 없음 = 늘 open). Google 할 일은 하나도 만들지 않는다.
  await expect.poll(()=>s.candidates.length).toBe(2);
  expect(s.candidatePosts).toHaveLength(1);
  expect(s.candidatePosts[0].query).toBe('on_conflict=workspace_id,dedupe_key&select=id');
  expect(s.candidatePosts[0].prefer).toContain('resolution=ignore-duplicates');
  expect(s.candidatePosts[0].body.map(r=>[r.summary,r.due,r.source_kind,r.source_id,r.source_day,r.kind])).toEqual([
    ['합성 자료 정리','2026-11-20','meeting',MEETING,'2026-11-10','my_task'],['합성 공문 회신 (가상 담당)',null,'meeting',MEETING,'2026-11-10','my_task']]);
  expect(s.candidatePosts[0].body.every(r=>!('status' in r)&&!('task_id' in r))).toBe(true);
  await page.waitForTimeout(300);
  expect(s.googleCreates).toEqual([]);
  // 보고 상세의 후보 줄(잊지 말기와 같은 부품): [할 일로]를 눌러야 그 하나만 할 일이 된다(보고와 연결).
  await openMeetingResult(page,MEETING);
  const cand=page.locator('#mrdTodoCand').filter({visible:true});
  await expect(cand.locator('.inbox-todo-row')).toHaveCount(2);
  await expect(cand).toContainText('합성 자료 정리');await expect(cand).toContainText('합성 공문 회신 (가상 담당)');
  await cand.scrollIntoViewIfNeeded();
  await shot(page,width>760?'pc-1280-candidates':'phone-412-candidates');
  expect(s.googleCreates).toEqual([]);
  await cand.locator(`[data-inbox-todo-task="${cid(1)}"]`).click();
  await expect.poll(()=>s.googleCreates.length).toBe(1);
  expect(s.googleCreates[0]).toMatchObject({action:'create',title:'합성 자료 정리',due:'2026-11-20'});
  expect(s.googleCreates[0].links).toContainEqual({meeting_id:MEETING});
  await expect.poll(()=>s.candidates[0].status).toBe('tasked');
  expect(s.candidates[1].status).toBe('open');
  await expect(cand.locator(`[data-inbox-todo-row="${cid(1)}"]`)).toHaveCount(0);
  await expect(page.locator('#mrdTasks').filter({visible:true})).toContainText('합성 자료 정리');
  await shot(page,width>760?'pc-1280-tasked':'phone-412-tasked');
  expect(s.googleCreates).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('1280: 손으로 쓴 후속 할 일은 그대로 저장 때 생기고, AI가 찾은 것은 후보로만 — 같은 창에서 섞여도',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await openWrite(page,s,1280);
  await summarize(page);
  await expect(actionRows(page)).toHaveCount(0);
  await page.locator('#meetingActionTitle').fill('합성 손으로 쓴 일');await page.locator('#meetingActionAdd').click();
  await expect(actionRows(page)).toHaveCount(1);
  // 입력 줄에 남은 한 줄도 손으로 쓴 것이라 함께 만든다(지금 규칙 그대로).
  await page.locator('#meetingActionTitle').fill('합성 손으로 쓴 둘째 일');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await expect.poll(()=>s.googleCreates.length).toBe(2);
  expect(s.googleCreates.map(c=>c.title)).toEqual(['합성 손으로 쓴 일','합성 손으로 쓴 둘째 일']);
  expect(s.googleCreates[0].links).toContainEqual({meeting_id:MEETING});
  await expect.poll(()=>s.candidates.length).toBe(2);
  expect(s.candidates.map(c=>c.summary)).toEqual(['합성 자료 정리','합성 공문 회신 (가상 담당)']);
  await page.waitForTimeout(300);
  expect(s.googleCreates).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('412: 서버 정리 결과(폰 앱·노트북 녹음)도 같은 길 — 입력 줄 0, 저장해도 할 일 0, 후보만. 저장하지 않고 닫으면 후보도 없음',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await openWrite(page,s,412);
  const filled=await page.evaluate(draft=>window.KPTUMeetingTranscriptDraft.fillResult({text:'합성 전문 한 줄',draft,name:'녹음'}),DRAFT);
  expect(filled).toBe(true);
  expect(s.draftCalls).toBe(0);
  await expect(page.locator('#mtdStatus')).toContainText('할 일 후보 2개는 저장하면 잊지 말기에');
  await expect(actionRows(page)).toHaveCount(0);
  await expect(page.locator('#meetingNotes')).toHaveValue(/합성 전문 한 줄/);
  // 저장하지 않고 닫고 다시 열면 들고 있던 후보는 버린다(다른 보고에 붙지 않게).
  // REC-한회의로잇기 PR-0: 쓰던 글이 있으면 닫기 전에 묻는다 → [닫기].
  await page.locator('#meetingModal [data-close="meetingModal"]').click();
  await page.locator('.kptu-ask').getByRole('button',{name:'닫기'}).click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await page.locator('#newMeetingBtn').click();await expect(page.locator('#meetingModal')).toBeVisible();
  if(await page.locator('#meetingNameSelect').isVisible())await page.locator('#meetingNameSelect').selectOption('__other__');
  await page.locator('#meetingTitle').fill('합성 다른 회의');await fillDateTime(page,'#meetingAt','2026-11-11T10:00');
  await page.locator('#saveMeetingBtn').click();await expect(page.locator('#meetingModal')).toBeHidden();
  await expect.poll(()=>s.meetingWrites.length).toBe(1);
  await page.waitForTimeout(300);
  expect(s.candidatePosts).toEqual([]);
  expect(s.googleCreates).toEqual([]);
  // 다시 정리 결과를 넣고 저장하면 그때 후보만.
  await page.locator('#newMeetingBtn').click();await expect(page.locator('#meetingModal')).toBeVisible();
  if(await page.locator('#meetingNameSelect').isVisible())await page.locator('#meetingNameSelect').selectOption('__other__');
  await page.locator('#meetingTitle').fill('합성 운영회의');await fillDateTime(page,'#meetingAt','2026-11-10T10:00');
  await page.evaluate(draft=>window.KPTUMeetingTranscriptDraft.fillResult({text:'합성 전문 한 줄',draft,name:'녹음'}),DRAFT);
  await page.locator('#saveMeetingBtn').click();await expect(page.locator('#meetingModal')).toBeHidden();
  await expect.poll(()=>s.candidates.length).toBe(2);
  await page.waitForTimeout(300);
  expect(s.googleCreates).toEqual([]);
  expect(errors).toEqual([]);
});
