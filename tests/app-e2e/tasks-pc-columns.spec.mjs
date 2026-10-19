// UI-PC할일(2026-10-20 사용자 요청): PC(≥1024) 할 일 화면은 기한별 열 3개("지남·오늘"·"7일 안"·"나중") + 오른쪽 상세 칸.
// 폰·중간 폭은 지금 묶음 목록 그대로. 상세 칸은 지금 수정 창과 같은 요소·같은 저장 경로(google-tasks update/link/unlink)를 쓴다.
import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

const NOW=Date.parse('2026-10-08T03:00:00Z'); // 한국 시각 10월 8일 정오
const task=(id,due=null,extra={})=>({id,title:'할 일 '+id,taskListId:'@default',taskListTitle:'내 할 일',due,status:'needsAction',notes:'',...extra});
const PROJECT={id:'p1',name:'시험 프로젝트',workspace_id:'qa-ws',owner_id:'qa-user',metadata:{project_system:'v2'},status:'active'};
const ORG={id:'o1',name:'시험 조직',active:true};

async function open(page,width,tasks,{links=[]}={}){
  await page.setViewportSize({width,height:844});
  await openEmphasisFixture(page,{view:'list',now:NOW,events:[],tasks,projects:[PROJECT],orgs:[ORG],links});
  // 저장 경로를 기록하는 google-tasks 응답(먼저 등록된 고정 응답보다 우선한다).
  const calls=[];let taskLinks=links.map(l=>({...l}));
  await page.route('**/functions/v1/google-tasks**',async route=>{
    const url=new URL(route.request().url()),action=url.searchParams.get('action'),body=route.request().postDataJSON?.()||null;
    calls.push({action,body});
    const ok=json=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
    const linksOf=id=>({links:taskLinks.filter(l=>l.google_task_id===id&&(l.project_id||l.organization_id)).map(({project_id,organization_id})=>({...(project_id?{project_id}:{organization_id}),status:'confirmed'})),meeting_links:[]});
    if(action==='links')return ok(linksOf(url.searchParams.get('task_id')));
    if(action==='update'){const at=tasks.findIndex(t=>t.id===body.task_id);tasks[at]={...tasks[at],title:body.title,notes:body.notes,due:body.due?body.due+'T00:00:00.000Z':null};return ok({ok:true,task:tasks[at]})}
    if(action==='link'){for(const l of body.links)taskLinks.push({google_task_id:body.task_id,...l,status:'confirmed'});return ok({ok:true,...linksOf(body.task_id)})}
    if(action==='unlink'){taskLinks=taskLinks.filter(l=>!(l.google_task_id===body.task_id&&body.links.some(x=>(x.project_id&&x.project_id===l.project_id)||(x.organization_id&&x.organization_id===l.organization_id))));return ok({ok:true,...linksOf(body.task_id)})}
    if(action==='toggle'){const at=tasks.findIndex(t=>t.id===body.task_id);tasks[at]={...tasks[at],status:body.completed?'completed':'needsAction',completed:body.completed?new Date(NOW).toISOString():null};return ok({ok:true,task:tasks[at]})}
    return ok({connected:true,authorized:true,needs_reconnect:false,tasks,pending_scope:'all'});
  });
  await page.evaluate(()=>window.KPTURouter.go('tasks'));
  await expect(page.locator('[data-gt-count]')).toHaveText(`할 일 ${tasks.filter(t=>t.status!=='completed').length}개`);
  return calls;
}
const col=(page,id)=>page.locator(`#gtTaskBody [data-gt-col="${id}"]`);

for(const width of [1280,1440]){
  test(`PC ${width}: 기한별 열 3개, 건수, 빈 열 "없음", 지난 기한은 빨간 글자, 한 페이지`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const tasks=[task('late','2026-10-06'),task('today','2026-10-08'),task('soon','2026-10-10'),task('far','2026-10-30'),task('none'),task('done',null,{status:'completed',completed:new Date(NOW).toISOString()})];
    await open(page,width,tasks,{links:[{google_task_id:'today',project_id:'p1',status:'confirmed'},{google_task_id:'soon',organization_id:'o1',status:'confirmed'}]});
    await expect(page.locator('#gtTaskBody .gt-col-name')).toHaveText(['지남·오늘','7일 안','나중']);
    await expect(page.locator('#gtTaskBody .gt-col-count')).toHaveText(['2','1','2']);
    // 지남·오늘: 지난 건이 먼저, 기한 글자는 빨강(지금 목록의 "기한 지남" 색과 같음).
    await expect(col(page,'now').locator('.gt-card')).toHaveCount(2);
    await expect(col(page,'now').locator('.gt-card').first()).toHaveAttribute('data-google-task','late');
    const danger=await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--kptu-danger').trim());
    const red=await col(page,'now').locator('[data-google-task="late"] .gt-due').evaluate(e=>getComputedStyle(e).color);
    const plain=await col(page,'now').locator('[data-google-task="today"] .gt-due').evaluate(e=>getComputedStyle(e).color);
    expect(red).not.toBe(plain);expect(danger).not.toBe('');
    // 카드 태그: 프로젝트·담당조직 이름.
    await expect(col(page,'now').locator('[data-google-task="today"] .gt-tag-project')).toHaveText('시험 프로젝트');
    await expect(col(page,'week').locator('[data-google-task="soon"] .gt-tag-org')).toHaveText('시험 조직');
    // 나중: 기한 있는 것 + "기한 없음" + 접힌 "완료 1".
    await expect(col(page,'later').locator('.gt-col-sub')).toHaveText('기한 없음 1');
    await expect(col(page,'later').locator('[data-gt-undated] [data-google-task]')).toHaveCount(1);
    await expect(col(page,'now').locator('[data-gt-overdue] [data-google-task]')).toHaveCount(1);await expect(col(page,'now').locator('[data-gt-today] [data-google-task]')).toHaveCount(1);
    const done=col(page,'later').locator('#gtCompleted');
    await expect(done).not.toHaveAttribute('open','');await expect(done.locator('summary')).toContainText('완료 1');
    await expect(done.locator('[data-google-task="done"]')).toBeHidden();
    await done.locator('summary').click();await expect(done).toHaveAttribute('open','');await expect(done.locator('[data-google-task="done"]')).toBeVisible();
    // 화면 전체는 한 페이지(세로·가로 넘김 없음), 입력 카드는 입력창 + [추가]만.
    const m=await page.evaluate(()=>({sh:document.documentElement.scrollHeight,ih:innerHeight,sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
    expect(m.sh).toBeLessThanOrEqual(m.ih+1);expect(m.sw).toBeLessThanOrEqual(m.cw+1);
    const quick=page.locator('#tasksView .home-quick');
    await expect(quick.locator('[data-quick-save]')).toHaveText('추가');await expect(quick.locator('[data-quick-input]')).toBeVisible();
    const qbox=await quick.boundingBox(),input=await quick.locator('[data-quick-input]').boundingBox();
    expect(qbox.height-input.height).toBeLessThanOrEqual(16);
    // 폰 묶음 목록은 PC에 없다.
    await expect(page.locator('#gtTaskBody > .gt-group')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`PC ${width}: 빈 열은 "없음", 많으면 열 안에서만 세로로 넘김`,async({page})=>{
    const tasks=Array.from({length:24},(_,i)=>task('w'+i,'2026-10-1'+(i%5)));
    await open(page,width,tasks);
    await expect(col(page,'now').locator('.gt-col-empty')).toHaveText('없음');
    await expect(col(page,'later').locator('.gt-col-empty')).toHaveText('없음');
    await expect(col(page,'week').locator('.gt-col-count')).toHaveText('24');
    const scroll=await col(page,'week').locator('.gt-col-body').evaluate(e=>({sh:e.scrollHeight,ch:e.clientHeight,oy:getComputedStyle(e).overflowY}));
    expect(scroll.oy).toBe('auto');expect(scroll.sh).toBeGreaterThan(scroll.ch);
    const m=await page.evaluate(()=>({sh:document.documentElement.scrollHeight,ih:innerHeight}));
    expect(m.sh).toBeLessThanOrEqual(m.ih+1);
  });

  test(`PC ${width}: 카드를 고르면 오른쪽 칸에서 바로 수정·저장, 선택 표시, 키보드`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const tasks=[task('a','2026-10-08',{notes:'첫 메모'}),task('b','2026-10-12')];
    const calls=await open(page,width,tasks,{links:[{google_task_id:'a',project_id:'p1',status:'confirmed'}]});
    const pane=page.locator('#gtDetailPane');
    await expect(pane).toBeVisible();await expect(pane.locator('.gt-pane-empty')).toBeVisible();await expect(page.locator('#gtTaskModal')).toBeHidden();
    // 키보드로 카드 고르기(제목 버튼 Enter).
    await page.locator('[data-gt-edit="a"]').focus();await page.keyboard.press('Enter');
    const editor=pane.locator('#gtTaskModal');
    await expect(editor).toBeVisible();await expect(page.locator('#gtEditTitle')).toBeFocused();
    await expect(page.locator('[data-google-task="a"]')).toHaveClass(/is-selected/);await expect(page.locator('[data-gt-edit="a"]')).toHaveAttribute('aria-current','true');
    // 팝업이 아니다: 화면을 덮지 않고 열·카드를 계속 누를 수 있다.
    expect(await editor.evaluate(e=>({role:e.getAttribute('role'),modal:e.getAttribute('aria-modal'),pos:getComputedStyle(e).position}))).toEqual({role:'region',modal:null,pos:'static'});
    // 지금 수정 창과 같은 항목: 할 일·기한·메모·프로젝트·조직 연결.
    await expect(page.locator('#gtEditDue')).toHaveValue('2026-10-08');await expect(page.locator('#gtEditNotes')).toHaveValue('첫 메모');
    await expect(pane.locator('[data-gt-link][value="p:p1"]')).toBeChecked();await expect(pane.locator('[data-gt-link][value="o:o1"]')).not.toBeChecked();
    // 바로 수정 → 저장(같은 update·link·unlink 경로). 칸은 열린 채 "저장했습니다."
    await page.locator('#gtEditDue').fill('2026-10-12');await page.locator('#gtEditNotes').fill('고친 메모');
    await pane.locator('[data-gt-link][value="o:o1"]').check();await pane.locator('[data-gt-link][value="p:p1"]').uncheck();
    await pane.locator('#gtSaveBtn').click();
    await expect(page.locator('#gtEditStatus')).toHaveText('저장했습니다.');
    const update=calls.find(c=>c.action==='update');
    expect(update.body).toMatchObject({action:'update',task_id:'a',title:'할 일 a',notes:'고친 메모',due:'2026-10-12'});
    expect(calls.find(c=>c.action==='link').body.links).toEqual([{organization_id:'o1'}]);
    expect(calls.find(c=>c.action==='unlink').body.links).toEqual([{project_id:'p1'}]);
    expect(calls.some(c=>c.action==='create')).toBe(false);
    // 다시 읽은 목록에서 카드가 "7일 안"으로 옮겨지고 선택은 유지된다.
    await expect(col(page,'week').locator('[data-google-task="a"]')).toHaveClass(/is-selected/);
    await expect(editor).toBeVisible();
    // 다른 카드를 누르면 그 할 일로 바뀐다.
    await page.locator('[data-gt-edit="b"]').click();await expect(page.locator('#gtEditTitle')).toHaveValue('할 일 b');
    await expect(page.locator('[data-google-task="b"]')).toHaveClass(/is-selected/);await expect(page.locator('[data-google-task="a"]')).not.toHaveClass(/is-selected/);
    // Esc로 칸을 닫으면 그 카드로 초점이 돌아간다.
    await page.locator('#gtEditTitle').focus();await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();await expect(pane.locator('.gt-pane-empty')).toBeVisible();
    await expect(page.locator('[data-gt-edit="b"]')).toBeFocused();await expect(page.locator('.gt-card.is-selected')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`PC ${width}: 카드의 완료 동그라미는 지금 완료 경로(toggle)`,async({page})=>{
    const tasks=[task('a','2026-10-08')];const calls=await open(page,width,tasks);
    await page.locator('[data-gt-toggle="a"]').click();
    await expect.poll(()=>calls.filter(c=>c.action==='toggle').map(c=>c.body.completed)).toEqual([true]);
    const done=col(page,'later').locator('#gtCompleted');
    await expect(done.locator('summary')).toContainText('완료 1',{timeout:6000});
    await expect(col(page,'now').locator('.gt-col-empty')).toHaveText('없음');
  });
}

test('폰 390: 지금 묶음 목록·수정 창 그대로(열·상세 칸 없음)',async({page})=>{
  const tasks=[task('late','2026-10-06'),task('today','2026-10-08'),task('far','2026-10-30')];
  await open(page,390,tasks);
  await expect(page.locator('#gtTaskBody .gt-cols')).toHaveCount(0);await expect(page.locator('#gtDetailPane')).toBeHidden();
  expect(await page.locator('#gtTaskBody>.gt-group .gt-group-head').allTextContents()).toEqual(['기한 지남 1','오늘 1','나중 1']);
  await page.locator('[data-gt-edit="today"]').click();
  const modal=page.locator('#gtTaskModal');await expect(modal).toBeVisible();
  expect(await modal.evaluate(e=>({parent:e.parentElement.tagName,role:e.getAttribute('role'),pos:getComputedStyle(e).position}))).toEqual({parent:'BODY',role:'dialog',pos:'fixed'});
  await page.locator('[data-gt-close]').click();await expect(modal).toBeHidden();
});
